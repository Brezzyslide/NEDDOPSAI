/**
 * Task Service — Sprint 2
 *
 * CRUD + state machine for platform tasks.
 * Execution is simulated — no actual AI calls.
 */

import { createHash, randomUUID } from "crypto";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskSpecialistsTable,
  taskExecutionPlansTable,
  type InsertTask,
} from "@workspace/db";
import { planTask, type TaskPlan } from "./chiefOfStaffService.js";
import { createApproval, getPendingApprovalForTask, supersedePendingApprovalsForTask } from "./approvalService.js";
import type { ApprovalType, TaskState, TaskPriority } from "@workspace/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  organizationId: string;
  originatingUserId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  originatingModule?: string;
  conversationId?: string;
  idempotencyKey?: string;
  allowDuplicate?: boolean;
}

export interface TaskWithPlan {
  task: typeof tasksTable.$inferSelect;
  plan: TaskPlan;
  specialists: (typeof taskSpecialistsTable.$inferSelect)[];
  reusedExisting?: boolean;
  dedupeReason?: "idempotency_key" | "conversation_work_intent";
}

// ─── Valid state transitions ───────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  draft: ["queued", "cancelled"],
  queued: ["planning", "cancelled"],
  planning: ["awaiting_approval", "approved", "cancelled"],
  awaiting_approval: ["approved", "cancelled", "failed"],
  approved: ["executing", "cancelled"],
  executing: ["completed", "failed", "cancelled"],
  completed: [],
  cancelled: [],
  failed: ["queued"],
};

export function isValidTransition(from: TaskState, to: TaskState): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

const TERMINAL_TASK_STATES = new Set<TaskState>(["completed", "cancelled"]);
const DISPATCHABLE_TASK_STATES = ["approved", "failed"] as const;

function mergeTaskMetadata(
  current: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...((current as Record<string, unknown> | null) ?? {}),
    ...patch,
  };
}

const ACTIVE_TASK_CREATION_STATES: TaskState[] = [
  "draft",
  "queued",
  "planning",
  "awaiting_approval",
  "approved",
  "executing",
];

function normaliseIntentText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(a|an|the|for|me|please|to|and|with|all|relevant|standard|provider|providers|draft|develop|create|prepare|write|review)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveWorkIntentKey(title: string, description?: string): string {
  const combined = `${title} ${description ?? ""}`;
  const normalised = normaliseIntentText(combined);
  if (/\bndis\b/.test(normalised) && /\bservice agreement\b/.test(normalised)) {
    return "ndis_service_agreement";
  }
  if (/\bservice agreement\b/.test(normalised)) {
    return "service_agreement";
  }
  return createHash("sha256")
    .update(normalised || title.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

function getCreationMetadata(task: typeof tasksTable.$inferSelect): Record<string, unknown> {
  const metadata = (task.metadata as Record<string, unknown> | null) ?? {};
  return (metadata.taskCreation as Record<string, unknown> | undefined) ?? {};
}

async function hydrateTaskWithPlan(
  task: typeof tasksTable.$inferSelect,
  dedupeReason?: TaskWithPlan["dedupeReason"],
): Promise<TaskWithPlan> {
  const [planRow, specialists] = await Promise.all([
    getTaskPlan(task.id),
    db
      .select()
      .from(taskSpecialistsTable)
      .where(and(
        eq(taskSpecialistsTable.taskId, task.id),
        eq(taskSpecialistsTable.organizationId, task.organizationId),
      )),
  ]);
  const plan = (planRow?.planData as TaskPlan | undefined) ?? planTask(task.title, task.description ?? undefined);
  return { task, plan, specialists, reusedExisting: true, dedupeReason };
}

async function findExistingTaskForCreation(input: CreateTaskInput): Promise<{
  task: typeof tasksTable.$inferSelect;
  reason: TaskWithPlan["dedupeReason"];
} | null> {
  if (input.allowDuplicate) return null;
  const idempotencyKey = input.idempotencyKey?.trim();
  const workIntentKey = input.conversationId
    ? deriveWorkIntentKey(input.title, input.description)
    : null;
  if (!idempotencyKey && !workIntentKey) return null;

  const candidates = await db
    .select()
    .from(tasksTable)
    .where(and(
      eq(tasksTable.organizationId, input.organizationId),
      inArray(tasksTable.currentState, ACTIVE_TASK_CREATION_STATES as unknown as string[]),
    ))
    .orderBy(desc(tasksTable.createdAt))
    .limit(100);

  for (const task of candidates) {
    const creation = getCreationMetadata(task);
    if (idempotencyKey && creation.idempotencyKey === idempotencyKey) {
      return { task, reason: "idempotency_key" };
    }
    if (
      workIntentKey &&
      creation.conversationId === input.conversationId &&
      creation.workIntentKey === workIntentKey
    ) {
      return { task, reason: "conversation_work_intent" };
    }
  }
  return null;
}

function getApprovalRequirement(task: typeof tasksTable.$inferSelect): { required: boolean; approvalType?: ApprovalType } {
  const metadata = (task.metadata as Record<string, unknown> | null) ?? {};
  const requirement = metadata.approvalRequirement as Record<string, unknown> | undefined;
  if (requirement?.required === true) {
    return {
      required: true,
      approvalType: (requirement.approvalType as ApprovalType | undefined) ?? (task.approvalState as ApprovalType | undefined),
    };
  }
  return { required: false };
}

function buildApprovalRequirement(plan: TaskPlan): Record<string, unknown> {
  return plan.requiresApproval
    ? {
        approvalRequirement: {
          required: true,
          approvalType: plan.approvalType,
          source: "chief_of_staff_plan",
          capturedAt: new Date().toISOString(),
        },
      }
    : {
        approvalRequirement: {
          required: false,
          capturedAt: new Date().toISOString(),
        },
      };
}

function extractMonthRange(text: string): string | null {
  const month = "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
  const match = text.match(new RegExp(`${month}\\s+(?:to|through|until|-)\\s+${month}`, "i"));
  return match?.[0] ?? null;
}

function mergeTaskSpecification(current: string, changeRequest: string): string {
  const nextRange = extractMonthRange(changeRequest);
  if (nextRange) {
    const currentRange = extractMonthRange(current);
    if (currentRange) {
      return current.replace(currentRange, nextRange);
    }
  }

  const trimmed = current.trim();
  const change = changeRequest.trim();
  if (!trimmed) return change;
  if (trimmed.toLowerCase().includes(change.toLowerCase())) return trimmed;
  return `${trimmed}\n\nUpdated instruction: ${change}`;
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function createTask(input: CreateTaskInput): Promise<TaskWithPlan> {
  const existing = await findExistingTaskForCreation(input);
  if (existing) {
    return hydrateTaskWithPlan(existing.task, existing.reason);
  }

  const taskId = randomUUID();
  const taskCreation = {
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
    conversationId: input.conversationId,
    workIntentKey: input.conversationId ? deriveWorkIntentKey(input.title, input.description) : undefined,
    source: input.originatingModule ?? "task_centre",
    explicitSeparate: input.allowDuplicate === true,
    createdAt: new Date().toISOString(),
  };

  const taskRow: InsertTask = {
    id: taskId,
    organizationId: input.organizationId,
    title: input.title,
    description: input.description,
    originatingUserId: input.originatingUserId,
    originatingModule: input.originatingModule ?? "task_centre",
    currentState: "queued",
    priority: input.priority ?? "normal",
    approvalState: "not_required",
    metadata: { taskCreation },
  };

  const [task] = await db.insert(tasksTable).values(taskRow).returning();
  if (!task) throw new Error("Failed to create task");

  // Chief of Staff plans the task
  const plan = planTask(input.title, input.description);

  // Persist only approval requirements at planning time. A concrete pending
  // approval row is created later when execution reaches an actionable gate.
  const approvalState = plan.requiresApproval ? "required" : "not_required";
  await db
    .update(tasksTable)
    .set({
      currentState: "planning",
      approvalState,
      metadata: mergeTaskMetadata(task.metadata, buildApprovalRequirement(plan)),
      updatedAt: new Date(),
    })
    .where(eq(tasksTable.id, taskId));

  // Persist execution plan — Sprint 5: include organizationId for direct tenant ownership
  await db.insert(taskExecutionPlansTable).values({
    id: randomUUID(),
    taskId,
    organizationId: input.organizationId,
    planData: plan as unknown as Record<string, unknown>,
    version: "1",
  });

  // Assign specialists — Sprint 5: include organizationId for direct tenant ownership
  const specialistRows = plan.assignedSpecialists.map(code => ({
    id: randomUUID(),
    taskId,
    organizationId: input.organizationId,
    specialistId: `spec_${code}`,
    role: code === "chief_of_staff" ? "lead" : "executor",
  }));

  let specialists: (typeof taskSpecialistsTable.$inferSelect)[] = [];
  if (specialistRows.length > 0) {
    specialists = await db
      .insert(taskSpecialistsTable)
      .values(specialistRows)
      .returning();
  }

  // Approval-required tasks are still dispatchable until the actual approval
  // gate is reached. `awaiting_approval` means a real pending approval exists.
  const nextState: TaskState = "approved";
  const [updatedTask] = await db
    .update(tasksTable)
    .set({ currentState: nextState, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId))
    .returning();

  return { task: updatedTask!, plan, specialists };
}

export async function getTasksByOrg(
  organizationId: string,
  states?: TaskState[],
  limit = 50,
): Promise<(typeof tasksTable.$inferSelect)[]> {
  const conditions = [eq(tasksTable.organizationId, organizationId)];

  // If specific states requested, filter (simplified — full `inArray` available if needed)
  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(...conditions))
    .orderBy(desc(tasksTable.createdAt))
    .limit(limit);

  if (states && states.length > 0) {
    return rows.filter(r => states.includes(r.currentState as TaskState));
  }
  return rows;
}

export async function getTaskById(
  taskId: string,
  organizationId: string,
): Promise<(typeof tasksTable.$inferSelect) | undefined> {
  const [row] = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)))
    .limit(1);
  return row;
}

export async function transitionTaskState(
  taskId: string,
  organizationId: string,
  to: TaskState,
): Promise<typeof tasksTable.$inferSelect> {
  const task = await getTaskById(taskId, organizationId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "RESOURCE_NOT_FOUND" });

  const from = task.currentState as TaskState;
  if (from === to) return task;
  if (!isValidTransition(from, to)) {
    throw Object.assign(
      new Error(`Cannot transition task from '${from}' to '${to}'`),
      { code: "VALIDATION_ERROR" },
    );
  }

  const [updated] = await db
    .update(tasksTable)
    .set({ currentState: to, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId))
    .returning();

  return updated!;
}

export async function claimTaskForExecution(
  taskId: string,
  organizationId: string,
  metadata: Record<string, unknown> = {},
): Promise<{ claimed: boolean; task?: typeof tasksTable.$inferSelect; reason?: "not_found" | "cancelled" | "completed" | "already_executing" | "not_dispatchable" }> {
  const task = await getTaskById(taskId, organizationId);
  if (!task) return { claimed: false, reason: "not_found" };

  const state = task.currentState as TaskState;
  if (state === "cancelled") return { claimed: false, task, reason: "cancelled" };
  if (state === "completed") return { claimed: false, task, reason: "completed" };
  if (state === "executing") return { claimed: false, task, reason: "already_executing" };
  if (!DISPATCHABLE_TASK_STATES.includes(state as (typeof DISPATCHABLE_TASK_STATES)[number])) {
    return { claimed: false, task, reason: "not_dispatchable" };
  }

  const [updated] = await db
    .update(tasksTable)
    .set({
      currentState: "executing",
      metadata: mergeTaskMetadata(task.metadata, {
        executionClaim: {
          ...metadata,
          claimedAt: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    })
    .where(and(
      eq(tasksTable.id, taskId),
      eq(tasksTable.organizationId, organizationId),
      inArray(tasksTable.currentState, [...DISPATCHABLE_TASK_STATES] as unknown as string[]),
    ))
    .returning();

  if (!updated) {
    const latest = await getTaskById(taskId, organizationId);
    return { claimed: false, task: latest, reason: latest?.currentState === "cancelled" ? "cancelled" : "not_dispatchable" };
  }

  return { claimed: true, task: updated };
}

export async function isTaskCancelled(taskId: string | undefined, organizationId: string): Promise<boolean> {
  if (!taskId) return false;
  if (!tasksTable) return false;
  const task = await getTaskById(taskId, organizationId);
  return task?.currentState === "cancelled";
}

export async function cancelTask(
  taskId: string,
  organizationId: string,
  metadata: Record<string, unknown> = {},
): Promise<{ status: "cancelled" | "already_cancelled" | "already_completed"; task: typeof tasksTable.$inferSelect }> {
  const task = await getTaskById(taskId, organizationId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "RESOURCE_NOT_FOUND" });
  if (task.currentState === "cancelled") return { status: "already_cancelled", task };
  if (task.currentState === "completed") return { status: "already_completed", task };

  const [updated] = await db
    .update(tasksTable)
    .set({
      currentState: "cancelled",
      metadata: mergeTaskMetadata(task.metadata, {
        cancellation: {
          ...metadata,
          cancelledAt: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    })
    .where(and(
      eq(tasksTable.id, taskId),
      eq(tasksTable.organizationId, organizationId),
      inArray(tasksTable.currentState, ["draft", "queued", "planning", "awaiting_approval", "approved", "executing", "failed"]),
    ))
    .returning();

  return { status: "cancelled", task: updated ?? task };
}

export async function requestTaskApprovalGate(input: {
  taskId?: string;
  organizationId: string;
  requestedByUserId?: string;
  approvalType?: ApprovalType;
  notes?: string;
  completedWorkId?: string;
  completedWorkStatus?: string;
  correlationId?: string;
}): Promise<{ status: "pending_approval" | "cancelled" | "completed" | "not_required" | "not_applicable" | "not_found"; task?: typeof tasksTable.$inferSelect; approval?: Awaited<ReturnType<typeof createApproval>> }> {
  if (!input.taskId) return { status: "not_applicable" };
  const task = await getTaskById(input.taskId, input.organizationId);
  if (!task) return { status: "not_found" };
  if (task.currentState === "cancelled") return { status: "cancelled", task };
  if (task.currentState === "completed") return { status: "completed", task };

  const requirement = getApprovalRequirement(task);
  if (!requirement.required) return { status: "not_required", task };
  const approvalType = input.approvalType ?? requirement.approvalType;
  if (!approvalType) return { status: "not_required", task };

  const existing = await getPendingApprovalForTask({
    taskId: input.taskId,
    organizationId: input.organizationId,
    approvalType,
  });
  const approval = existing ?? await createApproval({
    taskId: input.taskId,
    organizationId: input.organizationId,
    approvalType,
    requestedByUserId: input.requestedByUserId,
    notes: input.notes ?? `Approval required before finalising task: ${task.title}`,
  });

  const [updated] = await db
    .update(tasksTable)
    .set({
      currentState: "awaiting_approval",
      approvalState: "pending_approval",
      metadata: mergeTaskMetadata(task.metadata, {
        approvalGate: {
          approvalId: approval.id,
          approvalType,
          completedWorkId: input.completedWorkId,
          completedWorkStatus: input.completedWorkStatus,
          correlationId: input.correlationId,
          requestedAt: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    })
    .where(and(
      eq(tasksTable.id, input.taskId),
      eq(tasksTable.organizationId, input.organizationId),
      inArray(tasksTable.currentState, ["approved", "executing", "failed", "planning"]),
    ))
    .returning();

  return { status: "pending_approval", task: updated ?? task, approval };
}

export async function reconcileTaskExecutionSuccess(input: {
  taskId?: string;
  organizationId: string;
  completedWorkId?: string;
  completedWorkStatus?: string;
  correlationId?: string;
  requestedByUserId?: string;
}): Promise<{ status: "completed" | "cancelled" | "awaiting_approval" | "not_applicable" | "not_found"; task?: typeof tasksTable.$inferSelect }> {
  if (!input.taskId) return { status: "not_applicable" };
  const task = await getTaskById(input.taskId, input.organizationId);
  if (!task) return { status: "not_found" };
  if (task.currentState === "cancelled") return { status: "cancelled", task };
  if (task.currentState === "completed") return { status: "completed", task };

  if (input.completedWorkStatus === "awaiting_approval" && getApprovalRequirement(task).required) {
    const approvalGate = await requestTaskApprovalGate({
      taskId: input.taskId,
      organizationId: input.organizationId,
      requestedByUserId: input.requestedByUserId,
      completedWorkId: input.completedWorkId,
      completedWorkStatus: input.completedWorkStatus,
      correlationId: input.correlationId,
    });
    if (approvalGate.status === "pending_approval") {
      return { status: "awaiting_approval", task: approvalGate.task };
    }
    if (approvalGate.status === "cancelled") return { status: "cancelled", task: approvalGate.task };
  }

  const [updated] = await db
    .update(tasksTable)
    .set({
      currentState: "completed",
      metadata: mergeTaskMetadata(task.metadata, {
        executionCompletion: {
          completedWorkId: input.completedWorkId,
          completedWorkStatus: input.completedWorkStatus,
          correlationId: input.correlationId,
          completedAt: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    })
    .where(and(
      eq(tasksTable.id, input.taskId),
      eq(tasksTable.organizationId, input.organizationId),
      inArray(tasksTable.currentState, ["approved", "executing", "failed"]),
    ))
    .returning();

  if (!updated) {
    const latest = await getTaskById(input.taskId, input.organizationId);
    return latest?.currentState === "cancelled"
      ? { status: "cancelled", task: latest }
      : { status: latest?.currentState === "completed" ? "completed" : "not_found", task: latest };
  }
  return { status: "completed", task: updated };
}

export async function reconcileTaskCompletedWorkApproval(input: {
  taskId?: string | null;
  organizationId: string;
  completedWorkId: string;
  completedWorkStatus: string;
  approvedByUserId: string;
}): Promise<{ status: "completed" | "cancelled" | "not_applicable" | "not_found" | "not_ready"; task?: typeof tasksTable.$inferSelect }> {
  if (!input.taskId) return { status: "not_applicable" };
  if (input.completedWorkStatus !== "approved") return { status: "not_ready" };

  const task = await getTaskById(input.taskId, input.organizationId);
  if (!task) return { status: "not_found" };
  if (task.currentState === "cancelled") return { status: "cancelled", task };
  if (task.currentState === "completed") return { status: "completed", task };

  const metadata = (task.metadata as Record<string, unknown> | null) ?? {};
  const approvalGate = metadata.approvalGate as Record<string, unknown> | undefined;
  const executionCompletion = metadata.executionCompletion as Record<string, unknown> | undefined;
  const linkedCompletedWorkId =
    typeof approvalGate?.completedWorkId === "string" ? approvalGate.completedWorkId
    : typeof executionCompletion?.completedWorkId === "string" ? executionCompletion.completedWorkId
    : null;
  if (linkedCompletedWorkId !== input.completedWorkId) return { status: "not_ready", task };

  const now = new Date();
  const [updated] = await db
    .update(tasksTable)
    .set({
      currentState: "completed",
      approvalState: "approved",
      metadata: mergeTaskMetadata(task.metadata, {
        completedWorkApproval: {
          completedWorkId: input.completedWorkId,
          approvedByUserId: input.approvedByUserId,
          approvedAt: now.toISOString(),
        },
        executionCompletion: {
          ...((executionCompletion as Record<string, unknown> | undefined) ?? {}),
          completedWorkId: input.completedWorkId,
          completedWorkStatus: input.completedWorkStatus,
          completedAt: now.toISOString(),
        },
      }),
      updatedAt: now,
    })
    .where(and(
      eq(tasksTable.id, input.taskId),
      eq(tasksTable.organizationId, input.organizationId),
      inArray(tasksTable.currentState, ["awaiting_approval", "approved", "executing", "failed"]),
    ))
    .returning();

  return updated ? { status: "completed", task: updated } : { status: "not_ready", task };
}

export async function reconcileTaskExecutionFailure(input: {
  taskId?: string;
  organizationId: string;
  errorMessage?: string;
  correlationId?: string;
}): Promise<{ status: "failed" | "cancelled" | "not_applicable" | "not_found"; task?: typeof tasksTable.$inferSelect }> {
  if (!input.taskId) return { status: "not_applicable" };
  const task = await getTaskById(input.taskId, input.organizationId);
  if (!task) return { status: "not_found" };
  if (task.currentState === "cancelled") return { status: "cancelled", task };

  const [updated] = await db
    .update(tasksTable)
    .set({
      currentState: "failed",
      metadata: mergeTaskMetadata(task.metadata, {
        executionFailure: {
          errorMessage: input.errorMessage,
          correlationId: input.correlationId,
          failedAt: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    })
    .where(and(
      eq(tasksTable.id, input.taskId),
      eq(tasksTable.organizationId, input.organizationId),
      inArray(tasksTable.currentState, ["approved", "executing", "queued", "planning", "awaiting_approval", "failed"]),
    ))
    .returning();

  if (!updated) {
    const latest = await getTaskById(input.taskId, input.organizationId);
    return latest?.currentState === "cancelled" ? { status: "cancelled", task: latest } : { status: "not_found", task: latest };
  }
  return { status: "failed", task: updated };
}

export async function recordTaskModification(input: {
  taskId: string;
  organizationId: string;
  actorUserId: string;
  changeRequest: string;
  conversationId?: string;
}): Promise<{ status: "modified" | "needs_revision_task"; task: typeof tasksTable.$inferSelect }> {
  const task = await getTaskById(input.taskId, input.organizationId);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "RESOURCE_NOT_FOUND" });
  if (TERMINAL_TASK_STATES.has(task.currentState as TaskState)) {
    return { status: "needs_revision_task", task };
  }

  const existingMetadata = (task.metadata as Record<string, unknown> | null) ?? {};
  const currentSpecification = task.description ?? task.title;
  const updatedSpecification = mergeTaskSpecification(currentSpecification, input.changeRequest);
  const refreshedPlan = planTask(task.title, updatedSpecification);
  const modifications = Array.isArray(existingMetadata.modificationRequests)
    ? existingMetadata.modificationRequests
    : [];
  const material = updatedSpecification !== currentSpecification || /date|range|participant|client|evidence|source|deliverable|scope|amount|funding|approval|blueprint|policy|report|letter/i.test(input.changeRequest);
  const nextMetadata = {
    ...existingMetadata,
    modificationRequests: [
      ...modifications,
      {
        requestedAt: new Date().toISOString(),
        requestedBy: input.actorUserId,
        conversationId: input.conversationId,
        changeRequest: input.changeRequest,
        previousSpecification: currentSpecification,
        updatedSpecification,
        material,
      },
    ],
    approvalInvalidatedByModification: material && (task.currentState === "awaiting_approval" || task.currentState === "approved"),
    latestModification: {
      updatedAt: new Date().toISOString(),
      updatedBy: input.actorUserId,
      material,
    },
  };

  if (material) {
    await supersedePendingApprovalsForTask({
      taskId: input.taskId,
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      reason: "Approval superseded by material task modification.",
    });
  }

  await db.insert(taskExecutionPlansTable).values({
    id: randomUUID(),
    taskId: input.taskId,
    organizationId: input.organizationId,
    planData: refreshedPlan as unknown as Record<string, unknown>,
    version: `revision-${modifications.length + 2}`,
  });

  const nextState: TaskState = task.currentState === "executing" ? "failed" : "planning";
  const [updated] = await db
    .update(tasksTable)
    .set({
      currentState: nextState,
      description: updatedSpecification,
      approvalState: refreshedPlan.requiresApproval ? "required" : "not_required",
      metadata: mergeTaskMetadata(nextMetadata, buildApprovalRequirement(refreshedPlan)),
      updatedAt: new Date(),
    })
    .where(and(eq(tasksTable.id, input.taskId), eq(tasksTable.organizationId, input.organizationId)))
    .returning();

  return { status: "modified", task: updated ?? task };
}

export async function getTaskPlan(
  taskId: string,
): Promise<(typeof taskExecutionPlansTable.$inferSelect) | undefined> {
  const [row] = await db
    .select()
    .from(taskExecutionPlansTable)
    .where(eq(taskExecutionPlansTable.taskId, taskId))
    .limit(1);
  return row;
}
