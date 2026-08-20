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
// Sprint 9.4 — Capability gate
import { identifyCapabilities } from "../../services/capabilityIdentificationService.js";
import { decideMixedCapabilityAccess } from "../../services/capabilityAccessDecisionService.js";
// Sprint 27 — Execution dispatch
import { dispatchWorkExecution } from "../../services/executionCoordinatorService.js";
import { cancelTaskExecution } from "../../services/executionService.js";
import { randomUUID } from "crypto";

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

    // Sprint 9.4 — Capability gate: identify required capabilities and check entitlements
    // before creating a task. Blocked capabilities must not become tasks.
    const taskText = `${title}${description ? `. ${description}` : ""}`;
    const correlationId = randomUUID();

    const capIdResult = await identifyCapabilities({
      organizationId: ctx.tenantId,
      userId: user.id,
      message: taskText,
    }).catch(() => null);

    if (capIdResult && capIdResult.requestedCapabilities.length > 0) {
      const mixed = await decideMixedCapabilityAccess(
        ctx.tenantId, user.id, capIdResult,
        { correlationId },
      ).catch(() => null);

      // Hard block: required capabilities are fully blocked
      if (mixed && !mixed.canProceedPartially && mixed.blockedCapabilities.length > 0) {
        const primaryBlocked = mixed.blockedCapabilities[0]!;
        await auditService.writeAuditEvent({
          organizationId: ctx.tenantId,
          actorUserId: user.id,
          eventType: "specialist.assignment_blocked_by_entitlement",
          resourceType: "task",
          resourceId: "pending",
          metadata: {
            title: title.trim(),
            blockedCapability: primaryBlocked.capabilityCode,
            reasonCode: primaryBlocked.reasonCode,
            requiredWorkforcePack: primaryBlocked.requiredWorkforcePack,
          },
          ...auditService.getRequestMeta(req),
        }).catch(() => {});

        res.status(403).json({
          error: {
            code: "CAPABILITY_NOT_ENTITLED",
            message: `This task requires the ${primaryBlocked.requiredWorkforcePack ? primaryBlocked.requiredWorkforcePack.charAt(0).toUpperCase() + primaryBlocked.requiredWorkforcePack.slice(1) + " Workforce Pack" : "a Workforce Pack"} which is not included in your current plan.`,
            capabilityDecision: {
              capabilityCode: primaryBlocked.capabilityCode,
              requestedLevel: primaryBlocked.requestedLevel,
              reasonCode: primaryBlocked.reasonCode,
              requiredWorkforcePack: primaryBlocked.requiredWorkforcePack,
              upgradeOptions: primaryBlocked.upgradeOptions,
            },
            blockedCapabilities: mixed.blockedCapabilities.map(d => ({
              capabilityCode: d.capabilityCode,
              requestedLevel: d.requestedLevel,
              reasonCode: d.reasonCode,
              requiredWorkforcePack: d.requiredWorkforcePack,
              upgradeOptions: d.upgradeOptions,
            })),
          },
        });
        return;
      }
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
    } else {
      // Sprint 27: no approval required — dispatch execution immediately in background.
      // No conversationId here (task created outside a conversation); the pipeline will
      // still run and produce completed_work. If the user navigates to the task workroom,
      // the resolved conversation will receive a completion message.
      dispatchWorkExecution({
        organizationId: ctx.tenantId,
        taskId: result.task.id,
        taskTitle: result.task.title,
        taskDescription: description,
        requesterId: user.id,
        conversationId: undefined,
      }).catch(err =>
        console.warn("[tasks] Background dispatch failed (non-fatal):", err?.message),
      );
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
    const result = await taskService.cancelTask(req.params.taskId!, ctx.tenantId, {
      cancelledBy: user.id,
      source: "tasks_route",
    });
    await cancelTaskExecution(req.params.taskId!, ctx.tenantId).catch(() => {});
    const updated = result.task;

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

    res.json({ task: updated, cancellationStatus: result.status });
  } catch (err) {
    next(err);
  }
});

export default router;
