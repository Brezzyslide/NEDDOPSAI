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

  // ── 2. Check for active durable checkpoint ────────────────────────────────

  const checkpoint = await getActiveCheckpointByConversation(conversationId);

  if (checkpoint) {
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
      checkpoint:          resumeResult.checkpoint!,
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

  // ── 3b. Normal CoS message path ───────────────────────────────────────────
  // processUserMessage persists both user and agent messages internally.

  try {
    const result = await processUserMessage(organizationId, conversationId, userId, content, taskId);

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
