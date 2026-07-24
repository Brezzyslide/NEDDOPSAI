/**
 * Platform Security routes — /v1/platform/security
 * Sprint 4: Security overview for platform security staff.
 *
 * GET  /overview       — suspended orgs, flagged orgs, recent security actions
 * GET  /flags          — all security-flagged orgs/notes
 * GET  /actions        — recent platform actions (all types)
 * GET  /logins         — recent platform logins (from audit log)
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth, requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  db, organizationsTable, auditLogTable, platformInternalNotesTable,
} from "@workspace/db";
import { eq, desc, count, or, and } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requirePlatformAuth, requirePlatformRole("platform_security_auditor")];

router.get("/overview", ...auth, async (_req, res, next) => {
  try {
    const [suspendedCount, flaggedNotes, recentActions] = await Promise.all([
      db.select({ n: count() }).from(organizationsTable).where(eq(organizationsTable.status, "suspended")),
      db.select({ note: platformInternalNotesTable, org: { id: organizationsTable.id, name: organizationsTable.name } })
        .from(platformInternalNotesTable)
        .leftJoin(organizationsTable, eq(organizationsTable.id, platformInternalNotesTable.organizationId))
        .where(eq(platformInternalNotesTable.isFlagged, true))
        .orderBy(desc(platformInternalNotesTable.createdAt))
        .limit(20),
      db.select().from(auditLogTable)
        .where(or(
          eq(auditLogTable.eventType, "platform.organisation_suspended"),
          eq(auditLogTable.eventType, "platform.security_review_flagged"),
          eq(auditLogTable.eventType, "platform.override_created"),
          eq(auditLogTable.eventType, "platform.plan_changed"),
        ))
        .orderBy(desc(auditLogTable.createdAt))
        .limit(30),
    ]);

    res.json({
      suspendedOrganisations: Number(suspendedCount[0]?.n ?? 0),
      flaggedNotes,
      recentSecurityActions: recentActions,
      placeholders: {
        openclawHealth: "OpenClaw runtime health — coming in a later sprint.",
        deviceHealth: "Device health monitoring — coming in a later sprint.",
      },
    });
  } catch (err) { next(err); }
});

router.get("/flags", ...auth, async (_req, res, next) => {
  try {
    const flags = await db
      .select({ note: platformInternalNotesTable, org: { id: organizationsTable.id, name: organizationsTable.name, slug: organizationsTable.slug } })
      .from(platformInternalNotesTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, platformInternalNotesTable.organizationId))
      .where(eq(platformInternalNotesTable.isFlagged, true))
      .orderBy(desc(platformInternalNotesTable.createdAt));
    res.json({ flags, total: flags.length });
  } catch (err) { next(err); }
});

router.get("/actions", ...auth, async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const events = await db.select().from(auditLogTable)
      .orderBy(desc(auditLogTable.createdAt)).limit(limit);
    res.json({ events, total: events.length });
  } catch (err) { next(err); }
});

router.get("/logins", ...auth, async (_req, res, next) => {
  try {
    const logins = await db.select().from(auditLogTable)
      .where(or(
        eq(auditLogTable.eventType, "platform.organisation_viewed"),
        eq(auditLogTable.eventType, "user.signed_in"),
      ))
      .orderBy(desc(auditLogTable.createdAt)).limit(50);
    res.json({ logins });
  } catch (err) { next(err); }
});

export default router;
