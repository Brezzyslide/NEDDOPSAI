/**
 * executionActionDispatcherService — Sprint 29F (Connector Execution Actions)
 *
 * Dispatches approved ExecutionActions to the NeedsOps Connector for execution.
 *
 * Non-negotiable architecture rules:
 *   1. Only "approved" ExecutionActions may enter this service (Deliverable C).
 *   2. The dispatcher never decides approval — it only enforces the status field.
 *   3. The NeedsOps Connector exclusively owns every external side effect.
 *   4. Evidence retrieval (connector_op_request read ops) and execution dispatch
 *      (write ops) must never share session scope or event names.
 *   5. OpenClaw is an internal runtime only — never appear in outputs.
 *   6. Actions execute sequentially; a fatal connector failure stops remaining
 *      actions and marks them cancelled (Deliverable A).
 *
 * Deliverables implemented:
 *   A — ExecutionActionDispatcher (dispatchExecutionActions)
 *   B — Connector write operations via bridge (word/excel/email/files)
 *   C — Approval enforcement (pre-dispatch status check)
 *   D — ExecutionAction lifecycle states (executing → completed/failed/cancelled)
 *   E — Connector result contract (ConnectorExecutionResult)
 *   G — Audit events per action (dispatched / completed / failed / cancelled)
 */

import { randomUUID } from "crypto";
import type { ExecutionAction } from "../types/canonicalExecutionContext.js";
import type { ConnectorOperationType } from "./connectorBridgeService.js";
import {
  submitConnectorOperation,
  ConnectorOperationError,
} from "./connectorBridgeService.js";
import {
  openConnectorSession,
  closeConnectorSession,
  recordConnectorOperation,
  getConnectorSessionTelemetry,
} from "./connectorSessionManagerService.js";
import { logOrgEvent } from "./auditService.js";
import { logger } from "../lib/logger.js";

// ─── Public types ──────────────────────────────────────────────────────────────

/**
 * Context supplied by the caller (engine or approval service) for a dispatch run.
 */
export interface DispatchContext {
  executionId: string;
  organisationId: string;
  /** User ID who requested the execution — written to audit events */
  requesterId: string;
  requesterRole: string;
  specialistCode: string;
  /** Per-action timeout for connector write operations (default: 60 000 ms) */
  actionTimeoutMs?: number;
}

/**
 * Structured result for a single connector execution action — Deliverable E.
 *
 * Contract requirements:
 *   - actionId      : matches the ExecutionAction.actionId
 *   - executionId   : matches DispatchContext.executionId
 *   - sessionId     : assigned by ConnectorSessionManager for this execution
 *   - operation     : the ConnectorOperationType submitted to the bridge
 *   - target        : human-readable resolved destination shown to the user
 *   - status        : "completed" | "failed" | "cancelled"
 *   - startedAt     : ISO timestamp at action dispatch start
 *   - completedAt   : ISO timestamp at action resolution
 *   - duration      : wall-clock milliseconds from startedAt to completedAt
 *   - connectorVersion : NeedsOps Connector app version (from device telemetry)
 *   - error         : present only when status is "failed" or "cancelled"
 */
export interface ConnectorExecutionResult {
  actionId: string;
  executionId: string;
  sessionId: string;
  operation: string;
  target: string;
  status: "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt: string;
  duration: number;
  connectorVersion: string | null;
  error?: { code: string; message: string };
}

/**
 * Summary of a full dispatch run — returned by dispatchExecutionActions.
 */
export interface DispatchResult {
  executionId: string;
  sessionId: string;
  results: ConnectorExecutionResult[];
  summary: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    totalDurationMs: number;
    stoppedOnFatalFailure: boolean;
    fatalFailureActionId: string | null;
  };
}

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown when any action has status !== "approved" at dispatch time.
 *
 * The dispatcher enforces the contract that the approval layer must transition
 * actions to "approved" before they may reach the connector. The dispatcher
 * itself never makes approval decisions.
 */
export class ApprovalRequiredError extends Error {
  constructor(
    public readonly actionId: string,
    public readonly actionType: string,
    public readonly currentStatus: string,
  ) {
    super(
      `Execution action ${actionId} (${actionType}) cannot be dispatched: ` +
      `status is "${currentStatus}" but "approved" is required. ` +
      "The approval layer must transition actions to approved before dispatch.",
    );
    this.name = "ApprovalRequiredError";
  }
}

// ─── In-memory dispatch store (for Execution Inspector — Deliverable F) ────────

/**
 * Per-execution dispatch record.
 * Persisted in-memory so the Execution Inspector can show action lifecycle state
 * without requiring a DB query.
 */
export interface DispatchRecord {
  executionId: string;
  /** Actions registered by the engine after specialist output (status="proposed") */
  proposedActions: ExecutionAction[];
  /** Actions passed to dispatchExecutionActions (status="approved") */
  approvedActions: ExecutionAction[];
  /** Ordered connector results — one per dispatched action */
  results: ConnectorExecutionResult[];
  /** actionIds in the order they were dispatched */
  executionOrder: string[];
  startedAt: string | null;
  completedAt: string | null;
  fatalFailure: boolean;
  fatalFailureActionId: string | null;
}

const dispatchStore = new Map<string, DispatchRecord>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register proposed ExecutionActions for an execution.
 *
 * Called by the Unified Execution Engine after specialist output is parsed and
 * validated. Enables the Execution Inspector (Deliverable F) to show proposed
 * actions even when dispatch has not yet occurred.
 *
 * Idempotent — re-registering replaces the proposedActions list but preserves
 * any existing approvedActions and results.
 */
export function registerProposedActions(
  executionId: string,
  actions: ExecutionAction[],
): void {
  const existing = dispatchStore.get(executionId);
  if (existing) {
    existing.proposedActions = [...actions];
  } else {
    dispatchStore.set(executionId, {
      executionId,
      proposedActions: [...actions],
      approvedActions: [],
      results: [],
      executionOrder: [],
      startedAt: null,
      completedAt: null,
      fatalFailure: false,
      fatalFailureActionId: null,
    });
  }
}

/**
 * Dispatch approved ExecutionActions to the NeedsOps Connector — Deliverable A.
 *
 * Enforcement contract (Deliverable C):
 *   ALL actions must have status === "approved". If any action has a different
 *   status, ApprovalRequiredError is thrown BEFORE any connector communication.
 *   The dispatcher never reads approval logic, evaluates risk, or inspects
 *   resolvedDestination.approvalRequired — those decisions belong to the
 *   approval layer (Governance Centre).
 *
 * Execution contract (Deliverable A):
 *   Actions are executed SEQUENTIALLY in array order.
 *   A fatal connector failure (DEVICE_NOT_CONNECTED, TIMEOUT, CANCELLED)
 *   stops dispatch immediately. Remaining actions are marked "cancelled"
 *   and included in the result (Scenario 5).
 *   Non-fatal individual action failures are recorded but do NOT stop remaining.
 *
 * @throws ApprovalRequiredError — if any action.status !== "approved"
 * @throws ConnectorCapabilityError — if no connector session can be opened
 */
export async function dispatchExecutionActions(
  actions: ExecutionAction[],
  context: DispatchContext,
): Promise<DispatchResult> {
  const { executionId, organisationId, requesterId, specialistCode } = context;
  const actionTimeoutMs = context.actionTimeoutMs ?? 60_000;

  // ── Deliverable C: Approval enforcement ──────────────────────────────────────
  // Pre-check ALL actions before opening a session. No connector communication
  // occurs until every action has been verified as approved.
  for (const action of actions) {
    if (action.status !== "approved") {
      throw new ApprovalRequiredError(action.actionId, action.actionType, action.status);
    }
  }

  // ── Handle empty action list gracefully ──────────────────────────────────────
  if (actions.length === 0) {
    return {
      executionId,
      sessionId: "",
      results: [],
      summary: {
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        totalDurationMs: 0,
        stoppedOnFatalFailure: false,
        fatalFailureActionId: null,
      },
    };
  }

  // ── Open connector session ────────────────────────────────────────────────────
  // Idempotent — reuses existing session for this executionId if already open.
  const { deviceId, sessionId } = await openConnectorSession(executionId, organisationId);

  // ── Best-effort connector version from telemetry ─────────────────────────────
  const telem = getConnectorSessionTelemetry(executionId);
  const connectorVersion = telem?.connectorVersion ?? null;

  // ── Initialise / update dispatch record for inspector ────────────────────────
  const startedAt = new Date().toISOString();
  const existing = dispatchStore.get(executionId);
  const record: DispatchRecord = existing ?? {
    executionId,
    proposedActions: [],
    approvedActions: [],
    results: [],
    executionOrder: [],
    startedAt: null,
    completedAt: null,
    fatalFailure: false,
    fatalFailureActionId: null,
  };
  record.approvedActions = [...actions];
  record.startedAt = startedAt;
  dispatchStore.set(executionId, record);

  // ── Sequential dispatch loop (Deliverable A) ──────────────────────────────────
  const results: ConnectorExecutionResult[] = [];
  let fatalFailure = false;
  let fatalFailureActionId: string | null = null;

  for (const action of actions) {
    // ── Cancelled tail (Scenario 5) ─────────────────────────────────────────
    if (fatalFailure) {
      const cancelledResult: ConnectorExecutionResult = {
        actionId:         action.actionId,
        executionId,
        sessionId,
        operation:        resolveOperationName(action),
        target:           action.resolvedDestination?.displayPath ?? action.description,
        status:           "cancelled",
        startedAt:        new Date().toISOString(),
        completedAt:      new Date().toISOString(),
        duration:         0,
        connectorVersion,
        error: {
          code:    "EXECUTION_CANCELLED",
          message: "Remaining actions were cancelled after a fatal connector failure.",
        },
      };
      results.push(cancelledResult);
      record.results.push(cancelledResult);
      record.executionOrder.push(action.actionId);
      fireAudit(organisationId, "execution_action.cancelled", requesterId, action, cancelledResult, specialistCode, deviceId).catch(() => {});
      continue;
    }

    // ── Audit: dispatching ────────────────────────────────────────────────────
    fireAudit(organisationId, "execution_action.dispatched", requesterId, action, null, specialistCode, deviceId).catch(() => {});

    const actionStartedAt = new Date().toISOString();
    const startMs = Date.now();

    // ── Resolve connector operation type (Deliverable B) ─────────────────────
    const opType = resolveOperationType(action);
    if (opType === null) {
      // Action type is not supported in Sprint 29F (browser/terminal/calendar/send_email)
      const duration = Date.now() - startMs;
      const unsupportedResult: ConnectorExecutionResult = {
        actionId:         action.actionId,
        executionId,
        sessionId,
        operation:        `${action.domain}.${action.actionType}`,
        target:           action.resolvedDestination?.displayPath ?? action.description,
        status:           "failed",
        startedAt:        actionStartedAt,
        completedAt:      new Date().toISOString(),
        duration,
        connectorVersion,
        error: {
          code:    "UNSUPPORTED_OPERATION",
          message: `Action "${action.actionType}" in domain "${action.domain}" is not ` +
                   "supported by the connector in this version. " +
                   "Supported: files.write/create/move, word.create/edit/export, " +
                   "excel.update, email.draft.",
        },
      };
      results.push(unsupportedResult);
      record.results.push(unsupportedResult);
      record.executionOrder.push(action.actionId);
      fireAudit(organisationId, "execution_action.failed", requesterId, action, unsupportedResult, specialistCode, deviceId).catch(() => {});
      continue;
    }

    // ── Submit to connector bridge ────────────────────────────────────────────
    let connectorResult: ConnectorExecutionResult;

    try {
      const opResult = await submitConnectorOperation(
        deviceId,
        organisationId,
        {
          requestId:     `opreq_${randomUUID()}`,
          executionId,
          operationType: opType,
          path:          String(action.parameters?.path ?? action.resolvedDestination?.displayPath ?? ""),
          parameters:    action.parameters,
        },
        { timeoutMs: actionTimeoutMs },
      );

      const duration = Date.now() - startMs;
      const succeeded = opResult.success;

      connectorResult = {
        actionId:         action.actionId,
        executionId,
        sessionId,
        operation:        opType,
        target:           action.resolvedDestination?.displayPath ?? action.description,
        status:           succeeded ? "completed" : "failed",
        startedAt:        actionStartedAt,
        completedAt:      new Date().toISOString(),
        duration,
        connectorVersion,
        ...(succeeded ? {} : {
          error: {
            code:    opResult.errorCode ?? "CONNECTOR_ERROR",
            message: opResult.errorMessage ?? "Connector operation failed",
          },
        }),
      };

      // Record in session telemetry
      recordConnectorOperation(executionId, {
        requestId:     `opreq_${action.actionId}`,
        operationType: opType,
        success:       succeeded,
        latencyMs:     duration,
        recordedAt:    new Date().toISOString(),
      });

      const auditEvent = succeeded ? "execution_action.completed" : "execution_action.failed";
      fireAudit(organisationId, auditEvent, requesterId, action, connectorResult, specialistCode, deviceId).catch(() => {});

    } catch (err) {
      const duration = Date.now() - startMs;
      const errCode = err instanceof ConnectorOperationError ? err.code : "DISPATCH_ERROR";
      const errMsg  = err instanceof Error ? err.message : String(err);

      // Fatal codes stop all remaining actions (Scenario 5)
      const isFatal = err instanceof ConnectorOperationError &&
        ["DEVICE_NOT_CONNECTED", "TIMEOUT", "CANCELLED"].includes(err.code);

      connectorResult = {
        actionId:         action.actionId,
        executionId,
        sessionId,
        operation:        opType,
        target:           action.resolvedDestination?.displayPath ?? action.description,
        status:           "failed",
        startedAt:        actionStartedAt,
        completedAt:      new Date().toISOString(),
        duration,
        connectorVersion,
        error: { code: errCode, message: errMsg },
      };

      // Record in session telemetry
      recordConnectorOperation(executionId, {
        requestId:     `opreq_${action.actionId}`,
        operationType: opType,
        success:       false,
        latencyMs:     duration,
        recordedAt:    new Date().toISOString(),
      });

      fireAudit(organisationId, "execution_action.failed", requesterId, action, connectorResult, specialistCode, deviceId).catch(() => {});

      if (isFatal) {
        fatalFailure = true;
        fatalFailureActionId = action.actionId;
        logger.warn(
          { executionId, actionId: action.actionId, code: errCode },
          "[action-dispatcher] Fatal connector failure — remaining actions will be cancelled",
        );
      }
    }

    results.push(connectorResult);
    record.results.push(connectorResult);
    record.executionOrder.push(action.actionId);
  }

  // ── Close connector session ───────────────────────────────────────────────────
  const closeReason = fatalFailure ? "fatal_connector_failure" : "execution_complete";
  closeConnectorSession(executionId, closeReason);

  // ── Finalise dispatch record ──────────────────────────────────────────────────
  const completedAt = new Date().toISOString();
  record.completedAt = completedAt;
  record.fatalFailure = fatalFailure;
  record.fatalFailureActionId = fatalFailureActionId;

  const completed     = results.filter(r => r.status === "completed").length;
  const failed        = results.filter(r => r.status === "failed").length;
  const cancelled     = results.filter(r => r.status === "cancelled").length;
  const totalDurationMs = results.reduce((sum, r) => sum + r.duration, 0);

  logger.info(
    { executionId, sessionId, total: results.length, completed, failed, cancelled },
    "[action-dispatcher] Dispatch complete",
  );

  return {
    executionId,
    sessionId,
    results,
    summary: {
      total:                 results.length,
      completed,
      failed,
      cancelled,
      totalDurationMs,
      stoppedOnFatalFailure: fatalFailure,
      fatalFailureActionId,
    },
  };
}

/**
 * Retrieve the dispatch record for an execution — used by the Execution Inspector.
 * Returns null when no actions have been registered or dispatched for this executionId.
 */
export function getDispatchRecord(executionId: string): DispatchRecord | null {
  return dispatchStore.get(executionId) ?? null;
}

/**
 * Reset the in-memory dispatch store.
 * FOR TEST USE ONLY — must not be called from production code.
 */
export function _resetDispatcherStore(): void {
  dispatchStore.clear();
}

// ─── Internal: Operation type resolution (Deliverable B) ──────────────────────

/**
 * Maps an ExecutionAction to its ConnectorOperationType for dispatch.
 *
 * Supported (Sprint 29F):
 *   files domain : write, create, move
 *   word domain  : word_create, word_edit, word_export
 *   excel domain : excel_update
 *   email domain : email_draft (draft only — send_email is a non-goal)
 *
 * Returns null for unsupported types (browser, terminal, calendar, send_email).
 * Callers receive a "failed" result with UNSUPPORTED_OPERATION for null returns.
 */
function resolveOperationType(action: ExecutionAction): ConnectorOperationType | null {
  const { domain, actionType } = action;

  if (domain === "word") {
    if (actionType === "create_file") return "word_create";
    if (actionType === "move_file")   return "word_export";
    // write_file, update_file, or any other word action → word_edit
    return "word_edit";
  }

  if (domain === "excel") return "excel_update";

  if (domain === "email") {
    // send_email is explicitly NOT in scope (non-goal per brief)
    if (actionType === "draft_email") return "email_draft";
    return null;
  }

  if (domain === "files") {
    if (actionType === "create_file") return "create";
    if (actionType === "move_file")   return "move";
    // write_file, update_file → write
    if (actionType === "write_file" || actionType === "update_file") return "write";
    return null;
  }

  // browser, terminal, calendar — not in scope for Sprint 29F
  return null;
}

/** Human-readable operation name for unsupported actions */
function resolveOperationName(action: ExecutionAction): string {
  return resolveOperationType(action) ?? `${action.domain}.${action.actionType}`;
}

// ─── Internal: Audit ─────────────────────────────────────────────────────────────

/** Fire-and-forget audit event for an execution action. */
async function fireAudit(
  organisationId: string,
  eventType: string,
  requesterId: string,
  action: ExecutionAction,
  result: ConnectorExecutionResult | null,
  specialistCode: string,
  deviceId: string,
): Promise<void> {
  try {
    await logOrgEvent({
      eventType:     eventType as import("@workspace/shared").AuditEventType,
      organisationId,
      actorUserId:   requesterId,
      actorType:     "agent",
      resourceType:  "execution_action",
      resourceId:    action.actionId,
      isSensitive:   false,
      metadata: {
        actionType:      action.actionType,
        domain:          action.domain,
        target:          action.resolvedDestination?.displayPath ?? action.description,
        operation:       result?.operation ?? "pending",
        specialist:      specialistCode,
        connectorDevice: deviceId,
        riskLevel:       action.riskLevel,
        ...(result ? {
          status:        result.status,
          durationMs:    result.duration,
          errorCode:     result.error?.code ?? null,
          errorMessage:  result.error?.message ?? null,
        } : {}),
      },
    });
  } catch (err) {
    logger.warn(
      { err, actionId: action.actionId, eventType },
      "[action-dispatcher] Audit write failed (non-fatal)",
    );
  }
}
