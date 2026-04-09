import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = resolve(__dirname, "../data/traces");

export interface ExecutionStep {
  type: "reasoning" | "tool_call" | "tool_result" | "error" | "system";
  timestamp: number;
  content: string;
  toolName?: string;
  toolInput?: any;
  durationMs?: number;
}

export interface ExecutionTrace {
  id: string;
  minionId: string;
  prompt: string;
  startedAt: number;
  completedAt?: number;
  status: "running" | "completed" | "failed" | "timeout";
  steps: ExecutionStep[];
  tokenUsage: { input: number; output: number };
  cost: number;
  qualityScore?: number;
  loopDetections: number;
}

export class TraceStore {
  private activeTraces: Map<string, ExecutionTrace> = new Map();
  // Tool call fingerprints for loop detection: minionId → fingerprint[]
  private toolFingerprints: Map<string, string[]> = new Map();

  constructor() {
    if (!existsSync(TRACES_DIR)) {
      mkdirSync(TRACES_DIR, { recursive: true });
    }
  }

  // Start a new execution trace
  startTrace(minionId: string, prompt: string): ExecutionTrace {
    const trace: ExecutionTrace = {
      id: `trace-${minionId}-${Date.now()}`,
      minionId,
      prompt: prompt.slice(0, 500), // Cap stored prompt length
      startedAt: Date.now(),
      status: "running",
      steps: [],
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
      loopDetections: 0,
    };
    this.activeTraces.set(minionId, trace);
    this.toolFingerprints.set(minionId, []);
    return trace;
  }

  // Add a step to active trace
  addStep(minionId: string, step: Omit<ExecutionStep, "timestamp">): void {
    const trace = this.activeTraces.get(minionId);
    if (!trace) return;
    trace.steps.push({ ...step, timestamp: Date.now() });
  }

  // Check for tool call loops — returns repeat count
  checkToolLoop(minionId: string, toolName: string, errorContent?: string): number {
    const fingerprint = createHash("md5")
      .update(`${toolName}:${errorContent || ""}`)
      .digest("hex")
      .slice(0, 12);

    const prints = this.toolFingerprints.get(minionId) || [];
    prints.push(fingerprint);
    this.toolFingerprints.set(minionId, prints);

    // Count recent occurrences (last 10 calls)
    const recent = prints.slice(-10);
    const count = recent.filter((p) => p === fingerprint).length;

    if (count >= 3) {
      const trace = this.activeTraces.get(minionId);
      if (trace) trace.loopDetections++;
    }

    return count;
  }

  // Update token usage
  updateUsage(minionId: string, input: number, output: number): void {
    const trace = this.activeTraces.get(minionId);
    if (!trace) return;
    trace.tokenUsage.input += input;
    trace.tokenUsage.output += output;
    // Estimate cost (Claude Sonnet pricing as default: $3/M input, $15/M output)
    trace.cost = (trace.tokenUsage.input * 3 + trace.tokenUsage.output * 15) / 1_000_000;
  }

  // Complete trace
  completeTrace(minionId: string, status: "completed" | "failed" | "timeout"): ExecutionTrace | undefined {
    const trace = this.activeTraces.get(minionId);
    if (!trace) return undefined;

    trace.completedAt = Date.now();
    trace.status = status;

    // Persist to disk
    this.save(trace);

    // Cleanup
    this.activeTraces.delete(minionId);
    this.toolFingerprints.delete(minionId);

    return trace;
  }

  // Get active trace for a minion
  getActive(minionId: string): ExecutionTrace | undefined {
    return this.activeTraces.get(minionId);
  }

  // Get recent traces (from disk)
  getRecent(limit = 20): ExecutionTrace[] {
    const files = readdirSync(TRACES_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, limit);

    return files.map((f) => {
      try {
        return JSON.parse(readFileSync(resolve(TRACES_DIR, f), "utf-8"));
      } catch {
        return null;
      }
    }).filter(Boolean) as ExecutionTrace[];
  }

  // Get specific trace
  getById(id: string): ExecutionTrace | null {
    // Check active first
    for (const trace of this.activeTraces.values()) {
      if (trace.id === id) return trace;
    }
    // Check disk
    const filePath = resolve(TRACES_DIR, `${id}.json`);
    if (existsSync(filePath)) {
      try {
        return JSON.parse(readFileSync(filePath, "utf-8"));
      } catch {
        return null;
      }
    }
    return null;
  }

  private save(trace: ExecutionTrace): void {
    const filePath = resolve(TRACES_DIR, `${trace.id}.json`);
    const tmpPath = filePath + ".tmp";
    try {
      writeFileSync(tmpPath, JSON.stringify(trace, null, 2));
      renameSync(tmpPath, filePath);
    } catch (err) {
      console.error(`[trace] Failed to save ${trace.id}:`, err);
    }
  }
}
