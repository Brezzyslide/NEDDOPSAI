/**
 * Execution routes — /v1/organisations/:slug/tasks/:taskId/execution
 *
 * Sprint 8: OpenClaw Runtime Integration
 *
 * Provides execution lifecycle management for approved tasks:
 *   POST   /                — submit approved task to runtime
 *   GET    /                — get current execution status
 *   POST   /cancel          — cancel running execution
 *   POST   /pause           — pause running execution
 *   POST   /resume          — resume paused execution
 *   GET    /events          — get execution event log
 *
 * All routes are tenant-scoped. Requires auth + tenant context.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as executionService from "../../services/executionService.js";
import * as auditService from "../../services/auditService.js";

const router = Router({ mergeParams: true });

// POST /v1/organisations/:slug/tasks/:taskId/execution
// Submit an approved task to the OpenClaw runtime for execution.
router.post(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("task:execute"),
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { taskId } = req.params as { taskId: string };

      const result = await executionService.submitTaskExecution({
        taskId,
        organizationId: ctx.tenantId,
        requestedByUserId: user.id,
      });

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "execution.submitted",
        resourceType: "task",
        resourceId: taskId,
        metadata: {
          executionId: result.executionId,
          outcome: result.outcome,
          runtimeExecutionId: result.runtimeExecutionId,
        },
        ...meta,
      }).catch(() => {});

      const status = result.outcome === "rejected" ? 422 : 202;
      res.status(status).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /v1/organisations/:slug/tasks/:taskId/execution
// Get the current execution status for a task.
router.get(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { taskId } = req.params as { taskId: string };

      const status = await executionService.getTaskExecutionStatus(taskId, ctx.tenantId);

      if (!status) {
        res.status(404).json({
          error: {
            code: "RESOURCE_NOT_FOUND",
            message: "No execution session found for this task.",
          },
        });
        return;
      }

      res.json(status);
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/tasks/:taskId/execution/cancel
router.post(
  "/cancel",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("task:execute"),
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { taskId } = req.params as { taskId: string };

      await executionService.cancelTaskExecution(taskId, ctx.tenantId);

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "execution.cancel_requested",
        resourceType: "task",
        resourceId: taskId,
        metadata: {},
        ...meta,
      }).catch(() => {});

      res.json({ success: true, message: "Cancellation requested." });
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/tasks/:taskId/execution/pause
router.post(
  "/pause",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("task:execute"),
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { taskId } = req.params as { taskId: string };

      await executionService.pauseTaskExecution(taskId, ctx.tenantId);

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "execution.pause_requested",
        resourceType: "task",
        resourceId: taskId,
        metadata: {},
        ...meta,
      }).catch(() => {});

      res.json({ success: true, message: "Pause requested." });
    } catch (err) {
      next(err);
    }
  },
);

// POST /v1/organisations/:slug/tasks/:taskId/execution/resume
router.post(
  "/resume",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("task:execute"),
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { taskId } = req.params as { taskId: string };

      await executionService.resumeTaskExecution(taskId, ctx.tenantId);

      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "execution.resume_requested",
        resourceType: "task",
        resourceId: taskId,
        metadata: {},
        ...meta,
      }).catch(() => {});

      res.json({ success: true, message: "Resume requested." });
    } catch (err) {
      next(err);
    }
  },
);

// GET /v1/organisations/:slug/tasks/:taskId/execution/events
router.get(
  "/events",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { taskId } = req.params as { taskId: string };
      const limit = Math.min(parseInt((req.query as any).limit ?? "50", 10), 200);

      const events = await executionService.getExecutionEvents(taskId, ctx.tenantId, limit);
      res.json({ events, total: events.length });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
