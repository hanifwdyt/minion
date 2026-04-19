import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { exec, execSync } from "child_process";
import type { Server as IOServer } from "socket.io";
import { ClaudeManager } from "./claude.js";
import { ConfigStore } from "./config-store.js";
import { VPNManager } from "./vpn.js";
import { MemoryStore } from "./memory.js";
import { loadRestartTask, clearRestartTask } from "./restart-task.js";
import type { BreathEngine } from "./breathe.js";
import { FalClient, detectImageRequest, enhanceOrClarify } from "./fal.js";
import { ReminderManager, parseReminderIntent, formatReminderConfirmation } from "./reminders.js";
import type { Reminder } from "./reminders.js";
import { JobManager, parseJobIntent, formatJobConfirmation, formatJobList } from "./jobs.js";
import type { ScheduledJob } from "./jobs.js";
import { listTasks, listProjects, createTask, updateTask, formatTaskList, parseTaskIntent } from "./taskflow.js";

// ── Vision: image understanding via Claude API ─────────────────
// Behaves like Claude Chat/Code — responds to what user ASKS, not just describes.

async function respondToImage(
  base64: string,
  mimeType: string,
  caption: string,
  soulText: string,
  recentMessages: Array<{ role: "user" | "assistant"; text: string }> = []
): Promise<string> {
  const apiKey = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!apiKey) throw new Error("No API key");

  const systemText = (soulText || "Kamu adalah Semar, tetua bijak dari Punakawan.") + `

Ketika user mengirim gambar:
- Jika ada caption/pertanyaan → jawab pertanyaannya dengan tepat menggunakan isi gambar
- Jika gambar berisi kode, error, bug → analisis dan bantu solve
- Jika gambar berisi screenshot UI/design → beri feedback atau bantu apa yang diminta
- Jika gambar berisi teks/dokumen → baca dan respons sesuai konteks
- Jika gambar berisi data/grafik → analisis datanya
- Jika tidak ada caption → buat observasi singkat yang relevan, tanyakan apa yang ingin dibantu
- JANGAN sekedar deskripsi gambar. Fokus pada apa yang user butuhkan dari gambar ini.`;

  // Build conversation history
  const historyMessages: Array<{ role: "user" | "assistant"; content: any }> = [];
  for (const m of recentMessages.slice(-4)) {
    historyMessages.push({ role: m.role, content: m.text });
  }

  // Current message: image + caption
  const userContent: any[] = [
    { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
  ];
  if (caption) {
    userContent.push({ type: "text", text: caption });
  } else {
    userContent.push({ type: "text", text: "." });
  }

  historyMessages.push({ role: "user", content: userContent });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
      messages: historyMessages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vision API ${res.status}: ${err}`);
  }
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content?.[0]?.text?.trim() || "Gue ga bisa baca gambar ini, nak.";
}

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

  /** Global task queue — tasks waiting for a free agent */
  private agentQueue: Array<{ ctx: any; prompt: string; label: string; isTask?: boolean }> = [];

  /** Agent pool in priority order */
  private readonly AGENT_POOL = ["semar", "petruk", "gareng", "bagong"];

  /** Per-agent takeover lines — said when they pick up a task meant for Semar */
  private readonly AGENT_TAKEOVER: Record<string, string[]> = {
    petruk: [
      "Eh ndoro, Semar lagi sibuk nih. Sini biar <b>Petruk</b> yang handle dulu, gampang ini mah!",
      "Ndoro, Semar lagi penuh. <b>Petruk</b> siap — gas langsung ya!",
      "Tenang ndoro, <b>Petruk</b> di sini. Semar lagi ada kerjaan lain.",
    ],
    gareng: [
      "Eh... <b>Gareng</b> aja ya ndoro? Semar sama Petruk lagi pada sibuk soalnya...",
      "Ndoro... <b>Gareng</b> coba bantu deh. Semoga bisa ya hehe.",
      "Biar <b>Gareng</b> yang coba ndoro. Pelan-pelan tapi pasti!",
    ],
    bagong: [
      "<b>Bagong</b>! Semua pada sibuk, tapi Bagong nganggur. Gas!",
      "Ndoro, <b>Bagong</b> yang handle. Gaskeun!",
      "<b>Bagong</b> siap, ndoro. Yang lain pada repot semua.",
    ],
  };

  /**
   * Dispatch task to the first idle agent.
   * Semar = default. If busy → Petruk → Gareng → Bagong.
   * If all busy → queue, notify user. Drains automatically when agent finishes.
   */
  private dispatch(ctx: any, prompt: string, label = "", isTask = false, preferredAgent = "semar"): void {
    // Try preferred agent first, then fall back through pool
    const pool = [preferredAgent, ...this.AGENT_POOL.filter(a => a !== preferredAgent)];
    const freeAgent = pool.find(id => {
      const cfg = this.configStore.getMinion(id);
      return cfg && this.claude.getStatus(id) === "idle";
    });

    if (freeAgent) {
      if (freeAgent !== preferredAgent) {
        const lines = this.AGENT_TAKEOVER[freeAgent];
        const msg = lines[Math.floor(Math.random() * lines.length)];
        ctx.reply(msg, { parse_mode: "HTML" });
      }
      this.runAndReply(ctx, freeAgent, prompt, isTask);
    } else {
      this.agentQueue.push({ ctx, prompt, label, isTask });
      const pos = this.agentQueue.length;
      ctx.reply(
        `⏳ Semua agent lagi sibuk nih ndoro.\nTask <b>${escHtml(label || "ini")}</b> masuk antrian #${pos}.\nGue kabarin begitu ada yang selesai!`,
        { parse_mode: "HTML" }
      );
    }
  }

  /** Drain task queue when an agent becomes idle */
  private drainQueue(): void {
    if (!this.agentQueue.length) return;
    const freeAgent = this.AGENT_POOL.find(id => {
      const cfg = this.configStore.getMinion(id);
      return cfg && this.claude.getStatus(id) === "idle";
    });
    if (!freeAgent) return;
    const next = this.agentQueue.shift();
    if (!next) return;
    const remaining = this.agentQueue.length;
    next.ctx.reply(
      `✅ <b>${freeAgent}</b> selesai dan langsung ambil task antrian: <i>${escHtml(next.label || "task")}</i>${remaining > 0 ? `\n(Masih ${remaining} task lagi di antrian)` : ""}`,
      { parse_mode: "HTML" }
    );
    this.runAndReply(next.ctx, freeAgent, next.prompt, next.isTask);
  }

  /** @deprecated use dispatch() */
  private dispatchMrTask(ctx: any, prompt: string, label: string): void {
    this.dispatch(ctx, prompt, label);
  }

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

  /** Notif tweet baru masuk queue — dikirim ke owner setelah auto-generate */
  async notifyTweetQueued(character: string, topic: string, draft: string): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;
    const charLabel = character.charAt(0).toUpperCase() + character.slice(1);
    const msg = `🎭 <b>Tweet baru siap direview</b>\n\n<b>Karakter:</b> ${charLabel}\n<b>Topik:</b> ${topic}\n\n<pre>${draft}</pre>\n\n👉 Review di x.hanif.app`;
    await this.bot.api.sendMessage(chatId, msg, { parse_mode: "HTML" }).catch(() => {
      this.bot?.api.sendMessage(chatId, `Tweet ${charLabel} baru masuk queue. Review di x.hanif.app`).catch(() => {});
    });
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
      // Register commands in Telegram autocomplete
      this.bot.api.setMyCommands([
        { command: "mr_list", description: "List open MR [repo]" },
      ]).catch((e: any) => console.warn("[telegram] setMyCommands failed:", e.message));
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

  /** Persistent reply keyboard — selalu ada di bawah chat */
  private getMainKeyboard(): Keyboard {
    return new Keyboard()
      .text("🔄 Restart Punakawan").text("🌐 Start VPN")
      .resized()
      .persistent();
  }

  /** Kirim notif saat server baru nyala */
  async notifyStartup(): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const msg = `✅ <b>Punakawan online</b> — server udah nyala lagi, nak.`;
    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup: this.getMainKeyboard() })
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

  /** Kirim notif admin — general purpose, HTML parse mode */
  async sendAdminNotification(msg: string): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;
    await this.bot.api.sendMessage(chatId, msg, { parse_mode: "HTML" }).catch(() => {});
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

  /** Kirim pesan dengan tombol Restart Sekarang / Restart Nanti */
  async notifyRestartReady(context?: string): Promise<void> {
    const config = this.configStore.getIntegrations().telegram;
    const chatId = config.allowedUserId;
    if (!chatId || !this.bot) return;

    const msg = context
      ? `🔧 <b>Build selesai</b> — ${escHtml(context)}\n\nMau restart sekarang?`
      : `🔧 <b>Build selesai.</b> Mau restart sekarang?`;

    const keyboard = new InlineKeyboard()
      .text("🔄 Restart Sekarang", "restart:now")
      .text("🕐 Nanti", "restart:later");

    await this.bot.api
      .sendMessage(chatId, msg, { parse_mode: "HTML", reply_markup: keyboard })
      .catch(() => {});
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
    this.vpn.on("needs_approval", () => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "vpn_connecting") {
          state.stage = "waiting_silverfort";
          const keyboard = new InlineKeyboard()
            .text("🔌 Connect Sekarang", "vpn:retry")
            .text("❌ Gajadi", "vpn:cancel");
          this.bot?.api.sendMessage(
            chatId,
            "⏳ Silverfort belum di-approve (10s timeout).\nApprove di HP lo, terus tap tombol:",
            { parse_mode: "HTML", reply_markup: keyboard }
          ).catch(() => {});
        }
      }
    });

    this.vpn.on("connected", () => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "waiting_silverfort") {
          this.sendMsg(chatId, "✅ VPN nyambung, lanjut.");
          this.clearConversation(chatId);
        }
      }
      // Also notify if connected via button retry (no active conversation)
      const config = this.configStore.getIntegrations().telegram;
      if (config.allowedUserId) {
        this.sendMsg(config.allowedUserId, "✅ VPN nyambung, lanjut.");
      }
    });

    this.vpn.on("timeout", () => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "waiting_silverfort") {
          const keyboard = new InlineKeyboard()
            .text("🔌 Connect Sekarang", "vpn:retry")
            .text("❌ Gajadi", "vpn:cancel");
          this.bot?.api.sendMessage(
            chatId,
            "❌ VPN timeout — Silverfort tidak di-approve.",
            { reply_markup: keyboard }
          ).catch(() => {});
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
      // Drain task queue — agent just became free
      setTimeout(() => this.drainQueue(), 500);
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
      this.dispatch(ctx, prompt, prompt.slice(0, 40));
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

    // /taskflow [token] — simpan API token untuk akses task.hanif.app
    this.bot.command("taskflow", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const token = (ctx.message?.text || "").replace(/^\/taskflow\s*/, "").trim();
      if (!token) {
        return ctx.reply(
          "📋 *Cara sambungin Taskflow:*\n\n" +
          "1. Buka task.hanif.app → klik avatar di pojok kanan atas\n" +
          "2. Klik *Generate Token*\n" +
          "3. Copy token, lalu kirim:\n\n" +
          "`/taskflow tf_xxxxx...`",
          { parse_mode: "Markdown" }
        );
      }

      // Validate token by calling the API
      try {
        const baseUrl = process.env.TASKFLOW_BASE_URL || "https://task.hanif.app";
        const res = await fetch(`${baseUrl}/api/agent/tasks?status=todo`, {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (!res.ok) {
          return ctx.reply("❌ Token tidak valid. Pastikan lo copy token yang benar dari task.hanif.app.");
        }
        const data = await res.json() as { total: number };

        // Save token to env (runtime only — for restart persistence write to .env)
        process.env.TASKFLOW_AGENT_TOKEN = token;

        // Persist to .env file
        const fs = await import("fs");
        const envPath = "/root/minion/.env";
        let envContent = fs.readFileSync(envPath, "utf-8");
        if (envContent.includes("TASKFLOW_AGENT_TOKEN=")) {
          envContent = envContent.replace(/TASKFLOW_AGENT_TOKEN=.*/m, `TASKFLOW_AGENT_TOKEN=${token}`);
        } else {
          envContent += `\nTASKFLOW_AGENT_TOKEN=${token}`;
        }
        fs.writeFileSync(envPath, envContent);

        await ctx.reply(
          `✅ Taskflow tersambung!\n\n` +
          `Lo punya *${data.total} task* aktif saat ini.\n\n` +
          `Coba tanya: _"apa yang perlu gue kerjain?"_`,
          { parse_mode: "Markdown" }
        );
      } catch (err: any) {
        await ctx.reply(`❌ Gagal verifikasi token: ${err.message}`);
      }
    });

    // ── GitLab MR Commands ────────────────────────────────────

    // Helper: check VPN via curl (reliable, follows VPN tunnel routing)
    const checkVPN = (): boolean => {
      try {
        const code = execSync(
          'curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 https://mygitlab-dev.ioh.co.id',
          { timeout: 8000, encoding: "utf-8" }
        ).trim();
        return code === "302" || code === "200" || code === "301";
      } catch { return false; }
    };

    const GITLAB_API = process.env.GITLAB_API || "https://mygitlab-dev.ioh.co.id/api/v4";
    const GITLAB_TOKEN = process.env.GITLAB_TOKEN || "";
    const REPO_MAP: Record<string, string> = {
      "ide-phoenix": "cco%2Fcmo%2Fgroup-digital-coe%2Fdiv-smb-digital-product%2Fide-phoenix",
      "ip": "cco%2Fcmo%2Fgroup-digital-coe%2Fdiv-smb-digital-product%2Fide-phoenix",
    };

    const vpnErrMsg = "❌ VPN tidak konek.\nStart: <code>sudo systemctl start openconnect</code> lalu approve Silverfort di HP.";
    const tokenErrMsg = "❌ GITLAB_TOKEN kosong. Pastikan ada di .env dan server sudah restart.";

    // Helper: pipeline status emoji
    const pipelineEmoji = (status: string | undefined) =>
      ({ success: "✅", failed: "❌", running: "🔄", pending: "⏳", canceled: "🚫", skipped: "⏭️" }[status || ""] ?? "⚪");

    // /mr_list [repo] — per-MR message with action buttons
    this.bot.command("mr_list", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const repo = (ctx.message?.text || "").replace(/^\/mr_list\s*/, "").trim() || "ide-phoenix";
      const projectId = REPO_MAP[repo];
      if (!projectId) return ctx.reply(`❌ Repo "${repo}" tidak dikenal. Tersedia: ide-phoenix`);
      if (!GITLAB_TOKEN) return ctx.reply(tokenErrMsg, { parse_mode: "HTML" });

      // VPN dulu — sebelum apapun
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });

      await ctx.replyWithChatAction("typing");
      try {
        // Retry sekali — VPN tunnel kadang butuh 1-2 detik setelah connect sebelum stabil
        const fetchMRs = () => fetch(
          `${GITLAB_API}/projects/${projectId}/merge_requests?author_username=LCS-HANWID&state=opened&per_page=20`,
          { headers: { "PRIVATE-TOKEN": GITLAB_TOKEN } }
        );
        const res = await fetchMRs().catch(async () => {
          await new Promise(r => setTimeout(r, 2000));
          return fetchMRs();
        });
        if (!res.ok) throw new Error(`GitLab ${res.status}: ${await res.text()}`);
        const mrs = await res.json() as any[];
        if (!mrs.length) return ctx.reply("✅ Tidak ada open MR saat ini.");

        await ctx.reply(`📋 <b>${mrs.length} open MR — ${repo}</b>`, { parse_mode: "HTML" });

        // Enrich all MRs in parallel: approvals + discussions + pipeline + diverged count
        const enriched = await Promise.all(mrs.map(async (mr: any) => {
          const [apRes, discRes, plRes, detailRes] = await Promise.all([
            fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${mr.iid}/approvals`, {
              headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
            }),
            fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${mr.iid}/discussions?per_page=100`, {
              headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
            }),
            fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${mr.iid}/pipelines?per_page=1`, {
              headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
            }),
            fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${mr.iid}?include_diverged_commits_count=true`, {
              headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
            }),
          ]);
          const ap = await apRes.json() as any;
          const discussions = await discRes.json() as any[];
          const pipelines = await plRes.json() as any[];
          const detail = await detailRes.json() as any;
          const approvers = (ap.approved_by || []).map((a: any) => (a.user.name || a.user.username) as string);
          const unresolvedCount = discussions.filter((d: any) =>
            d.notes?.some((n: any) => !n.system && n.resolvable && !n.resolved)
          ).length;
          const pipeline = pipelines[0] || null;
          const divergedCount = detail.diverged_commits_count ?? 0;
          return { mr: { ...mr, diverged_commits_count: divergedCount }, approvers, unresolvedCount, pipeline };
        }));

        // Send one message per MR with inline keyboard
        for (const { mr, approvers, unresolvedCount, pipeline } of enriched) {
          const hasConflict = mr.merge_status === "cannot_be_merged" || mr.has_conflicts;
          const needsRebase = (mr.diverged_commits_count ?? 0) > 0;
          const isApproved = approvers.length > 0;
          const pl = pipeline?.status as string | undefined;
          const pipelineFailed = pl === "failed" || pl === "canceled";
          const readyToMerge = isApproved && !hasConflict && !needsRebase && unresolvedCount === 0 && !mr.draft && pl === "success";

          // Status lines
          const tags: string[] = [];
          if (isApproved) tags.push(`✅ ${approvers.join(", ")}`);
          else tags.push(`⏳ Belum approved`);
          if (unresolvedCount > 0) tags.push(`💬 ${unresolvedCount} unresolved`);
          if (hasConflict) tags.push(`⚠️ Conflict`);
          else if (needsRebase) tags.push(`🔄 Behind ${mr.diverged_commits_count}x`);
          if (pl) tags.push(`${pipelineEmoji(pl)} Pipeline: ${pl}`);
          if (readyToMerge) tags.push(`🚀 Ready to merge!`);

          const text =
            `${mr.draft ? "📝" : "🔵"} <b>!${mr.iid}</b> — ${escHtml(mr.title)}\n` +
            `<code>${mr.source_branch}</code> → <code>${mr.target_branch}</code>\n` +
            tags.join("  ·  ") + "\n" +
            `<a href="${mr.web_url}">🔗 Link MR</a>`;

          // Build action buttons
          const cb = `${mr.iid}:${repo}`;
          const keyboard = new InlineKeyboard();
          if (unresolvedCount > 0) keyboard.text("💬 Resolve Issues", `mra:resolve:${cb}`);
          if (hasConflict || needsRebase) keyboard.text("🔄 Rebase", `mra:rebase:${cb}`);
          if (pipelineFailed) keyboard.text("🔧 Fix Pipeline", `mra:pipeline:${cb}`);
          if (readyToMerge) keyboard.text("🚀 Merge", `mra:merge:${cb}`);

          const hasButtons = unresolvedCount > 0 || hasConflict || needsRebase || pipelineFailed || readyToMerge;
          await ctx.reply(text, {
            parse_mode: "HTML",
            reply_markup: hasButtons ? keyboard : undefined,
          });
        }
      } catch (err: any) {
        // Re-check VPN — mungkin putus di tengah jalan
        if (!checkVPN()) {
          ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
        } else {
          ctx.reply(`❌ GitLab tidak bisa diakses: ${err.message}`);
        }
      }
    });

    // /mr_list_approved [repo] — parallel approval fetching
    this.bot.command("mr_list_approved", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const repo = (ctx.message?.text || "").replace(/^\/mr_list_approved\s*/, "").trim() || "ide-phoenix";
      const projectId = REPO_MAP[repo];
      if (!projectId) return ctx.reply(`❌ Repo "${repo}" tidak dikenal.`);
      if (!GITLAB_TOKEN) return ctx.reply(tokenErrMsg, { parse_mode: "HTML" });
      await ctx.replyWithChatAction("typing");
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
      try {
        const res = await fetch(`${GITLAB_API}/projects/${projectId}/merge_requests?author_username=LCS-HANWID&state=opened&per_page=20`, {
          headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
        });
        if (!res.ok) throw new Error(`GitLab ${res.status}: ${await res.text()}`);
        const mrs = await res.json() as any[];
        if (!mrs.length) return ctx.reply("⏳ Tidak ada open MR.");
        // Fetch approvals in parallel — jauh lebih cepat dari sequential
        const results = await Promise.all(
          mrs.map(async (mr: any) => {
            const apRes = await fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${mr.iid}/approvals`, {
              headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
            });
            const ap = await apRes.json() as any;
            const approvers = (ap.approved_by || []).map((a: any) => (a.user.name || a.user.username) as string);
            return approvers.length > 0 ? { mr, approvers } : null;
          })
        );
        const approved = results.filter(Boolean) as Array<{ mr: any; approvers: string[] }>;
        if (!approved.length) return ctx.reply("⏳ Belum ada MR yang di-approve.");
        const lines = approved.map(({ mr, approvers }) =>
          `✅ <b>!${mr.iid}</b> — ${escHtml(mr.title)}\n` +
          `   👤 ${approvers.join(", ")} | <code>${mr.source_branch}</code>`
        );
        await ctx.reply(`✅ <b>Approved MR — ${repo} (${approved.length}/${mrs.length}):</b>\n\n${lines.join("\n\n")}`, { parse_mode: "HTML" });
      } catch (err: any) {
        ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // /mr_merge <iid> [repo] — direct glab call, instant feedback
    this.bot.command("mr_merge", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const args = (ctx.message?.text || "").replace(/^\/mr_merge\s*/, "").trim().split(/\s+/);
      const iid = args[0];
      const repo = args[1] || "ide-phoenix";
      if (!iid || !/^\d+$/.test(iid)) return ctx.reply("Usage: /mr_merge <nomor_mr> [repo]\nContoh: /mr_merge 541");
      if (!GITLAB_TOKEN) return ctx.reply(tokenErrMsg, { parse_mode: "HTML" });
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
      const repoPath = `/root/repos/${repo}`;
      await ctx.reply(`🔄 Merging MR !${iid} di ${repo}...`);
      try {
        const out = execSync(
          `cd ${repoPath} && glab mr merge ${iid} --squash --remove-source-branch --yes 2>&1`,
          { timeout: 30000, encoding: "utf-8" }
        );
        ctx.reply(`✅ MR !${iid} berhasil di-merge.\n<code>${escHtml(out.trim().slice(0, 400))}</code>`, { parse_mode: "HTML" });
      } catch (err: any) {
        const errOut = ((err.stdout || "") + (err.message || "")).trim().slice(0, 500);
        ctx.reply(`❌ Merge gagal:\n<code>${escHtml(errOut)}</code>`, { parse_mode: "HTML" });
      }
    });

    // /mr_check_issues <iid> [repo]
    this.bot.command("mr_check_issues", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const args = (ctx.message?.text || "").replace(/^\/mr_check_issues\s*/, "").trim().split(/\s+/);
      const iid = args[0];
      const repo = args[1] || "ide-phoenix";
      if (!iid || !/^\d+$/.test(iid)) return ctx.reply("Usage: /mr_check_issues <nomor_mr> [repo]\nContoh: /mr_check_issues 542");
      if (!GITLAB_TOKEN) return ctx.reply(tokenErrMsg, { parse_mode: "HTML" });
      await ctx.replyWithChatAction("typing");
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
      try {
        const projectId = REPO_MAP[repo] || REPO_MAP["ide-phoenix"];
        // Fetch discussions + approvals in parallel
        const [discRes, apRes] = await Promise.all([
          fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${iid}/discussions?per_page=50`, {
            headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
          }),
          fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${iid}/approvals`, {
            headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
          }),
        ]);
        if (!discRes.ok) throw new Error(`GitLab ${discRes.status}`);
        const discussions = await discRes.json() as any[];
        const approvals = await apRes.json() as any;
        const unresolved = discussions.filter((d: any) =>
          d.notes?.some((n: any) => !n.system && !n.resolved && n.resolvable)
        );
        const approvers = (approvals.approved_by || []).map((a: any) => (a.user.name || a.user.username) as string);
        const approvalLine = approvals.approved
          ? `✅ Approved by: ${approvers.join(", ")}`
          : `⏳ Belum di-approve (needed: ${approvals.approvals_required || 1})`;
        if (!unresolved.length) {
          return ctx.reply(
            `✅ <b>MR !${iid} — semua bersih</b>\n${approvalLine}\n🗨️ Tidak ada unresolved discussion.`,
            { parse_mode: "HTML" }
          );
        }
        const lines = unresolved.map((d: any) => {
          const note = d.notes?.find((n: any) => !n.system);
          const pos = note?.position;
          const loc = pos ? `${pos.new_path}:${pos.new_line || pos.old_line}` : "general";
          const author = note?.author?.username || "?";
          return `⚠️ <code>${loc}</code> @${author}\n   ${escHtml((note?.body || "").slice(0, 150))}`;
        });
        await ctx.reply(
          `📋 <b>MR !${iid} — ${unresolved.length} unresolved</b>\n${approvalLine}\n\n${lines.join("\n\n")}`,
          { parse_mode: "HTML" }
        );
      } catch (err: any) {
        ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // /mr_fix_resolves <iid> [repo]
    this.bot.command("mr_fix_resolves", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const args = (ctx.message?.text || "").replace(/^\/mr_fix_resolves\s*/, "").trim().split(/\s+/);
      const iid = args[0];
      const repo = args[1] || "ide-phoenix";
      if (!iid || !/^\d+$/.test(iid)) return ctx.reply("Usage: /mr_fix_resolves <nomor_mr> [repo]\nContoh: /mr_fix_resolves 542");
      if (!GITLAB_TOKEN) return ctx.reply(tokenErrMsg, { parse_mode: "HTML" });
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
      const projectId = REPO_MAP[repo] || REPO_MAP["ide-phoenix"];
      await ctx.reply(`🔧 Mulai fix semua unresolved review di MR !${iid} (${repo})...`);
      this.runAndReply(ctx, "semar",
        `Resolve semua unresolved review comments di MR !${iid} repo ${repo} (/root/repos/${repo}). ` +
        `Flow: 1) ambil semua discussions via GitLab API yang belum resolved, ` +
        `2) untuk setiap discussion: baca konteks file dan line-nya, fix kodenya, ` +
        `3) commit fix dengan message yang jelas, push, ` +
        `4) reply ke discussion thread via API, 5) resolve discussion via API. ` +
        `Gunakan env GITLAB_API dan GITLAB_TOKEN. Project ID: ${projectId}. ` +
        `Laporkan setiap issue yang di-fix.`
      );
    });

    // /mr_review <iid> [repo]
    this.bot.command("mr_review", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;
      const args = (ctx.message?.text || "").replace(/^\/mr_review\s*/, "").trim().split(/\s+/);
      const iid = args[0];
      const repo = args[1] || "ide-phoenix";
      if (!iid || !/^\d+$/.test(iid)) return ctx.reply("Usage: /mr_review <nomor_mr> [repo]\nContoh: /mr_review 543");
      if (!GITLAB_TOKEN) return ctx.reply(tokenErrMsg, { parse_mode: "HTML" });
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
      const projectId = REPO_MAP[repo] || REPO_MAP["ide-phoenix"];
      await ctx.reply(`🔍 Mulai review MR !${iid} (${repo})...`);
      this.runAndReply(ctx, "semar",
        `Review MR !${iid} di repo ${repo} (/root/repos/${repo}) sebagai senior engineer. ` +
        `Flow: 1) ambil diff MR via: glab mr diff ${iid}, ` +
        `2) review setiap file changed — per line, bukan global comment, ` +
        `3) untuk setiap issue, post inline comment via GitLab API dengan format: ` +
        `[CRITICAL/WARNING/INFO] Kenapa ini masalah + suggestion fix-nya. ` +
        `CRITICAL = bug/security/logic error. WARNING = best practice violation. INFO = improvement suggestion. ` +
        `Post comment via POST ${GITLAB_API}/projects/${projectId}/merge_requests/${iid}/discussions ` +
        `dengan body, position.base_sha, position.head_sha, position.start_sha, position.new_path, position.new_line. ` +
        `Setelah semua comment dipost, kirim summary total: berapa CRITICAL, WARNING, INFO.`
      );
    });

    // ── MR Action Callbacks ───────────────────────────────────

    // mra:resolve:<iid>:<repo> — fix all unresolved discussions, commit, push, reply each thread
    this.bot.callbackQuery(/^mra:resolve:(\d+):(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Fixing..." });
      const iid = ctx.match[1];
      const repo = ctx.match[2];
      const projectId = REPO_MAP[repo] || REPO_MAP["ide-phoenix"];
      this.dispatchMrTask(ctx,
        `Resolve semua unresolved review comments di MR !${iid} repo ${repo} (/root/repos/${repo}). ` +
        `Flow: ` +
        `1) Ambil semua unresolved discussions via GET ${GITLAB_API}/projects/${projectId}/merge_requests/${iid}/discussions — filter d.notes yang resolvable && !resolved, ` +
        `2) Untuk setiap discussion: baca file + line dari position, baca konteks kodenya, fix masalahnya, ` +
        `3) Commit fix per scope perubahan (satu commit per area, bukan satu commit semua), ` +
        `4) Setelah semua fix di-commit: git push, ` +
        `5) Reply tiap discussion thread: POST ${GITLAB_API}/projects/${projectId}/merge_requests/${iid}/discussions/<discussion_id>/notes dengan body penjelasan fix, ` +
        `6) Resolve tiap discussion: PUT ${GITLAB_API}/projects/${projectId}/merge_requests/${iid}/discussions/<discussion_id> dengan {"resolved": true}. ` +
        `Header: PRIVATE-TOKEN dari env GITLAB_TOKEN. ` +
        `Laporkan setiap issue yang di-fix.`,
        `Resolve issues MR !${iid}`
      );
    });

    // mra:rebase:<iid>:<repo> — git rebase, auto-resolve conflict via Semar if needed
    this.bot.callbackQuery(/^mra:rebase:(\d+):(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Rebasing..." });
      const iid = ctx.match[1];
      const repo = ctx.match[2];
      const projectId = REPO_MAP[repo] || REPO_MAP["ide-phoenix"];
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });

      // Fetch MR to get branch names
      const mrRes = await fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${iid}`, {
        headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
      });
      const mr = await mrRes.json() as any;
      const { source_branch, target_branch } = mr;
      const repoPath = `/root/repos/${repo}`;

      await ctx.reply(`🔄 Rebasing <code>${source_branch}</code> onto <code>origin/${target_branch}</code>...`, { parse_mode: "HTML" });
      try {
        execSync(
          `cd ${repoPath} && git fetch origin && git checkout ${source_branch} && git rebase origin/${target_branch} 2>&1`,
          { timeout: 30000, encoding: "utf-8" }
        );
        execSync(`cd ${repoPath} && git push --force-with-lease 2>&1`, { timeout: 30000, encoding: "utf-8" });
        await ctx.reply(`✅ Rebase !${iid} selesai dan sudah di-push.`);
      } catch (rebaseErr: any) {
        // Abort and delegate to Semar
        try { execSync(`cd ${repoPath} && git rebase --abort`, { timeout: 5000, encoding: "utf-8" }); } catch {}
        await ctx.reply(`⚠️ Ada conflict saat rebase. Agent akan resolve...`);
        this.dispatchMrTask(ctx,
          `Rebase MR !${iid} di repo ${repo} (/root/repos/${repo}) — ada conflict yang perlu di-resolve. ` +
          `Flow: 1) git fetch origin, 2) git checkout ${source_branch}, 3) git rebase origin/${target_branch}, ` +
          `4) untuk setiap conflict: baca kedua versi, resolve dengan logis (jangan asal pilih satu sisi), ` +
          `5) git add file-yang-di-resolve, 6) git rebase --continue, ulangi sampai selesai, ` +
          `7) git push --force-with-lease. ` +
          `Laporkan file yang conflict dan bagaimana mereka di-resolve.`,
          `Rebase conflict MR !${iid}`
        );
      }
    });

    // mra:pipeline:<iid>:<repo> — fetch failed job logs, delegate to Semar to fix
    this.bot.callbackQuery(/^mra:pipeline:(\d+):(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Checking pipeline..." });
      const iid = ctx.match[1];
      const repo = ctx.match[2];
      const projectId = REPO_MAP[repo] || REPO_MAP["ide-phoenix"];
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
      await ctx.reply(`🔍 Menganalisis pipeline failure MR !${iid}...`);
      try {
        // Get pipeline ID from MR
        const mrRes = await fetch(`${GITLAB_API}/projects/${projectId}/merge_requests/${iid}`, {
          headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
        });
        const mr = await mrRes.json() as any;
        const pipelineId = mr.head_pipeline?.id || mr.pipeline?.id;
        if (!pipelineId) return ctx.reply("❌ Tidak ada pipeline info di MR ini.");

        // Get failed jobs
        const jobsRes = await fetch(
          `${GITLAB_API}/projects/${projectId}/pipelines/${pipelineId}/jobs?scope[]=failed&scope[]=canceled&per_page=10`,
          { headers: { "PRIVATE-TOKEN": GITLAB_TOKEN } }
        );
        const failedJobs = await jobsRes.json() as any[];
        if (!failedJobs.length) return ctx.reply("✅ Tidak ada failed jobs di pipeline ini.");

        await ctx.reply(`❌ ${failedJobs.length} failed job: ${failedJobs.map((j: any) => j.name).join(", ")}\nFetching logs...`);

        // Fetch logs for failed jobs in parallel (last 4000 chars each)
        const logs = await Promise.all(
          failedJobs.slice(0, 3).map(async (job: any) => {
            const logRes = await fetch(`${GITLAB_API}/projects/${projectId}/jobs/${job.id}/trace`, {
              headers: { "PRIVATE-TOKEN": GITLAB_TOKEN },
            });
            const log = await logRes.text();
            return `=== ${job.name} (stage: ${job.stage}) ===\n${log.slice(-4000)}`;
          })
        );

        this.dispatchMrTask(ctx,
          `Fix pipeline failure di MR !${iid} repo ${repo} (/root/repos/${repo}). ` +
          `Branch: ${mr.source_branch}. ` +
          `Failed jobs: ${failedJobs.map((j: any) => `${j.name} (${j.stage})`).join(", ")}.\n\n` +
          `Logs:\n${logs.join("\n\n")}\n\n` +
          `Flow: 1) Analisis error dari log di atas, ` +
          `2) Fix semua issue yang ditemukan (rubocop → fix style, rspec → fix test/code), ` +
          `3) Commit fix dengan message yang jelas, ` +
          `4) git push. ` +
          `Laporkan apa yang di-fix.`,
          `Fix pipeline MR !${iid}`
        );
      } catch (err: any) {
        ctx.reply(`❌ Error: ${err.message}`);
      }
    });

    // mra:merge:<iid>:<repo> — direct glab merge
    this.bot.callbackQuery(/^mra:merge:(\d+):(.+)$/, async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Merging..." });
      const iid = ctx.match[1];
      const repo = ctx.match[2];
      if (!checkVPN()) return ctx.reply(vpnErrMsg, { parse_mode: "HTML" });
      const repoPath = `/root/repos/${repo}`;
      await ctx.reply(`🚀 Merging MR !${iid}...`);
      try {
        const out = execSync(
          `cd ${repoPath} && glab mr merge ${iid} --squash --remove-source-branch --yes 2>&1`,
          { timeout: 30000, encoding: "utf-8" }
        );
        ctx.reply(`✅ MR !${iid} berhasil di-merge.\n<code>${escHtml(out.trim().slice(0, 300))}</code>`, { parse_mode: "HTML" });
      } catch (err: any) {
        const errOut = ((err.stdout || "") + (err.message || "")).trim().slice(0, 400);
        ctx.reply(`❌ Merge gagal:\n<code>${escHtml(errOut)}</code>`, { parse_mode: "HTML" });
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

    // VPN retry — reconnect
    this.bot.callbackQuery("vpn:retry", async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Connecting..." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.api.sendMessage(ctx.chat!.id, "🔌 Nyoba konek VPN lagi... approve Silverfort di HP ya.").catch(() => {});
      const connected = await this.vpn.connect();
      if (!connected) {
        const keyboard = new InlineKeyboard()
          .text("🔌 Connect Sekarang", "vpn:retry")
          .text("❌ Gajadi", "vpn:cancel");
        await ctx.api.sendMessage(ctx.chat!.id, "❌ Masih gagal konek.", { reply_markup: keyboard }).catch(() => {});
      }
    });

    // VPN cancel
    this.bot.callbackQuery("vpn:cancel", async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Oke, dibatalin." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await this.vpn.disconnect().catch(() => {});
      await ctx.api.sendMessage(ctx.chat!.id, "🔌 VPN dibatalin.").catch(() => {});
    });

    // Restart now
    this.bot.callbackQuery("restart:now", async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Restarting..." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.api.sendMessage(ctx.chat!.id, "🔄 Restarting Punakawan...").catch(() => {});
      // Delay 500ms biar message sempat terkirim sebelum proses mati
      setTimeout(() => {
        exec("pm2 restart punakawan", (err) => {
          if (err) {
            ctx.api.sendMessage(ctx.chat!.id, `❌ Restart gagal: ${err.message}`).catch(() => {});
          }
          // Kalau sukses, proses mati — startup notification handle sisanya
        });
      }, 500);
    });

    // Restart later — dismiss saja
    this.bot.callbackQuery("restart:later", async (ctx) => {
      await ctx.answerCallbackQuery({ text: "Oke, nanti aja." });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
      await ctx.api.sendMessage(ctx.chat!.id, "🕐 Restart ditunda. Kirim <code>restart</code> kapanpun lo siap.", { parse_mode: "HTML" }).catch(() => {});
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

      // ── Taskflow integration ───────────────────────────────────
      if (process.env.TASKFLOW_AGENT_TOKEN || process.env.TASKFLOW_AGENT_SECRET) {
        const taskIntent = parseTaskIntent(text);
        if (taskIntent.action !== "none") {
          await ctx.replyWithChatAction("typing");
          try {
            if (taskIntent.action === "list") {
              const [tasks, projects] = await Promise.all([
                listTasks(taskIntent.data?.status ? { status: taskIntent.data.status } : {}),
                listProjects(),
              ]);
              const activeTasks = tasks.filter(t => t.status !== "done");
              if (!activeTasks.length) {
                await ctx.reply("✅ Tidak ada task yang pending, nak. Semuanya bersih!", { parse_mode: "Markdown" });
              } else {
                const formatted = formatTaskList(activeTasks, projects);
                await ctx.reply(`📋 *Task lo saat ini (${activeTasks.length}):*\n\n${formatted}`, { parse_mode: "Markdown" });
              }
              return;
            }

            if (taskIntent.action === "add" && taskIntent.data?.title) {
              const task = await createTask({ title: taskIntent.data.title });
              await ctx.reply(`✅ Task ditambahkan:\n*${task.title}*\nStatus: todo | Priority: medium`, { parse_mode: "Markdown" });
              return;
            }

            if (taskIntent.action === "done" && taskIntent.data?.title) {
              const tasks = await listTasks({ status: "todo" });
              const keyword = taskIntent.data.title.toLowerCase();
              const match = tasks.find(t => t.title.toLowerCase().includes(keyword));
              if (match) {
                await updateTask(match.id, { status: "done" });
                await ctx.reply(`✅ Task selesai: *${match.title}*`, { parse_mode: "Markdown" });
              } else {
                await ctx.reply(`❌ Task tidak ditemukan: "${taskIntent.data.title}"`, { parse_mode: "Markdown" });
              }
              return;
            }
          } catch (err: any) {
            await ctx.reply(`❌ Gagal akses taskflow: ${err.message}`);
            return;
          }
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

      // Start VPN button
      if (text.trim() === "🌐 Start VPN") {
        const connected = await this.vpn.isConnected();
        if (connected) {
          await ctx.reply("✅ VPN sudah konek.", { reply_markup: this.getMainKeyboard() });
          return;
        }
        await ctx.reply("🔄 Connecting VPN... approve Silverfort di HP sekarang.", { reply_markup: this.getMainKeyboard() });
        const ok = await this.vpn.connect();
        await ctx.reply(ok ? "✅ VPN konek." : "❌ VPN gagal konek (timeout).", { reply_markup: this.getMainKeyboard() });
        return;
      }

      // Persistent keyboard button — restart langsung tanpa konfirmasi
      if (text.trim() === "🔄 Restart Punakawan") {
        await ctx.reply("🔄 Restarting Punakawan...", { reply_markup: this.getMainKeyboard() });
        setTimeout(() => {
          exec("pm2 restart punakawan", (err) => {
            if (err) {
              ctx.api.sendMessage(ctx.chat!.id, `❌ Restart gagal: ${err.message}`).catch(() => {});
            }
          });
        }, 500);
        return;
      }

      // Restart command — match berbagai variasi
      if (/^restart\b|mau restart|coba restart|restart dulu|fresh restart/i.test(text.trim())) {
        const keyboard = new InlineKeyboard()
          .text("🔄 Restart Sekarang", "restart:now")
          .text("🕐 Nanti", "restart:later");
        await ctx.reply("🔧 Restart Punakawan?", { reply_markup: keyboard });
        return;
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
        if (/^(?:list|cek|lihat|show)\s+(?:reminder|job)s?\b|^(?:reminder|job)s?\s+(?:gue|aku|ku|saya|lo|gw)?\s*(?:apa|aktif|yang ada|sekarang)|^(?:ada\s+)?(?:reminder|job)s?\s+(?:apa|aktif)\b/i.test(text.trim())) {
          const jobs = this.jobManager?.list() || [];
          const reminders = this.reminderManager?.list() || [];
          if (!jobs.length && !reminders.length) {
            await ctx.reply("Tidak ada reminder atau job aktif, nak.");
            return;
          }
          if (jobs.length) {
            await ctx.reply(formatJobList(jobs), { parse_mode: "HTML" });
          }
          if (reminders.length) {
            const lines: string[] = ["📌 <b>Reminders:</b>"];
            reminders.forEach(r =>
              lines.push(r.type === "once"
                ? `• <code>${r.id}</code> — ⏰ ${new Date(r.scheduledAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} — ${r.message}`
                : `• <code>${r.id}</code> — 🔁 ${r.cronLabel} — ${r.message}`)
            );
            await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
          }
          return;
        }

        if (/^(?:list|cek|lihat)\s+reminders?\b|^reminders?\s+(?:gue|aku|ku|saya)?\s*(?:apa|aktif)\b/i.test(text.trim())) {
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

      // Normal flow → dispatch to first available agent
      this.dispatch(ctx, text, text.slice(0, 40));
    });

    // ── Photo messages — only analyze+generate if caption has explicit trigger ─

    this.bot.on("message:photo", async (ctx) => {
      if (this.rejectUnauthorized(ctx)) return;

      const caption = ctx.message.caption?.trim() || "";

      // Check if caption has explicit image-gen trigger
      const genTriggers = /bikin|buat|generate|jadiin|mirip|rekre|ulang|style|gambar|image|ilustrasi/i;
      const wantsGenerate = genTriggers.test(caption);

      // Download image regardless of intent
      await ctx.replyWithChatAction("typing");
      let base64 = "";
      let mimeType: "image/jpeg" | "image/png" = "image/jpeg";
      try {
        const photos = ctx.message.photo;
        const largest = photos[photos.length - 1];
        const file = await ctx.api.getFile(largest.file_id);
        const token = (this.bot as any).token as string;
        const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const imgRes = await fetch(fileUrl);
        if (!imgRes.ok) throw new Error(`Failed to download photo: ${imgRes.status}`);
        const imgBuffer = await imgRes.arrayBuffer();
        base64 = Buffer.from(imgBuffer).toString("base64");
        mimeType = (file.file_path?.endsWith(".png") ? "image/png" : "image/jpeg") as typeof mimeType;
      } catch (err: any) {
        await ctx.reply(`Gagal baca gambar: ${err.message}`);
        return;
      }

      if (!wantsGenerate) {
        try {
          // Use active minion's soul — default semar
          const chatId = ctx.chat?.id!;
          const activeMinionId = [...this.activeTasks.entries()]
            .find(([, cid]) => cid === chatId)?.[0] || "semar";
          const soulConfig = this.configStore.getMinion(activeMinionId)
            || this.configStore.getMinion("semar");
          const soulText = soulConfig ? (this.configStore.loadSystemPrompt(soulConfig) || soulConfig.soul || "") : "";
          const reply = await respondToImage(base64, mimeType, caption, soulText);
          await ctx.reply(reply);
        } catch (err: any) {
          await ctx.reply(`Gue ga bisa liat gambar ini, nak. ${err.message}`);
        }
        return;
      }

      // Generate image variant with fal.ai
      const falConfig = this.configStore.getIntegrations().fal as { enabled?: boolean; apiKey?: string } | undefined;
      if (!falConfig?.enabled || !falConfig.apiKey) {
        await ctx.reply("Image generation belum diaktifkan, nak.");
        return;
      }

      try {
        const { analyzeImageForPrompt } = await import("./fal.js");
        await ctx.replyWithChatAction("typing");
        const generatedPrompt = await analyzeImageForPrompt(base64, mimeType, caption || undefined);
        if (!generatedPrompt) throw new Error("Gagal analisis gambar");

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
      // Capture multi-agent state before cleanup removes this agent from activeTasks
      const wasMultiAgent = this.activeTasks.size > 1 || minionId !== "semar";
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

      // Prefix with agent name when multi-agent is/was active so user knows who responded
      const agentPrefix = wasMultiAgent ? `${minionId}:\n` : "";

      // For task executions: prefix with "selesai" notification on first chunk
      if (isTask) {
        const chunks = splitMessages(content);
        this.sendMsg(chatId, `${agentPrefix}selesai nih nak 🙏\n\n${chunks[0]}`);
        for (let i = 1; i < chunks.length; i++) {
          await new Promise((r) => setTimeout(r, 300));
          this.sendMsg(chatId, chunks[i]);
        }
      } else {
        const prefixed = agentPrefix ? `${agentPrefix}${content}` : content;
        await this.sendLongMsg(chatId, prefixed);
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
