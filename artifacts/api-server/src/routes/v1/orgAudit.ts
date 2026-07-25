/**
 * GET /v1/organisations/:slug/audit — paginated org audit log
 *
 * Sprint 7.1: Now reads from the organisation schema's own org_audit_log
 * table via withOrgContext(). No longer reads from public.audit_log.
 *
 * Falls back to the legacy public.org_audit_log if the org is not yet
 * provisioned in the operational database registry (transition period).
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { requirePermission } from "../../middlewares/requirePermission.js";
import { db, orgAuditLogTable } from "@workspace/db";
import { withOrgContext, OrgConnectionError } from "@workspace/org-db";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";

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

      // ── Primary path: read from org schema via withOrgContext ────────────────
      try {
        const events = await withOrgContext(
          { tenantId: ctx.tenantId, userId: ctx.userId, purpose: "audit_read" },
          async (conn) => {
            // Build WHERE clause dynamically for org schema query
            const whereParts: string[] = [];
            if (eventType) whereParts.push(`event_type = '${eventType.replace(/'/g, "''")}'`);
            if (from) whereParts.push(`occurred_at >= '${from.toISOString()}'`);
            if (to) whereParts.push(`occurred_at <= '${to.toISOString()}'`);
            const whereClause = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

            const result = await conn.db.execute(sql.raw(`
              SELECT id, actor_user_id, actor_type, event_type, resource_type,
                     resource_id, request_id, ip_address, user_agent,
                     access_purpose, is_sensitive, metadata, occurred_at
              FROM "${conn.schemaName}".org_audit_log
              ${whereClause}
              ORDER BY occurred_at DESC
              LIMIT ${limit} OFFSET ${offset}
            `));

            return result.rows;
          },
        );

        return res.json({ events, page, limit, source: "org_schema" });
      } catch (err: any) {
        if (err instanceof OrgConnectionError) {
          // ── Fallback: org not yet provisioned — read from legacy public.org_audit_log
          const conditions = [eq(orgAuditLogTable.organizationId, ctx.tenantId)];
          if (eventType) conditions.push(eq(orgAuditLogTable.eventType, eventType));
          if (from) conditions.push(gte(orgAuditLogTable.occurredAt, from));
          if (to) conditions.push(lte(orgAuditLogTable.occurredAt, to));

          const events = await db
            .select()
            .from(orgAuditLogTable)
            .where(and(...conditions))
            .orderBy(desc(orgAuditLogTable.occurredAt))
            .limit(limit)
            .offset(offset);

          return res.json({ events, page, limit, source: "legacy_public" });
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  },
);

export default router;
