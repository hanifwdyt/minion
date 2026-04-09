export type RiskLevel = "safe" | "moderate" | "high";

export const TOOL_RISK: Record<string, RiskLevel> = {
  Read: "safe",
  Glob: "safe",
  Grep: "safe",
  LSP: "safe",
  WebSearch: "safe",
  WebFetch: "safe",
  Edit: "moderate",
  Write: "moderate",
  Bash: "high",
};

// Dangerous bash patterns that always require approval
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\b/,
  /\bgit\s+push\s+--force\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bdrop\s+database\b/i,
  /\bdrop\s+table\b/i,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\bcurl\b.*\|\s*sh\b/,
  /\bwget\b.*\|\s*sh\b/,
];

export function getToolRisk(toolName: string): RiskLevel {
  return TOOL_RISK[toolName] || "moderate";
}

export function isApprovalRequired(
  toolName: string,
  toolInput: any,
  approvalTools: string[] = []
): { required: boolean; reason?: string } {
  // Check if tool is in minion's approval list
  if (approvalTools.includes(toolName)) {
    return { required: true, reason: `${toolName} requires approval for this minion` };
  }

  // Check bash commands for dangerous patterns
  if (toolName === "Bash" && toolInput?.command) {
    const cmd = toolInput.command;
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        return { required: true, reason: `Dangerous command detected: ${cmd.slice(0, 80)}` };
      }
    }
  }

  // Check Write to sensitive paths
  if (toolName === "Write" && toolInput?.file_path) {
    const path = toolInput.file_path;
    if (path.includes(".env") || path.includes("credentials") || path.includes("/etc/")) {
      return { required: true, reason: `Writing to sensitive path: ${path}` };
    }
  }

  return { required: false };
}

// High risk prompt patterns
const HIGH_RISK_PROMPT_PATTERNS = [
  { pattern: /\b(deploy|deployment)\b/i, reason: "Deployment operation" },
  { pattern: /\b(production|prod)\s/i, reason: "Production environment targeted" },
  { pattern: /\bgit\s+push\s+--force\b/i, reason: "Force push" },
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: "Hard reset" },
  { pattern: /\brm\s+-rf?\b/i, reason: "Recursive deletion" },
  { pattern: /\bdrop\s+(database|table)\b/i, reason: "Database drop" },
  { pattern: /\bdelete\s+(branch|repo)\b/i, reason: "Destructive git operation" },
  { pattern: /\bmigrat(e|ion)\b.*\bprod/i, reason: "Production migration" },
];

const MODERATE_RISK_PROMPT_PATTERNS = [
  { pattern: /\bgit\s+push\b/i, reason: "Git push" },
  { pattern: /\bgit\s+merge\b/i, reason: "Git merge" },
  { pattern: /\bnpm\s+publish\b/i, reason: "Package publish" },
  { pattern: /\bstag(e|ing)\b/i, reason: "Staging environment" },
];

export function assessPromptRisk(
  prompt: string
): { riskLevel: "moderate" | "high"; reason: string } | null {
  for (const { pattern, reason } of HIGH_RISK_PROMPT_PATTERNS) {
    if (pattern.test(prompt)) return { riskLevel: "high", reason };
  }
  for (const { pattern, reason } of MODERATE_RISK_PROMPT_PATTERNS) {
    if (pattern.test(prompt)) return { riskLevel: "moderate", reason };
  }
  return null;
}
