import * as cron from "node-cron";
import { logger } from "./logger.js";

export interface Trigger {
  id: string;
  name: string;
  type: "cron" | "webhook" | "github" | "gitlab";
  enabled: boolean;
  // For cron triggers
  schedule?: string; // cron expression (e.g., "0 8 * * *" = 8am daily)
  // For github triggers
  githubEvent?: "pr_opened" | "push" | "ci_failure";
  // For gitlab triggers
  gitlabEvent?: "mr_opened" | "mr_updated" | "push" | "pipeline_failed";
  // Routing
  minionId: string; // which minion handles this
  promptTemplate: string; // supports {{repo}}, {{branch}}, {{pr_number}}, {{event_data}}
  // Metadata
  lastRun?: number;
  runCount: number;
}

export type TriggerCallback = (minionId: string, prompt: string) => void | Promise<void>;

export class TriggerEngine {
  private triggers: Map<string, Trigger> = new Map();
  private cronJobs: Map<string, cron.ScheduledTask> = new Map();
  private callback: TriggerCallback;

  constructor(callback: TriggerCallback) {
    this.callback = callback;
  }

  loadTriggers(triggers: Trigger[]) {
    for (const t of triggers) {
      this.triggers.set(t.id, t);
      if (t.type === "cron" && t.enabled && t.schedule) {
        this.startCronJob(t);
      }
    }
    logger.info({ count: triggers.length }, "Triggers loaded");
  }

  addTrigger(trigger: Omit<Trigger, "id" | "runCount">): Trigger {
    const id = `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const full: Trigger = { ...trigger, id, runCount: 0 };
    this.triggers.set(id, full);
    if (full.type === "cron" && full.enabled && full.schedule) {
      this.startCronJob(full);
    }
    return full;
  }

  updateTrigger(id: string, updates: Partial<Trigger>): Trigger | null {
    const existing = this.triggers.get(id);
    if (!existing) return null;

    const updated = { ...existing, ...updates, id }; // id can't change
    this.triggers.set(id, updated);

    // Restart cron if schedule changed
    this.stopCronJob(id);
    if (updated.type === "cron" && updated.enabled && updated.schedule) {
      this.startCronJob(updated);
    }

    return updated;
  }

  deleteTrigger(id: string): boolean {
    this.stopCronJob(id);
    return this.triggers.delete(id);
  }

  getTriggers(): Trigger[] {
    return Array.from(this.triggers.values());
  }

  getTrigger(id: string): Trigger | undefined {
    return this.triggers.get(id);
  }

  // Fire a trigger by matching github event type
  async fireGitHubEvent(eventType: string, data: Record<string, string>) {
    for (const trigger of this.triggers.values()) {
      if (trigger.type !== "github" || !trigger.enabled) continue;
      if (trigger.githubEvent !== eventType) continue;

      const prompt = this.interpolate(trigger.promptTemplate, data);
      await this.executeTrigger(trigger, prompt);
    }
  }

  // Fire a trigger by matching gitlab event type
  async fireGitLabEvent(eventType: string, data: Record<string, string>) {
    for (const trigger of this.triggers.values()) {
      if (trigger.type !== "gitlab" || !trigger.enabled) continue;
      if (trigger.gitlabEvent !== eventType) continue;

      const prompt = this.interpolate(trigger.promptTemplate, data);
      await this.executeTrigger(trigger, prompt);
    }
  }

  // Fire a webhook trigger by name/id
  async fireWebhook(triggerId: string, data: Record<string, string>) {
    const trigger = this.triggers.get(triggerId);
    if (!trigger || trigger.type !== "webhook" || !trigger.enabled) return;

    const prompt = this.interpolate(trigger.promptTemplate, data);
    await this.executeTrigger(trigger, prompt);
  }

  private startCronJob(trigger: Trigger) {
    if (!trigger.schedule || !cron.validate(trigger.schedule)) {
      logger.warn({ triggerId: trigger.id, schedule: trigger.schedule }, "Invalid cron schedule");
      return;
    }

    const job = cron.schedule(trigger.schedule, async () => {
      const prompt = this.interpolate(trigger.promptTemplate, {
        date: new Date().toISOString(),
        trigger_name: trigger.name,
      });
      await this.executeTrigger(trigger, prompt);
    });

    this.cronJobs.set(trigger.id, job);
    logger.info({ triggerId: trigger.id, name: trigger.name, schedule: trigger.schedule }, "Cron job started");
  }

  private stopCronJob(id: string) {
    const job = this.cronJobs.get(id);
    if (job) {
      job.stop();
      this.cronJobs.delete(id);
    }
  }

  private async executeTrigger(trigger: Trigger, prompt: string) {
    trigger.lastRun = Date.now();
    trigger.runCount++;
    logger.info({ triggerId: trigger.id, name: trigger.name, minionId: trigger.minionId }, "Trigger fired");

    try {
      await this.callback(trigger.minionId, prompt);
    } catch (err: any) {
      logger.error({ triggerId: trigger.id, error: err.message }, "Trigger execution failed");
    }
  }

  private interpolate(template: string, data: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || `{{${key}}}`);
  }

  stopAll() {
    for (const [id] of this.cronJobs) {
      this.stopCronJob(id);
    }
  }
}
