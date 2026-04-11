import * as cron from "node-cron";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";
import { EventEmitter } from "events";
import { ClaudeManager } from "./claude.js";
import { ChatStore } from "./chat-store.js";
import { MemoryStore } from "./memory.js";
import { ConfigStore } from "./config-store.js";
import { logger } from "./logger.js";

interface BreathLog {
  id: string;
  timestamp: number;
  durationMs: number;
  status: "completed" | "failed" | "skipped";
  reason?: string;
  tokenUsage?: { input: number; output: number };
}

const BREATHS_DIR = resolve(import.meta.dirname, "../data/breaths");
const KNOWLEDGE_DIR = resolve(import.meta.dirname, "../data/knowledge");
const BREATH_SOUL = resolve(import.meta.dirname, "../souls/breath.md");

// Parallel breath soul templates (one per agent role)
const BREATH_SOULS: Record<string, string> = {
  semar: resolve(import.meta.dirname, "../souls/breath-semar.md"),
  petruk: resolve(import.meta.dirname, "../souls/breath-petruk.md"),
  bagong: resolve(import.meta.dirname, "../souls/breath-bagong.md"),
  gareng: resolve(import.meta.dirname, "../souls/breath-gareng.md"),
};

const BREATH_SCHEDULE = "0 */3 * * *";

export class BreathEngine extends EventEmitter {
  private job: cron.ScheduledTask | null = null;
  private claude: ClaudeManager;
  private chatStore: ChatStore;
  private memoryStore: MemoryStore;
  private configStore: ConfigStore;
  private breathing = false;
  private breathCount = 0;

  constructor(
    claude: ClaudeManager,
    chatStore: ChatStore,
    memoryStore: MemoryStore,
    configStore: ConfigStore
  ) {
    super();
    this.claude = claude;
    this.chatStore = chatStore;
    this.memoryStore = memoryStore;
    this.configStore = configStore;

    // Ensure directories exist
    mkdirSync(BREATHS_DIR, { recursive: true });
    mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  start() {
    this.job = cron.schedule(BREATH_SCHEDULE, () => this.breathe());
    logger.info({ schedule: BREATH_SCHEDULE }, "Breath engine started — Semar will reflect every 3 hours");
  }

  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info("Breath engine stopped");
    }
  }

  /** Get current breath engine status */
  getStatus() {
    return {
      schedule: BREATH_SCHEDULE,
      breathing: this.breathing,
      breathCount: this.breathCount,
    };
  }

  /** Trigger a manual breath cycle */
  async triggerBreath(): Promise<BreathLog> {
    return this.breathe();
  }

  /** Get recent breath logs */
  getRecentBreaths(limit = 20): BreathLog[] {
    try {
      const files = readdirSync(BREATHS_DIR)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, limit);

      return files.map((f) => {
        const content = readFileSync(resolve(BREATHS_DIR, f), "utf-8");
        return JSON.parse(content) as BreathLog;
      });
    } catch {
      return [];
    }
  }

  getBreathById(id: string): BreathLog | null {
    try {
      const path = resolve(BREATHS_DIR, `${id}.json`);
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  }

  private async breathe(): Promise<BreathLog> {
    const breathId = `breath-${Date.now()}`;
    const startTime = Date.now();

    // Skip if already breathing
    if (this.breathing) {
      const log = this.saveBreathLog(breathId, startTime, "skipped", "Already breathing");
      return log;
    }

    // Skip if any minion is busy (don't compete for resources)
    const minions = this.configStore.getMinions();
    const busyMinion = minions.find((m) => this.claude.getStatus(m.id) === "working");
    if (busyMinion) {
      const log = this.saveBreathLog(breathId, startTime, "skipped", `${busyMinion.name} is busy`);
      logger.debug({ busyMinion: busyMinion.id }, "Breath skipped — minion busy");
      return log;
    }

    this.breathing = true;
    this.breathCount++;
    logger.info({ breathId, breathNumber: this.breathCount }, "Parallel breath begins — Semar, Petruk, Bagong inhale together...");

    const breathStartTime = Date.now();

    try {
      const context = this.buildReflectionContext();
      const workdir = resolve(import.meta.dirname, "..");

      // Phase 1: Run 3 agents in parallel
      const [semarResult, petrukResult, bagongResult] = await Promise.allSettled([
        this.runMinionBreath("semar", context, workdir),
        this.runMinionBreath("petruk", context, workdir),
        this.runMinionBreath("bagong", context, workdir),
      ]);

      const phase1Errors = [semarResult, petrukResult, bagongResult]
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason?.message || "unknown")
        .join(", ");

      if (phase1Errors) {
        logger.warn({ breathId, phase1Errors }, "Some breath agents had errors in phase 1");
      }

      // Phase 2: Gareng verifies output of phase 1
      logger.info({ breathId }, "Phase 1 complete. Gareng now verifies...");
      await this.runMinionBreath("gareng", context, workdir).catch((err) => {
        logger.warn({ breathId, err: err.message }, "Gareng verification had an error — continuing");
      });

      const log = this.saveBreathLog(breathId, startTime, "completed");
      logger.info(
        { breathId, durationMs: Date.now() - startTime },
        "Parallel breath complete. All agents exhale."
      );

      // Emit new proposals added during this breath cycle
      const newProposals = this.getProposalsSince(breathStartTime);
      if (newProposals.length > 0) {
        logger.info({ breathId, count: newProposals.length }, "New proposals from breath — notifying");
        this.emit("breath:proposals", newProposals);
      }

      return log;
    } catch (err: any) {
      const log = this.saveBreathLog(breathId, startTime, "failed", err.message);
      logger.error({ breathId, error: err.message }, "Breath failed");
      return log;
    } finally {
      this.breathing = false;
    }
  }

  /** Run a single minion's breath task using its dedicated soul template */
  private runMinionBreath(
    minionId: string,
    context: ReturnType<BreathEngine["buildReflectionContext"]>,
    workdir: string
  ): Promise<void> {
    return new Promise<void>((resolvePromise, reject) => {
      const minionConfig = this.configStore.getMinion(minionId);
      if (!minionConfig) {
        reject(new Error(`${minionId} config not found`));
        return;
      }

      const soulPrompt = this.configStore.loadSystemPrompt(minionConfig);
      const breathPrompt = this.buildBreathPromptFor(minionId, context);

      const TIMEOUT_MS = 5 * 60 * 1000;
      const timeout = setTimeout(() => {
        this.claude.stop(minionId);
        reject(new Error(`${minionId} breath timeout (5 min)`));
      }, TIMEOUT_MS);

      const doneHandler = (data: any) => {
        if (data.minionId === minionId) {
          clearTimeout(timeout);
          this.claude.removeListener("done", doneHandler);
          logger.info({ minionId }, `${minionId} breath done`);
          resolvePromise();
        }
      };

      this.claude.on("done", doneHandler);

      this.claude.runPrompt(minionId, breathPrompt, workdir, {
        systemPrompt: soulPrompt || undefined,
        allowedTools: "Read,Bash,Glob,Grep,Write,WebFetch,WebSearch",
        maxTurns: 15,
      });

      logger.info({ minionId }, `${minionId} breath started`);
    });
  }

  /** Build a breath prompt for a specific agent using its dedicated soul template */
  private buildBreathPromptFor(
    minionId: string,
    context: ReturnType<BreathEngine["buildReflectionContext"]>
  ): string {
    const soulPath = BREATH_SOULS[minionId];
    let template: string;

    try {
      template = readFileSync(soulPath, "utf-8");
    } catch {
      // Fallback to generic breath.md if agent-specific not found
      try {
        template = readFileSync(BREATH_SOUL, "utf-8");
      } catch {
        template = "Renungkan semua konteks berikut dan simpan insight ke data/knowledge/";
      }
    }

    // Build recent proposals context (for Gareng verification)
    const recentProposals = this.buildRecentProposalsContext();

    return template
      .replace("{{recent_chats}}", context.recentChats || "(kosong)")
      .replace("{{execution_traces}}", context.executionTraces || "(kosong)")
      .replace("{{memories}}", context.memories || "(kosong)")
      .replace("{{knowledge_inventory}}", context.knowledgeInventory || "(kosong)")
      .replace("{{pending_proposals}}", context.pendingProposals || "(kosong)")
      .replace("{{next_breath_questions}}", context.nextBreathQuestions || "(kosong)")
      .replace("{{recent_proposals}}", recentProposals || "(belum ada)");
  }

  /** Build context showing proposals added in the last 30 minutes (for Gareng verification) */
  private buildRecentProposalsContext(): string {
    try {
      const path = resolve(import.meta.dirname, "../data/proposals.json");
      if (!existsSync(path)) return "Belum ada proposals.";

      const proposals = JSON.parse(readFileSync(path, "utf-8"));
      const cutoff = Date.now() - 30 * 60 * 1000; // last 30 minutes

      const recent = proposals.filter((p: any) => {
        const createdAt = new Date(p.createdAt || 0).getTime();
        return createdAt > cutoff;
      });

      if (recent.length === 0) return "Belum ada proposals yang ditambahkan dalam 30 menit terakhir.";

      return recent
        .map((p: any) => `- [${p.type}/${p.priority || "?"}] ${p.title}: ${(p.description || "").slice(0, 100)}`)
        .join("\n");
    } catch {
      return "Gagal baca proposals.";
    }
  }

  // --- Proposals ---

  /** Get proposals created after a given timestamp (ms) — for post-breath notification */
  getProposalsSince(sinceMs: number): any[] {
    try {
      const path = resolve(import.meta.dirname, "../data/proposals.json");
      if (!existsSync(path)) return [];
      const proposals = JSON.parse(readFileSync(path, "utf-8"));
      return proposals.filter((p: any) => {
        if (!p.createdAt || p.id === "init") return false;
        return new Date(p.createdAt).getTime() >= sinceMs;
      });
    } catch {
      return [];
    }
  }

  getProposals(): any[] {
    try {
      const path = resolve(import.meta.dirname, "../data/proposals.json");
      if (!existsSync(path)) return [];
      const raw = readFileSync(path, "utf-8");
      const proposals = JSON.parse(raw);
      return Array.isArray(proposals) ? proposals.filter((p: any) => p.status !== "done" && p.id !== "init") : [];
    } catch {
      return [];
    }
  }

  getPendingProposals(): any[] {
    return this.getProposals().filter(
      (p: any) => p.status === "pending" && (p.type === "improvement" || !p.type)
    );
  }

  /** Approve + auto-execute a proposal via Semar. Marks completed when done, emits events. */
  executeProposal(proposalId: string): boolean {
    const proposals = this.getProposals();
    const proposal = proposals.find((p: any) => p.id === proposalId);
    if (!proposal) return false;

    this.updateProposalStatus(proposalId, "approved");

    const semarConfig = this.configStore.getMinion("semar");
    if (!semarConfig) return false;

    const systemPrompt = this.configStore.loadSystemPrompt(semarConfig);
    const knowledgeContext = this.memoryStore.buildKnowledgeContext();
    const minionProjectDir = resolve(import.meta.dirname, "..");

    const executePrompt = `[APPROVED PROPOSAL — EXECUTE]

Proposal ID: ${proposal.id}
Title: ${proposal.title}
Description: ${proposal.description || ""}
Category: ${proposal.category || "general"}
Priority: ${proposal.priority || "medium"}

Lo adalah Semar. Proposal ini udah di-approve sama user. Sekarang IMPLEMENT proposal ini.

Kerjain di project minion sendiri (working directory = root project minion).

Instruksi:
1. Pahami apa yang diminta di proposal
2. Implement perubahan yang diperlukan
3. JANGAN run \`npm run build\` atau restart — user yang handle itu
4. Setelah selesai, kasih summary perubahan yang lo buat
5. Bilang ke user: "Perubahan udah ready. Jalanin \`npm run build && pm2 restart punakawan\` untuk apply."

PENTING: Jangan modify file yang ga relevan. Fokus ke apa yang diminta proposal.`;

    const taskIdPromise = this.claude.runPrompt("semar", executePrompt, minionProjectDir, {
      systemPrompt: (systemPrompt || "") + knowledgeContext,
      allowedTools: semarConfig.allowedTools,
      maxTurns: semarConfig.maxTurns,
    });

    // Mark completed when the specific task finishes
    taskIdPromise.then((taskId) => {
      const onDone = (data: any) => {
        if (data.taskId !== taskId) return;
        this.claude.removeListener("done", onDone);
        this.updateProposalStatus(proposalId, "completed");
        this.emit("proposal:completed", { proposalId, title: proposal.title });
      };
      this.claude.on("done", onDone);
      // Cleanup if task never finishes within 30 min
      setTimeout(() => this.claude.removeListener("done", onDone), 30 * 60 * 1000).unref();
    });

    this.emit("proposal:executing", { proposalId, title: proposal.title });
    return true;
  }

  updateProposalStatus(proposalId: string, status: "approved" | "rejected" | "done" | "completed"): boolean {
    try {
      const path = resolve(import.meta.dirname, "../data/proposals.json");
      if (!existsSync(path)) return false;
      const proposals = JSON.parse(readFileSync(path, "utf-8"));
      const proposal = proposals.find((p: any) => p.id === proposalId);
      if (!proposal) return false;
      proposal.status = status;
      if (status === "approved") proposal.approvedAt = new Date().toISOString();
      if (status === "completed" || status === "done") proposal.completedAt = new Date().toISOString();
      writeFileSync(path, JSON.stringify(proposals, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  private buildReflectionContext(): {
    recentChats: string;
    memories: string;
    knowledgeInventory: string;
    nextBreathQuestions: string;
    executionTraces: string;
    pendingProposals: string;
  } {
    // Recent chats — last 10 messages from all minions
    const minionIds = ["semar", "gareng", "petruk", "bagong", "balai"];
    const allChats: { minionId: string; role: string; content: string; timestamp: number }[] = [];

    for (const id of minionIds) {
      const chats = this.chatStore.getAll(id);
      if (Array.isArray(chats)) {
        for (const msg of chats.slice(-5)) {
          if (msg.role === "user" || msg.role === "assistant") {
            allChats.push({
              minionId: id,
              role: msg.role,
              content: (msg.content || "").slice(0, 300),
              timestamp: msg.timestamp || 0,
            });
          }
        }
      }
    }

    // Sort by timestamp, take last 15
    allChats.sort((a, b) => a.timestamp - b.timestamp);
    const recentChats = allChats
      .slice(-15)
      .map((c) => `[${c.minionId}/${c.role}]: ${c.content}`)
      .join("\n\n");

    // Memories — all episodic memories from all minions
    const allMemories: string[] = [];
    for (const id of minionIds) {
      const memories = this.memoryStore.getMemories(id);
      if (Array.isArray(memories)) {
        for (const mem of memories.slice(-5)) {
          allMemories.push(`[${id}] ${mem.content} (${mem.outcome || "unknown"})`);
        }
      }
    }
    const memories = allMemories.join("\n") || "Belum ada memories.";

    // Knowledge inventory — list existing knowledge files with first line
    let knowledgeInventory = "Belum ada knowledge files.";
    try {
      const files = readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith(".md"));
      if (files.length > 0) {
        knowledgeInventory = files
          .map((f) => {
            const content = readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8");
            const firstLine = content.split("\n").find((l) => l.trim()) || "";
            const wordCount = content.split(/\s+/).length;
            return `- **${f}** (${wordCount} words): ${firstLine.replace(/^#+\s*/, "")}`;
          })
          .join("\n");
      }
    } catch {}

    // Next breath questions
    let nextBreathQuestions = "Belum ada pertanyaan dari nafas sebelumnya. Ini nafas pertama lo — explore apapun yang menarik dari konteks di atas.";
    try {
      const nextBreathPath = resolve(KNOWLEDGE_DIR, "_next-breath.md");
      if (existsSync(nextBreathPath)) {
        nextBreathQuestions = readFileSync(nextBreathPath, "utf-8");
      }
    } catch {}

    // Execution traces — last 10, summarized for performance analysis
    let executionTraces = "Belum ada execution traces.";
    try {
      const traces = this.claude.traces.getRecent(10);
      if (traces.length > 0) {
        executionTraces = traces
          .map((t) => {
            const duration = t.completedAt ? Math.round((t.completedAt - t.startedAt) / 1000) : "?";
            const toolCalls = t.steps.filter((s) => s.type === "tool_call").length;
            const tools = [...new Set(t.steps.filter((s) => s.type === "tool_call").map((s) => s.toolName))].join(", ");
            const errors = t.steps.filter((s) => s.type === "error").length;
            return `- [${t.minionId}] ${t.status} | ${duration}s | ${toolCalls} tool calls (${tools}) | ${errors} errors | tokens: ${t.tokenUsage.input}in/${t.tokenUsage.output}out | prompt: "${t.prompt.slice(0, 80)}"`;
          })
          .join("\n");
      }
    } catch {}

    // Pending proposals
    const proposals = this.getPendingProposals();
    const pendingProposals = proposals.length > 0
      ? proposals.map((p: any) => `- [${p.priority}] ${p.title}: ${(p.description || "").slice(0, 100)}`).join("\n")
      : "Belum ada proposals pending.";

    return { recentChats, memories, knowledgeInventory, nextBreathQuestions, executionTraces, pendingProposals };
  }

  private saveBreathLog(
    id: string,
    startTime: number,
    status: "completed" | "failed" | "skipped",
    reason?: string
  ): BreathLog {
    const log: BreathLog = {
      id,
      timestamp: startTime,
      durationMs: Date.now() - startTime,
      status,
      reason,
    };

    try {
      writeFileSync(resolve(BREATHS_DIR, `${id}.json`), JSON.stringify(log, null, 2));
    } catch (err: any) {
      logger.error({ err: err.message }, "Failed to save breath log");
    }

    return log;
  }
}
