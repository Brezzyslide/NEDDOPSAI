/**
 * Task Service — Sprint 2
 *
 * CRUD + state machine for platform tasks.
 * Execution is simulated — no actual AI calls.
 */

import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskSpecialistsTable,
  taskExecutionPlansTable,
  type InsertTask,
} from "@workspace/db";
import { planTask, type TaskPlan } from "./chiefOfStaffService.js";
import type { TaskState, TaskPriority } from "@workspace/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateTaskInput {
  organizationId: string;
  originatingUserId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  originatingModule?: string;
}

export interface TaskWithPlan {
  task: typeof tasksTable.$inferSelect;
  plan: TaskPlan;
  specialists: (typeof taskSpecialistsTable.$inferSelect)[];
}

// ─── Valid state transitions ───────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<TaskState, TaskState[]> = {
  draft: ["queued", "cancelled"],
  queued: ["planning", "cancelled"],
  planning: ["awaiting_approval", "approved", "cancelled"],
  awaiting_approval: ["approved", "rejected" as unknown as TaskState, "cancelled", "failed"],
  approved: ["executing", "cancelled"],
  executing: ["completed", "failed", "cancelled"],
  completed: [],
  cancelled: [],
  failed: ["queued"],
};

export function isValidTransition(from: TaskState, to: TaskState): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function createTask(input: CreateTaskInput): Promise<TaskWithPlan> {
  const taskId = randomUUID();

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
    metadata: {},
  };

  const [task] = await db.insert(tasksTable).values(taskRow).returning();
  if (!task) throw new Error("Failed to create task");

  // Chief of Staff plans the task
  const plan = planTask(input.title, input.description);

  // Update approval state based on plan
  const approvalState = plan.requiresApproval ? plan.approvalType : "not_required";
  await db
    .update(tasksTable)
    .set({ currentState: "planning", approvalState, updatedAt: new Date() })
    .where(eq(tasksTable.id, taskId));

  // Persist execution plan
  await db.insert(taskExecutionPlansTable).values({
    id: randomUUID(),
    taskId,
    planData: plan as unknown as Record<string, unknown>,
    version: "1",
  });

  // Assign specialists
  const specialistRows = plan.assignedSpecialists.map(code => ({
    id: randomUUID(),
    taskId,
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

  // Move to awaiting_approval or approved
  const nextState: TaskState = plan.requiresApproval ? "awaiting_approval" : "approved";
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
