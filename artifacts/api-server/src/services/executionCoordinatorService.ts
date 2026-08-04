/**
 * Execution Coordinator Service — Sprint 27
 *
 * Bridges the gap between intent/task approval and the Work Execution Pipeline.
 * This is the single authoritative place where "approval happened → work executes".
 *
 * Responsibilities:
 * 1. Approve the execution intent and mark it dispatched.
 * 2. Reconstruct execution context from the task linked to the intent.
 * 3. Post lifecycle messages to the conversation (started, progress, completed, failed).
 * 4. Call workExecutionPipelineService.executeWork() in the background.
 * 5. Never silently fail — all failures are posted to the conversation.
 *
 * The approval route returns immediately; execution runs asynchronously.
 * Idempotency: an intent can only be dispatched once (status: dispatched).
 */

import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import {
  db,
  executionIntentsTable,
  tasksTable,
  conversationsTable,
  type ExecutionIntent,
} from "@workspace/db";
import { executeWork } from "./workExecutionPipelineService.js";
import {
  postExecutionStartedToConversation,
  postExecutionProgressToConversation,
  postCompletedWorkCreatedToConversation,
  postExecutionFailedToConversation,
} from "./conversationService.js";
import { logOrgEvent } from "./auditService.js";
import type { ExecutionStage } from "./workExecutionPipelineService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoordinateIntentApprovalResult {
  /** Whether the intent was approved and dispatched for execution. */
  dispatched: boolean;
  /** Whether background execution was successfully started. */
  executionStarted: boolean;
  /** Why dispatch was skipped (if dispatched === false). */
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

// ─── Intent approval coordinator ──────────────────────────────────────────────

/**
 * Approves an execution intent and immediately starts the Work Execution Pipeline
 * in the background. Posts lifecycle messages to the linked conversation.
 *
 * Idempotent: if the intent is already dispatched, returns { dispatched: false }.
 */
export async function coordinateIntentApproval(
  intentId: string,
  organizationId: string,
  approvedBy: string,
): Promise<CoordinateIntentApprovalResult> {
  // 1. Fetch the intent
  const [intent] = await db
    .select()
    .from(executionIntentsTable)
    .where(
      and(
        eq(executionIntentsTable.id, intentId),
        eq(executionIntentsTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!intent) {
    return { dispatched: false, executionStarted: false, skipReason: "intent_not_found" };
  }

  // 2. Idempotency — already approved/dispatched
  if (intent.status === "dispatched" || intent.status === "completed") {
    return { dispatched: false, executionStarted: false, skipReason: "already_dispatched" };
  }

  // 3. Approve + mark dispatched
  await db
    .update(executionIntentsTable)
    .set({
      status: "approved",
      approvedBy,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(executionIntentsTable.id, intentId),
        eq(executionIntentsTable.organizationId, organizationId),
      ),
    );

  // 4. Resolve conversation for this task
  const conversationId = await resolveConversationForTask(organizationId, intent.taskId);

  // 5. Fetch task for context
  const [task] = await db
    .select()
    .from(tasksTable)
    .where(
      and(
        eq(tasksTable.organizationId, organizationId),
        eq(tasksTable.id, intent.taskId),
      ),
    )
    .limit(1);

  const correlationId = randomUUID();

  // 6. Post "started" message to conversation (non-blocking)
  if (conversationId) {
    postExecutionStartedToConversation(
      organizationId,
      conversationId,
      intent.taskId,
      correlationId,
    ).catch(err =>
      console.warn("[ExecutionCoordinator] Failed to post started message:", err?.message),
    );
  }

  // 7. Audit dispatch
  await logOrgEvent({
    eventType: "execution_intent.dispatched",
    organizationId,
    actorType: "user",
    actorUserId: approvedBy,
    resourceType: "execution_intent",
    resourceId: intentId,
    metadata: { taskId: intent.taskId, correlationId, intentType: intent.intentType },
  }).catch(() => {});

  // 8. Mark dispatched
  await db
    .update(executionIntentsTable)
    .set({ status: "dispatched", dispatchedAt: new Date(), updatedAt: new Date() })
    .where(eq(executionIntentsTable.id, intentId));

  // 9. Fire-and-forget background execution
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

  // Post started message
  if (input.conversationId) {
    postExecutionStartedToConversation(
      input.organizationId,
      input.conversationId,
      input.taskId ?? "",
      correlationId,
    ).catch(err =>
      console.warn("[ExecutionCoordinator] Failed to post started message:", err?.message),
    );
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
    conversationId: input.conversationId,
    correlationId,
    intentId: undefined,
  });
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
}

/**
 * Runs executeWork() fully asynchronously.
 * Posts progress, completion, and failure messages to the conversation.
 * Never throws — all errors are swallowed after being persisted.
 */
function runExecutionInBackground(input: BackgroundRunInput): void {
  // Deliberately NOT awaited — caller returns immediately
  executeWorkAsync(input).catch(err => {
    console.error("[ExecutionCoordinator] Unhandled background execution error:", err?.message);
  });
}

async function executeWorkAsync(input: BackgroundRunInput): Promise<void> {
  const {
    organizationId,
    requesterId,
    taskId,
    userRequest,
    conversationId,
    correlationId,
  } = input;

  try {
    const result = await executeWork({
      organizationId,
      requesterId,
      userRequest,
      conversationId,
      correlationId,
      onProgress: async (stage: ExecutionStage) => {
        if (!conversationId) return;
        await postExecutionProgressToConversation(
          organizationId,
          conversationId,
          taskId ?? "",
          stage,
          correlationId,
        ).catch(err =>
          console.warn("[ExecutionCoordinator] Progress message failed:", err?.message),
        );
      },
    });

    // Audit outcome
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
      // Derive a human-readable title from the message
      const title = userRequest.slice(0, 80) + (userRequest.length > 80 ? "…" : "");
      await postCompletedWorkCreatedToConversation(
        organizationId,
        conversationId,
        taskId ?? "",
        result.completedWorkId,
        title,
        result.qualityScore ?? null,
        correlationId,
      ).catch(err =>
        console.warn("[ExecutionCoordinator] Completed work message failed:", err?.message),
      );

      // Mark intent as completed (if from an intent)
      if (input.intentId) {
        await db
          .update(executionIntentsTable)
          .set({ status: "completed", updatedAt: new Date() })
          .where(eq(executionIntentsTable.id, input.intentId))
          .catch(() => {});
      }
    } else if (result.outcome !== "completed" && conversationId) {
      await postExecutionFailedToConversation(
        organizationId,
        conversationId,
        taskId ?? "",
        result.message,
        correlationId,
      ).catch(err =>
        console.warn("[ExecutionCoordinator] Failure message failed:", err?.message),
      );
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
      await postExecutionFailedToConversation(
        organizationId,
        conversationId,
        taskId ?? "",
        message,
        correlationId,
      ).catch(() => {});
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Finds the conversation linked to a task (task_workroom type preferred).
 * Returns null if no conversation exists yet.
 */
async function resolveConversationForTask(
  organizationId: string,
  taskId: string,
): Promise<string | null> {
  const [workroom] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.primaryTaskId, taskId),
        eq(conversationsTable.conversationType, "task_workroom"),
      ),
    )
    .limit(1);

  if (workroom) return workroom.id;

  // Fall back to any conversation linked to this task
  const [any] = await db
    .select({ id: conversationsTable.id })
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.primaryTaskId, taskId),
      ),
    )
    .limit(1);

  return any?.id ?? null;
}
