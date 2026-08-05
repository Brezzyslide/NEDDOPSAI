/**
 * Execution Inspector Routes — Sprint 27.4
 *
 * Provides runtime observability for platform owners, developers, and
 * organisation members without exposing execution internals.
 *
 * Routes:
 *   GET /v1/organisations/:slug/work/:id/inspector
 *       → look up by completedWorkId (most common — from Completed Work Viewer)
 *
 *   GET /v1/organisations/:slug/executions/:executionId/inspector
 *       → look up by executionId directly (from Active Work, Workroom, Dev Mode)
 *
 * RBAC:
 *   - Authenticated org members → only their own executions
 *   - Platform staff (identified by isPlatformOwner flag) → all executions
 *   - Unauthenticated → 401
 *
 * Security: never returns system prompts, embedding vectors, API keys,
 * chain-of-thought text, or LLM payloads.
 */

import { Router } from "express";
import {
  requireAuth,
  resolveTenantFromSlug,
} from "../../middlewares/tenantContext.js";
import {
  getExecutionInspection,
  getInspectionByCompletedWorkId,
  type InspectorActorRole,
} from "../../services/executionInspectorService.js";

const router = Router({ mergeParams: true });

// ─── Helper: determine actor role ────────────────────────────────────────────

function resolveActorRole(req: import("express").Request): InspectorActorRole {
  const user = req.appUser;
  // Platform owners are identified by the isPlatformOwner flag set during auth
  if (user && (user as Record<string, unknown>).isPlatformOwner === true) {
    return "platform_owner";
  }
  return "org_user";
}

// ─── GET /v1/organisations/:slug/work/:id/inspector ──────────────────────────

router.get(
  "/organisations/:slug/work/:id/inspector",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { id } = req.params as { id: string };
      const actorRole = resolveActorRole(req);

      const inspection = await getInspectionByCompletedWorkId(
        id,
        ctx.tenantId,
        user.id,
        actorRole,
      );

      if (!inspection) {
        return res.status(404).json({
          error: "NOT_FOUND",
          message: "No execution inspection found for this work item, or you do not have access.",
        });
      }

      return res.json(inspection);
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /v1/organisations/:slug/executions/:executionId/inspector ────────────

router.get(
  "/organisations/:slug/executions/:executionId/inspector",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const user = req.appUser!;
      const ctx = req.tenantContext!;
      const { executionId } = req.params as { executionId: string };
      const actorRole = resolveActorRole(req);

      const inspection = await getExecutionInspection(
        executionId,
        ctx.tenantId,
        user.id,
        actorRole,
      );

      if (!inspection) {
        return res.status(404).json({
          error: "NOT_FOUND",
          message: "No execution inspection found for this execution ID, or you do not have access.",
        });
      }

      return res.json(inspection);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
