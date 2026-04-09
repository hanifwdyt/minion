import { Bot } from "grammy";
import { ClaudeManager } from "./claude.js";
import { ConfigStore } from "./config-store.js";
import { VPNManager } from "./vpn.js";
import { MemoryStore } from "./memory.js";

interface ConversationState {
  chatId: number;
  minionId: string;
  stage: string;
  data: any;
  timeout: NodeJS.Timeout;
}

export class TelegramBot {
  private bot: Bot | null = null;
  private claude: ClaudeManager;
  private configStore: ConfigStore;
  private vpn: VPNManager;
  private memoryStore: MemoryStore;
  private started = false;
  private conversations: Map<number, ConversationState> = new Map(); // chatId → state

  constructor(claude: ClaudeManager, configStore: ConfigStore, vpn: VPNManager, memoryStore: MemoryStore) {
    this.claude = claude;
    this.configStore = configStore;
    this.vpn = vpn;
    this.memoryStore = memoryStore;
    this.setupVPNEvents();
  }

  private setupVPNEvents() {
    this.vpn.on("needs_approval", (data) => {
      // Broadcast to all active conversations waiting for VPN
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "vpn_connecting") {
          state.stage = "waiting_silverfort";
          this.sendToChat(chatId, `⏳ ${data.message}`);
        }
      }
    });

    this.vpn.on("connected", () => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "waiting_silverfort") {
          this.sendToChat(chatId, "✅ VPN connected! Lanjut kerja...");
          this.clearConversation(chatId);
        }
      }
    });

    this.vpn.on("timeout", () => {
      for (const [chatId, state] of this.conversations) {
        if (state.stage === "waiting_silverfort") {
          this.sendToChat(chatId, "❌ VPN timeout — Silverfort ga di-approve. Coba lagi nanti.");
          this.clearConversation(chatId);
        }
      }
    });
  }

  private sendToChat(chatId: number, text: string) {
    this.bot?.api.sendMessage(chatId, text).catch(() => {});
  }

  private clearConversation(chatId: number) {
    const state = this.conversations.get(chatId);
    if (state) {
      clearTimeout(state.timeout);
      this.conversations.delete(chatId);
    }
  }

  async start() {
    const config = this.configStore.getIntegrations().telegram;
    if (!config.enabled || !config.token) {
      console.log("[telegram] Disabled or no token configured");
      return;
    }

    try {
      this.bot = new Bot(config.token);
      this.setupHandlers();
      await this.bot.start();
      this.started = true;
      console.log("[telegram] Bot started");
    } catch (err: any) {
      console.error("[telegram] Failed to start:", err.message);
    }
  }

  async stop() {
    if (this.bot && this.started) {
      await this.bot.stop();
      this.started = false;
      console.log("[telegram] Bot stopped");
    }
  }

  private setupHandlers() {
    if (!this.bot) return;

    this.bot.command("start", (ctx) => {
      const minions = this.configStore.getMinions();
      const list = minions.map((m) => `• *${m.name}* — ${m.role}`).join("\n");
      ctx.reply(
        `🎭 *PUNAKAWAN* — Agen AI Nusantara\n\nAvailable minions:\n${list}\n\n` +
        `Commands:\n` +
        `/ask <minion> <prompt> — Ask a specific minion\n` +
        `/balai <prompt> — Send to Balai Desa (auto-delegate)\n` +
        `/status — Check minion status`,
        { parse_mode: "Markdown" }
      );
    });

    this.bot.command("status", (ctx) => {
      const minions = this.configStore.getMinions();
      const lines = minions.map((m) => {
        const status = this.claude.getStatus(m.id);
        const icon = status === "working" ? "🟢" : "⚪";
        return `${icon} *${m.name}* — ${status}`;
      });
      ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    });

    this.bot.command("ask", async (ctx) => {
      const text = ctx.message?.text || "";
      const parts = text.replace(/^\/ask\s*/, "").trim().split(/\s+/);
      const minionName = parts[0]?.toLowerCase();
      const prompt = parts.slice(1).join(" ");

      if (!minionName || !prompt) {
        return ctx.reply("Usage: /ask <minion> <prompt>\nExample: /ask bagong fix the login bug");
      }

      const config = this.configStore.getMinions().find(
        (m) => m.id === minionName || m.name.toLowerCase() === minionName
      );

      if (!config) {
        return ctx.reply(`Unknown minion "${minionName}". Use /start to see available minions.`);
      }

      await ctx.reply(`🔄 Sending to *${config.name}*...`, { parse_mode: "Markdown" });

      this.runAndReply(ctx, config.id, prompt);
    });

    this.bot.command("balai", async (ctx) => {
      const prompt = (ctx.message?.text || "").replace(/^\/balai\s*/, "").trim();
      if (!prompt) {
        return ctx.reply("Usage: /balai <prompt>");
      }

      await ctx.reply("🏛 Sending to *Balai Desa*...", { parse_mode: "Markdown" });
      // Route to semar as lead — Telegram doesn't have balai routing
      this.runAndReply(ctx, "semar", prompt);
    });

    // VPN commands
    this.bot.command("vpn", async (ctx) => {
      const args = (ctx.message?.text || "").replace(/^\/vpn\s*/, "").trim().toLowerCase();

      if (args === "status") {
        const connected = await this.vpn.isConnected();
        return ctx.reply(connected ? "🟢 VPN connected" : "⚪ VPN disconnected");
      }

      if (args === "connect" || args === "on") {
        await ctx.reply("🔄 Connecting VPN...");
        const chatId = ctx.chat?.id;
        if (chatId) {
          this.conversations.set(chatId, {
            chatId,
            minionId: "system",
            stage: "vpn_connecting",
            data: {},
            timeout: setTimeout(() => this.clearConversation(chatId), 180_000),
          });
        }
        const connected = await this.vpn.connect();
        if (chatId) this.clearConversation(chatId);
        return ctx.reply(connected ? "✅ VPN connected!" : "❌ VPN gagal connect. Approve Silverfort dulu.");
      }

      if (args === "disconnect" || args === "off") {
        await this.vpn.disconnect();
        return ctx.reply("✅ VPN disconnected");
      }

      return ctx.reply("Usage: /vpn status | /vpn connect | /vpn disconnect");
    });

    // Plain text messages — check for conversation state first
    this.bot.on("message:text", async (ctx) => {
      const chatId = ctx.chat?.id;
      const text = ctx.message.text;

      // Check for active conversation state (e.g., waiting for Silverfort approval)
      if (chatId && this.conversations.has(chatId)) {
        const state = this.conversations.get(chatId)!;

        if (state.stage === "waiting_silverfort") {
          const approvalPhrases = ["udah", "done", "ok", "approved", "approve", "sudah", "oke", "yep", "yes", "iya"];
          const isApproval = approvalPhrases.some((p) => text.toLowerCase().includes(p));

          if (isApproval) {
            await ctx.reply("🔄 Verifying VPN connection...");
            const connected = await this.vpn.verifyAfterApproval();
            this.clearConversation(chatId);
            if (connected) {
              return ctx.reply("✅ VPN connected! Siap kerja, nak.");
            } else {
              return ctx.reply("❌ Masih gagal connect. Coba approve lagi di HP lo, terus bilang lagi.");
            }
          }
        }

        // Other states could be handled here
      }

      // Normal flow — route to Semar
      await ctx.reply("🔄 *Semar* is thinking...", { parse_mode: "Markdown" });
      this.runAndReply(ctx, "semar", text);
    });
  }

  private runAndReply(ctx: any, minionId: string, prompt: string) {
    const config = this.configStore.getMinion(minionId);
    if (!config) return;

    let responseText = "";

    const cleanup = () => {
      clearTimeout(timeout);
      this.claude.removeListener("chat", chatHandler);
      this.claude.removeListener("done", doneHandler);
    };

    const sendReply = () => {
      const reply = responseText.trim() || "Sorry, ga ada response. Coba lagi ya.";
      const truncated = reply.length > 4000 ? reply.slice(0, 4000) + "\n...(truncated)" : reply;
      ctx.reply(`*${config.name}:*\n${truncated}`, { parse_mode: "Markdown" }).catch(() => {
        ctx.reply(`${config.name}:\n${truncated}`);
      });
    };

    const chatHandler = (data: any) => {
      if (data.minionId === minionId && data.message.role === "assistant") {
        responseText += data.message.content + "\n";
      }
    };

    const doneHandler = (data: any) => {
      if (data.minionId === minionId) {
        cleanup();
        sendReply();
      }
    };

    // Timeout cleanup after 5 minutes
    const timeout = setTimeout(() => {
      cleanup();
      if (responseText.trim()) {
        sendReply();
      } else {
        ctx.reply("Timeout — minion took too long to respond.");
      }
    }, 300000);

    this.claude.on("chat", chatHandler);
    this.claude.on("done", doneHandler);

    const workdir = config.workdir;
    const systemPrompt = this.configStore.loadSystemPrompt(config);
    const memoryContext = this.memoryStore.buildMemoryContext(minionId, prompt);
    const knowledgeContext = this.memoryStore.buildKnowledgeContext();

    // Build env with GitLab vars if configured
    const gitlabConfig = this.configStore.getIntegrations().gitlab;
    const env = gitlabConfig?.enabled ? {
      GITLAB_HOST: gitlabConfig.instanceURL?.replace(/^https?:\/\//, "") || "",
      GITLAB_TOKEN: gitlabConfig.apiToken || "",
      GITLAB_API: (gitlabConfig.instanceURL?.replace(/\/$/, "") || "") + "/api/v4",
    } : undefined;

    this.claude.runPrompt(minionId, prompt, workdir, {
      systemPrompt: (systemPrompt || "") + memoryContext + knowledgeContext || undefined,
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      model: config.model,
      env,
    });
  }
}
