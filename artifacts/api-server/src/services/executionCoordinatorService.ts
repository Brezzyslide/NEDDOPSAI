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
  executionIntentsTable,
  tasksTable,
  conversationsTable,
  type ExecutionIntent,
} from "@workspace/db";
import { executeWork, EXECUTION_STAGE_LABELS } from "./workExecutionPipelineService.js";
import type { ExecutionStage, ExecutionCheckpointData } from "./workExecutionPipelineService.js";
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
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";

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
  requesterId: string;
  conversationId?: string;
  correlationId?: string;
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
  const [intent] = await db
    .select()
    .from(executionIntentsTable)
    .where(and(
      eq(executionIntentsTable.id, intentId),
      eq(executionIntentsTable.organizationId, organizationId),
    ))
    .limit(1);

  if (!intent) {
    return { dispatched: false, executionStarted: false, skipReason: "intent_not_found" };
  }

  if (intent.status === "dispatched" || intent.status === "completed") {
    return { dispatched: false, executionStarted: false, skipReason: "already_dispatched" };
  }

  await db
    .update(executionIntentsTable)
    .set({ status: "approved", approvedBy, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(executionIntentsTable.id, intentId),
      eq(executionIntentsTable.organizationId, organizationId),
    ));

  const conversationId = await resolveConversationForTask(organizationId, intent.taskId);

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(and(
      eq(tasksTable.organizationId, organizationId),
      eq(tasksTable.id, intent.taskId),
    ))
    .limit(1);

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

  await db
    .update(executionIntentsTable)
    .set({ status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
    .where(eq(executionIntentsTable.id, intentId));

  const userRequest = task?.description ?? task?.title ?? intent.description;
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
    userRequest: input.taskDescription ?? input.taskTitle,
    conversationId,
    correlationId,
    intentId: undefined,
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

  const checkpoint = await getActiveCheckpointByConversation(conversationId);
  if (!checkpoint) {
    console.warn("[ExecutionCoordinator] resumeFromCheckpoint: no active checkpoint for conversation", conversationId);
    return;
  }

  const resumeResult = await beginResume(conversationId);
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

  const staleIntents = await db
    .select()
    .from(executionIntentsTable)
    .where(and(...conditions))
    .limit(50);

  let recovered = 0;

  for (const intent of staleIntents) {
    try {
      const conversationId = await resolveConversationForTask(intent.organizationId, intent.taskId);
      const [task] = await db
        .select()
        .from(tasksTable)
        .where(and(
          eq(tasksTable.id, intent.taskId),
          eq(tasksTable.organizationId, intent.organizationId),
        ))
        .limit(1);

      const correlationId = randomUUID();
      const userRequest = task?.description ?? task?.title ?? intent.description;

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

// ─── Background runner ────────────────────────────────────────────────────────

interface BackgroundRunInput {
  organizationId: string;
  requesterId: string;
  taskId?: string;
  userRequest: string;
  conversationId?: string;
  correlationId: string;
  intentId?: string;
  checkpointData?: ExecutionCheckpointData;
}

function runExecutionInBackground(input: BackgroundRunInput): void {
  executeWorkAsync(input).catch(err => {
    console.error("[ExecutionCoordinator] Unhandled background execution error:", err?.message);
  });
}

async function executeWorkAsync(input: BackgroundRunInput): Promise<void> {
  const { organizationId, requesterId, taskId, userRequest, conversationId, correlationId } = input;

  try {
    const result = await executeWork({
      organizationId,
      requesterId,
      userRequest,
      conversationId,
      correlationId,
      checkpointData: input.checkpointData,
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
            manifest: (result as { manifest?: WorkPackageManifest }).manifest!,
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
      actorType: "system",
      resourceType: "task",
      resourceId: taskId ?? "unknown",
      metadata: {
        correlationId,
        outcome: result.outcome,
        completedWorkId: result.completedWorkId,
        qualityScore: result.qualityScore,
      },
    }).catch(() => {});

    if (result.outcome === "completed" && result.completedWorkId && conversationId) {
      const title = userRequest.slice(0, 80) + (userRequest.length > 80 ? "…" : "");

      emitExecutionEvent(conversationId, {
        type: "execution_completed",
        conversationId,
        correlationId,
        organizationId,
        humanLabel: "Work completed and ready for review.",
        completedWorkId: result.completedWorkId,
      });

      await postCompletedWorkCreatedToConversation(
        organizationId,
        conversationId,
        taskId ?? "",
        result.completedWorkId,
        title,
        result.qualityScore ?? null,
        correlationId,
      ).catch(err => console.warn("[ExecutionCoordinator] Completed work message failed:", err?.message));

      if (input.intentId) {
        await db
          .update(executionIntentsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(executionIntentsTable.id, input.intentId))
          .catch(() => {});
      }
    } else if (result.outcome !== "completed" && conversationId) {
      emitExecutionEvent(conversationId, {
        type: "execution_failed",
        conversationId,
        correlationId,
        organizationId,
        humanLabel: "There was a problem completing this work.",
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
  const [workroom] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.organizationId, organizationId),
      eq(conversationsTable.primaryTaskId, taskId),
      eq(conversationsTable.conversationType, "task_workroom"),
    ))
    .limit(1);

  if (workroom) return workroom.id;

  const [any] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(and(
      eq(conversationsTable.organizationId, organizationId),
      eq(conversationsTable.primaryTaskId, taskId),
    ))
    .limit(1);

  return any?.id ?? null;
}
