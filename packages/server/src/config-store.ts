import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MinionConfig {
  id: string;
  name: string;
  role: string;
  soul: string;
  color: string;
  allowedTools: string;
  maxTurns: number;
  model?: string;
  workdir: string;
  outfit: {
    shirtColor: string;
    pantsColor: string;
    skinColor: string;
    hatStyle: string;
    hatColor: string;
    shoeColor: string;
  };
}

export interface AppConfig {
  minions: MinionConfig[];
  integrations: {
    telegram: { enabled: boolean; token: string };
    slack: { enabled: boolean; botToken: string; signingSecret: string; appToken: string };
    webhook: { enabled: boolean; secret: string };
    github: { enabled: boolean; webhookSecret: string; defaultReviewer: string; repos: string[] };
    gitlab: { enabled: boolean; webhookSecret: string; instanceURL: string; apiToken: string; defaultReviewer: string; mode: "webhook" | "poll" | "both"; projects: string[] };
  };
  auth: {
    enabled: boolean;
    jwtSecret: string;
    adminUser: string;
    adminPass: string;
  };
}

const DEFAULT_INTEGRATIONS: AppConfig["integrations"] = {
  telegram: { enabled: false, token: "" },
  slack: { enabled: false, botToken: "", signingSecret: "", appToken: "" },
  webhook: { enabled: false, secret: "" },
  github: { enabled: false, webhookSecret: "", defaultReviewer: "gareng", repos: [] },
  gitlab: { enabled: false, webhookSecret: "", instanceURL: "", apiToken: "", defaultReviewer: "gareng", mode: "webhook", projects: [] },
};

const DEFAULT_AUTH: AppConfig["auth"] = {
  enabled: false,
  jwtSecret: "minion-secret-change-me",
  adminUser: "admin",
  adminPass: "admin",
};

export class ConfigStore {
  private configPath: string;
  private soulsDir: string;
  private sharedContextPath: string;
  private config: AppConfig;

  constructor() {
    this.configPath = resolve(__dirname, "../config.json");
    this.soulsDir = resolve(__dirname, "../souls");
    this.sharedContextPath = resolve(__dirname, "../shared-context.md");

    // Ensure souls directory exists
    if (!existsSync(this.soulsDir)) {
      mkdirSync(this.soulsDir, { recursive: true });
    }

    // Migrate from old minions.json if config.json doesn't exist
    if (!existsSync(this.configPath)) {
      const oldPath = resolve(__dirname, "../minions.json");
      const minions = existsSync(oldPath)
        ? JSON.parse(readFileSync(oldPath, "utf-8"))
        : [];

      this.config = {
        minions,
        integrations: DEFAULT_INTEGRATIONS,
        auth: DEFAULT_AUTH,
      };
      this.save();
      console.log("[config] Migrated from minions.json to config.json");
    } else {
      this.config = JSON.parse(readFileSync(this.configPath, "utf-8"));
      // Ensure new fields exist
      if (!this.config.integrations) this.config.integrations = DEFAULT_INTEGRATIONS;
      if (!this.config.auth) this.config.auth = DEFAULT_AUTH;
    }
  }

  // --- Minions ---

  getMinions(): MinionConfig[] {
    return this.config.minions;
  }

  getMinion(id: string): MinionConfig | undefined {
    return this.config.minions.find((m) => m.id === id);
  }

  updateMinion(id: string, updates: Partial<MinionConfig>): MinionConfig | null {
    const idx = this.config.minions.findIndex((m) => m.id === id);
    if (idx === -1) return null;
    this.config.minions[idx] = { ...this.config.minions[idx], ...updates };
    this.save();
    return this.config.minions[idx];
  }

  // --- Souls ---

  getSoul(minionId: string): string {
    const minion = this.getMinion(minionId);
    if (!minion?.soul) return "";
    const soulPath = resolve(this.soulsDir, `${minionId}.md`);
    if (existsSync(soulPath)) {
      return readFileSync(soulPath, "utf-8");
    }
    return "";
  }

  setSoul(minionId: string, content: string): void {
    const soulPath = resolve(this.soulsDir, `${minionId}.md`);
    writeFileSync(soulPath, content);
  }

  // --- Shared Context ---

  getSharedContext(): string {
    if (existsSync(this.sharedContextPath)) {
      return readFileSync(this.sharedContextPath, "utf-8");
    }
    return "";
  }

  setSharedContext(content: string): void {
    writeFileSync(this.sharedContextPath, content);
  }

  // --- System Prompt (soul + shared context combined) ---

  loadSystemPrompt(config: MinionConfig): string | undefined {
    const parts: string[] = [];
    const soul = this.getSoul(config.id);
    if (soul) parts.push(soul);

    const shared = this.getSharedContext();
    if (shared) parts.push("\n---\n\n" + shared);

    return parts.length > 0 ? parts.join("\n") : undefined;
  }

  // --- Integrations (with env var overrides for secrets) ---

  getIntegrations(): AppConfig["integrations"] {
    const integrations = { ...this.config.integrations };

    // Override secrets from env vars if set
    if (process.env.TELEGRAM_BOT_TOKEN) {
      integrations.telegram = { ...integrations.telegram, token: process.env.TELEGRAM_BOT_TOKEN };
    }
    if (process.env.GITLAB_TOKEN) {
      integrations.gitlab = { ...integrations.gitlab, apiToken: process.env.GITLAB_TOKEN };
    }
    if (process.env.GITLAB_WEBHOOK_SECRET) {
      integrations.gitlab = { ...integrations.gitlab, webhookSecret: process.env.GITLAB_WEBHOOK_SECRET };
    }
    if (process.env.GITLAB_HOST) {
      integrations.gitlab = { ...integrations.gitlab, instanceURL: `https://${process.env.GITLAB_HOST}` };
    }
    if (process.env.GITHUB_WEBHOOK_SECRET) {
      integrations.github = { ...integrations.github, webhookSecret: process.env.GITHUB_WEBHOOK_SECRET };
    }
    if (process.env.SLACK_BOT_TOKEN) {
      integrations.slack = { ...integrations.slack, botToken: process.env.SLACK_BOT_TOKEN };
    }
    if (process.env.SLACK_SIGNING_SECRET) {
      integrations.slack = { ...integrations.slack, signingSecret: process.env.SLACK_SIGNING_SECRET };
    }
    if (process.env.SLACK_APP_TOKEN) {
      integrations.slack = { ...integrations.slack, appToken: process.env.SLACK_APP_TOKEN };
    }
    if (process.env.WEBHOOK_SECRET) {
      integrations.webhook = { ...integrations.webhook, secret: process.env.WEBHOOK_SECRET };
    }

    return integrations;
  }

  updateIntegrations(updates: Partial<AppConfig["integrations"]>): void {
    this.config.integrations = { ...this.config.integrations, ...updates };
    this.save();
  }

  // --- Auth (with env var overrides for secrets) ---

  getAuth(): AppConfig["auth"] {
    const auth = { ...this.config.auth };

    if (process.env.JWT_SECRET) {
      auth.jwtSecret = process.env.JWT_SECRET;
    }
    if (process.env.ADMIN_USER) {
      auth.adminUser = process.env.ADMIN_USER;
    }
    if (process.env.ADMIN_PASS) {
      auth.adminPass = process.env.ADMIN_PASS;
    }

    return auth;
  }

  updateAuth(updates: Partial<AppConfig["auth"]>): void {
    this.config.auth = { ...this.config.auth, ...updates };
    this.save();
  }

  // --- Full config ---

  getAll(): AppConfig {
    return this.config;
  }

  private save(): void {
    const tmpPath = this.configPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(this.config, null, 2));
    renameSync(tmpPath, this.configPath);
  }
}
