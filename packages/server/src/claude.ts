import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { TraceStore } from "./execution-trace.js";

interface ChatMessage {
  id: string;
  minionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
}

interface ClaudeSession {
  process: ChildProcess;
  minionId: string;
  sessionId?: string;
  messageCounter: number;
  currentStreamId?: string;
  currentStreamText?: string;
}

interface QueuedTask {
  minionId: string;
  prompt: string;
  workdir: string;
  options?: {
    systemPrompt?: string;
    allowedTools?: string;
    maxTurns?: number;
    model?: string;
    env?: Record<string, string>;
  };
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
  private usage: UsageStats = { totalInputTokens: 0, totalOutputTokens: 0, byMinion: {} };
  public traces = new TraceStore();

  async runPrompt(
    minionId: string,
    prompt: string,
    workdir: string,
    options?: {
      systemPrompt?: string;
      allowedTools?: string;
      maxTurns?: number;
      model?: string;
      env?: Record<string, string>;
    }
  ) {
    const MAX_QUEUE = 10;
    const PROCESS_TIMEOUT = 10 * 60 * 1000; // 10 minutes

    // If minion is already working, queue the task
    if (this.sessions.has(minionId)) {
      const queue = this.queues.get(minionId) || [];
      if (queue.length >= MAX_QUEUE) {
        this.emit("chat", {
          minionId,
          message: { id: `queue-full-${Date.now()}`, minionId, role: "assistant", content: "Queue full (max 10). Wait for current tasks to finish.", timestamp: Date.now() },
        });
        return;
      }
      queue.push({ minionId, prompt, workdir, options });
      this.queues.set(minionId, queue);
      const queueLen = queue.length;
      console.log(`[claude] ${minionId} busy, queued task (${queueLen} in queue)`);
      this.emit("queue", { minionId, queueLength: queueLen });
      // Notify user about queued task
      this.emit("chat", {
        minionId,
        message: {
          id: `queue-${minionId}-${Date.now()}`,
          minionId,
          role: "assistant",
          content: `_(Task queued — ${queueLen} pending)_`,
          timestamp: Date.now(),
        },
      });
      return;
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

    const session: ClaudeSession = { process: proc, minionId, messageCounter: 0 };
    this.sessions.set(minionId, session);

    // Start execution trace
    this.traces.startTrace(minionId, prompt);

    this.emit("status", { minionId, status: "working" });

    // Process timeout
    const timeout = setTimeout(() => {
      if (this.sessions.has(minionId)) {
        console.log(`[claude] ${minionId} timeout after 10 minutes`);
        this.traces.addStep(minionId, { type: "error", content: "Process timeout (10 minutes)" });
        this.traces.completeTrace(minionId, "timeout");
        this.emitChat(minionId, session, {
          role: "assistant",
          content: "Process timeout (10 minutes). Stopping.",
        });
        this.stop(minionId);
      }
    }, PROCESS_TIMEOUT);

    let buffer = "";
    let currentAssistantText = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
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
      const text = chunk.toString();
      if (!text.includes("Debugger") && !text.includes("ExperimentalWarning")) {
        console.log(`[claude:${minionId}:stderr] ${text.trim()}`);
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
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
      this.emit("done", { minionId, code, traceId: trace?.id });

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

              // Loop detection
              const repeatCount = this.traces.checkToolLoop(minionId, block.name, JSON.stringify(block.input).slice(0, 100));
              if (repeatCount >= 5) {
                this.emitChat(minionId, session, {
                  role: "assistant",
                  content: "Loop detected (5x same operation). Stopping.",
                });
                this.traces.addStep(minionId, { type: "error", content: "Hard stop: loop detected (5x)" });
                this.stop(minionId);
                return;
              } else if (repeatCount >= 3) {
                this.traces.addStep(minionId, { type: "system", content: "Loop warning: 3x same tool call pattern" });
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
    this.emit("chat", { minionId, message });
  }

  getUsageStats(): UsageStats {
    return this.usage;
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
}
