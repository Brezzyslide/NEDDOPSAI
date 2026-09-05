/**
 * deviceRelayService — Sprint 15
 *
 * Manages in-memory WebSocket relay connections from devices to the platform.
 * Each connected device maintains a persistent outbound WSS connection here.
 *
 * Responsibilities:
 *   - Authenticate incoming WS connections (short-lived access token)
 *   - Associate sockets with device IDs
 *   - Dispatch tasks to connected devices
 *   - Handle heartbeats, task acks, results, and errors
 *   - Detect duplicate connections (closes older connection)
 *   - Write WS session records to DB
 *   - Handle graceful and error-induced disconnects
 *   - Notify relayed task callers of completion via EventEmitter
 *
 * Architecture:
 *   - Pure in-memory router (no WS logic bleeds into transport or task services)
 *   - DB writes are async / fire-and-forget for non-critical paths
 *   - Task dispatch uses device_task_dispatch table for durability
 */

import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type { WebSocket, WebSocketServer } from "ws";
import {
  db,
  devicesTable,
  deviceWsSessionsTable,
  deviceTaskDispatchTable,
  withSystemTenantContext,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { validateAccessToken } from "./deviceAuthService.js";
import { logger } from "../lib/logger.js";
import {
  parseRelayMessage,
  buildRelayMessage,
  type RelayMessage,
  type RelayMessageType,
} from "../lib/relayProtocol.js";

type DbClient = typeof db;

function withDeviceRelayTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "device_relay_service", purpose },
    fn,
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConnectedDevice {
  ws: WebSocket;
  deviceId: string;
  organizationId: string;
  sessionId: string;
  connectedAt: Date;
  lastSeenAt: Date;
  appVersion?: string;
  osPlatform?: string;
  arch?: string;
}

// ── State ─────────────────────────────────────────────────────────────────────

/** deviceId → active connection */
const connections = new Map<string, ConnectedDevice>();

/** EventEmitter for task completion notifications */
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(500);

/**
 * Sprint 29E: EventEmitter for connector evidence operation results.
 * Distinct from taskEvents — evidence retrieval and work execution are
 * separate concerns and must not share the same event space.
 *
 * Events emitted:
 *   op:result:{requestId}  — connector_op_result received from device
 *   op:error:{requestId}   — connector_op_error received from device
 */
export const opEvents = new EventEmitter();
opEvents.setMaxListeners(1000);

// ── Relay service ─────────────────────────────────────────────────────────────

/**
 * Attach the relay service to a WebSocket server instance.
 * Call once at startup after creating the WSS.
 */
export function attachRelayService(wss: WebSocketServer): void {
  wss.on("connection", (ws, req) => {
    handleConnection(ws, req).catch((err) => {
      logger.error({ err: err.message }, "[relay] Unhandled connection error");
      ws.terminate();
    });
  });

  logger.info("[relay] Device relay service attached to WebSocket server");
}

// ── Connection handler ────────────────────────────────────────────────────────

async function handleConnection(ws: WebSocket, req: any): Promise<void> {
  // Devices must send an `auth` message within 10 seconds or be disconnected
  let authenticated = false;
  let device: ConnectedDevice | null = null;

  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      sendMessage(ws, buildRelayMessage("auth_error", null, null, {
        code: "AUTH_TIMEOUT",
        message: "Authentication not received within 10 seconds",
      }));
      ws.terminate();
    }
  }, 10_000);

  ws.on("message", async (raw) => {
    const msg = parseRelayMessage(raw.toString());
    if (!msg) {
      sendMessage(ws, buildRelayMessage("auth_error", null, null, {
        code: "INVALID_MESSAGE",
        message: "Invalid message format",
      }));
      return;
    }

    if (!authenticated) {
      if (msg.type !== "auth") {
        sendMessage(ws, buildRelayMessage("auth_error", null, null, {
          code: "AUTH_REQUIRED",
          message: "First message must be auth",
        }));
        ws.terminate();
        return;
      }
      await handleAuth(ws, msg, authTimeout).then((result) => {
        if (result) {
          authenticated = true;
          device = result;
        }
      });
      return;
    }

    if (!device) return;
    await handleMessage(device, msg);
  });

  ws.on("close", (code, reason) => {
    clearTimeout(authTimeout);
    if (device) {
      handleDisconnect(device, "clean");
    }
  });

  ws.on("error", (err) => {
    logger.warn({ err: err.message }, "[relay] WebSocket error");
    if (device) {
      handleDisconnect(device, "error");
    }
  });
}

async function handleAuth(
  ws: WebSocket,
  msg: RelayMessage,
  authTimeout: ReturnType<typeof setTimeout>,
): Promise<ConnectedDevice | null> {
  const { token, appVersion, osPlatform, arch } = (msg.payload ?? {}) as {
    token?: string;
    appVersion?: string;
    osPlatform?: string;
    arch?: string;
  };

  if (!token) {
    sendMessage(ws, buildRelayMessage("auth_error", null, null, {
      code: "MISSING_TOKEN",
      message: "auth.payload.token is required",
    }));
    ws.terminate();
    return null;
  }

  const result = await validateAccessToken(token);
  if (!result) {
    sendMessage(ws, buildRelayMessage("auth_error", null, null, {
      code: "INVALID_TOKEN",
      message: "Access token is invalid, expired, or revoked",
    }));
    ws.terminate();
    return null;
  }

  clearTimeout(authTimeout);

  const { device: deviceRow } = result;

  // Task #34: reject platform-disabled devices at the relay gate (defence-in-depth;
  // validateAccessToken already returns null for disabled devices, but guard here too)
  if ((deviceRow as any).isPlatformDisabled) {
    sendMessage(ws, buildRelayMessage("auth_error", deviceRow.id, deviceRow.organizationId, {
      code: "DEVICE_PLATFORM_DISABLED",
      message: "This device has been temporarily disabled by a platform administrator.",
    }));
    ws.terminate();
    return null;
  }

  // Close duplicate connection if one exists
  const existing = connections.get(deviceRow.id);
  if (existing) {
    logger.info({ deviceId: deviceRow.id }, "[relay] Closing duplicate connection");
    sendMessage(existing.ws, buildRelayMessage("reconnect_required", deviceRow.id, deviceRow.organizationId, {
      reason: "duplicate_connection",
    }));
    existing.ws.terminate();
    await markSessionDisconnected(existing.sessionId, "duplicate", existing.organizationId);
    connections.delete(deviceRow.id);
  }

  // Create WS session record
  const sessionId = `wss_${randomUUID()}`;
  const connectedAt = new Date();

  await withDeviceRelayTenant(deviceRow.organizationId, "device_relay.connect", async (client) => {
  await client.insert(deviceWsSessionsTable).values({
    id: sessionId,
    deviceId: deviceRow.id,
    organizationId: deviceRow.organizationId,
    transportType: "outbound-wss",
    connectedAt,
    appVersion: appVersion ?? null,
    osPlatform: osPlatform ?? null,
    arch: arch ?? null,
  }).catch((err) => {
    logger.warn({ err: err.message }, "[relay] Failed to write WS session record");
  });

  // Mark device as connected
  await client
    .update(devicesTable)
    .set({ status: "connected", lastHeartbeatAt: connectedAt, updatedAt: connectedAt })
    .where(eq(devicesTable.id, deviceRow.id))
    .catch(() => {});
  });

  const connectedDevice: ConnectedDevice = {
    ws,
    deviceId: deviceRow.id,
    organizationId: deviceRow.organizationId,
    sessionId,
    connectedAt,
    lastSeenAt: connectedAt,
    appVersion,
    osPlatform,
    arch,
  };

  connections.set(deviceRow.id, connectedDevice);

  sendMessage(ws, buildRelayMessage("auth_ok", deviceRow.id, deviceRow.organizationId, {
    sessionId,
    configVersion: 1,
    serverTime: new Date().toISOString(),
  }));

  logger.info({ deviceId: deviceRow.id, sessionId }, "[relay] Device authenticated and connected");
  return connectedDevice;
}

async function handleMessage(device: ConnectedDevice, msg: RelayMessage): Promise<void> {
  device.lastSeenAt = new Date();

  switch (msg.type as RelayMessageType) {
    case "heartbeat":
      await handleHeartbeat(device, msg);
      break;
    case "task_ack":
      await handleTaskAck(device, msg);
      break;
    case "task_progress":
      await handleTaskProgress(device, msg);
      break;
    case "task_result":
      await handleTaskResult(device, msg);
      break;
    case "task_error":
      await handleTaskError(device, msg);
      break;
    // ── Sprint 29E: Connector evidence operation responses ─────────────────
    // These are distinct from task_* messages — evidence retrieval and work
    // execution are separate concerns and must not share the same event space.
    case "connector_op_result": {
      const payload = (msg.payload ?? {}) as Record<string, unknown>;
      const requestId = payload["requestId"];
      if (typeof requestId === "string") {
        opEvents.emit(`op:result:${requestId}`, payload);
      }
      break;
    }
    case "connector_op_error": {
      const payload = (msg.payload ?? {}) as Record<string, unknown>;
      const requestId = payload["requestId"];
      if (typeof requestId === "string") {
        opEvents.emit(`op:error:${requestId}`, payload);
      }
      break;
    }
    default:
      logger.debug({ type: msg.type, deviceId: device.deviceId }, "[relay] Unknown message type");
  }
}

async function handleHeartbeat(device: ConnectedDevice, msg: RelayMessage): Promise<void> {
  // Update device last_seen in DB (debounced — only write if >10s since last update)
  await withDeviceRelayTenant(device.organizationId, "device_relay.heartbeat", async (client) => {
  await client
    .update(devicesTable)
    .set({ lastHeartbeatAt: device.lastSeenAt, updatedAt: device.lastSeenAt })
    .where(eq(devicesTable.id, device.deviceId))
    .catch(() => {});

  await client
    .update(deviceWsSessionsTable)
    .set({ lastSeenAt: device.lastSeenAt })
    .where(eq(deviceWsSessionsTable.id, device.sessionId))
    .catch(() => {});
  });

  sendMessage(device.ws, buildRelayMessage("heartbeat_ack", device.deviceId, device.organizationId, {
    serverTime: new Date().toISOString(),
  }));
}

async function handleTaskAck(device: ConnectedDevice, msg: RelayMessage): Promise<void> {
  const { executionId } = (msg.payload ?? {}) as { executionId?: string };
  if (!executionId) return;

  await withDeviceRelayTenant(device.organizationId, "device_relay.task_ack", (client) => client
    .update(deviceTaskDispatchTable)
    .set({ status: "acknowledged", acknowledgedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(deviceTaskDispatchTable.executionId, executionId),
        eq(deviceTaskDispatchTable.deviceId, device.deviceId),
      ),
    )
    .catch(() => {}));

  taskEvents.emit(`task:ack:${executionId}`, { executionId });
}

async function handleTaskProgress(device: ConnectedDevice, msg: RelayMessage): Promise<void> {
  const { executionId, progress } = (msg.payload ?? {}) as {
    executionId?: string;
    progress?: unknown;
  };
  if (!executionId) return;

  await withDeviceRelayTenant(device.organizationId, "device_relay.task_progress", (client) => client
    .update(deviceTaskDispatchTable)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(deviceTaskDispatchTable.executionId, executionId),
        eq(deviceTaskDispatchTable.deviceId, device.deviceId),
      ),
    )
    .catch(() => {}));

  taskEvents.emit(`task:progress:${executionId}`, { executionId, progress });
}

async function handleTaskResult(device: ConnectedDevice, msg: RelayMessage): Promise<void> {
  const { executionId, result } = (msg.payload ?? {}) as {
    executionId?: string;
    result?: unknown;
  };
  if (!executionId) return;

  const now = new Date();
  await withDeviceRelayTenant(device.organizationId, "device_relay.task_result", (client) => client
    .update(deviceTaskDispatchTable)
    .set({ status: "completed", completedAt: now, updatedAt: now })
    .where(
      and(
        eq(deviceTaskDispatchTable.executionId, executionId),
        eq(deviceTaskDispatchTable.deviceId, device.deviceId),
      ),
    )
    .catch(() => {}));

  taskEvents.emit(`task:result:${executionId}`, { executionId, result });
}

async function handleTaskError(device: ConnectedDevice, msg: RelayMessage): Promise<void> {
  const { executionId, errorCode, message } = (msg.payload ?? {}) as {
    executionId?: string;
    errorCode?: string;
    message?: string;
  };
  if (!executionId) return;

  const now = new Date();
  await withDeviceRelayTenant(device.organizationId, "device_relay.task_error", (client) => client
    .update(deviceTaskDispatchTable)
    .set({
      status: "failed",
      failedAt: now,
      updatedAt: now,
      errorCode: errorCode ?? "EXECUTION_ERROR",
      lastError: (message ?? "Unknown error").slice(0, 2048),
    })
    .where(
      and(
        eq(deviceTaskDispatchTable.executionId, executionId),
        eq(deviceTaskDispatchTable.deviceId, device.deviceId),
      ),
    )
    .catch(() => {}));

  taskEvents.emit(`task:error:${executionId}`, { executionId, errorCode, message });
}

function handleDisconnect(device: ConnectedDevice, reason: string): void {
  connections.delete(device.deviceId);

  markSessionDisconnected(device.sessionId, reason, device.organizationId).catch(() => {});

  // Mark device as disconnected in DB
  withDeviceRelayTenant(device.organizationId, "device_relay.disconnect", async (client) => {
    await client.update(devicesTable)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(devicesTable.id, device.deviceId))
      .catch(() => {});

    // Re-queue any unacked sent tasks back to pending
    await client.update(deviceTaskDispatchTable)
      .set({ status: "pending", updatedAt: new Date() })
      .where(
        and(
          eq(deviceTaskDispatchTable.deviceId, device.deviceId),
          eq(deviceTaskDispatchTable.status, "sent"),
        ),
      )
      .catch(() => {});
  }).catch(() => {});

  logger.info({ deviceId: device.deviceId, reason }, "[relay] Device disconnected");
}

async function markSessionDisconnected(sessionId: string, reason: string, organizationId: string): Promise<void> {
  await withDeviceRelayTenant(organizationId, "device_relay.session_disconnect", (client) => client
    .update(deviceWsSessionsTable)
    .set({ disconnectedAt: new Date(), disconnectReason: reason })
    .where(eq(deviceWsSessionsTable.id, sessionId))
    .catch(() => {}));
}

// ── Task dispatch ─────────────────────────────────────────────────────────────

export interface DispatchTaskParams {
  deviceId: string;
  organizationId: string;
  taskId?: string;
  payload: Record<string, unknown>;
}

export interface DispatchTaskResult {
  executionId: string;
  dispatched: boolean; // false if device not connected (queued for retry)
}

/**
 * Dispatch a task to a connected device.
 * Creates a device_task_dispatch record for durability.
 * If the device is not connected, the task remains 'pending' for retry.
 */
export async function dispatchTask(params: DispatchTaskParams): Promise<DispatchTaskResult> {
  const executionId = `exec_${randomUUID()}`;
  const dispatchId = `dtd_${randomUUID()}`;

  await withDeviceRelayTenant(params.organizationId, "device_relay.dispatch", async (client) => {
  await client.insert(deviceTaskDispatchTable).values({
    id: dispatchId,
    deviceId: params.deviceId,
    organizationId: params.organizationId,
    taskId: params.taskId ?? null,
    executionId,
    payloadJson: JSON.stringify(params.payload),
    status: "pending",
  });

  const conn = connections.get(params.deviceId);
  if (!conn) {
    return { executionId, dispatched: false };
  }

  const msg = buildRelayMessage("task_dispatch", params.deviceId, params.organizationId, {
    executionId,
    taskId: params.taskId,
    payload: params.payload,
  });

  sendMessage(conn.ws, msg);

  await client
    .update(deviceTaskDispatchTable)
    .set({
      status: "sent",
      sentAt: new Date(),
      deliveryAttempts: 1,
      updatedAt: new Date(),
    })
    .where(eq(deviceTaskDispatchTable.id, dispatchId))
    .catch(() => {});

  return { executionId, dispatched: true };
  });
}

/**
 * Send a device_revoked notification to a connected device and close the WS.
 * Called when the portal revokes the device.
 */
export async function notifyDeviceRevoked(deviceId: string): Promise<void> {
  const conn = connections.get(deviceId);
  if (!conn) return;

  sendMessage(conn.ws, buildRelayMessage("device_revoked", deviceId, conn.organizationId, {
    reason: "revoked_by_admin",
  }));

  // Give the client 1 second to process the message before terminating
  setTimeout(() => {
    conn.ws.terminate();
  }, 1000);

  connections.delete(deviceId);
  await markSessionDisconnected(conn.sessionId, "revoked", conn.organizationId).catch(() => {});
}

/**
 * Return a list of currently-connected device IDs (for health/status endpoints).
 */
export function getConnectedDevices(): string[] {
  return Array.from(connections.keys());
}

/**
 * Sprint 29E: Return device IDs of devices currently connected for a specific org.
 * Used by ConnectorSessionManager to find the target device for a connector session.
 */
export function getConnectedDevicesForOrg(organisationId: string): string[] {
  const result: string[] = [];
  for (const [deviceId, device] of connections.entries()) {
    if (device.organizationId === organisationId) {
      result.push(deviceId);
    }
  }
  return result;
}

/**
 * Sprint 29E: Send a connector_op_request to a connected device.
 *
 * Returns true if the message was dispatched. Returns false if the device is
 * not currently connected — the ConnectorBridge should surface a structured error.
 *
 * This function sends to the relay only. Session management, timeout, and
 * retry are handled by ConnectorBridgeService.
 */
export function sendConnectorOpRequest(
  deviceId: string,
  organizationId: string,
  payload: Record<string, unknown>,
): boolean {
  const conn = connections.get(deviceId);
  if (!conn) return false;
  sendMessage(
    conn.ws,
    buildRelayMessage("connector_op_request", deviceId, organizationId, payload),
  );
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendMessage(ws: WebSocket, msg: RelayMessage): void {
  if (ws.readyState === 1 /* OPEN */) {
    ws.send(JSON.stringify(msg));
  }
}
