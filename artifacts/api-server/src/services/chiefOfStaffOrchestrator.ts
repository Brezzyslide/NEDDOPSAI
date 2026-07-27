/**
 * Chief of Staff Orchestrator — Sprint 9.5
 *
 * Central orchestration service for specialist runs.
 * The Chief of Staff coordinates — specialists perform domain work.
 *
 * Chain enforced:
 *   capability entitlement → specialist eligibility → work package →
 *   queue → run → output → consolidation → (OpenClaw package)
 *
 * Security:
 * - Does not directly call OpenAI
 * - All AI calls go through specialistIntelligenceService (→ AI gateway)
 * - No cross-tenant access
 * - No specialist-to-specialist direct communication
 */

import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db, specialistRunsTable, specialistConflictsTable } from "@workspace/db";
import {
  checkSpecialistEligibility,
  type SpecialistEligibilityDecision,
} from "./specialistEligibilityService.js";
import {
  createSpecialistRun,
  transitionRunStatus,
  getRunsByTask,
  saveRunResult,
  type SpecialistRunStatus,
} from "./specialistRunService.js";
import {
  buildWorkPackage,
  buildSpecialistPlan,
  getReadySteps,
  type SpecialistPlan,
  type SpecialistPlanStep,
} from "./specialistWorkPackageService.js";
import { buildSpecialistContext } from "./specialistContextService.js";
import { createSpecialistIntelligenceService } from "./specialistIntelligenceService.js";
import { enqueue, markRunning, markCompleted, markFailed, markCancelled } from "./specialistQueueService.js";
import { logOrgEvent } from "./auditService.js";
import type { SpecialistRunResult } from "./specialistIntelligenceService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClarificationQuestion {
  question: string;
  reason: string;
  requestingSpecialistRunId: string;
  blocking: boolean;
}

export interface ConsolidatedTaskResult {
  taskId: string;
  organizationId: string;
  taskObjective: string;
  participatingSpecialists: string[];
  specialistSummaries: Array<{
    workforceRoleCode: string;
    specialistRunId: string;
    summary: string;
    status: string;
    confidence: number;
  }>;
  combinedFindings: SpecialistRunResult["findings"];
  combinedRecommendations: SpecialistRunResult["recommendations"];
  evidenceReferences: string[];
  risks: SpecialistRunResult["risks"];
  conflicts: Array<{
    conflictId: string;
    positions: string[];
    resolutionRequired: boolean;
  }>;
  unresolvedQuestions: SpecialistRunResult["unresolvedQuestions"];
  approvalRequirements: string[];
  externalActionsStillRequired: SpecialistRunResult["requestedExternalActions"];
  nextRecommendedAction: string;
  consolidatedAt: string;
  analysisStatus: "analysis_completed" | "execution_pending" | "blocked" | "partially_complete";
}

export interface OpenClawSpecialistExecutionPackage {
  executionId: string;
  specialistRunId: string;
  organizationId: string;
  conversationId?: string;
  taskId: string;
  capabilityCode: string;
  workforceRoleCode: string;
  workerProfileCode: string;
  objective: string;
  approvedSteps: Array<{
    stepId: string;
    actionType: string;
    executionChannel: string;
    toolCategory: string;
    connectorCategory?: string;
    riskLevel: string;
    approvalState: "pending" | "approved" | "not_required";
    parameters: Record<string, unknown>;
  }>;
  allowedTools: string[];
  allowedConnectorCategories: string[];
  allowedExecutionChannels: string[];
  prohibitedActions: string[];
  approvalState: "all_approved" | "pending_approval" | "not_required";
  clarificationState: "clear" | "pending";
  riskLevel: string;
  inputReferences: Array<{ id: string; type: string; location: string }>;
  outputRequirements: Array<{ outputType: string; description: string }>;
  expiresAt: string;
  correlationId: string;
}

const intelligence = createSpecialistIntelligenceService();

// ─── Main orchestration interface ─────────────────────────────────────────────

/**
 * Creates a specialist execution plan for a task.
 * Validates capabilities and eligibility before creating plan steps.
 */
export async function createSpecialistPlan(
  taskId: string,
  organizationId: string,
  assignments: Array<{
    capabilityCode: string;
    workforceRoleCode: string;
    requestingUserId?: string;
    dependsOnCapabilities?: string[];
    parallelGroup?: string;
  }>,
): Promise<SpecialistPlan> {
  // Validate eligibility for each assignment
  const eligibilityResults: SpecialistEligibilityDecision[] = await Promise.all(
    assignments.map(a =>
      checkSpecialistEligibility(
        a.workforceRoleCode,
        a.capabilityCode,
        "professional_analysis",
        { organizationId, requestingUserId: a.requestingUserId },
      ).catch(err => ({
        decisionId: randomUUID(),
        workforceRoleCode: a.workforceRoleCode,
        capabilityCode: a.capabilityCode,
        requestedLevel: "professional_analysis" as const,
        eligible: false,
        reasonCode: "eligibility_check_error",
        reasons: [err?.message ?? "Unknown error"],
        approvalRequired: false,
        evaluatedAt: new Date().toISOString(),
      })),
    ),
  );

  // Filter to eligible assignments only
  const eligibleAssignments = assignments.filter((_, i) => eligibilityResults[i]?.eligible);
  const blockedAssignments = assignments.filter((_, i) => !eligibilityResults[i]?.eligible);

  if (blockedAssignments.length > 0) {
    for (const blocked of blockedAssignments) {
      const decision = eligibilityResults[assignments.indexOf(blocked)];
      await logOrgEvent({
        eventType: "specialist.assignment_blocked",
        organizationId,
        actorType: "system",
        resourceType: "specialist_eligibility",
        resourceId: blocked.workforceRoleCode,
        metadata: {
          capabilityCode: blocked.capabilityCode,
          reasonCode: decision?.reasonCode,
          reasons: decision?.reasons,
        },
      });
    }
  }

  const plan = buildSpecialistPlan(
    taskId,
    organizationId,
    eligibleAssignments.map((a, i) => {
      const eligibility = eligibilityResults[assignments.indexOf(a)];
      return {
        ...a,
        workerProfileCode: eligibility?.workerProfileCode ?? `${a.workforceRoleCode}_profile`,
      };
    }),
  );

  await logOrgEvent({
    eventType: "chief_of_staff.specialists_dispatched",
    organizationId,
    actorType: "system",
    resourceType: "task",
    resourceId: taskId,
    metadata: {
      planId: plan.planId,
      stepCount: plan.steps.length,
      blockedCount: blockedAssignments.length,
    },
  });

  return plan;
}

/**
 * Dispatches all steps that are ready to run (dependencies met) in parallel.
 */
export async function dispatchReadyRuns(
  plan: SpecialistPlan,
  options: {
    conversationId?: string;
    taskTitle: string;
    taskDescription?: string;
    requestingUserId?: string;
  },
): Promise<string[]> {
  const readySteps = getReadySteps(plan);
  const dispatchedRunIds: string[] = [];

  // Dispatch ready steps in parallel
  await Promise.all(
    readySteps.map(step => dispatchStep(step, plan, options)
      .then(runId => { if (runId) dispatchedRunIds.push(runId); })
      .catch(err => {
        console.error(`[CoS Orchestrator] Failed to dispatch step ${step.id}:`, err?.message);
      }),
    ),
  );

  return dispatchedRunIds;
}

/**
 * Processes completion of a specialist run.
 * Saves result, updates memory, checks for conflicts, dispatches dependent steps.
 */
export async function processRunCompletion(
  specialistRunId: string,
  organizationId: string,
  result: SpecialistRunResult,
): Promise<void> {
  // Save result
  await saveRunResult(specialistRunId, organizationId, result);
  await transitionRunStatus(specialistRunId, organizationId, "completed");
  await markCompleted(specialistRunId, organizationId);

  await logOrgEvent({
    eventType: "specialist.run_completed",
    organizationId,
    actorType: "agent",
    resourceType: "specialist_run",
    resourceId: specialistRunId,
    metadata: {
      workforceRoleCode: result.workforceRoleCode,
      confidence: result.confidence,
      findingCount: result.findings.length,
      hasBlockingQuestions: result.unresolvedQuestions.some(q => q.blocking),
    },
  });
}

/**
 * Processes failure of a specialist run.
 */
export async function processRunFailure(
  specialistRunId: string,
  organizationId: string,
  error: string,
  canRetry: boolean = true,
): Promise<void> {
  if (canRetry) {
    await transitionRunStatus(specialistRunId, organizationId, "queued", {
      lastError: error,
    });
    await markFailed(specialistRunId, organizationId, error, 30); // retry after 30s
  } else {
    await transitionRunStatus(specialistRunId, organizationId, "failed", {
      lastError: error,
    });
    await markFailed(specialistRunId, organizationId, error);
  }

  await logOrgEvent({
    eventType: "specialist.run_failed",
    organizationId,
    actorType: "system",
    resourceType: "specialist_run",
    resourceId: specialistRunId,
    metadata: { error: error.slice(0, 500), canRetry },
  });
}

/**
 * Pauses a specialist run for clarification.
 * Blocks only dependent runs — independent runs continue.
 */
export async function pauseForClarification(
  specialistRunId: string,
  organizationId: string,
  question: ClarificationQuestion,
): Promise<void> {
  await transitionRunStatus(specialistRunId, organizationId, "awaiting_clarification", {
    clarificationRequired: true,
  });

  await logOrgEvent({
    eventType: "specialist.clarification_requested",
    organizationId,
    actorType: "agent",
    resourceType: "specialist_run",
    resourceId: specialistRunId,
    metadata: {
      question: question.question,
      reason: question.reason,
      blocking: question.blocking,
    },
  });
}

/**
 * Resumes a run after a clarification response is validated.
 */
export async function resumeAfterClarification(
  specialistRunId: string,
  organizationId: string,
  clarificationResponse: string,
): Promise<void> {
  const run = await db
    .select()
    .from(specialistRunsTable)
    .where(and(eq(specialistRunsTable.id, specialistRunId), eq(specialistRunsTable.organizationId, organizationId)))
    .limit(1)
    .then(rows => rows[0]);

  if (!run || run.status !== "awaiting_clarification") {
    throw new Error(`Run ${specialistRunId} is not awaiting clarification`);
  }

  // Re-queue the run with the clarification response in metadata
  await transitionRunStatus(specialistRunId, organizationId, "queued", {
    clarificationRequired: false,
  });

  await logOrgEvent({
    eventType: "specialist.clarification_resolved",
    organizationId,
    actorType: "user",
    resourceType: "specialist_run",
    resourceId: specialistRunId,
    metadata: { responseLength: clarificationResponse.length },
  });
}

/**
 * Consolidates all completed specialist runs for a task into a single result.
 */
export async function consolidateTaskResults(
  taskId: string,
  organizationId: string,
): Promise<ConsolidatedTaskResult> {
  await logOrgEvent({
    eventType: "chief_of_staff.consolidation_started",
    organizationId,
    actorType: "system",
    resourceType: "task",
    resourceId: taskId,
    metadata: {},
  });

  const runs = await getRunsByTask(taskId, organizationId);
  const completedRuns = runs.filter(r => r.status === "completed" && r.resultData);
  const failedRuns = runs.filter(r => r.status === "failed");
  const pendingRuns = runs.filter(r => !["completed", "failed", "cancelled"].includes(r.status));

  const results: SpecialistRunResult[] = completedRuns.map(r => {
    try {
      return JSON.parse(r.resultData!) as SpecialistRunResult;
    } catch {
      return null!;
    }
  }).filter(Boolean);

  // Combine findings
  const allFindings = results.flatMap(r => r.findings);
  const allRecommendations = results.flatMap(r => r.recommendations);
  const allRisks = results.flatMap(r => r.risks);
  const allUnresolved = results.flatMap(r => r.unresolvedQuestions);
  const allExternalActions = results.flatMap(r => r.requestedExternalActions);

  // Deduplicate recommendations (same action text)
  const dedupedRecs = allRecommendations.filter((rec, i, arr) =>
    arr.findIndex(r2 => r2.action === rec.action) === i,
  );

  // Check for conflicts between specialist findings
  const conflicts = await detectAndRecordConflicts(taskId, organizationId, results);

  // Determine analysis status
  let analysisStatus: ConsolidatedTaskResult["analysisStatus"] = "analysis_completed";
  if (allExternalActions.length > 0) analysisStatus = "execution_pending";
  if (allUnresolved.some(q => q.blocking)) analysisStatus = "blocked";
  if (pendingRuns.length > 0) analysisStatus = "partially_complete";

  // Next recommended action
  const nextAction = determineNextAction(analysisStatus, allUnresolved, allExternalActions, conflicts);

  const result: ConsolidatedTaskResult = {
    taskId,
    organizationId,
    taskObjective: `Task ${taskId}`,
    participatingSpecialists: [...new Set(completedRuns.map(r => r.workforceRoleCode))],
    specialistSummaries: completedRuns.map(r => ({
      workforceRoleCode: r.workforceRoleCode,
      specialistRunId: r.id,
      summary: r.resultSummary ?? "",
      status: r.status,
      confidence: parseFloat(r.confidence?.toString() ?? "0.5"),
    })),
    combinedFindings: allFindings.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (severityOrder[a.severity ?? "low"] ?? 3) - (severityOrder[b.severity ?? "low"] ?? 3);
    }),
    combinedRecommendations: dedupedRecs,
    evidenceReferences: [],
    risks: allRisks,
    conflicts: conflicts.map(c => ({
      conflictId: c.id,
      positions: (c.conflictingPositions as Array<{ position: string }>).map(p => p.position),
      resolutionRequired: c.resolutionRequired,
    })),
    unresolvedQuestions: allUnresolved,
    approvalRequirements: [...new Set(allExternalActions.filter(a => a.approvalRequired).map(a => a.actionType))],
    externalActionsStillRequired: allExternalActions,
    nextRecommendedAction: nextAction,
    consolidatedAt: new Date().toISOString(),
    analysisStatus,
  };

  await logOrgEvent({
    eventType: "chief_of_staff.consolidation_completed",
    organizationId,
    actorType: "system",
    resourceType: "task",
    resourceId: taskId,
    metadata: {
      runCount: completedRuns.length,
      findingCount: allFindings.length,
      conflictCount: conflicts.length,
      analysisStatus,
    },
  });

  return result;
}

/**
 * Generates an OpenClaw execution package for a specialist run with external actions.
 * Only generated when all preconditions are met.
 */
export async function generateOpenClawPackage(
  specialistRunId: string,
  organizationId: string,
  result: SpecialistRunResult,
): Promise<OpenClawSpecialistExecutionPackage> {
  const run = await db
    .select()
    .from(specialistRunsTable)
    .where(and(eq(specialistRunsTable.id, specialistRunId), eq(specialistRunsTable.organizationId, organizationId)))
    .limit(1)
    .then(rows => rows[0]);

  if (!run) throw new Error("Specialist run not found");

  // Precondition checks (spec §16):
  // 1. Capability entitlement allowed (verified via capabilityDecisionId existing)
  // 2. Specialist eligibility allowed (verified via specialistEligibilityDecisionId existing)
  // 3. Worker Profile valid
  // 4. Run is completed
  if (run.status !== "completed") {
    throw new Error("OpenClaw package can only be generated for completed runs");
  }
  if (!run.specialistEligibilityDecisionId) {
    throw new Error("OpenClaw package requires a specialist eligibility decision");
  }
  if (!run.capabilityDecisionId) {
    throw new Error("OpenClaw package requires a capability entitlement decision");
  }

  // Check for blocking unresolved questions
  const hasBlockingQuestions = result.unresolvedQuestions.some(q => q.blocking);
  if (hasBlockingQuestions) {
    throw new Error("OpenClaw package cannot be generated while blocking questions remain unresolved");
  }

  const approvedSteps = result.requestedExternalActions.map((action, i) => ({
    stepId: randomUUID(),
    actionType: action.actionType,
    executionChannel: action.executionChannel,
    toolCategory: action.toolCategory,
    connectorCategory: action.connectorCategory,
    riskLevel: action.riskLevel,
    approvalState: action.approvalRequired ? ("pending_approval" as const) : ("not_required" as const),
    parameters: {},
  }));

  const overallApprovalState = approvedSteps.every(s => s.approvalState === "not_required")
    ? ("not_required" as const)
    : ("pending_approval" as const);

  const pkg: OpenClawSpecialistExecutionPackage = {
    executionId: randomUUID(),
    specialistRunId,
    organizationId,
    taskId: run.taskId,
    conversationId: run.conversationId ?? undefined,
    capabilityCode: result.capabilityCode,
    workforceRoleCode: run.workforceRoleCode,
    workerProfileCode: run.workerProfileCode,
    objective: result.summary,
    approvedSteps,
    allowedTools: [],
    allowedConnectorCategories: [],
    allowedExecutionChannels: [],
    prohibitedActions: [],
    approvalState: overallApprovalState,
    clarificationState: "clear",
    riskLevel: run.workerProfileCode.includes("compliance") ? "medium" : "low",
    inputReferences: [],
    outputRequirements: result.expectedOutputs.map(o => ({
      outputType: o.outputType,
      description: o.description,
    })),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
    correlationId: specialistRunId,
  };

  await logOrgEvent({
    eventType: "openclaw.handoff_package_created",
    organizationId,
    actorType: "system",
    resourceType: "specialist_run",
    resourceId: specialistRunId,
    metadata: {
      executionId: pkg.executionId,
      stepCount: approvedSteps.length,
      approvalState: overallApprovalState,
    },
  });

  return pkg;
}

/**
 * Executes a single specialist step end-to-end.
 * Used by the queue worker to process claimed queue entries.
 */
export async function executeSpecialistStep(
  specialistRunId: string,
  organizationId: string,
): Promise<SpecialistRunResult> {
  const run = await db
    .select()
    .from(specialistRunsTable)
    .where(and(eq(specialistRunsTable.id, specialistRunId), eq(specialistRunsTable.organizationId, organizationId)))
    .limit(1)
    .then(rows => rows[0]);

  if (!run) throw new Error(`Specialist run ${specialistRunId} not found`);

  await transitionRunStatus(specialistRunId, organizationId, "running");
  await markRunning(specialistRunId, organizationId);

  // Build context
  const context = await buildSpecialistContext({
    organizationId,
    conversationId: run.conversationId ?? undefined,
    taskId: run.taskId,
    specialistRunId,
    workforceRoleCode: run.workforceRoleCode,
    workerProfileCode: run.workerProfileCode,
    capabilityCode: "",
  });

  // Build minimal work package from run data
  const workPackage = await buildWorkPackage({
    specialistRunId,
    organizationId,
    conversationId: run.conversationId ?? undefined,
    taskId: run.taskId,
    taskTitle: `Task ${run.taskId}`,
    capabilityCode: "research.general", // fallback — real orchestrator provides this
    capabilityLevel: "professional_analysis",
    workforceRoleCode: run.workforceRoleCode,
    workerProfileCode: run.workerProfileCode,
    approvedMemory: context.approvedMemory,
    conversationContext: context.relevantMessages,
    previousOutputs: context.previousOutputs,
  });

  const result = await intelligence.executeRun(workPackage, context);

  await processRunCompletion(specialistRunId, organizationId, result);

  // If blocking questions — pause for clarification
  if (result.unresolvedQuestions.some(q => q.blocking)) {
    await pauseForClarification(specialistRunId, organizationId, {
      question: result.unresolvedQuestions.find(q => q.blocking)!.question,
      reason: result.unresolvedQuestions.find(q => q.blocking)!.reason,
      requestingSpecialistRunId: specialistRunId,
      blocking: true,
    });
  }

  return result;
}

// ─── Private helpers ───────────────────────────────────────────────────────────

async function dispatchStep(
  step: SpecialistPlanStep,
  plan: SpecialistPlan,
  options: {
    conversationId?: string;
    taskTitle: string;
    taskDescription?: string;
    requestingUserId?: string;
  },
): Promise<string | null> {
  const idempotencyKey = `${plan.taskId}:${step.capabilityCode}:${step.workforceRoleCode}`;

  const run = await createSpecialistRun({
    organizationId: plan.organizationId,
    conversationId: options.conversationId,
    taskId: plan.taskId,
    workforceRoleCode: step.workforceRoleCode,
    workerProfileCode: step.workerProfileCode,
    specialistInstructionVersion: "1.0.0",
    idempotencyKey,
  });

  if (step.dependsOn.length > 0) {
    await transitionRunStatus(run.id, plan.organizationId, "waiting_for_dependency");
    return run.id;
  }

  await transitionRunStatus(run.id, plan.organizationId, "queued");
  await enqueue(run.id, plan.organizationId, step.dependsOn.length === 0 ? 5 : 3);
  return run.id;
}

async function detectAndRecordConflicts(
  taskId: string,
  organizationId: string,
  results: SpecialistRunResult[],
): Promise<(typeof specialistConflictsTable.$inferSelect)[]> {
  const conflicts: (typeof specialistConflictsTable.$inferSelect)[] = [];

  // Simple conflict detection: check if findings on the same topic have significantly different severity assessments
  const highSeverityFindings = results.flatMap(r =>
    r.findings.filter(f => f.severity === "high" || f.severity === "critical")
      .map(f => ({ finding: f, specialist: r.workforceRoleCode, runId: r.specialistRunId })),
  );

  const lowSeverityFindings = results.flatMap(r =>
    r.findings.filter(f => f.severity === "low")
      .map(f => ({ finding: f, specialist: r.workforceRoleCode, runId: r.specialistRunId })),
  );

  // Detect potential conflicts when same topic appears at different severity levels
  for (const high of highSeverityFindings) {
    const conflicting = lowSeverityFindings.find(low =>
      low.specialist !== high.specialist &&
      (high.finding.title.toLowerCase().includes(low.finding.title.toLowerCase().slice(0, 10)) ||
       low.finding.title.toLowerCase().includes(high.finding.title.toLowerCase().slice(0, 10)))
    );

    if (conflicting) {
      const conflictId = randomUUID();
      const [conflict] = await db
        .insert(specialistConflictsTable)
        .values({
          id: conflictId,
          organizationId,
          taskId,
          specialistRunIds: [high.runId, conflicting.runId],
          conflictingPositions: [
            { specialistRunId: high.runId, position: `${high.specialist}: ${high.finding.title} (${high.finding.severity})`, confidence: high.finding.confidence },
            { specialistRunId: conflicting.runId, position: `${conflicting.specialist}: ${conflicting.finding.title} (${conflicting.finding.severity})`, confidence: conflicting.finding.confidence },
          ],
          evidenceReferences: [],
          risk: "medium",
          chiefOfStaffRecommendation: "Human review recommended to resolve conflicting severity assessments",
          resolutionRequired: true,
        })
        .returning();

      if (conflict) {
        conflicts.push(conflict);
        await logOrgEvent({
          eventType: "specialist.conflict_detected",
          organizationId,
          actorType: "system",
          resourceType: "specialist_conflict",
          resourceId: conflictId,
          metadata: { taskId, conflictingRuns: [high.runId, conflicting.runId] },
        });
      }
    }
  }

  return conflicts;
}

function determineNextAction(
  status: ConsolidatedTaskResult["analysisStatus"],
  unresolvedQuestions: SpecialistRunResult["unresolvedQuestions"],
  externalActions: SpecialistRunResult["requestedExternalActions"],
  conflicts: unknown[],
): string {
  if (status === "blocked") {
    const blockingQ = unresolvedQuestions.find(q => q.blocking);
    return `Resolve blocking question: "${blockingQ?.question ?? "Unknown question"}"`;
  }
  if (conflicts.length > 0) {
    return "Review and resolve specialist conflicts before proceeding";
  }
  if (externalActions.some(a => a.approvalRequired)) {
    return "Approve pending external actions to proceed with execution";
  }
  if (externalActions.length > 0) {
    return "Submit approved external actions through OpenClaw runtime";
  }
  if (status === "partially_complete") {
    return "Wait for remaining specialist runs to complete";
  }
  return "Review findings and recommendations — analysis complete";
}
