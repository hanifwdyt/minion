import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = resolve(__dirname, "../data/traces");

// Tool-specific loop thresholds — consecutive identical calls before flagging
// Higher = more tolerant (tools that legitimately retry get more leeway)
const LOOP_THRESHOLDS: Record<string, number> = {
  Bash: 7,   // Commands may legitimately retry with same input
  Read: 4,
  Grep: 4,
  Glob: 4,
  Write: 3,  // Writing same content twice is almost always a bug
  Edit: 3,
  default: 5,
};

export function getLoopThreshold(toolName: string): number {
  return LOOP_THRESHOLDS[toolName] ?? LOOP_THRESHOLDS.default;
}

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

// Tracks the current streak of identical consecutive tool calls per minion
interface ConsecutiveState {
  fingerprint: string;
  count: number;
}

export class TraceStore {
  private activeTraces: Map<string, ExecutionTrace> = new Map();
  // Consecutive identical tool call state: minionId → { fingerprint, count }
  private consecutiveState: Map<string, ConsecutiveState> = new Map();

  constructor() {
    if (!existsSync(TRACES_DIR)) {
      mkdirSync(TRACES_DIR, { recursive: true });
    }
  }

  startTrace(minionId: string, prompt: string): ExecutionTrace {
    const trace: ExecutionTrace = {
      id: `trace-${minionId}-${Date.now()}`,
      minionId,
      prompt: prompt.slice(0, 500),
      startedAt: Date.now(),
      status: "running",
      steps: [],
      tokenUsage: { input: 0, output: 0 },
      cost: 0,
      loopDetections: 0,
    };
    this.activeTraces.set(minionId, trace);
    this.consecutiveState.set(minionId, { fingerprint: "", count: 0 });
    return trace;
  }

  addStep(minionId: string, step: Omit<ExecutionStep, "timestamp">): void {
    const trace = this.activeTraces.get(minionId);
    if (!trace) return;
    trace.steps.push({ ...step, timestamp: Date.now() });
  }

  // Check for tool call loops — returns consecutive repeat count.
  // Uses full input hash (not truncated) for accurate detection.
  // Resets streak when a different tool/input is called (no false positives
  // from tools that happen to repeat non-consecutively).
  checkToolLoop(minionId: string, toolName: string, inputContent: string): number {
    const fingerprint = createHash("md5")
      .update(`${toolName}:${inputContent}`)
      .digest("hex")
      .slice(0, 16);

    const state = this.consecutiveState.get(minionId) || { fingerprint: "", count: 0 };

    if (state.fingerprint === fingerprint) {
      state.count++;
    } else {
      // Different call — reset streak
      state.count = 1;
      state.fingerprint = fingerprint;
    }
    this.consecutiveState.set(minionId, state);

    // Track detection metric when approaching threshold
    const threshold = getLoopThreshold(toolName);
    if (state.count >= Math.max(Math.floor(threshold * 0.6), 2)) {
      const trace = this.activeTraces.get(minionId);
      if (trace) trace.loopDetections++;
    }

    return state.count;
  }

  updateUsage(minionId: string, input: number, output: number): void {
    const trace = this.activeTraces.get(minionId);
    if (!trace) return;
    trace.tokenUsage.input += input;
    trace.tokenUsage.output += output;
    // Estimate cost (Claude Sonnet pricing as default: $3/M input, $15/M output)
    trace.cost = (trace.tokenUsage.input * 3 + trace.tokenUsage.output * 15) / 1_000_000;
  }

  completeTrace(minionId: string, status: "completed" | "failed" | "timeout"): ExecutionTrace | undefined {
    const trace = this.activeTraces.get(minionId);
    if (!trace) return undefined;

    trace.completedAt = Date.now();
    trace.status = status;

    this.save(trace);

    this.activeTraces.delete(minionId);
    this.consecutiveState.delete(minionId);

    return trace;
  }

  getActive(minionId: string): ExecutionTrace | undefined {
    return this.activeTraces.get(minionId);
  }

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

  getById(id: string): ExecutionTrace | null {
    for (const trace of this.activeTraces.values()) {
      if (trace.id === id) return trace;
    }
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
