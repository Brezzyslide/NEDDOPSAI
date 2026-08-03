/**
 * Work Blueprints Router — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Routes:
 *   GET  /organisations/:slug/work-blueprints           — list blueprints
 *   POST /organisations/:slug/work-blueprints           — create custom blueprint
 *   PUT  /organisations/:slug/work-blueprints/:id       — update custom blueprint
 *   POST /organisations/:slug/work-executions           — trigger execution pipeline
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  listBlueprints,
  createCustomBlueprint,
  updateCustomBlueprint,
} from "../../services/workBlueprintService.js";
import { executeWork } from "../../services/workExecutionPipelineService.js";

const router = Router({ mergeParams: true });

function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Owner or admin role required." } });
    return false;
  }
  return true;
}

// ─── List blueprints ──────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/work-blueprints",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const blueprints = await listBlueprints(ctx.tenantId);
      res.json({ blueprints });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Create custom blueprint ──────────────────────────────────────────────────

router.post(
  "/organisations/:slug/work-blueprints",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const {
        code, title, version, objective, primarySpecialist,
        supportingSpecialists, requiredLibraryKnowledge, requiredEntityKnowledge,
        requiredMemories, requiredApprovals, validationRules, qualityRules,
        successCriteria, outputTypes, escalationRules, mandatoryCitations,
      } = req.body as Record<string, unknown>;

      if (!code || !title || !objective || !primarySpecialist) {
        res.status(400).json({ error: "code, title, objective, and primarySpecialist are required" });
        return;
      }

      const blueprint = await createCustomBlueprint(
        {
          code: String(code),
          title: String(title),
          version: version ? String(version) : undefined,
          objective: String(objective),
          primarySpecialist: String(primarySpecialist),
          supportingSpecialists: Array.isArray(supportingSpecialists) ? supportingSpecialists as string[] : [],
          requiredLibraryKnowledge: Array.isArray(requiredLibraryKnowledge) ? requiredLibraryKnowledge as string[] : [],
          requiredEntityKnowledge: (requiredEntityKnowledge as Record<string, unknown>) ?? {},
          requiredMemories: Array.isArray(requiredMemories) ? requiredMemories as string[] : [],
          requiredApprovals: (requiredApprovals as Record<string, unknown>) ?? {},
          validationRules: Array.isArray(validationRules) ? validationRules as never[] : [],
          qualityRules: Array.isArray(qualityRules) ? qualityRules as never[] : [],
          successCriteria: Array.isArray(successCriteria) ? successCriteria as string[] : [],
          outputTypes: Array.isArray(outputTypes) ? outputTypes as string[] : [],
          escalationRules: Array.isArray(escalationRules) ? escalationRules as never[] : [],
          mandatoryCitations: Array.isArray(mandatoryCitations) ? mandatoryCitations as string[] : [],
        },
        ctx.tenantId,
        user.id,
      );

      res.status(201).json({ blueprint });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Update custom blueprint ──────────────────────────────────────────────────

router.put(
  "/organisations/:slug/work-blueprints/:blueprintId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx          = req.tenantContext!;
      const user         = req.appUser!;
      const { blueprintId } = req.params as { blueprintId: string };
      const blueprint = await updateCustomBlueprint(blueprintId, req.body as never, ctx.tenantId, user.id);
      res.json({ blueprint });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Trigger work execution pipeline ─────────────────────────────────────────

router.post(
  "/organisations/:slug/work-executions",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const {
        userRequest,
        blueprintCode,
        blueprintId,
        taskUploadSourceIds,
        entityKnowledge,
        title,
        conversationId,
      } = req.body as Record<string, unknown>;

      if (!userRequest || typeof userRequest !== "string") {
        res.status(400).json({ error: "userRequest is required" });
        return;
      }

      const result = await executeWork({
        organizationId: ctx.tenantId,
        requesterId: user.id,
        userRequest,
        blueprintCode: blueprintCode ? String(blueprintCode) : undefined,
        blueprintId: blueprintId ? String(blueprintId) : undefined,
        taskUploadSourceIds: Array.isArray(taskUploadSourceIds) ? taskUploadSourceIds as string[] : undefined,
        entityKnowledge: (entityKnowledge as Record<string, unknown>) ?? undefined,
        title: title ? String(title) : undefined,
        conversationId: conversationId ? String(conversationId) : undefined,
      });

      const statusCode = result.outcome === "completed" ? 201
        : result.outcome === "validation_failed" ? 422
        : 500;

      res.status(statusCode).json(result);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
