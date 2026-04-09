import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, basename } from "path";
import { logger } from "./logger.js";

export interface ProjectContext {
  name: string;
  techStack: string[];
  framework?: string;
  language?: string;
  testRunner?: string;
  packageManager?: string;
  ciSystem?: string;
  branches: { current: string; default: string; recent: string[] };
  directoryStructure: string;
  recentCommits: string[];
  claudeMd?: string;
  readme?: string;
  scannedAt: number;
}

export class ProjectScanner {
  /**
   * Scan a project directory and return structured context.
   */
  scan(workdir: string): ProjectContext {
    const context: ProjectContext = {
      name: basename(workdir),
      techStack: [],
      branches: { current: "", default: "main", recent: [] },
      directoryStructure: "",
      recentCommits: [],
      scannedAt: Date.now(),
    };

    try {
      // Detect package.json
      const pkgPath = resolve(workdir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        context.name = pkg.name || context.name;

        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Detect framework
        if (allDeps["next"]) { context.framework = "Next.js"; context.techStack.push("Next.js"); }
        else if (allDeps["nuxt"]) { context.framework = "Nuxt"; context.techStack.push("Nuxt"); }
        else if (allDeps["react"]) { context.techStack.push("React"); }
        else if (allDeps["vue"]) { context.techStack.push("Vue"); }
        else if (allDeps["express"]) { context.techStack.push("Express"); }
        else if (allDeps["hono"]) { context.techStack.push("Hono"); }
        else if (allDeps["fastify"]) { context.techStack.push("Fastify"); }

        // Detect language
        if (allDeps["typescript"] || existsSync(resolve(workdir, "tsconfig.json"))) {
          context.language = "TypeScript";
          context.techStack.push("TypeScript");
        } else {
          context.language = "JavaScript";
        }

        // Detect test runner
        if (allDeps["vitest"]) context.testRunner = "Vitest";
        else if (allDeps["jest"]) context.testRunner = "Jest";
        else if (allDeps["mocha"]) context.testRunner = "Mocha";
        if (context.testRunner) context.techStack.push(context.testRunner);

        // Detect package manager
        if (existsSync(resolve(workdir, "pnpm-lock.yaml"))) context.packageManager = "pnpm";
        else if (existsSync(resolve(workdir, "yarn.lock"))) context.packageManager = "yarn";
        else if (existsSync(resolve(workdir, "bun.lockb"))) context.packageManager = "bun";
        else context.packageManager = "npm";

        // Detect monorepo
        if (pkg.workspaces || existsSync(resolve(workdir, "turbo.json")) || existsSync(resolve(workdir, "lerna.json"))) {
          context.techStack.push("Monorepo");
        }

        // Notable deps
        if (allDeps["prisma"] || allDeps["@prisma/client"]) context.techStack.push("Prisma");
        if (allDeps["drizzle-orm"]) context.techStack.push("Drizzle");
        if (allDeps["tailwindcss"]) context.techStack.push("Tailwind CSS");
        if (allDeps["three"]) context.techStack.push("Three.js");
        if (allDeps["socket.io"]) context.techStack.push("Socket.IO");
      }

      // Detect Python
      if (existsSync(resolve(workdir, "pyproject.toml")) || existsSync(resolve(workdir, "requirements.txt"))) {
        context.language = context.language || "Python";
        context.techStack.push("Python");
        if (existsSync(resolve(workdir, "pyproject.toml"))) {
          const pyproject = readFileSync(resolve(workdir, "pyproject.toml"), "utf-8");
          if (pyproject.includes("fastapi")) context.techStack.push("FastAPI");
          if (pyproject.includes("django")) context.techStack.push("Django");
          if (pyproject.includes("flask")) context.techStack.push("Flask");
        }
      }

      // Detect Go
      if (existsSync(resolve(workdir, "go.mod"))) {
        context.language = "Go";
        context.techStack.push("Go");
      }

      // Detect Rust
      if (existsSync(resolve(workdir, "Cargo.toml"))) {
        context.language = "Rust";
        context.techStack.push("Rust");
      }

      // Detect CI
      if (existsSync(resolve(workdir, ".github/workflows"))) context.ciSystem = "GitHub Actions";
      else if (existsSync(resolve(workdir, ".gitlab-ci.yml"))) context.ciSystem = "GitLab CI";
      else if (existsSync(resolve(workdir, "Jenkinsfile"))) context.ciSystem = "Jenkins";
      if (context.ciSystem) context.techStack.push(context.ciSystem);

      // Docker
      if (existsSync(resolve(workdir, "Dockerfile")) || existsSync(resolve(workdir, "docker-compose.yml"))) {
        context.techStack.push("Docker");
      }

      // Git info
      try {
        context.branches.current = execSync("git rev-parse --abbrev-ref HEAD", { cwd: workdir, stdio: "pipe" }).toString().trim();
        // Try to detect default branch
        try {
          const defaultBranch = execSync("git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/remotes/origin/main", { cwd: workdir, stdio: "pipe" }).toString().trim().replace("refs/remotes/origin/", "");
          context.branches.default = defaultBranch;
        } catch {}

        const branchList = execSync("git branch --sort=-committerdate --format='%(refname:short)' | head -10", { cwd: workdir, stdio: "pipe" }).toString().trim().split("\n").filter(Boolean);
        context.branches.recent = branchList;

        const log = execSync("git log --oneline -20 --format='%h %s (%an, %ar)'", { cwd: workdir, stdio: "pipe" }).toString().trim().split("\n").filter(Boolean);
        context.recentCommits = log;
      } catch {}

      // Directory structure (top 2 levels, exclude node_modules/.git etc)
      context.directoryStructure = this.scanDirectory(workdir, 2);

      // Read CLAUDE.md if exists
      const claudeMdPath = resolve(workdir, "CLAUDE.md");
      if (existsSync(claudeMdPath)) {
        context.claudeMd = readFileSync(claudeMdPath, "utf-8").slice(0, 3000);
      }

      // Read README snippet
      for (const name of ["README.md", "readme.md", "README"]) {
        const readmePath = resolve(workdir, name);
        if (existsSync(readmePath)) {
          context.readme = readFileSync(readmePath, "utf-8").slice(0, 1500);
          break;
        }
      }
    } catch (err: any) {
      logger.error({ workdir, error: err.message }, "Project scan failed");
    }

    return context;
  }

  /**
   * Convert ProjectContext to a markdown string suitable for shared-context.md
   */
  toMarkdown(ctx: ProjectContext): string {
    const lines: string[] = [
      `# Project: ${ctx.name}`,
      `_Auto-scanned at ${new Date(ctx.scannedAt).toISOString()}_`,
      "",
      "## Tech Stack",
      ctx.techStack.map(t => `- ${t}`).join("\n") || "- (unknown)",
      "",
    ];

    if (ctx.language) lines.push(`**Language:** ${ctx.language}`);
    if (ctx.framework) lines.push(`**Framework:** ${ctx.framework}`);
    if (ctx.packageManager) lines.push(`**Package Manager:** ${ctx.packageManager}`);
    if (ctx.testRunner) lines.push(`**Test Runner:** ${ctx.testRunner}`);
    if (ctx.ciSystem) lines.push(`**CI:** ${ctx.ciSystem}`);
    lines.push("");

    lines.push("## Git");
    lines.push(`- Current branch: \`${ctx.branches.current}\``);
    lines.push(`- Default branch: \`${ctx.branches.default}\``);
    if (ctx.branches.recent.length > 0) {
      lines.push(`- Recent branches: ${ctx.branches.recent.slice(0, 5).map(b => `\`${b}\``).join(", ")}`);
    }
    lines.push("");

    if (ctx.recentCommits.length > 0) {
      lines.push("## Recent Commits");
      lines.push(ctx.recentCommits.slice(0, 10).map(c => `- ${c}`).join("\n"));
      lines.push("");
    }

    if (ctx.directoryStructure) {
      lines.push("## Directory Structure");
      lines.push("```");
      lines.push(ctx.directoryStructure);
      lines.push("```");
      lines.push("");
    }

    if (ctx.claudeMd) {
      lines.push("## CLAUDE.md");
      lines.push(ctx.claudeMd);
      lines.push("");
    }

    return lines.join("\n");
  }

  private scanDirectory(dir: string, maxDepth: number, currentDepth = 0, prefix = ""): string {
    if (currentDepth >= maxDepth) return "";

    const IGNORE = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "build", ".cache", "coverage", "__pycache__", ".venv", "target"]);

    try {
      const entries = readdirSync(dir)
        .filter(e => !IGNORE.has(e) && !e.startsWith("."))
        .sort((a, b) => {
          const aIsDir = statSync(resolve(dir, a)).isDirectory();
          const bIsDir = statSync(resolve(dir, b)).isDirectory();
          if (aIsDir && !bIsDir) return -1;
          if (!aIsDir && bIsDir) return 1;
          return a.localeCompare(b);
        });

      const lines: string[] = [];
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const fullPath = resolve(dir, entry);
        const isDir = statSync(fullPath).isDirectory();
        const isLast = i === entries.length - 1;
        const connector = isLast ? "└── " : "├── ";
        const extension = isLast ? "    " : "│   ";

        lines.push(`${prefix}${connector}${entry}${isDir ? "/" : ""}`);

        if (isDir && currentDepth + 1 < maxDepth) {
          const sub = this.scanDirectory(fullPath, maxDepth, currentDepth + 1, prefix + extension);
          if (sub) lines.push(sub);
        }
      }
      return lines.join("\n");
    } catch {
      return "";
    }
  }
}
