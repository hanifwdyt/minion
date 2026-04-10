import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { TraceStore } from "./execution-trace.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const USAGE_PATH = resolve(DATA_DIR, "usage.json");

interface ChatMessage {
  id: string;
  minionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
}

interface RunOptions {
  systemPrompt?: string;
  allowedTools?: string;
  maxTurns?: number;
  model?: string;
  env?: Record<string, string>;
  _taskId?: string;   // internal: preserve taskId when dequeuing
  _isReview?: boolean; // internal: this task is a peer review — don't trigger another review
  _isFix?: boolean;   // internal: this task is a post-review fix — don't trigger another review
}

interface ClaudeSession {
  process: ChildProcess;
  minionId: string;
  taskId: string;
  sessionId?: string;
  messageCounter: number;
  currentStreamId?: string;
  currentStreamText?: string;
  lastActivity: number;
  idleTimeout?: NodeJS.Timeout;
  workdir: string;
  options?: RunOptions;
  originalPrompt: string;
  loopInterruptCount: number; // how many times we've interrupted this session for loop
}

export interface TaskStep {
  id: string;
  minionId: string;
  summary: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  toolName?: string;
  detail?: string;
  timestamp: number;
}

export interface TaskProgress {
  minionId: string;
  title: string;
  steps: TaskStep[];
  startedAt: number;
}

interface QueuedTask {
  minionId: string;
  prompt: string;
  workdir: string;
  taskId: string;
  options?: RunOptions;
}

interface UsageStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  byMinion: Record<string, { inputTokens: number; outputTokens: number; prompts: number }>;
}

export class ClaudeManager extends EventEmitter {
  private sessions: Map<string, ClaudeSession> = new Map();
  private lastSessionIds: Map<string, string> = new Map();
  private queues: Map<string, QueuedTask[]> = new Map();
  private usage: UsageStats;
  private taskProgress: Map<string, TaskProgress> = new Map(); // minionId → current task progress
  public traces = new TraceStore();

  constructor() {
    super();
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    if (existsSync(USAGE_PATH)) {
      try {
        this.usage = JSON.parse(readFileSync(USAGE_PATH, "utf-8"));
      } catch {
        this.usage = { totalInputTokens: 0, totalOutputTokens: 0, byMinion: {} };
      }
    } else {
      this.usage = { totalInputTokens: 0, totalOutputTokens: 0, byMinion: {} };
    }
  }

  private saveUsage() {
    const tmp = USAGE_PATH + ".tmp";
    try {
      writeFileSync(tmp, JSON.stringify(this.usage, null, 2));
      renameSync(tmp, USAGE_PATH);
    } catch (err) {
      console.error("[claude] Failed to save usage:", err);
    }
  }

  async runPrompt(
    minionId: string,
    prompt: string,
    workdir: string,
    options?: RunOptions
  ): Promise<string> {
    const MAX_QUEUE = 10;
    const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 min idle = timeout (resets on activity)

    // Reuse taskId from options (when dequeuing) or generate a fresh one
    const taskId = options?._taskId || `task-${minionId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // If minion is already working, queue the task
    if (this.sessions.has(minionId)) {
      const queue = this.queues.get(minionId) || [];
      if (queue.length >= MAX_QUEUE) {
        this.emit("chat", {
          minionId,
          taskId,
          message: { id: `queue-full-${Date.now()}`, minionId, role: "assistant", content: "Queue full (max 10). Wait for current tasks to finish.", timestamp: Date.now() },
        });
        return taskId;
      }
      queue.push({ minionId, prompt, workdir, taskId, options: { ...options, _taskId: taskId } });
      this.queues.set(minionId, queue);
      const queueLen = queue.length;
      console.log(`[claude] ${minionId} busy, queued task (${queueLen} in queue)`);
      this.emit("queue", { minionId, queueLength: queueLen });
      // Notify user about queued task
      this.emit("chat", {
        minionId,
        taskId,
        message: {
          id: `queue-${minionId}-${Date.now()}`,
          minionId,
          role: "assistant",
          content: `_(Task queued — ${queueLen} pending)_`,
          timestamp: Date.now(),
        },
      });
      return taskId;
    }

    const allowedTools = options?.allowedTools || "Read,Edit,Bash,Glob,Grep,Write";
    const maxTurns = options?.maxTurns || 50;

    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      allowedTools,
      "--max-turns",
      String(maxTurns),
    ];

    // Model selection per minion
    if (options?.model) {
      args.push("--model", options.model);
    }

    // Inject character personality via system prompt
    if (options?.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }

    // Resume previous session for this minion (memory/context persistence)
    const lastSession = this.lastSessionIds.get(minionId);
    if (lastSession) {
      args.push("--resume", lastSession);
    }

    console.log(`[claude] spawning for ${minionId}: claude ${args.join(" ").slice(0, 120)}...`);

    // Clean env: remove parent Claude Code vars that interfere with subprocess
    const cleanEnv = { ...process.env, ...(options?.env || {}) };
    delete cleanEnv.CLAUDECODE;
    delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

    const proc = spawn("claude", args, {
      cwd: workdir,
      env: cleanEnv,
      stdio: ["ignore", "pipe", "pipe"],  // stdin=ignore fixes the 3s warning
    });

    const session: ClaudeSession = {
      process: proc, minionId, taskId, messageCounter: 0, lastActivity: Date.now(),
      workdir, options, originalPrompt: prompt, loopInterruptCount: 0,
    };
    this.sessions.set(minionId, session);

    // Start execution trace
    this.traces.startTrace(minionId, prompt);

    // Init task progress — extract title from first line of prompt
    const taskTitle = prompt.split("\n")[0].slice(0, 100);
    this.taskProgress.set(minionId, {
      minionId,
      title: taskTitle,
      steps: [],
      startedAt: Date.now(),
    });
    this.emit("task:start", { minionId, title: taskTitle });
    this.emit("status", { minionId, status: "working" });

    // Idle timeout — resets on every activity
    const resetIdleTimeout = () => {
      session.lastActivity = Date.now();
      if (session.idleTimeout) clearTimeout(session.idleTimeout);
      session.idleTimeout = setTimeout(() => {
        if (this.sessions.has(minionId)) {
          const idleSec = Math.round((Date.now() - session.lastActivity) / 1000);
          console.log(`[claude] ${minionId} idle timeout (${idleSec}s no activity)`);
          this.traces.addStep(minionId, { type: "error", content: `Idle timeout (${idleSec}s no activity)` });
          this.traces.completeTrace(minionId, "timeout");
          this.emitChat(minionId, session, {
            role: "assistant",
            content: `Idle timeout — no activity for ${Math.round(IDLE_TIMEOUT / 60000)} minutes. Stopping.`,
          });
          // emit done with taskId so handlers can clean up properly
          this.emit("done", { minionId, taskId: session.taskId, code: null });
          this.stop(minionId);
        }
      }, IDLE_TIMEOUT);
    };
    resetIdleTimeout();

    let buffer = "";
    let currentAssistantText = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      resetIdleTimeout(); // Activity detected — reset idle timer

      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this.handleStreamEvent(minionId, event, session);
        } catch {
          // Raw text output
          currentAssistantText += line + "\n";
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      resetIdleTimeout(); // stderr activity = Claude is processing, reset timer
      const text = chunk.toString();
      if (!text.includes("Debugger") && !text.includes("ExperimentalWarning")) {
        console.log(`[claude:${minionId}:stderr] ${text.trim()}`);
      }
    });

    proc.on("close", (code) => {
      if (session.idleTimeout) clearTimeout(session.idleTimeout);
      // Flush any remaining assistant text
      if (currentAssistantText.trim()) {
        this.emitChat(minionId, session, {
          role: "assistant",
          content: currentAssistantText.trim(),
        });
        currentAssistantText = "";
      }

      // Save session ID for future resume (memory persistence)
      if (session.sessionId) {
        this.lastSessionIds.set(minionId, session.sessionId);
        console.log(`[claude] ${minionId} session saved: ${session.sessionId}`);
      }

      console.log(`[claude] ${minionId} exited with code ${code}`);
      const trace = this.traces.completeTrace(minionId, code === 0 ? "completed" : "failed");
      this.sessions.delete(minionId);

      // Finalize task progress
      const progress = this.taskProgress.get(minionId);
      if (progress) {
        const lastStep = progress.steps.filter((s: TaskStep) => s.status === "in_progress").pop();
        if (lastStep) lastStep.status = code === 0 ? "completed" : "failed";
        this.emit("task:done", { minionId, progress, code });
        this.taskProgress.delete(minionId);
      }

      this.emit("done", { minionId, taskId, code, traceId: trace?.id });

      // Process next queued task or go idle
      if (!this.processNextInQueue(minionId)) {
        this.emit("status", { minionId, status: "idle" });
      }
    });

    proc.on("error", (err) => {
      console.error(`[claude] ${minionId} error:`, err.message);
      this.traces.addStep(minionId, { type: "error", content: err.message });
      this.traces.completeTrace(minionId, "failed");
      this.emitChat(minionId, session, {
        role: "assistant",
        content: `Error: ${err.message}`,
      });
      this.emit("status", { minionId, status: "error" });
      this.sessions.delete(minionId);
    });

    return taskId;
  }

  private handleStreamEvent(minionId: string, event: any, session: ClaudeSession) {
    // Handle streaming deltas for incremental text display
    if (event.type === "content_block_start") {
      // Start a new streaming message
      session.messageCounter++;
      session.currentStreamId = `${minionId}-${session.messageCounter}-${Date.now()}`;
      session.currentStreamText = "";

      if (event.content_block?.type === "text") {
        // Create initial empty message
        this.emit("chat", {
          minionId,
          taskId: session.taskId,
          message: {
            id: session.currentStreamId,
            minionId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
          },
        });
      }
    } else if (event.type === "content_block_delta" && event.delta?.text) {
      // Append delta to current stream
      session.currentStreamText = (session.currentStreamText || "") + event.delta.text;
      if (session.currentStreamId) {
        this.emit("chat:delta", {
          minionId,
          taskId: session.taskId,
          messageId: session.currentStreamId,
          content: session.currentStreamText,
        });
      }
    } else if (event.type === "content_block_stop") {
      // Log completed text as reasoning step
      if (session.currentStreamText?.trim()) {
        this.traces.addStep(minionId, {
          type: "reasoning",
          content: session.currentStreamText.slice(0, 500),
        });
      }
      session.currentStreamId = undefined;
      session.currentStreamText = undefined;
    } else if (event.type === "assistant" && event.message) {
      // Full message event — only process if we weren't streaming (fallback)
      if (!session.currentStreamId) {
        const content = event.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text?.trim()) {
              this.emitChat(minionId, session, {
                role: "assistant",
                content: block.text,
              });
            } else if (block.type === "tool_use") {
              // Log tool call to trace
              this.traces.addStep(minionId, {
                type: "tool_call",
                content: JSON.stringify(block.input).slice(0, 300),
                toolName: block.name,
                toolInput: block.input,
              });

              // Track as task step
              this.addTaskStep(minionId, block.name, block.input);

              // Loop detection
              const repeatCount = this.traces.checkToolLoop(minionId, block.name, JSON.stringify(block.input).slice(0, 100));
              if (repeatCount >= 5) {
                this.traces.addStep(minionId, { type: "error", content: `Loop detected (${repeatCount}x): ${block.name}` });

                if (session.loopInterruptCount >= 2) {
                  // Already interrupted twice for loop — hard stop to prevent infinite cycle
                  this.emitChat(minionId, session, {
                    role: "assistant",
                    content: `Loop tidak bisa diselesaikan setelah ${session.loopInterruptCount} percobaan recovery. Stopping.`,
                  });
                  this.stop(minionId);
                  return;
                }

                // Interrupt with structured thinking prompt — force reflection before retrying
                session.loopInterruptCount++;
                this.emitChat(minionId, session, {
                  role: "assistant",
                  content: `Loop terdeteksi (${repeatCount}x "${block.name}"). Masuk thinking mode untuk cari approach berbeda...`,
                });

                const thinkingPrompt = `[LOOP RECOVERY — THINKING MODE]

Lo tadi terjebak loop: tool "${block.name}" dipanggil ${repeatCount}x berturut-turut dengan input yang sama.

Sebelum lanjut, lakukan structured thinking dulu:

## 1. Diagnosa
- Kenapa loop ini terjadi? Apa yang lo harapkan tapi tidak terjadi?
- Apakah tool "${block.name}" memang tidak cocok untuk step ini?

## 2. Goal sesungguhnya
- Apa hasil akhir yang ingin dicapai dari task ini?
- Apakah lo sudah terlalu fokus ke satu cara sampai lupa goalnya?

## 3. Alternatif approach
- Sebutkan 2-3 cara berbeda yang bisa mencapai goal yang sama
- Pilih yang paling efisien dan langsung

## 4. Eksekusi
- Jalankan approach yang dipilih, jangan ulangi yang sudah gagal
- Kalau semua approach tidak memungkinkan, jelaskan kenapa dan minta bantuan user

Mulai dengan menulis hasil thinking lo di atas, lalu langsung eksekusi approach baru.`;

                this.interrupt(minionId, thinkingPrompt);
                return;
              } else if (repeatCount >= 3) {
                this.traces.addStep(minionId, { type: "system", content: `Loop warning: ${repeatCount}x same tool call pattern (${block.name})` });
              }

              this.emitChat(minionId, session, {
                role: "tool",
                content: JSON.stringify(block.input),
                toolName: block.name,
              });
            }
          }
        }
      }
    } else if (event.type === "result") {
      if (event.session_id) {
        session.sessionId = event.session_id;
      }
      // Track token usage (global + per-trace)
      if (event.usage) {
        const input = event.usage.input_tokens || 0;
        const output = event.usage.output_tokens || 0;
        this.traces.updateUsage(minionId, input, output);
        this.usage.totalInputTokens += input;
        this.usage.totalOutputTokens += output;
        if (!this.usage.byMinion[minionId]) {
          this.usage.byMinion[minionId] = { inputTokens: 0, outputTokens: 0, prompts: 0 };
        }
        this.usage.byMinion[minionId].inputTokens += input;
        this.usage.byMinion[minionId].outputTokens += output;
        this.usage.byMinion[minionId].prompts++;
        this.saveUsage();
      }
    }
  }

  private emitChat(
    minionId: string,
    session: ClaudeSession,
    msg: { role: "assistant" | "tool"; content: string; toolName?: string }
  ) {
    session.messageCounter++;
    const message: ChatMessage = {
      id: `${minionId}-${session.messageCounter}-${Date.now()}`,
      minionId,
      role: msg.role,
      content: msg.content,
      timestamp: Date.now(),
      toolName: msg.toolName,
    };
    this.emit("chat", { minionId, taskId: session.taskId, message });
  }

  getUsageStats(): UsageStats {
    return this.usage;
  }

  async interrupt(minionId: string, message: string): Promise<boolean> {
    const session = this.sessions.get(minionId);
    if (!session) return false;

    // Capture what agent was doing
    const progress = this.taskProgress.get(minionId);
    const lastSteps = progress?.steps.slice(-5) || [];
    const taskTitle = progress?.title || session.originalPrompt.slice(0, 80);
    const savedWorkdir = session.workdir;
    const savedOptions = session.options;

    const contextSummary = lastSteps
      .map((s: TaskStep) => `${s.status === "completed" ? "✅" : "🔄"} ${s.summary}`)
      .join("\n");

    console.log(`[claude] ${minionId} INTERRUPTED by user`);

    // Stop current process — session ID auto-saved on close via proc.on("close")
    // Use SIGTERM directly on process, don't clear queue
    const proc = session.process;
    if (session.idleTimeout) clearTimeout(session.idleTimeout);
    this.sessions.delete(minionId);
    this.taskProgress.delete(minionId);
    proc.kill("SIGTERM");

    // Wait for process cleanup
    await new Promise((r) => setTimeout(r, 800));

    // Build interrupt prompt with full context
    const interruptPrompt = `[INTERRUPT dari user]

Lo tadi lagi ngerjain: "${taskTitle}"
Progress terakhir:
${contextSummary || "(baru mulai)"}

User bilang: ${message}

Instruksi:
1. Respond ke interrupt user ini DULU — acknowledge apa yang dia bilang
2. Kalo user kasih info baru atau perubahan, adjust approach lo
3. Kalo user tanya sesuatu, jawab langsung
4. Kalo user bilang cancel/stop/ga jadi, berhenti dan konfirmasi
5. Setelah respond ke interrupt, LANJUTKAN task "${taskTitle}" dengan context/perubahan baru dari user`;

    // Emit interrupt event
    this.emit("interrupt", { minionId, message, taskTitle });

    // Resume session with interrupt prompt (runPrompt uses --resume with lastSessionId)
    this.runPrompt(minionId, interruptPrompt, savedWorkdir, savedOptions);
    return true;
  }

  stop(minionId: string) {
    // Clear queue
    this.queues.delete(minionId);

    const session = this.sessions.get(minionId);
    if (session) {
      console.log(`[claude] killing ${minionId}`);
      session.process.kill("SIGTERM");
      this.sessions.delete(minionId);
      this.emit("status", { minionId, status: "idle" });
    }
  }

  private processNextInQueue(minionId: string): boolean {
    const queue = this.queues.get(minionId);
    if (!queue || queue.length === 0) return false;

    const next = queue.shift()!;
    if (queue.length === 0) this.queues.delete(minionId);

    console.log(`[claude] ${minionId} processing next queued task (${queue.length} remaining)`);
    this.runPrompt(next.minionId, next.prompt, next.workdir, next.options);
    return true;
  }

  getQueueLength(minionId: string): number {
    return this.queues.get(minionId)?.length || 0;
  }

  stopAll() {
    for (const [minionId] of this.sessions) {
      this.stop(minionId);
    }
  }

  getStatus(minionId: string): "idle" | "working" {
    return this.sessions.has(minionId) ? "working" : "idle";
  }

  // --- Task Progress Tracking ---

  private addTaskStep(minionId: string, toolName: string, toolInput: any) {
    const progress = this.taskProgress.get(minionId);
    if (!progress) return;

    // Mark previous in_progress step as completed
    const prev = progress.steps.filter((s: TaskStep) => s.status === "in_progress").pop();
    if (prev) prev.status = "completed";

    // Generate human-readable summary from tool call
    const summary = this.summarizeToolCall(toolName, toolInput);
    const step: TaskStep = {
      id: `step-${Date.now()}-${progress.steps.length}`,
      minionId,
      summary,
      status: "in_progress",
      toolName,
      detail: JSON.stringify(toolInput).slice(0, 200),
      timestamp: Date.now(),
    };

    progress.steps.push(step);

    // Emit for real-time UI
    this.emit("task:step", { minionId, step, progress });
  }

  private summarizeToolCall(toolName: string, input: any): string {
    try {
      switch (toolName) {
        case "Read":
          return `Reading ${input.file_path?.split("/").pop() || "file"}`;
        case "Edit":
          return `Editing ${input.file_path?.split("/").pop() || "file"}`;
        case "Write":
          return `Writing ${input.file_path?.split("/").pop() || "file"}`;
        case "Bash":
          const cmd = (input.command || "").slice(0, 60);
          return `Running: ${cmd}${(input.command || "").length > 60 ? "..." : ""}`;
        case "Glob":
          return `Searching files: ${input.pattern || ""}`;
        case "Grep":
          return `Searching for: ${(input.pattern || "").slice(0, 40)}`;
        case "WebSearch":
          return `Searching web: ${(input.query || "").slice(0, 40)}`;
        case "WebFetch":
          return `Fetching URL`;
        case "LSP":
          return `Code analysis (LSP)`;
        default:
          return `${toolName}`;
      }
    } catch {
      return toolName;
    }
  }

  getTaskProgress(minionId: string): TaskProgress | null {
    return this.taskProgress.get(minionId) || null;
  }

  getAllTaskProgress(): TaskProgress[] {
    return Array.from(this.taskProgress.values());
  }

  getQueuedTasks(minionId: string): QueuedTask[] {
    return this.queues.get(minionId) || [];
  }

  getAllQueues(): { minionId: string; queue: QueuedTask[] }[] {
    return Array.from(this.queues.entries()).map(([minionId, queue]) => ({ minionId, queue }));
  }
}
