import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { resolve } from "path";
import { logger } from "./logger.js";

export class WorkdirManager {
  private workspacesDir: string;
  private activeWorktrees: Map<string, { path: string; branch: string; minionId: string }> = new Map();

  constructor(baseDir: string) {
    this.workspacesDir = resolve(baseDir, "../.minion-workspaces");
    if (!existsSync(this.workspacesDir)) {
      mkdirSync(this.workspacesDir, { recursive: true });
    }
  }

  /**
   * Get or create an isolated workdir for a minion on a specific branch.
   * Returns baseDir if no branch specified (no isolation needed).
   */
  prepareWorkdir(minionId: string, repoPath: string, branch?: string): string {
    if (!branch) return repoPath;

    const worktreeId = `${minionId}-${sanitize(branch)}`;

    // Reuse existing worktree
    const existing = this.activeWorktrees.get(worktreeId);
    if (existing && existsSync(existing.path)) {
      try {
        execSync(`git checkout ${branch}`, { cwd: existing.path, stdio: "pipe" });
        execSync(`git pull --ff-only 2>/dev/null || true`, { cwd: existing.path, stdio: "pipe" });
      } catch {}
      return existing.path;
    }

    const worktreePath = resolve(this.workspacesDir, worktreeId);

    try {
      execSync(`git fetch origin ${branch} 2>/dev/null || true`, { cwd: repoPath, stdio: "pipe" });

      // Clean stale worktree
      if (existsSync(worktreePath)) {
        try {
          execSync(`git worktree remove --force "${worktreePath}"`, { cwd: repoPath, stdio: "pipe" });
        } catch {
          rmSync(worktreePath, { recursive: true, force: true });
        }
      }

      execSync(`git worktree add "${worktreePath}" ${branch}`, { cwd: repoPath, stdio: "pipe" });

      this.activeWorktrees.set(worktreeId, { path: worktreePath, branch, minionId });
      logger.info({ minionId, branch, path: worktreePath }, "Worktree created");

      return worktreePath;
    } catch (err: any) {
      logger.error({ minionId, branch, error: err.message }, "Failed to create worktree");
      return repoPath;
    }
  }

  cleanupWorkdir(minionId: string, repoPath: string, branch?: string): void {
    if (!branch) return;

    const worktreeId = `${minionId}-${sanitize(branch)}`;
    const entry = this.activeWorktrees.get(worktreeId);
    if (!entry) return;

    try {
      execSync(`git worktree remove --force "${entry.path}"`, { cwd: repoPath, stdio: "pipe" });
      this.activeWorktrees.delete(worktreeId);
      logger.info({ minionId, branch }, "Worktree cleaned up");
    } catch (err: any) {
      logger.warn({ minionId, branch, error: err.message }, "Failed to cleanup worktree");
    }
  }

  getActiveWorktrees() {
    return Array.from(this.activeWorktrees.entries()).map(([id, info]) => ({ id, ...info }));
  }

  prune(repoPath: string): void {
    try {
      execSync("git worktree prune", { cwd: repoPath, stdio: "pipe" });
      logger.info("Pruned stale worktrees");
    } catch {}
  }
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
}
