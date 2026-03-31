export interface MinionConfig {
  id: string;
  name: string;
  role: string;
  color: string;
  position: [number, number, number];
  workdir: string;
}

export interface MinionState extends MinionConfig {
  status: "idle" | "working" | "error";
}

export interface ClaudeOutput {
  minionId: string;
  type: "text" | "tool" | "error" | "system";
  data: string;
}
