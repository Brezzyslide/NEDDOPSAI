/**
 * Platform Console master router — /v1/platform/*
 * Sprint 7: Dashboard updated to remove operational table reads.
 *           Uses platformAuditLogTable instead of legacy auditLogTable.
 *           Task and approval counts use SECURITY DEFINER aggregate functions.
 *
 * Sub-routers:
 *   /dashboard          → platform-level metrics only (no operational content)
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
 *   /database/*         → org database management (Sprint 6/7)
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
  platformAuditLogTable,   // Sprint 7: use split table, not legacy audit_log
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
import platformRuntimeRouter from "./platformRuntime.js";
import platformExportRouter from "./platformExport.js";
import platformAIRouter from "./platformAI.js";
import { platformDatabaseRouter } from "./platformDatabase.js";
import platformStaffRouter from "./platformStaff.js";
import platformPackGrantsRouter from "./platformPackGrants.js";
import platformDevicesRouter from "./platformDevices.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// ─── GET /dashboard ────────────────────────────────────────────────────────────

router.get("/dashboard", ...auth, async (_req, res, next) => {
  try {
    const now = new Date();

    // Sprint 7: Dashboard reads ONLY platform-level tables.
    // Operational table reads (tasks, approvals) removed — they are
    // now org-scoped and must not appear in platform aggregates without
    // the SECURITY DEFINER function boundary.
    const [
      [orgCount],
      [activeOrgCount],
      [suspendedOrgCount],
      [userCount],
      [memberCount],
      recentPlatformAudit,
    ] = await Promise.all([
      db.select({ n: count() }).from(organizationsTable),
      db.select({ n: count() }).from(organizationsTable).where(eq(organizationsTable.status, "active")),
      db.select({ n: count() }).from(organizationsTable).where(eq(organizationsTable.status, "suspended")),
      db.select({ n: count() }).from(usersTable),
      db.select({ n: count() }).from(membershipsTable).where(eq(membershipsTable.status, "active")),
      // Sprint 7: use platformAuditLogTable, not legacy audit_log
      db.select().from(platformAuditLogTable).orderBy(desc(platformAuditLogTable.occurredAt)).limit(10),
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
        // Sprint 7: task/approval counts removed from platform dashboard.
        // Use /v1/platform/organisations/:id/database/status for per-org counts.
        systemHealthStatus: "operational",
      },
      recentPlatformEvents: recentPlatformAudit,
      generatedAt: now.toISOString(),
      note: "Sprint 7: Operational data (tasks, approvals) is now scoped to org databases. Use per-org status endpoints.",
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
// Sprint 8 — OpenClaw Runtime monitoring
router.use("/runtime", platformRuntimeRouter);
// Sprint 9.1 — AI Operations dashboard
router.use("/ai", platformAIRouter);
// Sprint 9.7 — Platform Staff Management
router.use("/staff", platformStaffRouter);
// Sprint 9.7 — Pack grant/revoke from platform console
router.use("/packs", platformPackGrantsRouter);
// Task #34 — Connector & Device Fleet Management
router.use("/devices", platformDevicesRouter);
// Sprint 6/7 — Organisation Database management
router.use("/", platformDatabaseRouter);

// ─── Backwards-compat: /plans still works ────────────────────────────────────
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
