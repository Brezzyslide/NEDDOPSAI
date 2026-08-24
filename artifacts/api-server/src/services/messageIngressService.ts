/**
 * Message Ingress Service — Sprint 27.2
 *
 * Single authoritative entry-point for every user-authored conversational
 * message, regardless of source (general chat, task workroom, mobile, etc.).
 *
 * Flow:
 *  1. Validate and normalise the message.
 *  2. Resolve conversation (create workroom if needed for task messages).
 *  3. Persist the user message exactly once.
 *  4. Check for an active durable checkpoint.
 *  4a. Checkpoint found → record answer, atomically claim resume, fire
 *      resumeFromCheckpointById(), return checkpoint_resume result.
 *      Do NOT route through normal CoS classification.
 *  4b. No checkpoint → delegate to conversationService.processUserMessage().
 *  5. Return consistent IngressResult to the caller.
 *
 * Routes set up SSE/HTTP streaming themselves; this service handles
 * business logic and message persistence only.
 */

import { randomUUID } from "crypto";
import type { ConversationMessage } from "@workspace/db";
import { db, conversationMessagesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  addMessage,
  getOrCreateWorkroom,
  processUserMessage,
} from "./conversationService.js";
import {
  getActiveCheckpointByConversation,
  recordClarificationAnswer,
  beginResume,
} from "./executionCheckpointService.js";
import { resumeFromCheckpointById } from "./executionCoordinatorService.js";
import { autoCreateAndDispatch } from "./autoDispatchService.js";
import { logOrgEvent } from "./auditService.js";
import type { ProcessMessageResult } from "./conversationService.js";
import type { ConversationUnderstanding, StructuredContent } from "./conversationIntelligenceService.js";
import {
  cancelTaskFromConversation,
  classifyCanonicalConversationAction,
  getConversationFocus,
  getOpenConversationTasks,
  getPendingConversationConfirmation,
  getPendingApprovalsForConversation,
  holdTaskFromConversation,
  isLikelyCheckpointAnswer,
  markConversationConfirmationResolved,
  modifyTaskFromConversation,
  persistConversationFocus,
  persistConversationConfirmation,
  responseRequestsTaskConfirmation,
  resolvePendingConfirmationAnswer,
  resolveConversationReference,
  resolveSingleApproval,
  type PendingConversationConfirmation,
  type TaskReferenceCandidate,
} from "./conversationControlService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IngressInput {
  /** Raw message text from the user. */
  content: string;
  organizationId: string;
  /** The conversation to post into. Must already exist unless taskId is supplied. */
  conversationId?: string;
  /** If supplied and conversationId is absent, a workroom conversation is
   *  resolved or created for this task. */
  taskId?: string;
  userId: string;
  /** Idempotency key — prevents duplicate messages on network retry. */
  idempotencyKey?: string;
}

export type IngressResult =
  | {
      type: "checkpoint_resume";
      checkpointId: string;
      conversationId: string;
      userMessage: ConversationMessage;
      agentMessage: ConversationMessage;
    }
  | { type: "checkpoint_duplicate"; reason: string; conversationId: string }
  | {
      type: "normal";
      result: Awaited<ReturnType<typeof processUserMessage>>;
      conversationId: string;
    }
  | { type: "error"; message: string; conversationId: string };

// ─── Main entry-point ─────────────────────────────────────────────────────────

export async function handleIncomingMessage(input: IngressInput): Promise<IngressResult> {
  const { organizationId, userId, taskId } = input;
  const content = input.content.trim();

  // ── 1. Resolve conversation ───────────────────────────────────────────────

  let conversationId = input.conversationId;

  if (!conversationId && taskId) {
    try {
      const workroom = await getOrCreateWorkroom(organizationId, taskId, userId);
      conversationId = workroom.id;
    } catch (err) {
      const msg = (err as Error)?.message ?? "Could not resolve workroom";
      return { type: "error", message: msg, conversationId: "" };
    }
  }

  if (!conversationId) {
    return { type: "error", message: "conversationId is required", conversationId: "" };
  }

  if (input.idempotencyKey) {
    const [duplicateUserMessage] = await db
      .select({ id: conversationMessagesTable.id })
      .from(conversationMessagesTable)
      .where(and(
        eq(conversationMessagesTable.organizationId, organizationId),
        eq(conversationMessagesTable.conversationId, conversationId),
        eq(conversationMessagesTable.senderType, "user"),
        eq(conversationMessagesTable.senderUserId, userId),
        eq(conversationMessagesTable.correlationId, input.idempotencyKey),
      ))
      .limit(1);

    if (duplicateUserMessage) {
      await logOrgEvent({
        eventType: "message.ingress.duplicate_prevented",
        organizationId,
        actorType: "user",
        actorUserId: userId,
        resourceType: "conversation",
        resourceId: conversationId,
        metadata: { idempotencyKey: input.idempotencyKey },
      }).catch(() => {});
      return { type: "checkpoint_duplicate", reason: "duplicate_message", conversationId };
    }
  }

  // ── 2. Check for active durable checkpoint ────────────────────────────────

  const pendingConfirmation = await getPendingConversationConfirmation({
    organizationId,
    conversationId,
  }).catch(() => null);
  if (pendingConfirmation) {
    const confirmationResult = await maybeHandlePendingConfirmation({
      content,
      organizationId,
      conversationId,
      taskId,
      userId,
      idempotencyKey: input.idempotencyKey,
      confirmation: pendingConfirmation,
    });
    if (confirmationResult) {
      return { type: "normal", result: confirmationResult, conversationId };
    }
  }

  const checkpoint = await getActiveCheckpointByConversation(conversationId);
  const controlIntent = classifyCanonicalConversationAction(content);

  if (checkpoint && isLikelyCheckpointAnswer(content, checkpoint)) {
    // ── 3a. Clarification answer path ─────────────────────────────────────

    // Persist user message before anything else so it's durable
    const userMessage = await addMessage({
      organizationId,
      conversationId,
      taskId,
      senderType: "user",
      senderUserId: userId,
      messageType: "text",
      content,
      correlationId: input.idempotencyKey,
    });

    // Store the clarification answer against the checkpoint
    await recordClarificationAnswer(checkpoint.id, content).catch(() => {});

    // Atomic claim — prevents duplicate resume from two simultaneous replies
    const resumeResult = await beginResume(conversationId);

    if (!resumeResult.resumed) {
      await logOrgEvent({
        eventType: "checkpoint.duplicate_resume_prevented",
        organizationId,
        actorType: "user",
        actorUserId: userId,
        resourceType: "conversation",
        resourceId: conversationId,
        metadata: { checkpointId: checkpoint.id, reason: resumeResult.reason },
      }).catch(() => {});
      return {
        type: "checkpoint_duplicate",
        reason: resumeResult.reason ?? "already_resuming",
        conversationId,
      };
    }

    await logOrgEvent({
      eventType: "checkpoint.clarification_received",
      organizationId,
      actorType: "user",
      actorUserId: userId,
      resourceType: "conversation",
      resourceId: conversationId,
      metadata: {
        checkpointId: checkpoint.id,
        correlationId: checkpoint.correlationId,
        answerLength: content.length,
      },
    }).catch(() => {});

    // Post an acknowledgment message from the CoS
    const agentMessage = await addMessage({
      organizationId,
      conversationId,
      taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "execution_update",
      content: "Received. Continuing the work from where we left off…",
    });

    // Fire resume in background — non-blocking so the HTTP response can
    // acknowledge immediately.
    resumeFromCheckpointById({
      checkpointId:        checkpoint.id,
      checkpoint:          resumeResult.checkpoint ?? ({} as any),
      conversationId,
      organizationId,
      requesterId:         userId,
      clarificationAnswer: content,
    }).catch(err =>
      console.warn("[MessageIngress] Checkpoint resume failed (non-fatal):", err?.message),
    );

    return {
      type: "checkpoint_resume",
      checkpointId: checkpoint.id,
      conversationId,
      userMessage,
      agentMessage,
    };
  }

  if (checkpoint) {
    await logOrgEvent({
      eventType: "checkpoint.deferred_unrelated_message",
      organizationId,
      actorType: "user",
      actorUserId: userId,
      resourceType: "conversation",
      resourceId: conversationId,
      metadata: {
        checkpointId: checkpoint.id,
        classifiedIntent: controlIntent,
        taskId: checkpoint.taskId,
      },
    }).catch(() => {});
  }

  const controlResult = await maybeHandleDeterministicControl({
    content,
    organizationId,
    conversationId,
    taskId,
    userId,
    intent: controlIntent,
    idempotencyKey: input.idempotencyKey,
  });
  if (controlResult) {
    return { type: "normal", result: controlResult, conversationId };
  }

  // ── 3b. Normal CoS message path ───────────────────────────────────────────
  // processUserMessage persists both user and agent messages internally.

  try {
    const result = await processUserMessage(organizationId, conversationId, userId, content, taskId, input.idempotencyKey);

    if (
      result.understanding.proposedTask &&
      responseRequestsTaskConfirmation(result.understanding.customerResponse)
    ) {
      await persistConversationConfirmation({
        organizationId,
        conversationId,
        action: "NEW_TASK",
        proposedTask: result.understanding.proposedTask,
        expectedResponse: "yes_no",
        reason: "task_proposal_confirmation",
      }).catch(() => {});
    }

    await logOrgEvent({
      eventType: "message.ingress.normal",
      organizationId,
      actorType: "user",
      actorUserId: userId,
      resourceType: "conversation",
      resourceId: conversationId,
      metadata: {
        conversationMode: result.understanding.conversationMode,
        shouldCreateTask: result.understanding.shouldCreateTask,
      },
    }).catch(() => {});

    return { type: "normal", result, conversationId };
  } catch (err) {
    return {
      type: "error",
      message: (err as Error)?.message ?? "Message processing failed",
      conversationId,
    };
  }
}

function controlUnderstanding(params: {
  mode: ConversationUnderstanding["conversationMode"];
  confidence: number;
  action?: ConversationUnderstanding["requestedTaskAction"];
  response: string;
  existingTaskId?: string;
  clarification?: string[];
}): ConversationUnderstanding {
  return {
    conversationMode: params.mode,
    confidence: params.confidence,
    existingTaskId: params.existingTaskId,
    clarificationRequired: (params.clarification?.length ?? 0) > 0,
    clarificationQuestions: params.clarification ?? [],
    shouldCreateTask: false,
    shouldUpdateTask: !!params.existingTaskId,
    requestedTaskAction: params.action,
    relatedWorkforceRoles: ["chief_of_staff"],
    customerResponse: params.response,
  };
}

async function addControlMessages(input: {
  organizationId: string;
  conversationId: string;
  taskId?: string;
  userId: string;
  content: string;
  response: string;
  idempotencyKey?: string;
  mode: ConversationUnderstanding["conversationMode"];
  action?: ConversationUnderstanding["requestedTaskAction"];
  confidence: number;
  messageType?: Parameters<typeof addMessage>[0]["messageType"];
  structuredContent?: StructuredContent | null;
}): Promise<ProcessMessageResult> {
  const userMessage = await addMessage({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    taskId: input.taskId,
    senderType: "user",
    senderUserId: input.userId,
    messageType: "text",
    content: input.content,
    correlationId: input.idempotencyKey,
  });
  const agentMessage = await addMessage({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    taskId: input.taskId,
    senderType: "chief_of_staff",
    workforceRoleCode: "chief_of_staff",
    messageType: input.messageType ?? "status_change",
    content: input.response,
    structuredContent: input.structuredContent ?? null,
  });
  return {
    userMessage,
    agentMessage,
    understanding: controlUnderstanding({
      mode: input.mode,
      confidence: input.confidence,
      action: input.action,
      response: input.response,
      existingTaskId: input.taskId,
    }),
    structuredContent: input.structuredContent ?? null,
  };
}

async function maybeHandlePendingConfirmation(input: {
  content: string;
  organizationId: string;
  conversationId: string;
  taskId?: string;
  userId: string;
  idempotencyKey?: string;
  confirmation: PendingConversationConfirmation;
}): Promise<ProcessMessageResult | null> {
  const answer = resolvePendingConfirmationAnswer(input.content, input.confirmation);
  if (answer.kind === "unrelated") return null;

  if (answer.kind === "decline") {
    await markConversationConfirmationResolved({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      confirmation: input.confirmation,
      status: "declined",
    }).catch(() => {});
    return addControlMessages({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: input.confirmation.taskId ?? input.taskId,
      userId: input.userId,
      content: input.content,
      response: input.confirmation.action === "CANCEL_TASK"
        ? "Okay, I have not cancelled it. The task remains active."
        : "Okay, I have not changed anything.",
      idempotencyKey: input.idempotencyKey,
      mode: input.confirmation.action === "CANCEL_TASK" ? "cancellation_request" : "task_followup",
      action: input.confirmation.action === "CANCEL_TASK" ? "cancel" : undefined,
      confidence: 0.98,
    });
  }

  if (answer.kind === "task_selection") {
    await markConversationConfirmationResolved({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      confirmation: input.confirmation,
      status: "resolved",
    }).catch(() => {});
    await persistConversationFocus({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: answer.candidate.taskId,
      reason: "explicit_task_selection",
      source: "explicit_switch",
    }).catch(() => {});

    if (input.confirmation.action === "CANCEL_TASK") {
      await persistConversationConfirmation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        action: "CANCEL_TASK",
        taskId: answer.candidate.taskId,
        taskTitle: answer.candidate.title,
        expectedResponse: "yes_no",
        reason: "task_selection_for_cancellation",
      });
      return addControlMessages({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: answer.candidate.taskId,
        userId: input.userId,
        content: input.content,
        response: `I need to confirm whether you want to cancel "${answer.candidate.title}". Reply yes to cancel it, or no to keep it active.`,
        idempotencyKey: input.idempotencyKey,
        mode: "cancellation_request",
        action: "cancel",
        confidence: 0.92,
        messageType: "question",
      });
    }

    if (input.confirmation.action === "STATUS_QUERY") {
      return addControlMessages({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: answer.candidate.taskId,
        userId: input.userId,
        content: input.content,
        response: `The task "${answer.candidate.title}" is currently ${answer.candidate.state.replace(/_/g, " ")}.`,
        idempotencyKey: input.idempotencyKey,
        mode: "status_request",
        action: "status",
        confidence: 0.92,
      });
    }

    return addControlMessages({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: answer.candidate.taskId,
      userId: input.userId,
      content: input.content,
      response: `Okay, focus is now on "${answer.candidate.title}".`,
      idempotencyKey: input.idempotencyKey,
      mode: "task_followup",
      confidence: 0.9,
    });
  }

  if (answer.kind === "confirm" && input.confirmation.action === "CANCEL_TASK" && input.confirmation.taskId) {
    const result = await cancelTaskFromConversation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: input.confirmation.taskId,
      actorUserId: input.userId,
    });
    await markConversationConfirmationResolved({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      confirmation: input.confirmation,
      status: "confirmed",
    }).catch(() => {});
    const title = input.confirmation.taskTitle ?? "that task";
    return addControlMessages({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: input.confirmation.taskId,
      userId: input.userId,
      content: input.content,
      response: result.status === "already_cancelled"
        ? `"${title}" is already cancelled. I have not changed anything else.`
        : `Cancelled. I have stopped "${title}" and preserved its history.`,
      idempotencyKey: input.idempotencyKey,
      mode: "cancellation_request",
      action: "cancel",
      confidence: 0.99,
    });
  }

  if (answer.kind === "confirm" && input.confirmation.action === "NEW_TASK" && input.confirmation.proposedTask) {
    const created = await autoCreateAndDispatch({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      requesterId: input.userId,
      proposedTask: input.confirmation.proposedTask,
    });
    await markConversationConfirmationResolved({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      confirmation: input.confirmation,
      status: "confirmed",
    }).catch(() => {});
    await persistConversationFocus({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: created.taskId,
      reason: "confirmed_task_proposal",
      source: "state_change",
    }).catch(() => {});
    return addControlMessages({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: created.taskId,
      userId: input.userId,
      content: input.content,
      response: `Created. I have opened "${created.title}" and prepared the work plan.`,
      idempotencyKey: input.idempotencyKey,
      mode: "task_confirmation",
      action: "create",
      confidence: 0.99,
      messageType: "task_created",
      structuredContent: {
        type: "task_created",
        data: {
          taskId: created.taskId,
          title: created.title,
          autoDispatched: created.dispatched,
          workroomConversationId: created.workroomConversationId,
        },
      },
    });
  }

  return null;
}

async function maybeHandleDeterministicControl(input: {
  content: string;
  organizationId: string;
  conversationId: string;
  taskId?: string;
  userId: string;
  intent: ReturnType<typeof classifyCanonicalConversationAction>;
  idempotencyKey?: string;
}): Promise<ProcessMessageResult | null> {
  const actionable = [
    "CANCEL_TASK",
    "PAUSE_TASK",
    "RESUME_TASK",
    "APPROVE_ACTION",
    "REJECT_ACTION",
    "MODIFY_TASK",
    "STATUS_QUERY",
    "SWITCH_TASK",
  ].includes(input.intent);
  if (!actionable) return null;

  const focus = await getConversationFocus({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
  }).catch(() => null);
  const openTasks = await getOpenConversationTasks({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    currentTaskId: input.taskId,
    focusedTaskId: focus?.taskId,
  }).catch(() => []);
  const pendingApprovals = await getPendingApprovalsForConversation({
    organizationId: input.organizationId,
    taskIds: openTasks.map(task => task.id),
  }).catch(() => []);

  const resolution = resolveConversationReference({
    text: input.content,
    intent: input.intent,
    focus,
    currentTaskId: input.taskId,
    activeTasks: openTasks,
    pendingApprovals,
  });

  const userMessage = await addMessage({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    taskId: resolution.resolvedTaskId ?? input.taskId,
    senderType: "user",
    senderUserId: input.userId,
    messageType: "text",
    content: input.content,
    correlationId: input.idempotencyKey,
  });

  let response: string;
  let mode: ConversationUnderstanding["conversationMode"] = "execution_query";
  let action: ConversationUnderstanding["requestedTaskAction"] | undefined;

  if (resolution.requiresClarification) {
    const options = resolution.candidateTasks.map(c => `- ${c.title} (${c.state})`).join("\n");
    const expectedResponse = resolution.candidateTasks.length > 0 ? "task_selection" : "yes_no";
    await persistConversationConfirmation({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      action: resolution.intent,
      candidateTasks: resolution.candidateTasks,
      expectedResponse,
      reason: resolution.reason,
    }).catch(() => {});
    response = resolution.intent === "APPROVE_ACTION" || resolution.intent === "REJECT_ACTION"
      ? "I need you to confirm which pending approval or action you mean before I change anything."
      : `I need you to confirm which task you mean before I change anything.${options ? `\n\n${options}` : ""}`;
    const agentMessage = await addMessage({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "question",
      content: response,
    });
    return {
      userMessage,
      agentMessage,
      understanding: controlUnderstanding({ mode, confidence: resolution.confidence, action, response, clarification: [response] }),
      structuredContent: null,
    };
  }

  switch (resolution.intent) {
    case "CANCEL_TASK": {
      action = "cancel";
      mode = "cancellation_request";
      const task = openTasks.find(t => t.id === resolution.resolvedTaskId);
      await persistConversationConfirmation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: resolution.resolvedTaskId!,
        taskTitle: task?.title,
        action: "CANCEL_TASK",
        expectedResponse: "yes_no",
        reason: resolution.reason,
      });
      response = task
        ? `I need to confirm whether you want to cancel "${task.title}". Reply yes to cancel it, or no to keep it active.`
        : "I need to confirm whether you want to cancel that task. Reply yes to cancel it, or no to keep it active.";
      break;
    }
    case "PAUSE_TASK": {
      action = "pause";
      await holdTaskFromConversation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: resolution.resolvedTaskId!,
        actorUserId: input.userId,
        hold: true,
      });
      response = "Held. I have marked that task as paused without completing or cancelling it.";
      break;
    }
    case "RESUME_TASK": {
      action = "resume";
      await holdTaskFromConversation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: resolution.resolvedTaskId!,
        actorUserId: input.userId,
        hold: false,
      });
      response = "Resumed. I have removed the hold and kept the task open.";
      break;
    }
    case "APPROVE_ACTION":
    case "REJECT_ACTION": {
      action = resolution.intent === "APPROVE_ACTION" ? "approve" : "reject";
      mode = "approval_response";
      if (!resolution.resolvedApprovalId) {
        const task = openTasks.find(t => t.id === resolution.resolvedTaskId);
        response = task
          ? `There is no concrete pending approval request for "${task.title}" right now. Its approval requirements are recorded, and the task is currently ${task.currentState.replace(/_/g, " ")}.`
          : "There is no concrete pending approval request to apply right now. I have not changed any task state.";
        break;
      }
      const result = await resolveSingleApproval({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        approvalId: resolution.resolvedApprovalId!,
        action: resolution.intent === "APPROVE_ACTION" ? "approved" : "rejected",
      });
      response = result.state === "approved"
        ? "Approved. I have applied that approval to the specific pending action."
        : "Rejected. I have applied that decision to the specific pending action.";
      break;
    }
    case "MODIFY_TASK": {
      action = "revise";
      mode = "task_followup";
      const result = await modifyTaskFromConversation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: resolution.resolvedTaskId!,
        actorUserId: input.userId,
        changeRequest: input.content,
      });
      response = result.status === "modified"
        ? `Updated the task specification for "${result.taskTitle ?? "that task"}" and moved it back into planning so the change is handled explicitly.`
        : "That task is already complete or cancelled, so I did not rewrite it. Create a revision task if you want to change the completed record.";
      break;
    }
    case "STATUS_QUERY": {
      action = "status";
      mode = "status_request";
      const task = openTasks.find(t => t.id === resolution.resolvedTaskId);
      if (task && /\b(how long|how much longer|eta|completion estimate|when (will|is|can).*(ready|done|finished|complete)|when.*(ready|done|finished|complete))\b/i.test(input.content)) {
        response = `I do not have a reliable completion estimate yet. The task "${task.title}" is currently ${task.currentState.replace(/_/g, " ")}.`;
      } else {
        response = task
          ? `The task "${task.title}" is currently ${task.currentState.replace(/_/g, " ")}.`
          : "I could not resolve which task you want a status update on.";
      }
      break;
    }
    case "SWITCH_TASK": {
      mode = "task_followup";
      const task = openTasks.find(t => t.id === resolution.resolvedTaskId);
      await persistConversationFocus({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: resolution.resolvedTaskId,
        reason: resolution.reason,
        source: "explicit_switch",
      });
      response = task
        ? `Okay, focus is back on "${task.title}".`
        : "Okay, I have updated the conversation focus.";
      break;
    }
    default:
      return null;
  }

  await persistConversationFocus({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    taskId: resolution.resolvedTaskId,
    reason: resolution.reason,
    source: "state_change",
  }).catch(() => {});

  const agentMessage = await addMessage({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    taskId: resolution.resolvedTaskId ?? input.taskId,
    senderType: "chief_of_staff",
    workforceRoleCode: "chief_of_staff",
    messageType: mode === "approval_response" ? "approval_decision" : "status_change",
    content: response,
  });

  await logOrgEvent({
    eventType: "conversation.control_applied",
    organizationId: input.organizationId,
    actorType: "user",
    actorUserId: input.userId,
    resourceType: "conversation",
    resourceId: input.conversationId,
    metadata: {
      intent: resolution.intent,
      taskId: resolution.resolvedTaskId,
      approvalId: resolution.resolvedApprovalId,
      confidence: resolution.confidence,
      reason: resolution.reason,
    },
  }).catch(() => {});

  return {
    userMessage,
    agentMessage,
    understanding: controlUnderstanding({ mode, confidence: resolution.confidence, action, response, existingTaskId: resolution.resolvedTaskId }),
    structuredContent: null,
  };
}
