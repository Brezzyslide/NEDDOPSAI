/**
 * Platform Organisations routes — mounted at /v1/platform/organisations
 * Sprint 4: Expanded from Sprint 3 platform.ts
 *
 * GET  /                         — directory (search, filter, paginated)
 * GET  /:id                      — full detail (13 tabs)
 * POST /:id/suspend              — suspend org
 * POST /:id/reactivate           — reactivate org
 * POST /:id/change-plan          — change subscription plan
 * POST /:id/trial/start          — start a trial
 * POST /:id/trial/extend         — extend trial
 * POST /:id/trial/cancel         — cancel trial
 * POST /:id/overrides            — create override
 * DELETE /:id/overrides/:oid     — revoke override
 * GET  /:id/overrides            — list overrides
 * POST /:id/internal-notes       — add note
 * GET  /:id/internal-notes       — list notes
 * POST /:id/flag-security        — flag for security review
 * POST /:id/mark-high-priority   — mark high-priority support
 * GET  /:id/usage                — usage detail
 * GET  /:id/entitlements         — entitlements
 * GET  /:id/audit                — audit events
 * GET  /:id/tasks                — tasks (paginated)
 * GET  /:id/approvals            — approvals (paginated)
 * GET  /:id/members              — members list
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
  usagePeriodSummariesTable,
  seatOverridesTable,
} from "@workspace/db";
import { eq, and, count, desc, like, or, isNull, gte, lte, ilike, sql } from "drizzle-orm";
import { auditService } from "../../services/auditService.js";
import { getUsageAllowance, getSeatAllowance } from "../../services/entitlementService.js";
import { USAGE_DIMENSION_CODES, type UsageDimensionCode } from "@workspace/shared";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// ─── GET / — Org Directory ─────────────────────────────────────────────────────

router.get("/", ...auth, async (req, res, next) => {
  try {
    const page    = Math.max(1, Number(req.query.page) || 1);
    const limit   = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset  = (page - 1) * limit;
    const search  = req.query.search as string | undefined;
    const status  = req.query.status as string | undefined;
    const plan    = req.query.plan as string | undefined;
    const trial   = req.query.trial === "true";
    const suspended = req.query.suspended === "true";

    let conditions: ReturnType<typeof eq>[] = [];
    if (status)    conditions.push(eq(organizationsTable.status, status as any));
    if (suspended) conditions.push(eq(organizationsTable.status, "suspended"));

    let qb = db
      .select({ org: organizationsTable, memberCount: count(membershipsTable.id) })
      .from(organizationsTable)
      .leftJoin(membershipsTable, and(
        eq(membershipsTable.organizationId, organizationsTable.id),
        eq(membershipsTable.status, "active"),
      ))
      .groupBy(organizationsTable.id)
      .$dynamic();

    if (search) {
      qb = qb.where(or(
        ilike(organizationsTable.name, `%${search}%`),
        ilike(organizationsTable.slug, `%${search}%`),
      ));
    }
    if (status && !suspended) qb = qb.where(eq(organizationsTable.status, status as any));
    if (suspended) qb = qb.where(eq(organizationsTable.status, "suspended"));

    const rows = await qb.limit(limit).offset(offset).orderBy(desc(organizationsTable.createdAt));
    const [totalRow] = await db.select({ n: count() }).from(organizationsTable);

    const orgIds = rows.map(r => r.org.id);
    const [subs, planRows] = await Promise.all([
      orgIds.length
        ? db.select().from(tenantSubscriptionsTable)
            .where(or(...orgIds.map(id => eq(tenantSubscriptionsTable.organizationId, id))))
        : [],
      db.select().from(plansTable),
    ]);

    const subMap = Object.fromEntries(subs.map(s => [s.organizationId, s]));
    const planMap = Object.fromEntries(planRows.map(p => [p.id, p]));

    // Filter by plan code if requested
    let organisations = rows.map(r => {
      const sub = subMap[r.org.id] ?? null;
      const plan = sub ? (planMap[sub.planId] ?? null) : null;
      return { ...r.org, activeMemberCount: Number(r.memberCount), subscription: sub, plan };
    });

    if (plan) organisations = organisations.filter(o => o.plan?.code === plan);
    if (trial) organisations = organisations.filter(o => o.subscription?.status === "trial");

    res.json({ organisations, page, limit, total: Number(totalRow?.n ?? 0) });
  } catch (err) { next(err); }
});

// ─── GET /:id — Org Detail ────────────────────────────────────────────────────

router.get("/:id", ...auth, async (req, res, next) => {
  try {
    const [org] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    // Sprint 5: Platform Console must NOT read operational content (task bodies,
    // approval details). Only safe aggregate counts are permitted here.
    // Operational content is accessible to authorised org members only via org portal.
    const [sub, members, overrides, notes, taskCountResult, approvalCountResult, pendingApprovalCountResult, usageRows] = await Promise.all([
      db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, org.id)).limit(1),
      db.select({ membership: membershipsTable, user: usersTable })
        .from(membershipsTable).leftJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
        .where(eq(membershipsTable.organizationId, org.id)),
      db.select().from(tenantOverridesTable).where(eq(tenantOverridesTable.organizationId, org.id))
        .orderBy(desc(tenantOverridesTable.createdAt)),
      db.select().from(platformInternalNotesTable)
        .where(eq(platformInternalNotesTable.organizationId, org.id))
        .orderBy(desc(platformInternalNotesTable.createdAt)).limit(50),
      // Counts only — no operational content exposed to platform console
      db.select({ count: count() }).from(tasksTable).where(eq(tasksTable.organizationId, org.id)),
      db.select({ count: count() }).from(approvalsTable).where(eq(approvalsTable.organizationId, org.id)),
      db.select({ count: count() }).from(approvalsTable).where(and(eq(approvalsTable.organizationId, org.id), sql`state = 'pending'`)),
      db.select().from(usagePeriodSummariesTable).where(eq(usagePeriodSummariesTable.organizationId, org.id))
        .orderBy(desc(usagePeriodSummariesTable.periodStart)).limit(13),
    ]);

    const [entitlements, packs, seatInfo] = await Promise.all([
      db.select().from(tenantEntitlementsTable).where(eq(tenantEntitlementsTable.organizationId, org.id)),
      db.select().from(tenantWorkforcePacksTable).where(and(
        eq(tenantWorkforcePacksTable.organizationId, org.id),
        isNull(tenantWorkforcePacksTable.revokedAt),
      )),
      getSeatAllowance(org.id).catch(() => null),
    ]);

    await auditService.log({
      eventType: "platform.organisation_viewed",
      actorId: req.platformUserId ?? null,
      organizationId: org.id,
      metadata: { viewedOrgId: org.id },
    }).catch(() => {});

    res.json({
      organisation: org,
      subscription: sub[0] ?? null,
      members,
      activeOverrides: overrides.filter(o => o.isActive),
      allOverrides: overrides,
      entitlements,
      workforcePacks: packs,
      internalNotes: notes,
      // Sprint 5: operational content restricted — platform console receives counts only.
      // Task bodies and approval details are accessible to authorised org members only.
      tasks: {
        total: taskCountResult[0]?.count ?? 0,
        note: "Task operational content is not accessible from the Platform Console. Authorised org members access tasks via the organisation portal.",
      },
      approvals: {
        total: approvalCountResult[0]?.count ?? 0,
        pending: pendingApprovalCountResult[0]?.count ?? 0,
        note: "Approval content is not accessible from the Platform Console.",
      },
      usageSummary: usageRows,
      seatInfo,
      placeholders: {
        connectors: { status: "not_implemented", message: "Connectors coming in a later sprint." },
        devices:    { status: "not_implemented", message: "Local device access coming in a later sprint." },
      },
    });
  } catch (err) { next(err); }
});

// ─── POST /:id/suspend ────────────────────────────────────────────────────────

router.post("/:id/suspend", ...auth, requirePlatformRole("platform_operations_admin"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }
    await db.update(organizationsTable).set({ status: "suspended", updatedAt: new Date() }).where(eq(organizationsTable.id, org.id));
    await auditService.log({ eventType: "platform.organisation_suspended", actorId: req.platformUserId, organizationId: org.id, metadata: { reason } });
    res.json({ success: true, message: `Organisation '${org.name}' suspended.` });
  } catch (err) { next(err); }
});

// ─── POST /:id/reactivate ─────────────────────────────────────────────────────

router.post("/:id/reactivate", ...auth, requirePlatformRole("platform_operations_admin"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }
    await db.update(organizationsTable).set({ status: "active", updatedAt: new Date() }).where(eq(organizationsTable.id, org.id));
    await auditService.log({ eventType: "platform.organisation_reactivated", actorId: req.platformUserId, organizationId: org.id, metadata: { reason } });
    res.json({ success: true, message: `Organisation '${org.name}' reactivated.` });
  } catch (err) { next(err); }
});

// ─── POST /:id/change-plan ────────────────────────────────────────────────────

router.post("/:id/change-plan", ...auth, requirePlatformRole("platform_billing_admin"), async (req, res, next) => {
  try {
    const { planCode, reason } = req.body as { planCode: string; reason: string };
    if (!planCode || !reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "planCode and reason are required." } }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const [plan] = await db.select().from(plansTable).where(eq(plansTable.code, planCode)).limit(1);
    if (!plan) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Plan '${planCode}' not found.` } }); return; }

    const [version] = await db.select().from(planVersionsTable)
      .where(and(eq(planVersionsTable.planId, plan.id), eq(planVersionsTable.isActive, true))).limit(1);
    if (!version) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `No active version for plan '${planCode}'.` } }); return; }

    const [sub] = await db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, org.id)).limit(1);
    const now = new Date();

    if (sub) {
      await db.update(tenantSubscriptionsTable)
        .set({ planId: plan.id, planVersionId: version.id, updatedAt: now, internalNote: `Plan changed to ${planCode}. Reason: ${reason}` })
        .where(eq(tenantSubscriptionsTable.id, sub.id));
    } else {
      await db.insert(tenantSubscriptionsTable).values({
        id: randomUUID(), organizationId: org.id, planId: plan.id, planVersionId: version.id,
        status: "active", billingCycle: "monthly", currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000), createdAt: now, updatedAt: now,
        internalNote: `Plan set to ${planCode}. Reason: ${reason}`,
      });
    }

    await auditService.log({ eventType: "platform.plan_changed", actorId: req.platformUserId, organizationId: org.id, metadata: { planCode, planId: plan.id, versionId: version.id, reason } });
    res.json({ success: true, plan, version });
  } catch (err) { next(err); }
});

// ─── POST /:id/trial/start ────────────────────────────────────────────────────

router.post("/:id/trial/start", ...auth, requirePlatformRole("platform_billing_admin"), async (req, res, next) => {
  try {
    const { planCode, days, reason } = req.body as { planCode: string; days: number; reason: string };
    if (!planCode || !days || !reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "planCode, days, and reason are required." } }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const [plan] = await db.select().from(plansTable).where(eq(plansTable.code, planCode)).limit(1);
    if (!plan) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Plan '${planCode}' not found.` } }); return; }

    const [version] = await db.select().from(planVersionsTable)
      .where(and(eq(planVersionsTable.planId, plan.id), eq(planVersionsTable.isActive, true))).limit(1);
    if (!version) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "No active version for that plan." } }); return; }

    const now = new Date();
    const trialEnd = new Date(now.getTime() + days * 86_400_000);

    const [sub] = await db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, org.id)).limit(1);
    if (sub) {
      await db.update(tenantSubscriptionsTable)
        .set({ planId: plan.id, planVersionId: version.id, status: "trial", trialStartAt: now, trialEndAt: trialEnd, updatedAt: now })
        .where(eq(tenantSubscriptionsTable.id, sub.id));
    } else {
      await db.insert(tenantSubscriptionsTable).values({
        id: randomUUID(), organizationId: org.id, planId: plan.id, planVersionId: version.id,
        status: "trial", billingCycle: "monthly", trialStartAt: now, trialEndAt: trialEnd,
        currentPeriodStart: now, currentPeriodEnd: trialEnd, createdAt: now, updatedAt: now,
      });
    }

    await auditService.log({ eventType: "platform.trial_started", actorId: req.platformUserId, organizationId: org.id, metadata: { planCode, days, trialEnd: trialEnd.toISOString(), reason } });
    res.json({ success: true, trialEnd });
  } catch (err) { next(err); }
});

// ─── POST /:id/trial/extend ───────────────────────────────────────────────────

router.post("/:id/trial/extend", ...auth, requirePlatformRole("platform_billing_admin"), async (req, res, next) => {
  try {
    const { days, reason } = req.body as { days: number; reason: string };
    if (!days || !reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "days and reason are required." } }); return; }

    const [sub] = await db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, req.params.id!)).limit(1);
    if (!sub) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found." } }); return; }

    const currentEnd = sub.trialEndAt ?? new Date();
    const newEnd = new Date(currentEnd.getTime() + days * 86_400_000);
    await db.update(tenantSubscriptionsTable)
      .set({ trialEndAt: newEnd, updatedAt: new Date(), internalNote: `Trial extended +${days}d. Reason: ${reason}` })
      .where(eq(tenantSubscriptionsTable.id, sub.id));

    await auditService.log({ eventType: "platform.trial_extended", actorId: req.platformUserId, organizationId: req.params.id!, metadata: { days, reason, newEnd: newEnd.toISOString() } });
    res.json({ success: true, newTrialEnd: newEnd });
  } catch (err) { next(err); }
});

// ─── POST /:id/trial/cancel ───────────────────────────────────────────────────

router.post("/:id/trial/cancel", ...auth, requirePlatformRole("platform_billing_admin"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

    const [sub] = await db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, req.params.id!)).limit(1);
    if (!sub) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found." } }); return; }

    await db.update(tenantSubscriptionsTable)
      .set({ status: "trial_expired", updatedAt: new Date(), internalNote: `Trial cancelled. Reason: ${reason}` })
      .where(eq(tenantSubscriptionsTable.id, sub.id));

    await auditService.log({ eventType: "platform.trial_cancelled", actorId: req.platformUserId, organizationId: req.params.id!, metadata: { reason } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Overrides ─────────────────────────────────────────────────────────────────

router.get("/:id/overrides", ...auth, async (req, res, next) => {
  try {
    const overrides = await db.select().from(tenantOverridesTable)
      .where(eq(tenantOverridesTable.organizationId, req.params.id!))
      .orderBy(desc(tenantOverridesTable.createdAt));
    res.json({ overrides });
  } catch (err) { next(err); }
});

router.post("/:id/overrides", ...auth, requirePlatformRole("platform_operations_admin"), async (req, res, next) => {
  try {
    const { overrideType, value, reason, internalNote, customerNote, effectiveTo } = req.body as {
      overrideType: string; value: Record<string, unknown>; reason: string;
      internalNote?: string; customerNote?: string; effectiveTo?: string;
    };
    if (!overrideType || !reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "overrideType and reason are required." } }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const overrideId = randomUUID();
    const [created] = await db.insert(tenantOverridesTable).values({
      id: overrideId, organizationId: org.id,
      overrideType: overrideType as any, value: value ?? {},
      reason, internalNote: internalNote ?? null, customerNote: customerNote ?? null,
      createdBy: req.platformUserId!, effectiveFrom: new Date(),
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null, isActive: true,
    }).returning();

    await auditService.log({ eventType: "platform.override_created", actorId: req.platformUserId, organizationId: org.id, metadata: { overrideId, overrideType, reason } });
    res.status(201).json({ override: created });
  } catch (err) { next(err); }
});

router.delete("/:id/overrides/:oid", ...auth, requirePlatformRole("platform_operations_admin"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason?: string };
    await db.update(tenantOverridesTable)
      .set({ isActive: false, revokedAt: new Date(), revokedBy: req.platformUserId!, revokeReason: reason ?? null, updatedAt: new Date() })
      .where(and(eq(tenantOverridesTable.id, req.params.oid!), eq(tenantOverridesTable.organizationId, req.params.id!)));
    await auditService.log({ eventType: "platform.override_revoked", actorId: req.platformUserId, organizationId: req.params.id!, metadata: { overrideId: req.params.oid, reason } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Internal Notes ────────────────────────────────────────────────────────────

router.get("/:id/internal-notes", ...auth, async (req, res, next) => {
  try {
    const notes = await db.select().from(platformInternalNotesTable)
      .where(eq(platformInternalNotesTable.organizationId, req.params.id!))
      .orderBy(desc(platformInternalNotesTable.createdAt));
    res.json({ notes });
  } catch (err) { next(err); }
});

router.post("/:id/internal-notes", ...auth, requirePlatformRole("platform_support_admin"), async (req, res, next) => {
  try {
    const { content, isFlagged, priority, category } = req.body as {
      content: string; isFlagged?: boolean; priority?: string; category?: string;
    };
    if (!content) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "content is required." } }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const [note] = await db.insert(platformInternalNotesTable).values({
      id: randomUUID(), organizationId: org.id, content,
      authorId: req.platformUserId!,
      isInternal: true, isFlagged: isFlagged ?? false,
      priority: (priority as any) ?? "medium",
      category: (category as any) ?? "general",
    }).returning();

    await auditService.log({ eventType: "platform.internal_note_added", actorId: req.platformUserId, organizationId: org.id, metadata: { noteId: note!.id, isFlagged, priority, category } });
    if (isFlagged) {
      await auditService.log({ eventType: "platform.security_review_flagged", actorId: req.platformUserId, organizationId: org.id, metadata: { noteId: note!.id } });
    }
    res.status(201).json({ note });
  } catch (err) { next(err); }
});

// ─── Flag security review ──────────────────────────────────────────────────────

router.post("/:id/flag-security", ...auth, requirePlatformRole("platform_security_auditor"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }
    await auditService.log({ eventType: "platform.security_review_flagged", actorId: req.platformUserId, organizationId: req.params.id!, metadata: { reason } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Mark high-priority support ────────────────────────────────────────────────

router.post("/:id/mark-high-priority", ...auth, requirePlatformRole("platform_support_admin"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }
    await auditService.log({ eventType: "platform.high_priority_flagged", actorId: req.platformUserId, organizationId: req.params.id!, metadata: { reason } });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── Usage / Entitlements / Audit / Tasks / Approvals ─────────────────────────

router.get("/:id/usage", ...auth, async (req, res, next) => {
  try {
    const allowances = await Promise.all(
      USAGE_DIMENSION_CODES.map(dim => getUsageAllowance(req.params.id!, dim as UsageDimensionCode)),
    );
    res.json({ dimensions: allowances });
  } catch (err) { next(err); }
});

router.get("/:id/entitlements", ...auth, async (req, res, next) => {
  try {
    const [sub, entitlements, packs] = await Promise.all([
      db.select().from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.organizationId, req.params.id!)).limit(1),
      db.select().from(tenantEntitlementsTable).where(eq(tenantEntitlementsTable.organizationId, req.params.id!)),
      db.select().from(tenantWorkforcePacksTable).where(and(
        eq(tenantWorkforcePacksTable.organizationId, req.params.id!),
        isNull(tenantWorkforcePacksTable.revokedAt),
      )),
    ]);
    res.json({ subscription: sub[0] ?? null, entitlements, workforcePacks: packs });
  } catch (err) { next(err); }
});

router.get("/:id/audit", ...auth, async (req, res, next) => {
  try {
    const limit = Math.min(200, Number(req.query.limit) || 50);
    const events = await db.select().from(auditLogTable)
      .where(eq(auditLogTable.organizationId, req.params.id!))
      .orderBy(desc(auditLogTable.createdAt)).limit(limit);
    res.json({ events, count: events.length });
  } catch (err) { next(err); }
});

/**
 * Sprint 5: Task and approval operational content is NOT accessible from the
 * Platform Console. Only aggregate counts are exposed via the org detail endpoint.
 * Returning aggregate counts + a clear restriction notice.
 */
router.get("/:id/tasks", ...auth, async (req, res, next) => {
  try {
    const [totalResult] = await db.select({ count: count() }).from(tasksTable)
      .where(eq(tasksTable.organizationId, req.params.id!));
    res.json({
      restricted: true,
      total: totalResult?.count ?? 0,
      message: "Task operational content is not accessible from the Platform Console. Authorised org members access tasks via the organisation portal.",
      accessPath: `/app/${req.params.id}/tasks`,
    });
  } catch (err) { next(err); }
});

router.get("/:id/approvals", ...auth, async (req, res, next) => {
  try {
    const [totalResult] = await db.select({ count: count() }).from(approvalsTable)
      .where(eq(approvalsTable.organizationId, req.params.id!));
    const [pendingResult] = await db.select({ count: count() }).from(approvalsTable)
      .where(and(eq(approvalsTable.organizationId, req.params.id!), sql`state = 'pending'`));
    res.json({
      restricted: true,
      total: totalResult?.count ?? 0,
      pending: pendingResult?.count ?? 0,
      message: "Approval content is not accessible from the Platform Console. Authorised org members access approvals via the organisation portal.",
    });
  } catch (err) { next(err); }
});

router.get("/:id/members", ...auth, async (req, res, next) => {
  try {
    const members = await db.select({ membership: membershipsTable, user: usersTable })
      .from(membershipsTable).leftJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
      .where(eq(membershipsTable.organizationId, req.params.id!));
    res.json({ members, count: members.length });
  } catch (err) { next(err); }
});

// ─── PATCH /:id — Edit org metadata (Sprint 9.7) ──────────────────────────────

router.patch("/:id", ...auth, requirePlatformRole("platform_admin"), async (req, res, next) => {
  try {
    const { name, legalName, tradingName, displayName, supportStatus, internalNote } = req.body as {
      name?: string;
      legalName?: string;
      tradingName?: string;
      displayName?: string;
      supportStatus?: string;
      internalNote?: string;
    };

    const [org] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (legalName !== undefined) updateFields.legalName = legalName;
    if (tradingName !== undefined) updateFields.tradingName = tradingName;
    if (displayName !== undefined) updateFields.displayName = displayName;
    if (supportStatus !== undefined) updateFields.supportStatus = supportStatus;

    const [updatedOrg] = await db.update(organizationsTable)
      .set(updateFields)
      .where(eq(organizationsTable.id, org.id))
      .returning();

    // Add internal note if provided
    if (internalNote) {
      await db.insert(platformInternalNotesTable).values({
        id: randomUUID(),
        organizationId: org.id,
        content: internalNote,
        authorId: req.platformUserId!,
        isInternal: true,
        isFlagged: false,
        priority: "medium",
        category: "general",
      });
    }

    await auditService.log({
      eventType: "platform.organisation_updated",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { fields: Object.keys(updateFields).filter(k => k !== "updatedAt"), internalNote: !!internalNote },
    });

    res.json({ success: true, organisation: updatedOrg });
  } catch (err) { next(err); }
});

// ─── POST /:id/close — Close an organisation (Sprint 9.7) ────────────────────

router.post("/:id/close", ...auth, requirePlatformRole("platform_super_admin"), async (req, res, next) => {
  try {
    const { reason, note } = req.body as { reason: string; note?: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

    const [org] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }
    if (org.status === "closed") { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Organisation is already closed." } }); return; }

    const now = new Date();
    await db.update(organizationsTable).set({
      status: "closed",
      closedAt: now,
      closedBy: req.platformUserId!,
      closureReason: reason,
      statusChangedAt: now,
      statusChangedBy: req.platformUserId!,
      loginDisabled: true,
      executionFrozen: true,
      updatedAt: now,
    }).where(eq(organizationsTable.id, org.id));

    // Add internal note if provided
    if (note) {
      await db.insert(platformInternalNotesTable).values({
        id: randomUUID(),
        organizationId: org.id,
        content: note,
        authorId: req.platformUserId!,
        isInternal: true,
        isFlagged: false,
        priority: "critical",
        category: "general",
      });
    }

    await auditService.log({
      eventType: "platform.organisation_closed",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { reason, note: note ?? null },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /:id/freeze-execution — Freeze AI execution (Sprint 9.7) ────────────

router.post("/:id/freeze-execution", ...auth,
  (req, res, next) => {
    const role = req.platformRole;
    if (role === "platform_super_admin" || role === "platform_operations" || role === "platform_security") {
      return next();
    }
    return res.status(403).json({ error: { code: "PERMISSION_DENIED", message: "This action requires the 'platform_operations' or 'platform_security' platform role." } });
  },
  async (req, res, next) => {
    try {
      const { reason } = req.body as { reason: string };
      if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

      const [org] = await db.select().from(organizationsTable)
        .where(eq(organizationsTable.id, req.params.id!)).limit(1);
      if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

      await db.update(organizationsTable).set({
        executionFrozen: true,
        updatedAt: new Date(),
      }).where(eq(organizationsTable.id, org.id));

      // Store reason as internal note
      await db.insert(platformInternalNotesTable).values({
        id: randomUUID(),
        organizationId: org.id,
        content: `Execution frozen. Reason: ${reason}`,
        authorId: req.platformUserId!,
        isInternal: true,
        isFlagged: true,
        priority: "high",
        category: "technical",
      });

      await auditService.log({
        eventType: "platform.execution_frozen",
        actorId: req.platformUserId,
        organizationId: org.id,
        metadata: { reason },
      });

      res.json({ success: true, message: `Execution frozen for ${org.name}` });
    } catch (err) { next(err); }
  }
);

// ─── POST /:id/unfreeze-execution — Unfreeze AI execution (Sprint 9.7) ────────

router.post("/:id/unfreeze-execution", ...auth, requirePlatformRole("platform_operations"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason?: string };

    const [org] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }
    if (org.status === "closed" || org.status === "suspended") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: `Cannot unfreeze execution for a ${org.status} organisation.` } }); return;
    }

    await db.update(organizationsTable).set({
      executionFrozen: false,
      updatedAt: new Date(),
    }).where(eq(organizationsTable.id, org.id));

    await auditService.log({
      eventType: "platform.execution_unfrozen",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { reason: reason ?? null },
    });

    res.json({ success: true, message: `Execution unfrozen for ${org.name}` });
  } catch (err) { next(err); }
});

// ─── POST /:id/disable-logins — Disable new logins (Sprint 9.7) ──────────────

router.post("/:id/disable-logins", ...auth, requirePlatformRole("platform_security"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

    const [org] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    await db.update(organizationsTable).set({
      loginDisabled: true,
      updatedAt: new Date(),
    }).where(eq(organizationsTable.id, org.id));

    await auditService.log({
      eventType: "platform.logins_disabled",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { reason },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /:id/enable-logins — Re-enable logins (Sprint 9.7) ─────────────────

router.post("/:id/enable-logins", ...auth, requirePlatformRole("platform_security"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason?: string };

    const [org] = await db.select().from(organizationsTable)
      .where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }
    if (org.status === "closed") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Cannot enable logins for a closed organisation." } }); return;
    }

    await db.update(organizationsTable).set({
      loginDisabled: false,
      updatedAt: new Date(),
    }).where(eq(organizationsTable.id, org.id));

    await auditService.log({
      eventType: "platform.logins_enabled",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { reason: reason ?? null },
    });

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 9.7 — Subscription Management Routes
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /:id/subscription — Create or replace subscription ──────────────────

router.post("/:id/subscription", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { planId, planVersionId, status, trialDays, note, billingSource } = req.body as {
      planId: string;
      planVersionId: string;
      status?: string;
      trialDays?: number;
      note?: string;
      billingSource?: string;
    };
    if (!planId || !planVersionId) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "planId and planVersionId are required." } });
      return;
    }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const now = new Date();
    const resolvedStatus = (status ?? "active") as any;

    let trialStartAt: Date | null = null;
    let trialEndAt: Date | null = null;
    if (resolvedStatus === "trial" && trialDays) {
      trialStartAt = now;
      trialEndAt = new Date(now.getTime() + trialDays * 86_400_000);
    }

    const [existingSub] = await db.select().from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.organizationId, org.id)).limit(1);

    let subscription: typeof tenantSubscriptionsTable.$inferSelect;

    if (existingSub) {
      const [updated] = await db.update(tenantSubscriptionsTable)
        .set({
          planId,
          planVersionId,
          status: resolvedStatus,
          ...(trialStartAt ? { trialStartAt } : {}),
          ...(trialEndAt ? { trialEndAt } : {}),
          ...(note ? { internalNote: note } : {}),
          changedBy: req.platformUserId!,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptionsTable.id, existingSub.id))
        .returning();
      subscription = updated!;
    } else {
      const [created] = await db.insert(tenantSubscriptionsTable).values({
        id: randomUUID(),
        organizationId: org.id,
        planId,
        planVersionId,
        status: resolvedStatus,
        currentPeriodStart: now,
        currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        ...(trialStartAt ? { trialStartAt } : {}),
        ...(trialEndAt ? { trialEndAt } : {}),
        ...(note ? { internalNote: note } : {}),
        changedBy: req.platformUserId!,
        createdAt: now,
        updatedAt: now,
      }).returning();
      subscription = created!;
    }

    await auditService.log({
      eventType: "platform.subscription_created",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { planId, planVersionId, status: resolvedStatus, trialDays, billingSource, note },
    }).catch(() => {});

    res.json({ success: true, subscription });
  } catch (err) { next(err); }
});

// ─── PATCH /:id/subscription — Update subscription status/plan ────────────────

router.patch("/:id/subscription", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { planId, planVersionId, status, note } = req.body as {
      planId?: string;
      planVersionId?: string;
      status?: string;
      note?: string;
    };

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const [existingSub] = await db.select().from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.organizationId, org.id)).limit(1);
    if (!existingSub) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found." } });
      return;
    }

    const now = new Date();
    const updates: Record<string, unknown> = { updatedAt: now, changedBy: req.platformUserId! };
    if (planId !== undefined) updates.planId = planId;
    if (planVersionId !== undefined) updates.planVersionId = planVersionId;
    if (status !== undefined) updates.status = status;
    if (note !== undefined) updates.internalNote = note;

    const [subscription] = await db.update(tenantSubscriptionsTable)
      .set(updates as any)
      .where(eq(tenantSubscriptionsTable.id, existingSub.id))
      .returning();

    await auditService.log({
      eventType: "platform.subscription_changed",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { planId, planVersionId, status, note },
    }).catch(() => {});

    res.json({ success: true, subscription });
  } catch (err) { next(err); }
});

// ─── POST /:id/subscription/pause — Pause subscription ───────────────────────

router.post("/:id/subscription/pause", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const now = new Date();
    await db.update(tenantSubscriptionsTable)
      .set({ status: "suspended", suspendedAt: now, changedBy: req.platformUserId!, updatedAt: now })
      .where(eq(tenantSubscriptionsTable.organizationId, org.id));

    await auditService.log({
      eventType: "platform.subscription_paused",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { action: "paused", reason },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /:id/subscription/resume — Resume subscription ─────────────────────

router.post("/:id/subscription/resume", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const now = new Date();
    await db.update(tenantSubscriptionsTable)
      .set({ status: "active", suspendedAt: null, changedBy: req.platformUserId!, updatedAt: now })
      .where(eq(tenantSubscriptionsTable.organizationId, org.id));

    await auditService.log({
      eventType: "platform.subscription_resumed",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { action: "resumed", reason },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /:id/subscription/cancel — Cancel subscription ─────────────────────

router.post("/:id/subscription/cancel", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { reason, immediate } = req.body as { reason: string; immediate?: boolean };
    if (!reason) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } }); return; }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const now = new Date();
    await db.update(tenantSubscriptionsTable)
      .set({ status: "cancelled", cancelledAt: now, changedBy: req.platformUserId!, updatedAt: now })
      .where(eq(tenantSubscriptionsTable.organizationId, org.id));

    await auditService.log({
      eventType: "platform.subscription_cancelled",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { action: "cancelled", reason, immediate: immediate ?? false },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 9.7 — Seat Override Routes
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /:id/seats — Get seat info and active override ───────────────────────

router.get("/:id/seats", ...auth, async (req, res, next) => {
  try {
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const now = new Date();

    const [seatAllowance, history] = await Promise.all([
      getSeatAllowance(org.id).catch(() => null),
      db.select().from(seatOverridesTable)
        .where(eq(seatOverridesTable.organizationId, org.id))
        .orderBy(desc(seatOverridesTable.createdAt))
        .limit(10),
    ]);

    const activeOverride = history.find(o =>
      !o.revoked &&
      o.effectiveFrom <= now &&
      (o.effectiveTo === null || o.effectiveTo >= now),
    ) ?? null;

    res.json({ seatAllowance, activeOverride, history });
  } catch (err) { next(err); }
});

// ─── POST /:id/seats/override — Create seat override ─────────────────────────

router.post("/:id/seats/override", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { seatAllowance, reason, effectiveTo } = req.body as {
      seatAllowance: number | null;
      reason: string;
      effectiveTo?: string;
    };
    if (reason === undefined || reason === null || reason === "") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } });
      return;
    }

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const now = new Date();
    const overrideId = randomUUID();

    const [override] = await db.insert(seatOverridesTable).values({
      id: overrideId,
      organizationId: org.id,
      seatAllowance: seatAllowance ?? null,
      overrideReason: reason,
      setBy: req.platformUserId!,
      effectiveFrom: now,
      effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
      revoked: false,
      createdAt: now,
    }).returning();

    await auditService.log({
      eventType: "platform.seat_override_created",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { overrideId, seatAllowance, reason },
    }).catch(() => {});

    res.status(201).json({ success: true, override });
  } catch (err) { next(err); }
});

// ─── DELETE /:id/seats/override/:oid — Revoke a seat override ────────────────

router.delete("/:id/seats/override/:oid", ...auth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, req.params.id!)).limit(1);
    if (!org) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Organisation not found." } }); return; }

    const now = new Date();
    await db.update(seatOverridesTable)
      .set({ revoked: true, revokedAt: now, revokedBy: req.platformUserId! })
      .where(and(
        eq(seatOverridesTable.id, req.params.oid!),
        eq(seatOverridesTable.organizationId, org.id),
      ));

    await auditService.log({
      eventType: "platform.seat_override_revoked",
      actorId: req.platformUserId,
      organizationId: org.id,
      metadata: { overrideId: req.params.oid },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
