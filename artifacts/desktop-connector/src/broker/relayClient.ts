/**
 * relayClient — Sprint 15
 *
 * Persistent outbound WebSocket relay client.
 * The broker connects to the NeedsOps platform relay endpoint and
 * receives task dispatches over the live socket.
 *
 * Architecture:
 *   - Device initiates connection (outbound) — no inbound firewall rules required
 *   - Authenticated by short-lived access token (15-minute TTL)
 *   - Reconnects with exponential backoff after disconnect
 *   - Refreshes access token proactively before expiry
 *   - Handles device_revoked by calling onRevoked() callback
 *   - Separate from task execution logic (callback injection)
 *
 * Backoff schedule: 1s, 2s, 4s, 8s, 16s, 32s (capped), with jitter
 */

import { EventEmitter } from "node:events";
import type { Logger } from "pino";
import { buildRelayMessage, parseRelayMessage, type RelayMessage } from "./relayProtocol.js";

// ws is a production dependency — import dynamically for testability
let WebSocketClass: typeof import("ws").default;

async function getWS() {
  if (!WebSocketClass) {
    const mod = await import("ws");
    WebSocketClass = mod.default;
  }
  return WebSocketClass;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RelayConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "revoked"
  | "shutdown";

export interface RelayClientConfig {
  apiBaseUrl: string;         // e.g. https://api.needsops.com
  deviceId: string;
  organizationId: string;
  appVersion: string;
  osPlatform: string;
  arch: string;
  /** Returns a valid access token; may call the refresh API internally */
  getAccessToken: () => Promise<string>;
  /** Called when a task_dispatch is received */
  onTaskDispatch: (payload: Record<string, unknown>) => Promise<void>;
  /** Called when the device is revoked — should shut down the app */
  onRevoked: () => void;
  /** Called on state changes — for status reporting to Electron main */
  onStateChange: (state: RelayConnectionState) => void;
  logger: Logger;
}

export interface TaskResultPayload {
  executionId: string;
  result?: unknown;
}

export interface TaskErrorPayload {
  executionId: string;
  errorCode: string;
  message: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000;   // 30 seconds
const AUTH_TIMEOUT_MS = 10_000;          // 10 seconds
const MAX_BACKOFF_MS = 32_000;           // 32 seconds max
const BASE_BACKOFF_MS = 1_000;           // 1 second initial
// Proactively refresh access token when <4 minutes remain of 15-minute TTL
const TOKEN_REFRESH_BEFORE_EXPIRY_MS = 4 * 60_000;

// ── RelayClient ───────────────────────────────────────────────────────────────

export class RelayClient extends EventEmitter {
  private config: RelayClientConfig;
  private ws: InstanceType<typeof import("ws").default> | null = null;
  private state: RelayConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(config: RelayClientConfig) {
    super();
    this.config = config;
  }

  /** Start the relay connection. Reconnects automatically on disconnect. */
  async start(): Promise<void> {
    if (this.destroyed) return;
    this.setState("connecting");
    await this.connect();
  }

  /** Gracefully disconnect and stop all timers. */
  destroy(): void {
    this.destroyed = true;
    this.setState("shutdown");
    this.clearTimers();
    if (this.ws) {
      try { this.ws.close(1001, "shutdown"); } catch { /**/ }
      this.ws = null;
    }
  }

  /** Send a task result back to the platform. */
  sendTaskResult(payload: TaskResultPayload): void {
    this.send(buildRelayMessage("task_result", this.config.deviceId, this.config.organizationId, payload as any));
  }

  /** Send a task error back to the platform. */
  sendTaskError(payload: TaskErrorPayload): void {
    this.send(buildRelayMessage("task_error", this.config.deviceId, this.config.organizationId, payload as any));
  }

  /** Send a task progress update. */
  sendTaskProgress(executionId: string, progress: Record<string, unknown>): void {
    this.send(buildRelayMessage("task_progress", this.config.deviceId, this.config.organizationId, {
      executionId,
      ...progress,
    }));
  }

  getState(): RelayConnectionState {
    return this.state;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.destroyed) return;

    const WS = await getWS();

    let accessToken: string;
    try {
      accessToken = await this.config.getAccessToken();
    } catch (err: any) {
      this.config.logger.error({ err: err.message }, "[relay-client] Failed to get access token — will retry");
      this.scheduleReconnect();
      return;
    }

    const wsUrl = this.buildWsUrl();
    this.config.logger.info({ url: wsUrl }, "[relay-client] Connecting");

    try {
      this.ws = new WS(wsUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        handshakeTimeout: AUTH_TIMEOUT_MS,
      });
    } catch (err: any) {
      this.config.logger.error({ err: err.message }, "[relay-client] Failed to create WebSocket");
      this.scheduleReconnect();
      return;
    }

    const ws = this.ws;

    ws.on("open", () => {
      this.setState("authenticating");
      this.sendAuth(accessToken);
    });

    ws.on("message", (raw: Buffer | string) => {
      const msg = parseRelayMessage(typeof raw === "string" ? raw : raw.toString());
      if (msg) this.handleMessage(msg).catch(() => {});
    });

    ws.on("close", (code: number, reason: Buffer) => {
      const reasonStr = reason.toString();
      this.config.logger.info({ code, reason: reasonStr }, "[relay-client] WebSocket closed");
      this.clearTimers();
      this.ws = null;
      if (this.state !== "shutdown" && this.state !== "revoked") {
        this.setState("reconnecting");
        this.scheduleReconnect();
      }
    });

    ws.on("error", (err: Error) => {
      this.config.logger.warn({ err: err.message }, "[relay-client] WebSocket error");
    });
  }

  private buildWsUrl(): string {
    const base = this.config.apiBaseUrl.replace(/^http/, "ws").replace(/\/$/, "");
    return `${base}/v1/devices/relay`;
  }

  private sendAuth(accessToken: string): void {
    this.send(buildRelayMessage("auth", this.config.deviceId, this.config.organizationId, {
      token: accessToken,
      appVersion: this.config.appVersion,
      osPlatform: this.config.osPlatform,
      arch: this.config.arch,
    }));
  }

  private async handleMessage(msg: RelayMessage): Promise<void> {
    switch (msg.type) {
      case "auth_ok":
        this.reconnectAttempts = 0;
        this.setState("connected");
        this.startHeartbeat();
        this.config.logger.info({ sessionId: msg.payload?.["sessionId"] }, "[relay-client] Authenticated");
        break;

      case "auth_error":
        this.config.logger.error({ payload: msg.payload }, "[relay-client] Auth rejected");
        this.ws?.close();
        this.scheduleReconnect();
        break;

      case "heartbeat_ack":
        // No action needed — confirms server is alive
        break;

      case "task_dispatch": {
        const payload = msg.payload as Record<string, unknown>;
        const { executionId } = payload;
        if (!executionId) break;

        // Acknowledge immediately
        this.send(buildRelayMessage("task_ack", this.config.deviceId, this.config.organizationId, {
          executionId,
        }));

        // Execute asynchronously
        this.config.onTaskDispatch(payload).catch((err: Error) => {
          this.sendTaskError({
            executionId: String(executionId),
            errorCode: "EXECUTION_FAILED",
            message: err.message,
          });
        });
        break;
      }

      case "device_revoked":
        this.config.logger.warn("[relay-client] Device revoked by platform");
        this.setState("revoked");
        this.destroy();
        this.config.onRevoked();
        break;

      case "reconnect_required":
        this.config.logger.info("[relay-client] Server requested reconnect");
        this.ws?.close();
        break;

      case "token_expiring":
        // Proactively refresh — getAccessToken() handles this
        this.scheduleTokenRefresh(0);
        break;

      case "shutdown":
        this.config.logger.info("[relay-client] Server shutdown received");
        this.ws?.close();
        break;

      default:
        break;
    }
  }

  private startHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.state === "connected") {
        this.send(buildRelayMessage("heartbeat", this.config.deviceId, this.config.organizationId, {
          uptime: process.uptime(),
        }));
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.state === "revoked" || this.reconnectTimer) return;

    const backoff = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, this.reconnectAttempts),
      MAX_BACKOFF_MS,
    );
    const jitter = Math.random() * 1000;
    const delay = backoff + jitter;

    this.reconnectAttempts++;
    this.config.logger.info(
      { attempt: this.reconnectAttempts, delayMs: Math.round(delay) },
      "[relay-client] Scheduling reconnect",
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.destroyed) {
        this.setState("connecting");
        this.connect().catch(() => this.scheduleReconnect());
      }
    }, delay);
  }

  private scheduleTokenRefresh(delayMs: number): void {
    if (this.tokenRefreshTimer) return;
    this.tokenRefreshTimer = setTimeout(async () => {
      this.tokenRefreshTimer = null;
      if (this.destroyed) return;
      try {
        // getAccessToken() internally handles refresh and stores the new token
        await this.config.getAccessToken();
        this.config.logger.info("[relay-client] Access token refreshed");
      } catch (err: any) {
        this.config.logger.warn({ err: err.message }, "[relay-client] Token refresh failed");
      }
    }, delayMs);
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = null;
    }
  }

  private setState(state: RelayConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.config.onStateChange(state);
    this.emit("stateChange", state);
  }

  private send(msg: RelayMessage): void {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}
