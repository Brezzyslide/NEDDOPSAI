/**
 * Execution Coordinator Service — Sprint 27 / Sprint 27.1
 *
 * The single authoritative bridge between approval and execution.
 *
 * Sprint 27:  approval → executeWork() → conversation lifecycle messages
 * Sprint 27.1 adds:
 *   - Live SSE event emission alongside DB messages
 *   - Checkpoint save on clarification (instead of failure message)
 *   - Resume from checkpoint after user answers clarification
 *   - Recovery of orphaned dispatched intents after restart
 *
 * Never silently fails — all errors surface to the conversation and audit log.
 */

import { randomUUID } from "crypto";
import { eq, and, lt, or } from "drizzle-orm";
import {
  db,
  withSystemTenantContext,
  executionIntentsTable,
  tasksTable,
  conversationsTable,
  type ExecutionIntent,
} from "@workspace/db";
import { executeWork, EXECUTION_STAGE_LABELS } from "./workExecutionPipelineService.js";
import type { ExecutionStage, ExecutionCheckpointData } from "./workExecutionPipelineService.js";
import { getMembershipForUser } from "./membershipService.js";
import {
  postExecutionStartedToConversation,
  postExecutionProgressToConversation,
  postCompletedWorkCreatedToConversation,
  postExecutionFailedToConversation,
  postClarificationRequestToConversation,
  getOrCreateWorkroom,
} from "./conversationService.js";
import { logOrgEvent } from "./auditService.js";
import {
  emitExecutionEvent,
} from "./executionEventBus.js";
import {
  createCheckpoint as createDurableCheckpoint,
  beginResume,
  getActiveCheckpointByConversation,
} from "./executionCheckpointService.js";
import type { ActiveCheckpoint } from "./executionCheckpointService.js";
import { resolveCanonicalBlueprint } from "./workBlueprintService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";
import { resolveEvidence, type EvidencePack } from "./knowledgeResolutionService.js";
import { validateWorkPackage, type ValidationResult } from "./workValidationService.js";
import { classifyStandardTemplateEvidenceContext } from "./blueprintRuntimeValidationService.js";
import {
  claimTaskForExecution,
  getTaskPlan,
  isTaskCancelled,
  reconcileTaskExecutionFailure,
  reconcileTaskExecutionSuccess,
  transitionTaskState,
} from "./taskService.js";
import { deriveProfessionalIntentKey } from "./professionalExecutionContextService.js";
import { getRetrievalSubjectParticipantIdsForTask } from "./taskParticipantService.js";

type DbClient = typeof db;

function withExecutionCoordinatorTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "execution_coordinator", purpose },
    fn,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoordinateIntentApprovalResult {
  dispatched: boolean;
  executionStarted: boolean;
  skipReason?: string;
}

export interface DispatchWorkExecutionInput {
  organizationId: string;
  taskId?: string;
  taskTitle: string;
  taskDescription?: string;
  sourceUserRequest?: string;
  requesterId: string;
  conversationId?: string;
  correlationId?: string;
  /**
   * Sprint 29M: execution-lane context from the three-lane classifier.
   * Forwarded to executeWork → UEE so evidence/claim-integrity gates reflect
   * the classifier's decision, not just the blueprint's declared output type.
   */
  laneContext?: import("./unifiedExecutionEngine.js").ExecutionLaneContext;
}

interface ParticipantEvidencePreflightResult {
  shouldBlock: boolean;
  subjectParticipantIds: string[];
  blueprint: WorkBlueprint | null;
  evidencePack: EvidencePack | null;
  validationResult: ValidationResult | null;
}

export interface ResumeFromCheckpointInput {
  conversationId: string;
  organizationId: string;
  requesterId: string;
  clarificationAnswer: string;
}

export interface ResumeFromCheckpointByIdInput {
  checkpointId: string;
  checkpoint: ActiveCheckpoint;
  conversationId: string;
  organizationId: string;
  requesterId: string;
  clarificationAnswer: string;
}

// ─── Intent approval coordinator ──────────────────────────────────────────────

/**
 * Approves an execution intent and immediately starts the Work Execution Pipeline
 * in the background. Posts lifecycle messages to the linked conversation.
 * Idempotent — double approval returns { dispatched: false }.
 */
export async function coordinateIntentApproval(
  intentId: string,
  organizationId: string,
  approvedBy: string,
): Promise<CoordinateIntentApprovalResult> {
  const [intent] = await withExecutionCoordinatorTenant(organizationId, "execution_intent.approve.get", async (client) => client
    .select()
    .from(executionIntentsTable)
    .where(and(
      eq(executionIntentsTable.id, intentId),
      eq(executionIntentsTable.organizationId, organizationId),
    ))
    .limit(1));

  if (!intent) {
    return { dispatched: false, executionStarted: false, skipReason: "intent_not_found" };
  }

  if (intent.status === "dispatched" || intent.status === "completed") {
    return { dispatched: false, executionStarted: false, skipReason: "already_dispatched" };
  }

  await withExecutionCoordinatorTenant(organizationId, "execution_intent.approve", async (client) => client
    .update(executionIntentsTable)
    .set({ status: "approved", approvedBy, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(executionIntentsTable.id, intentId),
      eq(executionIntentsTable.organizationId, organizationId),
    )));

  const conversationId = await resolveConversationForTask(organizationId, intent.taskId);

  const [task] = await withExecutionCoordinatorTenant(organizationId, "execution_intent.task.get", async (client) => client
    .select()
    .from(tasksTable)
    .where(and(
      eq(tasksTable.organizationId, organizationId),
      eq(tasksTable.id, intent.taskId),
    ))
    .limit(1));

  const correlationId = randomUUID();

  if (conversationId) {
    emitExecutionEvent(conversationId, {
      type: "execution_started",
      conversationId,
      correlationId,
      organizationId,
      humanLabel: "Work approved and starting…",
    });
    postExecutionStartedToConversation(organizationId, conversationId, intent.taskId, correlationId)
      .catch(err => console.warn("[ExecutionCoordinator] Failed to post started message:", err?.message));
  }

  await logOrgEvent({
    eventType: "execution_intent.dispatched",
    organizationId,
    actorType: "user",
    actorUserId: approvedBy,
    resourceType: "execution_intent",
    resourceId: intentId,
    metadata: { taskId: intent.taskId, correlationId, intentType: intent.intentType },
  }).catch(() => {});

  await withExecutionCoordinatorTenant(organizationId, "execution_intent.mark_dispatched", async (client) => client
    .update(executionIntentsTable)
    .set({ status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
    .where(eq(executionIntentsTable.id, intentId)));

  const taskCreation = (task?.metadata as Record<string, unknown> | null | undefined)?.taskCreation as Record<string, unknown> | undefined;
  const originalRequest = typeof taskCreation?.sourceUserRequest === "string"
    ? taskCreation.sourceUserRequest.trim()
    : "";
  const userRequest = originalRequest || (task?.title ?? intent.description);
  runExecutionInBackground({
    organizationId,
    requesterId: approvedBy,
    taskId: intent.taskId,
    userRequest,
    conversationId: conversationId ?? undefined,
    correlationId,
    intentId,
  });

  return { dispatched: true, executionStarted: true };
}

/**
 * Dispatch work execution for a task that does NOT require intent approval.
 * Called immediately after task creation when requiresApproval === false.
 */
export async function dispatchWorkExecution(
  input: DispatchWorkExecutionInput,
): Promise<void> {
  const correlationId = input.correlationId ?? randomUUID();

  // Ensure a workroom conversation exists for this task so clarification
  // checkpoints have somewhere to write messages and resume from — even when
  // the task was created outside a conversation (e.g. direct POST /tasks).
  let conversationId = input.conversationId;
  if (!conversationId && input.taskId) {
    try {
      const workroom = await getOrCreateWorkroom(
        input.organizationId,
        input.taskId,
        input.requesterId,
      );
      conversationId = workroom.id;
    } catch (err) {
      console.warn("[ExecutionCoordinator] Could not resolve workroom conversation (non-fatal):", (err as Error)?.message);
    }
  }

  const participantPreflight = input.taskId
    ? await evaluateParticipantEvidencePreflight({
        organizationId: input.organizationId,
        requesterId: input.requesterId,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
        userRequest: input.sourceUserRequest?.trim() || input.taskTitle,
        conversationId,
        correlationId,
      }).catch((err): ParticipantEvidencePreflightResult | null => {
        console.warn("[ExecutionCoordinator] Participant evidence preflight failed open:", err?.message);
        return null;
      })
    : null;

  if (participantPreflight?.shouldBlock && participantPreflight.validationResult) {
    const questions = participantPreflight.validationResult.missingItems.map(
      label => `Please link or upload the required ${label} for the task participant.`,
    );
    await transitionTaskState(input.taskId!, input.organizationId, "evidence_required");
    if (conversationId) {
      emitExecutionEvent(conversationId, {
        type: "execution_clarification_required",
        conversationId,
        correlationId,
        organizationId: input.organizationId,
        humanLabel: "Participant evidence is required before this work can start.",
        clarificationQuestions: questions,
      });
      await postClarificationRequestToConversation(
        input.organizationId,
        conversationId,
        input.taskId!,
        questions,
        correlationId,
      ).catch(() => {});
    }
    await logOrgEvent({
      eventType: "execution_coordinator.participant_evidence_required",
      organizationId: input.organizationId,
      actorType: "system",
      resourceType: "task",
      resourceId: input.taskId,
      metadata: {
        correlationId,
        subjectParticipantIds: participantPreflight.subjectParticipantIds,
        blueprintCode: participantPreflight.blueprint?.code ?? null,
        missingItems: participantPreflight.validationResult.missingItems,
      },
    }).catch(() => {});
    return;
  }

  if (input.taskId) {
    const claim = await claimTaskForExecution(input.taskId, input.organizationId, { correlationId });
    if (!claim.claimed) {
      if (claim.reason === "not_found") {
        await logOrgEvent({
          eventType: "execution_coordinator.dispatch_without_canonical_task",
          organizationId: input.organizationId,
          actorType: "system",
          resourceType: "task",
          resourceId: input.taskId,
          metadata: { correlationId },
        }).catch(() => {});
      } else {
        if (conversationId && claim.reason === "cancelled") {
          emitExecutionEvent(conversationId, {
            type: "execution_failed",
            conversationId,
            correlationId,
            organizationId: input.organizationId,
            humanLabel: "Work was not started because the task is cancelled.",
            errorMessage: "Task is cancelled.",
          });
        }
        await logOrgEvent({
          eventType: "execution_coordinator.dispatch_skipped",
          organizationId: input.organizationId,
          actorType: "system",
          resourceType: "task",
          resourceId: input.taskId,
          metadata: { correlationId, reason: claim.reason },
        }).catch(() => {});
        return;
      }
    }
  }

  if (conversationId) {
    emitExecutionEvent(conversationId, {
      type: "execution_started",
      conversationId,
      correlationId,
      organizationId: input.organizationId,
      humanLabel: "Work is starting…",
    });
    postExecutionStartedToConversation(
      input.organizationId,
      conversationId,
      input.taskId ?? "",
      correlationId,
    ).catch(err => console.warn("[ExecutionCoordinator] Failed to post started message:", err?.message));
  }

  await logOrgEvent({
    eventType: "execution_coordinator.dispatch_started",
    organizationId: input.organizationId,
    actorType: "system",
    resourceType: "task",
    resourceId: input.taskId ?? "unknown",
    metadata: { correlationId, taskTitle: input.taskTitle },
  }).catch(() => {});

  runExecutionInBackground({
    organizationId: input.organizationId,
    requesterId: input.requesterId,
    taskId: input.taskId,
    userRequest: input.sourceUserRequest?.trim() || input.taskTitle,
    conversationId,
    correlationId,
    intentId: undefined,
    laneContext: input.laneContext,  // Sprint 29M: forward classifier lane to UEE
  });
}

/**
 * Resume execution from a checkpoint after the user has answered clarification questions.
 * Uses the durable checkpoint service for atomic state transition.
 * Delegates to resumeFromCheckpointById after claiming the resume lock.
 */
export async function resumeFromCheckpoint(
  input: ResumeFromCheckpointInput,
): Promise<void> {
  const { conversationId, organizationId, requesterId, clarificationAnswer } = input;

  const checkpoint = await getActiveCheckpointByConversation(conversationId, organizationId);
  if (!checkpoint) {
    console.warn("[ExecutionCoordinator] resumeFromCheckpoint: no active checkpoint for conversation", conversationId);
    return;
  }

  const resumeResult = await beginResume(conversationId, organizationId);
  if (!resumeResult.resumed) {
    console.warn("[ExecutionCoordinator] resumeFromCheckpoint: already resuming or no checkpoint", resumeResult.reason);
    return;
  }

  await resumeFromCheckpointById({
    checkpointId:        checkpoint.id,
    checkpoint:          resumeResult.checkpoint!,
    conversationId,
    organizationId,
    requesterId,
    clarificationAnswer,
  });
}

/**
 * Resume from a specific checkpoint that has already been atomically claimed
 * (status = "resuming"). Called by messageIngressService after beginResume succeeds.
 */
export async function resumeFromCheckpointById(
  input: ResumeFromCheckpointByIdInput,
): Promise<void> {
  const { checkpoint, conversationId, organizationId, requesterId, clarificationAnswer } = input;
  const correlationId = checkpoint.correlationId;

  if (conversationId) {
    emitExecutionEvent(conversationId, {
      type: "execution_recovered",
      conversationId,
      correlationId,
      organizationId,
      humanLabel: "Resuming from where we left off…",
    });
    postExecutionStartedToConversation(organizationId, conversationId, "", correlationId)
      .catch(() => {});
  }

  await logOrgEvent({
    eventType: "execution_coordinator.dispatch_started",
    organizationId,
    actorType: "system",
    resourceType: "conversation",
    resourceId: conversationId,
    metadata: {
      correlationId,
      resumed: true,
      checkpointId: checkpoint.id,
      clarificationAnswer: clarificationAnswer.slice(0, 200),
    },
  }).catch(() => {});

  const checkpointData: ExecutionCheckpointData = {
    correlationId,
    blueprint: checkpoint.payload.blueprint,
    manifest: checkpoint.payload.manifest,
    clarificationAnswer,
  };

  runExecutionInBackground({
    organizationId,
    requesterId,
    taskId: checkpoint.taskId ?? undefined,
    userRequest: checkpoint.payload.originalRequest,
    conversationId,
    correlationId,
    intentId: undefined,
    checkpointData,
  });
}

/**
 * Scans for execution intents that were dispatched but never completed — e.g.
 * after an API restart. Re-queues them for background execution.
 * Safe to call multiple times (idempotent per intent).
 */
export async function recoverOrphanedExecutions(organizationId?: string): Promise<number> {
  const STALE_THRESHOLD_MINUTES = 10;
  const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

  const conditions = [
    eq(executionIntentsTable.status, "dispatched"),
    lt(executionIntentsTable.dispatchedAt, staleCutoff),
  ];
  if (organizationId) {
    conditions.push(eq(executionIntentsTable.organizationId, organizationId));
  }

  const staleIntents = organizationId
    ? await withExecutionCoordinatorTenant(organizationId, "execution_intent.recover.list", async (client) => client
      .select()
      .from(executionIntentsTable)
      .where(and(...conditions))
      .limit(50))
    : await db
      .select()
      .from(executionIntentsTable)
      .where(and(...conditions))
      .limit(50);

  let recovered = 0;

  for (const intent of staleIntents) {
    try {
      const conversationId = await resolveConversationForTask(intent.organizationId, intent.taskId);
      const [task] = await withExecutionCoordinatorTenant(intent.organizationId, "execution_intent.recover.task.get", async (client) => client
        .select()
        .from(tasksTable)
        .where(and(
          eq(tasksTable.id, intent.taskId),
          eq(tasksTable.organizationId, intent.organizationId),
        ))
        .limit(1));

      const correlationId = randomUUID();
      const taskCreation = (task?.metadata as Record<string, unknown> | null | undefined)?.taskCreation as Record<string, unknown> | undefined;
      const originalRequest = typeof taskCreation?.sourceUserRequest === "string"
        ? taskCreation.sourceUserRequest.trim()
        : "";
      const userRequest = originalRequest || (task?.title ?? intent.description);

      if (conversationId) {
        emitExecutionEvent(conversationId, {
          type: "execution_recovered",
          conversationId,
          correlationId,
          organizationId: intent.organizationId,
          humanLabel: "Recovering previous execution…",
        });
        postExecutionStartedToConversation(intent.organizationId, conversationId, intent.taskId, correlationId)
          .catch(() => {});
      }

      runExecutionInBackground({
        organizationId: intent.organizationId,
        requesterId: intent.approvedBy ?? "system",
        taskId: intent.taskId,
        userRequest,
        conversationId: conversationId ?? undefined,
        correlationId,
        intentId: intent.id,
      });

      recovered++;
    } catch (err) {
      console.error("[ExecutionCoordinator] Recovery failed for intent", intent.id, err);
    }
  }

  if (recovered > 0) {
    console.info(`[ExecutionCoordinator] Recovered ${recovered} orphaned execution(s).`);
  }

  return recovered;
}

async function evaluateParticipantEvidencePreflight(input: {
  organizationId: string;
  requesterId: string;
  taskId: string;
  taskTitle: string;
  userRequest: string;
  conversationId?: string;
  correlationId: string;
}): Promise<ParticipantEvidencePreflightResult | null> {
  const subjectParticipantIds = await getRetrievalSubjectParticipantIdsForTask(input.organizationId, input.taskId);
  if (subjectParticipantIds.length === 0) return null;

  const plan = await getTaskPlan(input.taskId, input.organizationId).catch(() => null);
  const canonicalIntent =
    deriveProfessionalIntentKey(input.userRequest, plan?.intent ?? null) ??
    plan?.intent ??
    null;
  const blueprintSelection = await resolveCanonicalBlueprint(canonicalIntent, input.organizationId).catch(() => null);
  const blueprint = blueprintSelection?.blueprint ?? null;
  if (!blueprint) {
    return {
      shouldBlock: false,
      subjectParticipantIds,
      blueprint: null,
      evidencePack: null,
      validationResult: null,
    };
  }

  const manifest: WorkPackageManifest = {
    id: `participant-preflight:${input.taskId}`,
    organizationId: input.organizationId,
    completedWorkId: null,
    executionId: `participant-preflight:${input.correlationId}`,
    taskId: input.taskId,
    blueprintId: blueprint.id,
    blueprintVersion: blueprint.version,
    canonicalIntent,
    blueprintFamily: blueprint.blueprintFamily,
    blueprintMode: blueprint.supportedModes[0] ?? "create",
    templateId: null,
    templateVersion: null,
    contractSnapshot: null,
    primarySpecialist: plan?.primarySpecialist ?? blueprint.primarySpecialist,
    supportingSpecialists: blueprint.supportingSpecialists ?? [],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    entityKnowledge: {},
    taskUploads: [],
    selectionMetadata: { deliverableStandardisation: "participant_specific" },
    modelVersion: null,
    promptVersion: "participant-evidence-preflight",
    assembledAt: new Date(),
    requesterId: input.requesterId,
    createdAt: new Date(),
  };

  const evidencePack = await resolveEvidence({
    organisationId: input.organizationId,
    specialistCode: manifest.primarySpecialist,
    blueprint,
    workPackage: manifest,
    userRequest: input.userRequest,
    entityIds: subjectParticipantIds,
  });
  const validationResult = validateWorkPackage(manifest, blueprint, evidencePack, {
    standardTemplateEvidence: classifyStandardTemplateEvidenceContext(input.userRequest),
    participantSpecificMode: true,
  });

  return {
    shouldBlock: !validationResult.passed,
    subjectParticipantIds,
    blueprint,
    evidencePack,
    validationResult,
  };
}

// ─── Background runner ────────────────────────────────────────────────────────

interface BackgroundRunInput {
  organizationId: string;
  requesterId: string;
  /**
   * The requester's verified org membership role, pre-resolved by the dispatcher.
   * Passed to executeWork so the AI gateway can authorise on behalf of the requester.
   */
  requesterRole?: string;
  taskId?: string;
  userRequest: string;
  conversationId?: string;
  correlationId: string;
  intentId?: string;
  canonicalIntent?: string;
  checkpointData?: ExecutionCheckpointData;
  /** Sprint 29M: classifier lane context forwarded through the background runner to UEE */
  laneContext?: import("./unifiedExecutionEngine.js").ExecutionLaneContext;
}

function runExecutionInBackground(input: BackgroundRunInput): void {
  executeWorkAsync(input).catch(err => {
    console.error("[ExecutionCoordinator] Unhandled background execution error:", err?.message);
  });
}

async function executeWorkAsync(input: BackgroundRunInput): Promise<void> {
  const { organizationId, requesterId, taskId, userRequest, conversationId, correlationId } = input;

  // ── Resolve requester's org membership role ──────────────────────────────────
  // This must happen inside the background runner (not the HTTP handler) so the
  // role reflects the state at execution time. Never fall back to "system".
  let requesterRole = input.requesterRole;
  if (!requesterRole) {
    const membership = await getMembershipForUser(organizationId, requesterId).catch(() => null);
    requesterRole = membership?.role ?? undefined;
    if (!requesterRole) {
      // Log and surface a clear error — do NOT proceed with a missing principal
      console.error(
        "[ExecutionCoordinator] execution_principal_missing — could not resolve org role",
        "| requesterId:", requesterId,
        "| organizationId:", organizationId,
        "| correlationId:", correlationId,
      );
      await logOrgEvent({
        eventType: "execution_coordinator.principal_missing",
        organizationId,
        actorType: "system",
        actorUserId: requesterId,
        resourceType: "task",
        resourceId: taskId ?? "unknown",
        metadata: { correlationId, reason: "role_not_resolved" },
      }).catch(() => {});
      if (conversationId) {
        const msg =
          `The work could not start because the execution authority for this request could not be verified. ` +
          `No work was performed. Please retry or contact support with reference ${correlationId}.`;
        emitExecutionEvent(conversationId, {
          type: "execution_failed",
          conversationId, correlationId, organizationId,
          humanLabel: "Work could not start — execution authority unverified.",
          errorMessage: msg,
        });
        await postExecutionFailedToConversation(organizationId, conversationId, taskId ?? "", msg, correlationId)
          .catch(() => {});
      }
      await reconcileTaskExecutionFailure({
        taskId,
        organizationId,
        errorMessage: "Execution authority could not be verified.",
        correlationId,
      }).catch(() => {});
      return;
    }
  }

  try {
    if (await isTaskCancelled(taskId, organizationId)) {
      await logOrgEvent({
        eventType: "execution_coordinator.cancelled_before_start",
        organizationId,
        actorType: "system",
        resourceType: "task",
        resourceId: taskId ?? "unknown",
        metadata: { correlationId },
      }).catch(() => {});
      return;
    }

    const plan = taskId
      ? await getTaskPlan(taskId, organizationId).catch(() => null)
      : null;
    const canonicalIntent =
      input.canonicalIntent ??
      deriveProfessionalIntentKey(userRequest, plan?.intent ?? null) ??
      undefined;

    const result = await executeWork({
      organizationId,
      requesterId,
      requesterRole,
      userRequest,
      canonicalIntent,
      conversationId,
      correlationId,
      taskId,           // Sprint 29I (D1): forward CoS task ID so engine can read the authoritative plan
      checkpointData: input.checkpointData,
      laneContext: input.laneContext,  // Sprint 29M: classifier lane → UEE evidence override
      onProgress: async (stage: ExecutionStage) => {
        const humanLabel = EXECUTION_STAGE_LABELS[stage] ?? stage;

        // Emit to SSE clients immediately
        if (conversationId) {
          emitExecutionEvent(conversationId, {
            type: "execution_progress",
            conversationId,
            correlationId,
            organizationId,
            stage,
            humanLabel,
          });
          await postExecutionProgressToConversation(
            organizationId,
            conversationId,
            taskId ?? "",
            stage,
            correlationId,
          ).catch(err => console.warn("[ExecutionCoordinator] Progress message failed:", err?.message));
        }
      },
    });

    if (await isTaskCancelled(taskId, organizationId)) {
      await logOrgEvent({
        eventType: "execution_coordinator.result_discarded_after_cancel",
        organizationId,
        actorType: "system",
        resourceType: "task",
        resourceId: taskId ?? "unknown",
        metadata: { correlationId, outcome: result.outcome, completedWorkId: result.completedWorkId },
      }).catch(() => {});
      return;
    }

    // ── Handle awaiting_clarification ─────────────────────────────────────────
    if (result.outcome === "awaiting_clarification" && result.clarificationQuestions?.length) {
      if (conversationId) {
        // Save checkpoint so the conversation can resume after the user answers
        // Persist checkpoint durably so it survives server restarts
        await createDurableCheckpoint({
          correlationId,
          conversationId,
          organizationId,
          taskId,
          requesterId,
          clarificationQuestions: result.clarificationQuestions,
          payload: {
            originalRequest: userRequest,
            blueprint: (result as { blueprint?: WorkBlueprint | null }).blueprint ?? null,
            manifest: (result as { manifest?: WorkPackageManifest }).manifest ?? null,
          },
        }).catch(err =>
          console.warn("[ExecutionCoordinator] Failed to persist checkpoint (in-memory fallback active):", err?.message),
        );

        emitExecutionEvent(conversationId, {
          type: "execution_clarification_required",
          conversationId,
          correlationId,
          organizationId,
          humanLabel: "I need a little more information…",
          clarificationQuestions: result.clarificationQuestions,
        });

        if (taskId) {
          await transitionTaskState(taskId, organizationId, "evidence_required");
        }

        await postClarificationRequestToConversation(
          organizationId,
          conversationId,
          taskId ?? "",
          result.clarificationQuestions,
          correlationId,
        ).catch(() => {});
      }
      return; // Do NOT post failure — execution is paused, not failed
    }

    // ── Audit outcome ─────────────────────────────────────────────────────────
    await logOrgEvent({
      eventType: result.outcome === "completed"
        ? "execution_coordinator.completed"
        : "execution_coordinator.pipeline_outcome",
      organizationId,
      actorType: "user",
      actorUserId: requesterId,
      resourceType: "task",
      resourceId: taskId ?? "unknown",
      metadata: {
        correlationId,
        outcome: result.outcome,
        completedWorkId: result.completedWorkId,
        qualityScore: result.qualityScore,
        requesterRole,
      },
    }).catch(() => {});

    if (result.outcome === "completed" && result.completedWorkId) {
      const reconciliation = await reconcileTaskExecutionSuccess({
        taskId,
        organizationId,
        completedWorkId: result.completedWorkId,
        completedWorkStatus: result.completedWorkStatus,
        correlationId,
        requestedByUserId: requesterId,
      });
      if (reconciliation.status === "cancelled") {
        await logOrgEvent({
          eventType: "execution_coordinator.completion_discarded_after_cancel",
          organizationId,
          actorType: "system",
          resourceType: "task",
          resourceId: taskId ?? "unknown",
          metadata: { correlationId, completedWorkId: result.completedWorkId },
        }).catch(() => {});
        return;
      }
      if (reconciliation.status === "awaiting_approval") {
        if (!conversationId) return;
        const persistedTitle  = result.completedWorkTitle
          ?? (userRequest.slice(0, 80) + (userRequest.length > 80 ? "…" : ""));
        const persistedStatus = result.completedWorkStatus ?? "awaiting_approval";
        emitExecutionEvent(conversationId, {
          type: "approval_requested",
          conversationId,
          correlationId,
          organizationId,
          humanLabel: "Work completed and ready for authorised approval.",
          completedWorkId: result.completedWorkId,
        });
        await postCompletedWorkCreatedToConversation(
          organizationId,
          conversationId,
          taskId ?? "",
          result.completedWorkId,
          persistedTitle,
          persistedStatus,
          result.qualityScore ?? null,
          correlationId,
        ).catch(err => console.warn("[ExecutionCoordinator] Approval request message failed:", err?.message));
        return;
      }
      if (reconciliation.status === "approval_not_ready") {
        const message = reconciliation.reason ?? "Work was created, but the task could not be moved into pending approval.";
        await logOrgEvent({
          eventType: "execution_coordinator.approval_reconciliation_failed",
          organizationId,
          actorType: "system",
          resourceType: "task",
          resourceId: taskId ?? "unknown",
          metadata: { correlationId, completedWorkId: result.completedWorkId, reason: message },
        }).catch(() => {});
        if (!conversationId) return;
        emitExecutionEvent(conversationId, {
          type: "execution_failed",
          conversationId,
          correlationId,
          organizationId,
          humanLabel: "Work could not be submitted for approval.",
          errorMessage: message,
        });
        await postExecutionFailedToConversation(organizationId, conversationId, taskId ?? "", message, correlationId)
          .catch(() => {});
        return;
      }
      if (!conversationId) {
        if (input.intentId) {
          await withExecutionCoordinatorTenant(organizationId, "execution_intent.mark_completed", async (client) => client
            .update(executionIntentsTable)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(executionIntentsTable.id, input.intentId))
            .catch(() => {}));
        }
        return;
      }
      // Use the persisted title and status from the engine result — never derive
      // these from the userRequest or assume a successful lifecycle transition.
      const persistedTitle  = result.completedWorkTitle
        ?? (userRequest.slice(0, 80) + (userRequest.length > 80 ? "…" : ""));
      const persistedStatus = result.completedWorkStatus ?? "draft";

      const humanLabel = persistedStatus === "awaiting_approval"
        ? "Work completed and ready for your approval."
        : "Work completed — draft saved for review.";

      emitExecutionEvent(conversationId, {
        type: "execution_completed",
        conversationId,
        correlationId,
        organizationId,
        humanLabel,
        completedWorkId: result.completedWorkId,
      });

      await postCompletedWorkCreatedToConversation(
        organizationId,
        conversationId,
        taskId ?? "",
        result.completedWorkId,
        persistedTitle,
        persistedStatus,
        result.qualityScore ?? null,
        correlationId,
      ).catch(err => console.warn("[ExecutionCoordinator] Completed work message failed:", err?.message));

      if (input.intentId) {
        await withExecutionCoordinatorTenant(organizationId, "execution_intent.mark_completed", async (client) => client
          .update(executionIntentsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(executionIntentsTable.id, input.intentId))
          .catch(() => {}));
      }
    } else if (result.outcome !== "completed") {
      await reconcileTaskExecutionFailure({
        taskId,
        organizationId,
        errorMessage: result.message,
        correlationId,
        failureMetadata: result.failureMetadata,
      }).catch(() => {});
      if (!conversationId) return;
      const humanLabel = result.outcome === "execution_principal_missing"
        ? "Work could not start — execution authority could not be verified."
        : "There was a problem completing this work.";
      emitExecutionEvent(conversationId, {
        type: "execution_failed",
        conversationId,
        correlationId,
        organizationId,
        humanLabel,
        errorMessage: result.message,
      });

      await postExecutionFailedToConversation(
        organizationId,
        conversationId,
        taskId ?? "",
        result.message,
        correlationId,
      ).catch(err => console.warn("[ExecutionCoordinator] Failure message failed:", err?.message));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "An unexpected error occurred during execution.";
    await reconcileTaskExecutionFailure({
      taskId,
      organizationId,
      errorMessage: message,
      correlationId,
    }).catch(() => {});

    await logOrgEvent({
      eventType: "execution_coordinator.error",
      organizationId,
      actorType: "system",
      resourceType: "task",
      resourceId: taskId ?? "unknown",
      metadata: { correlationId, error: message },
    }).catch(() => {});

    if (conversationId) {
      emitExecutionEvent(conversationId, {
        type: "execution_failed",
        conversationId,
        correlationId,
        organizationId,
        humanLabel: "An unexpected error occurred.",
        errorMessage: message,
      });
      await postExecutionFailedToConversation(organizationId, conversationId, taskId ?? "", message, correlationId)
        .catch(() => {});
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveConversationForTask(
  organizationId: string,
  taskId: string,
): Promise<string | null> {
  const [workroom] = await withExecutionCoordinatorTenant(organizationId, "execution_coordinator.resolve_conversation.workroom", async (client) => client
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.organizationId, organizationId),
      eq(conversationsTable.primaryTaskId, taskId),
      eq(conversationsTable.conversationType, "task_workroom"),
    ))
    .limit(1));

  if (workroom) return workroom.id;

  const [any] = await withExecutionCoordinatorTenant(organizationId, "execution_coordinator.resolve_conversation.any", async (client) => client
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.organizationId, organizationId),
      eq(conversationsTable.primaryTaskId, taskId),
    ))
    .limit(1));

  return any?.id ?? null;
}
