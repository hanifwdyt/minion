/**
 * Scheduled Job System
 * Types: message (static), claude_task (AI-generated), prayer (dynamic daily schedule)
 * Storage: data/jobs.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cron, { ScheduledTask } from "node-cron";

// ── Constants ─────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, "../data/jobs.json");
const DREAM_REPORT_PATH = resolve(__dirname, "../data/dream-report.json");
const TRACES_PATH = resolve(__dirname, "../data/traces");
const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;

const PRAYER_NAMES: Record<string, string> = {
  Fajr: "Subuh", Dhuhr: "Dzuhur", Asr: "Ashar", Maghrib: "Maghrib", Isha: "Isya",
};

// ── Types ─────────────────────────────────────────────────────

// Shared tracking fields — updated after every execution
export interface JobTracking {
  lastRunAt?: string;   // ISO timestamp of last fire
  lastStatus?: "ok" | "error" | "empty"; // empty = Claude returned nothing
  lastError?: string;   // error message if lastStatus === "error"
}

export interface MessageJob extends JobTracking {
  id: string;
  type: "message";
  chatId: number;
  label: string;
  cronPattern: string;
  cronLabel: string;
  message: string;
  createdAt: number;
  active: boolean;
}

export interface ClaudeTaskJob extends JobTracking {
  id: string;
  type: "claude_task";
  chatId: number;
  label: string;
  cronPattern: string;
  cronLabel: string;
  taskPrompt: string;
  createdAt: number;
  active: boolean;
}

export interface PrayerJob extends JobTracking {
  id: string;
  type: "prayer";
  chatId: number;
  label: string;
  location: string; // e.g. "Jakarta" or "Depok"
  createdAt: number;
  active: boolean;
}

export interface DreamJob {
  id: string;
  type: "dream";
  chatId: number;
  label: string;
  createdAt: number;
  active: boolean;
}

export type ScheduledJob = MessageJob | ClaudeTaskJob | PrayerJob | DreamJob;

type SendCallback = (chatId: number, text: string) => void;

// ── Prayer time fetch ─────────────────────────────────────────

async function fetchPrayerTimes(location: string): Promise<Record<string, string> | null> {
  try {
    const city = location.trim();
    const url = `https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Indonesia&method=20`;
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const data = await res.json() as { data: { timings: Record<string, string> } };
    const t = data.data.timings;
    return { Fajr: t.Fajr, Dhuhr: t.Dhuhr, Asr: t.Asr, Maghrib: t.Maghrib, Isha: t.Isha };
  } catch {
    return null;
  }
}

// ── Claude API call for task execution ───────────────────────

async function runClaudeTask(taskPrompt: string): Promise<string> {
  const apiKey = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!apiKey) throw new Error("No API key");

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: "Kamu adalah Semar, asisten pribadi yang bijak. Jawab dengan ringkas, padat, dan informatif. Gunakan bahasa Indonesia yang natural. Format yang rapi — gunakan bold, bullet points jika perlu.", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: taskPrompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json() as { content: Array<{ text: string }> };
  return data.content?.[0]?.text?.trim() || "";
}

// ── Natural language → Job spec via Claude ───────────────────

export interface ParsedJob {
  type: "message" | "claude_task" | "prayer" | "unknown";
  label: string;
  cronPattern?: string;
  cronLabel?: string;
  message?: string;
  taskPrompt?: string;
  location?: string;
}

const PARSE_SYSTEM = `Kamu adalah parser job scheduler. Diberikan perintah user dalam bahasa Indonesia, ekstrak job spec.

Output HANYA JSON valid satu baris:
- message job: {"type":"message","label":"...","cronPattern":"...","cronLabel":"...","message":"..."}
- claude_task job: {"type":"claude_task","label":"...","cronPattern":"...","cronLabel":"...","taskPrompt":"..."}
- prayer job: {"type":"prayer","label":"Pengingat sholat 5 waktu","location":"Jakarta"}
- tidak bisa parse: {"type":"unknown"}

Aturan cronPattern (timezone Asia/Jakarta):
- "setiap hari jam 7 pagi" → "0 7 * * *"
- "setiap hari jam 21:00" → "0 21 * * *"
- "setiap Senin jam 9" → "0 9 * * 1"
- "setiap jam" → "0 * * * *"

Aturan taskPrompt untuk claude_task:
- Tulis prompt yang self-contained, spesifik, dan bisa dieksekusi tanpa context tambahan
- Contoh: "Berikan 1 hadits shahih hari ini beserta sumber dan makna singkatnya dalam bahasa Indonesia"
- Contoh: "Cari dan rangkum top 3 berita Indonesia hari ini. Format: judul bold, 1-2 kalimat ringkasan, emoji relevan"

Aturan tipe:
- Pesan statis sederhana ("ingetin", "kasih tau") → message
- Perlu generate/cari konten (berita, hadits, quote, cuaca, tips) → claude_task
- Sholat/adzan/ibadah waktu → prayer`;

export async function parseJobIntent(text: string): Promise<ParsedJob | null> {
  // Quick pre-check — must have recurring/job keywords
  if (!/setiap|tiap|rutin|jadwal|kirimin|kirim.*gue|kasih.*gue|kasih.*saya|ingetin.*setiap|remind.*every|daily|weekly|sholat|adzan/i.test(text)) {
    return null;
  }

  const apiKey = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!apiKey) return null;

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 256,
        system: [{ type: "text", text: PARSE_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { content: Array<{ text: string }> };
    const raw = data.content?.[0]?.text?.trim() || "";
    const parsed = JSON.parse(raw) as ParsedJob;
    if (parsed.type === "unknown") return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Dream analysis ────────────────────────────────────────────

interface TraceEntry {
  minionId: string;
  prompt: string;
  status: string;
  cost: number;
  loopDetections: number;
  weight: number; // emotional significance: cost*10 + loops*2 + error*3
}

interface DreamReport {
  refleksi: string[];
  ide_fitur: string[];
  ringkasan: string;
  memory_insights: string[];
  top_events: string[];
  aksi: Array<{ prompt: string; workdir: string }>;
}

const MEMORY_DIR = resolve("/root/.claude/projects/-root-minion/memory");

function readRecentTraces(hoursBack = 24): TraceEntry[] {
  if (!existsSync(TRACES_PATH)) return [];
  const cutoff = Date.now() - hoursBack * 60 * 60 * 1000;
  const entries: TraceEntry[] = [];

  try {
    const files = readdirSync(TRACES_PATH).filter(f => f.endsWith(".json"));
    for (const f of files) {
      const parts = f.replace(".json", "").split("-");
      const ts = parseInt(parts[parts.length - 1] || "0");
      if (ts < cutoff) continue;
      try {
        const raw = JSON.parse(readFileSync(resolve(TRACES_PATH, f), "utf-8"));
        const cost = raw.cost || 0;
        const loops = raw.loopDetections || 0;
        const isError = raw.status === "error" || raw.status === "failed";
        entries.push({
          minionId: raw.minionId || "?",
          prompt: (raw.prompt || "").slice(0, 150),
          status: raw.status || "unknown",
          cost,
          loopDetections: loops,
          weight: cost * 10 + loops * 2 + (isError ? 3 : 0),
        });
      } catch { /* skip corrupt */ }
    }
  } catch { /* skip */ }

  return entries.sort((a, b) => b.weight - a.weight).slice(0, 30);
}

async function runDreamAnalysis(traces: TraceEntry[]): Promise<string> {
  const apiKey = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!apiKey) throw new Error("No API key");

  const totalCost = traces.reduce((s, t) => s + t.cost, 0).toFixed(4);
  const errorCount = traces.filter(t => t.status === "error" || t.status === "failed").length;

  const top5 = traces.slice(0, 5)
    .map(t => `• [${t.minionId}|w=${t.weight.toFixed(1)}] "${t.prompt.slice(0, 80)}" → ${t.status}`)
    .join("\n");

  const all = traces.length > 0
    ? traces.map(t => `• [${t.minionId}] ${t.prompt.slice(0, 80)} (${t.status})`).join("\n")
    : "Tidak ada aktivitas.";

  const prompt = `Aktivitas Punakawan hari ini: ${traces.length} task, biaya $${totalCost}, ${errorCount} error.

TOP EVENTS (bobot emosi tertinggi):
${top5 || "—"}

SEMUA AKTIVITAS:
${all}

Output HANYA JSON valid — tidak ada teks lain:
{
  "ringkasan": "1-2 kalimat tentang hari ini",
  "refleksi": ["poin 1", "poin 2", "poin 3"],
  "ide_fitur": ["ide 1", "ide 2", "ide 3"],
  "memory_insights": ["insight layak disimpan jangka panjang 1", "insight 2", "insight 3"],
  "top_events": ["event paling signifikan 1", "event 2"],
  "aksi": [
    {
      "prompt": "instruksi konkret yang bisa langsung dieksekusi Claude Code — harus self-contained, spesifik, dan actionable. Contoh: 'Update knowledge file data/knowledge/gitlab-workflow.md — tambahkan section troubleshooting untuk error 401'. Bukan observasi, bukan saran — perintah eksekusi.",
      "workdir": "/root/minion"
    }
  ]
}

Aturan untuk field aksi:
- Isi HANYA jika ada sesuatu yang konkret bisa diperbaiki/diupdate malam ini tanpa approval user
- Contoh valid: update knowledge file, update soul/config, fix typo di docs internal, clean up data stale
- Contoh TIDAK valid: "fix bug di MR" (butuh context), "improve VPN" (terlalu abstrak), "hubungi user" (butuh approval)
- Maksimal 3 aksi. Kalau tidak ada yang jelas bisa dikerjakan: aksi = []
- workdir selalu "/root/minion" kecuali ada repo spesifik yang disebutkan dalam traces`;

  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 1800,
      system: "Kamu adalah Semar dalam fase NREM — memilah mana yang penting untuk diingat jangka panjang, dan mengidentifikasi aksi konkret yang bisa dilakukan mandiri malam ini. Jawab HANYA JSON valid.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json() as { content: Array<{ text: string }> };
  let text = data.content?.[0]?.text?.trim() || "{}";
  // Strip markdown code block wrapper if Claude returns ```json ... ```
  if (text.startsWith("```")) {
    text = text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
  }
  return text;
}

function writeMemoryConsolidation(report: DreamReport, dateStr: string): void {
  if (!existsSync(MEMORY_DIR)) return;

  const fileName = `nrem_${dateStr}.md`;
  const filePath = resolve(MEMORY_DIR, fileName);

  const content = [
    `---`,
    `name: NREM Consolidation ${dateStr}`,
    `description: Memory harian dari aktivitas ${dateStr} — pola, pelajaran, insights jangka panjang`,
    `type: project`,
    `---`,
    ``,
    report.ringkasan,
    ``,
    `**Why:** Transfer hippocampus → neocortex dari aktivitas hari ini.`,
    `**How to apply:** Gunakan sebagai konteks saat ada task serupa esok hari.`,
    ``,
    `## Memory Insights (NREM Transfer)`,
    ...(report.memory_insights || []).map(m => `- ${m}`),
    ``,
    `## Top Events`,
    ...(report.top_events || []).map(e => `- ${e}`),
    ``,
    `## Refleksi`,
    ...(report.refleksi || []).map((r, i) => `${i + 1}. ${r}`),
  ].join("\n");

  writeFileSync(filePath, content);

  // Update MEMORY.md — keep last 7 NREM entries to avoid bloat
  const memoryMdPath = resolve(MEMORY_DIR, "MEMORY.md");
  if (existsSync(memoryMdPath)) {
    let md = readFileSync(memoryMdPath, "utf-8");
    const entry = `- [NREM ${dateStr}](${fileName}) — Konsolidasi harian: insights & pola`;
    if (!md.includes(fileName)) {
      if (md.includes("## NREM History")) {
        const lines = md.split("\n");
        const idx = lines.findIndex(l => l === "## NREM History");
        lines.splice(idx + 1, 0, entry);
        let count = 0;
        const filtered = lines.filter((l, i) => {
          if (i > idx && l.startsWith("- [NREM")) { count++; return count <= 7; }
          return true;
        });
        md = filtered.join("\n");
      } else {
        md += `\n## NREM History\n${entry}\n`;
      }
      writeFileSync(memoryMdPath, md);
    }
  }
  console.log(`[JobManager] NREM memory written: ${fileName}`);
}

function formatDreamReport(raw: string, dispatchedAksi: string[] = []): string {
  try {
    const report = JSON.parse(raw) as DreamReport;
    const lines = [
      "☀️ *Selamat pagi, nak.*",
      "",
      `_Semalam gue bermimpi... ${report.ringkasan || "hari yang padat."}_`,
      "",
      "🪬 *Refleksi Diri*",
      ...(report.refleksi || []).map((r, i) => `${i + 1}. ${r}`),
      "",
      "💡 *Ide dari Mimpi*",
      ...(report.ide_fitur || []).map((r, i) => `${i + 1}. ${r}`),
      "",
      "🧠 *Yang Gue Simpan ke Memory (NREM)*",
      ...(report.memory_insights || []).map(m => `• ${m}`),
    ];

    if (dispatchedAksi.length > 0) {
      lines.push("", "🔧 *Yang Udah Gue Kerjain Semalam*");
      dispatchedAksi.forEach((a, i) => lines.push(`${i + 1}. ${a.slice(0, 120)}`));
    }

    return lines.join("\n");
  } catch {
    return "☀️ Selamat pagi, nak. Semalam gue bermimpi — tapi mimpinya terlalu abstrak untuk diceritakan. 😅";
  }
}


// ── JobManager ────────────────────────────────────────────────

type RunTaskCallback = (minionId: string, prompt: string, workdir: string) => void;

export class JobManager {
  private jobs: Map<string, ScheduledJob> = new Map();
  private cronTasks: Map<string, ScheduledTask> = new Map();
  private prayerTimers: Map<string, NodeJS.Timeout[]> = new Map();
  private send: SendCallback;
  private runTask: RunTaskCallback | null = null;

  constructor(send: SendCallback, runTask?: RunTaskCallback) {
    this.send = send;
    this.runTask = runTask || null;
  }

  /** Load persisted jobs and reschedule all active ones */
  boot() {
    if (!existsSync(DATA_PATH)) return;
    try {
      const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as ScheduledJob[];
      for (const job of raw) {
        if (!job.active) continue;
        this.jobs.set(job.id, job);
        this._schedule(job);
      }
      console.log(`[JobManager] Loaded ${this.jobs.size} active jobs`);
    } catch (e) {
      console.error("[JobManager] Failed to load jobs:", e);
    }
  }

  /** Add and persist a new job */
  add(job: ScheduledJob): void {
    this.jobs.set(job.id, job);
    this._schedule(job);
    this._persist();
  }

  /** Cancel a job */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    // Stop cron (dream jobs use three keys)
    for (const key of [id, `${id}-pamit`, `${id}-dream`, `${id}-wake`]) {
      const task = this.cronTasks.get(key);
      if (task) { task.stop(); this.cronTasks.delete(key); }
    }

    // Clear prayer timers
    const timers = this.prayerTimers.get(id);
    if (timers) { timers.forEach(clearTimeout); this.prayerTimers.delete(id); }

    this.jobs.delete(id);
    this._persist();
    return true;
  }

  /** List all active jobs */
  list(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  // ── Internal scheduling ───────────────────────────────────

  private _schedule(job: ScheduledJob) {
    if (job.type === "prayer") {
      this._schedulePrayer(job);
      return;
    }
    if (job.type === "dream") {
      this._scheduleDream(job);
      return;
    }

    const pattern = (job as MessageJob | ClaudeTaskJob).cronPattern;
    if (!pattern || !cron.validate(pattern)) return;

    const task = cron.schedule(pattern, async () => {
      await this._execute(job);
    }, { timezone: "Asia/Jakarta" });

    this.cronTasks.set(job.id, task);
  }

  private _scheduleDream(job: DreamJob) {
    // Pamit cron: 22:55 WIB — say goodnight before sleep guard kicks in at 23:00
    const pamitTask = cron.schedule("55 22 * * *", () => {
      const msgs = [
        "🌙 Malam nak, gue mau istirahat dulu. Sampai pagi ya — gue bakal cerita kalau ada mimpi menarik. 💤",
        "🌙 Punakawan mau rehat dulu, nak. Cape seharian tapi senang bisa bantuin. Selamat malam! 🌿",
        "🌙 Gue permisi dulu ya, nak. Sudah waktunya tidur — biar besok makin segar. Sampai pagi! ✨",
      ];
      this.send(job.chatId, msgs[Math.floor(Math.random() * msgs.length)]);
    }, { timezone: "Asia/Jakarta" });

    // NREM cron: 23:05 WIB — analyze traces, consolidate memory (hippocampus → neocortex)
    const dreamTask = cron.schedule("5 23 * * *", async () => {
      console.log("[JobManager] NREM starting — analyzing 24h traces...");
      const dispatchedAksi: string[] = [];
      try {
        const traces = readRecentTraces(24);
        const raw = await runDreamAnalysis(traces);

        // NREM transfer: write consolidated insights to long-term memory
        try {
          const report = JSON.parse(raw) as DreamReport;
          const dateStr = new Date().toISOString().slice(0, 10);
          writeMemoryConsolidation(report, dateStr);

          // Autonomous refleksi execution — dispatch aksi konkret tanpa approval user
          if (this.runTask && Array.isArray(report.aksi) && report.aksi.length > 0) {
            for (const aksi of report.aksi.slice(0, 3)) {
              if (aksi.prompt && typeof aksi.prompt === "string") {
                console.log(`[JobManager] NREM dispatching aksi: ${aksi.prompt.slice(0, 80)}...`);
                this.runTask("semar", aksi.prompt, aksi.workdir || "/root/minion");
                dispatchedAksi.push(aksi.prompt);
              }
            }
          }
        } catch { /* continue even if memory write or dispatch fails */ }

        writeFileSync(DREAM_REPORT_PATH, JSON.stringify({
          generatedAt: new Date().toISOString(),
          raw,
          traces: traces.length,
          dispatchedAksi,
        }, null, 2));
        console.log("[JobManager] NREM complete — dream report saved.");
      } catch (e) {
        console.error("[JobManager] Dream analysis failed:", e);
      }
    }, { timezone: "Asia/Jakarta" });

    // Wake cron: 05:05 WIB — send morning dream summary
    const wakeTask = cron.schedule("5 5 * * *", async () => {
      console.log("[JobManager] Wake mode — sending morning dream report...");
      try {
        if (!existsSync(DREAM_REPORT_PATH)) return;
        const saved = JSON.parse(readFileSync(DREAM_REPORT_PATH, "utf-8")) as { raw: string; dispatchedAksi?: string[] };
        const msg = formatDreamReport(saved.raw, saved.dispatchedAksi || []);
        this.send(job.chatId, msg);
      } catch (e) {
        console.error("[JobManager] Wake send failed:", e);
      }
    }, { timezone: "Asia/Jakarta" });

    this.cronTasks.set(`${job.id}-pamit`, pamitTask);
    this.cronTasks.set(`${job.id}-dream`, dreamTask);
    this.cronTasks.set(`${job.id}-wake`, wakeTask);
    console.log("[JobManager] Dream crons scheduled (pamit 22:55, NREM 23:05, wake 05:05 WIB)");
  }

  private _schedulePrayer(job: PrayerJob) {
    // Fetch and schedule prayer times immediately for today
    this._schedulePrayerDay(job);

    // Then reschedule every day at 00:01 Jakarta time
    const dailyTask = cron.schedule("1 0 * * *", () => {
      this._schedulePrayerDay(job);
    }, { timezone: "Asia/Jakarta" });

    this.cronTasks.set(job.id, dailyTask);
  }

  private async _schedulePrayerDay(job: PrayerJob, retryCount = 0) {
    // Clear existing prayer timers for this job
    const existing = this.prayerTimers.get(job.id);
    if (existing) { existing.forEach(clearTimeout); }

    const times = await fetchPrayerTimes(job.location);
    if (!times) {
      console.error(`[JobManager] Failed to fetch prayer times for ${job.location} (attempt ${retryCount + 1})`);
      if (retryCount < 2) {
        // Retry after 30 minutes (max 2 retries)
        const retryTimer = setTimeout(() => this._schedulePrayerDay(job, retryCount + 1), 30 * 60 * 1000);
        this.prayerTimers.set(job.id, [retryTimer]);
        if (retryCount === 0) {
          this.send(job.chatId, `⚠️ Gagal ambil jadwal sholat ${job.location} hari ini. Gue coba lagi dalam 30 menit, nak.`);
        }
      } else {
        this.send(job.chatId, `❌ Jadwal sholat ${job.location} tidak bisa diambil setelah 3 percobaan. Cek koneksi atau coba restart.\n<code>id: ${job.id}</code>`);
      }
      return;
    }

    const now = Date.now();
    const timers: NodeJS.Timeout[] = [];

    for (const [key, timeStr] of Object.entries(times)) {
      const [hStr, mStr] = timeStr.split(":");
      const h = parseInt(hStr);
      const m = parseInt(mStr);

      // Build target timestamp in Jakarta timezone
      const jakartaNow = new Date(now + JAKARTA_OFFSET_MS);
      const target = new Date(jakartaNow);
      target.setUTCHours(h, m, 0, 0);
      const targetMs = target.getTime() - JAKARTA_OFFSET_MS;

      // Only schedule if in the future (with 60s buffer to avoid firing stale timers on restart)
      if (targetMs <= now + 60_000) continue;

      const delay = targetMs - now;
      const prayerName = PRAYER_NAMES[key] || key;
      const timer = setTimeout(() => {
        this.send(job.chatId, `🕌 Waktunya sholat *${prayerName}*, nak. _${timeStr} WIB_\n\n_Berhenti sejenak, luruskan niat._ 🤲`);
      }, delay);

      timers.push(timer);
    }

    this.prayerTimers.set(job.id, timers);

    const scheduledNames = Object.entries(times)
      .filter(([key, timeStr]) => {
        const [h, m] = timeStr.split(":").map(Number);
        const jakartaNow = new Date(now + JAKARTA_OFFSET_MS);
        const target = new Date(jakartaNow);
        target.setUTCHours(h, m, 0, 0);
        return (target.getTime() - JAKARTA_OFFSET_MS) > now + 60_000;
      })
      .map(([key, t]) => `${PRAYER_NAMES[key] || key} ${t}`)
      .join(", ");

    console.log(`[JobManager] Prayer times loaded for ${job.location}: ${scheduledNames || "none remaining today"}`);
  }

  private async _execute(job: ScheduledJob) {
    const now = new Date().toISOString();
    try {
      if (job.type === "message") {
        this.send(job.chatId, (job as MessageJob).message);
        this._track(job, "ok", now);
      } else if (job.type === "claude_task") {
        const result = await runClaudeTask((job as ClaudeTaskJob).taskPrompt);
        if (result) {
          this.send(job.chatId, result);
          this._track(job, "ok", now);
        } else {
          this._track(job, "empty", now, "Claude returned empty response");
          this.send(job.chatId, `⚠️ Job *${(job as ClaudeTaskJob).label}* gagal — Claude tidak menghasilkan konten.\n<code>id: ${job.id}</code>`);
        }
      }
      // dream jobs handled by their own crons
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[JobManager] Job ${job.id} execution failed:`, e);
      this._track(job, "error", now, errMsg);
      this.send(job.chatId, `❌ Job *${(job as ClaudeTaskJob | MessageJob).label}* error:\n<code>${errMsg}</code>\n<code>id: ${job.id}</code>`);
    }
  }

  /** Update tracking fields and persist */
  private _track(job: ScheduledJob, status: "ok" | "error" | "empty", runAt: string, error?: string) {
    const tracked = job as ScheduledJob & JobTracking;
    tracked.lastRunAt = runAt;
    tracked.lastStatus = status;
    tracked.lastError = error;
    this.jobs.set(job.id, tracked);
    this._persist();
  }

  private _persist() {
    const arr = Array.from(this.jobs.values());
    writeFileSync(DATA_PATH, JSON.stringify(arr, null, 2));
  }
}

// ── Format job confirmation for Telegram ─────────────────────

export function formatJobConfirmation(job: ScheduledJob): string {
  if (job.type === "prayer") {
    return `✅ Job set!\n🕌 <b>Pengingat sholat 5 waktu</b>\n📍 Lokasi: ${(job as PrayerJob).location}\n<code>id: ${job.id}</code>`;
  }
  const j = job as MessageJob | ClaudeTaskJob;
  const typeIcon = job.type === "claude_task" ? "🤖" : "💬";
  return `✅ Job set!\n${typeIcon} <b>${j.label}</b>\n🔁 ${j.cronLabel}\n<code>id: ${job.id}</code>`;
}

export function formatJobList(jobs: ScheduledJob[]): string {
  if (jobs.length === 0) return "Tidak ada job aktif.";

  const lines: string[] = ["📋 <b>Job Aktif</b>\n"];

  for (const job of jobs) {
    const tracked = job as ScheduledJob & JobTracking;

    let icon = "💬";
    let desc = "";
    if (job.type === "claude_task") { icon = "🤖"; desc = (job as ClaudeTaskJob).cronLabel; }
    else if (job.type === "prayer") { icon = "🕌"; desc = `Sholat 5 waktu — ${(job as PrayerJob).location}`; }
    else if (job.type === "dream") { icon = "🌙"; desc = "NREM 23:05, wake 05:05"; }
    else if (job.type === "message") { desc = (job as MessageJob).cronLabel; }

    const label = (job as MessageJob | ClaudeTaskJob).label || job.type;

    let statusLine = "";
    if (tracked.lastRunAt) {
      const wib = new Date(new Date(tracked.lastRunAt).getTime() + JAKARTA_OFFSET_MS);
      const dateStr = wib.toISOString().replace("T", " ").slice(0, 16) + " WIB";
      const statusIcon = tracked.lastStatus === "ok" ? "✅" : tracked.lastStatus === "empty" ? "⚠️" : "❌";
      statusLine = `\n   ${statusIcon} Terakhir: ${dateStr}`;
      if (tracked.lastStatus === "error" && tracked.lastError) {
        statusLine += `\n   <i>${tracked.lastError.slice(0, 80)}</i>`;
      }
    } else {
      statusLine = "\n   ⏳ Belum pernah jalan";
    }

    lines.push(`${icon} <b>${label}</b>\n   ${desc}${statusLine}\n   <code>${job.id}</code>`);
  }

  return lines.join("\n\n");
}
