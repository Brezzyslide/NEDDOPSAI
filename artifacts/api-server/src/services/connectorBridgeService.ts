/**
 * connectorBridgeService — Sprint 29E (NeedsOps Connector P6 Foundation)
 *
 * Bridge between the API Server and the NeedsOps Connector (desktop runtime).
 *
 * Architecture rule (non-negotiable):
 *   The Unified Execution Engine must never communicate directly with the
 *   desktop runtime. All connector operations route through this bridge.
 *   OpenClaw remains an internal runtime only — this bridge speaks the relay
 *   protocol, not OpenClaw's internal API.
 *
 * Responsibilities:
 *   - Operation dispatch via the relay WebSocket
 *   - Per-operation timeout enforcement
 *   - Retry with backoff (configurable)
 *   - Cancellation via AbortSignal
 *   - Structured error wrapping
 *   - Correlation ID tracking (requestId)
 *   - Session ownership (session must be open before dispatch is allowed)
 */

import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { logger } from "../lib/logger.js";
import {
  opEvents,
  sendConnectorOpRequest,
  getConnectedDevicesForOrg,
} from "./deviceRelayService.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type ConnectorOperationType =
  // ── Evidence retrieval (read-only) — Sprint 29E ───────────────────────────
  | "locate"
  | "search"
  | "read"
  | "inspect"
  // ── Execution writes — Sprint 29F ─────────────────────────────────────────
  // Files domain
  | "write"          // files.write — overwrite or append to an existing file
  | "create"         // files.create — create a new file
  | "move"           // files.move — move or rename a file
  // Word domain (Microsoft Word / compatible)
  | "word_create"    // word.create — create a new Word document
  | "word_edit"      // word.edit — edit content in an existing Word document
  | "word_export"    // word.export — save/export a Word document to a target path
  // Excel domain
  | "excel_update"   // excel.update — update cell values in an Excel workbook
  // Email domain (Outlook only; send_email is NOT in scope — non-goal)
  | "email_draft";   // email.draft — create a draft in Outlook Drafts folder

/**
 * Sprint 29F.1 Part 1 — Write operation types.
 * Used to enforce the no-blind-retry policy: write ops must never be
 * automatically replayed with a new request ID.
 */
export const WRITE_OPERATION_TYPES = new Set<ConnectorOperationType>([
  "write",
  "create",
  "move",
  "word_create",
  "word_edit",
  "word_export",
  "excel_update",
  "email_draft",
]);

export interface ConnectorOpRequest {
  /** Engine-assigned correlation ID. Every request gets a unique requestId. */
  requestId: string;
  /** Execution ID this operation belongs to — for session ownership checks */
  executionId: string;
  /** Operation type — maps to IFileConnector methods on the desktop side */
  operationType: ConnectorOperationType;
  /** Free-text query for search operations */
  query?: string;
  /** Provider-specific path hint (optional) */
  path?: string;
  /** Resource identifier returned by a prior locate or search operation */
  resourceId?: string;
  /**
   * Sprint 29F: operation-specific parameters for write operations.
   * Passed verbatim to the connector via relay payload.
   * Examples: { content, encoding } for write; { to, subject, body } for email_draft.
   */
  parameters?: Record<string, unknown>;
  /**
   * Sprint 29F.1 Part 1 — Write idempotency key.
   * Required for all write operations. Format: `{executionId}:{actionId}`.
   * The desktop connector uses this to deduplicate re-delivered write requests.
   * If a write is received with a key already in the dedup store, the stored
   * result is returned without re-executing the write.
   *
   * Read-only operations may omit this field.
   */
  idempotencyKey?: string;
}

export interface ConnectorOpResult {
  requestId: string;
  success: boolean;
  data?: unknown;
  errorCode?: string;
  errorMessage?: string;
  /** Actual wall-clock latency in milliseconds */
  latencyMs: number;
}

export interface ConnectorBridgeOptions {
  /** Total time to wait for a connector response (default: 30 000 ms) */
  timeoutMs?: number;
  /** Maximum retry attempts on transient failure (default: 1) */
  maxRetries?: number;
  /** Abort signal — allows callers to cancel in-flight operations */
  signal?: AbortSignal;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export class ConnectorOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ConnectorOperationError";
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 500;

// ─── Core dispatch ────────────────────────────────────────────────────────────

/**
 * Submit a single connector operation and await its result.
 *
 * The caller is responsible for ensuring a connector session is open for the
 * given executionId before calling this function. The bridge enforces that a
 * device is reachable but does not manage session lifecycle itself.
 */
export async function submitConnectorOperation(
  deviceId: string,
  organisationId: string,
  operation: ConnectorOpRequest,
  opts: ConnectorBridgeOptions = {},
): Promise<ConnectorOpResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const signal = opts.signal;

  if (signal?.aborted) {
    throw new ConnectorOperationError(
      "CANCELLED",
      "Operation cancelled before dispatch",
      operation.requestId,
    );
  }

  // Sprint 29F.1 Part 1 — Enforce no-blind-retry for write operations.
  // Write ops are non-idempotent unless the same idempotencyKey is used.
  // Automatic retry with a NEW requestId on write ops would produce duplicates
  // (e.g. two files created) when the first attempt succeeded but the ack was lost.
  // Retry is handled externally through the idempotent replay path instead.
  const isWrite = WRITE_OPERATION_TYPES.has(operation.operationType);
  const effectiveMaxRetries = isWrite ? 0 : maxRetries;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
    if (attempt > 0) {
      await delay(RETRY_BACKOFF_MS * attempt);
    }

    try {
      return await dispatchOnce(deviceId, organisationId, operation, timeoutMs, signal);
    } catch (err) {
      lastError = err as Error;

      if (err instanceof ConnectorOperationError) {
        // Non-retryable error codes
        if (["CANCELLED", "DEVICE_NOT_CONNECTED", "TIMEOUT"].includes(err.code)) {
          throw err;
        }
      }

      if (attempt < effectiveMaxRetries) {
        logger.warn(
          { requestId: operation.requestId, attempt, err: lastError.message },
          "[connector-bridge] Operation failed — will retry",
        );
      }
    }
  }

  throw lastError ?? new ConnectorOperationError(
    "UNKNOWN_ERROR",
    "Connector operation failed after retries",
    operation.requestId,
  );
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function dispatchOnce(
  deviceId: string,
  organisationId: string,
  operation: ConnectorOpRequest,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ConnectorOpResult> {
  return new Promise<ConnectorOpResult>((resolve, reject) => {
    const startMs = Date.now();
    const { requestId } = operation;

    // Check signal before setting up listeners
    if (signal?.aborted) {
      reject(new ConnectorOperationError("CANCELLED", "Operation cancelled", requestId));
      return;
    }

    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      opEvents.off(`op:result:${requestId}`, onResult);
      opEvents.off(`op:error:${requestId}`, onError);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    const onResult = (payload: Record<string, unknown>) => {
      settle(() => {
        const latencyMs = Date.now() - startMs;
        resolve({
          requestId,
          success: true,
          data: payload["data"],
          latencyMs,
        });
      });
    };

    const onError = (payload: Record<string, unknown>) => {
      settle(() => {
        const latencyMs = Date.now() - startMs;
        resolve({
          requestId,
          success: false,
          errorCode: String(payload["errorCode"] ?? "OPERATION_ERROR"),
          errorMessage: String(payload["errorMessage"] ?? "Connector operation failed"),
          latencyMs,
        });
      });
    };

    const onAbort = () => {
      settle(() => {
        reject(new ConnectorOperationError("CANCELLED", "Operation cancelled via signal", requestId));
      });
    };

    // Register listeners before dispatch to avoid race conditions
    opEvents.once(`op:result:${requestId}`, onResult);
    opEvents.once(`op:error:${requestId}`, onError);

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      settle(() => {
        reject(new ConnectorOperationError(
          "TIMEOUT",
          `Connector operation timed out after ${timeoutMs}ms`,
          requestId,
        ));
      });
    }, timeoutMs);

    // Dispatch to connected device
    const dispatched = sendConnectorOpRequest(deviceId, organisationId, {
      requestId,
      executionId:   operation.executionId,
      operationType: operation.operationType,
      query:         operation.query,
      path:          operation.path,
      resourceId:    operation.resourceId,
      // Sprint 29F: write-operation parameters (content, destination, etc.)
      ...(operation.parameters ? { parameters: operation.parameters } : {}),
      // Sprint 29F.1 Part 1: idempotency key for desktop-side dedup
      ...(operation.idempotencyKey ? { idempotencyKey: operation.idempotencyKey } : {}),
    });

    if (!dispatched) {
      settle(() => {
        reject(new ConnectorOperationError(
          "DEVICE_NOT_CONNECTED",
          `Device ${deviceId} is not connected to the relay`,
          requestId,
        ));
      });
    }
  });
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Convenience: resolve evidence operations ─────────────────────────────────

/**
 * Locate a resource on the connector by name or path hint.
 * Returns the connector's resource identifier on success.
 */
export async function connectorLocate(
  deviceId: string,
  organisationId: string,
  executionId: string,
  nameOrPath: string,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "locate",
    path: nameOrPath,
  }, opts);
}

/**
 * Search the connector's accessible file system for resources matching the query.
 */
export async function connectorSearch(
  deviceId: string,
  organisationId: string,
  executionId: string,
  query: string,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "search",
    query,
  }, opts);
}

/**
 * Read the full content of a resource by its connector resource ID.
 */
export async function connectorRead(
  deviceId: string,
  organisationId: string,
  executionId: string,
  resourceId: string,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "read",
    resourceId,
  }, opts);
}

/**
 * Inspect the metadata of a resource without reading its full content.
 */
export async function connectorInspect(
  deviceId: string,
  organisationId: string,
  executionId: string,
  resourceId: string,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "inspect",
    resourceId,
  }, opts);
}

// ─── Convenience: write operations (Sprint 29F) ───────────────────────────────
// These are the execution write operations for the NeedsOps Connector P6.
// Each maps to an ExecutionAction domain/type and is dispatched via the relay.
//
// ARCHITECTURE RULE: write operations must never be mixed with evidence retrieval
// operations within the same request chain. The ExecutionActionDispatcher uses
// these functions; the ConnectorEvidenceResolver does not.

/**
 * Write content to an existing file on the connector filesystem (files.write).
 */
export async function connectorWrite(
  deviceId: string,
  organisationId: string,
  executionId: string,
  path: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "write",
    path,
    parameters,
  }, opts);
}

/**
 * Create a new file on the connector filesystem (files.create).
 */
export async function connectorCreate(
  deviceId: string,
  organisationId: string,
  executionId: string,
  path: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "create",
    path,
    parameters,
  }, opts);
}

/**
 * Move or rename a file on the connector filesystem (files.move).
 */
export async function connectorMove(
  deviceId: string,
  organisationId: string,
  executionId: string,
  path: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "move",
    path,
    parameters,
  }, opts);
}

/**
 * Create a new Word document on the connector (word.create).
 */
export async function connectorWordCreate(
  deviceId: string,
  organisationId: string,
  executionId: string,
  path: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "word_create",
    path,
    parameters,
  }, opts);
}

/**
 * Edit content in an existing Word document on the connector (word.edit).
 */
export async function connectorWordEdit(
  deviceId: string,
  organisationId: string,
  executionId: string,
  path: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "word_edit",
    path,
    parameters,
  }, opts);
}

/**
 * Export a Word document to a specified target path (word.export).
 */
export async function connectorWordExport(
  deviceId: string,
  organisationId: string,
  executionId: string,
  path: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "word_export",
    path,
    parameters,
  }, opts);
}

/**
 * Update cell values in an Excel workbook on the connector (excel.update).
 */
export async function connectorExcelUpdate(
  deviceId: string,
  organisationId: string,
  executionId: string,
  path: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "excel_update",
    path,
    parameters,
  }, opts);
}

/**
 * Create a draft email in Outlook Drafts on the connector (email.draft).
 *
 * Note: email.send is NOT implemented — sending is a non-goal for Sprint 29F.
 * This function creates a draft only; it does NOT send the email.
 */
export async function connectorEmailDraft(
  deviceId: string,
  organisationId: string,
  executionId: string,
  parameters?: Record<string, unknown>,
  opts?: ConnectorBridgeOptions,
): Promise<ConnectorOpResult> {
  return submitConnectorOperation(deviceId, organisationId, {
    requestId: `opreq_${randomUUID()}`,
    executionId,
    operationType: "email_draft",
    path: "outlook://drafts",
    parameters,
  }, opts);
}
