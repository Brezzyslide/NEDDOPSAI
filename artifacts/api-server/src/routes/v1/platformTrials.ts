/**
 * Platform Trials routes — /v1/platform/trials
 * Sprint 4: View and manage all trials across the platform.
 *
 * GET  /           — all trials (current, expired, upcoming expiry)
 * GET  /expiring   — trials expiring within N days
 * GET  /expired    — expired trials
 */

import {
  Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth,
  requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  tenantSubscriptionsTable,
  organizationsTable,
  plansTable,
} from "@workspace/db";
import { eq, and, lte, gte, desc, or } from "drizzle-orm";
import { auditService } from "../../services/auditService.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

router.get("/", ...auth, async (req, res, next) => {
  try {
    const status = req.query.status as string | undefined; // trial | trial_expired | all
    const daysFilter = Number(req.query.days) || null;

    let q = platformDb.select({ sub: tenantSubscriptionsTable, org: organizationsTable, plan: plansTable })
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

    const rows = await platformDb.select({ sub: tenantSubscriptionsTable, org: organizationsTable, plan: plansTable })
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

// ─── POST /:id/extend — Extend a trial ───────────────────────────────────────

router.post("/:id/extend", requireAuth, requirePlatformAuth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { additionalDays, reason, note } = req.body as { additionalDays: number; reason: string; note?: string };
    if (!additionalDays || !reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "additionalDays and reason are required." } });
      return;
    }

    const [sub] = await platformDb.select().from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.id, req.params.id!)).limit(1);
    if (!sub) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found." } });
      return;
    }
    if (sub.status !== "trial") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subscription is not in trial status." } });
      return;
    }
    if (!sub.trialEndAt) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subscription has no trialEndAt set." } });
      return;
    }

    const newTrialEndsAt = new Date(sub.trialEndAt.getTime() + additionalDays * 86_400_000);
    const now = new Date();

    await platformDb.update(tenantSubscriptionsTable)
      .set({
        trialEndAt: newTrialEndsAt,
        changedBy: req.platformUserId!,
        updatedAt: now,
        ...(note ? { internalNote: note } : {}),
      })
      .where(eq(tenantSubscriptionsTable.id, sub.id));

    await auditService.log({
      eventType: "platform.trial_extended",
      actorId: req.platformUserId,
      organizationId: sub.organizationId,
      metadata: { subscriptionId: sub.id, additionalDays, reason, note, newTrialEndsAt: newTrialEndsAt.toISOString() },
    }).catch(() => {});

    res.json({ success: true, newTrialEndsAt });
  } catch (err) { next(err); }
});

// ─── POST /:id/cancel — Cancel a trial ───────────────────────────────────────

router.post("/:id/cancel", requireAuth, requirePlatformAuth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const { reason } = req.body as { reason: string };
    if (!reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "reason is required." } });
      return;
    }

    const [sub] = await platformDb.select().from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.id, req.params.id!)).limit(1);
    if (!sub) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found." } });
      return;
    }
    if (sub.status !== "trial") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subscription is not in trial status." } });
      return;
    }

    const now = new Date();

    await platformDb.update(tenantSubscriptionsTable)
      .set({ status: "trial_expired", trialEndAt: now, changedBy: req.platformUserId!, updatedAt: now })
      .where(eq(tenantSubscriptionsTable.id, sub.id));

    // Update org status to "restricted" if org was in "trial"
    const [org] = await platformDb.select().from(organizationsTable)
      .where(eq(organizationsTable.id, sub.organizationId)).limit(1);
    if (org && org.status === "trial") {
      await platformDb.update(organizationsTable)
        .set({ status: "restricted" as any, updatedAt: now })
        .where(eq(organizationsTable.id, org.id));
    }

    await auditService.log({
      eventType: "platform.trial_cancelled",
      actorId: req.platformUserId,
      organizationId: sub.organizationId,
      metadata: { subscriptionId: sub.id, reason },
    }).catch(() => {});

    res.json({ success: true });
  } catch (err) { next(err); }
});

// ─── POST /:id/convert — Convert trial to active subscription ─────────────────

router.post("/:id/convert", requireAuth, requirePlatformAuth, requirePlatformRole("platform_commercial"), async (req, res, next) => {
  try {
    const {
      planId,
      planVersionId,
      source,
      activationDate,
      renewalDate,
      note,
      reason,
    } = req.body as {
      planId?: string;
      planVersionId?: string;
      source: "manual" | "invoice" | "bank_transfer" | "enterprise_contract" | "pilot" | "future_stripe" | "reseller";
      activationDate?: string;
      renewalDate?: string;
      note?: string;
      reason: string;
    };

    if (!source || !reason) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "source and reason are required." } });
      return;
    }

    const [sub] = await platformDb.select().from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.id, req.params.id!)).limit(1);
    if (!sub) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Subscription not found." } });
      return;
    }
    if (sub.status !== "trial") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Subscription is not in trial status." } });
      return;
    }

    const now = new Date();
    const activation = activationDate ? new Date(activationDate) : now;
    const renewal = renewalDate ? new Date(renewalDate) : null;

    const updatePayload: Record<string, unknown> = {
      status: "active",
      currentPeriodStart: activation,
      trialEndAt: activation,
      changedBy: req.platformUserId!,
      updatedAt: now,
      ...(renewal ? { currentPeriodEnd: renewal } : {}),
      ...(note ? { internalNote: note } : {}),
      ...(planId ? { planId } : {}),
      ...(planVersionId ? { planVersionId } : {}),
    };

    const [updatedSub] = await platformDb.update(tenantSubscriptionsTable)
      .set(updatePayload as any)
      .where(eq(tenantSubscriptionsTable.id, sub.id))
      .returning();

    // Update org status to "active"
    await platformDb.update(organizationsTable)
      .set({ status: "active", updatedAt: now } as any)
      .where(eq(organizationsTable.id, sub.organizationId));

    await auditService.log({
      eventType: "platform.subscription_changed",
      actorId: req.platformUserId,
      organizationId: sub.organizationId,
      metadata: { subscriptionId: sub.id, source, from: "trial", to: "active", reason, note, planId, planVersionId },
    }).catch(() => {});

    res.json({ success: true, subscription: updatedSub });
  } catch (err) { next(err); }
});

export default router;
