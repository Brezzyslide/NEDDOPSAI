/**
 * Task routes — /v1/organisations/:slug/tasks
 *
 * Full CRUD + state transitions for the task model.
 * All routes are tenant-scoped.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import * as taskService from "../../services/taskService.js";
import * as auditService from "../../services/auditService.js";
import type { TaskState, TaskPriority } from "@workspace/shared";

const router = Router({ mergeParams: true });

// GET /v1/organisations/:slug/tasks
router.get("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const { state } = req.query as { state?: string };
    const states = state ? (state.split(",") as TaskState[]) : undefined;
    const tasks = await taskService.getTasksByOrg(ctx.tenantId, states);
    res.json({ tasks, total: tasks.length });
  } catch (err) {
    next(err);
  }
});

// POST /v1/organisations/:slug/tasks
router.post("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const { title, description, priority, originatingModule } = req.body as {
      title?: string;
      description?: string;
      priority?: TaskPriority;
      originatingModule?: string;
    };

    if (!title || typeof title !== "string" || title.trim().length < 3) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "title must be at least 3 characters." } });
      return;
    }

    const result = await taskService.createTask({
      organizationId: ctx.tenantId,
      originatingUserId: user.id,
      title: title.trim(),
      description,
      priority,
      originatingModule,
    });

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "task.created",
      resourceType: "task",
      resourceId: result.task.id,
      metadata: {
        title: result.task.title,
        planId: result.plan.planId,
        assignedSpecialists: result.plan.assignedSpecialists,
        requiresApproval: result.plan.requiresApproval,
      },
      ...meta,
    }).catch(() => {});

    if (result.plan.requiresApproval) {
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "approval.requested",
        resourceType: "task",
        resourceId: result.task.id,
        metadata: { approvalType: result.plan.approvalType },
        ...meta,
      }).catch(() => {});
    }

    res.status(201).json({ task: result.task, plan: result.plan, specialists: result.specialists });
  } catch (err) {
    next(err);
  }
});

// GET /v1/organisations/:slug/tasks/:taskId
router.get("/:taskId", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const task = await taskService.getTaskById(req.params.taskId!, ctx.tenantId);
    if (!task) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Task not found." } });
      return;
    }
    const plan = await taskService.getTaskPlan(task.id);
    res.json({ task, plan: plan?.planData ?? null });
  } catch (err) {
    next(err);
  }
});

// POST /v1/organisations/:slug/tasks/:taskId/transition
router.post("/:taskId/transition", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const { state } = req.body as { state?: string };

    if (!state) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "state is required." } });
      return;
    }

    const updated = await taskService.transitionTaskState(req.params.taskId!, ctx.tenantId, state as TaskState);

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "task.state_changed",
      resourceType: "task",
      resourceId: updated.id,
      metadata: { newState: state },
      ...meta,
    }).catch(() => {});

    res.json({ task: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/organisations/:slug/tasks/:taskId (cancel)
router.delete("/:taskId", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const updated = await taskService.transitionTaskState(req.params.taskId!, ctx.tenantId, "cancelled");

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "task.cancelled",
      resourceType: "task",
      resourceId: updated.id,
      metadata: {},
      ...meta,
    }).catch(() => {});

    res.json({ task: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
