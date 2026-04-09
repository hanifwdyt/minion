import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "./logger.js";

// --- Types ---

export interface PRReviewEvent {
  type: "pr_review";
  repo: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prompt: string;
}

export interface PRCommentEvent {
  type: "pr_comment";
  repo: string;
  prNumber: number;
  prTitle: string;
  comment: string;
  mentionedBot: string;
  prompt: string;
}

export interface PushEvent {
  type: "push";
  repo: string;
  ref: string;
  commits: { id: string; message: string; author: string }[];
}

export interface CIFailureEvent {
  type: "ci_failure";
  repo: string;
  workflowName: string;
  runId: number;
  branch: string;
  conclusion: string;
}

export type GitHubEvent = PRReviewEvent | PRCommentEvent | PushEvent | CIFailureEvent;
export type GitHubEventHandler = (event: GitHubEvent) => void | Promise<void>;

// --- Mention bots ---

const BOT_MENTIONS = ["@minion", "@semar", "@gareng", "@petruk", "@bagong"];

// --- Class ---

export class GitHubWebhook {
  private secret: string;
  private handler: GitHubEventHandler;

  constructor(secret: string, handler: GitHubEventHandler) {
    this.secret = secret;
    this.handler = handler;
  }

  middleware() {
    return async (req: Request, res: Response, _next: NextFunction) => {
      // Validate signature
      const signature = req.headers["x-hub-signature-256"] as string | undefined;
      if (!signature) {
        logger.warn("[github] Missing x-hub-signature-256 header");
        return res.status(401).json({ error: "Missing signature" });
      }

      const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      const expected = "sha256=" + crypto.createHmac("sha256", this.secret).update(body).digest("hex");

      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expected);

      if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        logger.warn("[github] Invalid webhook signature");
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Route by event type
      const event = req.headers["x-github-event"] as string;
      const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      try {
        switch (event) {
          case "pull_request":
            await this.handlePullRequest(payload);
            break;
          case "issue_comment":
            await this.handleIssueComment(payload);
            break;
          case "push":
            await this.handlePush(payload);
            break;
          case "workflow_run":
            await this.handleWorkflowRun(payload);
            break;
          default:
            logger.debug({ event }, "[github] Unhandled event type");
        }

        res.status(200).json({ ok: true });
      } catch (err) {
        logger.error({ err, event }, "[github] Error handling webhook");
        res.status(500).json({ error: "Internal error" });
      }
    };
  }

  private async handlePullRequest(payload: any) {
    const action = payload.action;
    if (!["opened", "synchronize", "reopened"].includes(action)) return;

    const pr = payload.pull_request;
    const repo = payload.repository.full_name;
    const prNumber = pr.number;
    const prTitle = pr.title;
    const prAuthor = pr.user.login;

    const prompt = `Review PR #${prNumber} "${prTitle}" by ${prAuthor} di repo ${repo}.

Langkah-langkah:
1. Jalankan \`gh pr diff ${prNumber}\` buat liat perubahan
2. Analisa kode — cek logic, security, performance, readability
3. Post review pake \`gh pr review ${prNumber} --comment --body "review"\`

Format:
## Review Summary
- Verdict: (approve/request-changes/comment)
- Risk level: (low/medium/high)

## Issues Found
(numbered list atau "None")

## Suggestions
(numbered list atau "None")`;

    logger.info({ repo, prNumber, prTitle, action }, "[github] PR review event");

    await this.handler({
      type: "pr_review",
      repo,
      prNumber,
      prTitle,
      prAuthor,
      prompt,
    });
  }

  private async handleIssueComment(payload: any) {
    if (payload.action !== "created") return;

    const comment = payload.comment.body as string;
    const mentionedBot = BOT_MENTIONS.find((bot) => comment.includes(bot));
    if (!mentionedBot) return;

    // Only handle comments on PRs (issue_comment fires for both issues and PRs)
    const pr = payload.issue;
    if (!pr.pull_request) return;

    const repo = payload.repository.full_name;
    const prNumber = pr.number;
    const prTitle = pr.title;

    const prompt = `Ini dari PR #${prNumber} (${prTitle}) di repo ${repo}. User bilang: ${comment}`;

    logger.info({ repo, prNumber, mentionedBot }, "[github] PR comment event with bot mention");

    await this.handler({
      type: "pr_comment",
      repo,
      prNumber,
      prTitle,
      comment,
      mentionedBot,
      prompt,
    });
  }

  private async handlePush(payload: any) {
    const repo = payload.repository.full_name;
    const ref = payload.ref;
    const commits = (payload.commits || []).map((c: any) => ({
      id: c.id,
      message: c.message,
      author: c.author?.username || c.author?.name || "unknown",
    }));

    logger.info({ repo, ref, commitCount: commits.length }, "[github] Push event");

    await this.handler({
      type: "push",
      repo,
      ref,
      commits,
    });
  }

  private async handleWorkflowRun(payload: any) {
    const run = payload.workflow_run;
    if (run.conclusion !== "failure") return;

    const repo = payload.repository.full_name;

    logger.info({ repo, workflow: run.name, runId: run.id }, "[github] CI failure event");

    await this.handler({
      type: "ci_failure",
      repo,
      workflowName: run.name,
      runId: run.id,
      branch: run.head_branch,
      conclusion: run.conclusion,
    });
  }
}
