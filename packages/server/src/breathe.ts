import * as cron from "node-cron";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "fs";
import { resolve } from "path";
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

export class BreathEngine {
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
    this.claude = claude;
    this.chatStore = chatStore;
    this.memoryStore = memoryStore;
    this.configStore = configStore;

    // Ensure directories exist
    mkdirSync(BREATHS_DIR, { recursive: true });
    mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }

  start(schedule = "*/10 * * * *") {
    this.job = cron.schedule(schedule, () => this.breathe());
    logger.info({ schedule }, "Breath engine started — Semar will reflect periodically");
  }

  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info("Breath engine stopped");
    }
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
    logger.info({ breathId, breathNumber: this.breathCount }, "Semar inhales...");

    try {
      // Build reflection context
      const context = this.buildReflectionContext();
      const breathPrompt = this.buildBreathPrompt(context);

      // Run reflection via Claude CLI (using Semar)
      const semarConfig = this.configStore.getMinion("semar");
      if (!semarConfig) {
        throw new Error("Semar config not found");
      }

      const semarSoul = this.configStore.loadSystemPrompt(semarConfig);
      const workdir = resolve(import.meta.dirname, "..");

      // Run as Semar with breath prompt
      await new Promise<void>((resolvePromise, reject) => {
        const timeout = setTimeout(() => {
          this.claude.stop("semar");
          reject(new Error("Breath timeout (5 min)"));
        }, 5 * 60 * 1000);

        const doneHandler = (data: any) => {
          if (data.minionId === "semar") {
            clearTimeout(timeout);
            this.claude.removeListener("done", doneHandler);
            resolvePromise();
          }
        };

        this.claude.on("done", doneHandler);

        this.claude.runPrompt("semar", breathPrompt, workdir, {
          systemPrompt: semarSoul || undefined,
          allowedTools: "Read,Bash,Glob,Grep,Write",
          maxTurns: 20,
        });
      });

      const log = this.saveBreathLog(breathId, startTime, "completed");
      logger.info(
        { breathId, durationMs: Date.now() - startTime },
        "Semar exhales. Breath complete."
      );
      return log;
    } catch (err: any) {
      const log = this.saveBreathLog(breathId, startTime, "failed", err.message);
      logger.error({ breathId, error: err.message }, "Breath failed");
      return log;
    } finally {
      this.breathing = false;
    }
  }

  private buildReflectionContext(): {
    recentChats: string;
    memories: string;
    knowledgeInventory: string;
    nextBreathQuestions: string;
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

    return { recentChats, memories, knowledgeInventory, nextBreathQuestions };
  }

  private buildBreathPrompt(context: {
    recentChats: string;
    memories: string;
    knowledgeInventory: string;
    nextBreathQuestions: string;
  }): string {
    // Load breath.md template
    let template: string;
    try {
      template = readFileSync(BREATH_SOUL, "utf-8");
    } catch {
      template = "Renungkan semua konteks berikut dan simpan insight ke data/knowledge/";
    }

    // Replace placeholders
    return template
      .replace("{{recent_chats}}", context.recentChats || "(kosong)")
      .replace("{{memories}}", context.memories || "(kosong)")
      .replace("{{knowledge_inventory}}", context.knowledgeInventory || "(kosong)")
      .replace("{{next_breath_questions}}", context.nextBreathQuestions || "(kosong)");
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
