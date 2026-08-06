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
import { db } from "@workspace/db";
import { executionActionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { ExecutionAction } from "../types/canonicalExecutionContext.js";
import type { ConnectorExecutionResult } from "./executionActionDispatcherService.js";

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
    await db.insert(executionActionsTable).values({
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
    .onConflictDoNothing();
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
    await db.update(executionActionsTable)
      .set({ status: "awaiting_approval", updatedAt: new Date() })
      .where(eq(executionActionsTable.id, actionId));
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
    await db.update(executionActionsTable)
      .set({
        status:     "approved",
        approvedBy,
        approvedAt: new Date(),
        updatedAt:  new Date(),
      })
      .where(eq(executionActionsTable.id, actionId));
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
    await db.update(executionActionsTable)
      .set({
        status:     "rejected",
        rejectedBy,
        rejectedAt: new Date(),
        updatedAt:  new Date(),
      })
      .where(eq(executionActionsTable.id, actionId));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record rejected (non-fatal)");
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
    await db.update(executionActionsTable)
      .set({
        status:             "executing",
        connectorDeviceId:  deviceId,
        sessionId,
        executionStartedAt: new Date(),
        updatedAt:          new Date(),
      })
      .where(eq(executionActionsTable.id, actionId));
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
    await db.update(executionActionsTable)
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
      .where(eq(executionActionsTable.id, actionId));
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
    await db.update(executionActionsTable)
      .set({
        status:       "failed",
        failedAt:     new Date(),
        errorDetails: error,
        updatedAt:    new Date(),
      })
      .where(eq(executionActionsTable.id, actionId));
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
    await db.update(executionActionsTable)
      .set({
        status:       "cancelled",
        cancelledAt:  new Date(),
        errorDetails: { reason },
        updatedAt:    new Date(),
      })
      .where(eq(executionActionsTable.id, actionId));
  } catch (err) {
    logger.warn({ err, actionId }, "[action-lifecycle] Failed to record cancelled (non-fatal)");
  }
}
