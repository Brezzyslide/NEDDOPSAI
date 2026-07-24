/**
 * Platform Console routes — /v1/platform/*
 *
 * All routes require platform auth (platform_roles table or Clerk platformAdmin flag).
 * Platform admins do NOT automatically have access to customer files or operational data.
 * Every sensitive action is audited.
 *
 * Routes implemented:
 *   GET  /v1/platform/organisations
 *   GET  /v1/platform/organisations/:id
 *   POST /v1/platform/organisations/:id/suspend
 *   POST /v1/platform/organisations/:id/reactivate
 *   POST /v1/platform/organisations/:id/trial/extend
 *   POST /v1/platform/organisations/:id/overrides
 *   DELETE /v1/platform/organisations/:id/overrides/:overrideId
 *   GET  /v1/platform/organisations/:id/usage
 *   GET  /v1/platform/organisations/:id/entitlements
 *   GET  /v1/platform/organisations/:id/audit
 *   POST /v1/platform/organisations/:id/internal-notes
 *   GET  /v1/platform/dashboard
 *   GET  /v1/platform/plans
 */

import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth, requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  db,
  organizationsTable,
  membershipsTable,
  usersTable,
  tenantSubscriptionsTable,
  tenantOverridesTable,
  tenantEntitlementsTable,
  tenantWorkforcePacksTable,
  auditLogTable,
  platformInternalNotesTable,
  plansTable,
  planVersionsTable,
  tasksTable,
  approvalsTable,
} from "@workspace/db";
import { eq, and, count, desc, like, or, isNull, lte, gte } from "drizzle-orm";
import { auditService } from "../../services/auditService.js";
import { getUsageAllowance } from "../../services/entitlementService.js";
import { USAGE_DIMENSION_CODES, type UsageDimensionCode } from "@workspace/shared";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// ─── GET /dashboard ───────────────────────────────────────────────────────────

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
        usageWarnings: 0, // populated by a background job in future sprint
        systemHealthStatus: "operational",
      },
      recentAuditEvents: recentAudit,
      generatedAt: now.toISOString(),
      note: "Revenue metrics are not available until Stripe is connected.",
    });
  } catch (err) { next(err); }
});

// ─── GET /plans ───────────────────────────────────────────────────────────────

router.get("/plans", ...auth, async (_req, res, next) => {
  try {
    const plans = await db.select().from(plansTable).orderBy(plansTable.displayOrder);
    const versions = await db.select().from(planVersionsTable);
    const subscriptions = await db.select({ n: count(), planId: tenantSubscriptionsTable.planId })
      .from(tenantSubscriptionsTable)
      .groupBy(tenantSubscriptionsTable.planId);

    const subMap = Object.fromEntries(subscriptions.map(s => [s.planId, Number(s.n)]));
    const versionMap: Record<string, typeof versions> = {};
    for (const v of versions) {
      if (!versionMap[v.planId]) versionMap[v.planId] = [];
      versionMap[v.planId]!.push(v);
    }

    res.json({
      plans: plans.map(p => ({
        ...p,
        versions: versionMap[p.id] ?? [],
        subscriberCount: subMap[p.id] ?? 0,
      })),
    });
  } catch (err) { next(err); }
});

// ─── GET /organisations ───────────────────────────────────────────────────────

router.get("/organisations", ...auth, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const search = req.query.search as string | undefined;
    const statusFilter = req.query.status as string | undefined;
    const planFilter = req.query.plan as string | undefined;

    let query = db
      .select({
        org: organizationsTable,
        memberCount: count(membershipsTable.id),
      })
      .from(organizationsTable)
      .leftJoin(membershipsTable, and(
        eq(membershipsTable.organizationId, organizationsTable.id),
        eq(membershipsTable.status, "active"),
      ))
      .groupBy(organizationsTable.id)
      .$dynamic();

    if (statusFilter) {
      query = query.where(eq(organizationsTable.status, statusFilter as "active" | "suspended" | "closed" | "onboarding"));
    }

    if (search) {
      query = query.where(or(
        like(organizationsTable.name, `%${search}%`),
        like(organizationsTable.slug, `%${search}%`),
      ));
    }

    const rows = await query.limit(limit).offset(offset).orderBy(desc(organizationsTable.createdAt));

    const orgIds = rows.map(r => r.org.id);
    const subs = orgIds.length > 0
      ? await db.select().from(tenantSubscriptionsTable)
          .where(
            or(...orgIds.map(id => eq(tenantSubscriptionsTable.organizationId, id))),
          )
      : [];
    const subMap = Object.fromEntries(subs.map(s => [s.organizationId, s]));

    res.json({
      organisations: rows.map(r => ({
        ...r.org,
        activeMemberCount: Number(r.memberCount),
        subscription: subMap[r.org.id] ?? null,
      })),
      page,
      limit,
    });
  } catch (err) { next(err); }
});

// ─── GET /organisations/:id ───────────────────────────────────────────────────

router.get("/organisations/:id", ...auth, async (req, res, next) => {
  try {
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const [sub, members, overrides, notes] = await Promise.all([
      db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, org.id)).limit(1),
      db.select({ membership: membershipsTable, user: usersTable })
        .from(membershipsTable)
        .leftJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
        .where(eq(membershipsTable.organizationId, org.id)),
      db.select().from(tenantOverridesTable).where(and(eq(tenantOverridesTable.organizationId, org.id), eq(tenantOverridesTable.isActive, true))),
      db.select().from(platformInternalNotesTable).where(eq(platformInternalNotesTable.organizationId, org.id)).orderBy(desc(platformInternalNotesTable.createdAt)).limit(20),
    ]);

    // Audit: platform admin viewed this org
    await auditService.log({
      eventType: "platform.organisation_viewed",
      actorId: req.platformUserId ?? null,
      organizationId: org.id,
      metadata: { viewedOrgId: org.id },
    }).catch(() => { /* non-blocking */ });

    res.json({
      organisation: org,
      subscription: sub[0] ?? null,
      members,
      activeOverrides: overrides,
      internalNotes: notes,
      tabs: {
        connectors: { status: "not_implemented", message: "Connectors coming in a later sprint." },
        devices: { status: "not_implemented", message: "Local device access coming in a later sprint." },
        openclaw: { status: "not_implemented", message: "OpenClaw runtime coming in a later sprint." },
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /organisations/:id/suspend ─────────────────────────────────────────

router.post("/organisations/:id/suspend",
  ...auth,
  requirePlatformRole("platform_operations_admin"),
  async (req, res, next) => {
    try {
      const { reason } = req.body as { reason: string };
      if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
      if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

      await db.update(organizationsTable).set({ status: "suspended", updatedAt: new Date() }).where(eq(organizationsTable.id, org.id));

      await auditService.log({
        eventType: "platform.organisation_suspended",
        actorId: req.platformUserId ?? null,
        organizationId: org.id,
        metadata: { reason, actorId: req.platformUserId },
      });

      res.json({ success: true, message: `Organisation '${org.name}' suspended.` });
    } catch (err) { next(err); }
  },
);

// ─── POST /organisations/:id/reactivate ──────────────────────────────────────

router.post("/organisations/:id/reactivate",
  ...auth,
  requirePlatformRole("platform_operations_admin"),
  async (req, res, next) => {
    try {
      const { reason } = req.body as { reason: string };
      if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
      if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

      await db.update(organizationsTable).set({ status: "active", updatedAt: new Date() }).where(eq(organizationsTable.id, org.id));

      await auditService.log({
        eventType: "platform.organisation_reactivated",
        actorId: req.platformUserId ?? null,
        organizationId: org.id,
        metadata: { reason },
      });

      res.json({ success: true, message: `Organisation '${org.name}' reactivated.` });
    } catch (err) { next(err); }
  },
);

// ─── POST /organisations/:id/trial/extend ─────────────────────────────────────

router.post("/organisations/:id/trial/extend",
  ...auth,
  requirePlatformRole("platform_billing_admin"),
  async (req, res, next) => {
    try {
      const { days, reason } = req.body as { days: number; reason: string };
      if (!days || !reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "days and reason are required." } }); return; }

      const [sub] = await db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, req.params.id!)).limit(1);
      if (!sub) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found." } }); return; }

      const currentEnd = sub.trialEndAt ?? new Date();
      const newEnd = new Date(currentEnd.getTime() + days * 24 * 60 * 60 * 1000);

      await db.update(tenantSubscriptionsTable)
        .set({ trialEndAt: newEnd, updatedAt: new Date(), internalNote: `Trial extended by ${days} days. Reason: ${reason}` })
        .where(eq(tenantSubscriptionsTable.id, sub.id));

      await auditService.log({
        eventType: "platform.trial_extended",
        actorId: req.platformUserId ?? null,
        organizationId: req.params.id!,
        metadata: { days, reason, newEnd: newEnd.toISOString() },
      });

      res.json({ success: true, newTrialEnd: newEnd });
    } catch (err) { next(err); }
  },
);

// ─── POST /organisations/:id/overrides ────────────────────────────────────────

router.post("/organisations/:id/overrides",
  ...auth,
  requirePlatformRole("platform_operations_admin"),
  async (req, res, next) => {
    try {
      const { overrideType, value, reason, internalNote, customerNote, effectiveTo } = req.body as {
        overrideType: string; value: Record<string, unknown>; reason: string;
        internalNote?: string; customerNote?: string; effectiveTo?: string;
      };

      if (!overrideType || !reason) {
        res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "overrideType and reason are required." } });
        return;
      }

      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
      if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

      const overrideId = randomUUID();
      const [created] = await db.insert(tenantOverridesTable).values({
        id: overrideId,
        organizationId: org.id,
        overrideType: overrideType as "extra_seats" | "workforce_pack" | "extra_usage" | "execution_capability" | "connector_access" | "feature_denial" | "trial_extension",
        value: value ?? {},
        reason,
        internalNote: internalNote ?? null,
        customerNote: customerNote ?? null,
        createdBy: req.platformUserId!,
        effectiveFrom: new Date(),
        effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        isActive: true,
      }).returning();

      await auditService.log({
        eventType: "platform.override_created",
        actorId: req.platformUserId ?? null,
        organizationId: org.id,
        metadata: { overrideId, overrideType, reason },
      });

      res.status(201).json({ override: created });
    } catch (err) { next(err); }
  },
);

// ─── DELETE /organisations/:id/overrides/:overrideId ──────────────────────────

router.delete("/organisations/:id/overrides/:overrideId",
  ...auth,
  requirePlatformRole("platform_operations_admin"),
  async (req, res, next) => {
    try {
      const { reason } = req.body as { reason?: string };
      await db.update(tenantOverridesTable)
        .set({ isActive: false, revokedAt: new Date(), revokedBy: req.platformUserId!, revokeReason: reason ?? null, updatedAt: new Date() })
        .where(and(eq(tenantOverridesTable.id, req.params.overrideId!), eq(tenantOverridesTable.organizationId, req.params.id!)));

      await auditService.log({
        eventType: "platform.override_revoked",
        actorId: req.platformUserId ?? null,
        organizationId: req.params.id!,
        metadata: { overrideId: req.params.overrideId, reason },
      });

      res.json({ success: true });
    } catch (err) { next(err); }
  },
);

// ─── GET /organisations/:id/usage ─────────────────────────────────────────────

router.get("/organisations/:id/usage", ...auth, async (req, res, next) => {
  try {
    const orgId = req.params.id!;
    const allowances = await Promise.all(
      USAGE_DIMENSION_CODES.map(dim => getUsageAllowance(orgId, dim as UsageDimensionCode)),
    );
    res.json({ dimensions: allowances });
  } catch (err) { next(err); }
});

// ─── GET /organisations/:id/entitlements ──────────────────────────────────────

router.get("/organisations/:id/entitlements", ...auth, async (req, res, next) => {
  try {
    const orgId = req.params.id!;
    const [sub, entitlements, packs] = await Promise.all([
      db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, orgId)).limit(1),
      db.select().from(tenantEntitlementsTable).where(eq(tenantEntitlementsTable.organizationId, orgId)),
      db.select().from(tenantWorkforcePacksTable).where(and(eq(tenantWorkforcePacksTable.organizationId, orgId), isNull(tenantWorkforcePacksTable.revokedAt))),
    ]);
    res.json({ subscription: sub[0] ?? null, entitlements, workforcePacks: packs });
  } catch (err) { next(err); }
});

// ─── GET /organisations/:id/audit ─────────────────────────────────────────────

router.get("/organisations/:id/audit", ...auth, async (req, res, next) => {
  try {
    const limit = Math.min(100, Number(req.query.limit) || 50);
    const events = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.organizationId, req.params.id!))
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit);
    res.json({ events, count: events.length });
  } catch (err) { next(err); }
});

// ─── POST /organisations/:id/internal-notes ───────────────────────────────────

router.post("/organisations/:id/internal-notes",
  ...auth,
  requirePlatformRole("platform_support_admin"),
  async (req, res, next) => {
    try {
      const { content, isFlagged } = req.body as { content: string; isFlagged?: boolean };
      if (!content) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content is required." } }); return; }

      const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
      if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

      const [note] = await db.insert(platformInternalNotesTable).values({
        id: randomUUID(),
        organizationId: org.id,
        content,
        authorId: req.platformUserId!,
        isInternal: true,
        isFlagged: isFlagged ?? false,
      }).returning();

      await auditService.log({
        eventType: "platform.internal_note_added",
        actorId: req.platformUserId ?? null,
        organizationId: org.id,
        metadata: { noteId: note!.id, isFlagged: isFlagged ?? false },
      });

      if (isFlagged) {
        await auditService.log({
          eventType: "platform.security_review_flagged",
          actorId: req.platformUserId ?? null,
          organizationId: org.id,
          metadata: { noteId: note!.id },
        });
      }

      res.status(201).json({ note });
    } catch (err) { next(err); }
  },
);

export default router;
