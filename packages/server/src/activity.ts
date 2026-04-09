import { EventEmitter } from "events";

export interface ActivityEvent {
  id: string;
  minionId: string;
  minionName: string;
  type: "prompt" | "response" | "tool" | "status" | "error" | "pipeline" | "delegate";
  summary: string;
  timestamp: number;
}

export class ActivityLog extends EventEmitter {
  private events: ActivityEvent[] = [];
  private maxEvents = 200;

  add(event: Omit<ActivityEvent, "id" | "timestamp">) {
    const entry: ActivityEvent = {
      ...event,
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    this.events.push(entry);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    this.emit("activity", entry);
    return entry;
  }

  getRecent(limit = 50): ActivityEvent[] {
    return this.events.slice(-limit);
  }
}
