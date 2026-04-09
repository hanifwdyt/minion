import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from "fs";
import { join, extname } from "path";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

export interface OutputMeta {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  minionId: string;
  minionName: string;
  label: string;
  createdAt: number;
}

const OUTPUT_DIR = join(import.meta.dirname, "..", "data", "outputs");
const META_FILE = join(OUTPUT_DIR, "_meta.json");

export class OutputStore extends EventEmitter {
  private meta: OutputMeta[] = [];

  constructor() {
    super();
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    this.loadMeta();
  }

  private loadMeta() {
    if (existsSync(META_FILE)) {
      try {
        this.meta = JSON.parse(readFileSync(META_FILE, "utf-8"));
      } catch {
        this.meta = [];
      }
    }
  }

  private saveMeta() {
    writeFileSync(META_FILE, JSON.stringify(this.meta, null, 2));
  }

  add(buffer: Buffer, opts: { originalName: string; mimeType: string; minionId: string; minionName: string; label: string }): OutputMeta {
    const id = randomUUID();
    const ext = extname(opts.originalName) || this.mimeToExt(opts.mimeType);
    const filename = `${id}${ext}`;
    const filePath = join(OUTPUT_DIR, filename);

    writeFileSync(filePath, buffer);

    const entry: OutputMeta = {
      id,
      filename,
      originalName: opts.originalName,
      mimeType: opts.mimeType,
      size: buffer.length,
      minionId: opts.minionId,
      minionName: opts.minionName,
      label: opts.label,
      createdAt: Date.now(),
    };

    this.meta.push(entry);
    this.saveMeta();
    this.emit("output:new", entry);
    return entry;
  }

  getAll(): OutputMeta[] {
    return [...this.meta].reverse();
  }

  getById(id: string): OutputMeta | undefined {
    return this.meta.find((m) => m.id === id);
  }

  getFilePath(id: string): string | null {
    const entry = this.getById(id);
    if (!entry) return null;
    const p = join(OUTPUT_DIR, entry.filename);
    return existsSync(p) ? p : null;
  }

  delete(id: string): boolean {
    const entry = this.getById(id);
    if (!entry) return false;
    const p = join(OUTPUT_DIR, entry.filename);
    if (existsSync(p)) unlinkSync(p);
    this.meta = this.meta.filter((m) => m.id !== id);
    this.saveMeta();
    return true;
  }

  private mimeToExt(mime: string): string {
    const map: Record<string, string> = {
      "application/pdf": ".pdf",
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "text/html": ".html",
      "text/plain": ".txt",
      "application/json": ".json",
      "text/csv": ".csv",
    };
    return map[mime] || ".bin";
  }
}
