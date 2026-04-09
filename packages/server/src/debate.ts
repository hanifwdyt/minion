import { spawn } from "child_process";
import { ChatStore } from "./chat-store.js";
import { ConfigStore } from "./config-store.js";
import { Server } from "socket.io";

const BALAI_ID = "balai";

interface Proposal {
  minionId: string;
  minionName: string;
  content: string;
}

export class DebateEngine {
  private chatStore: ChatStore;
  private configStore: ConfigStore;
  private io: Server;

  constructor(chatStore: ChatStore, configStore: ConfigStore, io: Server) {
    this.chatStore = chatStore;
    this.configStore = configStore;
    this.io = io;
  }

  async runDebate(topic: string, workdir: string) {
    const minions = this.configStore.getMinions().filter((m) => m.id !== "semar");

    // Announce debate
    this.emitBalai(`_Starting debate: "${topic}"_\n_Gareng, Petruk, and Bagong will each propose. Semar will synthesize._`);

    // Phase 1: Parallel proposals from 3 minions
    const proposals = await Promise.all(
      minions.map((m) => this.getProposal(m.id, m.name, topic, workdir))
    );

    // Show proposals
    for (const p of proposals) {
      this.emitBalai(`**${p.minionName}'s proposal:**\n${p.content}`);
    }

    // Phase 2: Semar synthesizes
    this.emitBalai("_Semar is synthesizing all proposals..._");

    const synthesisPrompt =
      `Lo adalah Semar, tetua bijak. Tim lo baru debat soal: "${topic}"\n\n` +
      proposals.map((p) => `**${p.minionName}:**\n${p.content}`).join("\n\n") +
      `\n\nTugas lo: Synthesize semua proposal di atas. Ambil yang terbaik dari masing-masing, tambah insight lo sendiri, dan kasih rekomendasi final yang solid. Jelaskan kenapa lo pilih approach itu.`;

    const synthesis = await this.callClaude(synthesisPrompt, workdir);
    this.emitBalai(`**Semar's synthesis:**\n${synthesis}`);
    this.emitBalai("_Debate selesai._");

    this.io.emit("minion:status", { minionId: BALAI_ID, status: "idle" });
  }

  private async getProposal(minionId: string, name: string, topic: string, workdir: string): Promise<Proposal> {
    const config = this.configStore.getMinion(minionId);
    const soul = config ? this.configStore.loadSystemPrompt(config) : "";
    const prompt = `${soul ? soul + "\n\n---\n\n" : ""}User minta pendapat lo soal: "${topic}"\n\nKasih proposal/pendapat lo. Singkat, to the point, max 3 paragraf.`;

    const content = await this.callClaude(prompt, workdir);
    return { minionId, minionName: name, content };
  }

  private callClaude(prompt: string, workdir: string): Promise<string> {
    return new Promise((resolve) => {
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;
      delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

      const proc = spawn("claude", ["-p", prompt, "--output-format", "text", "--max-turns", "1"], {
        cwd: workdir,
        env: cleanEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";
      proc.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
      proc.on("close", () => resolve(output.trim() || "(no response)"));
      proc.on("error", () => resolve("(error generating proposal)"));

      setTimeout(() => {
        proc.kill("SIGTERM");
        resolve(output.trim() || "(timeout)");
      }, 60000);
    });
  }

  private emitBalai(content: string) {
    const msg = {
      id: `debate-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      minionId: BALAI_ID,
      role: "assistant" as const,
      content,
      timestamp: Date.now(),
    };
    this.chatStore.add(BALAI_ID, msg);
    this.io.emit("minion:chat", { minionId: BALAI_ID, message: msg });
  }
}
