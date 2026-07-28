/**
 * Pack access request routes — Sprint 9.6
 *
 * POST /v1/organisations/:slug/pack-access-requests   create request (tenant)
 * GET  /v1/organisations/:slug/pack-access-requests   list requests (tenant)
 * GET  /v1/platform/pack-access-requests              list all pending (platform)
 * POST /v1/platform/pack-access-requests/:id/approve  approve (platform)
 * POST /v1/platform/pack-access-requests/:id/reject   reject  (platform)
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import {
  db,
  workforcePacksTable,
  workforcePackAccessRequestsTable,
  tenantWorkforcePacksTable,
} from "@workspace/db";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import * as auditService from "../../services/auditService.js";

// ─── Tenant routes ────────────────────────────────────────────────────────────

export const tenantPackRequestsRouter = Router({ mergeParams: true });

// POST /v1/organisations/:slug/pack-access-requests
tenantPackRequestsRouter.post(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:read"),
  async (req, res, next) => {
    try {
      const ctx  = req.tenantContext!;
      const user = req.appUser!;
      const { packCode } = req.body as { packCode: string };

      if (!packCode) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "packCode is required." } });
        return;
      }

      // Load pack
      const [pack] = await db
        .select()
        .from(workforcePacksTable)
        .where(eq(workforcePacksTable.code, packCode.toLowerCase()))
        .limit(1);

      if (!pack || pack.status === "archived") {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found or unavailable." } });
        return;
      }

      // Check for existing pending request
      const existing = await db
        .select({ id: workforcePackAccessRequestsTable.id })
        .from(workforcePackAccessRequestsTable)
        .where(and(
          eq(workforcePackAccessRequestsTable.organizationId, ctx.tenantId),
          eq(workforcePackAccessRequestsTable.packCode, packCode.toLowerCase()),
          eq(workforcePackAccessRequestsTable.status, "pending"),
        ))
        .limit(1);

      if (existing.length) {
        res.status(409).json({
          error: { code: "ALREADY_REQUESTED", message: "A pending request already exists for this pack." },
          requestId: existing[0]!.id,
        });
        return;
      }

      const request = (await db.insert(workforcePackAccessRequestsTable).values({
        id:              `par_${randomUUID()}`,
        organizationId:  ctx.tenantId,
        workforcePackId: pack.id,
        packCode:        packCode.toLowerCase(),
        requestedBy:     user.id,
        status:          "pending",
        source:          "plan_page",
      }).returning())[0];

      await auditService.writeAuditEvent({
        organizationId: ctx.tenantId,
        actorUserId:    user.id,
        actorType:      "user",
        eventType:      "workforce_pack.access_requested" as any,
        resourceType:   "workforce_pack",
        resourceId:     pack.id,
        metadata:       { packCode, source: "plan_page" },
        ...auditService.getRequestMeta(req),
      }).catch(() => {});

      res.status(201).json({ request });
    } catch (err) {
      next(err);
    }
  },
);

// GET /v1/organisations/:slug/pack-access-requests
tenantPackRequestsRouter.get(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("organization:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const requests = await db
        .select()
        .from(workforcePackAccessRequestsTable)
        .where(eq(workforcePackAccessRequestsTable.organizationId, ctx.tenantId))
        .orderBy(desc(workforcePackAccessRequestsTable.requestedAt));
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Platform routes ──────────────────────────────────────────────────────────

export const platformPackRequestsRouter = Router();

// GET /v1/platform/pack-access-requests
platformPackRequestsRouter.get("/", requirePlatformAuth, async (req, res, next) => {
  try {
    const status = (req.query.status as string) || "pending";
    const requests = await db
      .select()
      .from(workforcePackAccessRequestsTable)
      .where(eq(workforcePackAccessRequestsTable.status, status as any))
      .orderBy(desc(workforcePackAccessRequestsTable.requestedAt));
    res.json({ requests });
  } catch (err) {
    next(err);
  }
});

// POST /v1/platform/pack-access-requests/:id/approve
platformPackRequestsRouter.post("/:id/approve", requirePlatformAuth, async (req, res, next) => {
  try {
    const staff = req.platformUserId!;
    const { reason = "" } = req.body;

    const [request] = await db
      .select()
      .from(workforcePackAccessRequestsTable)
      .where(eq(workforcePackAccessRequestsTable.id, req.params.id))
      .limit(1);

    if (!request || request.status !== "pending") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Request not found or not pending." } });
      return;
    }

    // Update request status
    await db.update(workforcePackAccessRequestsTable)
      .set({ status: "approved", reviewedBy: staff, reviewedAt: new Date(), reviewNotes: reason, updatedAt: new Date() })
      .where(eq(workforcePackAccessRequestsTable.id, request.id));

    // Grant pack to org
    await db.insert(tenantWorkforcePacksTable).values({
      id:             `twp_${randomUUID()}`,
      organizationId: request.organizationId,
      packCode:       request.packCode,
      source:         "manual_grant",
      grantedBy:      staff,
      reason:         reason || "Approved via Platform Console",
      status:         "active",
      activatedAt:    new Date(),
      approvedBy:     staff,
      requestedBy:    request.requestedBy,
    }).onConflictDoNothing();

    // Audit
    await auditService.writeAuditEvent({
      organizationId: request.organizationId,
      actorUserId:    staff,
      actorType:      "platform_staff",
      eventType:      "workforce_pack.access_approved" as any,
      resourceType:   "workforce_pack",
      resourceId:     request.workforcePackId,
      metadata:       { packCode: request.packCode, requestId: request.id, reason },
    }).catch(() => {});

    res.json({ success: true, requestId: request.id });
  } catch (err) {
    next(err);
  }
});

// POST /v1/platform/pack-access-requests/:id/reject
platformPackRequestsRouter.post("/:id/reject", requirePlatformAuth, async (req, res, next) => {
  try {
    const staff = req.platformUserId!;
    const { reason = "" } = req.body;

    const [request] = await db
      .select()
      .from(workforcePackAccessRequestsTable)
      .where(eq(workforcePackAccessRequestsTable.id, req.params.id))
      .limit(1);

    if (!request || request.status !== "pending") {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Request not found or not pending." } });
      return;
    }

    await db.update(workforcePackAccessRequestsTable)
      .set({ status: "rejected", reviewedBy: staff, reviewedAt: new Date(), reviewNotes: reason, updatedAt: new Date() })
      .where(eq(workforcePackAccessRequestsTable.id, request.id));

    await auditService.writeAuditEvent({
      organizationId: request.organizationId,
      actorUserId:    staff,
      actorType:      "platform_staff",
      eventType:      "workforce_pack.access_rejected" as any,
      resourceType:   "workforce_pack",
      resourceId:     request.workforcePackId,
      metadata:       { packCode: request.packCode, requestId: request.id, reason },
    }).catch(() => {});

    res.json({ success: true, requestId: request.id });
  } catch (err) {
    next(err);
  }
});
