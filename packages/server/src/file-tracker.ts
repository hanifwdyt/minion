import { EventEmitter } from "events";

interface FileChange {
  filePath: string;
  minionId: string;
  minionName: string;
  action: "read" | "edit" | "write" | "delete";
  timestamp: number;
}

export class FileTracker extends EventEmitter {
  // Map<filePath, FileChange[]>
  private changes: Map<string, FileChange[]> = new Map();
  // Track which minion is actively working on which files
  private activeFiles: Map<string, Set<string>> = new Map(); // minionId -> Set<filePath>

  trackToolUse(minionId: string, minionName: string, toolName: string, input: any) {
    let filePath: string | undefined;
    let action: FileChange["action"] | undefined;

    switch (toolName) {
      case "Read":
        filePath = input?.file_path;
        action = "read";
        break;
      case "Edit":
        filePath = input?.file_path;
        action = "edit";
        break;
      case "Write":
        filePath = input?.file_path;
        action = "write";
        break;
      case "Bash":
        // Try to detect file operations from bash commands
        const cmd = input?.command || "";
        if (cmd.match(/\brm\b/)) {
          const rmMatch = cmd.match(/rm\s+(?:-\w+\s+)*(.+)/);
          if (rmMatch) {
            filePath = rmMatch[1].trim().split(/\s+/)[0];
            action = "delete";
          }
        }
        break;
    }

    if (!filePath || !action) return;

    const change: FileChange = {
      filePath,
      minionId,
      minionName,
      action,
      timestamp: Date.now(),
    };

    // Store change
    const fileChanges = this.changes.get(filePath) || [];
    fileChanges.push(change);
    this.changes.set(filePath, fileChanges);

    // Track active files for this minion
    if (action !== "read") {
      const active = this.activeFiles.get(minionId) || new Set();
      active.add(filePath);
      this.activeFiles.set(minionId, active);
    }

    // Check for conflicts (another minion editing the same file)
    if (action === "edit" || action === "write") {
      const conflicts = this.checkConflicts(filePath, minionId);
      if (conflicts.length > 0) {
        this.emit("conflict", {
          filePath,
          minionId,
          minionName,
          conflictsWith: conflicts,
        });
      }
    }

    this.emit("change", change);
  }

  // Check if other minions have recently modified this file
  private checkConflicts(filePath: string, currentMinionId: string): string[] {
    const conflicts: string[] = [];
    for (const [otherId, files] of this.activeFiles) {
      if (otherId !== currentMinionId && files.has(filePath)) {
        conflicts.push(otherId);
      }
    }
    return conflicts;
  }

  // Clear active files when minion finishes
  clearMinion(minionId: string) {
    this.activeFiles.delete(minionId);
  }

  // Get all changes for a file
  getFileChanges(filePath: string): FileChange[] {
    return this.changes.get(filePath) || [];
  }

  // Get all files modified by a minion
  getMinionFiles(minionId: string): string[] {
    const files: Set<string> = new Set();
    for (const [filePath, changes] of this.changes) {
      if (changes.some((c) => c.minionId === minionId && c.action !== "read")) {
        files.add(filePath);
      }
    }
    return Array.from(files);
  }

  // Get summary of recent changes
  getRecentChanges(limit = 20): FileChange[] {
    const all: FileChange[] = [];
    for (const changes of this.changes.values()) {
      all.push(...changes.filter((c) => c.action !== "read"));
    }
    return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }
}
