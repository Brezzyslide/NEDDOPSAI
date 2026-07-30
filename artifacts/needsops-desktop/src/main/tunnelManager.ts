/**
 * tunnelManager — Sprint 15 (Production Transport)
 *
 * Manages the device's outbound WebSocket connection to the platform relay.
 * This replaces the inbound Cloudflare Tunnel model used in development.
 *
 * Production architecture (default):
 *   Desktop app → outbound WSS → NeedsOps API relay
 *   No inbound firewall rules, no port forwarding, no tunnel required.
 *
 * Development-only fallback (DESKTOP_TRANSPORT=cloudflare-dev):
 *   Cloudflare Quick Tunnel — dev machines only, never used in production.
 *   Production build rejects this mode.
 *
 * Transport selection:
 *   DESKTOP_TRANSPORT=websocket       → OutboundWebSocketTransport (default)
 *   DESKTOP_TRANSPORT=cloudflare-dev  → CloudflareTunnelAdapter (dev only)
 *   (unset)                           → OutboundWebSocketTransport
 */

import { spawn, ChildProcess } from "child_process";
import { app } from "electron";
import { getMainWindow } from "./index.js";

// ── Transport interface ───────────────────────────────────────────────────────

export interface ITransportAdapter {
  /** Returns a public URL for inbound connections (null for outbound-only transports) */
  start(localPort: number): Promise<string | null>;
  stop(): Promise<void>;
  getPublicUrl(): string | null;
  getTransportType(): string;
}

// ── Outbound WebSocket Transport (production) ─────────────────────────────────

/**
 * Production transport: no public URL needed.
 * The broker connects outbound to the platform relay via wss://.
 * The relay client (RelayClient) in desktop-connector handles the connection.
 */
export class OutboundWebSocketTransport implements ITransportAdapter {
  private started = false;

  async start(_localPort: number): Promise<null> {
    this.started = true;
    // No inbound server to start — connection is managed by the relay client
    // in the broker process (artifacts/desktop-connector/src/broker/relayClient.ts)
    return null;
  }

  async stop(): Promise<void> {
    this.started = false;
    // The broker process manages its own WS lifecycle; brokerManager stops it
  }

  getPublicUrl(): null {
    return null; // Outbound-only — no public URL registered
  }

  getTransportType(): string {
    return "outbound-wss";
  }
}

// ── Cloudflare Tunnel Adapter (development only) ──────────────────────────────

/**
 * Dev-only transport: spawns cloudflared to create an ephemeral tunnel.
 * Guarded by DESKTOP_TRANSPORT=cloudflare-dev env var.
 * Rejected in production builds.
 */
export class CloudflareTunnelAdapter implements ITransportAdapter {
  private tunnelUrl: string | null = null;
  private proc: ChildProcess | null = null;

  async start(localPort: number): Promise<string> {
    if (app.isPackaged) {
      throw new Error(
        "CloudflareTunnelAdapter is not permitted in production builds. " +
        "Use DESKTOP_TRANSPORT=websocket (the default).",
      );
    }

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

  getTransportType(): string {
    return "cloudflare-dev";
  }
}

// ── Transport factory ─────────────────────────────────────────────────────────

/**
 * Return the appropriate transport adapter.
 * Production defaults to OutboundWebSocketTransport.
 * DESKTOP_TRANSPORT=cloudflare-dev is only accepted in development.
 */
export function createTransport(): ITransportAdapter {
  const mode = process.env["DESKTOP_TRANSPORT"] ?? "websocket";

  if (mode === "cloudflare-dev") {
    if (app.isPackaged) {
      throw new Error(
        "DESKTOP_TRANSPORT=cloudflare-dev is not permitted in production. " +
        "Remove this environment variable or set DESKTOP_TRANSPORT=websocket.",
      );
    }
    console.log("[transport] Using Cloudflare dev tunnel (DESKTOP_TRANSPORT=cloudflare-dev)");
    return new CloudflareTunnelAdapter();
  }

  // Default: outbound WebSocket (production)
  if (mode !== "websocket") {
    console.warn(`[transport] Unknown DESKTOP_TRANSPORT="${mode}" — defaulting to outbound WebSocket`);
  }
  return new OutboundWebSocketTransport();
}

// ── Status broadcasting ───────────────────────────────────────────────────────

export type TransportStatus = "stopped" | "starting" | "connected" | "error";

let currentAdapter: ITransportAdapter | null = null;
let currentStatus: TransportStatus = "stopped";

export async function startTransport(localPort: number): Promise<string | null> {
  currentStatus = "starting";
  broadcastTransportStatus(null);

  try {
    currentAdapter = createTransport();
    const url = await currentAdapter.start(localPort);
    currentStatus = "connected";
    broadcastTransportStatus(url);
    return url;
  } catch (err: any) {
    console.error("[transport] Failed to start:", err.message);
    currentStatus = "error";
    broadcastTransportStatus(null);
    return null;
  }
}

export async function stopTransport(): Promise<void> {
  if (currentAdapter) {
    await currentAdapter.stop().catch(() => {});
    currentAdapter = null;
  }
  currentStatus = "stopped";
  broadcastTransportStatus(null);
}

export function getTransportStatus() {
  return {
    status: currentStatus,
    type: currentAdapter?.getTransportType() ?? null,
    url: currentAdapter?.getPublicUrl() ?? null,
  };
}

function broadcastTransportStatus(url: string | null) {
  getMainWindow()?.webContents.send("transport:status", {
    status: currentStatus,
    type: currentAdapter?.getTransportType() ?? null,
    url,
  });
}
