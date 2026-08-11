/**
 * Work Blueprints Router — Sprint 22 + Sprint 28 (Blueprint Studio)
 *
 * Sprint 22:
 *   GET  /organisations/:slug/work-blueprints           — list blueprints
 *   POST /organisations/:slug/work-blueprints           — create custom blueprint
 *   PUT  /organisations/:slug/work-blueprints/:id       — update custom blueprint
 *   POST /organisations/:slug/work-executions           — trigger execution pipeline
 *
 * Sprint 28 additions:
 *   PATCH /organisations/:slug/work-blueprints/:id/archive
 *   PATCH /organisations/:slug/work-blueprints/:id/restore
 *   POST  /organisations/:slug/work-blueprints/:id/clone
 *   POST  /organisations/:slug/work-blueprints/:id/submit-for-review
 *   POST  /organisations/:slug/work-blueprints/:id/publish
 *   POST  /organisations/:slug/work-blueprints/:id/rollback
 *   GET   /organisations/:slug/work-blueprints/:id/versions
 *   GET   /organisations/:slug/work-blueprints/versions/:versionId
 *   POST  /organisations/:slug/work-blueprints/:id/test
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  listBlueprints,
  createCustomBlueprint,
  updateCustomBlueprint,
  getBlueprintById,
  getBlueprintForRole,
  archiveBlueprint,
  restoreBlueprint,
  cloneBlueprint,
  submitForReview,
  publishBlueprint,
  rollbackToVersion,
  getVersionHistory,
  getVersionById,
  testBlueprintSandbox,
} from "../../services/workBlueprintService.js";
import { executeWork } from "../../services/workExecutionPipelineService.js";
import {
  filterBlueprintsForRole,
  filterBlueprintVersionForRole,
  filterBlueprintVersionsForRole,
  isTenantPlatformAdmin,
  type BlueprintAccessContext,
} from "../../services/blueprintAccessControl.js";

const router = Router({ mergeParams: true });

function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "administrator") {
    res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Owner or administrator role required." } });
    return false;
  }
  return true;
}

function blueprintAccessContext(req: any): BlueprintAccessContext {
  const ctx = req.tenantContext!;
  return {
    tenantId: ctx.tenantId,
    role: ctx.role ?? null,
    isPlatformAdmin: isTenantPlatformAdmin(req),
  };
}

// ─── List blueprints ──────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/work-blueprints",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { search, status, specialist, sort, includeArchived } = req.query as Record<string, string | undefined>;

      const blueprints = await listBlueprints(ctx.tenantId, {
        search,
        status: status as any,
        specialist,
        sort: sort as any,
        includeArchived: includeArchived === "true",
      });

      res.json({ blueprints: filterBlueprintsForRole(blueprints as any, blueprintAccessContext(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Get single blueprint ─────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/work-blueprints/:blueprintId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { blueprintId } = req.params as { blueprintId: string };
      const role = isTenantPlatformAdmin(req) ? "platform_admin" : ctx.role;
      const blueprint = await getBlueprintForRole(blueprintId, ctx.tenantId, role as any);
      if (!blueprint) { res.status(404).json({ error: "Blueprint not found" }); return; }
      res.json({ blueprint });
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
        blueprintFamily, supportedModes, maturityState, purpose, primaryDeliverable,
        deliverableContract, evidenceContract, permittedOrgOverrides,
        defaultTemplateId, templateRequired, allowedOrgTemplateOverride, templateVersionPolicy,
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
          blueprintFamily: blueprintFamily ? String(blueprintFamily) : undefined,
          supportedModes: Array.isArray(supportedModes) ? supportedModes as string[] : undefined,
          maturityState: maturityState as any,
          purpose: purpose ? String(purpose) : undefined,
          primaryDeliverable: primaryDeliverable ? String(primaryDeliverable) : undefined,
          deliverableContract: (deliverableContract as any) ?? undefined,
          evidenceContract: (evidenceContract as any) ?? undefined,
          permittedOrgOverrides: (permittedOrgOverrides as any) ?? undefined,
          defaultTemplateId: defaultTemplateId ? String(defaultTemplateId) : undefined,
          templateRequired: typeof templateRequired === "boolean" ? templateRequired : undefined,
          allowedOrgTemplateOverride: typeof allowedOrgTemplateOverride === "boolean" ? allowedOrgTemplateOverride : undefined,
          templateVersionPolicy: templateVersionPolicy as any,
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

// ─── Archive ──────────────────────────────────────────────────────────────────

router.patch(
  "/organisations/:slug/work-blueprints/:blueprintId/archive",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { blueprintId } = req.params as { blueprintId: string };
      const blueprint = await archiveBlueprint(blueprintId, ctx.tenantId, user.id);
      res.json({ blueprint });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Restore ──────────────────────────────────────────────────────────────────

router.patch(
  "/organisations/:slug/work-blueprints/:blueprintId/restore",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { blueprintId } = req.params as { blueprintId: string };
      const blueprint = await restoreBlueprint(blueprintId, ctx.tenantId, user.id);
      res.json({ blueprint });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Clone ────────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/work-blueprints/:blueprintId/clone",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { blueprintId } = req.params as { blueprintId: string };
      const { title } = req.body as { title?: string };
      const blueprint = await cloneBlueprint(blueprintId, ctx.tenantId, user.id, title);
      res.status(201).json({ blueprint });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Submit for review ────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/work-blueprints/:blueprintId/submit-for-review",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { blueprintId } = req.params as { blueprintId: string };
      const blueprint = await submitForReview(blueprintId, ctx.tenantId, user.id);
      res.json({ blueprint });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Publish ──────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/work-blueprints/:blueprintId/publish",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { blueprintId } = req.params as { blueprintId: string };
      const { notes } = req.body as { notes?: string };
      const result = await publishBlueprint(blueprintId, ctx.tenantId, user.id, notes);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// ─── Rollback ─────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/work-blueprints/:blueprintId/rollback",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { blueprintId } = req.params as { blueprintId: string };
      const { versionId } = req.body as { versionId: string };
      if (!versionId) { res.status(400).json({ error: "versionId is required" }); return; }
      const blueprint = await rollbackToVersion(versionId, ctx.tenantId, user.id);
      res.status(201).json({ blueprint });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Version history ──────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/work-blueprints/:blueprintId/versions",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx = req.tenantContext!;
      const { blueprintId } = req.params as { blueprintId: string };
      const versions = await getVersionHistory(blueprintId, ctx.tenantId);
      res.json({ versions: filterBlueprintVersionsForRole(versions as any, blueprintAccessContext(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Single version by ID ─────────────────────────────────────────────────────
// Note: must be before /:blueprintId to avoid matching "versions" as a blueprintId

router.get(
  "/organisations/:slug/work-blueprints/versions/:versionId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx = req.tenantContext!;
      const { versionId } = req.params as { versionId: string };
      const version = await getVersionById(versionId, ctx.tenantId);
      if (!version) { res.status(404).json({ error: "Version not found" }); return; }
      res.json({ version: filterBlueprintVersionForRole(version as any, blueprintAccessContext(req)) });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Sandbox test ─────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/work-blueprints/:blueprintId/test",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx = req.tenantContext!;
      const { blueprintId } = req.params as { blueprintId: string };
      const { testRequest, uploadedDocumentTypes } = req.body as {
        testRequest?: string;
        uploadedDocumentTypes?: string[];
      };
      if (!testRequest) { res.status(400).json({ error: "testRequest is required" }); return; }

      const result = await testBlueprintSandbox({
        blueprintId,
        organizationId: ctx.tenantId,
        testRequest,
        uploadedDocumentTypes,
      });

      res.json(result);
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
  // Sprint 29M.3: direct pipeline trigger requires manager+ — members submit via
  // task/chat UI which routes through the approval flow, not this endpoint.
  (req, res, next) => {
    const role = req.tenantContext?.role;
    if (!role || !["owner", "administrator", "manager"].includes(role)) {
      res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Triggering work execution requires manager, administrator, or owner role." } });
      return;
    }
    next();
  },
  async (req, res, next) => {
    try {
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const {
        userRequest,
        blueprintCode,
        blueprintId,
        canonicalIntent,
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
        requesterRole: ctx.role,
        userRequest,
        blueprintCode: blueprintCode ? String(blueprintCode) : undefined,
        blueprintId: blueprintId ? String(blueprintId) : undefined,
        canonicalIntent: canonicalIntent ? String(canonicalIntent) : undefined,
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
