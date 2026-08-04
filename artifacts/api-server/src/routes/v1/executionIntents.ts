/**
 * Execution Intents routes — Sprint 10
 *
 * GET  /v1/organisations/:slug/tasks/:taskId/execution-intents
 * POST /v1/organisations/:slug/execution-intents/:intentId/approve
 * POST /v1/organisations/:slug/execution-intents/:intentId/reject
 *
 * All routes are tenant-scoped. No direct DB access — uses executionIntentService.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  getExecutionIntentsForTask,
  rejectIntent,
} from "../../services/executionIntentService.js";
import { coordinateIntentApproval } from "../../services/executionCoordinatorService.js";
import * as auditService from "../../services/auditService.js";
import { db, executionIntentsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router = Router({ mergeParams: true });

// ─── GET /organisations/:slug/execution-intents?status=pending_approval ──────
// Sprint 29: org-level listing so Approval Centre can surface pending intents.
router.get(
  "/organisations/:slug/execution-intents",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const status = (req.query.status as string | undefined) ?? "pending_approval";

      const intents = await db
        .select()
        .from(executionIntentsTable)
        .where(
          and(
            eq(executionIntentsTable.organizationId, ctx.tenantId),
            eq(executionIntentsTable.status, status),
          ),
        )
        .orderBy(desc(executionIntentsTable.createdAt))
        .limit(50);

      res.json({ intents, total: intents.length });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /organisations/:slug/tasks/:taskId/execution-intents ─────────────────

router.get(
  "/organisations/:slug/tasks/:taskId/execution-intents",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { taskId } = req.params as { taskId: string };

      const intents = await getExecutionIntentsForTask(taskId, ctx.tenantId);
      res.json({ intents, total: intents.length });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /organisations/:slug/execution-intents/:intentId/approve ────────────
//
// Sprint 27: approval now immediately triggers the Work Execution Pipeline.
// The response returns synchronously; execution runs in the background.

router.post(
  "/organisations/:slug/execution-intents/:intentId/approve",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { intentId } = req.params as { intentId: string };

      const result = await coordinateIntentApproval(intentId, ctx.tenantId, user.id);

      auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "execution_intent.approved",
        resourceType: "execution_intent",
        resourceId: intentId,
        metadata: { dispatched: result.dispatched, executionStarted: result.executionStarted },
        ...auditService.getRequestMeta(req),
      }).catch(() => {});

      res.json({
        success: true,
        intentId,
        executionDispatched: result.dispatched,
        executionStarted: result.executionStarted,
        skipReason: result.skipReason,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /organisations/:slug/execution-intents/:intentId/reject ─────────────

router.post(
  "/organisations/:slug/execution-intents/:intentId/reject",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { intentId } = req.params as { intentId: string };
      const { reason } = req.body as { reason?: string };

      if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "reason is required." },
        });
        return;
      }

      await rejectIntent(intentId, ctx.tenantId, user.id, reason.trim());
      res.json({ success: true, intentId });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
