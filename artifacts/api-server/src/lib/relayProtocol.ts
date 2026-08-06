/**
 * relayProtocol — Sprint 15
 *
 * Versioned protocol for the device ↔ platform WebSocket relay.
 * All messages use this envelope structure and are validated before processing.
 *
 * Protocol version: 1
 *
 * Message envelope:
 * {
 *   "protocolVersion": 1,
 *   "type": "heartbeat",
 *   "messageId": "msg_...",
 *   "deviceId": "dev_...",        // null for some server-originated messages
 *   "organizationId": "org_...",  // null before auth
 *   "timestamp": "2025-01-01T00:00:00.000Z",
 *   "payload": {}
 * }
 */

import { randomUUID } from "crypto";

// ── Message types ─────────────────────────────────────────────────────────────

export type RelayMessageType =
  | "auth"
  | "auth_ok"
  | "auth_error"
  | "heartbeat"
  | "heartbeat_ack"
  | "task_dispatch"
  | "task_ack"
  | "task_progress"
  | "task_result"
  | "task_error"
  | "config_update"
  | "reconnect_required"
  | "token_expiring"
  | "device_revoked"
  | "shutdown"
  // ── Sprint 29E: Connector evidence operation messages ──────────────────────
  // These are distinct from task_dispatch/task_result which serve work execution.
  // Evidence retrieval (read-only file operations) and specialist work execution
  // are separate concerns and must remain independent within the relay protocol.
  | "connector_op_request"  // server → connector: perform a file operation
  | "connector_op_result"   // connector → server: operation completed successfully
  | "connector_op_error";   // connector → server: operation failed with structured error

export interface RelayMessage {
  protocolVersion: 1;
  type: RelayMessageType;
  messageId: string;
  deviceId: string | null;
  organizationId: string | null;
  timestamp: string;
  payload: Record<string, unknown> | null;
}

// ── Builder ───────────────────────────────────────────────────────────────────

export function buildRelayMessage(
  type: RelayMessageType,
  deviceId: string | null,
  organizationId: string | null,
  payload: Record<string, unknown> | null = null,
): RelayMessage {
  return {
    protocolVersion: 1,
    type,
    messageId: `msg_${randomUUID()}`,
    deviceId,
    organizationId,
    timestamp: new Date().toISOString(),
    payload,
  };
}

// ── Parser and validator ──────────────────────────────────────────────────────

const VALID_TYPES = new Set<string>([
  "auth", "auth_ok", "auth_error",
  "heartbeat", "heartbeat_ack",
  "task_dispatch", "task_ack", "task_progress", "task_result", "task_error",
  "config_update", "reconnect_required", "token_expiring",
  "device_revoked", "shutdown",
  // Sprint 29E: connector evidence operation messages
  "connector_op_request", "connector_op_result", "connector_op_error",
]);

const MAX_MESSAGE_SIZE = 512 * 1024; // 512 KB

/**
 * Parse and validate a raw WebSocket message string.
 * Returns null if the message is invalid, oversized, or has wrong protocol version.
 * Does NOT throw — invalid messages are silently rejected.
 */
export function parseRelayMessage(raw: string): RelayMessage | null {
  if (raw.length > MAX_MESSAGE_SIZE) return null;

  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;

  const msg = obj as Record<string, unknown>;

  if (msg["protocolVersion"] !== 1) return null;
  if (typeof msg["type"] !== "string") return null;
  if (!VALID_TYPES.has(msg["type"])) return null;
  if (typeof msg["messageId"] !== "string") return null;
  if (typeof msg["timestamp"] !== "string") return null;

  // payload may be null or an object (never an array)
  if (msg["payload"] !== null && msg["payload"] !== undefined) {
    if (typeof msg["payload"] !== "object" || Array.isArray(msg["payload"])) return null;
  }

  return {
    protocolVersion: 1,
    type: msg["type"] as RelayMessageType,
    messageId: msg["messageId"] as string,
    deviceId: (typeof msg["deviceId"] === "string" ? msg["deviceId"] : null),
    organizationId: (typeof msg["organizationId"] === "string" ? msg["organizationId"] : null),
    timestamp: msg["timestamp"] as string,
    payload: (msg["payload"] as Record<string, unknown> | null) ?? null,
  };
}
