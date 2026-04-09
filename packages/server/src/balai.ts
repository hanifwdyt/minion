import { ClaudeManager } from "./claude.js";
import { ChatStore } from "./chat-store.js";
import { Server } from "socket.io";

const BALAI_ID = "balai";

// Semar's delegation prompt — analyzes user request and picks the right minion
const DELEGATION_PROMPT = `Lo adalah Semar, tetua bijak Punakawan. Lo baru dapet request dari user di Balai Desa (shared channel).

Tugas lo: ANALISA request ini dan tentukan minion mana yang paling cocok buat handle.

Tim lo (dengan skill tags):
- GARENG (id: gareng) — Sang Pemikir. Skills: debugging, code-review, testing, analysis, research. Kalo butuh investigasi, analisa, atau review.
- PETRUK (id: petruk) — Sang Penghibur. Skills: frontend, ui-design, prototyping, creative-coding, feature-building. Kalo butuh bikin sesuatu yang baru atau kreatif.
- BAGONG (id: bagong) — Sang Pekerja. Skills: refactoring, cleanup, deployment, scripting, quick-fix. Kalo butuh kerjaan langsung, cepet, atau simpel.
- SEMAR (id: semar) — Diri lo sendiri. Skills: architecture, planning, mentoring, decision-making. Kalo butuh wisdom, keputusan besar, atau multi-step complex.

RESPOND HANYA dengan JSON format ini (NOTHING ELSE):

Untuk single minion:
{"delegate": "minion_id", "reason": "alasan singkat"}

Untuk task yang butuh beberapa minion secara berurutan (pipeline):
{"pipeline": [{"minion": "gareng", "task": "analyze the code"}, {"minion": "petruk", "task": "implement the fix"}, {"minion": "gareng", "task": "review the changes"}], "reason": "alasan kenapa pipeline"}

Gunakan pipeline HANYA kalo task-nya beneran butuh multiple steps dari different minions. Kebanyakan task cukup satu minion aja.

User request: `;

interface MinionConfig {
  id: string;
  name: string;
  role: string;
  soul?: string;
  color: string;
  allowedTools?: string;
  maxTurns?: number;
  workdir: string;
}

export class BalaiDesa {
  private claude: ClaudeManager;
  private chatStore: ChatStore;
  private io: Server;
  private minionConfigs: MinionConfig[];
  private loadSystemPrompt: (config: MinionConfig) => string | undefined;

  constructor(
    claude: ClaudeManager,
    chatStore: ChatStore,
    io: Server,
    minionConfigs: MinionConfig[],
    loadSystemPrompt: (config: MinionConfig) => string | undefined
  ) {
    this.claude = claude;
    this.chatStore = chatStore;
    this.io = io;
    this.minionConfigs = minionConfigs;
    this.loadSystemPrompt = loadSystemPrompt;
  }

  // Check if a prompt has @mentions and extract them
  parseMentions(prompt: string): { mentions: string[]; cleanPrompt: string } {
    const mentionRegex = /@(\w+)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(prompt)) !== null) {
      const name = match[1].toLowerCase();
      const config = this.minionConfigs.find(
        (m) => m.id === name || m.name.toLowerCase() === name
      );
      if (config) mentions.push(config.id);
    }
    const cleanPrompt = prompt.replace(/@(\w+)/g, "").trim();
    return { mentions, cleanPrompt };
  }

  // Handle a prompt sent to Balai Desa
  async handlePrompt(prompt: string, workdir: string, env?: Record<string, string>) {
    const { mentions, cleanPrompt } = this.parseMentions(prompt);

    // If specific minions are mentioned, route directly to them
    if (mentions.length > 0) {
      const targetPrompt = cleanPrompt || prompt;
      for (const minionId of mentions) {
        this.routeToMinion(minionId, targetPrompt, workdir, prompt, env);
      }
      return;
    }

    // No mentions — use Semar to delegate
    this.delegateViaSemar(prompt, workdir, env);
  }

  // Route prompt to a specific minion, with results appearing in Balai chat
  private routeToMinion(
    minionId: string,
    prompt: string,
    workdir: string,
    originalPrompt: string,
    env?: Record<string, string>
  ) {
    const config = this.minionConfigs.find((m) => m.id === minionId);
    if (!config) return;

    // Emit routing notification to balai chat
    const routeMsg = {
      id: `balai-route-${Date.now()}-${minionId}`,
      minionId: BALAI_ID,
      role: "assistant" as const,
      content: `_Routing ke **${config.name}** (${config.role})..._`,
      timestamp: Date.now(),
    };
    this.chatStore.add(BALAI_ID, routeMsg);
    this.io.emit("minion:chat", { minionId: BALAI_ID, message: routeMsg });

    // Create a wrapper that forwards minion responses to balai channel
    const balaiPrefix = `**${config.name}:** `;

    // Listen for this minion's chat events and mirror to balai
    const chatHandler = (data: any) => {
      if (data.minionId === minionId) {
        const balaiMsg = {
          ...data.message,
          id: `balai-${data.message.id}`,
          minionId: BALAI_ID,
          content:
            data.message.role === "assistant"
              ? balaiPrefix + data.message.content
              : data.message.content,
        };
        this.chatStore.add(BALAI_ID, balaiMsg);
        this.io.emit("minion:chat", { minionId: BALAI_ID, message: balaiMsg });
      }
    };

    const deltaHandler = (data: any) => {
      if (data.minionId === minionId) {
        this.io.emit("minion:chat:delta", {
          minionId: BALAI_ID,
          messageId: `balai-${data.messageId}`,
          content: balaiPrefix + data.content,
        });
      }
    };

    const doneHandler = (data: any) => {
      if (data.minionId === minionId) {
        this.claude.removeListener("chat", chatHandler);
        this.claude.removeListener("chat:delta", deltaHandler);
        this.claude.removeListener("done", doneHandler);
      }
    };

    this.claude.on("chat", chatHandler);
    this.claude.on("chat:delta", deltaHandler);
    this.claude.on("done", doneHandler);

    // Actually run the prompt on the minion
    const systemPrompt = this.loadSystemPrompt(config);
    const resolvedWorkdir = workdir;
    this.claude.runPrompt(minionId, prompt, resolvedWorkdir, {
      systemPrompt,
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      env,
    });
  }

  // Use Semar to decide which minion should handle the task
  private async delegateViaSemar(prompt: string, workdir: string, env?: Record<string, string>) {
    // Emit "thinking" status for balai
    this.io.emit("minion:status", { minionId: BALAI_ID, status: "working" });

    const thinkMsg = {
      id: `balai-think-${Date.now()}`,
      minionId: BALAI_ID,
      role: "assistant" as const,
      content: "_Semar lagi mikir siapa yang paling cocok handle ini..._",
      timestamp: Date.now(),
    };
    this.chatStore.add(BALAI_ID, thinkMsg);
    this.io.emit("minion:chat", { minionId: BALAI_ID, message: thinkMsg });

    // Quick delegation call — Semar decides who handles it
    try {
      const { spawn } = await import("child_process");

      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;
      delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

      const delegationResult = await new Promise<string>((resolve, reject) => {
        const proc = spawn(
          "claude",
          ["-p", DELEGATION_PROMPT + prompt, "--output-format", "text", "--max-turns", "1"],
          { cwd: workdir, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"] }
        );

        let output = "";
        proc.stdout?.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        proc.on("close", () => resolve(output.trim()));
        proc.on("error", reject);

        // Timeout after 15s
        setTimeout(() => {
          proc.kill("SIGTERM");
          resolve('{"delegate": "semar", "reason": "timeout"}');
        }, 15000);
      });

      // Parse delegation result — could be single delegate or pipeline
      try {
        // Extract JSON from response (might have surrounding text)
        const jsonMatch = delegationResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);

          // Pipeline response
          if (parsed.pipeline && Array.isArray(parsed.pipeline)) {
            const reason = parsed.reason || "";
            const steps = parsed.pipeline
              .filter((s: any) => this.minionConfigs.find((m) => m.id === s.minion))
              .map((s: any) => ({
                minionId: s.minion,
                task: s.task,
              }));

            if (steps.length > 0) {
              const stepNames = steps
                .map((s: any) => {
                  const cfg = this.minionConfigs.find((m) => m.id === s.minionId);
                  return cfg?.name || s.minionId;
                })
                .join(" → ");

              const pipeMsg = {
                id: `balai-pipe-${Date.now()}`,
                minionId: BALAI_ID,
                role: "assistant" as const,
                content: `_Semar: "${reason}"\nPipeline: **${stepNames}**_`,
                timestamp: Date.now(),
              };
              this.chatStore.add(BALAI_ID, pipeMsg);
              this.io.emit("minion:chat", { minionId: BALAI_ID, message: pipeMsg });

              this.runPipeline(steps, workdir);
              return;
            }
          }

          // Single delegate response
          let delegateId = parsed.delegate || "semar";
          const reason = parsed.reason || "";
          if (!this.minionConfigs.find((m) => m.id === delegateId)) {
            delegateId = "semar";
          }

          const delegateConfig = this.minionConfigs.find((m) => m.id === delegateId)!;
          const delegateMsg = {
            id: `balai-delegate-${Date.now()}`,
            minionId: BALAI_ID,
            role: "assistant" as const,
            content: `_Semar: "${reason}" → Didelegasikan ke **${delegateConfig.name}**_`,
            timestamp: Date.now(),
          };
          this.chatStore.add(BALAI_ID, delegateMsg);
          this.io.emit("minion:chat", { minionId: BALAI_ID, message: delegateMsg });

          this.routeToMinion(delegateId, prompt, workdir, prompt, env);
          return;
        }
      } catch {
        console.log(`[balai] Could not parse delegation: ${delegationResult.slice(0, 100)}`);
      }

      // Fallback: route to Semar
      this.routeToMinion("semar", prompt, workdir, prompt, env);
    } catch (err) {
      console.error("[balai] delegation error:", err);
      // Fallback: route to Semar
      this.routeToMinion("semar", prompt, workdir, prompt, env);
    }
  }

  // Run a pipeline of minion tasks sequentially with retry and context passing
  private runPipeline(
    steps: { minionId: string; task: string }[],
    workdir: string,
    stepIndex = 0,
    retryCount = 0,
    previousOutput = ""
  ) {
    if (stepIndex >= steps.length) {
      // Pipeline complete
      const doneMsg = {
        id: `balai-pipe-done-${Date.now()}`,
        minionId: BALAI_ID,
        role: "assistant" as const,
        content: `_Pipeline selesai! (${steps.length} steps)_`,
        timestamp: Date.now(),
      };
      this.chatStore.add(BALAI_ID, doneMsg);
      this.io.emit("minion:chat", { minionId: BALAI_ID, message: doneMsg });
      this.io.emit("minion:status", { minionId: BALAI_ID, status: "idle" });
      return;
    }

    const step = steps[stepIndex];
    const config = this.minionConfigs.find((m) => m.id === step.minionId);
    if (!config) {
      this.runPipeline(steps, workdir, stepIndex + 1);
      return;
    }

    // Announce step
    const stepMsg = {
      id: `balai-step-${Date.now()}-${stepIndex}`,
      minionId: BALAI_ID,
      role: "assistant" as const,
      content: `_Step ${stepIndex + 1}/${steps.length}: **${config.name}** — ${step.task}_`,
      timestamp: Date.now(),
    };
    this.chatStore.add(BALAI_ID, stepMsg);
    this.io.emit("minion:chat", { minionId: BALAI_ID, message: stepMsg });

    // Track last assistant message for context passing to next step
    let lastAssistantMessage = "";

    // Mirror responses to balai
    const balaiPrefix = `**${config.name}:** `;
    const chatHandler = (data: any) => {
      if (data.minionId === step.minionId) {
        // Capture assistant messages for context passing
        if (data.message.role === "assistant" && data.message.content) {
          lastAssistantMessage = data.message.content;
        }

        const balaiMsg = {
          ...data.message,
          id: `balai-${data.message.id}`,
          minionId: BALAI_ID,
          content:
            data.message.role === "assistant"
              ? balaiPrefix + data.message.content
              : data.message.content,
        };
        this.chatStore.add(BALAI_ID, balaiMsg);
        this.io.emit("minion:chat", { minionId: BALAI_ID, message: balaiMsg });
      }
    };

    const deltaHandler = (data: any) => {
      if (data.minionId === step.minionId) {
        // Update lastAssistantMessage with streaming content
        if (data.content) lastAssistantMessage = data.content;

        this.io.emit("minion:chat:delta", {
          minionId: BALAI_ID,
          messageId: `balai-${data.messageId}`,
          content: balaiPrefix + data.content,
        });
      }
    };

    const doneHandler = (data: any) => {
      if (data.minionId === step.minionId) {
        this.claude.removeListener("chat", chatHandler);
        this.claude.removeListener("chat:delta", deltaHandler);
        this.claude.removeListener("done", doneHandler);

        // Build context output for next step
        const stepOutput = lastAssistantMessage
          ? lastAssistantMessage.slice(0, 2000)
          : "";

        // Check if step failed (non-zero exit code)
        if (data.code !== 0 && retryCount < 1) {
          // Retry once
          const retryMsg = {
            id: `balai-retry-${Date.now()}`,
            minionId: BALAI_ID,
            role: "assistant" as const,
            content: `_Step ${stepIndex + 1} failed. Retrying..._`,
            timestamp: Date.now(),
          };
          this.chatStore.add(BALAI_ID, retryMsg);
          this.io.emit("minion:chat", { minionId: BALAI_ID, message: retryMsg });
          this.runPipeline(steps, workdir, stepIndex, retryCount + 1, previousOutput);
        } else if (data.code !== 0) {
          // Skip step after retry
          const skipMsg = {
            id: `balai-skip-${Date.now()}`,
            minionId: BALAI_ID,
            role: "assistant" as const,
            content: `_Step ${stepIndex + 1} failed after retry. Skipping..._`,
            timestamp: Date.now(),
          };
          this.chatStore.add(BALAI_ID, skipMsg);
          this.io.emit("minion:chat", { minionId: BALAI_ID, message: skipMsg });
          this.runPipeline(steps, workdir, stepIndex + 1, 0, stepOutput);
        } else {
          // Success — next step with context from this step
          this.runPipeline(steps, workdir, stepIndex + 1, 0, stepOutput);
        }
      }
    };

    this.claude.on("chat", chatHandler);
    this.claude.on("chat:delta", deltaHandler);
    this.claude.on("done", doneHandler);

    // Build task prompt with context from previous step
    let taskPrompt = step.task;
    if (previousOutput) {
      taskPrompt = `## Context dari step sebelumnya:\n${previousOutput}\n\n---\n\n## Task lo sekarang:\n${step.task}`;
    }

    // Execute this step (inherit env from process for GitLab vars)
    const systemPrompt = this.loadSystemPrompt(config);
    this.claude.runPrompt(step.minionId, taskPrompt, workdir, {
      systemPrompt,
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      env: process.env.GITLAB_TOKEN ? {
        GITLAB_HOST: process.env.GITLAB_HOST || "",
        GITLAB_TOKEN: process.env.GITLAB_TOKEN || "",
        GITLAB_API: process.env.GITLAB_API || "",
      } : undefined,
    });
  }
}
