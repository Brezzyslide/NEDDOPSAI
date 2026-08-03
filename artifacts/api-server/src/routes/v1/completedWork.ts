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
  promoteToLibrary,
  addVersion,
  getVersions,
  getAssets,
} from "../../services/completedWorkService.js";
import type { CompletedWorkStatus } from "@workspace/db";

const router = Router({ mergeParams: true });

function requireOwnerOrAdmin(req: any, res: any): boolean {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: { code: "INSUFFICIENT_ROLE", message: "Owner or admin role required." } });
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
      res.json({ completedWork: item, assets });
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
      if (!requireOwnerOrAdmin(req, res)) return;
      const ctx    = req.tenantContext!;
      const user   = req.appUser!;
      const { id } = req.params as { id: string };
      const item   = await approve(id, ctx.tenantId, user.id);
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
      if (!requireOwnerOrAdmin(req, res)) return;
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
