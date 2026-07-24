/**
 * Platform Trials routes — /v1/platform/trials
 * Sprint 4: View and manage all trials across the platform.
 *
 * GET  /           — all trials (current, expired, upcoming expiry)
 * GET  /expiring   — trials expiring within N days
 * GET  /expired    — expired trials
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  db, tenantSubscriptionsTable, organizationsTable, plansTable,
} from "@workspace/db";
import { eq, and, lte, gte, desc, or } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

router.get("/", ...auth, async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined; // trial | trial_expired | all
    const daysFilter = Number(req.query.days) || null;

    let q = db
      .select({ sub: tenantSubscriptionsTable, org: organizationsTable, plan: plansTable })
      .from(tenantSubscriptionsTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, tenantSubscriptionsTable.organizationId))
      .leftJoin(plansTable, eq(plansTable.id, tenantSubscriptionsTable.planId))
      .$dynamic();

    if (!status || status === "trial") {
      q = q.where(eq(tenantSubscriptionsTable.status, "trial"));
    } else if (status === "trial_expired") {
      q = q.where(eq(tenantSubscriptionsTable.status, "trial_expired"));
    } else {
      q = q.where(or(
        eq(tenantSubscriptionsTable.status, "trial"),
        eq(tenantSubscriptionsTable.status, "trial_expired"),
      ));
    }

    const rows = await q.orderBy(desc(tenantSubscriptionsTable.trialEndAt));
    const now = new Date();

    const trials = rows.map(r => {
      const trialEnd = r.sub.trialEndAt;
      const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000) : null;
      return { subscription: r.sub, organisation: r.org, plan: r.plan, daysLeft, trialEnd };
    });

    // Apply days filter
    const filtered = daysFilter !== null
      ? trials.filter(t => t.daysLeft !== null && t.daysLeft <= daysFilter && t.daysLeft >= 0)
      : trials;

    const expiringSoon = trials.filter(t => t.daysLeft !== null && t.daysLeft >= 0 && t.daysLeft <= 7).length;
    const expired = trials.filter(t => t.daysLeft !== null && t.daysLeft < 0).length;
    const active  = trials.filter(t => t.daysLeft !== null && t.daysLeft >= 0).length;

    res.json({ trials: filtered, summary: { total: trials.length, active, expiringSoon, expired } });
  } catch (err) { next(err); }
});

router.get("/expiring", ...auth, async (req, res, next) => {
  try {
    const days = Number(req.query.days) || 7;
    const now  = new Date();
    const cutoff = new Date(now.getTime() + days * 86_400_000);

    const rows = await db
      .select({ sub: tenantSubscriptionsTable, org: organizationsTable, plan: plansTable })
      .from(tenantSubscriptionsTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, tenantSubscriptionsTable.organizationId))
      .leftJoin(plansTable, eq(plansTable.id, tenantSubscriptionsTable.planId))
      .where(and(
        eq(tenantSubscriptionsTable.status, "trial"),
        lte(tenantSubscriptionsTable.trialEndAt, cutoff),
        gte(tenantSubscriptionsTable.trialEndAt, now),
      ))
      .orderBy(tenantSubscriptionsTable.trialEndAt);

    const trials = rows.map(r => {
      const trialEnd = r.sub.trialEndAt;
      const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000) : null;
      return { subscription: r.sub, organisation: r.org, plan: r.plan, daysLeft };
    });

    res.json({ trials, withinDays: days });
  } catch (err) { next(err); }
});

export default router;
