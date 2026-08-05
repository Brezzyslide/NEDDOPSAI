/**
 * Task Workroom routes — Sprint 9
 *
 * GET  /v1/organisations/:slug/tasks/:taskId/workroom
 * POST /v1/organisations/:slug/tasks/:taskId/messages
 * POST /v1/organisations/:slug/tasks/:taskId/clarifications/:clarificationId/respond
 * POST /v1/organisations/:slug/tasks/:taskId/plan/request-changes
 * POST /v1/organisations/:slug/tasks/:taskId/commands
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import * as conversationService from "../../services/conversationService.js";
import * as taskService from "../../services/taskService.js";
import * as auditService from "../../services/auditService.js";
import { hasActiveCheckpoint } from "../../services/executionCheckpointStore.js";
import { resumeFromCheckpoint } from "../../services/executionCoordinatorService.js";
import { db } from "@workspace/db";
import {
  approvalsTable,
  taskExecutionPlansTable,
  conversationMessagesTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import type { TaskState } from "@workspace/shared";

const router = Router({ mergeParams: true });

// ─── Get workroom (conversation + task detail for the full workroom page) ──────
router.get("/workroom", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const plan = await taskService.getTaskPlan(taskId);
    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);
    const messages = await conversationService.getMessages(ctx.tenantId, conv.id, { limit: 100 });
    const unreadCount = await conversationService.getUnreadCount(ctx.tenantId, conv.id, user.id);

    // Pending approval
    const [approval] = await db
      .select()
      .from(approvalsTable)
      .where(and(eq(approvalsTable.organizationId, ctx.tenantId), eq(approvalsTable.taskId, taskId), eq(approvalsTable.state, "pending")))
      .limit(1);

    res.json({
      task,
      plan: plan?.planData ?? null,
      conversation: conv,
      messages,
      unreadCount,
      pendingApproval: approval ?? null,
    });
  } catch (err) { next(err); }
});

// ─── Post message to task workroom ────────────────────────────────────────────
router.post("/messages", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };
    const { content } = req.body as { content?: string };

    if (!content || content.trim().length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content is required." } });
      return;
    }
    if (content.length > 8000) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Message too long." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);

    // SSE streaming — same pattern as conversation messages
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent({ type: "ack" });

    // Sprint 27.1 — Checkpoint resume: if this task's conversation has a paused
    // execution waiting for clarification, resume it with the user's reply.
    if (hasActiveCheckpoint(conv.id)) {
      resumeFromCheckpoint({
        conversationId: conv.id,
        organizationId: ctx.tenantId,
        requesterId: user.id,
        clarificationAnswer: content.trim(),
      }).catch(err =>
        console.warn("[taskWorkroom] Checkpoint resume failed (non-fatal):", err?.message),
      );
    }

    const result = await conversationService.processUserMessage(
      ctx.tenantId,
      conv.id,
      user.id,
      content.trim(),
      taskId,
    );

    const words = result.understanding.customerResponse.split(" ");
    for (const word of words) {
      sendEvent({ type: "token", content: word + " " });
      await new Promise(r => setTimeout(r, 8));
    }

    sendEvent({ type: "user_message", message: result.userMessage });
    sendEvent({
      type: "agent_message",
      message: result.agentMessage,
      understanding: {
        conversationMode: result.understanding.conversationMode,
        requestedTaskAction: result.understanding.requestedTaskAction,
        shouldCreateTask: result.understanding.shouldCreateTask,
        clarificationRequired: result.understanding.clarificationRequired,
        clarificationQuestions: result.understanding.clarificationQuestions,
        proposedTask: result.understanding.proposedTask,
        relatedWorkforceRoles: result.understanding.relatedWorkforceRoles,
      },
    });
    sendEvent({ type: "done" });
    res.end();

    auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "conversation.message_created",
      resourceType: "task",
      resourceId: taskId,
      metadata: { conversationId: conv.id, conversationMode: result.understanding.conversationMode },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

  } catch (err) {
    if (!res.headersSent) next(err);
    else { res.write(`data: ${JSON.stringify({ type: "error" })}\n\n`); res.end(); }
  }
});

// ─── Respond to clarification ─────────────────────────────────────────────────
router.post("/clarifications/:clarificationId/respond", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId, clarificationId } = req.params as { taskId: string; clarificationId: string };
    const { response } = req.body as { response?: string };

    if (!response || response.trim().length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "response is required." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);

    // Store the user's clarification response
    const userMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "user",
      senderUserId: user.id,
      messageType: "text",
      content: response.trim(),
      parentMessageId: clarificationId,
    });

    // Mark clarification resolved and generate acknowledgement
    const agentMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "text",
      content: "Thank you. I have recorded your response and will update the plan accordingly.",
      parentMessageId: clarificationId,
    });

    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "clarification.responded",
      resourceType: "task",
      resourceId: taskId,
      metadata: { clarificationId, conversationId: conv.id },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

    res.json({ userMessage: userMsg, agentMessage: agentMsg });
  } catch (err) { next(err); }
});

// ─── Request plan changes ──────────────────────────────────────────────────────
router.post("/plan/request-changes", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };
    const { feedback } = req.body as { feedback?: string };

    if (!feedback || feedback.trim().length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "feedback is required." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);

    await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "user",
      senderUserId: user.id,
      messageType: "text",
      content: `Plan change requested: ${feedback.trim()}`,
    });

    const agentMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "plan_revision",
      content: `Understood. I have recorded your feedback: "${feedback.trim()}". I will revise the plan and present an updated version for your review.`,
    });

    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "plan.change_requested",
      resourceType: "task",
      resourceId: taskId,
      metadata: { conversationId: conv.id, feedback },
      ...auditService.getRequestMeta(req),
    }).catch(() => {});

    res.json({ agentMessage: agentMsg });
  } catch (err) { next(err); }
});

// ─── Task commands ─────────────────────────────────────────────────────────────
// Recognised commands: approve_plan, reject_plan, pause, resume, cancel, retry, status, create_follow_up
router.post("/commands", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const user = req.appUser!;
    const { taskId } = req.params as { taskId: string };
    const { command, payload } = req.body as { command?: string; payload?: Record<string, unknown> };

    if (!command) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "command is required." } });
      return;
    }

    const task = await taskService.getTaskById(taskId, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }

    const conv = await conversationService.getOrCreateWorkroom(ctx.tenantId, taskId, user.id);
    const meta = auditService.getRequestMeta(req);

    let responseContent = "";
    let newState: TaskState | null = null;

    switch (command) {
      case "approve_plan":
        // Task must be in planning or awaiting_approval state
        if (!["planning", "awaiting_approval", "approved"].includes(task.currentState)) {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: `Cannot approve plan when task is in state: ${task.currentState}.` } });
          return;
        }
        newState = "approved";
        responseContent = "Plan approved. The task is now queued for execution.";
        break;

      case "reject_plan":
        if (!["planning", "awaiting_approval"].includes(task.currentState)) {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: "No plan to reject in current state." } });
          return;
        }
        newState = "cancelled";
        responseContent = "The plan has been rejected and the task cancelled. You can create a new task to start again.";
        break;

      case "cancel":
        if (["completed", "cancelled"].includes(task.currentState)) {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: "Task is already completed or cancelled." } });
          return;
        }
        newState = "cancelled";
        responseContent = "The task has been cancelled.";
        break;

      case "retry":
        if (task.currentState !== "failed") {
          res.status(422).json({ error: { code: "INVALID_TRANSITION", message: "Only failed tasks can be retried." } });
          return;
        }
        newState = "queued";
        responseContent = "The task has been queued for retry.";
        break;

      case "status":
        responseContent = `Current status: ${task.currentState.replace(/_/g, " ")}.`;
        break;

      default:
        res.status(400).json({ error: { code: "UNKNOWN_COMMAND", message: `Unknown command: ${command}.` } });
        return;
    }

    // Apply state transition
    if (newState) {
      await taskService.transitionTaskState(taskId, ctx.tenantId, newState);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "task.command_completed",
        resourceType: "task",
        resourceId: taskId,
        metadata: { command, newState },
        ...meta,
      }).catch(() => {});
    }

    // Post result to conversation thread
    const agentMsg = await conversationService.addMessage({
      organizationId: ctx.tenantId,
      conversationId: conv.id,
      taskId,
      senderType: "chief_of_staff",
      workforceRoleCode: "chief_of_staff",
      messageType: "status_change",
      content: responseContent,
      structuredContent: newState ? { type: "status_summary", data: { command, newState, taskId } } : null,
    });

    res.json({ ok: true, agentMessage: agentMsg, newState });
  } catch (err) { next(err); }
});

export default router;
