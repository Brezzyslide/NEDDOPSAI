/**
 * Execution Intent Service — Sprint 10
 *
 * Persists and manages execution intents produced by specialists.
 * Intents describe WHAT should happen without performing the action.
 * They are consumed by OpenClaw in a future sprint.
 *
 * No direct DB calls from route handlers — all access goes through this service.
 */

import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, executionIntentsTable, type InsertExecutionIntent } from "@workspace/db";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Maps a requestedExternalAction from SpecialistRunResult to an intent insert.
 */
export interface RequestedAction {
  actionType: string;
  description: string;
  executionChannel: string;
  toolCategory: string;
  connectorCategory?: string;
  riskLevel?: string;
  approvalRequired: boolean;
  parameters?: Record<string, unknown>;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Inserts execution intent rows into the database — one per action.
 * sequenceOrder is set to index + 1 to preserve ordering.
 */
export async function persistExecutionIntents(
  organizationId: string,
  specialistRunId: string,
  taskId: string,
  actions: RequestedAction[],
): Promise<void> {
  if (actions.length === 0) return;

  const rows: InsertExecutionIntent[] = actions.map((action, index) => ({
    id: randomUUID(),
    organizationId,
    specialistRunId,
    taskId,
    intentType: action.actionType,
    description: action.description,
    executionChannel: action.executionChannel,
    toolCategory: action.toolCategory,
    connectorCategory: action.connectorCategory ?? null,
    riskLevel: action.riskLevel ?? "medium",
    approvalRequired: action.approvalRequired,
    sequenceOrder: index + 1,
    parameters: action.parameters ?? {},
    status: "prepared",
  }));

  await db.insert(executionIntentsTable).values(rows);
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/**
 * Returns all execution intents for a specific task, scoped to the organization.
 */
export async function getExecutionIntentsForTask(
  taskId: string,
  organizationId: string,
): Promise<(typeof executionIntentsTable.$inferSelect)[]> {
  return db
    .select()
    .from(executionIntentsTable)
    .where(
      and(
        eq(executionIntentsTable.taskId, taskId),
        eq(executionIntentsTable.organizationId, organizationId),
      ),
    )
    .orderBy(executionIntentsTable.sequenceOrder);
}

/**
 * Returns all intents that require human approval and are in the 'prepared' status.
 */
export async function getPendingApprovalIntents(
  organizationId: string,
): Promise<(typeof executionIntentsTable.$inferSelect)[]> {
  return db
    .select()
    .from(executionIntentsTable)
    .where(
      and(
        eq(executionIntentsTable.organizationId, organizationId),
        eq(executionIntentsTable.approvalRequired, true),
        eq(executionIntentsTable.status, "prepared"),
      ),
    )
    .orderBy(executionIntentsTable.createdAt);
}

// ─── State transitions ────────────────────────────────────────────────────────

/**
 * Approves an intent, setting status='approved', approvedBy, and approvedAt.
 * Validates org ownership before updating.
 */
export async function approveIntent(
  intentId: string,
  organizationId: string,
  approvedBy: string,
): Promise<void> {
  await db
    .update(executionIntentsTable)
    .set({
      status: "approved",
      approvedBy,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(executionIntentsTable.id, intentId),
        eq(executionIntentsTable.organizationId, organizationId),
      ),
    );
}

/**
 * Rejects an intent, setting status='rejected', rejectedBy, rejectedAt, and rejectionReason.
 * Validates org ownership before updating.
 */
export async function rejectIntent(
  intentId: string,
  organizationId: string,
  rejectedBy: string,
  reason: string,
): Promise<void> {
  await db
    .update(executionIntentsTable)
    .set({
      status: "rejected",
      rejectedBy,
      rejectedAt: new Date(),
      rejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(executionIntentsTable.id, intentId),
        eq(executionIntentsTable.organizationId, organizationId),
      ),
    );
}
