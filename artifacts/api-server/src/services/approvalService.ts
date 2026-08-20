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
  tasksTable,
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

export async function getPendingApprovalForTask(input: {
  taskId: string;
  organizationId: string;
  approvalType?: ApprovalType;
}): Promise<(typeof approvalsTable.$inferSelect) | undefined> {
  const conditions = [
    eq(approvalsTable.taskId, input.taskId),
    eq(approvalsTable.organizationId, input.organizationId),
    eq(approvalsTable.state, "pending") as any,
  ];
  if (input.approvalType) conditions.push(eq(approvalsTable.approvalType, input.approvalType) as any);

  const [approval] = await db
    .select()
    .from(approvalsTable)
    .where(and(...conditions))
    .orderBy(desc(approvalsTable.requestedAt))
    .limit(1);
  return approval;
}

export async function supersedePendingApprovalsForTask(input: {
  taskId: string;
  organizationId: string;
  actorUserId: string;
  reason: string;
}): Promise<(typeof approvalsTable.$inferSelect)[]> {
  const superseded = await db
    .update(approvalsTable)
    .set({
      state: "superseded" as ApprovalState,
      resolvedAt: new Date(),
      resolvedBy: input.actorUserId,
      notes: input.reason,
    })
    .where(and(
      eq(approvalsTable.taskId, input.taskId),
      eq(approvalsTable.organizationId, input.organizationId),
      eq(approvalsTable.state, "pending") as any,
    ))
    .returning();

  if (superseded.length > 0) {
    await db.insert(approvalHistoryTable).values(superseded.map(approval => ({
      id: randomUUID(),
      approvalId: approval.id,
      organizationId: input.organizationId,
      action: "superseded",
      actorUserId: input.actorUserId,
      notes: input.reason,
      metadata: { taskId: input.taskId },
    })));
  }

  return superseded;
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
  // Sprint 29: filter state in DB (not in-memory after limit) to avoid missing items
  const condition = state
    ? and(eq(approvalsTable.organizationId, organizationId), eq(approvalsTable.state, state) as any)
    : eq(approvalsTable.organizationId, organizationId);

  return db
    .select()
    .from(approvalsTable)
    .where(condition)
    .orderBy(desc(approvalsTable.requestedAt))
    .limit(limit);
}

// ─── Bulk Resolve (Sprint 29) ─────────────────────────────────────────────────

export interface BulkResolveResult {
  id: string;
  success: boolean;
  error?: string;
}

export async function bulkResolveApprovals(input: {
  approvalIds: string[];
  organizationId: string;
  action: "approved" | "rejected";
  actorUserId: string;
  notes?: string;
}): Promise<{ succeeded: number; failed: number; results: BulkResolveResult[] }> {
  const results: BulkResolveResult[] = [];

  for (const approvalId of input.approvalIds.slice(0, 100)) {
    try {
      await resolveApproval({
        approvalId,
        organizationId: input.organizationId,
        action: input.action,
        actorUserId: input.actorUserId,
        notes: input.notes,
      });
      results.push({ id: approvalId, success: true });
    } catch (err: any) {
      results.push({ id: approvalId, success: false, error: err?.message ?? "Unknown error" });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  return { succeeded, failed: results.length - succeeded, results };
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

const APPROVAL_RESOLVER_ROLES: Record<string, string[]> = {
  manager_approval:       ["manager", "administrator", "owner"],
  administrator_approval: ["administrator", "owner"],
  owner_approval:         ["owner"],
  dual_approval:          ["administrator", "owner"],
  compliance_approval:    ["administrator", "owner"],
  platform_approval:      [],
  no_approval:            [],
};

export interface ApprovalAuthorityResult {
  allowed: boolean;
  code?: string;
  message?: string;
  requiredRoles?: string[];
  canForce?: boolean;
}

export async function checkApprovalAuthority(input: {
  approvalId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: string;
  action: "approved" | "rejected";
  forceSelfApproval?: boolean;
}): Promise<ApprovalAuthorityResult> {
  const approval = await getApprovalById(input.approvalId, input.organizationId);
  if (!approval) {
    return { allowed: false, code: "NOT_FOUND", message: "Approval not found." };
  }

  const allowedRoles = APPROVAL_RESOLVER_ROLES[approval.approvalType] ?? [];
  if (allowedRoles.length === 0) {
    return {
      allowed: false,
      code: "APPROVAL_NOT_RESOLVABLE_HERE",
      message: `Approvals of type '${approval.approvalType}' cannot be resolved through this endpoint.`,
      requiredRoles: [],
    };
  }

  if (!allowedRoles.includes(input.actorRole)) {
    return {
      allowed: false,
      code: "INSUFFICIENT_ROLE",
      message: `Resolving a '${approval.approvalType}' approval requires one of the following roles: ${allowedRoles.join(", ")}.`,
      requiredRoles: allowedRoles,
    };
  }

  if (approval.taskId) {
    const [task] = await db
      .select({ originatingUserId: tasksTable.originatingUserId, currentState: tasksTable.currentState })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, approval.taskId), eq(tasksTable.organizationId, input.organizationId)))
      .limit(1);

    if (task?.currentState === "cancelled") {
      return {
        allowed: false,
        code: "TASK_CANCELLED",
        message: "This task has been cancelled. Its approval can no longer be resolved.",
      };
    }

    if (input.action === "approved" && task?.originatingUserId && task.originatingUserId === input.actorUserId && !input.forceSelfApproval) {
      return {
        allowed: false,
        code: "SELF_APPROVAL_BLOCKED",
        message: "Self-approval is not permitted. A different member of your organisation must approve this work.",
        canForce: input.actorRole === "owner",
      };
    }
  }

  return { allowed: true };
}

export async function resolveApprovalWithAuthority(input: {
  approvalId: string;
  organizationId: string;
  action: "approved" | "rejected";
  actorUserId: string;
  actorRole: string;
  notes?: string;
  forceSelfApproval?: boolean;
}): Promise<typeof approvalsTable.$inferSelect> {
  const authority = await checkApprovalAuthority(input);
  if (!authority.allowed) {
    const status = authority.code === "NOT_FOUND" ? "RESOURCE_NOT_FOUND" : authority.code;
    throw Object.assign(new Error(authority.message ?? "Approval authority check failed."), {
      code: status,
      details: authority,
    });
  }

  return resolveApproval({
    approvalId: input.approvalId,
    organizationId: input.organizationId,
    action: input.action,
    actorUserId: input.actorUserId,
    notes: input.notes,
  });
}
