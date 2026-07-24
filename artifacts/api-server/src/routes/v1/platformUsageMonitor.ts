/**
 * Platform Usage Monitor routes — /v1/platform/usage-monitor
 * Sprint 4: Cross-org usage visibility, top consumers, warnings, trends.
 *
 * GET  /summary          — overall platform usage summary
 * GET  /top-orgs         — highest usage organisations per dimension
 * GET  /warnings         — orgs at warning thresholds
 * GET  /dimensions       — usage by dimension across platform
 * GET  /trends           — monthly aggregates for charts
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  db,
  usagePeriodSummariesTable,
  usageEventsTable,
  organizationsTable,
  tenantSubscriptionsTable,
  plansTable,
  usageDimensionsTable,
  planUsageAllowancesTable,
  planVersionsTable,
  tenantUsageAllowancesTable,
} from "@workspace/db";
import { eq, desc, sum, count, sql, and, gte } from "drizzle-orm";
import { USAGE_WARNING_THRESHOLDS } from "@workspace/shared";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

router.get("/summary", ...auth, async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalEvents, monthlyEvents, totalOrgs] = await Promise.all([
      db.select({ n: count() }).from(usageEventsTable),
      db.select({ n: count() }).from(usageEventsTable)
        .where(gte(usageEventsTable.recordedAt, monthStart)),
      db.select({ n: count() }).from(organizationsTable),
    ]);

    const dimensionTotals = await db
      .select({ dimensionCode: usagePeriodSummariesTable.dimensionCode, total: sum(usagePeriodSummariesTable.totalQuantity) })
      .from(usagePeriodSummariesTable)
      .where(gte(usagePeriodSummariesTable.periodStart, monthStart))
      .groupBy(usagePeriodSummariesTable.dimensionCode)
      .orderBy(desc(sum(usagePeriodSummariesTable.totalQuantity)));

    res.json({
      totalUsageEvents: Number(totalEvents[0]?.n ?? 0),
      monthlyUsageEvents: Number(monthlyEvents[0]?.n ?? 0),
      totalOrganisations: Number(totalOrgs[0]?.n ?? 0),
      dimensionTotalsThisMonth: dimensionTotals.map(d => ({ dimensionCode: d.dimensionCode, total: Number(d.total ?? 0) })),
      generatedAt: now.toISOString(),
    });
  } catch (err) { next(err); }
});

router.get("/top-orgs", ...auth, async (req, res, next) => {
  try {
    const dimensionCode = req.query.dimension as string | undefined;
    const topN = Math.min(50, Number(req.query.limit) || 10);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let q = db
      .select({
        orgId: usagePeriodSummariesTable.organizationId,
        dimensionCode: usagePeriodSummariesTable.dimensionCode,
        total: sum(usagePeriodSummariesTable.totalQuantity),
      })
      .from(usagePeriodSummariesTable)
      .where(gte(usagePeriodSummariesTable.periodStart, monthStart))
      .$dynamic();

    if (dimensionCode) {
      q = q.where(and(
        gte(usagePeriodSummariesTable.periodStart, monthStart),
        eq(usagePeriodSummariesTable.dimensionCode, dimensionCode),
      ));
    }

    const rows = await q
      .groupBy(usagePeriodSummariesTable.organizationId, usagePeriodSummariesTable.dimensionCode)
      .orderBy(desc(sum(usagePeriodSummariesTable.totalQuantity)))
      .limit(topN);

    // Enrich with org names
    const orgIds = [...new Set(rows.map(r => r.orgId).filter(Boolean))] as string[];
    const orgs = orgIds.length
      ? await db.select({ id: organizationsTable.id, name: organizationsTable.name, slug: organizationsTable.slug })
          .from(organizationsTable)
          .where(sql`${organizationsTable.id} = ANY(${orgIds})`)
      : [];
    const orgMap = Object.fromEntries(orgs.map(o => [o.id, o]));

    const result = rows.map(r => ({
      org: r.orgId ? (orgMap[r.orgId] ?? { id: r.orgId }) : null,
      dimensionCode: r.dimensionCode,
      totalThisMonth: Number(r.total ?? 0),
    }));

    res.json({ topOrgs: result, period: { start: monthStart, end: now } });
  } catch (err) { next(err); }
});

router.get("/warnings", ...auth, async (_req, res, next) => {
  try {
    // Find orgs where usage >= 80% of their plan limit
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const usageRows = await db
      .select({
        orgId: usagePeriodSummariesTable.organizationId,
        dimensionCode: usagePeriodSummariesTable.dimensionCode,
        total: sum(usagePeriodSummariesTable.totalQuantity),
      })
      .from(usagePeriodSummariesTable)
      .where(gte(usagePeriodSummariesTable.periodStart, monthStart))
      .groupBy(usagePeriodSummariesTable.organizationId, usagePeriodSummariesTable.dimensionCode);

    const subs = await db
      .select({ orgId: tenantSubscriptionsTable.organizationId, planVersionId: tenantSubscriptionsTable.planVersionId })
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.status, "active"));

    const subMap = Object.fromEntries(subs.map(s => [s.orgId, s.planVersionId]));

    const allowances = await db.select().from(planUsageAllowancesTable);
    const allowanceMap: Record<string, Record<string, number | null>> = {};
    for (const a of allowances) {
      if (!allowanceMap[a.planVersionId]) allowanceMap[a.planVersionId] = {};
      allowanceMap[a.planVersionId]![a.dimensionCode] = a.hardLimit;
    }

    const warnings: any[] = [];
    for (const row of usageRows) {
      if (!row.orgId) continue;
      const pvId = subMap[row.orgId];
      if (!pvId) continue;
      const limit = allowanceMap[pvId]?.[row.dimensionCode];
      if (limit === null || limit === undefined) continue;
      const pct = (Number(row.total ?? 0) / limit) * 100;
      if (pct >= USAGE_WARNING_THRESHOLDS.warn) {
        warnings.push({
          orgId: row.orgId,
          dimensionCode: row.dimensionCode,
          used: Number(row.total ?? 0),
          limit,
          pct: Math.round(pct),
          level: pct >= USAGE_WARNING_THRESHOLDS.critical ? "critical" : "warn",
        });
      }
    }

    warnings.sort((a, b) => b.pct - a.pct);

    // Enrich with org names
    const orgIds = [...new Set(warnings.map(w => w.orgId))];
    const orgs = orgIds.length
      ? await db.select({ id: organizationsTable.id, name: organizationsTable.name })
          .from(organizationsTable).where(sql`${organizationsTable.id} = ANY(${orgIds})`)
      : [];
    const orgMap = Object.fromEntries(orgs.map(o => [o.id, o]));

    res.json({
      warnings: warnings.map(w => ({ ...w, org: orgMap[w.orgId] ?? { id: w.orgId } })),
      total: warnings.length,
      critical: warnings.filter(w => w.level === "critical").length,
    });
  } catch (err) { next(err); }
});

router.get("/trends", ...auth, async (req, res, next) => {
  try {
    const months = Math.min(12, Number(req.query.months) || 6);
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const rows = await db
      .select({
        period: usagePeriodSummariesTable.periodStart,
        dimensionCode: usagePeriodSummariesTable.dimensionCode,
        total: sum(usagePeriodSummariesTable.totalQuantity),
        orgCount: count(usagePeriodSummariesTable.organizationId),
      })
      .from(usagePeriodSummariesTable)
      .where(gte(usagePeriodSummariesTable.periodStart, startDate))
      .groupBy(usagePeriodSummariesTable.periodStart, usagePeriodSummariesTable.dimensionCode)
      .orderBy(usagePeriodSummariesTable.periodStart);

    res.json({ trends: rows.map(r => ({ period: r.period, dimensionCode: r.dimensionCode, total: Number(r.total ?? 0), orgCount: Number(r.orgCount ?? 0) })) });
  } catch (err) { next(err); }
});

export default router;
