/**
 * Taskflow integration — client untuk task.hanif.app agent API
 */

const BASE_URL = process.env.TASKFLOW_BASE_URL || "https://task.hanif.app";

function getToken(): string {
  return process.env.TASKFLOW_AGENT_TOKEN || process.env.TASKFLOW_AGENT_SECRET || "";
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  status: "todo" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | "urgent";
  dueDate: string | null;
  projectId: string | null;
  createdAt: string;
}

interface Project {
  id: string;
  title: string;
  color: string;
}

function headers() {
  return {
    "Authorization": `Bearer ${getToken()}`,
    "Content-Type": "application/json",
  };
}

export async function listTasks(options?: { status?: string; projectId?: string }): Promise<Task[]> {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.projectId) params.set("projectId", options.projectId);

  const url = `${BASE_URL}/api/agent/tasks${params.size ? `?${params}` : ""}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Taskflow API ${res.status}`);
  const data = await res.json() as { data: Task[] };
  return data.data;
}

export async function listProjects(): Promise<Project[]> {
  const res = await fetch(`${BASE_URL}/api/agent/projects`, { headers: headers() });
  if (!res.ok) throw new Error(`Taskflow API ${res.status}`);
  const data = await res.json() as { data: Project[] };
  return data.data;
}

export async function createTask(task: {
  title: string;
  description?: string;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: "todo" | "in_progress" | "done";
  projectId?: string;
  dueDate?: string;
}): Promise<Task> {
  const res = await fetch(`${BASE_URL}/api/agent/tasks`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(task),
  });
  if (!res.ok) throw new Error(`Taskflow API ${res.status}`);
  const data = await res.json() as { data: Task };
  return data.data;
}

export async function updateTask(id: string, updates: {
  status?: "todo" | "in_progress" | "done";
  priority?: "low" | "medium" | "high" | "urgent";
  title?: string;
}): Promise<Task> {
  const res = await fetch(`${BASE_URL}/api/agent/tasks/${id}`, {
    method: "PATCH",
    headers: headers(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error(`Taskflow API ${res.status}`);
  const data = await res.json() as { data: Task };
  return data.data;
}

// Format tasks untuk ditampilkan ke user
export function formatTaskList(tasks: Task[], projects: Project[] = []): string {
  if (!tasks.length) return "Tidak ada task.";

  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.title]));

  const priorityEmoji: Record<string, string> = {
    urgent: "🔴",
    high: "🟠",
    medium: "🟡",
    low: "🟢",
  };

  const statusEmoji: Record<string, string> = {
    todo: "⬜",
    in_progress: "🔄",
    done: "✅",
  };

  return tasks.map(t => {
    const prio = priorityEmoji[t.priority] || "⬜";
    const stat = statusEmoji[t.status] || "⬜";
    const project = t.projectId && projectMap[t.projectId] ? ` [${projectMap[t.projectId]}]` : "";
    const due = t.dueDate ? ` — due ${new Date(t.dueDate).toLocaleDateString("id-ID")}` : "";
    return `${stat} ${prio} *${t.title}*${project}${due}`;
  }).join("\n");
}

// Parse intent dari pesan user untuk task operations
export function parseTaskIntent(text: string): {
  action: "list" | "add" | "done" | "none";
  data?: Record<string, string>;
} {
  const lower = text.toLowerCase().trim();

  // List tasks
  if (/apa (yang|yg) (harus|musti|perlu) (gua|gue|aku|saya) (kerjain|lakuin|buat|selesaiin)|task (gua|gue|aku|saya)|todo (gua|gue|aku)|list task|cek task|taskku|tugas (gua|gue|aku)/i.test(text)) {
    const statusMatch = lower.match(/yang (belum|udah|lagi) (dikerjain|selesai|dikerjain)/);
    let status: string | undefined;
    if (statusMatch) {
      if (statusMatch[1] === "belum") status = "todo";
      else if (statusMatch[1] === "udah") status = "done";
      else if (statusMatch[1] === "lagi") status = "in_progress";
    }
    return { action: "list", data: status ? { status } : {} };
  }

  // Add task
  const addMatch = text.match(/^(tambah|tambahin|add|bikin|buat)\s+task[:\s]+(.+)/i)
    || text.match(/^task baru[:\s]+(.+)/i);
  if (addMatch) {
    const title = (addMatch[2] || addMatch[1]).trim();
    return { action: "add", data: { title } };
  }

  // Mark done
  const doneMatch = text.match(/^(selesai|done|kelar|beres)[:\s]+(.+)/i)
    || text.match(/^tandai (selesai|done)[:\s]+(.+)/i);
  if (doneMatch) {
    return { action: "done", data: { title: (doneMatch[2] || doneMatch[1]).trim() } };
  }

  return { action: "none" };
}
