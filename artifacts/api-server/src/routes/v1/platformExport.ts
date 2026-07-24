/**
 * Platform Export routes — /v1/platform/export
 * Sprint 4: CSV downloads for organisations, plans, trials, usage, support.
 * No PDF yet.
 *
 * GET  /organisations  — org directory CSV
 * GET  /plans          — plan catalogue CSV
 * GET  /trials         — trial status CSV
 * GET  /usage          — usage summary CSV
 * GET  /support        — support notes CSV
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  db, organizationsTable, tenantSubscriptionsTable, plansTable,
  platformInternalNotesTable, usagePeriodSummariesTable,
} from "@workspace/db";
import { eq, desc, gte, or } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

function toCSV(rows: Record<string, any>[], columns: string[]): string {
  const escape = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.join(",");
  const body = rows.map(r => columns.map(c => escape(r[c])).join(",")).join("\n");
  return `${header}\n${body}`;
}

function sendCSV(res: any, filename: string, csv: string) {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

router.get("/organisations", ...auth, async (_req, res, next) => {
  try {
    const orgs = await db.select().from(organizationsTable).orderBy(organizationsTable.createdAt);
    const subs = await db.select().from(tenantSubscriptionsTable);
    const plans = await db.select().from(plansTable);
    const subMap = Object.fromEntries(subs.map(s => [s.organizationId, s]));
    const planMap = Object.fromEntries(plans.map(p => [p.id, p]));

    const rows = orgs.map(o => {
      const sub = subMap[o.id];
      const plan = sub ? planMap[sub.planId] : null;
      return {
        id: o.id, name: o.name, slug: o.slug, status: o.status,
        subscriptionTier: o.subscriptionTier,
        plan: plan?.name ?? "",
        subscriptionStatus: sub?.status ?? "",
        trialEnd: sub?.trialEndAt?.toISOString() ?? "",
        createdAt: o.createdAt?.toISOString() ?? "",
        updatedAt: o.updatedAt?.toISOString() ?? "",
      };
    });

    const csv = toCSV(rows, ["id", "name", "slug", "status", "plan", "subscriptionStatus", "trialEnd", "createdAt"]);
    sendCSV(res, `needsops-organisations-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (err) { next(err); }
});

router.get("/plans", ...auth, async (_req, res, next) => {
  try {
    const plans = await db.select().from(plansTable).orderBy(plansTable.displayOrder);
    const subs = await db.select({ planId: tenantSubscriptionsTable.planId }).from(tenantSubscriptionsTable);
    const subCounts: Record<string, number> = {};
    for (const s of subs) { subCounts[s.planId] = (subCounts[s.planId] ?? 0) + 1; }
    const rows = plans.map(p => ({ ...p, subscriberCount: subCounts[p.id] ?? 0 }));
    const csv = toCSV(rows, ["id", "code", "name", "isActive", "isPublic", "trialLengthDays", "currency", "subscriberCount", "createdAt"]);
    sendCSV(res, `needsops-plans-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (err) { next(err); }
});

router.get("/trials", ...auth, async (_req, res, next) => {
  try {
    const now = new Date();
    const trials = await db.select({ sub: tenantSubscriptionsTable, org: organizationsTable, plan: plansTable })
      .from(tenantSubscriptionsTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, tenantSubscriptionsTable.organizationId))
      .leftJoin(plansTable, eq(plansTable.id, tenantSubscriptionsTable.planId))
      .where(or(eq(tenantSubscriptionsTable.status, "trial"), eq(tenantSubscriptionsTable.status, "trial_expired")));

    const rows = trials.map(t => {
      const trialEnd = t.sub.trialEndAt;
      const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000) : null;
      return {
        orgId: t.org?.id ?? "", orgName: t.org?.name ?? "",
        plan: t.plan?.name ?? "", status: t.sub.status,
        trialStart: t.sub.trialStartAt?.toISOString() ?? "",
        trialEnd: t.sub.trialEndAt?.toISOString() ?? "",
        daysLeft: daysLeft ?? "",
      };
    });

    const csv = toCSV(rows, ["orgId", "orgName", "plan", "status", "trialStart", "trialEnd", "daysLeft"]);
    sendCSV(res, `needsops-trials-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (err) { next(err); }
});

router.get("/usage", ...auth, async (_req, res, next) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const rows = await db.select({
      u: usagePeriodSummariesTable,
      org: { id: organizationsTable.id, name: organizationsTable.name },
    })
      .from(usagePeriodSummariesTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, usagePeriodSummariesTable.organizationId))
      .where(gte(usagePeriodSummariesTable.periodStart, monthStart))
      .orderBy(desc(usagePeriodSummariesTable.totalQuantity));

    const csvRows = rows.map(r => ({
      orgId: r.org?.id ?? "", orgName: r.org?.name ?? "",
      dimensionCode: r.u.dimensionCode,
      totalQuantity: r.u.totalQuantity,
      eventCount: r.u.eventCount,
      periodStart: r.u.periodStart?.toISOString() ?? "",
      periodEnd: r.u.periodEnd?.toISOString() ?? "",
    }));

    const csv = toCSV(csvRows, ["orgId", "orgName", "dimensionCode", "totalQuantity", "eventCount", "periodStart", "periodEnd"]);
    sendCSV(res, `needsops-usage-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (err) { next(err); }
});

router.get("/support", ...auth, async (_req, res, next) => {
  try {
    const notes = await db.select({ note: platformInternalNotesTable, org: { id: organizationsTable.id, name: organizationsTable.name } })
      .from(platformInternalNotesTable)
      .leftJoin(organizationsTable, eq(organizationsTable.id, platformInternalNotesTable.organizationId))
      .orderBy(desc(platformInternalNotesTable.createdAt));

    const csvRows = notes.map(n => ({
      noteId: n.note.id, orgId: n.org?.id ?? "", orgName: n.org?.name ?? "",
      priority: n.note.priority, category: n.note.category,
      isFlagged: n.note.isFlagged ? "yes" : "no",
      content: n.note.content.replace(/\n/g, " "),
      createdAt: n.note.createdAt?.toISOString() ?? "",
    }));

    const csv = toCSV(csvRows, ["noteId", "orgId", "orgName", "priority", "category", "isFlagged", "content", "createdAt"]);
    sendCSV(res, `needsops-support-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  } catch (err) { next(err); }
});

export default router;
