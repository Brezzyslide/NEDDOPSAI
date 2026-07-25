/**
 * @workspace/openclaw — Runtime Event Translator
 *
 * Translates raw OpenClaw webhook events into NeedsOps RuntimeEvents
 * (@workspace/agent-runtime) and determines the resulting execution
 * session status transition.
 *
 * This is the only place where OpenClaw event semantics are interpreted.
 * All other NeedsOps code works with the NeedsOps RuntimeEvent type.
 */

import type { RuntimeEvent, RuntimeEventType, ExecutionStatus } from "@workspace/agent-runtime";
import type { OpenClawWebhookEvent } from "./types.js";

// ─── Event type mapping ───────────────────────────────────────────────────────

/**
 * Maps OpenClaw event type strings to NeedsOps RuntimeEventType.
 * If an event type is not in this map it is treated as an unknown event
 * and logged but not applied.
 */
const OPENCLAW_TO_NEEDSOPS_EVENT: Record<string, RuntimeEventType> = {
  "runtime.connected":              "runtime.connected",
  "runtime.disconnected":           "runtime.disconnected",
  "runtime.unavailable":            "runtime.unavailable",
  "execution.accepted":             "execution.accepted",
  "execution.started":              "execution.started",
  "execution.progress":             "execution.progress",
  "execution.paused":               "execution.paused",
  "execution.resumed":              "execution.resumed",
  "execution.awaiting_approval":    "execution.awaiting_approval",
  "execution.completed":            "execution.completed",
  "execution.failed":               "execution.failed",
  "execution.cancelled":            "execution.cancelled",
  "execution.expired":              "execution.expired",
};

// ─── Status transition map ────────────────────────────────────────────────────

/**
 * Maps a NeedsOps RuntimeEventType to the resulting ExecutionStatus.
 * Events that do not change status (e.g. progress updates) map to null.
 */
export const EVENT_TO_STATUS_TRANSITION: Partial<Record<RuntimeEventType, ExecutionStatus>> = {
  "execution.accepted":          "accepted",
  "execution.started":           "running",
  "execution.paused":            "paused",
  "execution.resumed":           "running",
  "execution.awaiting_approval": "awaiting_approval",
  "execution.completed":         "completed",
  "execution.failed":            "failed",
  "execution.cancelled":         "cancelled",
  "execution.expired":           "expired",
  // progress events do not change status
  "execution.progress":          undefined,
  "runtime.connected":           undefined,
  "runtime.disconnected":        undefined,
  "runtime.unavailable":         undefined,
};

// ─── Terminal states ──────────────────────────────────────────────────────────

export const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  "completed",
  "failed",
  "cancelled",
  "expired",
]);

export function isTerminalStatus(status: ExecutionStatus): boolean {
  return TERMINAL_EXECUTION_STATUSES.has(status);
}

// ─── Task state mapping ───────────────────────────────────────────────────────

/**
 * Maps an ExecutionStatus to the corresponding NeedsOps task state.
 * Used to keep the task's currentState in sync with its execution session.
 */
export const EXECUTION_TO_TASK_STATE: Partial<Record<ExecutionStatus, string>> = {
  completed:          "completed",
  failed:             "failed",
  cancelled:          "cancelled",
  awaiting_approval:  "awaiting_approval",
  // running / accepted / paused / submitted / pending do not change task state
  // (task stays 'executing' while the session is active)
};

// ─── Validation ───────────────────────────────────────────────────────────────

export class RuntimeEventValidationError extends Error {
  constructor(
    message: string,
    public readonly eventId: string,
  ) {
    super(message);
    this.name = "RuntimeEventValidationError";
  }
}

/**
 * Validate a raw OpenClaw webhook event before translation.
 */
export function validateOpenClawEvent(raw: OpenClawWebhookEvent): void {
  if (!raw.eventId) {
    throw new RuntimeEventValidationError("eventId is required", "");
  }
  if (!raw.eventType) {
    throw new RuntimeEventValidationError("eventType is required", raw.eventId);
  }
  if (!raw.executionId) {
    throw new RuntimeEventValidationError("executionId is required", raw.eventId);
  }
  if (!raw.tenantId) {
    throw new RuntimeEventValidationError("tenantId is required", raw.eventId);
  }
  if (!raw.occurredAt) {
    throw new RuntimeEventValidationError("occurredAt is required", raw.eventId);
  }
  if (!OPENCLAW_TO_NEEDSOPS_EVENT[raw.eventType]) {
    throw new RuntimeEventValidationError(
      `Unknown OpenClaw event type: ${raw.eventType}`,
      raw.eventId,
    );
  }
}

// ─── Translation ──────────────────────────────────────────────────────────────

/**
 * Translate a raw OpenClaw webhook event into a NeedsOps RuntimeEvent.
 * Validates the event before translation.
 */
export function translateOpenClawEvent(raw: OpenClawWebhookEvent): RuntimeEvent {
  validateOpenClawEvent(raw);

  const needsOpsEventType = OPENCLAW_TO_NEEDSOPS_EVENT[raw.eventType]!;

  return {
    eventId: raw.eventId,
    eventType: needsOpsEventType,
    executionId: raw.executionId,
    runtimeExecutionId: raw.runtimeExecutionId ?? null,
    tenantId: raw.tenantId,
    payload: raw.payload ?? {},
    occurredAt: raw.occurredAt,
  };
}

/**
 * Determine the new ExecutionStatus that should result from a RuntimeEvent.
 * Returns null if the event does not change the session status.
 */
export function resolveStatusTransition(
  event: RuntimeEvent,
  currentStatus: ExecutionStatus,
): ExecutionStatus | null {
  // Terminal sessions must not be transitioned further
  if (isTerminalStatus(currentStatus)) return null;

  const newStatus = EVENT_TO_STATUS_TRANSITION[event.eventType];
  if (newStatus === undefined || newStatus === null) return null;
  if (newStatus === currentStatus) return null;

  return newStatus;
}

/**
 * Determine whether a task state update is needed after an execution status change.
 * Returns the new task state or null if no task update is required.
 */
export function resolveTaskStateUpdate(newExecutionStatus: ExecutionStatus): string | null {
  return EXECUTION_TO_TASK_STATE[newExecutionStatus] ?? null;
}
