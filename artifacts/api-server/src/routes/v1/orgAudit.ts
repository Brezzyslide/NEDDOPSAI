/**
 * GET /v1/organisations/:slug/audit — paginated audit log
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import { db, auditLogTable } from "@workspace/db";
import { eq, desc, and, gte, lte } from "drizzle-orm";

const router = Router({ mergeParams: true });

router.get(
  "/",
  requireAuth,
  resolveTenantFromSlug,
  requirePermission("audit:read"),
  async (req, res, next) => {
    try {
      const ctx = req.tenantContext!;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
      const offset = (page - 1) * limit;
      const eventType = req.query.eventType as string | undefined;
      const from = req.query.from ? new Date(req.query.from as string) : undefined;
      const to = req.query.to ? new Date(req.query.to as string) : undefined;

      const conditions = [eq(auditLogTable.organizationId, ctx.tenantId)];
      if (eventType) conditions.push(eq(auditLogTable.eventType, eventType));
      if (from) conditions.push(gte(auditLogTable.occurredAt, from));
      if (to) conditions.push(lte(auditLogTable.occurredAt, to));

      const events = await db
        .select()
        .from(auditLogTable)
        .where(and(...conditions))
        .orderBy(desc(auditLogTable.occurredAt))
        .limit(limit)
        .offset(offset);

      res.json({ events, page, limit });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
