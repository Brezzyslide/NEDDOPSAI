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
import { logOrgEvent } from "./auditService.js";
import type { ProcessMessageResult } from "./conversationService.js";
import type { ConversationUnderstanding } from "./conversationIntelligenceService.js";
import {
  cancelTaskFromConversation,
  classifyCanonicalConversationAction,
  getConversationFocus,
  getOpenConversationTasks,
  getPendingApprovalsForConversation,
  holdTaskFromConversation,
  isLikelyCheckpointAnswer,
  persistConversationFocus,
  resolveConversationReference,
  resolveSingleApproval,
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
      const result = await cancelTaskFromConversation({
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        taskId: resolution.resolvedTaskId!,
        actorUserId: input.userId,
      });
      response = result.status === "already_cancelled"
        ? "That task is already cancelled. I have not changed anything else."
        : "Cancelled. I have stopped that task and preserved its history.";
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
    case "STATUS_QUERY": {
      action = "status";
      mode = "status_request";
      const task = openTasks.find(t => t.id === resolution.resolvedTaskId);
      response = task
        ? `The task "${task.title}" is currently ${task.currentState.replace(/_/g, " ")}.`
        : "I could not resolve which task you want a status update on.";
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
