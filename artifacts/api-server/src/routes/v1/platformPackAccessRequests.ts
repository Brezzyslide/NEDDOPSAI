/**
 * Platform pack access request routes.
 *
 * GET  /v1/platform/pack-access-requests              list all pending
 * POST /v1/platform/pack-access-requests/:id/approve  approve
 * POST /v1/platform/pack-access-requests/:id/reject   reject
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import {
  db,
  workforcePackAccessRequestsTable,
  tenantWorkforcePacksTable,
} from "@workspace/db";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import * as auditService from "../../services/auditService.js";

const router = Router();

// GET /v1/platform/pack-access-requests
router.get("/", requirePlatformAuth, async (req, res, next) => {
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
router.post("/:id/approve", requirePlatformAuth, async (req, res, next) => {
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
router.post("/:id/reject", requirePlatformAuth, async (req, res, next) => {
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

export default router;
