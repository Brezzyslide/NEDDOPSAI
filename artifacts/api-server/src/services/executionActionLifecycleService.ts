/**
 * executionActionLifecycleService — Sprint 29F.1 (Part 2)
 *
 * Persists ExecutionAction lifecycle transitions to the execution_actions DB
 * table. All writes are fire-and-forget (non-fatal) — a DB write failure must
 * never block connector dispatch or the execution pipeline.
 *
 * Design decisions:
 *   • Uses @workspace/db directly (same pattern as auditService).
 *   • No RLS bypass — all inserts/updates go through the tenant RLS policy.
 *   • parameters_summary stores only a safe JSON summary (actionType, domain,
 *     target, riskLevel) — never raw file content, credentials, or prompt payloads.
 *   • DB writes are wrapped in try/catch and failures are logged as warnings.
 *   • Exported functions match the 8 lifecycle states from the brief.
 */

import { randomUUID } from "crypto";
import { db, withSystemTenantContext } from "@workspace/db";
import { executionActionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { ExecutionAction } from "../types/canonicalExecutionContext.js";
import type { ConnectorExecutionResult } from "./executionActionDispatcherService.js";

type DbClient = typeof db;

function withExecutionActionTenant<T>(
  organisationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organisationId, serviceIdentity: "execution_action_lifecycle_service", purpose },
    fn,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionLifecycleContext {
  organisationId: string;
  executionId: string;
  conversationId?: string;
  taskId?: string;
  specialistCode: string;
  requestedBy?: string;
  deviceId?: string;
  sessionId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSummary(action: ExecutionAction): Record<string, unknown> {
  return {
    actionType: action.actionType,
    domain:     action.domain ?? null,
    target:     action.resolvedDestination?.displayPath ?? action.description ?? null,
    riskLevel:  action.riskLevel,
  };
}

function buildCorrelationId(executionId: string, actionId: string): string {
  return `${executionId}:${actionId}`;
}

// ─── Lifecycle operations ─────────────────────────────────────────────────────

/**
 * Record an action at the "proposed" stage.
 * Called when the engine registers proposed actions after specialist output.
 */
export async function recordActionProposed(
  action: ExecutionAction,
  ctx: ActionLifecycleContext,
): Promise<void> {
  try {
    await withExecutionActionTenant(ctx.organisationId, "execution_action.proposed", async (client) => client.insert(executionActionsTable).values({
      id:               action.actionId,
      executionId:      ctx.executionId,
      organisationId:   ctx.organisationId,
      conversationId:   ctx.conversationId ?? null,
      taskId:           ctx.taskId ?? null,
      specialistCode:   ctx.specialistCode,
      actionType:       action.actionType,
      target:           action.resolvedDestination?.displayPath ?? action.description ?? null,
      parametersSummary: buildSummary(action),
      riskLevel:        action.riskLevel ?? "medium",
      approvalRequired: action.requiresApproval ?? true,
      requestedBy:      ctx.requestedBy ?? null,
      connectorDeviceId: ctx.deviceId ?? null,
      sessionId:        ctx.sessionId ?? null,
      idempotencyKey:   `${ctx.executionId}:${action.actionId}`,
      status:           "proposed",
      proposedAt:       action.proposedAt ? new Date(action.proposedAt) : new Date(),
      correlationId:    buildCorrelationId(ctx.executionId, action.actionId),
    })
    .onConflictDoNothing());
  } catch (err) {
    logger.warn({ err, actionId: action.actionId }, "[action-lifecycle] Failed to record proposed action (non-fatal)");
  }
}

/**
 * Transition action to "awaiting_approval".
 * Called when the approval plan is presented to the user.
 */
export async function recordActionAwaitingApproval(
  actionId: string,
  organisationId: string,
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.awaiting_approval", async (client) => client.update(executionActionsTable)
      .set({ status: "awaiting_approval", updatedAt: new Date() })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record awaiting_approval (non-fatal)");
  }
}

/**
 * Transition action to "approved".
 * Called when the user approves an action or plan.
 */
export async function recordActionApproved(
  actionId: string,
  organisationId: string,
  approvedBy: string,
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.approved", async (client) => client.update(executionActionsTable)
      .set({
        status:     "approved",
        approvedBy,
        approvedAt: new Date(),
        updatedAt:  new Date(),
      })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record approved (non-fatal)");
  }
}

/**
 * Transition action to "rejected".
 * Called when the user rejects an action or the approval plan expires.
 */
export async function recordActionRejected(
  actionId: string,
  organisationId: string,
  rejectedBy: string,
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.rejected", async (client) => client.update(executionActionsTable)
      .set({
        status:     "rejected",
        rejectedBy,
        rejectedAt: new Date(),
        updatedAt:  new Date(),
      })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record rejected (non-fatal)");
  }
}

// ─── Pre-dispatch authorisation proof record (BLOCKING) ───────────────────────

/**
 * Sprint 29F.2 Part B — Durable pre-dispatch authorisation proof.
 *
 * BLOCKING — this function THROWS if the DB write fails.
 * The caller MUST NOT dispatch a write-side connector operation unless this
 * succeeds. This is the governance invariant: no external side effect without a
 * durable record proving authorisation.
 *
 * Required fields from the 29F.2 brief:
 *   ✓ executionId        (already in existing row from recordActionProposed)
 *   ✓ actionId           (primary key)
 *   ✓ organisation/requester identity
 *   ✓ deviceId
 *   ✓ operation/capability  (operationType — new column)
 *   ✓ resolved target       (target column)
 *   ✓ idempotency key
 *   ✓ approval state        (status = "approved")
 *   ✓ approval actor        (approvedBy)
 *   ✓ approval timestamp    (approvedAt)
 *   ✓ approval-plan binding hash (approvalPlanBindingHash — new column)
 *
 * If the action row doesn't exist yet (recordActionProposed was fire-and-forget
 * and failed), this performs an UPSERT to guarantee the row exists before dispatch.
 */
export async function recordActionPreDispatch(
  action: import("../types/canonicalExecutionContext.js").ExecutionAction,
  ctx: ActionLifecycleContext,
  params: {
    operationType: string;
    idempotencyKey: string;
    approvalPlanBindingHash?: string | null;
    approvedBy?: string | null;
    approvedAt?: Date | null;
  },
): Promise<void> {
  // BLOCKING — do NOT wrap in try/catch here. Let the error propagate to block dispatch.
  await withExecutionActionTenant(ctx.organisationId, "execution_action.pre_dispatch", async (client) => client.insert(executionActionsTable)
    .values({
      id:               action.actionId,
      executionId:      ctx.executionId,
      organisationId:   ctx.organisationId,
      conversationId:   ctx.conversationId ?? null,
      taskId:           ctx.taskId ?? null,
      specialistCode:   ctx.specialistCode,
      actionType:       action.actionType,
      target:           action.resolvedDestination?.displayPath ?? action.description ?? null,
      parametersSummary: buildSummary(action),
      riskLevel:        action.riskLevel ?? "medium",
      approvalRequired: action.requiresApproval ?? true,
      requestedBy:      ctx.requestedBy ?? null,
      approvedBy:       params.approvedBy ?? null,
      approvedAt:       params.approvedAt ?? null,
      connectorDeviceId: ctx.deviceId ?? null,
      sessionId:        ctx.sessionId ?? null,
      idempotencyKey:   params.idempotencyKey,
      // New Sprint 29F.2 columns
      operationType:          params.operationType,
      approvalPlanBindingHash: params.approvalPlanBindingHash ?? null,
      status:                 "approved",
      proposedAt:             action.proposedAt ? new Date(action.proposedAt) : new Date(),
      correlationId:          buildCorrelationId(ctx.executionId, action.actionId),
    })
    .onConflictDoUpdate({
      target: executionActionsTable.id,
      set: {
        // Authorisation proof fields — must be persisted durably before dispatch
        status:                 "approved",
        operationType:          params.operationType,
        target:                 action.resolvedDestination?.displayPath ?? action.description ?? null,
        idempotencyKey:         params.idempotencyKey,
        approvalPlanBindingHash: params.approvalPlanBindingHash ?? null,
        approvedBy:             params.approvedBy ?? null,
        approvedAt:             params.approvedAt ?? null,
        connectorDeviceId:      ctx.deviceId ?? null,
        sessionId:              ctx.sessionId ?? null,
        updatedAt:              new Date(),
      },
    }));
  // If the above throws, the error propagates to the caller which must abort dispatch.
}

/**
 * Sprint 29F.2 Part B — Flag reconciliation required.
 *
 * Called when the physical connector operation succeeded but the final lifecycle
 * persistence failed. The physical side effect has already occurred; the action
 * MUST NOT be retried. This flag marks the record for manual reconciliation.
 *
 * Best-effort (wrapped in try/catch) because if the DB is completely down there
 * is nothing we can do — the operator must reconcile from connector logs.
 */
export async function recordReconciliationRequired(
  actionId: string,
  organisationId: string,
  reason: string,
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.reconciliation_required", async (client) => client.update(executionActionsTable)
      .set({
        reconciliationRequired: true,
        errorDetails: { reconciliationReason: reason, setAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    // Nothing we can do — log as critical for operator attention
    logger.error(
      { err, actionId, organisationId, reason },
      "[action-lifecycle] CRITICAL: Failed to set reconciliationRequired flag — manual reconciliation needed",
    );
  }
}

/**
 * Transition action to "executing".
 * Called immediately before the connector dispatch begins.
 */
export async function recordActionExecuting(
  actionId: string,
  organisationId: string,
  deviceId: string,
  sessionId: string,
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.executing", async (client) => client.update(executionActionsTable)
      .set({
        status:             "executing",
        connectorDeviceId:  deviceId,
        sessionId,
        executionStartedAt: new Date(),
        updatedAt:          new Date(),
      })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record executing (non-fatal)");
  }
}

/**
 * Transition action to "completed".
 * Called after the connector returns a successful result.
 */
export async function recordActionCompleted(
  actionId: string,
  organisationId: string,
  result: ConnectorExecutionResult,
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.completed", async (client) => client.update(executionActionsTable)
      .set({
        status:        "completed",
        completedAt:   new Date(),
        resultSummary: {
          operation:   result.operation,
          target:      result.target,
          durationMs:  result.duration,
          sessionId:   result.sessionId,
        },
        updatedAt: new Date(),
      })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record completed (non-fatal)");
  }
}

/**
 * Transition action to "failed".
 * Called when the connector returns a failure or the bridge throws a non-fatal error.
 */
export async function recordActionFailed(
  actionId: string,
  organisationId: string,
  error: { code: string; message: string },
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.failed", async (client) => client.update(executionActionsTable)
      .set({
        status:       "failed",
        failedAt:     new Date(),
        errorDetails: error,
        updatedAt:    new Date(),
      })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record failed state (non-fatal)");
  }
}

/**
 * Transition action to "cancelled".
 * Called for remaining actions after a fatal connector failure stops dispatch.
 */
export async function recordActionCancelled(
  actionId: string,
  organisationId: string,
  reason: string,
): Promise<void> {
  try {
    await withExecutionActionTenant(organisationId, "execution_action.cancelled", async (client) => client.update(executionActionsTable)
      .set({
        status:       "cancelled",
        cancelledAt:  new Date(),
        errorDetails: { reason },
        updatedAt:    new Date(),
      })
      .where(and(eq(executionActionsTable.id, actionId), eq(executionActionsTable.organisationId, organisationId))));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record cancelled (non-fatal)");
  }
}
