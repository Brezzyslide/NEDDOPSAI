/**
 * tunnelManager — Cloudflare Tunnel Manager
 * Sprint 14
 *
 * Manages an ephemeral Cloudflare Tunnel for development connectivity.
 * The tunnel allows the NeedsOps platform to push tasks to the device
 * when the device is behind NAT/firewall.
 *
 * In production: the broker maintains a persistent outbound WebSocket
 * to the platform — no tunnel needed.
 *
 * In development: cloudflared binary is used to create a temporary tunnel
 * and the resulting public URL is registered with the platform.
 */

import { spawn, ChildProcess } from "child_process";
import { getMainWindow } from "./index.js";

let tunnelProcess: ChildProcess | null = null;
let tunnelUrl: string | null = null;

export type TunnelStatus = "stopped" | "starting" | "running" | "error";
let tunnelStatus: TunnelStatus = "stopped";

// ── Transport interface ───────────────────────────────────────────────────────
// This interface is what the broker uses to report its URL.
// In dev: cloudflared tunnel; in production: outbound WebSocket (no tunnel needed).

export interface ITransportAdapter {
  start(localPort: number): Promise<string>;  // returns public URL
  stop(): Promise<void>;
  getPublicUrl(): string | null;
}

// ── Cloudflare dev tunnel ─────────────────────────────────────────────────────

export class CloudflareTunnelAdapter implements ITransportAdapter {
  private tunnelUrl: string | null = null;
  private proc: ChildProcess | null = null;

  async start(localPort: number): Promise<string> {
    return new Promise((resolve, reject) => {
      this.proc = spawn("cloudflared", [
        "tunnel", "--url", `http://localhost:${localPort}`,
        "--no-autoupdate",
      ], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      const urlPattern = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
      let resolved = false;

      const handleData = (data: Buffer) => {
        const text = data.toString();
        const match = urlPattern.exec(text);
        if (match && !resolved) {
          resolved = true;
          this.tunnelUrl = match[0];
          resolve(this.tunnelUrl);
        }
      };

      this.proc.stdout?.on("data", handleData);
      this.proc.stderr?.on("data", handleData);

      this.proc.on("error", (err) => {
        if (!resolved) reject(err);
      });

      this.proc.on("exit", (code) => {
        if (!resolved) reject(new Error(`cloudflared exited with code ${code}`));
        this.proc = null;
        this.tunnelUrl = null;
      });

      setTimeout(() => {
        if (!resolved) reject(new Error("Tunnel URL not received within 30s"));
      }, 30_000);
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    return new Promise((resolve) => {
      this.proc!.once("exit", () => resolve());
      this.proc!.kill("SIGTERM");
    });
  }

  getPublicUrl(): string | null {
    return this.tunnelUrl;
  }
}

// ── No-op adapter (production) ────────────────────────────────────────────────

export class OutboundWebSocketAdapter implements ITransportAdapter {
  async start(_localPort: number): Promise<string> {
    // Production: broker connects outbound — no public URL needed
    return "outbound-only";
  }

  async stop(): Promise<void> {}

  getPublicUrl(): string | null { return null; }
}

// ── Tunnel lifecycle helpers ──────────────────────────────────────────────────

export async function startDevTunnel(localPort: number): Promise<string | null> {
  tunnelStatus = "starting";
  broadcastTunnelStatus();
  try {
    const adapter = new CloudflareTunnelAdapter();
    tunnelUrl = await adapter.start(localPort);
    tunnelStatus = "running";
    broadcastTunnelStatus();
    return tunnelUrl;
  } catch (err) {
    tunnelStatus = "error";
    broadcastTunnelStatus();
    return null;
  }
}

export async function stopDevTunnel(): Promise<void> {
  if (tunnelProcess) {
    tunnelProcess.kill("SIGTERM");
    tunnelProcess = null;
  }
  tunnelStatus = "stopped";
  tunnelUrl = null;
  broadcastTunnelStatus();
}

export function getTunnelStatus() {
  return { status: tunnelStatus, url: tunnelUrl };
}

function broadcastTunnelStatus() {
  getMainWindow()?.webContents.send("tunnel:status", { status: tunnelStatus, url: tunnelUrl });
}
