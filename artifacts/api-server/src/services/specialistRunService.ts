/**
 * Specialist Run Service — Sprint 9.5
 *
 * CRUD and state machine for specialist_runs table.
 * All operations are scoped to organisation_id for tenant isolation.
 */

import { randomUUID } from "crypto";
import { eq, and, desc, inArray } from "drizzle-orm";
import { db, specialistRunsTable, withSystemTenantContext } from "@workspace/db";
import { logOrgEvent } from "./auditService.js";
import type { SpecialistRunResult } from "./specialistIntelligenceService.js";

type DbClient = typeof db;

function withSpecialistRunTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "specialist_run_service", purpose },
    fn,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type SpecialistRunStatus =
  | "created" | "queued" | "preparing" | "running"
  | "awaiting_clarification" | "awaiting_approval"
  | "waiting_for_dependency" | "waiting_for_runtime"
  | "completed" | "failed" | "cancelled" | "expired";

// Valid state transitions
const VALID_TRANSITIONS: Record<SpecialistRunStatus, SpecialistRunStatus[]> = {
  created: ["queued", "cancelled"],
  queued: ["preparing", "cancelled"],
  preparing: ["running", "failed", "cancelled"],
  running: ["completed", "failed", "awaiting_clarification", "awaiting_approval", "waiting_for_runtime", "cancelled"],
  awaiting_clarification: ["queued", "cancelled"],
  awaiting_approval: ["queued", "cancelled"],
  waiting_for_dependency: ["queued", "cancelled"],
  waiting_for_runtime: ["running", "cancelled"],
  completed: [],
  failed: ["queued"],
  cancelled: [],
  expired: [],
};

export function isValidRunTransition(from: SpecialistRunStatus, to: SpecialistRunStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export interface CreateSpecialistRunInput {
  organizationId: string;
  conversationId?: string;
  taskId: string;
  executionPlanId?: string;
  executionStepId?: string;
  capabilityDecisionId?: string;
  specialistEligibilityDecisionId?: string;
  workforceRoleCode: string;
  workerProfileCode: string;
  specialistInstructionVersion: string;
  modelProvider?: string;
  modelName?: string;
  priority?: number;
  maximumAttempts?: number;
  approvalRequired?: boolean;
  externalExecutionRequired?: boolean;
  idempotencyKey: string;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createSpecialistRun(
  input: CreateSpecialistRunInput,
): Promise<typeof specialistRunsTable.$inferSelect> {
  // Check for existing run with the same idempotency key
  const existing = await withSpecialistRunTenant(input.organizationId, "specialist_run.create.dedupe", async (client) => client
    .select()
    .from(specialistRunsTable)
    .where(eq(specialistRunsTable.idempotencyKey, input.idempotencyKey))
    .limit(1));

  if (existing[0]) {
    return existing[0];
  }

  const id = randomUUID();
  const [run] = await withSpecialistRunTenant(input.organizationId, "specialist_run.create", async (client) => client
    .insert(specialistRunsTable)
    .values({
      id,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      executionPlanId: input.executionPlanId,
      executionStepId: input.executionStepId,
      capabilityDecisionId: input.capabilityDecisionId,
      specialistEligibilityDecisionId: input.specialistEligibilityDecisionId,
      workforceRoleCode: input.workforceRoleCode,
      workerProfileCode: input.workerProfileCode,
      specialistInstructionVersion: input.specialistInstructionVersion,
      modelProvider: input.modelProvider ?? "internal",
      modelName: input.modelName ?? "internal",
      status: "created",
      priority: input.priority ?? 5,
      maximumAttempts: input.maximumAttempts ?? 3,
      approvalRequired: input.approvalRequired ?? false,
      externalExecutionRequired: input.externalExecutionRequired ?? false,
      idempotencyKey: input.idempotencyKey,
    })
    .returning());

  if (!run) throw new Error("Failed to create specialist run");

  await logOrgEvent({
    eventType: "specialist.run_created",
    organizationId: input.organizationId,
    actorType: "system",
    resourceType: "specialist_run",
    resourceId: id,
    metadata: {
      workforceRoleCode: input.workforceRoleCode,
      taskId: input.taskId,
      capabilityCode: input.capabilityDecisionId,
    },
  });

  return run;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function getSpecialistRunById(
  runId: string,
  organizationId: string,
): Promise<typeof specialistRunsTable.$inferSelect | undefined> {
  const [row] = await withSpecialistRunTenant(organizationId, "specialist_run.get", async (client) => client
    .select()
    .from(specialistRunsTable)
    .where(and(eq(specialistRunsTable.id, runId), eq(specialistRunsTable.organizationId, organizationId)))
    .limit(1));
  return row;
}

export async function getRunsByTask(
  taskId: string,
  organizationId: string,
): Promise<(typeof specialistRunsTable.$inferSelect)[]> {
  return withSpecialistRunTenant(organizationId, "specialist_run.by_task", async (client) => client
    .select()
    .from(specialistRunsTable)
    .where(and(eq(specialistRunsTable.taskId, taskId), eq(specialistRunsTable.organizationId, organizationId)))
    .orderBy(desc(specialistRunsTable.createdAt)));
}

export async function getRunsByStatus(
  organizationId: string,
  statuses: SpecialistRunStatus[],
): Promise<(typeof specialistRunsTable.$inferSelect)[]> {
  const rows = await withSpecialistRunTenant(organizationId, "specialist_run.by_status", async (client) => client
    .select()
    .from(specialistRunsTable)
    .where(eq(specialistRunsTable.organizationId, organizationId))
    .orderBy(desc(specialistRunsTable.createdAt))
    .limit(100));
  return rows.filter(r => statuses.includes(r.status as SpecialistRunStatus));
}

// ─── State transitions ─────────────────────────────────────────────────────────

export async function transitionRunStatus(
  runId: string,
  organizationId: string,
  to: SpecialistRunStatus,
  extra?: Partial<typeof specialistRunsTable.$inferInsert>,
): Promise<typeof specialistRunsTable.$inferSelect> {
  const run = await getSpecialistRunById(runId, organizationId);
  if (!run) throw Object.assign(new Error("Specialist run not found"), { code: "RESOURCE_NOT_FOUND" });

  const from = run.status as SpecialistRunStatus;
  if (!isValidRunTransition(from, to)) {
    throw Object.assign(
      new Error(`Cannot transition specialist run from "${from}" to "${to}"`),
      { code: "VALIDATION_ERROR" },
    );
  }

  const now = new Date();
  const timestampUpdates: Record<string, Date | null> = {};
  if (to === "queued") timestampUpdates.queuedAt = now;
  if (to === "running") timestampUpdates.startedAt = now;
  if (to === "completed") timestampUpdates.completedAt = now;
  if (to === "failed") timestampUpdates.failedAt = now;
  if (to === "cancelled") timestampUpdates.cancelledAt = now;

  const [updated] = await withSpecialistRunTenant(organizationId, "specialist_run.transition", async (client) => client
    .update(specialistRunsTable)
    .set({ status: to, ...timestampUpdates, ...extra, updatedAt: now })
    .where(and(eq(specialistRunsTable.id, runId), eq(specialistRunsTable.organizationId, organizationId)))
    .returning());

  if (!updated) throw new Error("Failed to update specialist run status");
  return updated;
}

// ─── Result persistence ────────────────────────────────────────────────────────

export async function saveRunResult(
  runId: string,
  organizationId: string,
  result: SpecialistRunResult,
): Promise<typeof specialistRunsTable.$inferSelect> {
  const now = new Date();
  const [updated] = await withSpecialistRunTenant(organizationId, "specialist_run.result.save", async (client) => client
    .update(specialistRunsTable)
    .set({
      resultSummary: result.summary.slice(0, 2000),
      resultData: JSON.stringify(result),
      confidence: result.confidence.toString(),
      modelProvider: result.modelProvider,
      modelName: result.modelName,
      clarificationRequired: result.unresolvedQuestions.some(q => q.blocking),
      updatedAt: now,
    })
    .where(and(eq(specialistRunsTable.id, runId), eq(specialistRunsTable.organizationId, organizationId)))
    .returning());

  if (!updated) throw new Error("Failed to save run result");
  return updated;
}

// ─── Increment attempt counter ─────────────────────────────────────────────────

export async function incrementAttemptNumber(
  runId: string,
  organizationId: string,
): Promise<number> {
  const run = await getSpecialistRunById(runId, organizationId);
  if (!run) throw new Error("Specialist run not found");
  const nextAttempt = run.attemptNumber + 1;
  await withSpecialistRunTenant(organizationId, "specialist_run.attempt.increment", async (client) => client
    .update(specialistRunsTable)
    .set({ attemptNumber: nextAttempt, updatedAt: new Date() })
    .where(and(eq(specialistRunsTable.id, runId), eq(specialistRunsTable.organizationId, organizationId))));
  return nextAttempt;
}
