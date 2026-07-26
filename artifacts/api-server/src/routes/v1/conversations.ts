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

    const conv = await conversationService.createConversation({
      organizationId: ctx.tenantId,
      createdByUserId: user.id,
      title,
      conversationType: (conversationType as any) ?? "general_workforce",
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

    // Use the task from conversation or from body
    const resolvedTaskId = taskId ?? conv.primaryTaskId ?? undefined;

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

    // Process the message (classify + generate response)
    const result = await conversationService.processUserMessage(
      ctx.tenantId,
      req.params.conversationId!,
      user.id,
      content.trim(),
      resolvedTaskId,
    );

    // Stream the agent response text token by token (word-level simulation)
    const words = result.understanding.customerResponse.split(" ");
    let accumulated = "";
    for (const word of words) {
      accumulated += (accumulated ? " " : "") + word;
      sendEvent({ type: "token", content: (accumulated === word ? "" : " ") + word });
      // Tiny yield to allow flush — real LLM would stream here
      await new Promise(r => setTimeout(r, 8));
    }

    // Send the committed messages
    sendEvent({
      type: "user_message",
      message: result.userMessage,
    });

    sendEvent({
      type: "agent_message",
      message: result.agentMessage,
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

    // Prevent duplicate task creation (idempotency check)
    if (conv.primaryTaskId) {
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

    // Link conversation → task
    await conversationService.linkConversationToTask(ctx.tenantId, conv.id, result.task.id);

    // Post task_created message + plan card to thread
    await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId: result.task.id,
      senderType: "system",
      messageType: "task_created",
      content: `Task created: ${result.task.title}`,
      structuredContent: { type: "task_created", data: { taskId: result.task.id, title: result.task.title } },
    });

    await conversationService.postPlanToConversation(ctx.tenantId, conv.id, result.task.id, result.plan);

    // Post approval request card if required
    if (result.plan.requiresApproval) {
      const [approval] = await import("@workspace/db").then(db =>
        db.db.select().from(db.approvalsTable)
          .where(import("drizzle-orm").then(drizzle => drizzle.eq(db.approvalsTable.taskId, result.task.id)))
          .limit(1)
      ).catch(() => [undefined]);

      if (approval) {
        await conversationService.postApprovalRequestToConversation(
          ctx.tenantId,
          conv.id,
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
    }

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "task.created_from_conversation",
      resourceType: "task",
      resourceId: result.task.id,
      metadata: { conversationId: conv.id, title: result.task.title },
      ...meta,
    }).catch(() => {});

    res.status(201).json({
      task: result.task,
      plan: result.plan,
      specialists: result.specialists,
      conversationId: conv.id,
    });
  } catch (err) { next(err); }
});

// ─── Cancel streaming response ─────────────────────────────────────────────────
router.post("/:conversationId/cancel-response", requireAuth, resolveTenantFromSlug, async (_req, res) => {
  // Client-side cancel; this is a no-op on the server since SSE streams are closed
  // by the client dropping the connection. Acknowledged for UX purposes.
  res.json({ ok: true });
});

export default router;
