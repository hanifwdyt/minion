import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");

interface ChatMessage {
  id: string;
  minionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
}

export class ChatStore {
  private messages: Map<string, ChatMessage[]> = new Map();
  private dirty: Set<string> = new Set();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private maxMessagesPerMinion = 500;

  constructor() {
    // Ensure data dir exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    // Auto-flush every 5s
    this.flushTimer = setInterval(() => this.flush(), 5000);
  }

  load(minionId: string): ChatMessage[] {
    if (this.messages.has(minionId)) {
      return this.messages.get(minionId)!;
    }

    const filePath = resolve(DATA_DIR, `${minionId}.json`);
    let msgs: ChatMessage[] = [];
    if (existsSync(filePath)) {
      try {
        msgs = JSON.parse(readFileSync(filePath, "utf-8"));
        console.log(`[chat-store] Loaded ${msgs.length} messages for ${minionId}`);
      } catch (err) {
        console.warn(`[chat-store] Failed to parse ${filePath}, starting fresh:`, err);
        msgs = [];
      }
    }
    this.messages.set(minionId, msgs);
    return msgs;
  }

  add(minionId: string, message: ChatMessage) {
    const msgs = this.load(minionId);
    msgs.push(message);
    this.dirty.add(minionId);
  }

  updateContent(minionId: string, messageId: string, content: string) {
    const msgs = this.load(minionId);
    const msg = msgs.find((m) => m.id === messageId);
    if (msg) {
      msg.content = content;
      this.dirty.add(minionId);
    }
  }

  clear(minionId: string) {
    this.messages.set(minionId, []);
    this.dirty.add(minionId);
    this.flushOne(minionId);
  }

  getAll(minionId: string): ChatMessage[] {
    return this.load(minionId);
  }

  private flushOne(minionId: string) {
    const msgs = this.messages.get(minionId);
    if (!msgs) return;
    const filePath = resolve(DATA_DIR, `${minionId}.json`);
    const tmpPath = filePath + ".tmp";
    try {
      // Atomic write: write to tmp, then rename
      writeFileSync(tmpPath, JSON.stringify(msgs, null, 2));
      renameSync(tmpPath, filePath);
    } catch (err) {
      console.error(`[chat-store] Failed to write ${filePath}:`, err);
    }
  }

  flush() {
    for (const minionId of this.dirty) {
      this.flushOne(minionId);
    }
    this.dirty.clear();
  }

  destroy() {
    this.flush();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
