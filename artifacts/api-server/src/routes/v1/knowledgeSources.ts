/**
 * Knowledge Hub — Sources API (internal module name)
 * Customer-facing product name: Organisation Library
 *
 * These routes power the Organisation Library — the customer-facing knowledge
 * management surface — and the internal Knowledge Hub platform.
 *
 * API paths are intentionally generic (/knowledge/sources) so they can serve
 * all current and future Knowledge Hub source types without path changes.
 *
 * Customer-facing UI wording (never expose internal terms like RAG, chunks,
 * embeddings, or knowledge_sources to end users):
 *   - "Organisation Library"
 *   - "Add to Organisation Library" / "Save to Organisation Library"
 *   - "Organisation Library sources" / "Organisation Library access"
 *   - For task uploads: "Use for this task only" | "Save to Organisation Library"
 *
 * Routes:
 *   GET    /v1/organisations/:slug/knowledge/sources
 *   POST   /v1/organisations/:slug/knowledge/sources/request-upload
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/complete-upload
 *   GET    /v1/organisations/:slug/knowledge/sources/:sourceId
 *   PATCH  /v1/organisations/:slug/knowledge/sources/:sourceId
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/approve
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/revoke
 *   DELETE /v1/organisations/:slug/knowledge/sources/:sourceId
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/supersede
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/reprocess
 *   GET    /v1/organisations/:slug/knowledge/sources/:sourceId/status
 *   GET    /v1/organisations/:slug/knowledge/sources/:sourceId/versions
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/versions
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/scopes
 *   DELETE /v1/organisations/:slug/knowledge/sources/:sourceId/scopes
 *
 * Permission model:
 *   - Any authenticated org member may list and view sources.
 *   - Any authenticated org member may upload (request + complete).
 *   - Approve, revoke, delete, supersede, scope assignment: owner or admin only.
 *   - Version replace: any authenticated member who uploaded the original, or owner/admin.
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  requestUploadUrl,
  validateUploadMetadata,
  UploadValidationError,
  type UploadMetadata,
} from "../../services/knowledgeStorageService.js";
import {
  completeUpload,
  listKnowledgeSources,
  getKnowledgeSource,
  updateSourceMetadata,
  approveKnowledgeSource,
  revokeKnowledgeSource,
  deleteKnowledgeSource,
  supersedeKnowledgeSource,
  markVersionForReprocess,
  listVersionHistory,
  replaceSourceVersion,
  assignScope,
  removeScope,
  listScopes,
  findDuplicateChecksum,
  KnowledgeSourceError,
} from "../../services/knowledgeSourceService.js";
import { getRequestMeta } from "../../services/auditService.js";

const router = Router({ mergeParams: true });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Owner or admin role required." } });
    return false;
  }
  return true;
}

// ─── List sources ─────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/sources",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { sourceScope, taskId, status, sourceType, limit, offset, includeDeleted } =
        req.query as Record<string, string>;

      const result = await listKnowledgeSources({
        organizationId: ctx.tenantId,
        sourceScope: sourceScope as "library" | "task" | undefined,
        taskId,
        status: status ? (status.split(",") as any[]) : undefined,
        sourceType,
        limit: limit ? Math.min(parseInt(limit, 10), 200) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
        includeDeleted: includeDeleted === "true",
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ─── Request upload URL ───────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/request-upload",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { originalFileName, mimeType, fileSize, checksum, sourceScope, taskId } =
        req.body as Record<string, any>;

      // Validate required fields
      if (!originalFileName || !mimeType || !fileSize || !checksum) {
        res.status(400).json({
          error: {
            code: "MISSING_FIELDS",
            message: "originalFileName, mimeType, fileSize, and checksum are required.",
          },
        });
        return;
      }

      const meta: UploadMetadata = {
        originalFileName: String(originalFileName),
        mimeType: String(mimeType),
        fileSize: Number(fileSize),
        checksum: String(checksum),
      };

      try {
        validateUploadMetadata(meta);
      } catch (err) {
        if (err instanceof UploadValidationError) {
          res.status(400).json({ error: { code: err.code, message: err.message } });
          return;
        }
        throw err;
      }

      // Duplicate detection before generating signed URL
      const duplicate = await findDuplicateChecksum(ctx.tenantId, checksum);
      if (duplicate) {
        res.status(409).json({
          error: {
            code: "DUPLICATE_CHECKSUM",
            message: "A file with this checksum already exists in this organisation.",
            existingSourceId: duplicate.id,
          },
        });
        return;
      }

      const result = await requestUploadUrl({
        organizationId: ctx.tenantId,
        uploadedByUserId: user.id,
        metadata: meta,
        sourceScope: sourceScope === "task" ? "task" : "library",
        taskId: taskId ? String(taskId) : undefined,
      });

      res.status(201).json({
        sourceId: result.sourceId,
        uploadUrl: result.uploadUrl,
        storageKey: result.storageKey,
        storageProvider: result.storageProvider,
        expiresInSeconds: result.expirySeconds,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Complete upload ──────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/complete-upload",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { sourceId } = req.params;
      const body = req.body as Record<string, any>;

      // Required fields
      const required = ["title", "sourceType", "storageKey", "storageProvider",
        "originalFileName", "mimeType", "fileSize", "checksum"];
      const missing = required.filter((f) => body[f] == null);
      if (missing.length > 0) {
        res.status(400).json({
          error: { code: "MISSING_FIELDS", message: `Required fields missing: ${missing.join(", ")}` },
        });
        return;
      }

      const { source, version, isDuplicate } = await completeUpload({
        sourceId,
        organizationId: ctx.tenantId,
        uploadedByUserId: user.id,
        title: String(body.title),
        description: body.description ? String(body.description) : undefined,
        sourceType: String(body.sourceType),
        language: body.language ? String(body.language) : "en",
        authorityLevel: body.authorityLevel,
        sensitivityClassification: body.sensitivityClassification,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
        versionLabel: body.versionLabel,
        sourceScope: body.sourceScope === "task" ? "task" : "library",
        taskId: body.taskId ? String(body.taskId) : undefined,
        storageKey: String(body.storageKey),
        storageProvider: String(body.storageProvider),
        originalFileName: String(body.originalFileName),
        mimeType: String(body.mimeType),
        fileSize: Number(body.fileSize),
        checksum: String(body.checksum),
      });

      res.status(isDuplicate ? 200 : 201).json({ source, version, isDuplicate });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        res.status(400).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Get source ───────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/sources/:sourceId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { sourceId } = req.params;

      const source = await getKnowledgeSource(sourceId, ctx.tenantId);
      if (!source) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Knowledge source not found." } });
        return;
      }

      // Include scopes
      const scopes = await listScopes(sourceId, ctx.tenantId);
      res.json({ source, scopes });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Get status ───────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/sources/:sourceId/status",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { sourceId } = req.params;

      const source = await getKnowledgeSource(sourceId, ctx.tenantId);
      if (!source) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Knowledge source not found." } });
        return;
      }

      res.json({
        sourceId: source.id,
        status: source.status,
        isCurrent: source.isCurrent,
        approvedAt: source.approvedAt,
        revokedAt: source.revokedAt,
        updatedAt: source.updatedAt,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Update metadata ──────────────────────────────────────────────────────────

router.patch(
  "/organisations/:slug/knowledge/sources/:sourceId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { sourceId } = req.params;

      const source = await updateSourceMetadata(sourceId, ctx.tenantId, user.id, req.body);
      res.json({ source });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Approve ──────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/approve",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      if (!requireOwnerOrAdmin(req, res)) return;

      const source = await approveKnowledgeSource(req.params.sourceId, ctx.tenantId, user.id);
      res.json({ source });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Revoke ───────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/revoke",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      if (!requireOwnerOrAdmin(req, res)) return;

      const { reason } = req.body as { reason?: string };
      const source = await revokeKnowledgeSource(
        req.params.sourceId,
        ctx.tenantId,
        user.id,
        reason,
      );
      res.json({ source });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Delete ───────────────────────────────────────────────────────────────────

router.delete(
  "/organisations/:slug/knowledge/sources/:sourceId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      if (!requireOwnerOrAdmin(req, res)) return;

      await deleteKnowledgeSource(req.params.sourceId, ctx.tenantId, user.id);
      res.status(204).send();
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Supersede ────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/supersede",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      if (!requireOwnerOrAdmin(req, res)) return;

      const { newSourceId } = req.body as { newSourceId?: string };
      if (!newSourceId?.trim()) {
        res.status(400).json({ error: { code: "MISSING_FIELDS", message: "newSourceId is required." } });
        return;
      }

      await supersedeKnowledgeSource(req.params.sourceId, newSourceId, ctx.tenantId, user.id);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" || err.code === "NEW_SOURCE_NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Reprocess ────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/reprocess",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      if (!requireOwnerOrAdmin(req, res)) return;

      await markVersionForReprocess(req.params.sourceId, ctx.tenantId, user.id);
      res.json({
        success: true,
        message: "Source marked for re-ingestion. Extraction will begin in Task #16.",
      });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Version history ──────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/knowledge/sources/:sourceId/versions",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { sourceId } = req.params;

      const source = await getKnowledgeSource(sourceId, ctx.tenantId);
      if (!source) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Knowledge source not found." } });
        return;
      }

      const versions = await listVersionHistory(sourceId, ctx.tenantId);
      res.json({ versions });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Replace version ──────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/versions",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { sourceId } = req.params;
      const body = req.body as Record<string, any>;

      const required = ["storageKey", "storageProvider", "originalFileName",
        "mimeType", "fileSize", "checksum"];
      const missing = required.filter((f) => body[f] == null);
      if (missing.length > 0) {
        res.status(400).json({
          error: { code: "MISSING_FIELDS", message: `Required: ${missing.join(", ")}` },
        });
        return;
      }

      const { newVersion, oldVersion } = await replaceSourceVersion({
        knowledgeSourceId: sourceId,
        organizationId: ctx.tenantId,
        uploadedByUserId: user.id,
        actorUserId: user.id,
        versionLabel: body.versionLabel,
        storageKey: String(body.storageKey),
        storageProvider: String(body.storageProvider),
        originalFileName: String(body.originalFileName),
        mimeType: String(body.mimeType),
        fileSize: Number(body.fileSize),
        checksum: String(body.checksum),
      });

      res.status(201).json({ newVersion, oldVersion });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Assign scope ─────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/scopes",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      if (!requireOwnerOrAdmin(req, res)) return;

      const { scopeType, scopeId } = req.body as { scopeType?: string; scopeId?: string };
      if (!scopeType?.trim() || !scopeId?.trim()) {
        res.status(400).json({ error: { code: "MISSING_FIELDS", message: "scopeType and scopeId are required." } });
        return;
      }

      const scope = await assignScope({
        knowledgeSourceId: req.params.sourceId,
        organizationId: ctx.tenantId,
        scopeType,
        scopeId,
        actorUserId: user.id,
      });

      res.status(201).json({ scope });
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

// ─── Remove scope ─────────────────────────────────────────────────────────────

router.delete(
  "/organisations/:slug/knowledge/sources/:sourceId/scopes",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      if (!requireOwnerOrAdmin(req, res)) return;

      const { scopeType, scopeId } = req.body as { scopeType?: string; scopeId?: string };
      if (!scopeType?.trim() || !scopeId?.trim()) {
        res.status(400).json({ error: { code: "MISSING_FIELDS", message: "scopeType and scopeId are required." } });
        return;
      }

      await removeScope(req.params.sourceId, ctx.tenantId, scopeType, scopeId, user.id);
      res.status(204).send();
    } catch (err) {
      if (err instanceof KnowledgeSourceError) {
        const status = err.code === "NOT_FOUND" ? 404 : 400;
        res.status(status).json({ error: { code: err.code, message: err.message } });
        return;
      }
      next(err);
    }
  },
);

export default router;
