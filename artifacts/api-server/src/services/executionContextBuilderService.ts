/**
 * Execution Context Builder Service — Sprint 29C
 *
 * Responsible for assembling execution context when the engine receives a
 * conversation trigger with raw identifiers (specialistRunId + organisationId).
 *
 * Before Sprint 29C this assembly lived in chiefOfStaffOrchestrator.executeSpecialistStep(),
 * requiring the orchestrator to understand the internal structure of SpecialistWorkPackage
 * and SpecialistContext. The orchestrator now passes identifiers; the engine calls this
 * builder to produce execution inputs.
 *
 * Architecture rule enforced here:
 *   The Chief of Staff is the sole orchestrator — it decides who does what.
 *   This builder is the engine's context factory — it decides how to assemble inputs.
 *   Neither knows about the other's internals.
 *
 * Note: this service is distinct from the Sprint 28.5 ConversationContextBuilder
 * (conversationContextBuilder.ts) which assembles CoS LLM context (memory, workforce,
 * action state). This service assembles SpecialistWorkPackage + SpecialistContext
 * from a database-backed specialist run identifier.
 *
 * Design:
 *   - All DB queries are run concurrently via the existing buildSpecialistContext() function
 *   - buildWorkPackage() is called with the assembled context as an argument
 *   - The builder never performs AI calls or write operations
 *   - Errors propagate upward to the engine for consistent error handling
 */

import { eq, and } from "drizzle-orm";
import { db, specialistRunsTable, tasksTable } from "@workspace/db";
import { buildSpecialistContext } from "./specialistContextService.js";
import { buildWorkPackage } from "./specialistWorkPackageService.js";

// Type-only — avoids circular runtime dependency
import type { SpecialistWorkPackage, SpecialistContext } from "./specialistIntelligenceService.js";

// ─── Input / Output ────────────────────────────────────────────────────────────

export interface ExecutionContextIdentifiers {
  /** The specialist run being executed */
  specialistRunId: string;
  /** Organisation owning this execution */
  organisationId: string;
  /**
   * Human requester identity (from the conversation or task origin).
   * Falls back to "system" when the caller cannot determine the user.
   */
  requesterId?: string;
  requesterRole?: string;
}

export interface ExecutionContextOutput {
  workPackage: SpecialistWorkPackage;
  context: SpecialistContext;
  /** Effective requester identity threaded through to audit and gateway context */
  effectiveRequesterId: string;
  effectiveRequesterRole: string;
  /** Task scope string for logging */
  taskScope: string;
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Assembles the SpecialistWorkPackage and SpecialistContext that a specialist
 * run requires, starting only from the run ID and organisation ID.
 *
 * This is the engine's single point of truth for conversation context assembly.
 * Call it once at the start of executeConversation() when operating in
 * identifier-based mode.
 */
export async function buildExecutionContext(
  ids: ExecutionContextIdentifiers,
): Promise<ExecutionContextOutput> {
  const { specialistRunId, organisationId } = ids;

  // ── Load the specialist run ────────────────────────────────────────────────
  const run = await db
    .select()
    .from(specialistRunsTable)
    .where(
      and(
        eq(specialistRunsTable.id, specialistRunId),
        eq(specialistRunsTable.organizationId, organisationId),
      ),
    )
    .limit(1)
    .then(rows => rows[0]);

  if (!run) {
    throw new Error(
      `[ExecutionContextBuilder] Specialist run "${specialistRunId}" not found for org "${organisationId}"`,
    );
  }

  const workforceRoleCode = run.workforceRoleCode;
  const workerProfileCode = run.workerProfileCode ?? workforceRoleCode;
  const conversationId    = run.conversationId ?? undefined;
  const taskId            = run.taskId ?? null;

  // ── Resolve task title for work package labelling ─────────────────────────
  let taskTitle = `Task ${taskId ?? "unknown"}`;
  if (taskId) {
    const taskRow = await db
      .select({ title: tasksTable.title })
      .from(tasksTable)
      .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organisationId)))
      .limit(1)
      .then(rows => rows[0]);
    if (taskRow?.title) taskTitle = taskRow.title;
  }

  // ── Build specialist context (org memory, conversation history, etc.) ──────
  const context = await buildSpecialistContext({
    organizationId:    organisationId,
    conversationId,
    taskId,
    specialistRunId,
    workforceRoleCode,
    workerProfileCode,
    capabilityCode:    "", // capability code is resolved from the run's plan step; blank is safe
  });

  // ── Build the work package from assembled context ──────────────────────────
  const workPackage = await buildWorkPackage({
    specialistRunId,
    organizationId:     organisationId,
    conversationId,
    taskId:             taskId ?? specialistRunId, // use runId as fallback key when no task
    taskTitle,
    capabilityCode:    "research.general", // default; plan step overrides this in orchestrator dispatch
    capabilityLevel:   "professional_analysis",
    workforceRoleCode,
    workerProfileCode,
    approvedMemory:     context.approvedMemory,
    conversationContext: context.relevantMessages,
    previousOutputs:    context.previousOutputs,
    unresolvedQuestions: context.unresolvedQuestions,
  });

  const effectiveRequesterId   = ids.requesterId   ?? "system";
  const effectiveRequesterRole = ids.requesterRole  ?? "system";

  return {
    workPackage:            workPackage as SpecialistWorkPackage,
    context:                context    as SpecialistContext,
    effectiveRequesterId,
    effectiveRequesterRole,
    taskScope: context.taskScope,
  };
}
