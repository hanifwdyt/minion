/**
 * ReminderManager — one-time & recurring reminders, persisted across restarts.
 * Storage: data/reminders.json
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cron, { ScheduledTask } from "node-cron";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Types ─────────────────────────────────────────────────────

export interface OneTimeReminder {
  id: string;
  type: "once";
  chatId: number;
  message: string;
  scheduledAt: number; // unix ms
  createdAt: number;
}

export interface RecurringReminder {
  id: string;
  type: "recurring";
  chatId: number;
  message: string;
  cronPattern: string;  // standard cron: "0 9 * * *"
  cronLabel: string;    // human readable: "setiap hari jam 09:00"
  createdAt: number;
  active: boolean;
}

export type Reminder = OneTimeReminder | RecurringReminder;

type TriggerCallback = (chatId: number, message: string, reminderId: string) => void;

// ── Storage path ───────────────────────────────────────────────

const DATA_PATH = resolve(__dirname, "../data/reminders.json");

// ── ReminderManager ────────────────────────────────────────────

export class ReminderManager {
  private reminders: Map<string, Reminder> = new Map();
  private timers: Map<string, NodeJS.Timeout | ScheduledTask> = new Map();
  private onTrigger: TriggerCallback;

  constructor(onTrigger: TriggerCallback) {
    this.onTrigger = onTrigger;
  }

  /** Load persisted reminders and reschedule active ones */
  boot() {
    if (!existsSync(DATA_PATH)) return;
    try {
      const raw = JSON.parse(readFileSync(DATA_PATH, "utf-8")) as Reminder[];
      const now = Date.now();
      for (const r of raw) {
        if (r.type === "once") {
          if (r.scheduledAt <= now) continue; // already expired
        }
        this.reminders.set(r.id, r);
        this._schedule(r);
      }
    } catch {
      // Corrupt file — ignore
    }
  }

  /** Add and schedule a new reminder */
  add(reminder: Reminder): void {
    this.reminders.set(reminder.id, reminder);
    this._schedule(reminder);
    this._persist();
  }

  /** Cancel and remove a reminder by id */
  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (!timer) return false;

    if (typeof (timer as any).stop === "function") {
      (timer as ScheduledTask).stop();
    } else {
      clearTimeout(timer as NodeJS.Timeout);
    }
    this.timers.delete(id);
    this.reminders.delete(id);
    this._persist();
    return true;
  }

  /** List all active reminders */
  list(): Reminder[] {
    return Array.from(this.reminders.values());
  }

  // ── Internal ─────────────────────────────────────────────────

  private _schedule(r: Reminder) {
    if (r.type === "once") {
      const delay = r.scheduledAt - Date.now();
      if (delay <= 0) return;
      const timer = setTimeout(() => {
        this.onTrigger(r.chatId, r.message, r.id);
        this.cancel(r.id);
      }, delay);
      this.timers.set(r.id, timer);

    } else if (r.type === "recurring" && r.active) {
      if (!cron.validate(r.cronPattern)) return;
      const task = cron.schedule(r.cronPattern, () => {
        this.onTrigger(r.chatId, r.message, r.id);
      }, { timezone: "Asia/Jakarta" });
      this.timers.set(r.id, task);
    }
  }

  private _persist() {
    const arr = Array.from(this.reminders.values());
    writeFileSync(DATA_PATH, JSON.stringify(arr, null, 2));
  }
}

// ── Parser ────────────────────────────────────────────────────

export interface ParsedReminder {
  type: "once" | "recurring";
  scheduledAt?: number;     // for once
  cronPattern?: string;     // for recurring
  cronLabel?: string;       // for recurring
  message: string;
}

/**
 * Try to parse a reminder intent from natural language (Indonesian/English).
 * Returns null if not a reminder request.
 */
export function parseReminderIntent(text: string): ParsedReminder | null {
  const t = text.trim();

  // Must have trigger keyword
  if (!/ingetin|remind|reminder|kasih\s*tau|alarm|notif/i.test(t)) return null;

  // Extract the reminder message — everything after "buat", "untuk", "soal", dll
  const msgMatch = t.match(/(?:buat|untuk|soal|tentang|bahwa|kalau|:\s*|-\s*)(.+)$/i);
  const message = msgMatch
    ? msgMatch[1].trim()
    : t.replace(/ingetin|remind(?:er)?|kasih\s*tau|alarm|notif/gi, "")
        .replace(/\d{1,2}[.:]\d{2}|\d{1,2}\s*(?:menit|jam)\s*lagi|jam\s+\d+|setiap\s+\S+|besok|gue|gua|aku|saya/gi, "")
        .trim();

  const now = new Date();
  const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7

  // Helper: apply period offset (sore/malam → +12h)
  function applyPeriod(h: number, period: string): number {
    const p = (period || "").toLowerCase();
    if ((p === "sore" || p === "malam") && h < 12) return h + 12;
    if (p === "pagi" && h === 12) return 0;
    return h;
  }

  // Helper: build UTC timestamp from Jakarta HH:MM (today or tomorrow if passed)
  function jakartaHMtoMs(h: number, m: number, tomorrow = false): number {
    const jakartaNow = new Date(now.getTime() + JAKARTA_OFFSET_MS);
    const target = new Date(jakartaNow);
    target.setUTCHours(h, m, 0, 0);
    if (tomorrow) target.setUTCDate(target.getUTCDate() + 1);
    let ms = target.getTime() - JAKARTA_OFFSET_MS;
    if (!tomorrow && ms <= now.getTime()) ms += 24 * 60 * 60 * 1000; // push to tomorrow if passed
    return ms;
  }

  // ── RECURRING patterns ────────────────────────────────────

  // "setiap hari jam X" or "setiap hari X:XX"
  const everydayMatch = t.match(/setiap\s+hari\s+(?:jam\s+)?(\d{1,2})(?:[.:](\d{2}))?(?:\s*(pagi|siang|sore|malam))?/i);
  if (everydayMatch) {
    let h = applyPeriod(parseInt(everydayMatch[1]), everydayMatch[3] || "");
    const m = parseInt(everydayMatch[2] || "0");
    return { type: "recurring", cronPattern: `${m} ${h} * * *`, cronLabel: `setiap hari jam ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`, message };
  }

  // "setiap Senin/Selasa/... jam X"
  const dayNames: Record<string, number> = { senin:1, selasa:2, rabu:3, kamis:4, jumat:5, sabtu:6, minggu:0 };
  const weeklyMatch = t.match(/setiap\s+(senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s+(?:jam\s+)?(\d{1,2})(?:[.:](\d{2}))?(?:\s*(pagi|siang|sore|malam))?/i);
  if (weeklyMatch) {
    const dow = dayNames[weeklyMatch[1].toLowerCase()];
    const h = applyPeriod(parseInt(weeklyMatch[2]), weeklyMatch[4] || "");
    const m = parseInt(weeklyMatch[3] || "0");
    return { type: "recurring", cronPattern: `${m} ${h} * * ${dow}`, cronLabel: `setiap ${weeklyMatch[1]} jam ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`, message };
  }

  // ── ONE-TIME patterns ─────────────────────────────────────

  // "X menit lagi"
  const minutesMatch = t.match(/(\d+)\s*menit\s*lagi/i);
  if (minutesMatch) {
    return { type: "once", scheduledAt: Date.now() + parseInt(minutesMatch[1]) * 60_000, message };
  }

  // "X jam lagi"
  const hoursMatch = t.match(/(\d+)\s*jam\s*lagi/i);
  if (hoursMatch) {
    return { type: "once", scheduledAt: Date.now() + parseInt(hoursMatch[1]) * 3_600_000, message };
  }

  // "besok jam X" or "besok X:XX" or "besok X.XX"
  const tomorrowMatch = t.match(/besok\s+(?:jam\s+)?(\d{1,2})(?:[.:](\d{2}))?(?:\s*(pagi|siang|sore|malam))?/i);
  if (tomorrowMatch) {
    const h = applyPeriod(parseInt(tomorrowMatch[1]), tomorrowMatch[3] || "");
    const m = parseInt(tomorrowMatch[2] || "0");
    return { type: "once", scheduledAt: jakartaHMtoMs(h, m, true), message };
  }

  // "jam X:XX", "jam X.XX", "X:XX", "X.XX" (with minutes)
  const timeWithMinMatch = t.match(/(?:jam\s+)?(\d{1,2})[.:](\d{2})(?:\s*(pagi|siang|sore|malam))?/i);
  if (timeWithMinMatch) {
    const h = applyPeriod(parseInt(timeWithMinMatch[1]), timeWithMinMatch[3] || "");
    const m = parseInt(timeWithMinMatch[2]);
    return { type: "once", scheduledAt: jakartaHMtoMs(h, m), message };
  }

  // "jam X sore/pagi/malam" (without minutes)
  const timeNoMinMatch = t.match(/jam\s+(\d{1,2})(?:\s*(pagi|siang|sore|malam))?/i);
  if (timeNoMinMatch) {
    const h = applyPeriod(parseInt(timeNoMinMatch[1]), timeNoMinMatch[2] || "");
    return { type: "once", scheduledAt: jakartaHMtoMs(h, 0), message };
  }

  return null;
}

/** Format a reminder for display in Telegram */
export function formatReminderConfirmation(r: Reminder): string {
  if (r.type === "once") {
    const d = new Date(r.scheduledAt);
    const timeStr = d.toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "short", timeStyle: "short" });
    return `✅ Reminder set!\n⏰ <b>${timeStr}</b>\n📝 ${r.message}\n<code>id: ${r.id}</code>`;
  } else {
    return `✅ Reminder recurring set!\n🔁 <b>${r.cronLabel}</b>\n📝 ${r.message}\n<code>id: ${r.id}</code>`;
  }
}
