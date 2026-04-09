import { App } from "@slack/bolt";
import { ClaudeManager } from "./claude.js";
import { ConfigStore } from "./config-store.js";

export class SlackBot {
  private app: InstanceType<typeof App> | null = null;
  private claude: ClaudeManager;
  private configStore: ConfigStore;
  private started = false;

  constructor(claude: ClaudeManager, configStore: ConfigStore) {
    this.claude = claude;
    this.configStore = configStore;
  }

  async start() {
    const config = this.configStore.getIntegrations().slack;
    if (!config.enabled || !config.botToken || !config.appToken) {
      console.log("[slack] Disabled or missing tokens");
      return;
    }

    try {
      this.app = new App({
        token: config.botToken,
        signingSecret: config.signingSecret,
        appToken: config.appToken,
        socketMode: true,
      });

      this.setupHandlers();
      await this.app.start();
      this.started = true;
      console.log("[slack] Bot started");
    } catch (err: any) {
      console.error("[slack] Failed to start:", err.message);
    }
  }

  async stop() {
    if (this.app && this.started) {
      await this.app.stop();
      this.started = false;
      console.log("[slack] Bot stopped");
    }
  }

  private setupHandlers() {
    if (!this.app) return;

    // Respond to app mentions: @minion-bot ask semar something
    this.app.event("app_mention", async ({ event, say }: any) => {
      const text = event.text.replace(/<@[^>]+>/g, "").trim();

      // Parse: "ask <minion> <prompt>" or just "<prompt>"
      const askMatch = text.match(/^ask\s+(\w+)\s+(.+)/is);
      let minionId = "semar";
      let prompt = text;

      if (askMatch) {
        const name = askMatch[1].toLowerCase();
        const config = this.configStore.getMinions().find(
          (m) => m.id === name || m.name.toLowerCase() === name
        );
        if (config) {
          minionId = config.id;
          prompt = askMatch[2];
        }
      }

      const config = this.configStore.getMinion(minionId);
      if (!config) {
        await say({ text: `Unknown minion "${minionId}"`, thread_ts: event.ts });
        return;
      }

      await say({ text: `🔄 *${config.name}* is working on it...`, thread_ts: event.ts });

      this.runAndReply(say, event.ts, config, prompt);
    });

    // Respond to DMs
    this.app.message(async ({ message, say }: any) => {
      if (!("text" in message) || message.subtype) return;
      const text = message.text || "";
      const ts = message.ts;

      const config = this.configStore.getMinion("semar")!;
      await say({ text: `🔄 *Semar* is thinking...`, thread_ts: ts });
      this.runAndReply(say, ts, config, text);
    });
  }

  private runAndReply(
    say: any,
    threadTs: string,
    config: ReturnType<ConfigStore["getMinion"]> & {},
    prompt: string
  ) {
    const minionId = config.id;
    let responseText = "";

    const cleanup = () => {
      clearTimeout(timeout);
      this.claude.removeListener("chat", chatHandler);
      this.claude.removeListener("done", doneHandler);
    };

    const chatHandler = (data: any) => {
      if (data.minionId === minionId && data.message.role === "assistant") {
        responseText += data.message.content + "\n";
      }
    };

    const doneHandler = (data: any) => {
      if (data.minionId === minionId) {
        cleanup();
        const reply = responseText.trim() || "Sorry, ga ada response.";
        const truncated = reply.length > 3000 ? reply.slice(0, 3000) + "\n...(truncated)" : reply;
        say({ text: `*${config.name}:*\n${truncated}`, thread_ts: threadTs });
      }
    };

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      cleanup();
      say({ text: "Timeout — minion took too long.", thread_ts: threadTs });
    }, 300000);

    this.claude.on("chat", chatHandler);
    this.claude.on("done", doneHandler);

    const systemPrompt = this.configStore.loadSystemPrompt(config);
    this.claude.runPrompt(minionId, prompt, config.workdir, {
      systemPrompt,
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      model: config.model,
    });
  }
}
