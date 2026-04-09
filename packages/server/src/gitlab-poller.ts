import * as cron from "node-cron";
import { GitLabClient } from "./gitlab-client.js";
import { VPNManager } from "./vpn.js";
import { logger } from "./logger.js";

export interface PollEvent {
  type: "mr_opened" | "mr_updated" | "pipeline_failed" | "mr_discussion";
  projectId: string;
  projectPath: string;
  data: any; // MR or Pipeline or Discussion object
}

export type PollEventHandler = (event: PollEvent) => void | Promise<void>;

export class GitLabPoller {
  private client: GitLabClient;
  private projects: string[];
  private handler: PollEventHandler;
  private job: cron.ScheduledTask | null = null;
  private lastPollTime: Map<string, string> = new Map(); // projectId → ISO timestamp
  private knownMRs: Map<string, Set<number>> = new Map(); // projectId → set of MR iids
  private knownFailedPipelines: Map<string, Set<number>> = new Map();
  private handledDiscussions: Map<string, Set<string>> = new Map(); // "projectId-mrIid" → set of discussion IDs already handled
  private botUsername: string;
  private vpn: VPNManager | null;

  constructor(client: GitLabClient, projects: string[], handler: PollEventHandler, botUsername = "minion", vpn?: VPNManager) {
    this.client = client;
    this.projects = projects;
    this.handler = handler;
    this.botUsername = botUsername;
    this.vpn = vpn || null;
  }

  start(schedule = "*/5 * * * *") {
    // Initialize: fetch current state so we don't fire events for existing MRs
    this.withVPN(() => this.initializeState()).then(() => {
      this.job = cron.schedule(schedule, () => this.withVPN(() => this.poll()));
      logger.info({ projects: this.projects, schedule }, "GitLab poller started");
    }).catch((err: any) => {
      logger.error({ error: err.message }, "GitLab poller init failed (VPN issue?)");
      // Start anyway, polls will retry with VPN
      this.job = cron.schedule(schedule, () => this.withVPN(() => this.poll()));
      logger.info({ projects: this.projects, schedule }, "GitLab poller started (init skipped)");
    });
  }

  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
      logger.info("GitLab poller stopped");
    }
  }

  private async withVPN<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.vpn) return fn();
    return this.vpn.withVPN(fn);
  }

  private async initializeState() {
    for (const projectPath of this.projects) {
      try {
        const project = await this.client.getProject(projectPath);
        const projectId = String(project.id);

        // Seed known MRs
        const mrs = await this.client.listOpenMRs(projectPath);
        this.knownMRs.set(projectId, new Set(mrs.map(mr => mr.iid)));

        // Seed known failed pipelines
        const pipelines = await this.client.listFailedPipelines(projectPath);
        this.knownFailedPipelines.set(projectId, new Set(pipelines.map(p => p.id)));

        this.lastPollTime.set(projectId, new Date().toISOString());
        logger.info({ projectPath, openMRs: mrs.length }, "GitLab poller initialized project");
      } catch (err: any) {
        logger.error({ projectPath, error: err.message }, "Failed to initialize GitLab project");
      }
    }
  }

  private async poll() {
    for (const projectPath of this.projects) {
      try {
        const project = await this.client.getProject(projectPath);
        const projectId = String(project.id);
        const since = this.lastPollTime.get(projectId) || new Date(Date.now() - 5 * 60000).toISOString();

        // Check for new/updated MRs
        const mrs = await this.client.listUpdatedMRs(projectPath, since);
        const knownMRSet = this.knownMRs.get(projectId) || new Set();

        for (const mr of mrs) {
          if (!knownMRSet.has(mr.iid)) {
            // New MR
            knownMRSet.add(mr.iid);
            await this.handler({ type: "mr_opened", projectId, projectPath, data: mr });
          } else {
            // Updated MR
            await this.handler({ type: "mr_updated", projectId, projectPath, data: mr });
          }
        }
        this.knownMRs.set(projectId, knownMRSet);

        // Check for new failed pipelines
        const failedPipelines = await this.client.listFailedPipelines(projectPath, since);
        const knownPipelineSet = this.knownFailedPipelines.get(projectId) || new Set();

        for (const pipeline of failedPipelines) {
          if (!knownPipelineSet.has(pipeline.id)) {
            knownPipelineSet.add(pipeline.id);
            await this.handler({ type: "pipeline_failed", projectId, projectPath, data: pipeline });
          }
        }
        this.knownFailedPipelines.set(projectId, knownPipelineSet);

        // Check for unresolved discussions with bot mentions on open MRs
        await this.pollDiscussions(projectPath, projectId, knownMRSet);

        this.lastPollTime.set(projectId, new Date().toISOString());
      } catch (err: any) {
        logger.error({ projectPath, error: err.message }, "GitLab poll failed");
      }
    }
  }

  private async pollDiscussions(projectPath: string, projectId: string, mrIids: Set<number>) {
    const BOT_MENTIONS = ["@minion", "@semar", "@gareng", "@petruk", "@bagong"];

    for (const mrIid of mrIids) {
      try {
        const discussions = await this.client.listMRDiscussions(projectPath, mrIid);
        const key = `${projectId}-${mrIid}`;
        const handled = this.handledDiscussions.get(key) || new Set();

        for (const discussion of discussions) {
          if (handled.has(discussion.id)) continue;

          // Skip already resolved discussions
          const hasUnresolved = discussion.notes.some((n) => n.resolvable && !n.resolved);
          if (!hasUnresolved) continue;

          // Check if any note mentions the bot
          const lastNote = discussion.notes[discussion.notes.length - 1];
          if (!lastNote) continue;

          // Skip notes authored by the bot itself
          if (lastNote.author.username === this.botUsername) continue;

          const hasMention = BOT_MENTIONS.some((bot) => lastNote.body.includes(bot));
          if (!hasMention) continue;

          handled.add(discussion.id);

          const mr = await this.client.getMR(projectPath, mrIid);

          await this.handler({
            type: "mr_discussion",
            projectId,
            projectPath,
            data: {
              mrIid,
              mrTitle: mr.title,
              mrAuthor: mr.author?.username,
              sourceBranch: mr.source_branch,
              targetBranch: mr.target_branch,
              discussion,
              lastNote,
            },
          });

          logger.info({ projectPath, mrIid, discussionId: discussion.id }, "[gitlab-poller] New discussion with bot mention");
        }

        this.handledDiscussions.set(key, handled);
      } catch (err: any) {
        logger.error({ projectPath, mrIid, error: err.message }, "Failed to poll MR discussions");
      }
    }
  }
}
