import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { resolve } from "path";
import rateLimit from "express-rate-limit";
import { ClaudeManager } from "./claude.js";
import { ChatStore } from "./chat-store.js";
import { ConfigStore } from "./config-store.js";
import { BalaiDesa } from "./balai.js";
import { ActivityLog } from "./activity.js";
import { AuditLog } from "./audit.js";
import { MetricsStore } from "./metrics.js";
import { isApprovalRequired } from "./tool-safety.js";
import { FileTracker } from "./file-tracker.js";
import { OutputStore } from "./output-store.js";
import { generateInvoicePDF, getExampleInvoiceData } from "./invoice.js";
import { TelegramBot } from "./telegram.js";
import { SlackBot } from "./slack.js";
import { setupAuth, authMiddleware } from "./auth.js";
import { validate, minionUpdateSchema, soulUpdateSchema, sharedContextSchema, integrationSchema } from "./validation.js";
import { logger, requestLogger } from "./logger.js";
import { MemoryStore } from "./memory.js";
import { DebateEngine } from "./debate.js";
import { GitHubWebhook, GitHubEvent } from "./github.js";
import { WorkdirManager } from "./workdir-manager.js";
import { ApprovalManager } from "./approval.js";
import { assessPromptRisk } from "./tool-safety.js";
import { TriggerEngine } from "./triggers.js";
import { ProjectScanner } from "./project-scanner.js";
import { ArtifactExtractor } from "./artifacts.js";
import { GitLabWebhook, GitLabEvent } from "./gitlab.js";
import { GitLabClient } from "./gitlab-client.js";
import { GitLabPoller } from "./gitlab-poller.js";
import { VPNManager } from "./vpn.js";

// --- Core services ---
const configStore = new ConfigStore();
const claude = new ClaudeManager();
const chatStore = new ChatStore();
const activity = new ActivityLog();
const fileTracker = new FileTracker();
const audit = new AuditLog();
const metrics = new MetricsStore();
const memoryStore = new MemoryStore();
const outputStore = new OutputStore();
const workdirManager = new WorkdirManager(resolve("."));
const projectScanner = new ProjectScanner();
const artifactExtractor = new ArtifactExtractor();
const vpnManager = new VPNManager();
let debateEngine: DebateEngine;
let approvalManager: ApprovalManager;
let triggerEngine: TriggerEngine;

function getMinionName(id: string): string {
  return configStore.getMinion(id)?.name || id;
}

// Log loaded souls at startup
for (const config of configStore.getMinions()) {
  const prompt = configStore.loadSystemPrompt(config);
  if (prompt) logger.info({ minion: config.id, chars: prompt.length }, `Soul loaded for ${config.id}`);
}

// --- Express + Socket.IO ---
const app = express();
app.use(express.json({ limit: "100kb" }));
app.use(requestLogger());

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Too many requests, try again later" },
});
const promptLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: "Too many prompts, slow down" },
});
app.use("/api/", apiLimiter);

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["http://localhost:3000", "http://localhost:5173"];

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigins, methods: ["GET", "POST"] },
});

// --- Auth ---
setupAuth(app, configStore);
const protect = authMiddleware(configStore);

// --- GitHub Webhook (outside auth — uses its own signature validation) ---
const githubConfig = configStore.getIntegrations().github;
if (githubConfig?.enabled && githubConfig.webhookSecret) {
  const githubWebhook = new GitHubWebhook(githubConfig.webhookSecret, async (event: GitHubEvent) => {
    const balaiWorkdir = resolve(configStore.getMinions()[0]?.workdir || ".");

    if (event.type === "pr_review") {
      const reviewer = githubConfig.defaultReviewer || "gareng";
      const reviewConfig = configStore.getMinion(reviewer);
      if (!reviewConfig) return;

      // Use isolated workdir for PR review
      const workdir = workdirManager.prepareWorkdir(reviewer, balaiWorkdir, `pr-${event.prNumber}`);
      const systemPrompt = configStore.loadSystemPrompt(reviewConfig);
      const memoryContext = memoryStore.buildMemoryContext(reviewer, event.prompt);
      const knowledgeContext = memoryStore.buildKnowledgeContext();

      claude.runPrompt(reviewer, event.prompt, workdir, {
        systemPrompt: (systemPrompt || "") + memoryContext + knowledgeContext || undefined,
        allowedTools: reviewConfig.allowedTools,
        maxTurns: reviewConfig.maxTurns,
      });
    } else if (event.type === "pr_comment") {
      // Route to mentioned minion or balai
      const minionId = event.mentionedBot.replace("@", "") || "balai";
      if (minionId === "balai" || minionId === "minion") {
        balai.handlePrompt(event.prompt, balaiWorkdir);
      } else {
        const config = configStore.getMinion(minionId);
        if (!config) return;
        const systemPrompt = configStore.loadSystemPrompt(config);
        claude.runPrompt(minionId, event.prompt, balaiWorkdir, {
          systemPrompt: systemPrompt || undefined,
          allowedTools: config.allowedTools,
          maxTurns: config.maxTurns,
        });
      }
    } else if (event.type === "ci_failure") {
      const prompt = `CI workflow "${event.workflowName}" failed on branch ${event.branch} di repo ${event.repo}. Run ID: ${event.runId}.\n\nAnalisa kenapa CI-nya fail. Jalankan \`gh run view ${event.runId} --log-failed\` buat liat error logs. Kasih summary masalahnya dan suggest fix.`;
      const garengConfig = configStore.getMinion("gareng");
      if (!garengConfig) return;
      const systemPrompt = configStore.loadSystemPrompt(garengConfig);
      claude.runPrompt("gareng", prompt, balaiWorkdir, {
        systemPrompt: systemPrompt || undefined,
        allowedTools: garengConfig.allowedTools,
        maxTurns: garengConfig.maxTurns,
      });
    }
    // push events are handled by trigger system (Phase 2.1)
  });

  app.post("/api/webhooks/github", express.raw({ type: "application/json" }), githubWebhook.middleware());
  logger.info("GitHub webhook enabled");
}

// --- GitLab Webhook + Poller ---
const gitlabConfig = configStore.getIntegrations().gitlab;
let gitlabClient: GitLabClient | null = null;
let gitlabPoller: GitLabPoller | null = null;

if (gitlabConfig?.enabled && gitlabConfig.instanceURL && gitlabConfig.apiToken) {
  gitlabClient = new GitLabClient(gitlabConfig.instanceURL, gitlabConfig.apiToken);

  // GitLab env vars for glab CLI + curl inside Claude processes
  const gitlabEnv = {
    GITLAB_HOST: gitlabConfig.instanceURL.replace(/^https?:\/\//, ""),
    GITLAB_TOKEN: gitlabConfig.apiToken,
    GITLAB_API: gitlabConfig.instanceURL.replace(/\/$/, "") + "/api/v4",
  };

  // Multi-repo workdir resolver: extract repo name from prompt/path and resolve to local clone
  const REPOS_BASE = process.env.REPOS_BASE || resolve("repos");
  const resolveRepoWorkdir = (repo: string): string => {
    // repo = "group/subgroup/project" → use last segment as dir name
    const repoName = repo.split("/").pop() || repo;
    const repoDir = resolve(REPOS_BASE, repoName);
    return repoDir;
  };

  const handleGitLabMRReview = (repo: string, projectId: number, mrIid: number, mrTitle: string, mrAuthor: string, sourceBranch: string, targetBranch: string) => {
    const reviewer = gitlabConfig.defaultReviewer || "gareng";
    const reviewConfig = configStore.getMinion(reviewer);
    if (!reviewConfig) return;

    const workdir = resolveRepoWorkdir(repo);
    const systemPrompt = configStore.loadSystemPrompt(reviewConfig);
    const memoryContext = memoryStore.buildMemoryContext(reviewer, mrTitle);
    const knowledgeContext = memoryStore.buildKnowledgeContext();

    const prompt = `Review MR !${mrIid} "${mrTitle}" by ${mrAuthor} di repo ${repo} (GitLab).
Branch: ${sourceBranch} → ${targetBranch}
Project ID: ${projectId}

Langkah-langkah:
1. Pastiin lo di branch yang bener: \`git fetch origin && git checkout ${sourceBranch} && git pull\`
2. Jalankan \`glab mr diff ${mrIid}\` buat liat perubahan
3. Analisa kode — cek logic, security, performance, readability
4. Post review pake \`glab mr comment ${mrIid} --message "review text"\`

Format:
## Review Summary
- Verdict: (approve/request-changes/comment)
- Risk level: (low/medium/high)

## Issues Found
(numbered list atau "None")

## Suggestions
(numbered list atau "None")`;

    claude.runPrompt(reviewer, prompt, workdir, {
      systemPrompt: (systemPrompt || "") + memoryContext + knowledgeContext || undefined,
      allowedTools: reviewConfig.allowedTools,
      maxTurns: reviewConfig.maxTurns,
      env: { ...gitlabEnv, GITLAB_PROJECT_ID: String(projectId) },
    });
  };

  const handleGitLabCIFailure = (repo: string, projectId: number, pipelineId: number, branch: string) => {
    const garengConfig = configStore.getMinion("gareng");
    if (!garengConfig) return;
    const workdir = resolveRepoWorkdir(repo);
    const systemPrompt = configStore.loadSystemPrompt(garengConfig);

    const prompt = `CI pipeline #${pipelineId} failed on branch ${branch} di repo ${repo} (GitLab).\n\nAnalisa kenapa pipeline-nya fail. Jalankan \`glab ci view ${pipelineId}\` buat liat status jobs. Cek logs dari failed jobs. Kasih summary masalahnya dan suggest fix.`;

    claude.runPrompt("gareng", prompt, workdir, {
      systemPrompt: systemPrompt || undefined,
      allowedTools: garengConfig.allowedTools,
      maxTurns: garengConfig.maxTurns,
      env: { ...gitlabEnv, GITLAB_PROJECT_ID: String(projectId) },
    });
  };

  // Webhook mode
  if (gitlabConfig.mode === "webhook" || gitlabConfig.mode === "both") {
    if (gitlabConfig.webhookSecret) {
      const gitlabWebhook = new GitLabWebhook(gitlabConfig.webhookSecret, async (event: GitLabEvent) => {
        if (event.type === "mr_review") {
          handleGitLabMRReview(event.repo, event.projectId, event.mrIid, event.mrTitle, event.mrAuthor, event.sourceBranch, event.targetBranch);
        } else if (event.type === "mr_comment") {
          const minionId = event.mentionedBot.replace("@", "") || "balai";
          const workdir = resolveRepoWorkdir(event.repo);
          if (minionId === "balai" || minionId === "minion") {
            balai.handlePrompt(event.prompt, workdir, { ...gitlabEnv, GITLAB_PROJECT_ID: String(event.projectId) });
          } else {
            const config = configStore.getMinion(minionId);
            if (!config) return;
            const systemPrompt = configStore.loadSystemPrompt(config);
            claude.runPrompt(minionId, event.prompt, workdir, {
              systemPrompt: systemPrompt || undefined,
              allowedTools: config.allowedTools,
              maxTurns: config.maxTurns,
              env: { ...gitlabEnv, GITLAB_PROJECT_ID: String(event.projectId) },
            });
          }
        } else if (event.type === "ci_failure") {
          handleGitLabCIFailure(event.repo, event.projectId, event.pipelineId, event.branch);
        }
        // push events handled by trigger engine
        if (event.type === "push") {
          triggerEngine.fireGitLabEvent("push", { repo: event.repo, ref: event.ref });
        }
      });

      app.post("/api/webhooks/gitlab", gitlabWebhook.middleware());
      logger.info("GitLab webhook enabled");
    }
  }

  // Polling mode
  if (gitlabConfig.mode === "poll" || gitlabConfig.mode === "both") {
    if (gitlabConfig.projects.length > 0) {
      gitlabPoller = new GitLabPoller(gitlabClient, gitlabConfig.projects, async (event) => {
        if (event.type === "mr_opened" || event.type === "mr_updated") {
          const mr = event.data;
          handleGitLabMRReview(event.projectPath, Number(event.projectId), mr.iid, mr.title, mr.author?.username || "unknown", mr.source_branch, mr.target_branch);
          triggerEngine.fireGitLabEvent(event.type, { repo: event.projectPath, branch: mr.source_branch, mr_iid: String(mr.iid) });
        } else if (event.type === "pipeline_failed") {
          const pipeline = event.data;
          handleGitLabCIFailure(event.projectPath, Number(event.projectId), pipeline.id, pipeline.ref);
          triggerEngine.fireGitLabEvent("pipeline_failed", { repo: event.projectPath, pipeline_id: String(pipeline.id), branch: pipeline.ref });
        } else if (event.type === "mr_discussion") {
          // Full auto: handle unresolved discussion with bot mention
          const { mrIid, mrTitle, discussion, lastNote, sourceBranch } = event.data;
          const minionId = (() => {
            const botMentions = ["@minion", "@semar", "@gareng", "@petruk", "@bagong"];
            const match = botMentions.find((b) => lastNote.body.includes(b));
            return match ? match.replace("@", "") : "balai";
          })();

          const workdir = resolveRepoWorkdir(event.projectPath);
          const projectId = Number(event.projectId);
          const discussionId = discussion.id;
          const filePath = lastNote.position?.new_path;
          const lineNumber = lastNote.position?.new_line;

          let contextInfo = "";
          if (filePath) contextInfo += `\nInline comment on file: \`${filePath}\`, line ${lineNumber}`;

          const prompt = `Review comment di MR !${mrIid} "${mrTitle}" repo ${event.projectPath} (GitLab).
${contextInfo}

Comment: ${lastNote.body}

Discussion ID: ${discussionId}
Project ID: ${projectId}
MR IID: ${mrIid}

Instruksi (FULL AUTO MODE):
1. Pahami feedback dari reviewer
2. ${filePath ? `Baca file \`${filePath}\` dan pahami konteksnya` : "Pahami konteks MR"}
3. Kalo reviewer minta fix/change, fix kodenya langsung
4. Pastiin lo di branch yang bener: \`git fetch origin && git checkout ${sourceBranch} && git pull\`
5. Commit & push perubahan kalo ada fix
6. Reply ke discussion: curl -X POST "$GITLAB_API/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}/notes" -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" -d '{"body":"<reply>"}'
7. Resolve discussion: curl -X PUT "$GITLAB_API/projects/${projectId}/merge_requests/${mrIid}/discussions/${discussionId}" -H "PRIVATE-TOKEN: $GITLAB_TOKEN" -H "Content-Type: application/json" -d '{"resolved":true}'

PENTING: Commit & push SEBELUM reply. Reply harus jelasin apa yang lo fix.`;

          const targetMinion = minionId === "balai" || minionId === "minion" ? "semar" : minionId;
          const config = configStore.getMinion(targetMinion);
          if (!config) return;
          const systemPrompt = configStore.loadSystemPrompt(config);

          claude.runPrompt(targetMinion, prompt, workdir, {
            systemPrompt: systemPrompt || undefined,
            allowedTools: config.allowedTools,
            maxTurns: config.maxTurns,
            env: { ...gitlabEnv, GITLAB_PROJECT_ID: String(projectId) },
          });
        }
      }, "minion", vpnManager);
      gitlabPoller.start();
      logger.info({ projects: gitlabConfig.projects }, "GitLab poller started");
    }
  }
}

// --- REST API ---

// Minions
app.get("/api/minions", protect, (_req, res) => {
  res.json(configStore.getMinions().map((m) => ({ ...m, status: claude.getStatus(m.id) })));
});

app.get("/api/minions/:id", protect, (req, res) => {
  const minion = configStore.getMinion(String(req.params.id));
  if (!minion) return res.status(404).json({ error: "Not found" });
  res.json({ ...minion, status: claude.getStatus(minion.id) });
});

app.put("/api/minions/:id", protect, validate(minionUpdateSchema), (req, res) => {
  const updated = configStore.updateMinion(String(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: "Not found" });
  io.emit("minions:list", configStore.getMinions().map((m) => ({ ...m, status: claude.getStatus(m.id) })));
  res.json(updated);
});

// Souls
app.get("/api/souls/:id", protect, (req, res) => {
  const id = String(req.params.id);
  res.json({ id, content: configStore.getSoul(id) });
});

app.put("/api/souls/:id", protect, validate(soulUpdateSchema), (req, res) => {
  const id = String(req.params.id);
  configStore.setSoul(id, req.body.content);
  logger.info({ minion: id }, "Soul updated");
  res.json({ id, ok: true });
});

// Shared context
app.get("/api/shared-context", protect, (_req, res) => {
  res.json({ content: configStore.getSharedContext() });
});

app.put("/api/shared-context", protect, validate(sharedContextSchema), (req, res) => {
  configStore.setSharedContext(req.body.content);
  logger.info("Shared context updated");
  res.json({ ok: true });
});

// Activity feed
app.get("/api/activity", protect, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(activity.getRecent(limit));
});

// Integrations
app.get("/api/integrations", protect, (_req, res) => {
  res.json(configStore.getIntegrations());
});

app.put("/api/integrations", protect, validate(integrationSchema), (req, res) => {
  configStore.updateIntegrations(req.body);
  logger.info("Integrations updated");
  res.json(configStore.getIntegrations());
});

// Usage
app.get("/api/usage", protect, (_req, res) => {
  res.json(claude.getUsageStats());
});

// Metrics
app.get("/api/metrics", protect, (_req, res) => {
  res.json(metrics.getAll());
});

// Audit trail
app.get("/api/audit", protect, (req, res) => {
  const opts = {
    from: req.query.from ? Number(req.query.from) : undefined,
    to: req.query.to ? Number(req.query.to) : undefined,
    minionId: req.query.minionId ? String(req.query.minionId) : undefined,
    type: req.query.type ? String(req.query.type) : undefined,
    limit: Math.min(Number(req.query.limit) || 100, 500),
  };
  res.json(audit.query(opts));
});

// Memories
app.get("/api/memories/:minionId", protect, (req, res) => {
  res.json(memoryStore.getMemories(String(req.params.minionId)));
});

app.delete("/api/memories/:minionId/:memoryId", protect, (req, res) => {
  memoryStore.deleteMemory(String(req.params.minionId), String(req.params.memoryId));
  res.json({ ok: true });
});

// Knowledge base
app.get("/api/knowledge", protect, (_req, res) => {
  res.json(memoryStore.getKnowledgeFiles());
});

app.get("/api/knowledge/:name", protect, (req, res) => {
  res.json({ name: req.params.name, content: memoryStore.getKnowledge(String(req.params.name)) });
});

app.put("/api/knowledge/:name", protect, (req, res) => {
  memoryStore.setKnowledge(String(req.params.name), req.body.content || "");
  res.json({ ok: true });
});

// Execution traces
app.get("/api/traces", protect, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json(claude.traces.getRecent(limit));
});

app.get("/api/traces/:id", protect, (req, res) => {
  const trace = claude.traces.getById(String(req.params.id));
  if (!trace) return res.status(404).json({ error: "Trace not found" });
  res.json(trace);
});

// Chat history
app.get("/api/chat/:minionId", protect, (req, res) => {
  res.json(chatStore.getAll(String(req.params.minionId)));
});

app.delete("/api/chat/:minionId", protect, (req, res) => {
  chatStore.clear(String(req.params.minionId));
  res.json({ ok: true });
});

// File changes
app.get("/api/files", protect, (_req, res) => {
  res.json(fileTracker.getRecentChanges());
});

// Approvals
app.get("/api/approvals", protect, (_req, res) => {
  res.json(approvalManager.getPendingRequests());
});

// Worktrees
app.get("/api/worktrees", protect, (_req, res) => {
  res.json(workdirManager.getActiveWorktrees());
});

// VPN status
app.get("/api/vpn/status", protect, async (_req, res) => {
  const connected = await vpnManager.isConnected();
  res.json({ connected, waitingApproval: vpnManager.isWaitingApproval() });
});

app.post("/api/vpn/connect", protect, async (_req, res) => {
  const connected = await vpnManager.connect();
  res.json({ connected });
});

app.post("/api/vpn/disconnect", protect, async (_req, res) => {
  await vpnManager.disconnect();
  res.json({ ok: true });
});

// Triggers
app.get("/api/triggers", protect, (_req, res) => {
  res.json(triggerEngine.getTriggers());
});

app.post("/api/triggers", protect, (req, res) => {
  const trigger = triggerEngine.addTrigger(req.body);
  res.status(201).json(trigger);
});

app.put("/api/triggers/:id", protect, (req, res) => {
  const updated = triggerEngine.updateTrigger(String(req.params.id), req.body);
  if (!updated) return res.status(404).json({ error: "Trigger not found" });
  res.json(updated);
});

app.delete("/api/triggers/:id", protect, (req, res) => {
  const deleted = triggerEngine.deleteTrigger(String(req.params.id));
  if (!deleted) return res.status(404).json({ error: "Trigger not found" });
  res.json({ ok: true });
});

// Generic webhook trigger endpoint
app.post("/api/webhooks/trigger/:id", (req, res) => {
  const data = req.body || {};
  triggerEngine.fireWebhook(String(req.params.id), data);
  res.json({ ok: true });
});

// Artifacts
app.get("/api/artifacts", protect, (req, res) => {
  const minionId = req.query.minionId ? String(req.query.minionId) : undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json(artifactExtractor.getArtifacts(minionId, limit));
});

app.get("/api/artifacts/:id", protect, (req, res) => {
  const artifact = artifactExtractor.getArtifact(String(req.params.id));
  if (!artifact) return res.status(404).json({ error: "Artifact not found" });
  res.json(artifact);
});

// Project scanner
app.post("/api/rescan", protect, (req, res) => {
  const workdir = resolve(req.body?.workdir || configStore.getMinions()[0]?.workdir || ".");
  const ctx = projectScanner.scan(workdir);
  const markdown = projectScanner.toMarkdown(ctx);
  configStore.setSharedContext(markdown);
  res.json({ ok: true, project: ctx.name, techStack: ctx.techStack });
});

// GitLab API proxy endpoints
app.get("/api/gitlab/projects", protect, async (_req, res) => {
  if (!gitlabClient) return res.status(400).json({ error: "GitLab not configured" });
  const projects = gitlabConfig!.projects;
  const results = [];
  for (const p of projects) {
    try { results.push(await gitlabClient.getProject(p)); } catch {}
  }
  res.json(results);
});

app.get("/api/gitlab/mrs/:projectId", protect, async (req, res) => {
  if (!gitlabClient) return res.status(400).json({ error: "GitLab not configured" });
  try {
    const mrs = await gitlabClient.listOpenMRs(String(req.params.projectId));
    res.json(mrs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/gitlab/issues/:projectId", protect, async (req, res) => {
  if (!gitlabClient) return res.status(400).json({ error: "GitLab not configured" });
  try {
    const issues = await gitlabClient.listIssues(String(req.params.projectId), String(req.query.state || "opened"));
    res.json(issues);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/gitlab/review/:projectId/:mrIid", protect, async (req, res) => {
  if (!gitlabClient || !gitlabConfig?.enabled) return res.status(400).json({ error: "GitLab not configured" });
  const projectId = String(req.params.projectId);
  const mrIid = Number(req.params.mrIid);
  try {
    const mr = (await gitlabClient.listOpenMRs(projectId)).find(m => m.iid === mrIid);
    if (!mr) return res.status(404).json({ error: "MR not found" });
    // Trigger review — reuse the project path from config or fallback
    const projectPath = gitlabConfig!.projects.find(p => p.includes(projectId)) || projectId;
    const reviewer = gitlabConfig!.defaultReviewer || "gareng";
    const reviewConfig = configStore.getMinion(reviewer);
    if (!reviewConfig) return res.status(400).json({ error: "Reviewer minion not found" });

    const balaiWorkdir = resolve(configStore.getMinions()[0]?.workdir || ".");
    const workdir = workdirManager.prepareWorkdir(reviewer, balaiWorkdir, `mr-${mrIid}`);
    const systemPrompt = configStore.loadSystemPrompt(reviewConfig);
    const gitlabEnv = {
      GITLAB_HOST: gitlabConfig!.instanceURL.replace(/^https?:\/\//, ""),
      GITLAB_TOKEN: gitlabConfig!.apiToken,
    };

    const prompt = `Review MR !${mrIid} "${mr.title}" by ${mr.author.username} di repo ${projectPath} (GitLab).\nBranch: ${mr.source_branch} → ${mr.target_branch}\n\nJalankan \`glab mr diff ${mrIid}\` buat liat perubahan, analisa kode, terus post review pake \`glab mr comment ${mrIid} --message "review"\`.`;

    claude.runPrompt(reviewer, prompt, workdir, {
      systemPrompt: systemPrompt || undefined,
      allowedTools: reviewConfig.allowedTools,
      maxTurns: reviewConfig.maxTurns,
      env: gitlabEnv,
    });

    res.json({ ok: true, reviewer, mrIid });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Health check (always public)
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    minions: configStore.getMinions().length,
    activeProcesses: configStore.getMinions().filter((m) => claude.getStatus(m.id) === "working").length,
  });
});

// --- Claude event forwarding ---
claude.on("chat", (data) => {
  chatStore.add(data.minionId, data.message);
  io.emit("minion:chat", data);

  if (data.message.role === "tool" && data.message.toolName) {
    activity.add({
      minionId: data.minionId,
      minionName: getMinionName(data.minionId),
      type: "tool",
      summary: `Used ${data.message.toolName}`,
    });
    try {
      const input = JSON.parse(data.message.content);
      fileTracker.trackToolUse(data.minionId, getMinionName(data.minionId), data.message.toolName, input);
    } catch { /* not JSON */ }
  } else if (data.message.role === "assistant" && data.minionId !== "balai") {
    activity.add({
      minionId: data.minionId,
      minionName: getMinionName(data.minionId),
      type: "response",
      summary: data.message.content.slice(0, 80),
    });
  }
});

claude.on("chat:delta", (data) => {
  chatStore.updateContent(data.minionId, data.messageId, data.content);
  io.emit("minion:chat:delta", data);
});

claude.on("status", (data) => {
  io.emit("minion:status", data);
  activity.add({
    minionId: data.minionId,
    minionName: getMinionName(data.minionId),
    type: "status",
    summary: data.status === "working" ? "Started working" : "Finished",
  });
});

claude.on("done", (data) => {
  io.emit("minion:done", data);
  fileTracker.clearMinion(data.minionId);

  // Auto-extract episodic memory + record metrics from trace
  if (data.traceId) {
    const trace = claude.traces.getById(data.traceId);
    if (trace) {
      // Metrics
      const toolSteps = trace.steps.filter((s) => s.type === "tool_call");
      const toolCounts: Record<string, number> = {};
      for (const s of toolSteps) {
        if (s.toolName) toolCounts[s.toolName] = (toolCounts[s.toolName] || 0) + 1;
      }
      metrics.recordTask(data.minionId, {
        status: trace.status as any,
        durationMs: (trace.completedAt || Date.now()) - trace.startedAt,
        tokensInput: trace.tokenUsage.input,
        tokensOutput: trace.tokenUsage.output,
        cost: trace.cost,
        toolCalls: toolCounts,
        loopDetections: trace.loopDetections,
      });

      // Episodic memory
      if (trace.status === "completed" && trace.steps.length > 0) {
        const reasoningSteps = trace.steps.filter((s) => s.type === "reasoning");
        const summary = reasoningSteps.length > 0
          ? reasoningSteps[reasoningSteps.length - 1].content.slice(0, 200)
          : `Completed task with ${toolSteps.length} tool calls`;
        const tags = [...new Set(toolSteps.map((s) => s.toolName).filter(Boolean))] as string[];

        memoryStore.addMemory({
          minionId: data.minionId,
          type: "episodic",
          content: summary,
          context: trace.prompt,
          outcome: data.code === 0 ? "success" : "failure",
          tags,
        });
      }
    }
  }

  // Extract artifacts from completed task chat
  const messages = chatStore.getAll(data.minionId);
  const artifacts = artifactExtractor.extract(data.minionId, messages);
  if (artifacts.length > 0) {
    io.emit("artifacts:new", { minionId: data.minionId, artifacts });
  }
});

activity.on("activity", (event) => {
  io.emit("activity:new", event);
});

// Audit log mirrors activity events (persistent)
audit.on("activity", (event) => {
  io.emit("activity:new", event);
});

fileTracker.on("conflict", (data) => {
  const conflictNames = data.conflictsWith.map((id: string) => getMinionName(id)).join(", ");
  const warningMsg = {
    id: `conflict-${Date.now()}`,
    minionId: data.minionId,
    role: "assistant" as const,
    content: `**Conflict warning:** File \`${data.filePath}\` is also being modified by ${conflictNames}!`,
    timestamp: Date.now(),
  };
  chatStore.add(data.minionId, warningMsg);
  io.emit("minion:chat", { minionId: data.minionId, message: warningMsg });
  logger.warn({ file: data.filePath, minion: data.minionId, conflictsWith: data.conflictsWith }, "File conflict detected");
});

// --- Balai Desa ---
const balai = new BalaiDesa(
  claude, chatStore, io, configStore.getMinions(),
  (config: any) => configStore.loadSystemPrompt(config)
);
debateEngine = new DebateEngine(chatStore, configStore, io);
approvalManager = new ApprovalManager(io);

// --- Trigger Engine ---
triggerEngine = new TriggerEngine(async (minionId, prompt) => {
  const config = configStore.getMinion(minionId);
  if (!config) {
    logger.warn({ minionId }, "Trigger target minion not found");
    return;
  }
  const basePrompt = configStore.loadSystemPrompt(config) || "";
  const memoryContext = memoryStore.buildMemoryContext(minionId, prompt);
  const knowledgeContext = memoryStore.buildKnowledgeContext();
  const fullSystemPrompt = basePrompt + memoryContext + knowledgeContext;

  chatStore.add(minionId, { id: `trigger-${Date.now()}`, minionId, role: "user", content: prompt, timestamp: Date.now() });
  activity.add({ minionId, minionName: getMinionName(minionId), type: "prompt", summary: `[trigger] ${prompt.slice(0, 60)}` });

  claude.runPrompt(minionId, prompt, resolve(config.workdir), {
    systemPrompt: fullSystemPrompt || undefined,
    allowedTools: config.allowedTools,
    maxTurns: config.maxTurns,
    model: config.model,
  });
});

// Load saved triggers from config
const savedTriggers = (configStore.getAll() as any).triggers;
if (Array.isArray(savedTriggers)) {
  triggerEngine.loadTriggers(savedTriggers);
}

// --- Project Scanner: auto-scan on startup ---
try {
  const defaultWorkdir = resolve(configStore.getMinions()[0]?.workdir || ".");
  const ctx = projectScanner.scan(defaultWorkdir);
  const existingContext = configStore.getSharedContext();
  // Only auto-populate if shared context is empty or placeholder
  if (!existingContext || existingContext.includes("(tambahkan catatan project di sini)")) {
    const markdown = projectScanner.toMarkdown(ctx);
    configStore.setSharedContext(markdown);
    logger.info({ project: ctx.name, techStack: ctx.techStack }, "Project context auto-discovered");
  }
} catch (err: any) {
  logger.warn({ error: err.message }, "Project auto-scan failed (non-fatal)");
}

// --- Socket.IO ---
io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Client connected");

  socket.emit("minions:list", configStore.getMinions().map((m) => ({ ...m, status: claude.getStatus(m.id) })));

  const chatHistory: Record<string, any[]> = {};
  for (const config of configStore.getMinions()) {
    const msgs = chatStore.getAll(config.id);
    if (msgs.length > 0) chatHistory[config.id] = msgs;
  }
  const balaiMsgs = chatStore.getAll("balai");
  if (balaiMsgs.length > 0) chatHistory["balai"] = balaiMsgs;
  socket.emit("chat:history", chatHistory);
  socket.emit("activity:history", activity.getRecent());

  socket.on("minion:clear", ({ minionId }) => {
    if (typeof minionId !== "string") return;
    chatStore.clear(minionId);
    logger.info({ minion: minionId }, "Chat cleared");
  });

  socket.on("minion:prompt", async ({ minionId, prompt }) => {
    if (typeof minionId !== "string" || typeof prompt !== "string" || !prompt.trim()) return;
    if (prompt.length > 50000) {
      socket.emit("minion:chat", {
        minionId,
        message: { id: `err-${Date.now()}`, minionId, role: "assistant", content: "Prompt too long (max 50KB)", timestamp: Date.now() },
      });
      return;
    }

    chatStore.add(minionId, { id: `user-${Date.now()}`, minionId, role: "user", content: prompt, timestamp: Date.now() });
    activity.add({ minionId, minionName: minionId === "balai" ? "Balai Desa" : getMinionName(minionId), type: "prompt", summary: prompt.slice(0, 80) });
    logger.info({ minion: minionId, promptLen: prompt.length }, "Prompt received");

    if (minionId === "balai") {
      const balaiWorkdir = resolve(configStore.getMinions()[0]?.workdir || ".");
      // Handle /debate command
      if (prompt.startsWith("/debate ")) {
        const topic = prompt.slice(8).trim();
        if (topic) {
          io.emit("minion:status", { minionId: "balai", status: "working" });
          debateEngine.runDebate(topic, balaiWorkdir);
        }
      } else {
        balai.handlePrompt(prompt, balaiWorkdir);
      }
      return;
    }

    const config = configStore.getMinion(minionId);
    if (!config) {
      socket.emit("minion:chat", {
        minionId,
        message: { id: `err-${Date.now()}`, minionId, role: "assistant", content: `Unknown minion "${minionId}"`, timestamp: Date.now() },
      });
      return;
    }

    // Build system prompt with soul + shared context + memories + knowledge
    const basePrompt = configStore.loadSystemPrompt(config) || "";
    const memoryContext = memoryStore.buildMemoryContext(minionId, prompt);
    const knowledgeContext = memoryStore.buildKnowledgeContext();
    const fullSystemPrompt = basePrompt + memoryContext + knowledgeContext;

    // Pre-flight approval check for high-risk tasks
    const risk = assessPromptRisk(prompt);
    if (risk && risk.riskLevel === "high") {
      const approved = await approvalManager.requestApproval(minionId, prompt, risk.riskLevel, risk.reason);
      if (!approved) {
        const denyMsg = {
          id: `deny-${Date.now()}`,
          minionId,
          role: "assistant" as const,
          content: `_Task ditolak (${risk.reason}). Butuh approval dulu buat operasi high-risk._`,
          timestamp: Date.now(),
        };
        chatStore.add(minionId, denyMsg);
        io.emit("minion:chat", { minionId, message: denyMsg });
        return;
      }
    }

    claude.runPrompt(minionId, prompt, resolve(config.workdir), {
      systemPrompt: fullSystemPrompt || undefined,
      allowedTools: config.allowedTools,
      maxTurns: config.maxTurns,
      model: config.model,
    });
  });

  socket.on("minion:stop", ({ minionId }) => {
    if (typeof minionId !== "string") return;
    claude.stop(minionId);
    logger.info({ minion: minionId }, "Minion stopped");
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Client disconnected");
  });
});

// --- Graceful shutdown ---
function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down...");
  chatStore.destroy();
  claude.stopAll();
  triggerEngine.stopAll();
  if (gitlabPoller) gitlabPoller.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// --- Serve frontend static files ---
const webDistPath = resolve(import.meta.dirname, "../../web/dist");
app.use(express.static(webDistPath));
app.get("/{*path}", (_req, res, next) => {
  // Only serve index.html for non-API routes
  if (_req.path.startsWith("/api/")) return next();
  res.sendFile(resolve(webDistPath, "index.html"));
});

// --- Start ---
const telegramBot = new TelegramBot(claude, configStore, vpnManager, memoryStore);
const slackBot = new SlackBot(claude, configStore);

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, async () => {
  logger.info({ port: PORT, minions: configStore.getMinions().length }, "Minion Server started");
  await telegramBot.start().catch((e) => logger.error(e, "Telegram bot failed"));
  await slackBot.start().catch((e) => logger.error(e, "Slack bot failed"));
});
