import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../data");
const METRICS_PATH = resolve(DATA_DIR, "metrics.json");

interface MinionMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCost: number;
  totalDurationMs: number;
  toolCallCounts: Record<string, number>;
  loopDetections: number;
}

interface MetricsData {
  byMinion: Record<string, MinionMetrics>;
  delegations: { total: number; byMinion: Record<string, number> };
  lastUpdated: number;
}

function emptyMinionMetrics(): MinionMetrics {
  return {
    totalTasks: 0, completedTasks: 0, failedTasks: 0,
    totalTokensInput: 0, totalTokensOutput: 0, totalCost: 0,
    totalDurationMs: 0, toolCallCounts: {}, loopDetections: 0,
  };
}

export class MetricsStore {
  private data: MetricsData;

  constructor() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    if (existsSync(METRICS_PATH)) {
      try {
        this.data = JSON.parse(readFileSync(METRICS_PATH, "utf-8"));
      } catch {
        this.data = this.empty();
      }
    } else {
      this.data = this.empty();
    }
  }

  recordTask(minionId: string, result: {
    status: "completed" | "failed" | "timeout";
    durationMs: number;
    tokensInput: number;
    tokensOutput: number;
    cost: number;
    toolCalls: Record<string, number>;
    loopDetections: number;
  }) {
    const m = this.getMinion(minionId);
    m.totalTasks++;
    if (result.status === "completed") m.completedTasks++;
    else m.failedTasks++;
    m.totalDurationMs += result.durationMs;
    m.totalTokensInput += result.tokensInput;
    m.totalTokensOutput += result.tokensOutput;
    m.totalCost += result.cost;
    m.loopDetections += result.loopDetections;
    for (const [tool, count] of Object.entries(result.toolCalls)) {
      m.toolCallCounts[tool] = (m.toolCallCounts[tool] || 0) + count;
    }
    this.save();
  }

  recordDelegation(minionId: string) {
    this.data.delegations.total++;
    this.data.delegations.byMinion[minionId] = (this.data.delegations.byMinion[minionId] || 0) + 1;
    this.save();
  }

  getAll(): MetricsData & { computed: Record<string, any> } {
    const computed: Record<string, any> = {};
    for (const [id, m] of Object.entries(this.data.byMinion)) {
      computed[id] = {
        completionRate: m.totalTasks > 0 ? (m.completedTasks / m.totalTasks * 100).toFixed(1) + "%" : "N/A",
        avgDurationMs: m.totalTasks > 0 ? Math.round(m.totalDurationMs / m.totalTasks) : 0,
        avgCost: m.totalTasks > 0 ? (m.totalCost / m.totalTasks).toFixed(4) : "0",
      };
    }
    return { ...this.data, computed };
  }

  private getMinion(id: string): MinionMetrics {
    if (!this.data.byMinion[id]) this.data.byMinion[id] = emptyMinionMetrics();
    return this.data.byMinion[id];
  }

  private empty(): MetricsData {
    return { byMinion: {}, delegations: { total: 0, byMinion: {} }, lastUpdated: Date.now() };
  }

  private save() {
    this.data.lastUpdated = Date.now();
    const tmpPath = METRICS_PATH + ".tmp";
    try {
      writeFileSync(tmpPath, JSON.stringify(this.data, null, 2));
      renameSync(tmpPath, METRICS_PATH);
    } catch (err) {
      console.error("[metrics] Failed to save:", err);
    }
  }
}
