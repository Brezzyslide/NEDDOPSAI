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
  approveIntent,
  rejectIntent,
} from "../../services/executionIntentService.js";

const router = Router({ mergeParams: true });

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

router.post(
  "/organisations/:slug/execution-intents/:intentId/approve",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { intentId } = req.params as { intentId: string };

      await approveIntent(intentId, ctx.tenantId, user.id);
      res.json({ success: true, intentId });
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
