import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";

export interface RestartTask {
  context: string;   // deskripsi singkat apa yang lagi dikerjain
  minionId?: string; // siapa yang minta restart (opsional)
  prompt?: string;   // prompt lengkap untuk di-resume setelah restart
  workdir?: string;  // working directory untuk task yang di-resume
  timestamp: string;
}

const TASK_FILE = resolve(import.meta.dirname, "../data/restart-task.json");

/** Simpan task sebelum restart — dipanggil oleh Claude/minion lewat Bash atau API */
export function saveRestartTask(
  context: string,
  minionId?: string,
  prompt?: string,
  workdir?: string
): void {
  const task: RestartTask = { context, minionId, prompt, workdir, timestamp: new Date().toISOString() };
  writeFileSync(TASK_FILE, JSON.stringify(task, null, 2), "utf-8");
}

/** Baca task gantung — dipanggil saat startup */
export function loadRestartTask(): RestartTask | null {
  if (!existsSync(TASK_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TASK_FILE, "utf-8")) as RestartTask;
  } catch {
    return null;
  }
}

/** Hapus file setelah notifikasi terkirim */
export function clearRestartTask(): void {
  if (existsSync(TASK_FILE)) unlinkSync(TASK_FILE);
}
