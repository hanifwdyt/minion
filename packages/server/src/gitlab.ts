import { Request, Response, NextFunction } from "express";
import { logger } from "./logger.js";

// --- Types ---

export interface MRReviewEvent {
  type: "mr_review";
  source: "gitlab";
  repo: string;
  projectId: number;
  mrIid: number;
  mrTitle: string;
  mrAuthor: string;
  sourceBranch: string;
  targetBranch: string;
  prompt: string;
}

export interface MRCommentEvent {
  type: "mr_comment";
  source: "gitlab";
  repo: string;
  projectId: number;
  mrIid: number;
  mrTitle: string;
  comment: string;
  mentionedBot: string;
  discussionId?: string;
  filePath?: string;
  lineNumber?: number;
  prompt: string;
}

export interface GitLabPushEvent {
  type: "push";
  source: "gitlab";
  repo: string;
  projectId: number;
  ref: string;
  commits: { id: string; message: string; author: string }[];
}

export interface GitLabCIFailureEvent {
  type: "ci_failure";
  source: "gitlab";
  repo: string;
  projectId: number;
  pipelineId: number;
  branch: string;
  status: string;
}

export type GitLabEvent = MRReviewEvent | MRCommentEvent | GitLabPushEvent | GitLabCIFailureEvent;
export type GitLabEventHandler = (event: GitLabEvent) => void | Promise<void>;

// --- Mention bots ---

const BOT_MENTIONS = ["@minion", "@semar", "@gareng", "@petruk", "@bagong"];

// --- Class ---

export class GitLabWebhook {
  private secret: string;
  private handler: GitLabEventHandler;

  constructor(secret: string, handler: GitLabEventHandler) {
    this.secret = secret;
    this.handler = handler;
  }

  middleware() {
    return async (req: Request, res: Response, _next: NextFunction) => {
      // Validate token — GitLab uses simple string comparison via X-Gitlab-Token
      const token = req.headers["x-gitlab-token"] as string | undefined;
      if (!token) {
        logger.warn("[gitlab] Missing X-Gitlab-Token header");
        return res.status(401).json({ error: "Missing token" });
      }

      if (token !== this.secret) {
        logger.warn("[gitlab] Invalid webhook token");
        return res.status(401).json({ error: "Invalid token" });
      }

      // Route by event type
      const event = req.headers["x-gitlab-event"] as string;
      const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      try {
        switch (payload.object_kind) {
          case "merge_request":
            await this.handleMergeRequest(payload);
            break;
          case "note":
            await this.handleNote(payload);
            break;
          case "pipeline":
            await this.handlePipeline(payload);
            break;
          case "push":
            await this.handlePush(payload);
            break;
          default:
            logger.debug({ event, objectKind: payload.object_kind }, "[gitlab] Unhandled event type");
        }

        res.status(200).json({ ok: true });
      } catch (err) {
        logger.error({ err, event }, "[gitlab] Error handling webhook");
        res.status(500).json({ error: "Internal error" });
      }
    };
  }

  private async handleMergeRequest(payload: any) {
    const action = payload.object_attributes?.action;
    if (!["open", "update", "reopen"].includes(action)) return;

    const mr = payload.object_attributes;
    const repo = payload.project?.path_with_namespace;
    const projectId = payload.project?.id;
    const mrIid = mr.iid;
    const mrTitle = mr.title;
    const mrAuthor = mr.last_commit?.author?.name || payload.user?.username || "unknown";
    const sourceBranch = mr.source_branch;
    const targetBranch = mr.target_branch;

    const prompt = `Review MR !${mrIid} "${mrTitle}" by ${mrAuthor} di repo ${repo} (GitLab).
Branch: ${sourceBranch} → ${targetBranch}

Langkah-langkah:
1. Jalankan \`glab mr diff ${mrIid}\` buat liat perubahan
2. Analisa kode — cek logic, security, performance, readability
3. Post review pake \`glab mr comment ${mrIid} --message "review text"\`

Format:
## Review Summary
- Verdict: (approve/request-changes/comment)
- Risk level: (low/medium/high)

## Issues Found
(numbered list atau "None")

## Suggestions
(numbered list atau "None")`;

    logger.info({ repo, mrIid, mrTitle, action }, "[gitlab] MR review event");

    await this.handler({
      type: "mr_review",
      source: "gitlab",
      repo,
      projectId,
      mrIid,
      mrTitle,
      mrAuthor,
      sourceBranch,
      targetBranch,
      prompt,
    });
  }

  private async handleNote(payload: any) {
    // Only handle notes on merge requests
    if (payload.object_attributes?.noteable_type !== "MergeRequest") return;

    const comment = payload.object_attributes.note as string;
    const mentionedBot = BOT_MENTIONS.find((bot) => comment.includes(bot));
    if (!mentionedBot) return;

    const mr = payload.merge_request;
    if (!mr) return;

    const repo = payload.project?.path_with_namespace;
    const projectId = payload.project?.id;
    const mrIid = mr.iid;
    const mrTitle = mr.title;
    const discussionId = payload.object_attributes?.discussion_id;
    const notePosition = payload.object_attributes?.position;
    const commentAuthor = payload.object_attributes?.author?.username || payload.user?.username || "unknown";

    // Build rich context
    let contextInfo = "";
    let filePath: string | undefined;
    let lineNumber: number | undefined;

    if (notePosition) {
      filePath = notePosition.new_path;
      lineNumber = notePosition.new_line;
      contextInfo += `\nInline comment on file: \`${filePath}\`, line ${lineNumber}`;
      if (notePosition.old_path && notePosition.old_path !== notePosition.new_path) {
        contextInfo += ` (renamed from \`${notePosition.old_path}\`)`;
      }
    }

    const prompt = `Review comment dari **${commentAuthor}** di MR !${mrIid} "${mrTitle}" repo ${repo} (GitLab).
${contextInfo}

Comment: ${comment}

${discussionId ? `Discussion ID: ${discussionId}` : ""}
Project ID: ${projectId}
MR IID: ${mrIid}

Instruksi (FULL AUTO MODE):
1. Pahami feedback dari reviewer
2. Baca file yang dimaksud dan pahami konteksnya${filePath ? ` — cek \`${filePath}\`` : ""}
3. Kalo reviewer minta fix/change, fix kodenya langsung
4. Commit & push perubahan kalo ada fix
5. Reply ke discussion thread${discussionId ? `: curl -X POST "$GITLAB_API/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}/notes" -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" -d '{"body":"<reply message>"}'` : ` pake glab mr comment ${mrIid} --message "<reply>"`}
6. ${discussionId ? `Resolve discussion setelah fix: curl -X PUT "$GITLAB_API/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}" -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" -d '{"resolved":true}'` : "Mark as resolved kalo udah selesai"}

PENTING: Jangan lupa commit & push sebelum reply. Reply harus jelasin apa yang lo fix.`;

    logger.info({ repo, mrIid, mentionedBot, discussionId, filePath }, "[gitlab] MR comment event with bot mention");

    await this.handler({
      type: "mr_comment",
      source: "gitlab",
      repo,
      projectId,
      mrIid,
      mrTitle,
      comment,
      mentionedBot,
      discussionId,
      filePath,
      lineNumber,
      prompt,
    });
  }

  private async handlePipeline(payload: any) {
    const pipeline = payload.object_attributes;
    if (pipeline?.status !== "failed") return;

    const repo = payload.project?.path_with_namespace;
    const projectId = payload.project?.id;

    logger.info({ repo, pipelineId: pipeline.id, branch: pipeline.ref }, "[gitlab] CI failure event");

    await this.handler({
      type: "ci_failure",
      source: "gitlab",
      repo,
      projectId,
      pipelineId: pipeline.id,
      branch: pipeline.ref,
      status: pipeline.status,
    });
  }

  private async handlePush(payload: any) {
    const repo = payload.project?.path_with_namespace;
    const projectId = payload.project_id;
    const ref = payload.ref;
    const commits = (payload.commits || []).map((c: any) => ({
      id: c.id,
      message: c.message,
      author: c.author?.username || c.author?.name || "unknown",
    }));

    logger.info({ repo, ref, commitCount: commits.length }, "[gitlab] Push event");

    await this.handler({
      type: "push",
      source: "gitlab",
      repo,
      projectId,
      ref,
      commits,
    });
  }
}
