/**
 * Platform Console master router — /v1/platform/*
 * Sprint 4: Mounts all platform sub-routers.
 *
 * Sub-routers:
 *   /dashboard          → dashboard metrics
 *   /organisations      → org directory + detail + all org actions
 *   /commercial         → plan designer, versions, features, packs, usage dims
 *   /trials             → trial management
 *   /workforce          → workforce designer (metadata)
 *   /usage-monitor      → cross-org usage monitor + charts
 *   /support            → support centre
 *   /security           → security overview
 *   /audit              → platform audit log
 *   /settings           → feature flags + platform config + roles
 *   /search             → global search
 *   /export             → CSV exports
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  db,
  organizationsTable,
  membershipsTable,
  usersTable,
  tenantSubscriptionsTable,
  tasksTable,
  approvalsTable,
  auditLogTable,
} from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";

// Sub-routers
import platformOrgsRouter from "./platformOrgs.js";
import platformCommercialRouter from "./platformCommercial.js";
import platformTrialsRouter from "./platformTrials.js";
import platformWorkforceRouter from "./platformWorkforce.js";
import platformUsageMonitorRouter from "./platformUsageMonitor.js";
import platformSupportRouter from "./platformSupport.js";
import platformSecurityRouter from "./platformSecurity.js";
import platformAuditRouter from "./platformAuditLog.js";
import platformSettingsRouter from "./platformSettingsAdmin.js";
import platformSearchRouter from "./platformSearch.js";
import platformExportRouter from "./platformExport.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// ─── GET /dashboard ────────────────────────────────────────────────────────────

router.get("/dashboard", ...auth, async (_req, res, next) => {
  try {
    const now = new Date();

    const [
      [orgCount],
      [activeOrgCount],
      [suspendedOrgCount],
      [userCount],
      [memberCount],
      [taskCount],
      [approvalCount],
      recentAudit,
    ] = await Promise.all([
      db.select({ n: count() }).from(organizationsTable),
      db.select({ n: count() }).from(organizationsTable).where(eq(organizationsTable.status, "active")),
      db.select({ n: count() }).from(organizationsTable).where(eq(organizationsTable.status, "suspended")),
      db.select({ n: count() }).from(usersTable),
      db.select({ n: count() }).from(membershipsTable).where(eq(membershipsTable.status, "active")),
      db.select({ n: count() }).from(tasksTable),
      db.select({ n: count() }).from(approvalsTable).where(eq(approvalsTable.state, "pending")),
      db.select().from(auditLogTable).orderBy(desc(auditLogTable.createdAt)).limit(10),
    ]);

    const [trialCount] = await db
      .select({ n: count() })
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.status, "trial"));

    const [trialExpiredCount] = await db
      .select({ n: count() })
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.status, "trial_expired"));

    res.json({
      metrics: {
        totalOrganisations: Number(orgCount?.n ?? 0),
        activeOrganisations: Number(activeOrgCount?.n ?? 0),
        suspendedOrganisations: Number(suspendedOrgCount?.n ?? 0),
        organisationsOnTrial: Number(trialCount?.n ?? 0),
        trialExpired: Number(trialExpiredCount?.n ?? 0),
        activeUsers: Number(memberCount?.n ?? 0),
        totalUsers: Number(userCount?.n ?? 0),
        tasksCreated: Number(taskCount?.n ?? 0),
        pendingApprovals: Number(approvalCount?.n ?? 0),
        usageWarnings: 0,
        systemHealthStatus: "operational",
      },
      recentAuditEvents: recentAudit,
      generatedAt: now.toISOString(),
      note: "Revenue metrics are not available until Stripe is connected (Sprint 5+).",
    });
  } catch (err) { next(err); }
});

// ─── Sub-router mounts ────────────────────────────────────────────────────────

router.use("/organisations", platformOrgsRouter);
router.use("/commercial", platformCommercialRouter);
router.use("/trials", platformTrialsRouter);
router.use("/workforce", platformWorkforceRouter);
router.use("/usage-monitor", platformUsageMonitorRouter);
router.use("/support", platformSupportRouter);
router.use("/security", platformSecurityRouter);
router.use("/audit", platformAuditRouter);
router.use("/settings", platformSettingsRouter);
router.use("/search", platformSearchRouter);
router.use("/export", platformExportRouter);

// ─── Backwards-compat: /plans still works ─────────────────────────────────────
// Kept for Sprint 3 compatibility
router.get("/plans", ...auth, async (_req, res, next) => {
  try {
    const { plansTable, planVersionsTable, tenantSubscriptionsTable: subTable } = await import("@workspace/db");
    const plans = await db.select().from(plansTable).orderBy(plansTable.displayOrder);
    const versions = await db.select().from(planVersionsTable);
    const subs = await db.select({ n: count(), planId: subTable.planId }).from(subTable).groupBy(subTable.planId);
    const subMap = Object.fromEntries(subs.map(s => [s.planId, Number(s.n)]));
    const versionMap: Record<string, typeof versions> = {};
    for (const v of versions) {
      if (!versionMap[v.planId]) versionMap[v.planId] = [];
      versionMap[v.planId]!.push(v);
    }
    res.json({ plans: plans.map(p => ({ ...p, versions: versionMap[p.id] ?? [], subscriberCount: subMap[p.id] ?? 0 })) });
  } catch (err) { next(err); }
});

export default router;
