/**
 * Approval Service — Sprint 2
 *
 * Create, resolve, and query approval instances.
 * No execution — models the approval workflow only.
 */

import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  approvalsTable,
  approvalHistoryTable,
  type InsertApproval,
} from "@workspace/db";
import type { ApprovalType, ApprovalState } from "@workspace/shared";

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createApproval(input: {
  taskId: string;
  organizationId: string;
  approvalType: ApprovalType;
  requestedByUserId?: string;
  notes?: string;
  expiresInHours?: number;
}): Promise<typeof approvalsTable.$inferSelect> {
  const approvalId = randomUUID();
  const expiresAt = input.expiresInHours
    ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000)
    : undefined;

  const row: InsertApproval = {
    id: approvalId,
    taskId: input.taskId,
    organizationId: input.organizationId,
    approvalType: input.approvalType,
    state: "pending",
    notes: input.notes,
    expiresAt: expiresAt ?? null,
  };

  const [approval] = await db.insert(approvalsTable).values(row).returning();
  if (!approval) throw new Error("Failed to create approval");

  // Sprint 5: include organizationId for direct tenant ownership on join table
  await db.insert(approvalHistoryTable).values({
    id: randomUUID(),
    approvalId,
    organizationId: input.organizationId,
    action: "requested",
    actorUserId: input.requestedByUserId ?? null,
    notes: input.notes ?? null,
    metadata: { approvalType: input.approvalType },
  });

  return approval;
}

// ─── Resolve ──────────────────────────────────────────────────────────────────

export async function resolveApproval(input: {
  approvalId: string;
  organizationId: string;
  action: "approved" | "rejected";
  actorUserId: string;
  notes?: string;
}): Promise<typeof approvalsTable.$inferSelect> {
  const [existing] = await db
    .select()
    .from(approvalsTable)
    .where(
      and(
        eq(approvalsTable.id, input.approvalId),
        eq(approvalsTable.organizationId, input.organizationId),
      ),
    )
    .limit(1);

  if (!existing) throw Object.assign(new Error("Approval not found"), { code: "RESOURCE_NOT_FOUND" });
  if (existing.state !== "pending") {
    throw Object.assign(
      new Error(`Approval is already ${existing.state}`),
      { code: "VALIDATION_ERROR" },
    );
  }

  const [updated] = await db
    .update(approvalsTable)
    .set({
      state: input.action,
      resolvedAt: new Date(),
      resolvedBy: input.actorUserId,
      notes: input.notes ?? existing.notes,
    })
    .where(eq(approvalsTable.id, input.approvalId))
    .returning();

  // Sprint 5: include organizationId for direct tenant ownership on join table
  await db.insert(approvalHistoryTable).values({
    id: randomUUID(),
    approvalId: input.approvalId,
    organizationId: input.organizationId,
    action: input.action,
    actorUserId: input.actorUserId,
    notes: input.notes ?? null,
    metadata: {},
  });

  return updated!;
}

// ─── Query ────────────────────────────────────────────────────────────────────

export async function getApprovalsByOrg(
  organizationId: string,
  state?: ApprovalState,
  limit = 50,
): Promise<(typeof approvalsTable.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(approvalsTable)
    .where(eq(approvalsTable.organizationId, organizationId))
    .orderBy(desc(approvalsTable.requestedAt))
    .limit(limit);

  if (state) return rows.filter(r => r.state === state);
  return rows;
}

export async function getApprovalById(
  approvalId: string,
  organizationId: string,
): Promise<(typeof approvalsTable.$inferSelect) | undefined> {
  const [row] = await db
    .select()
    .from(approvalsTable)
    .where(
      and(
        eq(approvalsTable.id, approvalId),
        eq(approvalsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row;
}

export async function getApprovalHistory(
  approvalId: string,
): Promise<(typeof approvalHistoryTable.$inferSelect)[]> {
  return db
    .select()
    .from(approvalHistoryTable)
    .where(eq(approvalHistoryTable.approvalId, approvalId))
    .orderBy(desc(approvalHistoryTable.occurredAt));
}
