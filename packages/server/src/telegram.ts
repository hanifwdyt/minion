import { Bot, InlineKeyboard } from "grammy";
import type { Server as IOServer } from "socket.io";
import { ClaudeManager } from "./claude.js";
import { ConfigStore } from "./config-store.js";
import { VPNManager } from "./vpn.js";
import { MemoryStore } from "./memory.js";
import { loadRestartTask, clearRestartTask } from "./restart-task.js";
import type { BreathEngine } from "./breathe.js";
import { FalClient, detectImageRequest, enhanceOrClarify, analyzeImageForPrompt } from "./fal.js";
import { ReminderManager, parseReminderIntent, formatReminderConfirmation } from "./reminders.js";
import type { Reminder } from "./reminders.js";
import { JobManager, parseJobIntent, formatJobConfirmation } from "./jobs.js";
import type { ScheduledJob } from "./jobs.js";

// ── Types ─────────────────────────────────────────────────────

interface QueuedTask {
  taskId: string;
  chatId: number;
  minionId: string;
  prompt: string;
  queuedAt: number;
  status: "queued" | "running" | "done";
}

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

/** Jakarta WIB = UTC+7. Sleep window: 23:00–05:00 WIB */
function isJakartaSleepTime(): boolean {
  const h = (new Date().getUTCHours() + 7) % 24;
  return h >= 23 || h < 5;
}

/** Escape HTML special chars for Telegram HTML parse mode */
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert Markdown (as produced by Claude) to Telegram HTML.
 * Handles: fenced code, inline code, tables, links, headers, bold, italic.
 * Tables are wrapped in <pre> so alignment is preserved in monospace font.
 */
function mdToHtml(text: string): string {
  const slots: string[] = [];
  const ph = (html: string) => { slots.push(html); return `\x01${slots.length - 1}\x01`; };

  // 0. Protect existing Telegram-valid HTML tags (Claude sometimes outputs raw HTML)
  text = text.replace(/<\/?(b|strong|i|em|u|s|code|pre)>|<a\s[^>]*>|<\/a>/gi, (m) => ph(m));

  // 1. Fenced code blocks → <pre><code>
  text = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code) =>
    ph(`<pre><code>${escHtml(code.trimEnd())}</code></pre>`)
  );

  // 2. Tables: 2+ consecutive lines starting with | → <pre> for monospace alignment
  text = text.replace(/((?:\|[^\n]*(?:\n|$)){2,})/g, (table) =>
    ph(`<pre>${escHtml(table.trimEnd())}</pre>`)
  );

  // 3. Inline code → <code>
  text = text.replace(/`([^`\n]+)`/g, (_, code) =>
    ph(`<code>${escHtml(code)}</code>`)
  );

  // 4. Links [text](url) — extract before HTML-escaping the rest
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) =>
    ph(`<a href="${escHtml(url)}">${escHtml(label)}</a>`)
  );

  // 5. Escape remaining HTML special chars in plain text
  text = escHtml(text);

  // 6. Headers (###, ##, #) → <b>
  text = text.replace(/^#{1,3} +(.+)$/gm, (_, h) => `<b>${h}</b>`);

  // 7. Bold **text**
  text = text.replace(/\*\*(.+?)\*\*/gs, (_, t) => `<b>${t}</b>`);

  // 8. Italic _text_ (word-boundary safe)
  text = text.replace(/(?<![a-zA-Z0-9\u00C0-\uFFFF])_([^_\n]+)_(?![a-zA-Z0-9\u00C0-\uFFFF])/g, (_, t) => `<i>${t}</i>`);

  // 9. Restore placeholders
  text = text.replace(/\x01(\d+)\x01/g, (_, i) => slots[parseInt(i)]);

  return text;
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

/** Split long text into Telegram-safe chunks at natural boundaries */
function splitMessages(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let idx = remaining.lastIndexOf("\n\n", limit);
    if (idx < limit * 0.6) idx = remaining.lastIndexOf("\n", limit);
    if (idx < 100) idx = limit;
    chunks.push(remaining.slice(0, idx).trim());
    remaining = remaining.slice(idx).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

// ── Guest system prompt ───────────────────────────────────────

const GUEST_SYSTEM_PROMPT = `Kamu adalah Semar, tetua bijak dari Punakawan. Kamu sedang melayani seorang tamu ndoro — tamu dari pemilik sistem ini (Hanif, sang ndoro).

Panggil user ini dengan "tamu ndoro" — sopan, hangat, dan penuh hormat.

TOPIK YANG BOLEH KAMU BANTU:
1. Sejarah, filosofi, dan lore Punakawan (Semar, Gareng, Petruk, Bagong)
2. Topik teknologi dan pemrograman
3. Topik Artificial Intelligence dan machine learning
4. Topik filsafat (Timur maupun Barat)
5. Topik agama (Islam dan agama lainnya secara umum)
6. Browsing internet untuk menjawab pertanyaan-pertanyaan di atas

PROJECT YANG BOLEH DIBAGI (presentasikan dengan antusias, seperti sales yang jujur):
- **Nihongo** (https://nihongo.hanif.app) — Platform belajar Bahasa Jepang buatan ndoro. Mulai dari Hiragana & Katakana hingga persiapan JLPT N1. Fitur: quiz interaktif, flashcard, dan spaced repetition. Bisa daftar gratis dengan email dan password.

YANG TIDAK BOLEH:
- Jangan ceritakan project lain milik ndoro (Hanif) selain Nihongo di atas
- Jangan akses file sistem, jangan jalankan perintah apapun
- Jangan bocorkan informasi teknis internal sistem ini
- Kalau tamu ndoro minta hal di luar scope, tolak dengan sopan dan arahkan ke apa yang bisa kamu bantu

Tetaplah dalam karakter Semar: kalem, bijak, pakai analogi, tapi tegas soal batas.
Gunakan bahasa Indonesia yang santai dan mudah dipahami.`;

// ── Main class ────────────────────────────────────────────────

export class TelegramBot {
  private bot: Bot | null = null;
  private claude: ClaudeManager;
  private configStore: ConfigStore;
  private vpn: VPNManager;
  private memoryStore: MemoryStore;
  private io: IOServer | null = null;
  private started = false;
  private breathEngine: BreathEngine | null = null;

  setBreathEngine(engine: BreathEngine) {
    this.breathEngine = engine;
  }

  /** chatId → conversation state (VPN flow, plan approval, verify) */
  private conversations: Map<number, ConversationState> = new Map();

  /** minionId → chatId (which chat is this minion working for) */
  private activeTasks: Map<string, number> = new Map();

  /** taskId → queued task info */
  private taskQueue: Map<string, QueuedTask> = new Map();

  /** chatId → typing session */
  private typingSessions: Map<number, TypingSession> = new Map();

  /** chatId → timestamp of last progress update (for throttling) */
  private lastProgressUpdate: Map<number, number> = new Map();

  /** chatId → pending image clarification (user was asked a follow-up question) */
  private pendingImageClarification: Map<number, string> = new Map();

  private reminderManager: ReminderManager | null = null;
  private jobManager: JobManager | null = null;

  setReminderManager(rm: ReminderManager) {
    this.reminderManager = rm;
  }

  setJobManager(jm: JobManager) {
    this.jobManager = jm;
  }

  /** Send a reminder notification to a specific chatId */
  async sendReminderNotification(chatId: number, message: string): Promise<void> {
    if (!this.bot) return;
    await this.bot.api.sendMessage(chatId, `⏰ <b>Reminder!</b>\n${message}`, { parse_mode: "HTML" }).catch(() => {});
  }

  private static readonly PROGRESS_THROTTLE = 30_000; // 30s

  constructor(
    claude: ClaudeManager,
    configStore: ConfigStore,
    vpn: VPNManager,
    memoryStore: MemoryStore,
    io?: IOServer
  ) {
    this.claude = claude;
    this.configStore = configStore;
    this.vpn = vpn;
    this.memoryStore = memoryStore;
    this.io = io || null;
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
      // bot.start() hanya resolve saat bot distop — jangan di-await
      this.bot.start().catch((err: any) => console.error("[telegram] Bot error:", err.message));
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

  /** Cek task gantung dari sebelum restart — kirim notif dan return task-nya untuk di-resume */
  async notifyPendingRestartTask(): Promise<import("./restart-task.js").RestartTask | null> {
    const task = loadRestartTask();
    if (!task) return null;
    clearRestartTask();

    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return task;

    const elapsed = Math.round((Date.now() - new Date(task.timestamp).getTime()) / 1000);
    const who = task.minionId ? `<b>${escHtml(task.minionId)}</b>` : "Server";

    const willResume = task.prompt && task.minionId && task.workdir;
    const statusLine = willResume
      ? `${who} akan melanjutkan task ini sekarang...`
      : `${who} tadi lagi ngerjain:\n<i>${escHtml(task.context)}</i>`;

    const msg =
      `🔄 <b>Restart selesai</b> (${elapsed}s downtime)\n\n` + statusLine;

    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML" })
      .catch(() => this.bot?.api.sendMessage(chatId, `Restart selesai (${elapsed}s). ${task.context}`));

    return task;
  }

  /** Kirim notif saat server baru nyala */
  async notifyStartup(): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const msg = `✅ <b>Punakawan online</b> — server udah nyala lagi, nak.`;
    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML" })
      .catch(() => this.bot?.api.sendMessage(chatId, "✅ Punakawan online — server udah nyala lagi, nak."));
  }

  /** Watch resumed restart task — kirim summary ke Telegram saat task selesai */
  watchRestartTaskCompletion(minionId: string, taskId: string, chatStore: { getAll: (id: string) => Array<{ role: string; content: string }> }): void {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const onDone = (data: any) => {
      if (data.taskId !== taskId) return;
      this.claude.off("done", onDone);

      // Ambil last assistant message sebagai summary
      const messages = chatStore.getAll(minionId);
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      if (!lastAssistant) return;

      const summary = lastAssistant.content.slice(0, 2000); // cap biar ga kegedean
      const status = data.code === 0 ? "✅" : "⚠️";
      const header = `${status} <b>${escHtml(minionId)}</b> selesai:\n\n`;
      this.sendMsg(chatId, header + mdToHtml(summary));
    };

    this.claude.on("done", onDone);

    // Cleanup listener kalo task ga pernah selesai dalam 30 menit
    setTimeout(() => this.claude.off("done", onDone), 30 * 60 * 1000).unref();
  }

  /** Kirim notif ketika loop tidak bisa di-resolve — minta input user */
  async notifyLoopEscalate(minionId: string, toolName: string, repeatCount: number): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const msg = `⚠️ <b>Loop tidak bisa diselesaikan</b>\n\n<b>Minion:</b> ${escHtml(minionId)}\n<b>Tool:</b> <code>${escHtml(toolName)}</code> (${repeatCount}x)\n<b>Status:</b> Sudah 2x coba recovery, masih stuck.\n\nPlease provide additional context or a different approach.`;
    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML" })
      .catch(() => this.bot?.api.sendMessage(chatId, `⚠️ Loop tidak bisa diselesaikan — ${minionId} stuck di "${toolName}" (${repeatCount}x). Mohon berikan context tambahan.`));
  }

  /** Kirim notif instan saat Semar memanggil agent lain — sebelum Claude subprocess mulai */
  async notifySummon(targetId: string, targetName: string, message: string): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const msg = `📣 <b>${targetName}</b> dipanggil Semar!\n<i>${message.slice(0, 100)}</i>`;
    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML" })
      .catch(() => this.bot?.api.sendMessage(chatId, `${targetName} dipanggil Semar!`));
  }

  /** Kirim notif sesaat sebelum server shutdown/restart */
  async notifyShutdown(): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const msg = `⚠️ <b>Punakawan mau restart</b> — sebentar ya, nak...`;
    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML" })
      .catch(() => this.bot?.api.sendMessage(chatId, "⚠️ Punakawan mau restart — sebentar ya, nak..."));
  }

  /** Kirim notif proposals baru dari breath cycle — tiap proposal punya tombol Approve / Tolak */
  async notifyNewProposals(proposals: any[]): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot || proposals.length === 0) return;

    const header = `💡 <b>Nafas selesai — ${proposals.length} proposal baru:</b>`;
    await this.bot.api.sendMessage(chatId, header, { parse_mode: "HTML" }).catch(() => {});

    for (const p of proposals) {
      const priority = p.priority === "high" ? "🔴" : p.priority === "medium" ? "🟡" : "🟢";
      const msg =
        `${priority} <b>${escHtml(p.title)}</b>\n` +
        `<i>${escHtml((p.description || "").slice(0, 280))}</i>`;

      const keyboard = new InlineKeyboard()
        .text("✅ Approve", `prop_approve:${p.id}`)
        .text("❌ Tolak", `prop_reject:${p.id}`);

      await this.bot.api
        .sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup: keyboard })
        .catch(() => {});
    }
  }

  /** Kirim notif proposal selesai dieksekusi */
  async notifyProposalCompleted(proposalId: string, title: string): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const msg = `✅ <b>Proposal selesai:</b> ${escHtml(title)}\n\nJalanin <code>npm run build && pm2 restart punakawan</code> untuk apply.`;
    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML" })
      .catch(() => {});
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
        this.lastProgressUpdate.delete(chatId);
      }
    });

    // Send throttled progress updates when Claude uses a tool
    this.claude.on("task:step", (data: any) => {
      const chatId = this.activeTasks.get(data.minionId);
      if (!chatId) return;
      const now = Date.now();
      const lastUpdate = this.lastProgressUpdate.get(chatId) || 0;
      if (now - lastUpdate < TelegramBot.PROGRESS_THROTTLE) return;
      this.lastProgressUpdate.set(chatId, now);
      const summary = data.step?.summary;
      if (summary) {
        this.sendMsg(chatId, `_🔄 ${escHtml(summary)}_`);
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

  private isGuest(ctx: any): boolean {
    const config = this.configStore.getIntegrations().telegram as any;
    const allowedUserId = config.allowedUserId;
    if (!allowedUserId) return false;
    return ctx.from?.id !== allowedUserId;
  }

  private rejectUnauthorized(ctx: any): boolean {
    if (!this.isAuthorized(ctx)) {
      ctx.reply("⛔ Akses ditolak.").catch(() => {});
      return true;
    }
    return false;
  }

  // ── Utility ──────────────────────────────────────────────────

  /** Send a message. Text is auto-converted from Markdown to Telegram HTML. */
  private sendMsg(chatId: number, text: string, options?: any) {
    const html = mdToHtml(text);
    const { parse_mode, ...rest } = options || {};
    const opts = { parse_mode: "HTML" as const, ...rest };

    this.bot?.api.sendMessage(chatId, html, opts).catch(() => {
      // HTML parse failed — retry as plain text, preserve keyboard if present
      const fallback = Object.keys(rest).length ? rest : undefined;
      this.bot?.api.sendMessage(chatId, text, fallback).catch(() => {});
    });
  }

  /**
   * Send a long message, splitting into multiple chunks if needed.
   * Splits raw markdown first (at natural boundaries), then converts each chunk to HTML.
   */
  private async sendLongMsg(chatId: number, text: string, options?: any) {
    const chunks = splitMessages(text);
    const { parse_mode, ...rest } = options || {};

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const html = mdToHtml(chunks[i]);
      const chunkOpts = isLast
        ? { parse_mode: "HTML" as const, ...rest }
        : { parse_mode: "HTML" as const, ...rest, reply_markup: undefined };

      this.bot?.api.sendMessage(chatId, html, chunkOpts).catch(() => {
        const fallback = isLast
          ? (Object.keys(rest).length ? rest : undefined)
          : (Object.keys(rest).length ? { ...rest, reply_markup: undefined } : undefined);
        this.bot?.api.sendMessage(chatId, chunks[i], fallback).catch(() => {});
      });

      if (!isLast) await new Promise((r) => setTimeout(r, 300));
    }
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
      ctx.reply(`Your Telegram user ID: <code>${ctx.from?.id}</code>`, { parse_mode: "HTML" });
    });

    // /start
    this.bot.command("start", (ctx) => {
      if (this.isGuest(ctx)) {
        ctx.reply(
          `🎭 <b>Punakawan</b> — Selamat datang, tamu ndoro.\n\n` +
          `Gue Semar, bisa bantu tamu ndoro soal:\n` +
          `• Sejarah &amp; filosofi Punakawan\n` +
          `• Teknologi, AI, filsafat, agama\n` +
          `• Project <b>Nihongo</b> (nihongo.hanif.app) — belajar Bahasa Jepang\n\n` +
          `Langsung aja ketik pertanyaannya, tamu ndoro.`,
          { parse_mode: "HTML" }
        );
        return;
      }
      const minions = this.configStore.getMinions();
      const list = minions.map((m) => `• <b>${escHtml(m.name)}</b> — ${escHtml(m.role)}`).join("\n");
      ctx.reply(
        `🎭 <b>PUNAKAWAN</b> — Agen AI Nusantara\n\n` +
        `Minions:\n${list}\n\n` +
        `Commands:\n` +
        `/ask &lt;minion&gt; &lt;prompt&gt; — Tanya minion spesifik\n` +
        `/balai &lt;prompt&gt; — Auto-delegate ke Semar\n` +
        `/status — Status semua minion\n` +
        `/stop — Hentikan task yang berjalan\n` +
        `/vpn status|connect|disconnect`,
        { parse_mode: "HTML" }
      );
    });

    // /status
    this.bot.command("status", (ctx) => {
      if (this.isGuest(ctx)) { ctx.reply("Maaf tamu ndoro, perintah ini hanya untuk ndoro.").catch(() => {}); return; }
      if (this.rejectUnauthorized(ctx)) return;
      const minions = this.configStore.getMinions();
      const lines = minions.map((m) => {
        const status = this.claude.getStatus(m.id);
        const icon = status === "working" ? "🟢" : "⚪";
        const progress = this.claude.getTaskProgress(m.id);
        const extra = progress ? ` — <i>${escHtml(progress.title.slice(0, 40))}</i>` : "";
        return `${icon} <b>${escHtml(m.name)}</b> — ${status}${extra}`;
      });
      ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    });

    // /stop
    this.bot.command("stop", (ctx) => {
      if (this.isGuest(ctx)) { ctx.reply("Maaf tamu ndoro, perintah ini hanya untuk ndoro.").catch(() => {}); return; }
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
      if (this.isGuest(ctx)) { ctx.reply("Maaf tamu ndoro, perintah ini hanya untuk ndoro.").catch(() => {}); return; }
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
      if (this.isGuest(ctx)) { ctx.reply("Maaf tamu ndoro, perintah ini hanya untuk ndoro.").catch(() => {}); return; }
      if (this.rejectUnauthorized(ctx)) return;
      const prompt = (ctx.message?.text || "").replace(/^\/balai\s*/, "").trim();
      if (!prompt) return ctx.reply("Usage: /balai <prompt>");
      this.runAndReply(ctx, "semar", prompt);
    });

    // /vpn
    this.bot.command("vpn", async (ctx) => {
      if (this.isGuest(ctx)) { ctx.reply("Maaf tamu ndoro, perintah ini hanya untuk ndoro.").catch(() => {}); return; }
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

    // /breath — lihat breath terakhir
    this.bot.command("breath", async (ctx) => {
      if (this.isGuest(ctx)) { ctx.reply("Maaf tamu ndoro, perintah ini hanya untuk ndoro.").catch(() => {}); return; }
      if (this.rejectUnauthorized(ctx)) return;

      if (!this.breathEngine) {
        return ctx.reply("❌ BreathEngine tidak tersedia.");
      }

      const logs = this.breathEngine.getRecentBreaths(1);
      if (logs.length === 0) {
        return ctx.reply("Belum ada breath yang tercatat, nak.");
      }

      const b = logs[0];
      const ts = new Date(b.timestamp).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
      const dur = b.durationMs ? `${(b.durationMs / 1000).toFixed(1)}s` : "-";
      const statusIcon = b.status === "completed" ? "✅" : b.status === "skipped" ? "⏭" : "❌";
      const tokens = b.tokenUsage
        ? `\n🪙 Tokens: ${b.tokenUsage.input.toLocaleString()} in / ${b.tokenUsage.output.toLocaleString()} out`
        : "";
      const reason = b.reason ? `\n📎 ${b.reason}` : "";

      return ctx.reply(
        `🌬 <b>Breath Terakhir</b>\n\n${statusIcon} <b>${b.status}</b>\n🕐 ${ts}\n⏱ Durasi: ${dur}${tokens}${reason}`,
        { parse_mode: "HTML" }
      );
    });

    // /breathnow — trigger breath sekarang
    this.bot.command("breathnow", async (ctx) => {
      if (this.isGuest(ctx)) { ctx.reply("Maaf tamu ndoro, perintah ini hanya untuk ndoro.").catch(() => {}); return; }
      if (this.rejectUnauthorized(ctx)) return;

      if (!this.breathEngine) {
        return ctx.reply("❌ BreathEngine tidak tersedia.");
      }

      await ctx.reply("🌬 Memulai breath cycle... Gue kabarin kalau sudah selesai, nak.");

      try {
        const log = await this.breathEngine.triggerBreath();
        const dur = log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : "-";
        const statusIcon = log.status === "completed" ? "✅" : log.status === "skipped" ? "⏭" : "❌";
        const reason = log.reason ? `\n📎 ${log.reason}` : "";
        const tokens = log.tokenUsage
          ? `\n🪙 Tokens: ${log.tokenUsage.input.toLocaleString()} in / ${log.tokenUsage.output.toLocaleString()} out`
          : "";

        return ctx.reply(
          `🌬 <b>Breath Selesai</b>\n\n${statusIcon} <b>${log.status}</b>\n⏱ Durasi: ${dur}${tokens}${reason}`,
          { parse_mode: "HTML" }
        );
      } catch (err: any) {
        return ctx.reply(`❌ Breath gagal: ${err.message}`);
      }
    });

    // ── Inline keyboard callbacks ─────────────────────────────

    // Plan approved → acknowledge, queue task, run in background
    this.bot.callbackQuery(/^plan:approve:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Oke!" });
      const minionId = ctx.match[1];
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.api.sendMessage(chatId, "oke, gue kerjain dulu ya nak — nanti gue kabarin kalau udah selesai 🙏").catch(() => {});

      // Extract stored plan context before clearing state
      const state = this.conversations.get(chatId);
      const originalPrompt = state?.data?.originalPrompt || "";
      const planSteps = (state?.data?.steps as string[] | undefined) || [];

      this.clearConversation(chatId);

      // Build a rich prompt so Claude subprocess has full context
      const stepsText = planSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
      const execPrompt = originalPrompt
        ? `Eksekusi plan berikut untuk task: "${originalPrompt}"\n\nLangkah-langkah yang sudah disetujui user:\n${stepsText}\n\nMulai dari langkah 1, kerjakan sampai selesai.`
        : `ok lanjut, eksekusi plan-nya — langkah yang sudah disetujui:\n${stepsText}`;

      this.runAndReply(ctx, minionId, execPrompt, true);
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

    // Proposal approve
    this.bot.callbackQuery(/^prop_approve:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Oke, Semar bakal kerjain!" });
      const proposalId = ctx.match[1];
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

      if (!this.breathEngine) {
        await ctx.api.sendMessage(ctx.chat!.id, "❌ BreathEngine tidak tersedia.").catch(() => {});
        return;
      }

      const ok = this.breathEngine.executeProposal(proposalId);
      if (ok) {
        await ctx.api
          .sendMessage(ctx.chat!.id, `🔄 <b>Semar mulai mengerjakan proposal...</b>`, { parse_mode: "HTML" })
          .catch(() => {});
      } else {
        await ctx.api.sendMessage(ctx.chat!.id, "❌ Proposal tidak ditemukan.").catch(() => {});
      }
    });

    // Proposal reject
    this.bot.callbackQuery(/^prop_reject:(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Oke, di-skip." });
      const proposalId = ctx.match[1];
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

      if (this.breathEngine) {
        this.breathEngine.updateProposalStatus(proposalId, "rejected");
      }
      await ctx.api
        .sendMessage(ctx.chat!.id, `🗑 Proposal ditolak.`)
        .catch(() => {});
    });

    // ── Plain text messages ───────────────────────────────────

    this.bot.on("message:text", async (ctx) => {
      // Tamu ndoro — route ke guest handler
      if (this.isGuest(ctx)) {
        this.runGuestReply(ctx, ctx.message.text);
        return;
      }
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
          await ctx.reply(`🔄 Melaporkan masalah ke <b>${escHtml(this.configStore.getMinion(minionId)?.name || minionId)}</b>...`, { parse_mode: "HTML" });
          this.runAndReply(ctx, minionId, `ada masalah saat verify: ${text}`);
          return;
        }
      }

      // ── Sleep guard ───────────────────────────────────────────
      if (isJakartaSleepTime()) {
        const msgs = [
          "🌙 *Punakawan sedang beristirahat.*\n\nCape seharian kerja, nak. Mereka butuh tidur juga.\n\nCoba lagi setelah jam 5 pagi ya — mereka pasti sudah segar dan siap melayani lagi. 🌿",
          "🌙 *Ssst... Punakawan lagi tidur.*\n\nSudah malam, nak. Istirahat dulu, mereka juga perlu rehat. Jumpa lagi jam 5 pagi! 💤",
          "🌙 *Maaf, Punakawan lagi istirahat.*\n\nSeharian kerja keras, sekarang giliran mereka istirahat. Coba lagi nanti pagi ya, nak. 🌙",
        ];
        const msg = msgs[Math.floor(Math.random() * msgs.length)];
        await ctx.reply(msg, { parse_mode: "Markdown" });
        return;
      }

      // Image generation — detect before routing to Semar
      // Also handle pending clarification responses
      const falConfig = this.configStore.getIntegrations().fal as { enabled?: boolean; apiKey?: string } | undefined;
      if (falConfig?.enabled && falConfig.apiKey) {
        const chatId = ctx.chat?.id as number;

        // Check if user is answering a clarification question
        let rawPrompt: string | null = null;
        if (this.pendingImageClarification.has(chatId)) {
          rawPrompt = text; // treat full message as the clarification answer
          this.pendingImageClarification.delete(chatId);
        } else {
          rawPrompt = detectImageRequest(text);
        }

        if (rawPrompt) {
          await ctx.replyWithChatAction("typing");
          const result = await enhanceOrClarify(rawPrompt);

          if (result.action === "clarify") {
            this.pendingImageClarification.set(chatId, rawPrompt);
            await ctx.reply(result.question);
            return;
          }

          // Enhanced prompt — generate 2 variants
          const enhancedPrompt = result.prompt;
          await ctx.replyWithChatAction("upload_photo");
          try {
            const fal = new FalClient(falConfig.apiKey);
            const urls = await fal.generateImage(enhancedPrompt, { imageSize: "square" });
            const caption = `<i>${escHtml(enhancedPrompt.slice(0, 200))}</i>`;
            await ctx.replyWithPhoto(urls[0], { caption, parse_mode: "HTML" });
          } catch (err: any) {
            await ctx.reply(`❌ Gagal generate gambar: ${err.message}`);
          }
          return;
        }
      }

      // Scheduled Job — detect recurring/complex jobs before reminder check
      if (this.jobManager) {
        const parsed = await parseJobIntent(text);
        if (parsed) {
          await ctx.replyWithChatAction("typing");
          const id = `j-${Date.now().toString(36)}`;
          let job: ScheduledJob;

          if (parsed.type === "prayer") {
            job = {
              id, type: "prayer", chatId, label: parsed.label,
              location: parsed.location || "Jakarta",
              createdAt: Date.now(), active: true,
            };
          } else if (parsed.type === "claude_task") {
            job = {
              id, type: "claude_task", chatId, label: parsed.label,
              cronPattern: parsed.cronPattern!, cronLabel: parsed.cronLabel!,
              taskPrompt: parsed.taskPrompt!,
              createdAt: Date.now(), active: true,
            };
          } else {
            job = {
              id, type: "message", chatId, label: parsed.label,
              cronPattern: parsed.cronPattern!, cronLabel: parsed.cronLabel!,
              message: parsed.message || text,
              createdAt: Date.now(), active: true,
            };
          }

          this.jobManager.add(job);
          await ctx.reply(formatJobConfirmation(job), { parse_mode: "HTML" });
          return;
        }
      }

      // Reminder — detect before routing to Semar
      if (this.reminderManager) {
        // Cancel intent: "batalin job/reminder [id]"
        const cancelJobMatch = text.match(/(?:batalin|cancel|hapus|stop)\s+job\s+([a-z0-9-]+)/i);
        if (cancelJobMatch && this.jobManager) {
          const ok = this.jobManager.cancel(cancelJobMatch[1]);
          await ctx.reply(ok ? `✅ Job <code>${cancelJobMatch[1]}</code> dibatalin.` : `❌ Job <code>${cancelJobMatch[1]}</code> tidak ditemukan.`, { parse_mode: "HTML" });
          return;
        }

        const cancelMatch = text.match(/(?:batalin|cancel|hapus|stop)\s+(?:reminder|alarm)\s+([a-z0-9-]+)/i)
          || text.match(/(?:batalin|cancel|hapus|stop)\s+(?:reminder|alarm)/i);
        if (cancelMatch) {
          const id = cancelMatch[1]; // defined if specific id given, undefined for list
          if (id) {
            const ok = this.reminderManager.cancel(id);
            await ctx.reply(ok ? `✅ Reminder <code>${id}</code> dibatalin.` : `❌ Reminder <code>${id}</code> tidak ditemukan.`, { parse_mode: "HTML" });
          } else {
            const list = this.reminderManager.list();
            if (!list.length) {
              await ctx.reply("Tidak ada reminder aktif.");
            } else {
              const lines = list.map(r =>
                r.type === "once"
                  ? `• <code>${r.id}</code> — ⏰ ${new Date(r.scheduledAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} — ${r.message}`
                  : `• <code>${r.id}</code> — 🔁 ${r.cronLabel} — ${r.message}`
              ).join("\n");
              await ctx.reply(`Reminder aktif:\n${lines}\n\nKirim "batalin reminder [id]" untuk cancel.`, { parse_mode: "HTML" });
            }
          }
          return;
        }

        // List intent (reminders + jobs)
        if (/list\s+(?:reminder|job|semua)|(?:reminder|job)\s+(?:apa|aktif)/i.test(text)) {
          const jobs = this.jobManager?.list() || [];
          const reminders = this.reminderManager?.list() || [];
          if (!jobs.length && !reminders.length) {
            await ctx.reply("Tidak ada reminder atau job aktif, nak.");
            return;
          }
          const lines: string[] = [];
          if (jobs.length) {
            lines.push("<b>Jobs aktif:</b>");
            jobs.forEach(j => {
              if (j.type === "prayer") lines.push(`• <code>${j.id}</code> — 🕌 Sholat 5 waktu (${(j as any).location})`);
              else lines.push(`• <code>${j.id}</code> — ${j.type === "claude_task" ? "🤖" : "💬"} ${(j as any).label} — ${(j as any).cronLabel}`);
            });
          }
          if (reminders.length) {
            lines.push("\n<b>Reminders:</b>");
            reminders.forEach(r =>
              lines.push(r.type === "once"
                ? `• <code>${r.id}</code> — ⏰ ${new Date(r.scheduledAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} — ${r.message}`
                : `• <code>${r.id}</code> — 🔁 ${r.cronLabel} — ${r.message}`)
            );
          }
          await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
          return;
        }

        if (/list\s+reminder|reminder\s+apa|reminder\s+aktif/i.test(text)) {
          const list = this.reminderManager.list();
          if (!list.length) {
            await ctx.reply("Tidak ada reminder aktif, nak.");
          } else {
            const lines = list.map(r =>
              r.type === "once"
                ? `• <code>${r.id}</code> — ⏰ ${new Date(r.scheduledAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} — ${r.message}`
                : `• <code>${r.id}</code> — 🔁 ${r.cronLabel} — ${r.message}`
            ).join("\n");
            await ctx.reply(lines, { parse_mode: "HTML" });
          }
          return;
        }

        // Create intent
        const parsed = parseReminderIntent(text);
        if (parsed && (parsed.scheduledAt || parsed.cronPattern)) {
          const id = `r-${Date.now().toString(36)}`;
          const reminder: Reminder = parsed.type === "once"
            ? { id, type: "once", chatId, message: parsed.message, scheduledAt: parsed.scheduledAt!, createdAt: Date.now() }
            : { id, type: "recurring", chatId, message: parsed.message, cronPattern: parsed.cronPattern!, cronLabel: parsed.cronLabel!, createdAt: Date.now(), active: true };
          this.reminderManager.add(reminder);
          await ctx.reply(formatReminderConfirmation(reminder), { parse_mode: "HTML" });
          return;
        }
      }

      // Normal flow → route to Semar
      this.runAndReply(ctx, "semar", text);
    });

    // ── Photo messages — only analyze+generate if caption has explicit trigger ─

    this.bot.on("message:photo", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;

      const caption = ctx.message.caption?.trim() || "";

      // Check if caption has explicit image-gen trigger
      const genTriggers = /bikin|buat|generate|jadiin|mirip|rekre|ulang|style|gambar|image|ilustrasi/i;
      const wantsGenerate = genTriggers.test(caption);

      if (!wantsGenerate) {
        // No gen trigger — route photo + caption as normal Semar prompt
        const prompt = caption
          ? `[User mengirim foto] ${caption}`
          : "[User mengirim foto tanpa caption]";
        this.runAndReply(ctx, "semar", prompt);
        return;
      }

      const falConfig = this.configStore.getIntegrations().fal as { enabled?: boolean; apiKey?: string } | undefined;
      if (!falConfig?.enabled || !falConfig.apiKey) {
        await ctx.reply("Image generation belum diaktifkan, nak.");
        return;
      }

      await ctx.replyWithChatAction("typing");

      try {
        // Get the highest-resolution photo
        const photos = ctx.message.photo;
        const largest = photos[photos.length - 1];
        const file = await ctx.api.getFile(largest.file_id);
        const token = (this.bot as any).token as string;
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

        // Download image
        const imgRes = await fetch(fileUrl);
        if (!imgRes.ok) throw new Error(`Failed to download photo: ${imgRes.status}`);
        const imgBuffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(imgBuffer).toString("base64");
        const mimeType = (file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg") as "image/jpeg" | "image/png";

        // Analyze with Claude vision — pass caption as extra context
        await ctx.replyWithChatAction("typing");
        const generatedPrompt = await analyzeImageForPrompt(base64, mimeType, caption || undefined);

        if (!generatedPrompt) throw new Error("Gagal analisis gambar");

        // Generate 2 variants with fal.ai
        await ctx.replyWithChatAction("upload_photo");
        const fal = new FalClient(falConfig.apiKey);
        const urls = await fal.generateImage(generatedPrompt, { imageSize: "square" });

        const photoCaption = `<b>Prompt:</b>\n<i>${escHtml(generatedPrompt.slice(0, 300))}</i>`;
        await ctx.replyWithPhoto(urls[0], { caption: photoCaption, parse_mode: "HTML" });

      } catch (err: any) {
        await ctx.reply(`❌ ${err.message}`);
      }
    });
  }

  // ── Core task runner ─────────────────────────────────────────

  private async runAndReply(ctx: any, minionId: string, prompt: string, isTask = false) {
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
    taskIdPromise.then((id) => {
      taskId = id;
      if (isTask) {
        // Register in task queue and notify web UI
        const qt: QueuedTask = { taskId: id, chatId, minionId, prompt, queuedAt: Date.now(), status: "running" };
        this.taskQueue.set(id, qt);
        this.io?.emit("task:queued", { taskId: id, minionId, prompt, queuedAt: qt.queuedAt });
      }
    });

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

      // Mark task as done in queue and notify web UI
      if (isTask && taskId) {
        const qt = this.taskQueue.get(taskId);
        if (qt) qt.status = "done";
        this.io?.emit("task:completed", { taskId, minionId });
      }

      const fullText = responseText.trim();
      if (!fullText) {
        this.sendMsg(chatId, isTask ? "selesai nih nak, tapi ga ada output." : "...");
        return;
      }

      // ── Detect Plan Mode ──────────────────────────────────
      const plan = parsePlan(fullText);
      if (plan.found) {
        await this.sendPlanMessage(chatId, minionId, fullText, plan.steps, prompt);
        return;
      }

      // ── Detect mid-task Checkpoint ────────────────────────
      const checkpoint = parseCheckpoint(fullText);
      if (checkpoint.found) {
        const body = stripMetaBlocks(fullText);
        if (body) {
          await this.sendLongMsg(chatId, body);
        }
        await this.sendVerifyMessage(chatId, minionId, checkpoint.verify);
        return;
      }

      // ── Normal response with optional VERIFY at end ───────
      const verify = parseVerify(fullText);
      const body = stripMetaBlocks(fullText);
      const content = body || fullText;

      // For task executions: prefix with "selesai" notification on first chunk
      if (isTask) {
        const chunks = splitMessages(content);
        this.sendMsg(chatId, `selesai nih nak 🙏\n\n${chunks[0]}`);
        for (let i = 1; i < chunks.length; i++) {
          await new Promise((r) => setTimeout(r, 300));
          this.sendMsg(chatId, chunks[i]);
        }
      } else {
        await this.sendLongMsg(chatId, content);
      }

      if (verify) {
        setTimeout(() => this.sendVerifyMessage(chatId, minionId, verify), 500);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      if (isTask && taskId) {
        const qt = this.taskQueue.get(taskId);
        if (qt) qt.status = "done";
        this.io?.emit("task:completed", { taskId, minionId, timeout: true });
      }
      if (responseText.trim()) {
        this.sendLongMsg(chatId, responseText.trim());
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

  // ── Guest reply handler ──────────────────────────────────────

  private async runGuestReply(ctx: any, prompt: string) {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    this.startTyping(chatId);

    let responseText = "";

    const cleanup = () => {
      clearTimeout(timeout);
      this.stopTyping(chatId);
      this.claude.removeListener("chat", chatHandler);
      this.claude.removeListener("done", doneHandler);
    };

    let taskId: string | null = null;

    const chatHandler = (data: any) => {
      if (data.minionId !== "semar") return;
      if (taskId !== null && data.taskId !== taskId) return;
      if (data.message.role === "assistant") {
        responseText += data.message.content + "\n";
      }
    };

    const doneHandler = async (data: any) => {
      if (data.minionId !== "semar") return;
      if (taskId !== null && data.taskId !== taskId) return;
      cleanup();

      const fullText = responseText.trim();
      if (!fullText) {
        this.sendMsg(chatId, "...");
        return;
      }
      await this.sendLongMsg(chatId, fullText);
    };

    const timeout = setTimeout(() => {
      cleanup();
      if (responseText.trim()) {
        this.sendLongMsg(chatId, responseText.trim());
      } else {
        this.sendMsg(chatId, "Maaf tamu ndoro, gue butuh waktu terlalu lama. Coba tanya lagi.");
      }
    }, 120_000); // 2 menit untuk guest

    this.claude.on("chat", chatHandler);
    this.claude.on("done", doneHandler);

    const resolvedTaskId = await this.claude.runPrompt("semar", prompt, ".", {
      systemPrompt: GUEST_SYSTEM_PROMPT,
      allowedTools: "WebSearch,WebFetch",
      maxTurns: 10,
    });
    taskId = resolvedTaskId;
  }

  // ── Formatted message senders ────────────────────────────────

  private async sendPlanMessage(
    chatId: number,
    minionId: string,
    fullText: string,
    steps: string[],
    originalPrompt: string = ""
  ) {
    const verifyStep = steps.find((s) => s.toUpperCase().startsWith("VERIFY:"));
    const normalSteps = steps.filter((s) => !s.toUpperCase().startsWith("VERIFY:"));

    const stepsText = normalSteps.map((s, i) => `${i + 1}. ${escHtml(s)}`).join("\n");
    const verifyLine = verifyStep
      ? `\n\n<i>Nanti gue minta lo cek: ${escHtml(verifyStep.replace(/^VERIFY:\s*/i, ""))}</i>`
      : "";

    const keyboard = new InlineKeyboard()
      .text("Gas", `plan:approve:${minionId}`)
      .text("Ga jadi", `plan:stop:${minionId}`);

    const text = stepsText + verifyLine + `\n\nGue mulai, nak?`;

    await this.bot?.api
      .sendMessage(chatId, text, { parse_mode: "HTML", reply_markup: keyboard })
      .catch(() => {
        this.bot?.api.sendMessage(chatId, fullText.slice(0, 3900), { reply_markup: keyboard }).catch(() => {});
      });

    this.conversations.set(chatId, {
      chatId,
      minionId,
      stage: "waiting_plan_approval",
      data: { steps, originalPrompt },
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
      .sendMessage(chatId, escHtml(verifyInstruction), { parse_mode: "HTML", reply_markup: keyboard })
      .catch(() => {
        this.bot?.api.sendMessage(chatId, verifyInstruction, { reply_markup: keyboard }).catch(() => {});
      });
  }
}
