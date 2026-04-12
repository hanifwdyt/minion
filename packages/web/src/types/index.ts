export interface MinionOutfit {
  shirtColor: string;
  pantsColor: string;
  skinColor: string;
  hatStyle: "none" | "cap" | "beanie" | "headphones";
  hatColor: string;
  shoeColor: string;
}

export interface MinionConfig {
  id: string;
  name: string;
  role: string;
  color: string;
  outfit: MinionOutfit;
  workdir: string;
}

export interface MinionState extends MinionConfig {
  status: "idle" | "working" | "error";
}

export interface ChatMessage {
  id: string;
  minionId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  toolName?: string;
  imageUrl?: string;
}
