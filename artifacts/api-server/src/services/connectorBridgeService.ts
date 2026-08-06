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

export type ConnectorOperationType = "locate" | "search" | "read" | "inspect";

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

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
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

      if (attempt < maxRetries) {
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
      executionId: operation.executionId,
      operationType: operation.operationType,
      query: operation.query,
      path: operation.path,
      resourceId: operation.resourceId,
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
