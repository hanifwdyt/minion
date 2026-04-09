import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORIES_DIR = resolve(__dirname, "../data/memories");
const KNOWLEDGE_DIR = resolve(__dirname, "../data/knowledge");

export interface Memory {
  id: string;
  minionId: string;
  type: "episodic" | "semantic";
  content: string;
  context: string;
  outcome: "success" | "failure" | "unknown";
  tags: string[];
  timestamp: number;
}

export class MemoryStore {
  private memories: Map<string, Memory[]> = new Map();

  constructor() {
    for (const dir of [MEMORIES_DIR, KNOWLEDGE_DIR]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }
  }

  // --- Episodic Memory ---

  addMemory(memory: Omit<Memory, "id" | "timestamp">): Memory {
    const entry: Memory = {
      ...memory,
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    const mems = this.loadMemories(memory.minionId);
    mems.push(entry);
    // Cap at 100 memories per minion
    if (mems.length > 100) mems.splice(0, mems.length - 100);
    this.memories.set(memory.minionId, mems);
    this.saveMemories(memory.minionId);
    return entry;
  }

  // Search memories by keyword relevance (simple tf-based scoring)
  searchMemories(minionId: string, query: string, limit = 3): Memory[] {
    const mems = this.loadMemories(minionId);
    if (!query.trim() || mems.length === 0) return [];

    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (queryWords.length === 0) return mems.slice(-limit);

    const scored = mems.map((m) => {
      const text = `${m.content} ${m.context} ${m.tags.join(" ")}`.toLowerCase();
      const score = queryWords.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      // Boost recent memories
      const recency = 1 + Math.max(0, 1 - (Date.now() - m.timestamp) / (7 * 24 * 60 * 60 * 1000));
      return { memory: m, score: score * recency };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.memory);
  }

  getMemories(minionId: string): Memory[] {
    return this.loadMemories(minionId);
  }

  deleteMemory(minionId: string, memoryId: string): boolean {
    const mems = this.loadMemories(minionId);
    const idx = mems.findIndex((m) => m.id === memoryId);
    if (idx === -1) return false;
    mems.splice(idx, 1);
    this.saveMemories(minionId);
    return true;
  }

  // Build memory context string for system prompt injection
  buildMemoryContext(minionId: string, prompt: string): string {
    const relevant = this.searchMemories(minionId, prompt, 3);
    if (relevant.length === 0) return "";

    const lines = relevant.map((m) => {
      const outcome = m.outcome !== "unknown" ? ` (${m.outcome})` : "";
      return `- ${m.content}${outcome}`;
    });

    return `\n---\n\n## Relevant Past Experiences\n${lines.join("\n")}`;
  }

  // --- Knowledge Base ---

  getKnowledgeFiles(): { name: string; content: string }[] {
    if (!existsSync(KNOWLEDGE_DIR)) return [];
    return readdirSync(KNOWLEDGE_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({
        name: f.replace(".md", ""),
        content: readFileSync(resolve(KNOWLEDGE_DIR, f), "utf-8"),
      }));
  }

  getKnowledge(name: string): string {
    const filePath = resolve(KNOWLEDGE_DIR, `${name}.md`);
    if (existsSync(filePath)) return readFileSync(filePath, "utf-8");
    return "";
  }

  setKnowledge(name: string, content: string): void {
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = resolve(KNOWLEDGE_DIR, `${safeName}.md`);
    const tmpPath = filePath + ".tmp";
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, filePath);
  }

  buildKnowledgeContext(): string {
    const files = this.getKnowledgeFiles();
    if (files.length === 0) return "";
    const sections = files.map((f) => `### ${f.name}\n${f.content}`);
    return `\n---\n\n## Knowledge Base\n${sections.join("\n\n")}`;
  }

  // --- Persistence ---

  private loadMemories(minionId: string): Memory[] {
    if (this.memories.has(minionId)) return this.memories.get(minionId)!;
    const filePath = resolve(MEMORIES_DIR, `${minionId}.json`);
    let mems: Memory[] = [];
    if (existsSync(filePath)) {
      try {
        mems = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch { mems = []; }
    }
    this.memories.set(minionId, mems);
    return mems;
  }

  private saveMemories(minionId: string): void {
    const mems = this.memories.get(minionId);
    if (!mems) return;
    const filePath = resolve(MEMORIES_DIR, `${minionId}.json`);
    const tmpPath = filePath + ".tmp";
    try {
      writeFileSync(tmpPath, JSON.stringify(mems, null, 2));
      renameSync(tmpPath, filePath);
    } catch (err) {
      console.error(`[memory] Failed to save ${minionId}:`, err);
    }
  }
}
