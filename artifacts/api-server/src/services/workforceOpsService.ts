/**
 * Workforce Operations Service — Sprint 26
 *
 * Powers the AI Workforce Operations Centre.
 * Aggregates from existing platform services and tables — no new schema.
 *
 * Endpoints consumed:
 *   • getWorkforceSummary      → Part 1: dashboard metrics
 *   • getSpecialistOpsProfile  → Part 2: specialist detail
 *   • getSpecialistReadiness   → Part 3: readiness blockers
 *   • getSpecialistWorkload    → Part 4: workload / queue
 *   • getSpecialistPerformance → Part 5: performance metrics
 *   • getSpecialistKnowledge   → Part 6: training & knowledge
 *   • getWorkforceAlerts       → Part 7: alerts panel
 *   • performSpecialistAction  → Part 8: management actions
 *   • getOrgWorkforceHealth    → Part 9: executive health summary
 */

import { db } from "@workspace/db";
import {
  specialistTrainingStatusTable,
  completedWorkTable,
  completedWorkVersionsTable,
  knowledgeSourcesTable,
  organisationSpecialistConfigTable,
  specialistRunsTable,
  specialistQueueTable,
  organisationMemoryTable,
  tasksTable,
} from "@workspace/db";
import {
  eq, and, desc, lt, gte, count, avg, inArray, sql,
} from "drizzle-orm";
import { randomUUID } from "crypto";
import { logOrgEvent } from "./auditService.js";
import { SPECIALISTS } from "../lib/workforceRegistry.js";
import { getCatalogueEntry, listCatalogue } from "./specialistCatalogueService.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ACTIONS = [
  "pause",
  "resume",
  "suspend",
  "enable",
  "force_retraining",
  "refresh_knowledge",
] as const;

export type SpecialistAction = (typeof VALID_ACTIONS)[number];

export class WorkforceOpsError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) { super(message); this.name = "WorkforceOpsError"; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Task #40: Returns SPECIALISTS merged with catalogue commercial fields.
 * Use this anywhere the registry is filtered for "active" specialists — it
 * ensures catalogue overrides (comingSoon, isArchived, executionStatus,
 * displayName, description) are authoritative rather than the seed values.
 */
async function getCatalogueAwareSpecialists(): Promise<Array<typeof SPECIALISTS[number] & {
  displayName: string;
  description: string;
  isArchived: boolean;
  comingSoon: boolean;
}>> {
  const { entries } = await listCatalogue({ includeArchived: true, includeDeprecated: true, limit: 500 })
    .catch(() => ({ entries: [] as any[] }));
  const catMap = new Map(entries.map((e: any) => [e.specialistCode, e]));
  return SPECIALISTS.map(s => {
    const cat = catMap.get(s.code) as any;
    return {
      ...s,
      displayName:     cat?.displayName     ?? s.displayName,
      description:     cat?.description     ?? s.description     ?? "",
      executionStatus: cat?.executionStatus ?? s.executionStatus,
      isArchived:      cat?.isArchived      ?? false,
      comingSoon:      cat?.comingSoon      ?? false,
    };
  });
}

function periodStart(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Map training status → operational display status */
function trainingToOpsStatus(ts: string | null): string {
  if (!ts || ts === "not_started") return "offline";
  if (ts === "suspended")          return "suspended";
  if (ts === "ready")              return "active";
  if (ts === "needs_attention")    return "training_required";
  if (ts === "review_required")    return "awaiting_approval";
  return "idle";
}

/** Coerce a potentially non-numeric value to a number or return the default. */
function toNum(v: unknown, def = 0): number {
  const n = Number(v);
  return isNaN(n) ? def : n;
}

// ─── Part 1 — Workforce Summary ──────────────────────────────────────────────

export interface WorkforceSummary {
  totalSpecialists: number;
  byStatus: {
    active: number;
    busy: number;
    idle: number;
    awaitingApproval: number;
    suspended: number;
    trainingRequired: number;
    offline: number;
  };
  averageQualityScore: number | null;
  averageConfidence: number | null;
  organisationReadinessScore: number;
  activeTaskCount: number;
  pendingApprovalsCount: number;
}

export async function getWorkforceSummary(
  organizationId: string,
): Promise<WorkforceSummary> {
  // Task #40: use catalogue-aware list so platform-overridden statuses (comingSoon,
  // isArchived, executionStatus) are authoritative rather than seed registry values.
  const allSpecs = await getCatalogueAwareSpecialists();
  const active = allSpecs.filter(
    s => s.executionStatus !== "deprecated" && !s.isArchived,
  );

  // Training status rows for this org (bounded to 500 — org cannot have more active specialists)
  const trainingRows = await db
    .select()
    .from(specialistTrainingStatusTable)
    .where(eq(specialistTrainingStatusTable.organizationId, organizationId))
    .limit(500);

  const statusMap = new Map(trainingRows.map(r => [r.specialistId, r.status]));

  const byStatus = { active: 0, busy: 0, idle: 0, awaitingApproval: 0, suspended: 0, trainingRequired: 0, offline: 0 };
  for (const s of active) {
    const ts = statusMap.get(s.code) ?? null;
    const ops = trainingToOpsStatus(ts);
    if (ops === "active")             byStatus.active++;
    else if (ops === "suspended")     byStatus.suspended++;
    else if (ops === "awaiting_approval") byStatus.awaitingApproval++;
    else if (ops === "training_required") byStatus.trainingRequired++;
    else if (ops === "offline")       byStatus.offline++;
    else                              byStatus.idle++;
  }

  // Active task count (non-terminal)
  const [taskRow] = await db
    .select({ n: count() })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.organizationId, organizationId),
        inArray(tasksTable.currentState, ["queued", "planning", "executing", "awaiting_approval"] as const),
      ),
    )
    .limit(1);

  // Pending approvals (completed work awaiting_approval)
  const [pendingRow] = await db
    .select({ n: count() })
    .from(completedWorkTable)
    .where(
      and(
        eq(completedWorkTable.organizationId, organizationId),
        eq(completedWorkTable.status, "awaiting_approval"),
      ),
    )
    .limit(1);

  // Average quality score from completed work versions
  const [qualityRow] = await db
    .select({ avg: avg(completedWorkVersionsTable.qualityScore) })
    .from(completedWorkVersionsTable)
    .where(eq(completedWorkVersionsTable.organizationId, organizationId))
    .limit(1);

  // Readiness score: % of active specialists at "ready" training status
  const readyCount = trainingRows.filter(r => r.status === "ready").length;
  const readinessScore = active.length > 0
    ? Math.round((readyCount / active.length) * 100)
    : 0;

  return {
    totalSpecialists: active.length,
    byStatus,
    averageQualityScore: qualityRow?.avg != null ? Math.round(toNum(qualityRow.avg)) : null,
    averageConfidence: null, // filled from specialist_runs when data exists
    organisationReadinessScore: readinessScore,
    activeTaskCount: toNum(taskRow?.n),
    pendingApprovalsCount: toNum(pendingRow?.n),
  };
}

// ─── Part 2 — Specialist Ops Profile ─────────────────────────────────────────

export interface SpecialistOpsProfile {
  code: string;
  title: string;
  descriptor: string;
  domain: string;
  department: string;
  dnaVersion: string;
  packCode: string;
  operationalStatus: string;
  trainingStatus: string | null;
  trainingRecord: {
    configurationComplete: boolean;
    knowledgeSourcesApproved: boolean;
    retrievalTestPassed: boolean;
    sampleTaskPassed: boolean;
    approvedAt: string | null;
    lastTestedAt: string | null;
    notes: string | null;
  } | null;
  orgConfig: {
    goals: string[];
    preferredStyle: string | null;
    escalationContacts: unknown[];
    lastConfirmedAt: string | null;
  } | null;
  recentWork: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
  }>;
  currentTasks: Array<{
    id: string;
    title: string;
    state: string;
    createdAt: string;
  }>;
  lastActivity: string | null;
}

export async function getSpecialistOpsProfile(
  organizationId: string,
  specialistCode: string,
): Promise<SpecialistOpsProfile> {
  const spec = SPECIALISTS.find(s => s.code === specialistCode);
  if (!spec) throw new WorkforceOpsError(404, "SPECIALIST_NOT_FOUND", `Specialist '${specialistCode}' not found.`);

  const [trainingRow] = await db
    .select()
    .from(specialistTrainingStatusTable)
    .where(
      and(
        eq(specialistTrainingStatusTable.organizationId, organizationId),
        eq(specialistTrainingStatusTable.specialistId, specialistCode),
      ),
    )
    .limit(1);

  const [configRow] = await db
    .select()
    .from(organisationSpecialistConfigTable)
    .where(
      and(
        eq(organisationSpecialistConfigTable.organizationId, organizationId),
        eq(organisationSpecialistConfigTable.specialistId, specialistCode),
      ),
    )
    .limit(1);

  const recentWork = await db
    .select({
      id: completedWorkTable.id,
      title: completedWorkTable.title,
      status: completedWorkTable.status,
      createdAt: completedWorkTable.createdAt,
    })
    .from(completedWorkTable)
    .where(
      and(
        eq(completedWorkTable.organizationId, organizationId),
        eq(completedWorkTable.primarySpecialist, specialistCode),
      ),
    )
    .orderBy(desc(completedWorkTable.createdAt))
    .limit(5);

  const currentTasks = await db
    .select({
      id: tasksTable.id,
      title: tasksTable.title,
      state: tasksTable.currentState,
      createdAt: tasksTable.createdAt,
    })
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.organizationId, organizationId),
        inArray(tasksTable.currentState, ["queued", "planning", "executing", "awaiting_approval"] as const),
      ),
    )
    .orderBy(desc(tasksTable.createdAt))
    .limit(5);

  const trainingStatus = trainingRow?.status ?? null;
  const operationalStatus = trainingToOpsStatus(trainingStatus);

  // Last activity: most recent completed work createdAt
  const lastActivity = recentWork[0]?.createdAt?.toISOString() ?? null;

  // Task #40: overlay catalogue commercial fields (displayName, description) so
  // platform-managed display names are authoritative over registry seed values.
  const cat = await getCatalogueEntry(specialistCode).catch(() => null);

  return {
    code: spec.code,
    title: cat?.displayName ?? spec.displayName,
    descriptor: cat?.description ?? spec.description ?? "",
    domain: spec.departmentCode ?? "",
    department: spec.departmentCode ?? "—",
    dnaVersion: spec.version ?? "1.0.0",
    packCode: spec.packCode ?? "core",
    operationalStatus,
    trainingStatus,
    trainingRecord: trainingRow ? {
      configurationComplete: trainingRow.configurationComplete,
      knowledgeSourcesApproved: trainingRow.knowledgeSourcesApproved,
      retrievalTestPassed: trainingRow.retrievalTestPassed,
      sampleTaskPassed: trainingRow.sampleTaskPassed,
      approvedAt: trainingRow.approvedAt?.toISOString() ?? null,
      lastTestedAt: trainingRow.lastTestedAt?.toISOString() ?? null,
      notes: trainingRow.notes ?? null,
    } : null,
    orgConfig: configRow ? {
      goals: (configRow.goals as string[]) ?? [],
      preferredStyle: configRow.preferredStyle ?? null,
      escalationContacts: (configRow.escalationContacts as unknown[]) ?? [],
      lastConfirmedAt: configRow.lastConfirmedAt?.toISOString() ?? null,
    } : null,
    recentWork: recentWork.map(w => ({
      id: w.id,
      title: w.title,
      status: w.status,
      createdAt: w.createdAt.toISOString(),
    })),
    currentTasks: currentTasks.map(t => ({
      id: t.id,
      title: t.title,
      state: t.state,
      createdAt: t.createdAt.toISOString(),
    })),
    lastActivity,
  };
}

// ─── Part 3 — Readiness Analysis ─────────────────────────────────────────────

export type BlockerSeverity = "critical" | "high" | "medium" | "low";

export interface ReadinessBlocker {
  code: string;
  reason: string;
  severity: BlockerSeverity;
  recommendedAction: string;
  resolveUrl: string;
}

export interface SpecialistReadiness {
  specialistCode: string;
  isReady: boolean;
  readinessScore: number; // 0–100
  blockers: ReadinessBlocker[];
  lastReviewed: string | null;
}

export async function getSpecialistReadiness(
  organizationId: string,
  specialistCode: string,
  orgSlug: string,
): Promise<SpecialistReadiness> {
  const spec = SPECIALISTS.find(s => s.code === specialistCode);
  if (!spec) throw new WorkforceOpsError(404, "SPECIALIST_NOT_FOUND", `Specialist '${specialistCode}' not found.`);

  const [trainingRow] = await db
    .select()
    .from(specialistTrainingStatusTable)
    .where(
      and(
        eq(specialistTrainingStatusTable.organizationId, organizationId),
        eq(specialistTrainingStatusTable.specialistId, specialistCode),
      ),
    )
    .limit(1);

  const [configRow] = await db
    .select()
    .from(organisationSpecialistConfigTable)
    .where(
      and(
        eq(organisationSpecialistConfigTable.organizationId, organizationId),
        eq(organisationSpecialistConfigTable.specialistId, specialistCode),
      ),
    )
    .limit(1);

  // Knowledge sources scoped to this specialist
  const scopedSources = await db
    .select({ id: knowledgeSourcesTable.id, status: knowledgeSourcesTable.status })
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.organizationId, organizationId),
        eq(knowledgeSourcesTable.status, "approved"),
      ),
    )
    .limit(1);

  const blockers: ReadinessBlocker[] = [];

  // 1. Suspended by administrator
  if (trainingRow?.status === "suspended") {
    blockers.push({
      code: "SUSPENDED",
      reason: "This specialist has been suspended by an administrator.",
      severity: "critical",
      recommendedAction: "Review the suspension reason and enable the specialist when ready.",
      resolveUrl: `/app/${orgSlug}/workforce-ops/${specialistCode}`,
    });
  }

  // 2. Training not started
  if (!trainingRow || trainingRow.status === "not_started") {
    blockers.push({
      code: "TRAINING_NOT_STARTED",
      reason: "Training has not been started for this specialist.",
      severity: "critical",
      recommendedAction: "Begin specialist training to configure knowledge and goals.",
      resolveUrl: `/app/${orgSlug}/workforce/${specialistCode}/training`,
    });
  }

  // 3. Configuration not complete
  if (trainingRow && !trainingRow.configurationComplete) {
    blockers.push({
      code: "CONFIGURATION_INCOMPLETE",
      reason: "Specialist configuration (goals, tone, escalation contacts) is incomplete.",
      severity: "high",
      recommendedAction: "Complete the specialist configuration in the Training section.",
      resolveUrl: `/app/${orgSlug}/workforce/${specialistCode}/training`,
    });
  }

  // 4. No approved knowledge sources
  if (trainingRow && !trainingRow.knowledgeSourcesApproved) {
    blockers.push({
      code: "NO_APPROVED_KNOWLEDGE",
      reason: "No approved knowledge sources are assigned to this specialist.",
      severity: "high",
      recommendedAction: "Upload and approve knowledge documents in the Organisation Library.",
      resolveUrl: `/app/${orgSlug}/library`,
    });
  }

  // 5. Retrieval test not passed
  if (trainingRow && trainingRow.configurationComplete && trainingRow.knowledgeSourcesApproved && !trainingRow.retrievalTestPassed) {
    blockers.push({
      code: "RETRIEVAL_TEST_PENDING",
      reason: "Knowledge retrieval has not been tested for this specialist.",
      severity: "medium",
      recommendedAction: "Run a retrieval test from the Specialist Training page.",
      resolveUrl: `/app/${orgSlug}/workforce/${specialistCode}/training`,
    });
  }

  // 6. Missing organisation configuration
  if (!configRow) {
    blockers.push({
      code: "MISSING_ORG_CONFIG",
      reason: "No organisation-specific configuration has been set for this specialist.",
      severity: "medium",
      recommendedAction: "Configure goals and context for this specialist.",
      resolveUrl: `/app/${orgSlug}/workforce/${specialistCode}/training`,
    });
  }

  // 7. Needs attention
  if (trainingRow?.status === "needs_attention") {
    blockers.push({
      code: "NEEDS_ATTENTION",
      reason: trainingRow.notes ?? "A regression or issue was detected. Specialist review is required.",
      severity: "high",
      recommendedAction: "Review the specialist's training notes and re-run tests.",
      resolveUrl: `/app/${orgSlug}/workforce/${specialistCode}/training`,
    });
  }

  const isReady = trainingRow?.status === "ready" && blockers.length === 0;

  // Readiness score based on checklist completion
  const checks = [
    !!trainingRow,
    trainingRow?.configurationComplete === true,
    trainingRow?.knowledgeSourcesApproved === true,
    trainingRow?.retrievalTestPassed === true,
    trainingRow?.sampleTaskPassed === true,
    !!configRow,
  ];
  const readinessScore = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  return {
    specialistCode,
    isReady,
    readinessScore,
    blockers,
    lastReviewed: trainingRow?.lastTestedAt?.toISOString() ?? null,
  };
}

// ─── Part 4 — Workload & Queue ────────────────────────────────────────────────

export interface WorkloadQueue {
  activeRuns: Array<{
    id: string;
    taskId: string;
    status: string;
    startedAt: string | null;
    confidence: string | null;
  }>;
  waitingQueue: Array<{
    id: string;
    runId: string;
    status: string;
    priority: number;
    queuedAt: string;
  }>;
  recentCompleted: Array<{
    id: string;
    title: string;
    status: string;
    createdAt: string;
  }>;
  failedRuns: Array<{
    id: string;
    taskId: string;
    lastError: string | null;
    failedAt: string | null;
  }>;
  averageExecutionMs: number | null;
  queueLength: number;
  totalRetries: number;
}

export async function getSpecialistWorkload(
  organizationId: string,
  specialistCode: string,
): Promise<WorkloadQueue> {
  const [activeRuns, waitingQueue, recentCompleted, failedRuns, retryRow] = await Promise.all([
    // Active runs
    db.select({
      id: specialistRunsTable.id,
      taskId: specialistRunsTable.taskId,
      status: specialistRunsTable.status,
      startedAt: specialistRunsTable.startedAt,
      confidence: specialistRunsTable.confidence,
    })
      .from(specialistRunsTable)
      .where(
        and(
          eq(specialistRunsTable.organizationId, organizationId),
          eq(specialistRunsTable.workforceRoleCode, specialistCode),
          inArray(specialistRunsTable.status, ["created", "running", "claimed"] as const),
        ),
      )
      .orderBy(desc(specialistRunsTable.startedAt))
      .limit(10),

    // Waiting queue
    db.select({
      id: specialistQueueTable.id,
      runId: specialistQueueTable.specialistRunId,
      status: specialistQueueTable.status,
      priority: specialistQueueTable.priority,
      queuedAt: specialistQueueTable.createdAt,
    })
      .from(specialistQueueTable)
      .where(
        and(
          eq(specialistQueueTable.organizationId, organizationId),
          inArray(specialistQueueTable.status, ["waiting", "blocked"] as const),
        ),
      )
      .orderBy(specialistQueueTable.priority, desc(specialistQueueTable.createdAt))
      .limit(10),

    // Recently completed work
    db.select({
      id: completedWorkTable.id,
      title: completedWorkTable.title,
      status: completedWorkTable.status,
      createdAt: completedWorkTable.createdAt,
    })
      .from(completedWorkTable)
      .where(
        and(
          eq(completedWorkTable.organizationId, organizationId),
          eq(completedWorkTable.primarySpecialist, specialistCode),
          inArray(completedWorkTable.status, ["approved", "awaiting_approval"] as const),
        ),
      )
      .orderBy(desc(completedWorkTable.createdAt))
      .limit(10),

    // Failed runs
    db.select({
      id: specialistRunsTable.id,
      taskId: specialistRunsTable.taskId,
      lastError: specialistRunsTable.lastError,
      failedAt: specialistRunsTable.failedAt,
    })
      .from(specialistRunsTable)
      .where(
        and(
          eq(specialistRunsTable.organizationId, organizationId),
          eq(specialistRunsTable.workforceRoleCode, specialistCode),
          eq(specialistRunsTable.status, "failed"),
        ),
      )
      .orderBy(desc(specialistRunsTable.failedAt))
      .limit(5),

    // Total retries
    db.select({ total: sql<number>`SUM(${specialistRunsTable.attemptNumber} - 1)` })
      .from(specialistRunsTable)
      .where(
        and(
          eq(specialistRunsTable.organizationId, organizationId),
          eq(specialistRunsTable.workforceRoleCode, specialistCode),
        ),
      )
      .limit(1),
  ]);

  return {
    activeRuns: activeRuns.map(r => ({
      id: r.id,
      taskId: r.taskId,
      status: r.status,
      startedAt: r.startedAt?.toISOString() ?? null,
      confidence: r.confidence ?? null,
    })),
    waitingQueue: waitingQueue.map(q => ({
      id: q.id,
      runId: q.runId,
      status: q.status,
      priority: q.priority,
      queuedAt: q.queuedAt.toISOString(),
    })),
    recentCompleted: recentCompleted.map(w => ({
      id: w.id,
      title: w.title,
      status: w.status,
      createdAt: w.createdAt.toISOString(),
    })),
    failedRuns: failedRuns.map(r => ({
      id: r.id,
      taskId: r.taskId,
      lastError: r.lastError ?? null,
      failedAt: r.failedAt?.toISOString() ?? null,
    })),
    averageExecutionMs: null, // no duration column yet
    queueLength: waitingQueue.length,
    totalRetries: toNum(retryRow?.[0]?.total),
  };
}

// ─── Part 5 — Performance ─────────────────────────────────────────────────────

export interface SpecialistPerformance {
  period: 7 | 30 | 90;
  workCompleted: number;
  approvalRate: number | null;
  rejectionRate: number | null;
  averageSelfReviewScore: number | null;
  averageConfidence: number | null;
  knowledgeUtilisation: number | null; // % of work citing knowledge
  averageTurnaroundHours: number | null;
}

export async function getSpecialistPerformance(
  organizationId: string,
  specialistCode: string,
  period: 7 | 30 | 90 = 30,
): Promise<SpecialistPerformance> {
  const since = periodStart(period);

  const [workRows, [qualityRow], [confidenceRow]] = await Promise.all([
    db.select({
      status: completedWorkTable.status,
    })
      .from(completedWorkTable)
      .where(
        and(
          eq(completedWorkTable.organizationId, organizationId),
          eq(completedWorkTable.primarySpecialist, specialistCode),
          gte(completedWorkTable.createdAt, since),
        ),
      )
      .limit(500),

    db.select({ avg: avg(completedWorkVersionsTable.qualityScore) })
      .from(completedWorkVersionsTable)
      .where(
        and(
          eq(completedWorkVersionsTable.organizationId, organizationId),
          gte(completedWorkVersionsTable.createdAt, since),
        ),
      )
      .limit(1),

    db.select({ avg: avg(specialistRunsTable.confidence) })
      .from(specialistRunsTable)
      .where(
        and(
          eq(specialistRunsTable.organizationId, organizationId),
          eq(specialistRunsTable.workforceRoleCode, specialistCode),
          gte(specialistRunsTable.completedAt, since),
        ),
      )
      .limit(1),
  ]);

  const total = workRows.length;
  const approved = workRows.filter(w => w.status === "approved").length;
  const rejected = workRows.filter(w => w.status === "rejected").length;

  return {
    period,
    workCompleted: total,
    approvalRate: total > 0 ? Math.round((approved / total) * 100) : null,
    rejectionRate: total > 0 ? Math.round((rejected / total) * 100) : null,
    averageSelfReviewScore: qualityRow?.avg != null ? Math.round(toNum(qualityRow.avg)) : null,
    averageConfidence: confidenceRow?.avg != null ? Math.round(toNum(confidenceRow.avg) * 100) : null,
    knowledgeUtilisation: null,
    averageTurnaroundHours: null,
  };
}

// ─── Part 6 — Knowledge & Training ───────────────────────────────────────────

export interface SpecialistKnowledge {
  assignedSources: Array<{
    id: string;
    title: string;
    sourceType: string;
    status: string;
    approvedAt: string | null;
  }>;
  pendingSourceCount: number;
  trainingStatus: string | null;
  lastRetrained: string | null;
  knowledgeHealthSummary: {
    approved: number;
    pending: number;
    needsReview: number;
    total: number;
  };
  memoryCount: number;
}

export async function getSpecialistKnowledge(
  organizationId: string,
  specialistCode: string,
): Promise<SpecialistKnowledge> {
  const [sources, trainingRow, memoryRow] = await Promise.all([
    db.select({
      id: knowledgeSourcesTable.id,
      title: knowledgeSourcesTable.title,
      sourceType: knowledgeSourcesTable.sourceType,
      status: knowledgeSourcesTable.status,
      approvedAt: knowledgeSourcesTable.approvedAt,
    })
      .from(knowledgeSourcesTable)
      .where(eq(knowledgeSourcesTable.organizationId, organizationId))
      .orderBy(desc(knowledgeSourcesTable.createdAt))
      .limit(20),

    db.select()
      .from(specialistTrainingStatusTable)
      .where(
        and(
          eq(specialistTrainingStatusTable.organizationId, organizationId),
          eq(specialistTrainingStatusTable.specialistId, specialistCode),
        ),
      )
      .limit(1),

    db.select({ n: count() })
      .from(organisationMemoryTable)
      .where(eq(organisationMemoryTable.organizationId, organizationId))
      .limit(1),
  ]);

  const approved = sources.filter(s => s.status === "approved").length;
  const pending  = sources.filter(s => s.status === "pending_review").length;
  const needsReview = sources.filter(s => s.status === "needs_review").length;

  const ts = trainingRow[0] ?? null;

  return {
    assignedSources: sources.slice(0, 10).map(s => ({
      id: s.id,
      title: s.title,
      sourceType: s.sourceType,
      status: s.status,
      approvedAt: s.approvedAt?.toISOString() ?? null,
    })),
    pendingSourceCount: pending,
    trainingStatus: ts?.status ?? null,
    lastRetrained: ts?.lastTestedAt?.toISOString() ?? null,
    knowledgeHealthSummary: {
      approved,
      pending,
      needsReview,
      total: sources.length,
    },
    memoryCount: toNum(memoryRow?.[0]?.n),
  };
}

// ─── Part 7 — Alerts ─────────────────────────────────────────────────────────

export type AlertSeverity = "critical" | "high" | "medium" | "low";

export interface WorkforceAlert {
  id: string;
  specialistCode: string | null;
  specialistTitle: string | null;
  type: string;
  title: string;
  detail: string;
  severity: AlertSeverity;
  createdAt: string;
  acknowledged: boolean;
}

export async function getWorkforceAlerts(
  organizationId: string,
): Promise<WorkforceAlert[]> {
  const alerts: WorkforceAlert[] = [];

  // Task #40: catalogue-aware so archived/overridden specialists are excluded correctly.
  const allCatalogueSpecs = await getCatalogueAwareSpecialists();
  const activeSpecs = allCatalogueSpecs.filter(
    s => s.executionStatus !== "deprecated" && !s.isArchived,
  );

  const [trainingRows, failedRuns, pendingApprovals] = await Promise.all([
    db.select()
      .from(specialistTrainingStatusTable)
      .where(eq(specialistTrainingStatusTable.organizationId, organizationId))
      .limit(500),

    db.select({
      id: specialistRunsTable.id,
      workforceRoleCode: specialistRunsTable.workforceRoleCode,
      lastError: specialistRunsTable.lastError,
      failedAt: specialistRunsTable.failedAt,
    })
      .from(specialistRunsTable)
      .where(
        and(
          eq(specialistRunsTable.organizationId, organizationId),
          eq(specialistRunsTable.status, "failed"),
          gte(specialistRunsTable.failedAt, periodStart(7)),
        ),
      )
      .orderBy(desc(specialistRunsTable.failedAt))
      .limit(10),

    db.select({ n: count() })
      .from(completedWorkTable)
      .where(
        and(
          eq(completedWorkTable.organizationId, organizationId),
          eq(completedWorkTable.status, "awaiting_approval"),
        ),
      )
      .limit(1),
  ]);

  const trainingMap = new Map(trainingRows.map(r => [r.specialistId, r]));

  // Suspended specialists
  for (const tr of trainingRows.filter(r => r.status === "suspended")) {
    const spec = activeSpecs.find(s => s.code === tr.specialistId);
    alerts.push({
      id: `alert-suspended-${tr.specialistId}`,
      specialistCode: tr.specialistId,
      specialistTitle: spec?.displayName ?? tr.specialistId,
      type: "specialist_suspended",
      title: "Specialist Suspended",
      detail: tr.notes ?? "This specialist has been suspended by an administrator.",
      severity: "critical",
      createdAt: tr.updatedAt.toISOString(),
      acknowledged: false,
    });
  }

  // Needs attention
  for (const tr of trainingRows.filter(r => r.status === "needs_attention")) {
    const spec = activeSpecs.find(s => s.code === tr.specialistId);
    alerts.push({
      id: `alert-attention-${tr.specialistId}`,
      specialistCode: tr.specialistId,
      specialistTitle: spec?.displayName ?? tr.specialistId,
      type: "retraining_required",
      title: "Retraining Required",
      detail: tr.notes ?? "A regression was detected. Retraining is recommended.",
      severity: "high",
      createdAt: tr.updatedAt.toISOString(),
      acknowledged: false,
    });
  }

  // Failed executions
  for (const run of failedRuns) {
    const spec = activeSpecs.find(s => s.code === run.workforceRoleCode);
    alerts.push({
      id: `alert-failed-${run.id}`,
      specialistCode: run.workforceRoleCode,
      specialistTitle: spec?.displayName ?? run.workforceRoleCode,
      type: "failed_execution",
      title: "Execution Failed",
      detail: run.lastError ?? "A specialist run failed without a recorded error.",
      severity: "high",
      createdAt: run.failedAt?.toISOString() ?? new Date().toISOString(),
      acknowledged: false,
    });
  }

  // Specialists with no training started
  for (const spec of activeSpecs) {
    if (!trainingMap.has(spec.code)) {
      alerts.push({
        id: `alert-no-training-${spec.code}`,
        specialistCode: spec.code,
        specialistTitle: spec.displayName,
        type: "retraining_required",
        title: "Training Not Started",
        detail: `${spec.displayName} has no training record. Begin training to activate this specialist.`,
        severity: "medium",
        createdAt: new Date().toISOString(),
        acknowledged: false,
      });
    }
  }

  // Pending approvals
  const pendingCount = toNum(pendingApprovals?.[0]?.n);
  if (pendingCount > 0) {
    alerts.push({
      id: "alert-pending-approvals",
      specialistCode: null,
      specialistTitle: null,
      type: "pending_approvals",
      title: `${pendingCount} Work Item${pendingCount > 1 ? "s" : ""} Awaiting Approval`,
      detail: `${pendingCount} completed work item${pendingCount > 1 ? "s require" : " requires"} your review and approval.`,
      severity: "medium",
      createdAt: new Date().toISOString(),
      acknowledged: false,
    });
  }

  // Sort: critical → high → medium → low
  const order: AlertSeverity[] = ["critical", "high", "medium", "low"];
  alerts.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));

  return alerts;
}

// ─── Part 8 — Management Actions ─────────────────────────────────────────────

export interface ActionResult {
  success: boolean;
  action: SpecialistAction;
  specialistCode: string;
  message: string;
  auditId: string;
  performedAt: string;
}

export async function performSpecialistAction(
  organizationId: string,
  specialistCode: string,
  action: string,
  userId: string,
  orgSlug: string,
): Promise<ActionResult> {
  if (!VALID_ACTIONS.includes(action as SpecialistAction)) {
    throw new WorkforceOpsError(400, "INVALID_ACTION", `'${action}' is not a valid specialist action.`);
  }

  const spec = SPECIALISTS.find(s => s.code === specialistCode);
  if (!spec) throw new WorkforceOpsError(404, "SPECIALIST_NOT_FOUND", `Specialist '${specialistCode}' not found.`);

  const [trainingRow] = await db
    .select()
    .from(specialistTrainingStatusTable)
    .where(
      and(
        eq(specialistTrainingStatusTable.organizationId, organizationId),
        eq(specialistTrainingStatusTable.specialistId, specialistCode),
      ),
    )
    .limit(1);

  // Map action → target training status
  const statusMap: Record<SpecialistAction, string | null> = {
    pause:            "needs_attention",
    resume:           "ready",
    suspend:          "suspended",
    enable:           trainingRow?.configurationComplete ? "ready" : "configuring",
    force_retraining: "needs_attention",
    refresh_knowledge: null, // no status change — just audit
  };

  const targetStatus = statusMap[action as SpecialistAction];

  if (targetStatus !== null && trainingRow) {
    await db
      .update(specialistTrainingStatusTable)
      .set({
        status: targetStatus,
        notes: `Status changed to '${targetStatus}' via management action '${action}' by ${userId}.`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(specialistTrainingStatusTable.organizationId, organizationId),
          eq(specialistTrainingStatusTable.specialistId, specialistCode),
        ),
      );
  } else if (targetStatus !== null && !trainingRow) {
    // Create training record with the new status
    await db
      .insert(specialistTrainingStatusTable)
      .values({
        id: randomUUID(),
        organizationId,
        specialistId: specialistCode,
        status: targetStatus,
        notes: `Initialised via management action '${action}' by ${userId}.`,
        configurationComplete: false,
        knowledgeSourcesApproved: false,
        retrievalTestPassed: false,
        sampleTaskPassed: false,
      });
  }

  const auditId = randomUUID();
  await logOrgEvent({
    eventType: "specialist.assigned", // closest available type for a management action
    organizationId,
    actorUserId: userId,
    actorType: "user",
    resourceType: "specialist",
    resourceId: specialistCode,
    metadata: { specialistCode, action, targetStatus, performedBy: userId, auditId },
  });

  // Task #40: use catalogue displayName so platform-managed names appear in messages.
  const specCat = await getCatalogueEntry(specialistCode).catch(() => null);
  const specName = specCat?.displayName ?? spec.displayName;

  const messages: Record<SpecialistAction, string> = {
    pause:            `${specName} has been paused.`,
    resume:           `${specName} has been resumed.`,
    suspend:          `${specName} has been suspended.`,
    enable:           `${specName} has been enabled.`,
    force_retraining: `Retraining has been triggered for ${specName}.`,
    refresh_knowledge: `Knowledge refresh has been initiated for ${specName}.`,
  };

  return {
    success: true,
    action: action as SpecialistAction,
    specialistCode,
    message: messages[action as SpecialistAction],
    auditId,
    performedAt: new Date().toISOString(),
  };
}

// ─── Part 9 — Org Workforce Health ───────────────────────────────────────────

export interface OrgWorkforceHealth {
  workforceReadinessScore: number;
  averageQuality: number | null;
  knowledgeCoverage: number; // % of active specialists with approved knowledge
  trainingCompletion: number; // % of active specialists at 'ready'
  activeWorkload: number;
  outstandingApprovals: number;
  recommendations: Array<{
    priority: "high" | "medium" | "low";
    title: string;
    detail: string;
    actionUrl: string;
  }>;
  generatedAt: string;
}

export async function getOrgWorkforceHealth(
  organizationId: string,
  orgSlug: string,
): Promise<OrgWorkforceHealth> {
  // Task #40: catalogue-aware so platform-overridden statuses are authoritative.
  const allCatalogueSpecs = await getCatalogueAwareSpecialists();
  const activeSpecs = allCatalogueSpecs.filter(
    s => s.executionStatus !== "deprecated" && !s.isArchived,
  );

  const [trainingRows, qualityRow, taskRow, pendingRow] = await Promise.all([
    db.select()
      .from(specialistTrainingStatusTable)
      .where(eq(specialistTrainingStatusTable.organizationId, organizationId))
      .limit(500),

    db.select({ avg: avg(completedWorkVersionsTable.qualityScore) })
      .from(completedWorkVersionsTable)
      .where(eq(completedWorkVersionsTable.organizationId, organizationId))
      .limit(1),

    db.select({ n: count() })
      .from(tasksTable)
      .where(
        and(
          eq(tasksTable.organizationId, organizationId),
          inArray(tasksTable.currentState, ["executing", "planning", "queued"] as const),
        ),
      )
      .limit(1),

    db.select({ n: count() })
      .from(completedWorkTable)
      .where(
        and(
          eq(completedWorkTable.organizationId, organizationId),
          eq(completedWorkTable.status, "awaiting_approval"),
        ),
      )
      .limit(1),
  ]);

  const readyCount        = trainingRows.filter(r => r.status === "ready").length;
  const withKnowledge     = trainingRows.filter(r => r.knowledgeSourcesApproved).length;
  const trainingCompletion = activeSpecs.length > 0 ? Math.round((readyCount / activeSpecs.length) * 100) : 0;
  const knowledgeCoverage  = activeSpecs.length > 0 ? Math.round((withKnowledge / activeSpecs.length) * 100) : 0;

  const readinessScore = Math.round((trainingCompletion + knowledgeCoverage) / 2);
  const avgQuality = qualityRow?.[0]?.avg != null ? Math.round(toNum(qualityRow[0].avg)) : null;
  const activeWorkload = toNum(taskRow?.[0]?.n);
  const outstandingApprovals = toNum(pendingRow?.[0]?.n);

  // Recommendations derived purely from platform data
  const recommendations: OrgWorkforceHealth["recommendations"] = [];

  if (trainingCompletion < 50) {
    recommendations.push({
      priority: "high",
      title: "Activate your AI Workforce",
      detail: `Only ${trainingCompletion}% of your specialists are ready for work. Complete training to unlock full operational capacity.`,
      actionUrl: `/app/${orgSlug}/workforce`,
    });
  }

  if (knowledgeCoverage < 60) {
    recommendations.push({
      priority: "high",
      title: "Expand Knowledge Coverage",
      detail: `${knowledgeCoverage}% of specialists have approved knowledge. Upload and approve organisation documents to improve specialist quality.`,
      actionUrl: `/app/${orgSlug}/library`,
    });
  }

  if (outstandingApprovals > 0) {
    recommendations.push({
      priority: "medium",
      title: `Review ${outstandingApprovals} Pending Work Item${outstandingApprovals > 1 ? "s" : ""}`,
      detail: "Completed work is awaiting your review. Approve or provide feedback to keep your workforce moving.",
      actionUrl: `/app/${orgSlug}/work`,
    });
  }

  if (avgQuality !== null && avgQuality < 70) {
    recommendations.push({
      priority: "medium",
      title: "Quality Improvement Opportunity",
      detail: `Average work quality is ${avgQuality}/100. Review rejected items and consider additional knowledge sources.`,
      actionUrl: `/app/${orgSlug}/governance`,
    });
  }

  if (trainingRows.some(r => r.status === "needs_attention")) {
    recommendations.push({
      priority: "high",
      title: "Specialists Require Attention",
      detail: "One or more specialists have been flagged as needing retraining. Address these to maintain operational reliability.",
      actionUrl: `/app/${orgSlug}/workforce-ops`,
    });
  }

  return {
    workforceReadinessScore: readinessScore,
    averageQuality: avgQuality,
    knowledgeCoverage,
    trainingCompletion,
    activeWorkload,
    outstandingApprovals,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}
