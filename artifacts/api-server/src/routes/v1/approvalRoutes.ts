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

// ─── Approval-type → required resolver role ───────────────────────────────────
//
// Sprint 29M.3 — RBAC hardening.
//
// Maps each approval type to the minimum set of org roles that can resolve it.
// "authority" approvals (administrator_approval, owner_approval, dual_approval,
// compliance_approval) require administrator or owner so that managers cannot
// self-approve governance decisions.
//
// platform_approval is not resolvable at org level — reject with a clear code.
const APPROVAL_RESOLVER_ROLES: Record<string, string[]> = {
  manager_approval:       ["manager", "administrator", "owner"],
  administrator_approval: ["administrator", "owner"],
  owner_approval:         ["owner"],
  dual_approval:          ["administrator", "owner"],
  compliance_approval:    ["administrator", "owner"],
  platform_approval:      [],   // handled by /v1/platform/... endpoints only
  no_approval:            [],   // an approval record should not exist for this type
};

function checkApprovalResolverRole(
  actorRole: string,
  approvalType: string,
): { code: string; message: string; requiredRoles: string[] } | null {
  const allowed = APPROVAL_RESOLVER_ROLES[approvalType] ?? [];
  if (allowed.length === 0) {
    return {
      code: "APPROVAL_NOT_RESOLVABLE_HERE",
      message: `Approvals of type '${approvalType}' cannot be resolved through this endpoint.`,
      requiredRoles: [],
    };
  }
  if (!allowed.includes(actorRole)) {
    return {
      code: "INSUFFICIENT_ROLE",
      message: `Resolving a '${approvalType}' approval requires one of the following roles: ${allowed.join(", ")}.`,
      requiredRoles: allowed,
    };
  }
  return null;
}

// POST /v1/organisations/:slug/approvals/:approvalId/resolve
router.post("/:approvalId/resolve", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const {
      action,
      notes,
      // Sprint 29M.3 — owner-only override for single-person orgs where self-approval
      // is unavoidable. Must be explicit — never silently bypasses SoD check.
      forceSelfApproval,
      forceSelfApprovalReason,
    } = req.body as {
      action?: "approved" | "rejected";
      notes?: string;
      forceSelfApproval?: boolean;
      forceSelfApprovalReason?: string;
    };

    if (!action || !["approved", "rejected"].includes(action)) {
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

    // ── Step 2: Role check based on approval type (RED-3 fix) ─────────────────
    const actorRole = ctx.role as string;
    const roleError = checkApprovalResolverRole(actorRole, pending.approvalType);
    if (roleError) {
      res.status(403).json({ error: roleError });
      return;
    }

    // ── Step 3: Segregation of duties — block self-approval (RED-4 fix) ───────
    // Only enforced for the 'approved' action; a requester can reject their own
    // work without SoD concern. Platform_approval type has no task, skip check.
    if (action === "approved" && pending.taskId) {
      const originatingTask = await getTaskById(pending.taskId, ctx.tenantId);
      if (originatingTask?.originatingUserId && originatingTask.originatingUserId === user.id) {
        // Owner-only bypass for single-person organisations. Must be explicitly
        // requested and is audit-logged as a distinct override event.
        if (!forceSelfApproval || actorRole !== "owner") {
          res.status(409).json({
            error: {
              code: "SELF_APPROVAL_BLOCKED",
              message:
                "Self-approval is not permitted. A different member of your organisation must approve this work. " +
                (actorRole === "owner"
                  ? "As organisation owner you may force-approve using { forceSelfApproval: true, forceSelfApprovalReason: '<reason>' } for single-person org scenarios — this action will be audit logged."
                  : "Contact an administrator or owner of your organisation to approve this item."),
              canForce: actorRole === "owner",
            },
          });
          return;
        }

        // Log the owner override before proceeding
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
    }

    // ── Step 4: Resolve ───────────────────────────────────────────────────────
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
      metadata: { action, taskId: approval.taskId, approvalType: approval.approvalType },
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

// ─── GET /v1/organisations/:slug/governance/metrics (Sprint 29) ───────────────
router.get("/metrics", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const ctx = req.tenantContext!;
    const metrics = await computeGovernanceMetrics(ctx.tenantId);
    res.json({ metrics });
  } catch (err) {
    next(err);
  }
});

export default router;
