/**
 * Knowledge Hub — Specialist Training API (internal module name)
 * Customer-facing wording: "Train this specialist", "Add knowledge",
 *   "Choose Organisation Library sources", "Review what this specialist can use"
 *
 * These routes manage the per-specialist Knowledge Hub integration readiness
 * state machine — tracking whether each specialist has been configured with
 * Organisation Library sources, tested, and approved for live use.
 *
 * Routes:
 *   GET    /v1/organisations/:slug/knowledge/training
 *   GET    /v1/organisations/:slug/knowledge/training/:specialistId
 *   PATCH  /v1/organisations/:slug/knowledge/training/:specialistId
 *
 * Permission model:
 *   - Any authenticated org member may view training status.
 *   - Transitioning to 'ready' or 'suspended' requires owner or admin.
 *   - All other flag updates require any authenticated member
 *     (pipeline automation uses member-level access).
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  getOrCreateTrainingStatus,
  listAllTrainingStatuses,
  transitionTrainingStatus,
  updateTrainingFlags,
  TrainingStatusError,
} from "../../services/specialistTrainingStatusService.js";
import { TRAINING_STATUSES } from "@workspace/db";

const router = Router({ mergeParams: true });

// ─── List all ─────────────────────────────────────────────────────────────────

router.get(
  "/v1/organisations/:slug/knowledge/training",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const statuses = await listAllTrainingStatuses(ctx.tenantId);
      res.json({ trainingStatuses: statuses });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Get for specialist ───────────────────────────────────────────────────────

router.get(
  "/v1/organisations/:slug/knowledge/training/:specialistId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { specialistId } = req.params;

      // getOrCreate so callers always get a record even for new specialists
      const status = await getOrCreateTrainingStatus(ctx.tenantId, specialistId);
      res.json({ trainingStatus: status });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Update (transition or flag update) ───────────────────────────────────────

router.patch(
  "/v1/organisations/:slug/knowledge/training/:specialistId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { specialistId } = req.params;
      const role = ctx.role;

      const {
        status: newStatus,
        notes,
        configurationComplete,
        knowledgeSourcesApproved,
        retrievalTestPassed,
        sampleTaskPassed,
      } = req.body as Record<string, any>;

      // If a status transition is requested, use the transition service
      if (newStatus !== undefined) {
        if (!TRAINING_STATUSES.includes(newStatus)) {
          res.status(400).json({
            error: {
              code: "INVALID_STATUS",
              message: `Invalid status "${newStatus}". Must be one of: ${TRAINING_STATUSES.join(", ")}`,
            },
          });
          return;
        }

        const updated = await transitionTrainingStatus({
          organizationId: ctx.tenantId,
          specialistId,
          newStatus,
          actorUserId: user.id,
          actorRole: role,
          notes,
          flags: {
            configurationComplete,
            knowledgeSourcesApproved,
            retrievalTestPassed,
            sampleTaskPassed,
          },
        });

        res.json({ trainingStatus: updated });
        return;
      }

      // Otherwise update flags only (any member)
      const updated = await updateTrainingFlags({
        organizationId: ctx.tenantId,
        specialistId,
        actorUserId: user.id,
        configurationComplete,
        knowledgeSourcesApproved,
        retrievalTestPassed,
        sampleTaskPassed,
        notes,
      });

      res.json({ trainingStatus: updated });
    } catch (err) {
      if (err instanceof TrainingStatusError) {
        const status = err.code === "INSUFFICIENT_ROLE" ? 403 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

export default router;
