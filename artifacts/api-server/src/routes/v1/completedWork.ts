/**
 * Completed Work Router — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Routes:
 *   GET  /organisations/:slug/completed-work
 *   GET  /organisations/:slug/completed-work/:id
 *   GET  /organisations/:slug/completed-work/:id/versions
 *   GET  /organisations/:slug/completed-work/:id/comments
 *   POST /organisations/:slug/completed-work/:id/submit
 *   POST /organisations/:slug/completed-work/:id/approve
 *   POST /organisations/:slug/completed-work/:id/reject
 *   POST /organisations/:slug/completed-work/:id/archive
 *   POST /organisations/:slug/completed-work/:id/reopen
 *   POST /organisations/:slug/completed-work/:id/comment
 *   POST /organisations/:slug/completed-work/:id/promote
 *   POST /organisations/:slug/completed-work/:id/version
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  getCompletedWork,
  listCompletedWork,
  submitForApproval,
  approve,
  reject,
  archive,
  reopen,
  addComment,
  getComments,
  resolveComment,
  reopenComment,
  promoteToLibrary,
  addVersion,
  getVersions,
  getAssets,
} from "../../services/completedWorkService.js";
import {
  getGeneratedArtifactDownloadUrl,
  listCompletedWorkGeneratedArtifacts,
} from "../../services/completedWorkArtifactService.js";
import { reconcileTaskCompletedWorkApproval } from "../../services/taskService.js";
import { completedWorkExportService, type ExportFormat } from "../../services/completedWorkExportService.js";
import type { CompletedWorkStatus } from "@workspace/db";

const router = Router({ mergeParams: true });

function requireOwnerOrAdminOrManager(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  // Sprint 29M.3: manager can approve operational completed work;
  // administrator and owner retain full approval authority.
  if (role !== "owner" && role !== "administrator" && role !== "manager") {
    res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Manager, administrator, or owner role required." } });
    return false;
  }
  return true;
}

function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "administrator") {
    res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Owner or administrator role required." } });
    return false;
  }
  return true;
}

// ─── List ─────────────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/completed-work",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { status, primarySpecialist, outputType, conversationId, limit, offset } =
        req.query as Record<string, string | undefined>;

      const items = await listCompletedWork(ctx.tenantId, {
        status: status as CompletedWorkStatus | undefined,
        primarySpecialist,
        outputType,
        conversationId,
        limit: limit ? parseInt(limit, 10) : undefined,
        offset: offset ? parseInt(offset, 10) : undefined,
      });

      res.json({ completedWork: items, count: items.length });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Get item ─────────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/completed-work/:id",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const { id } = req.params as { id: string };
      const [item, assets] = await Promise.all([
        getCompletedWork(id, ctx.tenantId),
        getAssets(id, ctx.tenantId),
      ]);
      if (!item) { res.status(404).json({ error: "Completed work not found" }); return; }
      const generatedArtifacts = await listCompletedWorkGeneratedArtifacts(id, ctx.tenantId);
      res.json({ completedWork: item, assets, generatedArtifacts });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Versions ─────────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/completed-work/:id/versions",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const { id } = req.params as { id: string };
      const versions = await getVersions(id, ctx.tenantId);
      res.json({ versions });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Comments ─────────────────────────────────────────────────────────────────

router.get(
  "/organisations/:slug/completed-work/:id/comments",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const { id } = req.params as { id: string };
      const comments = await getComments(id, ctx.tenantId);
      res.json({ comments });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Submit ───────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/submit",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const item   = await submitForApproval(id, ctx.tenantId, user.id);
      res.json({ completedWork: item });
    } catch (err) { next(err); }
  }
);

// ─── Approve ──────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/approve",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdminOrManager(req, res)) return;
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const item   = await approve(id, ctx.tenantId, user.id);
      const artifacts = await listCompletedWorkGeneratedArtifacts(id, ctx.tenantId);
      const taskIds = Array.from(new Set(artifacts.map(artifact => artifact.taskId).filter((value): value is string => typeof value === "string" && value.length > 0)));
      await Promise.all(taskIds.map(taskId =>
        reconcileTaskCompletedWorkApproval({
          taskId,
          organizationId: ctx.tenantId,
          completedWorkId: id,
          completedWorkStatus: item.status,
          approvedByUserId: user.id,
        }).catch(() => null),
      ));
      res.json({ completedWork: item });
    } catch (err) { next(err); }
  }
);

// ─── Reject ───────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/reject",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdminOrManager(req, res)) return;
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const { reason } = req.body as { reason?: string };
      const item   = await reject(id, ctx.tenantId, user.id, reason);
      res.json({ completedWork: item });
    } catch (err) { next(err); }
  }
);

// ─── Archive ──────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/archive",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const item   = await archive(id, ctx.tenantId, user.id);
      res.json({ completedWork: item });
    } catch (err) { next(err); }
  }
);

// ─── Reopen ───────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/reopen",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const item   = await reopen(id, ctx.tenantId, user.id);
      res.json({ completedWork: item });
    } catch (err) { next(err); }
  }
);

// ─── Comment ──────────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/comment",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx     = req.tenantContext!;
      const user    = req.appUser!;
      const { id }  = req.params as { id: string };
      const { content } = req.body as { content?: string };
      if (!content?.trim()) { res.status(400).json({ error: "content is required" }); return; }
      await addComment(id, ctx.tenantId, content.trim(), user.id);
      res.status(201).json({ message: "Comment added" });
    } catch (err) { next(err); }
  }
);

// ─── Promote to Library ───────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/promote",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const { documentType } = req.body as { documentType?: string };
      if (!documentType) {
        res.status(400).json({ error: "documentType is required (approved_example, template, policy, or procedure)" });
        return;
      }
      const result = await promoteToLibrary(id, ctx.tenantId, documentType, user.id);
      res.status(201).json(result);
    } catch (err) { next(err); }
  }
);

// ─── Comment resolve / reopen (Sprint 25 Hardening) ──────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/comment/:commentId/resolve",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx               = req.tenantContext!;
      const user              = req.appUser!;
      const { id, commentId } = req.params as { id: string; commentId: string };
      await resolveComment(commentId, id, ctx.tenantId, user.id);
      res.json({ message: "Comment resolved" });
    } catch (err) { next(err); }
  }
);

router.post(
  "/organisations/:slug/completed-work/:id/comment/:commentId/reopen",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx               = req.tenantContext!;
      const user              = req.appUser!;
      const { id, commentId } = req.params as { id: string; commentId: string };
      await reopenComment(commentId, id, ctx.tenantId, user.id);
      res.json({ message: "Comment reopened" });
    } catch (err) { next(err); }
  }
);

// ─── Export (Sprint 25 Hardening) ─────────────────────────────────────────────

router.get(
  "/organisations/:slug/completed-work/:id/artifacts",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const { id } = req.params as { id: string };
      const item = await getCompletedWork(id, ctx.tenantId);
      if (!item) { res.status(404).json({ error: "Completed work not found" }); return; }
      const generatedArtifacts = await listCompletedWorkGeneratedArtifacts(id, ctx.tenantId);
      res.json({ generatedArtifacts });
    } catch (err) { next(err); }
  }
);

router.get(
  "/organisations/:slug/completed-work/:id/artifacts/:artifactId/download",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { id, artifactId } = req.params as { id: string; artifactId: string };
      const { artifact, downloadUrl } = await getGeneratedArtifactDownloadUrl({
        organizationId: ctx.tenantId,
        completedWorkId: id,
        artifactId,
      });
      res.json({ artifact, downloadUrl });
    } catch (err) { next(err); }
  }
);

router.get(
  "/organisations/:slug/completed-work/:id/export",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const format = (req.query.format as string | undefined) ?? "md";

      if (!["md", "pdf", "docx"].includes(format)) {
        res.status(400).json({ error: "format must be one of: md, pdf, docx" });
        return;
      }

      // Resolve organisation name for export metadata
      const orgName: string = (ctx as any).organisationName
        ?? (ctx as any).orgName
        ?? (ctx as any).name
        ?? "Your Organisation";

      const result = await completedWorkExportService.export({
        workId:          id,
        organisationId:  ctx.tenantId,
        organisationName: orgName,
        format:          format as ExportFormat,
        actorUserId:     user.id,
      });

      res.setHeader("Content-Type",        result.mimeType);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.setHeader("Content-Length",      result.buffer.length);
      res.end(result.buffer);
    } catch (err) { next(err); }
  }
);

// ─── Add version ──────────────────────────────────────────────────────────────

router.post(
  "/organisations/:slug/completed-work/:id/version",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const { contentMarkdown, changeNote } = req.body as { contentMarkdown?: string; changeNote?: string };
      if (!contentMarkdown) { res.status(400).json({ error: "contentMarkdown is required" }); return; }
      const version = await addVersion(id, ctx.tenantId, contentMarkdown, changeNote ?? "Manual revision", user.id);
      res.status(201).json({ version });
    } catch (err) { next(err); }
  }
);

export default router;
