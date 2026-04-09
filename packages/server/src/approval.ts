import { Server, Socket } from "socket.io";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";
import { assessPromptRisk } from "./tool-safety.js";

export interface ApprovalRequest {
  id: string;
  minionId: string;
  prompt: string;
  riskLevel: "moderate" | "high";
  reason: string;
  timestamp: number;
  status: "pending" | "approved" | "denied" | "timeout";
}

export class ApprovalManager {
  private io: Server;
  private pending: Map<
    string,
    { request: ApprovalRequest; resolve: (approved: boolean) => void }
  > = new Map();
  private timeoutMs: number;

  constructor(io: Server, timeoutMs = 5 * 60 * 1000) {
    this.io = io;
    this.timeoutMs = timeoutMs;
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on("connection", (socket: Socket) => {
      // Send all pending approvals to newly connected client
      const pendingRequests = this.getPendingRequests();
      if (pendingRequests.length > 0) {
        socket.emit("approval:pending", pendingRequests);
      }

      // Listen for approval responses
      socket.on(
        "approval:respond",
        (data: { id: string; approved: boolean }) => {
          const entry = this.pending.get(data.id);
          if (!entry) {
            logger.warn(`Approval response for unknown request: ${data.id}`);
            return;
          }

          entry.request.status = data.approved ? "approved" : "denied";
          logger.info(
            `Approval ${data.approved ? "granted" : "denied"} for minion ${entry.request.minionId}: ${entry.request.reason}`
          );

          entry.resolve(data.approved);
          this.pending.delete(data.id);

          // Broadcast updated status to all clients
          this.io.emit("approval:resolved", {
            id: data.id,
            status: entry.request.status,
          });
        }
      );
    });
  }

  async requestApproval(
    minionId: string,
    prompt: string,
    riskLevel: "moderate" | "high",
    reason: string
  ): Promise<boolean> {
    const request: ApprovalRequest = {
      id: randomUUID(),
      minionId,
      prompt,
      riskLevel,
      reason,
      timestamp: Date.now(),
      status: "pending",
    };

    logger.info(
      `Approval requested for minion ${minionId} [${riskLevel}]: ${reason}`
    );

    return new Promise<boolean>((resolve) => {
      this.pending.set(request.id, { request, resolve });

      // Emit to all connected clients
      this.io.emit("approval:request", request);

      // Auto-deny after timeout
      setTimeout(() => {
        const entry = this.pending.get(request.id);
        if (entry && entry.request.status === "pending") {
          entry.request.status = "timeout";
          logger.warn(
            `Approval timed out for minion ${minionId}: ${reason}`
          );

          entry.resolve(false);
          this.pending.delete(request.id);

          this.io.emit("approval:resolved", {
            id: request.id,
            status: "timeout",
          });
        }
      }, this.timeoutMs);
    });
  }

  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.pending.values())
      .filter((e) => e.request.status === "pending")
      .map((e) => e.request);
  }
}
