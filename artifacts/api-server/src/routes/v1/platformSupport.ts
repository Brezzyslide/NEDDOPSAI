/**
 * Platform Support Centre routes — /v1/platform/support
 * Sprint 4: Support staff view of all notes, flags, overrides, and timeline.
 *
 * GET  /notes         — all internal notes (across all orgs)
 * GET  /flagged       — flagged organisations
 * GET  /overrides     — recent platform overrides
 * GET  /timeline      — support timeline across all orgs
 */

import { Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth, requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
platformInternalNotesTable, organizationsTable, tenantOverridesTable, auditLogTable,
} from "@workspace/db";
import { eq, desc, and, ilike, or } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requirePlatformAuth, requirePlatformRole("platform_support_admin")];

router.get("/notes", ...auth, async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const category = req.query.category as string | undefined;
    const priority = req.query.priority as string | undefined;
    const search = req.query.search as string | undefined;

    let q = platformDb.select({ note: platformInternalNotesTable, org: { id: organizationsTable.id, name: organizationsTable.name, slug: organizationsTable.slug } })
      .from(platformInternalNotesTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, platformInternalNotesTable.organizationId))
      .$dynamic();

    if (category) q = q.where(eq(platformInternalNotesTable.category, category as any));
    if (priority) q = q.where(eq(platformInternalNotesTable.priority, priority as any));
    if (search) q = q.where(ilike(platformInternalNotesTable.content, `%${search}%`));

    const notes = await q.orderBy(desc(platformInternalNotesTable.createdAt)).limit(limit);
    res.json({ notes, total: notes.length });
  } catch (err) { next(err); }
});

router.get("/flagged", ...auth, async (_req, res, next) => {
  try {
    const flaggedNotes = await platformDb.select({ note: platformInternalNotesTable, org: { id: organizationsTable.id, name: organizationsTable.name, slug: organizationsTable.slug } })
      .from(platformInternalNotesTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, platformInternalNotesTable.organizationId))
      .where(eq(platformInternalNotesTable.isFlagged, true))
      .orderBy(desc(platformInternalNotesTable.createdAt));

    const flaggedOrgs = [...new Set(flaggedNotes.map(n => n.org?.id).filter(Boolean))];
    res.json({ flaggedNotes, flaggedOrgCount: flaggedOrgs.length });
  } catch (err) { next(err); }
});

router.get("/overrides", ...auth, async (req, res, next) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 20);
    const overrides = await platformDb.select({ override: tenantOverridesTable, org: { id: organizationsTable.id, name: organizationsTable.name } })
      .from(tenantOverridesTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, tenantOverridesTable.organizationId))
      .where(eq(tenantOverridesTable.isActive, true))
      .orderBy(desc(tenantOverridesTable.createdAt))
      .limit(limit);
    res.json({ overrides });
  } catch (err) { next(err); }
});

router.get("/timeline", ...auth, async (req, res, next) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 30);
    const events = await platformDb.select()
      .from(auditLogTable)
      .where(or(
        eq(auditLogTable.eventType, "platform.internal_note_added"),
        eq(auditLogTable.eventType, "platform.security_review_flagged"),
        eq(auditLogTable.eventType, "platform.high_priority_flagged"),
        eq(auditLogTable.eventType, "platform.organisation_suspended"),
        eq(auditLogTable.eventType, "platform.organisation_reactivated"),
      ))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit);
    res.json({ events });
  } catch (err) { next(err); }
});

export default router;
