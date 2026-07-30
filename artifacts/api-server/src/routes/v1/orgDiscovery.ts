/**
 * Business Discovery routes — Sprint 14
 *
 * GET  /v1/organisations/:slug/discovery           — get progress + answers
 * POST /v1/organisations/:slug/discovery/screens/:screenKey — save screen answers
 * POST /v1/organisations/:slug/discovery/complete  — mark discovery complete
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import * as discoveryService from "../../services/discoveryService.js";
import * as auditService from "../../services/auditService.js";

const router = Router({ mergeParams: true });

// ── GET progress ───────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/discovery",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const progress = await discoveryService.getDiscoveryProgress(ctx.tenantId);
      res.json({
        screens: discoveryService.DISCOVERY_SCREENS,
        ...progress,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST save screen answers ───────────────────────────────────────────────────

router.post(
  "/organisations/:slug/discovery/screens/:screenKey",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:update"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const screenKey = req.params.screenKey;

      if (!discoveryService.DISCOVERY_SCREENS.includes(screenKey as any)) {
        res.status(422).json({
          error: {
            code: "INVALID_SCREEN",
            message: `Unknown screen: ${screenKey}. Valid screens: ${discoveryService.DISCOVERY_SCREENS.join(", ")}`,
          },
        });
        return;
      }

      const { answers } = req.body as { answers?: discoveryService.DiscoveryAnswer[] };

      if (!Array.isArray(answers)) {
        res.status(422).json({
          error: { code: "VALIDATION_ERROR", message: "answers must be an array." },
        });
        return;
      }

      await discoveryService.saveScreenAnswers({
        organizationId: ctx.tenantId,
        userId: user.id,
        screenKey,
        answers,
      });

      const progress = await discoveryService.getDiscoveryProgress(ctx.tenantId);

      res.json({ ok: true, completionPercentage: progress.completionPercentage });
    } catch (err) {
      next(err);
    }
  },
);

// ── POST complete discovery ────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/discovery/complete",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:update"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { agentGoals } = req.body as { agentGoals?: Record<string, string> };

      await discoveryService.completeDiscovery(ctx.tenantId, user.id, agentGoals);

      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId: user.id,
        eventType: "discovery.completed",
        resourceType: "organization",
        resourceId: ctx.tenantId,
        ...auditService.getRequestMeta(req),
      }).catch(() => {});

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
