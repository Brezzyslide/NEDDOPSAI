/**
 * Platform Audit Log routes — /v1/platform/audit
 * Sprint 4: Cross-org, cross-actor audit log for platform auditors.
 *
 * GET  /       — paginated audit log with filters
 * GET  /actors — list of actors who have taken platform actions
 */

import {
  Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth,
  requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  auditLogTable,
} from "@workspace/db";
import { eq, desc, count, gte, lte, and, or, ilike } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requirePlatformAuth, requirePlatformRole("platform_auditor")];

router.get("/", ...auth, async (req, res, next) => {
  try {
    const page      = Math.max(1, Number(req.query.page) || 1);
    const limit     = Math.min(200, Number(req.query.limit) || 50);
    const offset    = (page - 1) * limit;
    const actorId   = req.query.actorId as string | undefined;
    const eventType = req.query.eventType as string | undefined;
    const orgId     = req.query.orgId as string | undefined;
    const since     = req.query.since ? new Date(req.query.since as string) : undefined;
    const until     = req.query.until ? new Date(req.query.until as string) : undefined;

    let q = platformDb.select().from(auditLogTable).$dynamic();
    if (actorId)   q = q.where(eq(auditLogTable.actorUserId, actorId));
    if (orgId)     q = q.where(eq(auditLogTable.organizationId, orgId));
    if (since)     q = q.where(gte(auditLogTable.occurredAt, since));
    if (until)     q = q.where(lte(auditLogTable.occurredAt, until));

    const [totalRow] = await platformDb.select({ n: count() }).from(auditLogTable);
    const events = await q.orderBy(desc(auditLogTable.occurredAt)).limit(limit).offset(offset);

    res.json({ events, page, limit, total: Number(totalRow?.n ?? 0) });
  } catch (err) { next(err); }
});

router.get("/actors", ...auth, async (_req, res, next) => {
  try {
    const actors = await platformDb.selectDistinct({ actorId: auditLogTable.actorUserId })
      .from(auditLogTable)
      .where(eq(auditLogTable.actorType, "user"))
      .limit(100);
    res.json({ actors: actors.map(a => a.actorId).filter(Boolean) });
  } catch (err) { next(err); }
});

export default router;
