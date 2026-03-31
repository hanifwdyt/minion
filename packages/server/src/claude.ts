import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

interface ClaudeSession {
  process: ChildProcess;
  minionId: string;
  sessionId?: string;
}

export class ClaudeManager extends EventEmitter {
  private sessions: Map<string, ClaudeSession> = new Map();

  async runPrompt(minionId: string, prompt: string, workdir: string) {
    // Kill existing process for this minion if running
    this.stop(minionId);

    const args = [
      "-p",
      prompt,
      "--output-format",
      "stream-json",
      "--verbose",
      "--allowedTools",
      "Read,Edit,Bash,Glob,Grep,Write",
      "--max-turns",
      "50",
    ];

    console.log(`[claude] spawning for ${minionId}: claude ${args.join(" ").slice(0, 100)}...`);

    const proc = spawn("claude", args, {
      cwd: workdir,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const session: ClaudeSession = { process: proc, minionId };
    this.sessions.set(minionId, session);

    this.emit("status", { minionId, status: "working" });

    // Stream stdout (stream-json: one JSON object per line)
    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this.handleStreamEvent(minionId, event);
        } catch {
          // Not JSON, emit as raw text
          this.emit("output", {
            minionId,
            data: line + "\n",
          });
        }
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      // Filter noisy stderr but pass through useful info
      if (!text.includes("Debugger") && !text.includes("ExperimentalWarning")) {
        this.emit("output", {
          minionId,
          data: `\x1b[33m${text}\x1b[0m`,
        });
      }
    });

    proc.on("close", (code) => {
      console.log(`[claude] ${minionId} exited with code ${code}`);
      this.sessions.delete(minionId);
      this.emit("status", { minionId, status: "idle" });
      this.emit("done", { minionId, code });
    });

    proc.on("error", (err) => {
      console.error(`[claude] ${minionId} error:`, err.message);
      this.emit("output", {
        minionId,
        data: `\x1b[31mError: ${err.message}\x1b[0m\n`,
      });
      this.emit("status", { minionId, status: "error" });
      this.sessions.delete(minionId);
    });
  }

  private handleStreamEvent(minionId: string, event: any) {
    // Claude stream-json events have different types
    if (event.type === "assistant" && event.message) {
      // Text response
      const content = event.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text") {
            this.emit("output", {
              minionId,
              data: block.text + "\n",
            });
          } else if (block.type === "tool_use") {
            this.emit("output", {
              minionId,
              data: `\x1b[36m⚡ ${block.name}\x1b[0m ${this.truncate(JSON.stringify(block.input), 200)}\n`,
            });
          }
        }
      }
    } else if (event.type === "result") {
      // Final result
      if (event.result) {
        this.emit("output", {
          minionId,
          data: `\n\x1b[32m${event.result}\x1b[0m\n`,
        });
      }
      if (event.session_id) {
        const session = this.sessions.get(minionId);
        if (session) session.sessionId = event.session_id;
      }
    } else if (event.type === "tool_result") {
      // Tool output
      const content = typeof event.content === "string"
        ? event.content
        : JSON.stringify(event.content);
      this.emit("output", {
        minionId,
        data: `\x1b[90m${this.truncate(content, 500)}\x1b[0m\n`,
      });
    }
  }

  private truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + "..." : str;
  }

  stop(minionId: string) {
    const session = this.sessions.get(minionId);
    if (session) {
      console.log(`[claude] killing ${minionId}`);
      session.process.kill("SIGTERM");
      this.sessions.delete(minionId);
      this.emit("status", { minionId, status: "idle" });
    }
  }

  getStatus(minionId: string): "idle" | "working" {
    return this.sessions.has(minionId) ? "working" : "idle";
  }
}
