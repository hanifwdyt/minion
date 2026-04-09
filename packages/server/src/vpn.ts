import { exec } from "child_process";
import { promisify } from "util";
import { EventEmitter } from "events";
import { logger } from "./logger.js";

const execAsync = promisify(exec);

const GITLAB_HOST = "mygitlab-dev.ioh.co.id";
const CONNECT_TIMEOUT = 30_000; // 30s initial wait
const APPROVAL_TIMEOUT = 120_000; // 2min wait for Silverfort approval
const POLL_INTERVAL = 5_000; // 5s between connectivity checks

export class VPNManager extends EventEmitter {
  private connecting = false;
  private waitingApproval = false;

  async isConnected(): Promise<boolean> {
    try {
      // Check if tun interface exists
      const { stdout: tunCheck } = await execAsync("ip link show tun0 2>/dev/null || true");
      if (!tunCheck.includes("tun0")) return false;

      // Verify GitLab is reachable
      const { stdout } = await execAsync(
        `curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 5 https://${GITLAB_HOST}`,
        { timeout: 10_000 }
      );
      const code = parseInt(stdout.trim());
      return code === 200 || code === 302;
    } catch {
      return false;
    }
  }

  async connect(): Promise<boolean> {
    if (this.connecting) {
      logger.warn("[vpn] Already connecting, skipping");
      return false;
    }

    // Already connected?
    if (await this.isConnected()) {
      logger.info("[vpn] Already connected");
      return true;
    }

    this.connecting = true;
    logger.info("[vpn] Starting OpenConnect...");

    try {
      // Start openconnect via systemctl
      await execAsync("sudo systemctl start openconnect", { timeout: 15_000 });
    } catch (err: any) {
      logger.error({ error: err.message }, "[vpn] Failed to start openconnect");
      this.connecting = false;
      return false;
    }

    // Wait for connection (initial — before Silverfort)
    const initialConnected = await this.pollConnectivity(CONNECT_TIMEOUT);
    if (initialConnected) {
      logger.info("[vpn] Connected successfully");
      this.connecting = false;
      return true;
    }

    // Connection not established — likely waiting for Silverfort approval
    logger.info("[vpn] Waiting for Silverfort approval...");
    this.waitingApproval = true;
    this.emit("needs_approval", {
      message: "VPN butuh approval Silverfort. Approve di HP lo ya, terus bilang 'udah approve'.",
    });

    // Poll for up to 2 minutes waiting for user to approve
    const approvedConnected = await this.pollConnectivity(APPROVAL_TIMEOUT);
    this.waitingApproval = false;
    this.connecting = false;

    if (approvedConnected) {
      logger.info("[vpn] Connected after Silverfort approval");
      this.emit("connected");
      return true;
    }

    logger.warn("[vpn] Connection timeout — Silverfort not approved or VPN failed");
    this.emit("timeout");
    await this.disconnect();
    return false;
  }

  async disconnect(): Promise<void> {
    try {
      await execAsync("sudo systemctl stop openconnect", { timeout: 10_000 });
      logger.info("[vpn] Disconnected");
      this.emit("disconnected");
    } catch (err: any) {
      // Maybe already stopped
      logger.warn({ error: err.message }, "[vpn] Error stopping openconnect (may already be stopped)");
    }
    this.connecting = false;
    this.waitingApproval = false;
  }

  async verifyAfterApproval(): Promise<boolean> {
    logger.info("[vpn] Verifying connection after user approval...");
    const connected = await this.pollConnectivity(15_000);
    if (connected) {
      this.emit("connected");
    }
    return connected;
  }

  isWaitingApproval(): boolean {
    return this.waitingApproval;
  }

  /**
   * Wrap a function with VPN connect/disconnect.
   * Connects before, runs fn, disconnects after.
   */
  async withVPN<T>(fn: () => Promise<T>): Promise<T> {
    const wasConnected = await this.isConnected();
    if (!wasConnected) {
      const connected = await this.connect();
      if (!connected) {
        throw new Error("VPN connection failed");
      }
    }

    try {
      return await fn();
    } finally {
      // Only disconnect if we connected (don't disconnect if was already on)
      if (!wasConnected) {
        await this.disconnect();
      }
    }
  }

  private async pollConnectivity(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isConnected()) return true;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
    return false;
  }
}
