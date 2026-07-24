/**
 * Platform Global Search — /v1/platform/search
 * Sprint 4: Search across organisations, users, plans, notes, trials.
 *
 * GET  /?q=<query>   — search across all entity types
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  db, organizationsTable, usersTable, membershipsTable, plansTable,
  platformInternalNotesTable, tenantSubscriptionsTable,
} from "@workspace/db";
import { ilike, or, eq, and } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

router.get("/", ...auth, async (req, res, next) => {
  try {
    const q = (req.query.q as string ?? "").trim();
    if (!q || q.length < 2) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "q must be at least 2 characters." } });
      return;
    }
    const pattern = `%${q}%`;

    const [orgs, users, notes, plans] = await Promise.all([
      db.select({ id: organizationsTable.id, name: organizationsTable.name, slug: organizationsTable.slug, status: organizationsTable.status })
        .from(organizationsTable)
        .where(or(
          ilike(organizationsTable.name, pattern),
          ilike(organizationsTable.slug, pattern),
        ))
        .limit(10),

      db.select({ id: usersTable.id, email: usersTable.email, firstName: usersTable.firstName, lastName: usersTable.lastName, externalId: usersTable.externalId })
        .from(usersTable)
        .where(or(ilike(usersTable.email, pattern), ilike(usersTable.firstName, pattern), ilike(usersTable.lastName, pattern)))
        .limit(10),

      db.select({ id: platformInternalNotesTable.id, content: platformInternalNotesTable.content, organizationId: platformInternalNotesTable.organizationId, createdAt: platformInternalNotesTable.createdAt })
        .from(platformInternalNotesTable)
        .where(ilike(platformInternalNotesTable.content, pattern))
        .limit(10),

      db.select({ id: plansTable.id, code: plansTable.code, name: plansTable.name })
        .from(plansTable)
        .where(or(ilike(plansTable.name, pattern), ilike(plansTable.code, pattern)))
        .limit(5),
    ]);

    res.json({
      query: q,
      results: {
        organisations: orgs,
        users,
        internalNotes: notes,
        plans,
      },
      total: orgs.length + users.length + notes.length + plans.length,
    });
  } catch (err) { next(err); }
});

export default router;
