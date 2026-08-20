/**
 * Auto-Dispatch Service — Task #27
 *
 * When the Chief of Staff classifies a conversation message as high-confidence
 * task intent (shouldCreateTask=true, confidence >= AUTO_EXECUTE_THRESHOLD),
 * this service creates the task, links it to the conversation, posts the plan
 * card, and fires execution — all without requiring the user to click
 * "Create Task" manually.
 *
 * The manual "Create Task" route is still available for lower-confidence cases.
 */

import { randomUUID as _uuid } from "crypto";
import * as taskService from "./taskService.js";
import * as conversationService from "./conversationService.js";
import * as auditService from "./auditService.js";
import { dispatchWorkExecution } from "./executionCoordinatorService.js";
import { db, tasksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Confidence threshold above which the CoS fires without user confirmation.
// 0.85 means the model must be ≥85% certain a task is wanted.
export const AUTO_EXECUTE_CONFIDENCE_THRESHOLD = 0.85;

/** Sprint 29M: execution lane context forwarded from the three-lane classifier */
export interface ExecutionLaneContext {
  executionClass:          "transient" | "professional_work" | "evidence_bearing";
  requiresCompletedWork:   boolean;
  requiresEvidence:        boolean;
  requiresClaimIntegrity:  boolean;
  requiresApproval:        boolean;
}

export interface AutoDispatchInput {
  organizationId: string;
  conversationId:  string;
  requesterId:     string;
  proposedTask: {
    title:               string;
    summary:             string;
    priority?:           string;
    requestedOutcome?:   string;
    knownConstraints?:   string[];
  };
  /**
   * Sprint 29M: classification flags from executionClassifierService.
   * Forwarded to the audit log and task context so the execution pipeline
   * knows which lane (professional_work vs evidence_bearing_work) was selected.
   * Omitting this field is allowed for backward compatibility.
   */
  laneContext?: ExecutionLaneContext;
}

export interface AutoDispatchResult {
  taskId:                 string;
  title:                  string;
  /** The original general_workforce (or calling) conversation ID */
  conversationId:         string;
  /** The dedicated task_workroom conversation created/retrieved for this task */
  workroomConversationId: string;
  dispatched:       boolean;
  requiresApproval: boolean;
  approvalId?:      string;
}

/**
 * Create a task from the CoS's proposed intent, link it to the conversation,
 * post the plan card, and—if no approval is required—fire execution in the
 * background.  Returns a result the route can forward as a `task_auto_created`
 * SSE event so the frontend can show a deep-link to the new task.
 */
export async function autoCreateAndDispatch(
  input: AutoDispatchInput,
): Promise<AutoDispatchResult> {
  const { organizationId, conversationId, requesterId, proposedTask, laneContext } = input;

  // Build a rich description from the proposal fields
  const descriptionParts: string[] = [proposedTask.summary];
  if (proposedTask.requestedOutcome) {
    descriptionParts.push(`Requested outcome: ${proposedTask.requestedOutcome}`);
  }
  if (proposedTask.knownConstraints?.length) {
    descriptionParts.push(`Constraints: ${proposedTask.knownConstraints.join("; ")}`);
  }
  const description = descriptionParts.join("\n\n");

  // 1. Create the formal task + blueprint plan
  const result = await taskService.createTask({
    organizationId,
    originatingUserId: requesterId,
    title:             proposedTask.title.trim(),
    description,
    priority:          (proposedTask.priority as any) ?? "normal",
    originatingModule: "cos_auto_dispatch",
  });

  const { task, plan } = result;

  // 1b. Sprint 29M: persist laneContext in task.metadata so the approval-delayed
  // dispatch path (approvalRoutes.ts) can retrieve it when the task eventually executes.
  if (laneContext) {
    await db
      .update(tasksTable)
      .set({ metadata: { ...((task.metadata ?? {}) as object), laneContext } })
      .where(eq(tasksTable.id, task.id))
      .catch(err => console.warn("[AutoDispatch] laneContext metadata persist failed (non-fatal):", err?.message));
  }

  // 2. Create (or retrieve) the dedicated task_workroom for this task.
  //    The general_workforce conversation is the reusable front desk — it must NOT
  //    acquire primaryTaskId.  All execution-scoped messages (plan, approval, progress,
  //    completion) go into the workroom so they remain isolated per task.
  const workroom = await conversationService.getOrCreateWorkroom(
    organizationId,
    task.id,
    requesterId,
  );
  const workroomConversationId = workroom.id;

  // 3. Post task_created system message to the ORIGINAL conversation (front desk).
  //    This is the only message written into the general chat — the user sees that
  //    work has been created and can navigate to the workroom from the structured card.
  await conversationService.addMessage({
    organizationId,
    conversationId,
    taskId:      task.id,
    senderType:  "system",
    messageType: "task_created",
    content:     `Task created: ${task.title}`,
    structuredContent: {
      type: "task_created",
      data: { taskId: task.id, title: task.title, autoDispatched: true, workroomConversationId },
    },
  });

  // 4. Post the plan card into the WORKROOM (not the general chat).
  await conversationService.postPlanToConversation(organizationId, workroomConversationId, task.id, plan);

  // 5. Dispatch into the WORKROOM.
  //
  // `plan.requiresApproval` is a future completion/release requirement, not an
  // actionable pending approval. Execution starts, then taskService creates the
  // canonical approval row only when the real gate is reached.
  let dispatched = false;
  dispatchWorkExecution({
    organizationId,
    taskId:          task.id,
    taskTitle:       task.title,
    taskDescription: description,
    requesterId,
    conversationId:  workroomConversationId,   // ← workroom, not general chat
    laneContext:     laneContext ?? undefined,
  }).catch(err =>
    console.warn("[AutoDispatch] Background dispatch failed (non-fatal):", err?.message),
  );
  dispatched = true;

  // Sprint 29M: record the execution lane so downstream audit and pipeline
  // can confirm the correct path was taken (professional_work vs evidence_bearing_work)
  await auditService.writeAuditEvent({
    organizationId,
    actorUserId:  requesterId,
    eventType:    "task.created_from_conversation",
    resourceType: "task",
    resourceId:   task.id,
    metadata: {
      originatingConversationId: conversationId,
      workroomConversationId,
      title:          task.title,
      autoDispatched: dispatched,
      source:         "cos_auto_dispatch",
      ...(laneContext ? {
        executionClass:         laneContext.executionClass,
        requiresCompletedWork:  laneContext.requiresCompletedWork,
        requiresEvidence:       laneContext.requiresEvidence,
        requiresClaimIntegrity: laneContext.requiresClaimIntegrity,
        classifierRequiresApproval: laneContext.requiresApproval,
      } : {}),
    },
  }).catch(() => {});

  console.info(
    `[AutoDispatch] Task ${task.id} created — workroom ${workroomConversationId}` +
    (dispatched ? " — execution dispatched" : ""),
  );

  return {
    taskId:                 task.id,
    title:                  task.title,
    conversationId,
    workroomConversationId,
    dispatched,
    requiresApproval: plan.requiresApproval,
  };
}
