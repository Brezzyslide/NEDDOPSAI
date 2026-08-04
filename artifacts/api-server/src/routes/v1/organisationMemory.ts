/**
 * Organisation Memory routes — Sprint 9.2
 *
 * GET    /v1/organisations/:slug/memory           — list (filter by status/type)
 * POST   /v1/organisations/:slug/memory           — propose new memory
 * GET    /v1/organisations/:slug/memory/:memoryId — get single record
 * PATCH  /v1/organisations/:slug/memory/:memoryId — update (content/importance/expiry)
 * POST   /v1/organisations/:slug/memory/:memoryId/approve  — approve
 * POST   /v1/organisations/:slug/memory/:memoryId/reject   — reject
 * POST   /v1/organisations/:slug/memory/:memoryId/supersede — supersede with newId
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  proposeOrganisationMemory,
  approveOrganisationMemory,
  rejectOrganisationMemory,
  supersedeOrganisationMemory,
  updateOrganisationMemory,
  listOrganisationMemory,
  mergeOrganisationMemory,
  getMemoryAuditHistory,
  type MemoryStatus,
  type MemoryType,
  type CreateMemoryInput,
} from "../../services/organisationMemoryService.js";
import { db } from "@workspace/db";
import { organisationMemoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router({ mergeParams: true });

// ─── List ─────────────────────────────────────────────────────────────────────
router.get(
  "/organisations/:slug/memory",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { status, memoryType, includeExpired, limit, offset } = req.query as Record<string, string>;
      const statuses = status
        ? (status.split(",") as MemoryStatus[])
        : (["proposed","approved","rejected","superseded","expired"] as MemoryStatus[]);
      const result = await listOrganisationMemory(ctx.tenantId, {
        status: statuses,
        memoryType: memoryType as MemoryType | undefined,
        includeExpired: includeExpired === "true",
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });
      res.json(result);
    } catch (err) { next(err); }
  }
);

// ─── Propose ──────────────────────────────────────────────────────────────────
router.post(
  "/organisations/:slug/memory",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const body = req.body as Partial<CreateMemoryInput>;

      if (!body.title?.trim() || !body.content?.trim() || !body.memoryType) {
        res.status(400).json({ error: "title, content, and memoryType are required" });
        return;
      }

      const { id, conflicts } = await proposeOrganisationMemory(ctx.tenantId, {
        memoryType: body.memoryType,
        title: body.title,
        content: body.content,
        structuredContent: body.structuredContent,
        sourceType: body.sourceType ?? "manual",
        sourceId: body.sourceId,
        confidence: body.confidence,
        importance: body.importance,
        effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : undefined,
        effectiveTo: body.effectiveTo ? new Date(body.effectiveTo) : undefined,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        createdBy: user.id,
      });

      res.status(201).json({ id, conflicts });
    } catch (err) { next(err); }
  }
);

// ─── Get single ───────────────────────────────────────────────────────────────
router.get(
  "/organisations/:slug/memory/:memoryId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { memoryId } = req.params as { memoryId: string };
      const [row] = await db
        .select()
        .from(organisationMemoryTable)
        .where(and(eq(organisationMemoryTable.organizationId, ctx.tenantId), eq(organisationMemoryTable.id, memoryId)))
        .limit(1);
      if (!row) { res.status(404).json({ error: "Not found" }); return; }
      res.json({ memory: row });
    } catch (err) { next(err); }
  }
);

// ─── Update ───────────────────────────────────────────────────────────────────
router.patch(
  "/organisations/:slug/memory/:memoryId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { memoryId } = req.params as { memoryId: string };
      const ok = await updateOrganisationMemory(ctx.tenantId, memoryId, req.body as any, user.id);
      if (!ok) { res.status(404).json({ error: "Not found or update failed" }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// ─── Approve ──────────────────────────────────────────────────────────────────
router.post(
  "/organisations/:slug/memory/:memoryId/approve",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { memoryId } = req.params as { memoryId: string };
      const ok = await approveOrganisationMemory(ctx.tenantId, memoryId, user.id);
      if (!ok) { res.status(404).json({ error: "Memory not found or not in proposed state" }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// ─── Reject ───────────────────────────────────────────────────────────────────
router.post(
  "/organisations/:slug/memory/:memoryId/reject",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { memoryId } = req.params as { memoryId: string };
      const ok = await rejectOrganisationMemory(ctx.tenantId, memoryId, user.id);
      if (!ok) { res.status(404).json({ error: "Memory not found" }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// ─── Supersede ────────────────────────────────────────────────────────────────
router.post(
  "/organisations/:slug/memory/:memoryId/supersede",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const user = req.appUser!;
      const { memoryId } = req.params as { memoryId: string };
      const { newMemoryId } = req.body as { newMemoryId?: string };
      if (!newMemoryId) { res.status(400).json({ error: "newMemoryId is required" }); return; }
      const ok = await supersedeOrganisationMemory(ctx.tenantId, memoryId, newMemoryId, user.id);
      if (!ok) { res.status(404).json({ error: "Memory not found" }); return; }
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// ─── Merge (Sprint 29) ────────────────────────────────────────────────────────
// POST /v1/organisations/:slug/memory/:memoryId/merge
// Body: { sourceId, mergedTitle?, mergedContent? }
// Absorbs sourceId into memoryId (target), superseding the source.
router.post(
  "/organisations/:slug/memory/:memoryId/merge",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { memoryId } = req.params as { memoryId: string };
      const { sourceId, mergedTitle, mergedContent } = req.body as {
        sourceId?: string;
        mergedTitle?: string;
        mergedContent?: string;
      };

      if (!sourceId) {
        res.status(400).json({ error: "sourceId is required" });
        return;
      }
      if (sourceId === memoryId) {
        res.status(400).json({ error: "targetId and sourceId must be different records" });
        return;
      }

      const result = await mergeOrganisationMemory(ctx.tenantId, {
        targetId: memoryId,
        sourceId,
        mergedBy: user.id,
        mergedTitle,
        mergedContent,
      });

      if (!result.ok) {
        res.status(404).json({ error: result.error ?? "Merge failed" });
        return;
      }
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// ─── Per-memory audit history (Sprint 29) ─────────────────────────────────────
// GET /v1/organisations/:slug/memory/:memoryId/audit
router.get(
  "/organisations/:slug/memory/:memoryId/audit",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const { memoryId } = req.params as { memoryId: string };
      const events = await getMemoryAuditHistory(ctx.tenantId, memoryId);
      res.json({ events });
    } catch (err) { next(err); }
  }
);

export default router;
