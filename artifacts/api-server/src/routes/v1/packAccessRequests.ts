/**
 * Tenant pack access request routes — Sprint 9.6
 *
 * POST /v1/organisations/:slug/pack-access-requests   create request (tenant)
 * GET  /v1/organisations/:slug/pack-access-requests   list requests (tenant)
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import {
  workforcePacksTable,
  workforcePackAccessRequestsTable,
  withTenantContext,
} from "@workspace/db";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
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

      const normalizedPackCode = packCode.toLowerCase();

      const { pack, existing } = await withTenantContext(
        { tenantId: ctx.tenantId, userId: user.id, purpose: "pack_access_request.create_preflight" },
        async (tx) => {
          // Load pack
          const [packRow] = await tx
            .select()
            .from(workforcePacksTable)
            .where(eq(workforcePacksTable.code, normalizedPackCode))
            .limit(1);

          // Check for existing pending request
          const existingRows = await tx
            .select({ id: workforcePackAccessRequestsTable.id })
            .from(workforcePackAccessRequestsTable)
            .where(and(
              eq(workforcePackAccessRequestsTable.organizationId, ctx.tenantId),
              eq(workforcePackAccessRequestsTable.packCode, normalizedPackCode),
              eq(workforcePackAccessRequestsTable.status, "pending"),
            ))
            .limit(1);

          return { pack: packRow, existing: existingRows };
        },
      );

      if (!pack || pack.status === "archived") {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found or unavailable." } });
        return;
      }

      if (existing.length) {
        res.status(409).json({
          error: { code: "ALREADY_REQUESTED", message: "A pending request already exists for this pack." },
          requestId: existing[0]!.id,
        });
        return;
      }

      const request = (await withTenantContext(
        { tenantId: ctx.tenantId, userId: user.id, purpose: "pack_access_request.create" },
        (tx) => tx.insert(workforcePackAccessRequestsTable).values({
          id:              `par_${randomUUID()}`,
          organizationId:  ctx.tenantId,
          workforcePackId: pack.id,
          packCode:        normalizedPackCode,
          requestedBy:     user.id,
          status:          "pending",
          source:          "plan_page",
        }).returning(),
      ))[0];

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
      const requests = await withTenantContext(
        { tenantId: ctx.tenantId, userId: req.appUser!.id, purpose: "pack_access_request.list" },
        (tx) => tx.select()
          .from(workforcePackAccessRequestsTable)
          .where(eq(workforcePackAccessRequestsTable.organizationId, ctx.tenantId))
          .orderBy(desc(workforcePackAccessRequestsTable.requestedAt)),
      );
      res.json({ requests });
    } catch (err) {
      next(err);
    }
  },
);
