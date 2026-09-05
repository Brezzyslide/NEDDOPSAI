/**
 * Approval routes — /v1/organisations/:slug/approvals
 *
 * Create, list, and resolve approvals. Tenant-scoped.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requireOrgRole } from "../../middlewares/requireOrgRole.js";
import * as approvalService from "../../services/approvalService.js";
import * as auditService from "../../services/auditService.js";
import { computeGovernanceMetrics } from "../../services/governanceMetricsService.js";
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

// ─── GET /v1/organisations/:slug/approvals/metrics (Sprint 29) ───────────────
router.get("/metrics", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const metrics = await computeGovernanceMetrics(ctx.tenantId);
    res.json({ metrics });
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
    const {
      action,
      decision,
      notes,
      // Sprint 29M.3 — owner-only override for single-person orgs where self-approval
      // is unavoidable. Must be explicit — never silently bypasses SoD check.
      forceSelfApproval,
      forceSelfApprovalReason,
    } = req.body as {
      action?: "approved" | "rejected";
      decision?: "approved" | "rejected";
      notes?: string;
      forceSelfApproval?: boolean;
      forceSelfApprovalReason?: string;
    };
    const requestedAction = action ?? decision;

    if (!requestedAction || !["approved", "rejected"].includes(requestedAction)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "action must be 'approved' or 'rejected'." } });
      return;
    }

    // ── Step 1: Fetch the approval record before resolving ────────────────────
    const pending = await approvalService.getApprovalById(
      req.params.approvalId!,
      ctx.tenantId,
    );
    if (!pending) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Approval not found." } });
      return;
    }

    const actorRole = ctx.role as string;

    const approval = await approvalService.resolveApprovalWithAuthorityAndTaskTransition({
      approvalId: req.params.approvalId!,
      organizationId: ctx.tenantId,
      action: requestedAction,
      actorUserId: user.id,
      actorRole,
      notes,
      forceSelfApproval,
    });

    if (forceSelfApproval && actorRole === "owner") {
      const meta = auditService.getRequestMeta(req);
      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "approval.self_approved_owner_override",
        resourceType: "approval",
        resourceId: pending.id,
        metadata: {
          approvalType: pending.approvalType,
          taskId: pending.taskId,
          forceSelfApprovalReason: forceSelfApprovalReason ?? "(no reason provided)",
        },
        ...meta,
      }).catch(() => {});
    }

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: requestedAction === "approved" ? "approval.granted" : "approval.rejected",
      resourceType: "approval",
      resourceId: approval.id,
      metadata: { action: requestedAction, taskId: approval.taskId, approvalType: approval.approvalType },
      ...meta,
    }).catch(() => {});

    // Sprint 27.1 — Unified approval execution:
    // When any approval is granted for a task, dispatch the work execution pipeline.
    // This covers Chat approvals, Governance Centre, Executive Dashboard, and Mobile —
    // all routes call POST /approvals/:id/resolve, so wiring it here covers every source.
    // The coordinator is idempotent and safe to call even if already dispatched.
    //
    // Sprint 29M: read laneContext from task.metadata (persisted by autoCreateAndDispatch)
    // and forward it so UEE applies the correct evidence/claim-integrity overrides even
    // when the task executed via the approval-delayed path.
    if (requestedAction === "approved" && approval.taskId) {
      getTaskById(approval.taskId, ctx.tenantId)
        .then(task => {
          if (!task) return;
          const taskMeta = (task.metadata ?? {}) as Record<string, unknown>;
          const laneContext = taskMeta.laneContext as import("../../services/unifiedExecutionEngine.js").ExecutionLaneContext | undefined;
          return dispatchWorkExecution({
            organizationId: ctx.tenantId,
            taskId: task.id,
            taskTitle: task.title,
            taskDescription: task.description ?? undefined,
            requesterId: user.id,
            laneContext,
          });
        })
        .catch(err =>
          console.warn("[approvalRoutes] Post-approval dispatch failed (non-fatal):", err?.message),
        );
    }

    res.json({ approval, executionDispatched: requestedAction === "approved" && !!approval.taskId });
  } catch (err) {
    next(err);
  }
});

// ─── POST /v1/organisations/:slug/approvals/bulk (Sprint 29) ─────────────────
// Batch resolve multiple system approvals in one request.
// Returns per-item success/failure — partial failures do NOT roll back successes.
//
// Sprint 29M.3: minimum role gate — member/viewer/auditor cannot bulk-resolve.
// For per-item approvalType enforcement, the single resolve endpoint is
// authoritative; bulk is a convenience wrapper with a floor gate.
router.post("/bulk", requireAuth, resolveTenantFromSlug, requireOrgRole("owner", "administrator", "manager"), async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx  = req.tenantContext!;
    const { approvalIds, action, notes } = req.body as {
      approvalIds?: string[];
      action?:      "approved" | "rejected";
      notes?:       string;
    };

    if (!Array.isArray(approvalIds) || approvalIds.length === 0) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "approvalIds array is required." } });
      return;
    }
    if (!action || !["approved", "rejected"].includes(action)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "action must be 'approved' or 'rejected'." } });
      return;
    }

    const outcome = await approvalService.bulkResolveApprovals({
      approvalIds: approvalIds.slice(0, 100),
      organizationId: ctx.tenantId,
      action,
      actorUserId: user.id,
      notes,
    });

    const meta = auditService.getRequestMeta(req);
    await auditService.writeAuditEvent({
      organizationId: ctx.tenantId,
      actorUserId: user.id,
      eventType: "approval.bulk_resolved",
      resourceType: "approval",
      resourceId: "bulk",
      metadata: { action, total: approvalIds.length, succeeded: outcome.succeeded, failed: outcome.failed },
      ...meta,
    }).catch(() => {});

    // Dispatch execution for each approved approval (non-fatal)
    if (action === "approved") {
      for (const r of outcome.results.filter(r => r.success)) {
        approvalService.getApprovalById(r.id, ctx.tenantId)
          .then(approval => {
            if (!approval?.taskId) return;
            return getTaskById(approval.taskId, ctx.tenantId).then(task => {
              if (!task) return;
              return dispatchWorkExecution({
                organizationId: ctx.tenantId,
                taskId: task.id,
                taskTitle: task.title,
                taskDescription: task.description ?? undefined,
                requesterId: user.id,
              });
            });
          })
          .catch(err => console.warn("[approvalRoutes/bulk] dispatch failed:", err?.message));
      }
    }

    res.json(outcome);
  } catch (err) {
    next(err);
  }
});

export default router;
