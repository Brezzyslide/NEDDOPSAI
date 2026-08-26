/**
 * activeExecutionsService — Sprint 29M (Part D)
 *
 * Aggregates in-flight execution activity for an organisation across three
 * sources:
 *   1. tasks          — currentState in (queued|planning|awaiting_approval|evidence_required|executing)
 *   2. specialist_runs — status in (created|claimed|running|waiting_for_runtime)
 *   3. execution_intents — status = "dispatched"
 *
 * Amendment 5: this endpoint exists because no single existing canonical query
 * can return all three sources together with accurate in-flight semantics.
 */

import { db, tasksTable, specialistRunsTable, executionIntentsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActiveExecutionKind = "task" | "specialist_run" | "execution_intent";

export interface ActiveExecution {
  id:              string;
  kind:            ActiveExecutionKind;
  title:           string;
  status:          string;
  specialistCode?: string;
  taskId?:         string;
  startedAt?:      string | null;
  queuedAt?:       string | null;
  createdAt:       string;
}

export interface GetActiveExecutionsResult {
  activeExecutions: ActiveExecution[];
  totals: {
    tasks:           number;
    specialistRuns:  number;
    executionIntents: number;
  };
}

// ─── Active state constants ───────────────────────────────────────────────────

const ACTIVE_TASK_STATES = [
  "queued",
  "planning",
  "awaiting_approval",
  "evidence_required",
  "approved",
  "executing",
] as const;

const ACTIVE_RUN_STATUSES = [
  "created",
  "claimed",
  "running",
  "waiting_for_runtime",
] as const;

// ─── Service function ─────────────────────────────────────────────────────────

export async function getActiveExecutions(
  organizationId: string,
): Promise<GetActiveExecutionsResult> {
  // Run all three queries in parallel for minimum latency
  const [tasks, runs, intents] = await Promise.all([
    db
      .select({
        id:           tasksTable.id,
        title:        tasksTable.title,
        currentState: tasksTable.currentState,
        createdAt:    tasksTable.createdAt,
        updatedAt:    tasksTable.updatedAt,
      })
      .from(tasksTable)
      .where(and(
        eq(tasksTable.organizationId, organizationId),
        inArray(tasksTable.currentState, ACTIVE_TASK_STATES as unknown as string[]),
      )),

    db
      .select({
        id:                specialistRunsTable.id,
        taskId:            specialistRunsTable.taskId,
        workforceRoleCode: specialistRunsTable.workforceRoleCode,
        status:            specialistRunsTable.status,
        startedAt:         specialistRunsTable.startedAt,
        queuedAt:          specialistRunsTable.queuedAt,
        createdAt:         specialistRunsTable.createdAt,
      })
      .from(specialistRunsTable)
      .where(and(
        eq(specialistRunsTable.organizationId, organizationId),
        inArray(specialistRunsTable.status, ACTIVE_RUN_STATUSES as unknown as string[]),
      )),

    db
      .select({
        id:          executionIntentsTable.id,
        taskId:      executionIntentsTable.taskId,
        description: executionIntentsTable.description,
        status:      executionIntentsTable.status,
        createdAt:   executionIntentsTable.createdAt,
      })
      .from(executionIntentsTable)
      .where(and(
        eq(executionIntentsTable.organizationId, organizationId),
        eq(executionIntentsTable.status, "dispatched"),
      )),
  ]);

  const activeExecutions: ActiveExecution[] = [
    ...tasks.map(t => ({
      id:        t.id,
      kind:      "task" as const,
      title:     t.title,
      status:    t.currentState as string,
      createdAt: t.createdAt?.toISOString() ?? new Date().toISOString(),
    })),
    ...runs.map(r => ({
      id:             r.id,
      kind:           "specialist_run" as const,
      title:          `${(r.workforceRoleCode as string).replace(/_/g, " ")} run`,
      status:         r.status as string,
      specialistCode: r.workforceRoleCode as string,
      taskId:         r.taskId as string,
      startedAt:      r.startedAt ? (r.startedAt as Date).toISOString() : null,
      queuedAt:       r.queuedAt  ? (r.queuedAt as Date).toISOString()  : null,
      createdAt:      r.createdAt?.toISOString() ?? new Date().toISOString(),
    })),
    ...intents.map(i => ({
      id:        i.id,
      kind:      "execution_intent" as const,
      title:     i.description as string,
      status:    "dispatched",
      taskId:    i.taskId as string,
      createdAt: i.createdAt?.toISOString() ?? new Date().toISOString(),
    })),
  ];

  // Newest-first
  activeExecutions.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return {
    activeExecutions,
    totals: {
      tasks:            tasks.length,
      specialistRuns:   runs.length,
      executionIntents: intents.length,
    },
  };
}
