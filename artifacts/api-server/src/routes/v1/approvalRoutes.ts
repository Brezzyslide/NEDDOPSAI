/**
 * Approval routes — /v1/organisations/:slug/approvals
 *
 * Create, list, and resolve approvals. Tenant-scoped.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import * as approvalService from "../../services/approvalService.js";
import * as auditService from "../../services/auditService.js";
import { dispatchWorkExecution } from "../../services/executionCoordinatorService.js";
import { getTaskById } from "../../services/taskService.js";
import type { ApprovalType, ApprovalState } from "@workspace/shared";

const router = Router({ mergeParams: true });

// GET /v1/organisations/:slug/approvals
router.get("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const { state } = req.query as { state?: ApprovalState };
    const approvals = await approvalService.getApprovalsByOrg(ctx.tenantId, state);
    res.json({ approvals, total: approvals.length });
  } catch (err) {
    next(err);
  }
});

// POST /v1/organisations/:slug/approvals
router.post("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const { taskId, approvalType, notes, expiresInHours } = req.body as {
      taskId?: string;
      approvalType?: ApprovalType;
      notes?: string;
      expiresInHours?: number;
    };

    if (!taskId || !approvalType) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "taskId and approvalType are required." } });
      return;
    }

    const approval = await approvalService.createApproval({
      taskId,
      organizationId: ctx.tenantId,
      approvalType,
      requestedByUserId: user.id,
      notes,
      expiresInHours,
    });

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "approval.requested",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { approvalType, taskId },
      ...meta,
    }).catch(() => {});

    res.status(201).json({ approval });
  } catch (err) {
    next(err);
  }
});

// GET /v1/organisations/:slug/approvals/:approvalId
router.get("/:approvalId", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const approval = await approvalService.getApprovalById(req.params.approvalId!, ctx.tenantId);
    if (!approval) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Approval not found." } });
      return;
    }
    const history = await approvalService.getApprovalHistory(approval.id);
    res.json({ approval, history });
  } catch (err) {
    next(err);
  }
});

// POST /v1/organisations/:slug/approvals/:approvalId/resolve
router.post("/:approvalId/resolve", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const { action, notes } = req.body as { action?: "approved" | "rejected"; notes?: string };

    if (!action || !["approved", "rejected"].includes(action)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "action must be 'approved' or 'rejected'." } });
      return;
    }

    const approval = await approvalService.resolveApproval({
      approvalId: req.params.approvalId!,
      organizationId: ctx.tenantId,
      action,
      actorUserId: user.id,
      notes,
    });

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: action === "approved" ? "approval.granted" : "approval.rejected",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { action, taskId: approval.taskId },
      ...meta,
    }).catch(() => {});

    // Sprint 27.1 — Unified approval execution:
    // When any approval is granted for a task, dispatch the work execution pipeline.
    // This covers Chat approvals, Governance Centre, Executive Dashboard, and Mobile —
    // all routes call POST /approvals/:id/resolve, so wiring it here covers every source.
    // The coordinator is idempotent and safe to call even if already dispatched.
    if (action === "approved" && approval.taskId) {
      getTaskById(approval.taskId, ctx.tenantId)
        .then(task => {
          if (!task) return;
          return dispatchWorkExecution({
            organizationId: ctx.tenantId,
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description ?? undefined,
            requesterId: user.id,
          });
        })
        .catch(err =>
          console.warn("[approvalRoutes] Post-approval dispatch failed (non-fatal):", err?.message),
        );
    }

    res.json({ approval, executionDispatched: action === "approved" && !!approval.taskId });
  } catch (err) {
    next(err);
  }
});

export default router;
