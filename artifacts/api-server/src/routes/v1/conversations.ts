/**
 * Conversation routes — Sprint 9
 *
 * GET    /v1/organisations/:slug/conversations
 * POST   /v1/organisations/:slug/conversations
 * GET    /v1/organisations/:slug/conversations/:conversationId
 * GET    /v1/organisations/:slug/conversations/:conversationId/messages
 * POST   /v1/organisations/:slug/conversations/:conversationId/messages  (SSE streaming)
 * POST   /v1/organisations/:slug/conversations/:conversationId/create-task
 * POST   /v1/organisations/:slug/conversations/:conversationId/cancel-response
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import * as conversationService from "../../services/conversationService.js";
import * as taskService from "../../services/taskService.js";
import * as auditService from "../../services/auditService.js";
import {
  dispatchWorkExecution,
} from "../../services/executionCoordinatorService.js";
import {
  subscribeToExecutionEvents,
  getBufferedEventsSince,
  type ExecutionEvent,
} from "../../services/executionEventBus.js";
import { handleIncomingMessage } from "../../services/messageIngressService.js";
import { getConversationTimeline } from "../../services/executionTimelineService.js";
import {
  autoCreateAndDispatch,
  AUTO_EXECUTE_CONFIDENCE_THRESHOLD,
} from "../../services/autoDispatchService.js";

const router = Router({ mergeParams: true });

// ─── List conversations ────────────────────────────────────────────────────────
router.get("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const conversations = await conversationService.getConversations(ctx.tenantId, user.id);
    res.json({ conversations, total: conversations.length });
  } catch (err) { next(err); }
});

// ─── Create conversation ───────────────────────────────────────────────────────
router.post("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { title, conversationType, primaryTaskId } = req.body as {
      title?: string;
      conversationType?: string;
      primaryTaskId?: string;
    };

    const resolvedType = (conversationType as string | undefined) ?? "general_workforce";

    // For general workforce chat (no task), find or return the existing conversation
    // rather than creating a new one on every page load.
    if (resolvedType === "general_workforce" && !primaryTaskId) {
      const { conversation, created } = await conversationService.findOrCreateGeneralConversation(
        ctx.tenantId,
        user.id,
      );
      if (created) {
        await auditService.writeAuditEvent({
          organizationId: ctx.tenantId,
          actorUserId: user.id,
          eventType: "conversation.created",
          resourceType: "conversation",
          resourceId: conversation.id,
          metadata: { conversationType: conversation.conversationType },
          ...auditService.getRequestMeta(req),
        }).catch(() => {});
      }
      res.status(created ? 201 : 200).json({ conversation });
      return;
    }

    const conv = await conversationService.createConversation({
      organizationId: ctx.tenantId,
      createdByUserId: user.id,
      title,
      conversationType: resolvedType as any,
      primaryTaskId,
    });

    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "conversation.created",
      resourceType: "conversation",
      resourceId: conv.id,
      metadata: { conversationType: conv.conversationType, primaryTaskId },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

    res.status(201).json({ conversation: conv });
  } catch (err) { next(err); }
});

// ─── Get conversation ──────────────────────────────────────────────────────────
router.get("/:conversationId", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const conv = await conversationService.getConversationById(ctx.tenantId, req.params.conversationId!);
    if (!conv) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found." } });
      return;
    }
    res.json({ conversation: conv });
  } catch (err) { next(err); }
});

// ─── Get messages ──────────────────────────────────────────────────────────────
router.get("/:conversationId/messages", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const { limit, before } = req.query as { limit?: string; before?: string };
    const conv = await conversationService.getConversationById(ctx.tenantId, req.params.conversationId!);
    if (!conv) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found." } });
      return;
    }
    const messages = await conversationService.getMessages(
      ctx.tenantId,
      req.params.conversationId!,
      { limit: limit ? parseInt(limit, 10) : 50, before },
    );
    res.json({ messages, total: messages.length });
  } catch (err) { next(err); }
});

// ─── Post message (SSE streaming) ─────────────────────────────────────────────
router.post("/:conversationId/messages", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { content, taskId } = req.body as { content?: string; taskId?: string };

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content is required." } });
      return;
    }
    if (content.length > 8000) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Message too long (max 8000 characters)." } });
      return;
    }

    const conv = await conversationService.getConversationById(ctx.tenantId, req.params.conversationId!);
    if (!conv) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found." } });
      return;
    }

    // Resolve taskId from the request body first.
    // For task_workroom conversations, fall back to their permanent primaryTaskId so that
    // clarification replies, checkpoint resumes, and reruns stay bound to the correct task.
    // For general_workforce conversations the primaryTaskId must NOT be inherited — the
    // front-desk chat is reusable across many independent tasks and must never be
    // permanently locked to whichever task was created first.
    const resolvedTaskId =
      taskId ??
      (conv.conversationType === "task_workroom" ? conv.primaryTaskId ?? undefined : undefined);

    // Set SSE headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Send acknowledgement
    sendEvent({ type: "ack" });

    // Sprint 27.2 — Unified message ingress (checkpoint routing + CoS classification).
    // MessageIngressService detects an active checkpoint and routes accordingly,
    // preventing clarification replies from going through normal CoS classification.
    const ingressResult = await handleIncomingMessage({
      content: content.trim(),
      organizationId: ctx.tenantId,
      conversationId: req.params.conversationId!,
      taskId: resolvedTaskId,
      userId: user.id,
    });

    if (ingressResult.type === "checkpoint_resume") {
      sendEvent({ type: "user_message",  message: ingressResult.userMessage });
      sendEvent({ type: "agent_message", message: ingressResult.agentMessage ?? null });
      sendEvent({ type: "done" });
      res.end();
      return;
    }

    if (ingressResult.type === "checkpoint_duplicate") {
      sendEvent({ type: "done" });
      res.end();
      return;
    }

    if (ingressResult.type === "error") {
      sendEvent({ type: "error", message: ingressResult.message });
      res.end();
      return;
    }

    const result = ingressResult.result;

    // Stream the agent response text token by token (word-level simulation)
    const words = result.understanding.customerResponse.split(" ");
    let accumulated = "";
    for (const word of words) {
      accumulated += (accumulated ? " " : "") + word;
      sendEvent({ type: "token", content: (accumulated === word ? "" : " ") + word });
      await new Promise(r => setTimeout(r, 8));
    }

    // Send the committed messages
    sendEvent({ type: "user_message", message: result.userMessage });
    sendEvent({
      type: "agent_message",
      // Coerce to null (never undefined) so JSON.stringify always includes the
      // "message" key.  undefined causes the key to be omitted, making
      // evt.message === undefined on the client, which crashes the Sprint 27.2
      // idempotent handler at `msg.id` before it can guard against the value.
      message: result.agentMessage ?? null,
      understanding: {
        conversationMode: result.understanding.conversationMode,
        confidence: result.understanding.confidence,
        shouldCreateTask: result.understanding.shouldCreateTask,
        clarificationRequired: result.understanding.clarificationRequired,
        clarificationQuestions: result.understanding.clarificationQuestions,
        requestedTaskAction: result.understanding.requestedTaskAction,
        proposedTask: result.understanding.proposedTask,
        relatedWorkforceRoles: result.understanding.relatedWorkforceRoles,
      },
    });

    // Task #27 — Auto-dispatch: if CoS proposes a task with high confidence and
    // this conversation has no linked task yet, create + dispatch without user clicking.
    // Sprint 29H.2: also fires when the action decision resolves create_new_work
    // (bypasses the hardcoded shouldCreateTask=false in parseAndValidateLLMResponse).
    // Sprint 29M: three-lane classifier gates this path — TRANSIENT requests stay in
    // Chat and must NOT enter the work-product lifecycle regardless of CoS signals.
    const isTransientRequest = result.executionClassification?.executionClass === "transient";
    if (
      !isTransientRequest &&
      (result.understanding.shouldCreateTask || result.actionDecision?.action === "create_new_work") &&
      result.understanding.confidence >= AUTO_EXECUTE_CONFIDENCE_THRESHOLD &&
      result.understanding.proposedTask &&
      // A general_workforce conversation is the reusable front desk — it may create many
      // independent tasks over its lifetime, so we must never gate on primaryTaskId here.
      // A task_workroom already has a dedicated task; rerun/revise is the correct path there.
      conv.conversationType !== "task_workroom"
    ) {
      try {
        // Sprint 29M: forward the execution lane so auto-dispatch audit records
        // the classification (professional_work vs evidence_bearing_work) and
        // downstream pipeline can confirm the correct path was taken.
        const cls = result.executionClassification;
        const autoResult = await autoCreateAndDispatch({
          organizationId: ctx.tenantId,
          conversationId: conv.id,
          requesterId:    user.id,
          proposedTask:   result.understanding.proposedTask,
          laneContext: cls ? {
            executionClass:         cls.executionClass,
            requiresCompletedWork:  cls.requiresCompletedWork,
            requiresEvidence:       cls.requiresEvidence,
            requiresClaimIntegrity: cls.requiresClaimIntegrity,
            requiresApproval:       cls.requiresApproval,
          } : undefined,
        });
        sendEvent({ type: "task_auto_created", ...autoResult });
      } catch (err) {
        // Non-fatal — CoS response already delivered; don't surface task creation errors
        console.warn("[conversations] Auto-dispatch failed (non-fatal):", (err as Error)?.message);
      }
    }

    // Sprint 29H.2 (Part C) — Wire rerun_existing / revise_existing dispatch.
    // executionCoordinatorService is imported here (not in conversationService)
    // to avoid a circular dependency. Both actions reuse the existing taskId so
    // UEE selects the current routing (Sprint 29H fixed: OM for incident.review).
    //
    // Workroom routing: if this request originates from a general_workforce conversation
    // (user typed "redo the fatigue report" in the front desk chat), we must resolve the
    // task's dedicated workroom and route execution output there — not into the general chat.
    // If already in a task_workroom, the current conversation IS the workroom.
    if (
      (result.actionDecision?.action === "rerun_existing" ||
        result.actionDecision?.action === "revise_existing") &&
      result.actionDecision.taskId
    ) {
      const ad = result.actionDecision;
      const rerunConvIdPromise =
        conv.conversationType === "task_workroom"
          ? Promise.resolve(conv.id)
          : conversationService
              .getOrCreateWorkroom(ctx.tenantId, ad.taskId!, user.id)
              .then(wr => wr.id)
              .catch(() => conv.id); // fallback to originating conversation if workroom lookup fails

      rerunConvIdPromise.then(rerunConvId =>
        dispatchWorkExecution({
          organizationId: ctx.tenantId,
          taskId: ad.taskId!,
          taskTitle: ad.action === "revise_existing"
            ? "Revision of previous work"
            : "Rerun of previous work",
          taskDescription: `${ad.action === "revise_existing" ? "Revision" : "Rerun"} requested: ${content.trim()}${ad.completedWorkId ? ` (source: ${ad.completedWorkId})` : ""}`,
          requesterId: user.id,
          conversationId: rerunConvId,
        })
      ).catch(err =>
        console.warn("[conversations] Rerun/revise dispatch failed (non-fatal):", (err as Error)?.message),
      );
    }

    sendEvent({ type: "done" });
    res.end();

    // Audit (non-blocking)
    auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "conversation.message_created",
      resourceType: "conversation",
      resourceId: conv.id,
      metadata: {
        conversationMode: result.understanding.conversationMode,
        messageType: result.userMessage.messageType,
        taskId: resolvedTaskId,
      },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

    if (result.understanding.conversationMode === "task_intent") {
      auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "task.intent_detected",
        resourceType: "conversation",
        resourceId: conv.id,
        metadata: { proposedTask: result.understanding.proposedTask },
        ...auditService.getRequestMeta(req),
      }).catch(() => {});
    }

  } catch (err) {
    // If headers not sent, forward to error handler; otherwise end stream
    if (!res.headersSent) {
      next(err);
    } else {
      res.write(`data: ${JSON.stringify({ type: "error", message: "An error occurred." })}\n\n`);
      res.end();
    }
  }
});

// ─── Create task from conversation ────────────────────────────────────────────
router.post("/:conversationId/create-task", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { title, description, priority } = req.body as {
      title?: string;
      description?: string;
      priority?: string;
    };

    if (!title || title.trim().length < 3) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "title must be at least 3 characters." } });
      return;
    }

    const conv = await conversationService.getConversationById(ctx.tenantId, req.params.conversationId!);
    if (!conv) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found." } });
      return;
    }

    const isGeneralWorkforce = conv.conversationType === "general_workforce";

    // Idempotency guard: a task_workroom already has a permanent task binding, so reject
    // a second create-task call on it.  A general_workforce conversation is the reusable
    // front desk and may create many independent tasks, so we never reject based on
    // primaryTaskId there (it will remain NULL after this request regardless).
    if (!isGeneralWorkforce && conv.primaryTaskId) {
      res.status(409).json({ error: { code: "DUPLICATE_TASK", message: "This conversation already has a linked task." } });
      return;
    }

    // Create the formal task
    const result = await taskService.createTask({
      organizationId: ctx.tenantId,
      originatingUserId: user.id,
      title: title.trim(),
      description,
      priority: (priority as any) ?? "normal",
      originatingModule: "conversation",
    });

    // Create (or retrieve) the dedicated task_workroom.
    // General_workforce conversations must NOT acquire primaryTaskId — they are the
    // reusable front desk.  All execution-scoped messages go into the workroom instead.
    const workroom = await conversationService.getOrCreateWorkroom(
      ctx.tenantId,
      result.task.id,
      user.id,
    );
    const workroomConversationId = workroom.id;

    // Post task_created message to the ORIGINAL conversation (user sees it in general chat)
    await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId: result.task.id,
      senderType: "system",
      messageType: "task_created",
      content: `Task created: ${result.task.title}`,
      structuredContent: {
        type: "task_created",
        data: { taskId: result.task.id, title: result.task.title, workroomConversationId },
      },
    });

    // Plan card and all subsequent execution messages go into the WORKROOM
    await conversationService.postPlanToConversation(ctx.tenantId, workroomConversationId, result.task.id, result.plan);

    // Post approval request card if required; otherwise dispatch work immediately
    if (result.plan.requiresApproval) {
      const { db: wdb, approvalsTable: wAt } = await import("@workspace/db");
      const { eq: weq } = await import("drizzle-orm");
      const [approval] = await wdb
        .select()
        .from(wAt)
        .where(weq(wAt.taskId, result.task.id))
        .limit(1)
        .catch(() => [undefined]);

      if (approval) {
        await conversationService.postApprovalRequestToConversation(
          ctx.tenantId,
          workroomConversationId,   // ← workroom, not general chat
          result.task.id,
          approval.id,
          {
            requestedAction: `Execute: ${result.task.title}`,
            requestingRole: "Chief of Staff",
            reason: result.plan.reasoning,
            riskLevel: "medium",
            approvalType: result.plan.approvalType,
          },
        );
      }
    } else {
      // No approval required — dispatch work execution immediately in background.
      // Progress, checkpoints, and completion output go into the workroom.
      dispatchWorkExecution({
        organizationId: ctx.tenantId,
        taskId: result.task.id,
        taskTitle: result.task.title,
        taskDescription: description,
        requesterId: user.id,
        conversationId: workroomConversationId,   // ← workroom, not general chat
      }).catch(err =>
        console.warn("[conversations] Background dispatch failed (non-fatal):", err?.message),
      );
    }

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "task.created_from_conversation",
      resourceType: "task",
      resourceId: result.task.id,
      metadata: {
        originatingConversationId: conv.id,
        workroomConversationId,
        title: result.task.title,
        isGeneralWorkforce,
      },
      ...meta,
    }).catch(() => {});

    res.status(201).json({
      task: result.task,
      plan: result.plan,
      specialists: result.specialists,
      conversationId: conv.id,
      workroomConversationId,
    });
  } catch (err) { next(err); }
});

// ─── Execution progress SSE stream (Sprint 27.1) ──────────────────────────────
/**
 * GET /v1/organisations/:slug/conversations/:conversationId/execution-stream
 *
 * Server-Sent Events stream for live execution progress.
 * - Sends buffered events on reconnect (via Last-Event-ID header or ?lastEventId= query param).
 * - Heartbeat every 15 seconds.
 * - Closes after receiving a terminal event (completed / failed) or 5-minute idle timeout.
 *
 * Security: tenant-scoped — org slug resolved and verified before subscribing.
 * No internal names (manifest, pipeline, intent) ever appear in event payloads.
 */
router.get("/:conversationId/execution-stream", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const { conversationId } = req.params as { conversationId: string };

    const conv = await conversationService.getConversationById(ctx.tenantId, conversationId);
    if (!conv) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found." } });
      return;
    }

    // Last-Event-ID header or query param for reconnect catch-up
    const rawLastId = req.headers["last-event-id"] ?? req.query.lastEventId;
    const lastEventId = rawLastId ? parseInt(String(rawLastId), 10) : 0;

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const sendEvent = (event: ExecutionEvent) => {
      // Strip any internal field names from the payload before sending to client
      const safe = {
        id: event.eventId,
        type: event.type,
        humanLabel: event.humanLabel,
        completedWorkId: event.completedWorkId,
        errorMessage: event.errorMessage,
        clarificationQuestions: event.clarificationQuestions,
        timestamp: event.timestamp,
      };
      res.write(`id: ${event.eventId}\ndata: ${JSON.stringify(safe)}\n\n`);
    };

    const sendHeartbeat = () => {
      res.write(`: heartbeat\n\n`);
    };

    // Catch-up: replay any buffered events missed since lastEventId
    const missed = getBufferedEventsSince(conversationId, lastEventId);
    for (const e of missed) sendEvent(e);

    // Subscribe to live events
    const TERMINAL_TYPES = new Set(["execution_completed", "execution_failed"]);
    let isTerminated = false;

    const cleanup = subscribeToExecutionEvents(conversationId, (event) => {
      if (isTerminated) return;
      sendEvent(event);
      if (TERMINAL_TYPES.has(event.type)) {
        isTerminated = true;
        clearInterval(heartbeatTimer);
        clearTimeout(idleTimeout);
        res.end();
      }
    });

    // Heartbeat every 15 seconds
    const heartbeatTimer = setInterval(sendHeartbeat, 15_000);

    // 5-minute idle timeout (in case execution never fires a terminal event)
    const idleTimeout = setTimeout(() => {
      if (!isTerminated) {
        isTerminated = true;
        cleanup();
        clearInterval(heartbeatTimer);
        res.write(`data: ${JSON.stringify({ type: "timeout", humanLabel: "Stream closed after inactivity." })}\n\n`);
        res.end();
      }
    }, 5 * 60 * 1000);

    // Clean up on client disconnect
    req.on("close", () => {
      isTerminated = true;
      cleanup();
      clearInterval(heartbeatTimer);
      clearTimeout(idleTimeout);
    });

  } catch (err) {
    if (!res.headersSent) next(err);
    else res.end();
  }
});

// ─── Execution timeline (Sprint 27.1) ─────────────────────────────────────────
/**
 * GET /v1/organisations/:slug/conversations/:conversationId/execution-timeline
 *
 * Returns a chronological execution timeline built from the conversation's
 * execution_update messages. No new DB tables — derived from existing messages.
 * Surfaced in: Completed Work, Governance Centre, Audit, Workforce Ops.
 */
router.get("/:conversationId/execution-timeline", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const { conversationId } = req.params as { conversationId: string };

    const conv = await conversationService.getConversationById(ctx.tenantId, conversationId);
    if (!conv) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Conversation not found." } });
      return;
    }

    const timeline = await getConversationTimeline(ctx.tenantId, conversationId);
    res.json({ timeline });
  } catch (err) { next(err); }
});

// ─── Cancel streaming response ─────────────────────────────────────────────────
router.post("/:conversationId/cancel-response", requireAuth, resolveTenantFromSlug, async (_req, res) => {
  // Client-side cancel; this is a no-op on the server since SSE streams are closed
  // by the client dropping the connection. Acknowledged for UX purposes.
  res.json({ ok: true });
});

export default router;
