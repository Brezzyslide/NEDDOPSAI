/**
 * Organisation subscription, entitlements, workforce, usage, and seat routes.
 *
 * All routes are tenant-scoped: requireAuth + resolveTenantFromSlug.
 * Spec routes:
 *   GET  /v1/organisations/:slug/subscription
 *   GET  /v1/organisations/:slug/entitlements
 *   GET  /v1/organisations/:slug/workforce
 *   GET  /v1/organisations/:slug/usage
 *   GET  /v1/organisations/:slug/seats
 *   POST /v1/organisations/:slug/entitlements/check
 *   POST /v1/organisations/:slug/usage/check
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { db, tenantSubscriptionsTable, plansTable, planVersionsTable, planFeaturesTable, planWorkforcePacksTable, tenantEntitlementsTable, tenantWorkforcePacksTable } from "@workspace/db";
import { eq, and, isNull, gt } from "drizzle-orm";
import {
  tenantCanUseFeature,
  tenantHasWorkforcePack,
  tenantCanUseExecutionChannel,
  tenantCanUseConnector,
  getUsageAllowance,
  checkUsage,
  getUsageWarnings,
  getSeatAllowance,
} from "../../services/entitlementService.js";
import { USAGE_DIMENSION_CODES, type FeatureCode, type UsageDimensionCode, type WorkforcePackCode } from "@workspace/shared";
import { SPECIALISTS, WORKFORCE_PACKS, getSpecialistCapabilities } from "../../lib/workforceRegistry.js";

const router = Router({ mergeParams: true });

// ─── GET /subscription ────────────────────────────────────────────────────────

router.get("/subscription", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const orgId = req.tenantContext!.tenantId;
    const now = new Date();

    const [sub] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.organizationId, orgId))
      .limit(1);

    if (!sub) {
      res.json({ subscription: null, message: "No subscription found. Contact support to activate." });
      return;
    }

    const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, sub.planId)).limit(1);
    const [version] = await db.select().from(planVersionsTable).where(eq(planVersionsTable.id, sub.planVersionId)).limit(1);

    const isTrialExpired = sub.status === "trial" && sub.trialEndAt && sub.trialEndAt < now;
    const daysUntilTrialEnd = sub.trialEndAt
      ? Math.ceil((sub.trialEndAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    res.json({
      subscription: {
        ...sub,
        plan: plan ?? null,
        planVersion: version ?? null,
        isTrialExpired: !!isTrialExpired,
        daysUntilTrialEnd: sub.status === "trial" ? daysUntilTrialEnd : null,
      },
    });
  } catch (err) { next(err); }
});

// ─── GET /entitlements ────────────────────────────────────────────────────────

router.get("/entitlements", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const orgId = req.tenantContext!.tenantId;
    const now = new Date();

    const [sub] = await db
      .select()
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.organizationId, orgId))
      .limit(1);

    if (!sub) {
      res.json({ entitlements: [], subscription: null });
      return;
    }

    const [planFeatures, planPacks, overrides] = await Promise.all([
      db.select().from(planFeaturesTable).where(eq(planFeaturesTable.planVersionId, sub.planVersionId)),
      db.select().from(planWorkforcePacksTable).where(eq(planWorkforcePacksTable.planVersionId, sub.planVersionId)),
      db.select().from(tenantEntitlementsTable).where(
        and(
          eq(tenantEntitlementsTable.organizationId, orgId),
          eq(tenantEntitlementsTable.isCustomerVisible, true),
          gt(tenantEntitlementsTable.expiresAt, now),
        ),
      ),
    ]);

    const activePacks = await db
      .select()
      .from(tenantWorkforcePacksTable)
      .where(
        and(
          eq(tenantWorkforcePacksTable.organizationId, orgId),
          isNull(tenantWorkforcePacksTable.revokedAt),
        ),
      );

    res.json({
      subscriptionStatus: sub.status,
      planCode: null, // resolved by plan
      planFeatures: planFeatures.map(f => f.featureCode),
      planWorkforcePacks: planPacks.filter(p => p.isIncluded).map(p => p.packCode),
      activeWorkforcePacks: activePacks.map(p => ({ code: p.packCode, source: p.source, expiresAt: p.expiresAt })),
      overrides: overrides.map(o => ({
        featureCode: o.featureCode,
        state: o.state,
        source: o.source,
        reason: o.reason,
        expiresAt: o.expiresAt,
      })),
    });
  } catch (err) { next(err); }
});

// ─── POST /entitlements/check ─────────────────────────────────────────────────

router.post("/entitlements/check", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const orgId = req.tenantContext!.tenantId;
    const { featureCode } = req.body as { featureCode: FeatureCode };

    if (!featureCode) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "featureCode is required." } });
      return;
    }

    const result = await tenantCanUseFeature(orgId, featureCode);
    res.json({ featureCode, ...result });
  } catch (err) { next(err); }
});

// ─── GET /workforce ───────────────────────────────────────────────────────────

router.get("/workforce", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const orgId = req.tenantContext!.tenantId;

    const activePacks = await db
      .select()
      .from(tenantWorkforcePacksTable)
      .where(
        and(
          eq(tenantWorkforcePacksTable.organizationId, orgId),
          isNull(tenantWorkforcePacksTable.revokedAt),
        ),
      );

    const activePackCodes = new Set(activePacks.map(p => p.packCode));

    const packs = await Promise.all(
      WORKFORCE_PACKS.map(async pack => {
        const isIncluded = activePackCodes.has(pack.code);
        const specialists = SPECIALISTS
          .filter(s => s.packCode === pack.code)
          .map(s => ({
            ...s,
            resolvedCapabilities: getSpecialistCapabilities(s.code),
            isAccessible: isIncluded && s.executionStatus !== "deprecated",
          }));
        return { ...pack, isIncluded, specialists };
      }),
    );

    res.json({ packs, activePackCodes: [...activePackCodes] });
  } catch (err) { next(err); }
});

// ─── GET /usage ───────────────────────────────────────────────────────────────

router.get("/usage", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const orgId = req.tenantContext!.tenantId;

    const allowances = await Promise.all(
      USAGE_DIMENSION_CODES.map(dim =>
        getUsageAllowance(orgId, dim as UsageDimensionCode),
      ),
    );

    const warnings = allowances.filter(a => a.warningLevel !== null);
    const seats = await getSeatAllowance(orgId);

    res.json({
      dimensions: allowances,
      warnings,
      seats,
      hasWarnings: warnings.length > 0,
      hasHardLimitReached: warnings.some(w => w.warningLevel === "at_limit"),
    });
  } catch (err) { next(err); }
});

// ─── POST /usage/check ────────────────────────────────────────────────────────

router.post("/usage/check", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const orgId = req.tenantContext!.tenantId;
    const { dimensionCode, quantity = 1 } = req.body as { dimensionCode: UsageDimensionCode; quantity?: number };

    if (!dimensionCode) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "dimensionCode is required." } });
      return;
    }

    const result = await checkUsage(orgId, dimensionCode, quantity);
    res.json(result);
  } catch (err) { next(err); }
});

// ─── GET /seats ───────────────────────────────────────────────────────────────

router.get("/seats", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const orgId = req.tenantContext!.tenantId;
    const info = await getSeatAllowance(orgId);
    res.json(info);
  } catch (err) { next(err); }
});

export default router;
