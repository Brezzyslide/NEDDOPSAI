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
import { db, approvalsTable, tasksTable } from "@workspace/db";
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
  taskId:           string;
  title:            string;
  conversationId:   string;
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

  // 2. Link conversation → task (idempotent — the service handles duplicates)
  await conversationService.linkConversationToTask(organizationId, conversationId, task.id);

  // 3. Post task_created system message + plan card to the thread
  await conversationService.addMessage({
    organizationId,
    conversationId,
    taskId:      task.id,
    senderType:  "system",
    messageType: "task_created",
    content:     `Task created: ${task.title}`,
    structuredContent: {
      type: "task_created",
      data: { taskId: task.id, title: task.title, autoDispatched: true },
    },
  });

  await conversationService.postPlanToConversation(organizationId, conversationId, task.id, plan);

  // 4. Dispatch or post approval request
  //
  // Task-level dispatch gate: determined by the blueprint execution plan.
  // This gate controls whether the task starts executing at all.
  //
  // Sprint 29M: laneContext.requiresApproval controls the COMPLETED-WORK approval
  // lifecycle at the UEE level (via ExecutionRequest.laneContext → outputRequiresApproval
  // override in UEE). Enforcing the same flag at the dispatch gate would require
  // creating an approval record not produced by taskService.createTask(), which is
  // outside this path. The safe minimum is: completed-work always requires approval
  // for EVIDENCE_BEARING lanes (enforced in UEE), task dispatch follows blueprint plan.
  let dispatched     = false;
  let approvalId: string | undefined;

  if (plan.requiresApproval) {
    // Find the approval record created by createTask and post the approval card
    const [approval] = await db
      .select()
      .from(approvalsTable)
      .where(eq(approvalsTable.taskId, task.id))
      .limit(1)
      .catch(() => [undefined]);

    if (approval) {
      approvalId = approval.id;
      await conversationService.postApprovalRequestToConversation(
        organizationId,
        conversationId,
        task.id,
        approval.id,
        {
          requestedAction: `Execute: ${task.title}`,
          requestingRole:  "Chief of Staff",
          reason:          plan.reasoning,
          riskLevel:       "medium",
          approvalType:    plan.approvalType,
        },
      );
    }
  } else {
    // No approval required — dispatch work execution immediately in the background
    // Sprint 29M: forward laneContext so UEE can apply the evidence/claim-integrity override
    dispatchWorkExecution({
      organizationId,
      taskId:          task.id,
      taskTitle:       task.title,
      taskDescription: description,
      requesterId,
      conversationId,
      laneContext: laneContext ?? undefined,
    }).catch(err =>
      console.warn("[AutoDispatch] Background dispatch failed (non-fatal):", err?.message),
    );
    dispatched = true;
  }

  // Sprint 29M: record the execution lane so downstream audit and pipeline
  // can confirm the correct path was taken (professional_work vs evidence_bearing_work)
  await auditService.writeAuditEvent({
    organizationId,
    actorUserId:  requesterId,
    eventType:    "task.created_from_conversation",
    resourceType: "task",
    resourceId:   task.id,
    metadata: {
      conversationId,
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
    `[AutoDispatch] Task ${task.id} created from CoS intent` +
    (dispatched ? " — execution dispatched" : " — awaiting approval"),
  );

  return {
    taskId:           task.id,
    title:            task.title,
    conversationId,
    dispatched,
    requiresApproval: plan.requiresApproval,
    approvalId,
  };
}
