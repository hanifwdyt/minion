import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const AUDIT_PATH = resolve(DATA_DIR, "audit.jsonl");

export interface AuditEntry {
  id: string;
  timestamp: number;
  minionId: string;
  minionName: string;
  type: "prompt" | "response" | "tool" | "status" | "error" | "pipeline" | "delegate" | "config" | "auth";
  summary: string;
  metadata?: Record<string, any>;
}

export class AuditLog extends EventEmitter {
  private recentCache: AuditEntry[] = [];
  private maxCache = 200;

  constructor() {
    super();
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    // Load last N entries from file into cache
    this.loadRecent();
  }

  add(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    const full: AuditEntry = {
      ...entry,
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    // Append to file (append-only, immutable)
    try {
      appendFileSync(AUDIT_PATH, JSON.stringify(full) + "\n");
    } catch (err) {
      console.error("[audit] Failed to append:", err);
    }

    // Update cache
    this.recentCache.push(full);
    if (this.recentCache.length > this.maxCache) {
      this.recentCache = this.recentCache.slice(-this.maxCache);
    }

    this.emit("activity", full); // Compatible with existing activity event name
    return full;
  }

  getRecent(limit = 50): AuditEntry[] {
    return this.recentCache.slice(-limit);
  }

  // Query audit log by date range
  query(opts: { from?: number; to?: number; minionId?: string; type?: string; limit?: number }): AuditEntry[] {
    const limit = opts.limit || 100;
    const results: AuditEntry[] = [];

    if (!existsSync(AUDIT_PATH)) return [];

    // Read file line by line (reverse for most recent first)
    const lines = readFileSync(AUDIT_PATH, "utf-8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0 && results.length < limit; i--) {
      try {
        const entry: AuditEntry = JSON.parse(lines[i]);
        if (opts.from && entry.timestamp < opts.from) continue;
        if (opts.to && entry.timestamp > opts.to) continue;
        if (opts.minionId && entry.minionId !== opts.minionId) continue;
        if (opts.type && entry.type !== opts.type) continue;
        results.push(entry);
      } catch { /* skip malformed lines */ }
    }

    return results;
  }

  private loadRecent() {
    if (!existsSync(AUDIT_PATH)) return;
    try {
      const lines = readFileSync(AUDIT_PATH, "utf-8").split("\n").filter(Boolean);
      const recent = lines.slice(-this.maxCache);
      this.recentCache = recent.map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);
    } catch { /* ignore */ }
  }
}
