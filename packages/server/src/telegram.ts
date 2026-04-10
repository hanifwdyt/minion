import { Bot, InlineKeyboard } from "grammy";
import { ClaudeManager } from "./claude.js";
import { ConfigStore } from "./config-store.js";
import { VPNManager } from "./vpn.js";
import { MemoryStore } from "./memory.js";

// ── Types ─────────────────────────────────────────────────────

interface ConversationState {
  chatId: number;
  minionId: string;
  stage:
    | "vpn_connecting"
    | "waiting_silverfort"
    | "waiting_plan_approval"
    | "waiting_verify";
  data: any;
  timeout: NodeJS.Timeout;
}

interface TypingSession {
  chatId: number;
  interval: NodeJS.Timeout;
}

// ── Helpers ───────────────────────────────────────────────────

/** Escape Telegram Markdown v1 special chars */
function esc(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

/** Parse RENCANA KERJA block from assistant response */
function parsePlan(text: string): { steps: string[]; found: boolean } {
  if (!text.includes("RENCANA KERJA")) return { steps: [], found: false };
  const lines = text.split("\n");
  const steps = lines
    .filter((l) => l.match(/^\[\s*\]\s+\d+\./))
    .map((l) => l.replace(/^\[\s*\]\s+\d+\.\s*/, "").trim());
  return { steps, found: steps.length > 0 };
}

/** Parse VERIFY: line from assistant response */
function parseVerify(text: string): string | null {
  const match = text.match(/VERIFY:\s*(.+?)(?:\n|$)/i);
  return match ? match[1].trim() : null;
}

/** Parse CHECKPOINT block (mid-task verify) */
function parseCheckpoint(text: string): { found: boolean; verify: string } {
  if (!text.includes("CHECKPOINT:")) return { found: false, verify: "" };
  const verify = parseVerify(text);
  return { found: !!verify, verify: verify || "" };
}

/** Strip plan/verify blocks to get the "normal" response body */
function stripMetaBlocks(text: string): string {
  return text
    .replace(/📋\s*RENCANA KERJA[\s\S]*?Boleh gue mulai.*?\n?/i, "")
    .replace(/VERIFY:\s*.+/gi, "")
    .replace(/CHECKPOINT:\s*.+/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Truncate Telegram message to safe limit */
function truncate(text: string, limit = 3900): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "\n…_(truncated)_";
}

// ── Main class ────────────────────────────────────────────────

export class TelegramBot {
  private bot: Bot | null = null;
  private claude: ClaudeManager;
  private configStore: ConfigStore;
  private vpn: VPNManager;
  private memoryStore: MemoryStore;
  private started = false;

  /** chatId → conversation state (VPN flow, plan approval, verify) */
  private conversations: Map<number, ConversationState> = new Map();

  /** minionId → chatId (which chat is this minion working for) */
  private activeTasks: Map<string, number> = new Map();

  /** chatId → typing session */
  private typingSessions: Map<number, TypingSession> = new Map();

  constructor(
    claude: ClaudeManager,
    configStore: ConfigStore,
    vpn: VPNManager,
    memoryStore: MemoryStore
  ) {
    this.claude = claude;
    this.configStore = configStore;
    this.vpn = vpn;
    this.memoryStore = memoryStore;
  }

  // ── Lifecycle ───────────────────────────────────────────────

  async start() {
    const config = this.configStore.getIntegrations().telegram;
    if (!config.enabled || !config.token) {
      console.log("[telegram] Disabled or no token configured");
      return;
    }
    try {
      this.bot = new Bot(config.token);
      this.setupVPNEvents();
      this.setupProgressEvents();
      this.setupHandlers();
      await this.bot.start();
      this.started = true;
      console.log("[telegram] Bot started");
    } catch (err: any) {
      console.error("[telegram] Failed to start:", err.message);
    }
  }

  async stop() {
    if (this.bot && this.started) {
      await this.bot.stop();
      this.started = false;
    }
  }

  // ── VPN events ──────────────────────────────────────────────

  private setupVPNEvents() {
    this.vpn.on("needs_approval", (data) => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "vpn_connecting") {
          state.stage = "waiting_silverfort";
          this.sendMsg(chatId, `${data.message}`);
        }
      }
    });

    this.vpn.on("connected", () => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "waiting_silverfort") {
          this.sendMsg(chatId, "VPN nyambung, lanjut.");
          this.clearConversation(chatId);
        }
      }
    });

    this.vpn.on("timeout", () => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "waiting_silverfort") {
          this.sendMsg(chatId, "Silverfort-nya ga di-approve kayaknya. Coba lagi nanti ya.");
          this.clearConversation(chatId);
        }
      }
    });
  }

  // ── Typing indicator ─────────────────────────────────────────

  private setupProgressEvents() {
    this.claude.on("done", (data: any) => {
      const chatId = this.activeTasks.get(data.minionId);
      if (chatId) {
        this.stopTyping(chatId);
        this.activeTasks.delete(data.minionId);
      }
    });
  }

  private startTyping(chatId: number) {
    this.stopTyping(chatId); // clear any existing
    const send = () => this.bot?.api.sendChatAction(chatId, "typing").catch(() => {});
    send();
    const interval = setInterval(send, 4000);
    this.typingSessions.set(chatId, { chatId, interval });
  }

  private stopTyping(chatId: number) {
    const session = this.typingSessions.get(chatId);
    if (session) {
      clearInterval(session.interval);
      this.typingSessions.delete(chatId);
    }
  }

  // ── Auth ─────────────────────────────────────────────────────

  private isAuthorized(ctx: any): boolean {
    const config = this.configStore.getIntegrations().telegram as any;
    const allowedUserId = config.allowedUserId;
    if (!allowedUserId) return true;
    return ctx.from?.id === allowedUserId;
  }

  private rejectUnauthorized(ctx: any): boolean {
    if (!this.isAuthorized(ctx)) {
      ctx.reply("⛔ Akses ditolak.").catch(() => {});
      return true;
    }
    return false;
  }

  // ── Utility ──────────────────────────────────────────────────

  private sendMsg(chatId: number, text: string, options?: any) {
    this.bot?.api.sendMessage(chatId, text, options).catch(() => {
      // Markdown parse failed — retry as plain text so message is never silently dropped
      if (options?.parse_mode) {
        const { parse_mode, ...rest } = options;
        this.bot?.api.sendMessage(chatId, text, Object.keys(rest).length ? rest : undefined).catch(() => {});
      }
    });
  }

  private clearConversation(chatId: number) {
    const state = this.conversations.get(chatId);
    if (state) {
      clearTimeout(state.timeout);
      this.conversations.delete(chatId);
    }
  }

  // ── Handlers ─────────────────────────────────────────────────

  private setupHandlers() {
    if (!this.bot) return;

    // /myid
    this.bot.command("myid", (ctx) => {
      ctx.reply(`Your Telegram user ID: \`${ctx.from?.id}\``, { parse_mode: "Markdown" });
    });

    // /start
    this.bot.command("start", (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const minions = this.configStore.getMinions();
      const list = minions.map((m) => `• *${m.name}* — ${m.role}`).join("\n");
      ctx.reply(
        `🎭 *PUNAKAWAN* — Agen AI Nusantara\n\n` +
        `Minions:\n${list}\n\n` +
        `Commands:\n` +
        `/ask \\<minion\\> \\<prompt\\> — Tanya minion spesifik\n` +
        `/balai \\<prompt\\> — Auto\\-delegate ke Semar\n` +
        `/status — Status semua minion\n` +
        `/stop — Hentikan task yang berjalan\n` +
        `/vpn status|connect|disconnect`,
        { parse_mode: "MarkdownV2" }
      );
    });

    // /status
    this.bot.command("status", (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const minions = this.configStore.getMinions();
      const lines = minions.map((m) => {
        const status = this.claude.getStatus(m.id);
        const icon = status === "working" ? "🟢" : "⚪";
        const progress = this.claude.getTaskProgress(m.id);
        const extra = progress ? ` — _${esc(progress.title.slice(0, 40))}_` : "";
        return `${icon} *${esc(m.name)}* — ${status}${extra}`;
      });
      ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    });

    // /stop
    this.bot.command("stop", (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const args = (ctx.message?.text || "").replace(/^\/stop\s*/, "").trim().toLowerCase();
      const minionId = args || "semar";
      const wasWorking = this.claude.getStatus(minionId) === "working";
      this.claude.stop(minionId);

      const chatId = ctx.chat?.id;
      if (chatId) {
        this.stopTyping(chatId);
        this.activeTasks.delete(minionId);
        this.clearConversation(chatId);
      }

      ctx.reply(wasWorking ? `Oke, gue stop.` : `Ga ada yang lagi berjalan.`);
    });

    // /ask <minion> <prompt>
    this.bot.command("ask", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const text = ctx.message?.text || "";
      const parts = text.replace(/^\/ask\s*/, "").trim().split(/\s+/);
      const minionName = parts[0]?.toLowerCase();
      const prompt = parts.slice(1).join(" ");

      if (!minionName || !prompt) {
        return ctx.reply("Usage: /ask <minion> <prompt>");
      }

      const config = this.configStore
        .getMinions()
        .find((m) => m.id === minionName || m.name.toLowerCase() === minionName);

      if (!config) {
        return ctx.reply(`Minion "${minionName}" tidak ditemukan. /start untuk lihat daftar.`);
      }

      this.runAndReply(ctx, config.id, prompt);
    });

    // /balai <prompt>
    this.bot.command("balai", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const prompt = (ctx.message?.text || "").replace(/^\/balai\s*/, "").trim();
      if (!prompt) return ctx.reply("Usage: /balai <prompt>");
      this.runAndReply(ctx, "semar", prompt);
    });

    // /vpn
    this.bot.command("vpn", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const args = (ctx.message?.text || "").replace(/^\/vpn\s*/, "").trim().toLowerCase();

      if (args === "status") {
        const connected = await this.vpn.isConnected();
        return ctx.reply(connected ? "🟢 VPN connected" : "⚪ VPN disconnected");
      }

      if (args === "connect" || args === "on") {
        await ctx.reply("🔄 Connecting VPN...");
        const chatId = ctx.chat?.id;
        if (chatId) {
          this.conversations.set(chatId, {
            chatId,
            minionId: "system",
            stage: "vpn_connecting",
            data: {},
            timeout: setTimeout(() => this.clearConversation(chatId), 180_000),
          });
        }
        const connected = await this.vpn.connect();
        if (chatId) this.clearConversation(chatId);
        return ctx.reply(connected ? "✅ VPN connected!" : "❌ Gagal. Approve Silverfort dulu.");
      }

      if (args === "disconnect" || args === "off") {
        await this.vpn.disconnect();
        return ctx.reply("✅ VPN disconnected");
      }

      return ctx.reply("Usage: /vpn status | /vpn connect | /vpn disconnect");
    });

    // ── Inline keyboard callbacks ─────────────────────────────

    // Plan approved → resume with "ok lanjut"
    this.bot.callbackQuery(/^plan:approve:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Oke, Semar mulai kerja!" });
      const minionId = ctx.match[1];
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      // Edit the plan message to show it was approved
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.api.sendMessage(chatId, "✅ Plan disetujui — Semar mulai eksekusi...").catch(() => {});

      this.clearConversation(chatId);
      this.runAndReply(ctx, minionId, "ok lanjut, eksekusi plan-nya semar");
    });

    // Plan stopped
    this.bot.callbackQuery(/^plan:stop:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Dibatalkan." });
      const chatId = ctx.chat?.id;
      if (chatId) this.clearConversation(chatId);
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.api.sendMessage(chatId!, "🛑 Plan dibatalkan.").catch(() => {});
    });

    // Verify OK → resume with "sudah dicek, lanjut"
    this.bot.callbackQuery(/^verify:ok:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Oke!" });
      const minionId = ctx.match[1];
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      this.clearConversation(chatId);
      this.runAndReply(ctx, minionId, "sudah dicek dan oke, lanjut ke langkah berikutnya");
    });

    // Verify problem → resume with report
    this.bot.callbackQuery(/^verify:problem:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Laporkan masalahnya." });
      const minionId = ctx.match[1];
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.api.sendMessage(chatId, "⚠️ Ceritain masalah yang lo temuin:").catch(() => {});

      this.conversations.set(chatId, {
        chatId,
        minionId,
        stage: "waiting_verify",
        data: {},
        timeout: setTimeout(() => this.clearConversation(chatId), 300_000),
      });
    });

    // ── Plain text messages ───────────────────────────────────

    this.bot.on("message:text", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const chatId = ctx.chat?.id!;
      const text = ctx.message.text;

      // Check active conversation state
      if (this.conversations.has(chatId)) {
        const state = this.conversations.get(chatId)!;

        // Silverfort approval
        if (state.stage === "waiting_silverfort") {
          const approvalPhrases = ["udah", "done", "ok", "approved", "approve", "sudah", "oke", "yep", "yes", "iya"];
          if (approvalPhrases.some((p) => text.toLowerCase().includes(p))) {
            await ctx.reply("🔄 Verifying VPN...");
            const connected = await this.vpn.verifyAfterApproval();
            this.clearConversation(chatId);
            return ctx.reply(connected ? "✅ VPN connected! Siap kerja, nak." : "❌ Masih gagal. Coba approve lagi.");
          }
        }

        // Verify problem report
        if (state.stage === "waiting_verify") {
          const minionId = state.minionId;
          this.clearConversation(chatId);
          await ctx.reply(`🔄 Melaporkan masalah ke ${esc(this.configStore.getMinion(minionId)?.name || minionId)}...`, { parse_mode: "Markdown" });
          this.runAndReply(ctx, minionId, `ada masalah saat verify: ${text}`);
          return;
        }
      }

      // Normal flow → route to Semar
      this.runAndReply(ctx, "semar", text);
    });
  }

  // ── Core task runner ─────────────────────────────────────────

  private async runAndReply(ctx: any, minionId: string, prompt: string) {
    const config = this.configStore.getMinion(minionId);
    if (!config) return;

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    // Start typing indicator — feels like someone's actually thinking
    this.startTyping(chatId);
    this.activeTasks.set(minionId, chatId);

    // Collect assistant response
    let responseText = "";

    const cleanup = () => {
      clearTimeout(timeout);
      this.stopTyping(chatId);
      this.activeTasks.delete(minionId);
      this.claude.removeListener("chat", chatHandler);
      this.claude.removeListener("done", doneHandler);
    };

    // taskId resolved after runPrompt — handlers filter by it so queued tasks
    // don't accidentally trigger each other's callbacks
    let resolveTaskId: (id: string) => void;
    const taskIdPromise = new Promise<string>((res) => { resolveTaskId = res; });
    let taskId: string | null = null;
    taskIdPromise.then((id) => { taskId = id; });

    const chatHandler = (data: any) => {
      if (data.minionId !== minionId) return;
      if (taskId !== null && data.taskId !== taskId) return;
      if (data.message.role === "assistant") {
        responseText += data.message.content + "\n";
      }
    };

    const doneHandler = async (data: any) => {
      if (data.minionId !== minionId) return;
      if (taskId !== null && data.taskId !== taskId) return;
      cleanup();

      const fullText = responseText.trim();
      if (!fullText) {
        this.sendMsg(chatId, "...");
        return;
      }

      // ── Detect Plan Mode ──────────────────────────────────
      const plan = parsePlan(fullText);
      if (plan.found) {
        await this.sendPlanMessage(chatId, minionId, fullText, plan.steps);
        return;
      }

      // ── Detect mid-task Checkpoint ────────────────────────
      const checkpoint = parseCheckpoint(fullText);
      if (checkpoint.found) {
        const body = stripMetaBlocks(fullText);
        if (body) {
          this.sendMsg(chatId, truncate(body), { parse_mode: "Markdown" });
        }
        await this.sendVerifyMessage(chatId, minionId, checkpoint.verify);
        return;
      }

      // ── Normal response with optional VERIFY at end ───────
      const verify = parseVerify(fullText);
      const body = stripMetaBlocks(fullText);

      this.sendMsg(chatId, truncate(body || fullText), { parse_mode: "Markdown" });

      if (verify) {
        setTimeout(() => this.sendVerifyMessage(chatId, minionId, verify), 500);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      if (responseText.trim()) {
        this.sendMsg(chatId, truncate(responseText.trim()), { parse_mode: "Markdown" });
      } else {
        this.sendMsg(chatId, "Timeout — gue ga dapet respon dalam 5 menit.");
      }
    }, 300_000);

    this.claude.on("chat", chatHandler);
    this.claude.on("done", doneHandler);

    // Spawn Claude subprocess
    const workdir = config.workdir;
    const systemPrompt = this.configStore.loadSystemPrompt(config);
    const memoryContext = this.memoryStore.buildMemoryContext(minionId, prompt);
    const knowledgeContext = this.memoryStore.buildKnowledgeContext();

    const gitlabConfig = this.configStore.getIntegrations().gitlab;
    const env = gitlabConfig?.enabled
      ? {
          GITLAB_HOST: gitlabConfig.instanceURL?.replace(/^https?:\/\//, "") || "",
          GITLAB_TOKEN: gitlabConfig.apiToken || "",
          GITLAB_API: (gitlabConfig.instanceURL?.replace(/\/$/, "") || "") + "/api/v4",
        }
      : undefined;

    const resolvedTaskId = await this.claude.runPrompt(minionId, prompt, workdir, {
      systemPrompt: (systemPrompt || "") + memoryContext + knowledgeContext || undefined,
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      model: config.model,
      env,
    });
    resolveTaskId!(resolvedTaskId);
  }

  // ── Formatted message senders ────────────────────────────────

  private async sendPlanMessage(
    chatId: number,
    minionId: string,
    fullText: string,
    steps: string[]
  ) {
    const verifyStep = steps.find((s) => s.toUpperCase().startsWith("VERIFY:"));
    const normalSteps = steps.filter((s) => !s.toUpperCase().startsWith("VERIFY:"));

    const stepsText = normalSteps.map((s, i) => `${i + 1}. ${esc(s)}`).join("\n");
    const verifyLine = verifyStep
      ? `\n\n_Nanti gue minta lo cek: ${esc(verifyStep.replace(/^VERIFY:\s*/i, ""))}_`
      : "";

    const keyboard = new InlineKeyboard()
      .text("Gas", `plan:approve:${minionId}`)
      .text("Ga jadi", `plan:stop:${minionId}`);

    const text = stepsText + verifyLine + `\n\nGue mulai, nak?`;

    await this.bot?.api
      .sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: keyboard })
      .catch(() => {
        this.bot?.api.sendMessage(chatId, fullText.slice(0, 3900), { reply_markup: keyboard }).catch(() => {});
      });

    this.conversations.set(chatId, {
      chatId,
      minionId,
      stage: "waiting_plan_approval",
      data: { steps },
      timeout: setTimeout(() => this.clearConversation(chatId), 600_000),
    });
  }

  private async sendVerifyMessage(
    chatId: number,
    minionId: string,
    verifyInstruction: string
  ) {
    const keyboard = new InlineKeyboard()
      .text("Udah oke", `verify:ok:${minionId}`)
      .text("Ada masalah", `verify:problem:${minionId}`);

    await this.bot?.api
      .sendMessage(chatId, esc(verifyInstruction), { parse_mode: "Markdown", reply_markup: keyboard })
      .catch(() => {
        this.bot?.api.sendMessage(chatId, verifyInstruction, { reply_markup: keyboard }).catch(() => {});
      });
  }
}
