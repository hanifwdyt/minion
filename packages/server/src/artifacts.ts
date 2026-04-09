import { logger } from "./logger.js";

export interface Artifact {
  id: string;
  minionId: string;
  type: "review" | "test_report" | "changelog" | "deploy_report" | "analysis" | "generic";
  title: string;
  content: string;
  metadata: Record<string, any>;
  timestamp: number;
}

// Section headers that indicate structured output
const SECTION_PATTERNS: { pattern: RegExp; type: Artifact["type"]; title: string }[] = [
  { pattern: /^##\s*Review\s*Summary/im, type: "review", title: "Code Review" },
  { pattern: /^##\s*Test\s*Report/im, type: "test_report", title: "Test Report" },
  { pattern: /^##\s*Changelog/im, type: "changelog", title: "Changelog" },
  { pattern: /^##\s*Deploy(ment)?\s*(Report|Summary)/im, type: "deploy_report", title: "Deployment Report" },
  { pattern: /^##\s*Analysis/im, type: "analysis", title: "Analysis Report" },
];

export class ArtifactExtractor {
  private artifacts: Artifact[] = [];
  private maxArtifacts = 200;

  /**
   * Extract artifacts from a minion's chat messages after task completion.
   * Pass in the assistant messages from the completed task.
   */
  extract(minionId: string, messages: { role: string; content: string }[]): Artifact[] {
    const extracted: Artifact[] = [];

    // Combine all assistant messages into one text
    const fullText = messages
      .filter(m => m.role === "assistant" && m.content)
      .map(m => m.content)
      .join("\n\n");

    if (!fullText.trim()) return extracted;

    for (const { pattern, type, title } of SECTION_PATTERNS) {
      const match = pattern.exec(fullText);
      if (!match) continue;

      // Extract the section content (from header to next ## or end)
      const startIdx = match.index;
      const afterHeader = fullText.slice(startIdx);
      const nextSectionMatch = afterHeader.slice(match[0].length).search(/^##\s/m);
      const endIdx = nextSectionMatch !== -1
        ? startIdx + match[0].length + nextSectionMatch
        : fullText.length;

      const sectionContent = fullText.slice(startIdx, endIdx).trim();

      if (sectionContent.length < 10) continue; // Skip nearly empty sections

      const artifact: Artifact = {
        id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        minionId,
        type,
        title,
        content: sectionContent,
        metadata: this.extractMetadata(type, sectionContent),
        timestamp: Date.now(),
      };

      extracted.push(artifact);
      this.addArtifact(artifact);
    }

    // If no known sections found but text is substantial, create a generic artifact
    if (extracted.length === 0 && fullText.length > 500) {
      // Don't create generic artifacts for every message — only if it looks like a report
      const hasStructure = (fullText.match(/^[-*]\s/gm) || []).length >= 3 ||
                           (fullText.match(/^\d+\.\s/gm) || []).length >= 3;
      if (hasStructure) {
        const artifact: Artifact = {
          id: `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          minionId,
          type: "generic",
          title: "Task Output",
          content: fullText.slice(0, 5000),
          metadata: {},
          timestamp: Date.now(),
        };
        extracted.push(artifact);
        this.addArtifact(artifact);
      }
    }

    if (extracted.length > 0) {
      logger.info({ minionId, count: extracted.length, types: extracted.map(a => a.type) }, "Artifacts extracted");
    }

    return extracted;
  }

  private extractMetadata(type: Artifact["type"], content: string): Record<string, any> {
    const meta: Record<string, any> = {};

    if (type === "review") {
      // Try to extract verdict
      const verdictMatch = content.match(/Verdict:\s*(approve|request[- ]changes|comment)/i);
      if (verdictMatch) meta.verdict = verdictMatch[1].toLowerCase();

      // Try to extract risk level
      const riskMatch = content.match(/Risk\s*level:\s*(low|medium|high)/i);
      if (riskMatch) meta.riskLevel = riskMatch[1].toLowerCase();

      // Count issues
      const issuesSection = content.match(/##\s*Issues Found\s*\n([\s\S]*?)(?=##|$)/i);
      if (issuesSection) {
        const issueCount = (issuesSection[1].match(/^\d+\./gm) || []).length;
        meta.issueCount = issueCount;
      }
    }

    if (type === "test_report") {
      const passMatch = content.match(/(\d+)\s*(tests?\s*)?pass/i);
      const failMatch = content.match(/(\d+)\s*(tests?\s*)?fail/i);
      if (passMatch) meta.passed = parseInt(passMatch[1]);
      if (failMatch) meta.failed = parseInt(failMatch[1]);
    }

    return meta;
  }

  private addArtifact(artifact: Artifact) {
    this.artifacts.push(artifact);
    if (this.artifacts.length > this.maxArtifacts) {
      this.artifacts.splice(0, this.artifacts.length - this.maxArtifacts);
    }
  }

  getArtifacts(minionId?: string, limit = 50): Artifact[] {
    let result = this.artifacts;
    if (minionId) result = result.filter(a => a.minionId === minionId);
    return result.slice(-limit);
  }

  getArtifact(id: string): Artifact | undefined {
    return this.artifacts.find(a => a.id === id);
  }
}
