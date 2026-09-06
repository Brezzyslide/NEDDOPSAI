/**
 * Platform Commercial routes — mounted at /v1/platform/commercial
 * Sprint 4: Plan designer, plan versions, features, workforce packs,
 *           usage dimensions, execution capabilities, connector eligibility, overrides.
 *
 * GET    /plans                    — all plans with versions
 * POST   /plans                    — create plan
 * PATCH  /plans/:id                — update plan (creates new version if config changed)
 * GET    /plans/:id/versions       — list all versions
 * POST   /plans/:id/versions       — create new version (clone from active)
 * PATCH  /plans/:id/versions/:vid  — update version metadata (non-config fields only)
 * POST   /plans/:id/versions/:vid/activate — activate a version
 * POST   /plans/:id/versions/:vid/archive  — archive a version
 * GET    /features                 — all feature codes
 * GET    /usage-dimensions         — all usage dimensions
 * GET    /overrides                — all active platform overrides (cross-org)
 */

import {
  Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth,
  requirePlatformRole } from "../../middlewares/requirePlatformRole.js";
import {
  plansTable,
  planVersionsTable,
  planFeaturesTable,
  planWorkforcePacksTable,
  planUsageAllowancesTable,
  featuresTable,
  usageDimensionsTable,
  tenantSubscriptionsTable,
  tenantOverridesTable,
} from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { auditService } from "../../services/auditService.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];
const billingAuth = [...auth, requirePlatformRole("platform_billing_admin")];

// ─── Plans ────────────────────────────────────────────────────────────────────

router.get("/plans", ...auth, async (_req, res, next) => {
  try {
    const plans = await platformDb.select().from(plansTable).orderBy(plansTable.displayOrder);
    const versions = await platformDb.select().from(planVersionsTable);
    const subs = await platformDb.select({ n: count(), planId: tenantSubscriptionsTable.planId })
      .from(tenantSubscriptionsTable).groupBy(tenantSubscriptionsTable.planId);
    const subMap = Object.fromEntries(subs.map(s => [s.planId, Number(s.n)]));

    const versionMap: Record<string, typeof versions> = {};
    for (const v of versions) {
      if (!versionMap[v.planId]) versionMap[v.planId] = [];
      versionMap[v.planId]!.push(v);
    }

    res.json({
      plans: plans.map(p => ({
        ...p,
        versions: versionMap[p.id] ?? [],
        activeVersion: (versionMap[p.id] ?? []).find(v => v.isActive) ?? null,
        subscriberCount: subMap[p.id] ?? 0,
      })),
    });
  } catch (err) { next(err); }
});

router.post("/plans", ...billingAuth, async (req, res, next) => {
  try {
    const {
      code, name, description, displayOrder, trialLengthDays, monthlyPriceCents,
      annualPriceCents, currency, notes, isPublic,
    } = req.body as Record<string, any>;

    if (!code || !name) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "code and name are required." } }); return; }

    const planId = `plan_${code}`;
    const [plan] = await platformDb.insert(plansTable).values({
      id: planId, code, name,
      description: description ?? null,
      displayOrder: String(displayOrder ?? "99"),
      isPublic: isPublic ?? true, isActive: true,
      trialLengthDays: trialLengthDays ?? 14,
      monthlyPriceCents: monthlyPriceCents ?? null,
      annualPriceCents: annualPriceCents ?? null,
      currency: currency ?? "AUD",
      notes: notes ?? null,
    }).returning();

    await auditService.log({ eventType: "platform.plan_created", actorId: req.platformUserId, metadata: { planId, code, name } });
    res.status(201).json({ plan });
  } catch (err) { next(err); }
});

router.patch("/plans/:id", ...billingAuth, async (req, res, next) => {
  try {
    const { name, description, isPublic, isActive, displayOrder, trialLengthDays, monthlyPriceCents, annualPriceCents, currency, notes } = req.body as Record<string, any>;
    const [plan] = await platformDb.update(plansTable)
      .set({
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(isPublic !== undefined && { isPublic }),
        ...(isActive !== undefined && { isActive }),
        ...(displayOrder !== undefined && { displayOrder: String(displayOrder) }),
        ...(trialLengthDays !== undefined && { trialLengthDays }),
        ...(monthlyPriceCents !== undefined && { monthlyPriceCents }),
        ...(annualPriceCents !== undefined && { annualPriceCents }),
        ...(currency !== undefined && { currency }),
        ...(notes !== undefined && { notes }),
        updatedAt: new Date(),
      })
      .where(eq(plansTable.id, req.params.id!))
      .returning();
    await auditService.log({ eventType: "platform.plan_updated", actorId: req.platformUserId, metadata: { planId: req.params.id, changes: req.body } });
    res.json({ plan });
  } catch (err) { next(err); }
});

// ─── Plan Versions ────────────────────────────────────────────────────────────

router.get("/plans/:id/versions", ...auth, async (req, res, next) => {
  try {
    const versions = await platformDb.select().from(planVersionsTable)
      .where(eq(planVersionsTable.planId, req.params.id!))
      .orderBy(desc(planVersionsTable.versionNumber));

    const enriched = await Promise.all(versions.map(async v => {
      const [features, packs, allowances, [subCount]] = await Promise.all([
        platformDb.select().from(planFeaturesTable).where(eq(planFeaturesTable.planVersionId, v.id)),
        platformDb.select().from(planWorkforcePacksTable).where(eq(planWorkforcePacksTable.planVersionId, v.id)),
        platformDb.select().from(planUsageAllowancesTable).where(eq(planUsageAllowancesTable.planVersionId, v.id)),
        platformDb.select({ n: count() }).from(tenantSubscriptionsTable).where(eq(tenantSubscriptionsTable.planVersionId, v.id)),
      ]);
      return { ...v, features, workforcePacks: packs, usageAllowances: allowances, subscriberCount: Number(subCount?.n ?? 0) };
    }));

    res.json({ versions: enriched });
  } catch (err) { next(err); }
});

router.post("/plans/:id/versions", ...billingAuth, async (req, res, next) => {
  try {
    const { label, notes, includedSeats, maxSeats } = req.body as Record<string, any>;

    // Clone from active version
    const [active] = await platformDb.select().from(planVersionsTable)
      .where(and(eq(planVersionsTable.planId, req.params.id!), eq(planVersionsTable.isActive, true))).limit(1);

    const allVersions = await platformDb.select().from(planVersionsTable).where(eq(planVersionsTable.planId, req.params.id!));
    const maxNum = allVersions.reduce((m, v) => Math.max(m, v.versionNumber), 0);
    const newNum = maxNum + 1;
    const newId = `planv_${req.params.id!.replace("plan_", "")}_v${newNum}`;

    const [newVersion] = await platformDb.insert(planVersionsTable).values({
      id: newId, planId: req.params.id!,
      versionNumber: newNum,
      label: label ?? `v${newNum}`,
      isActive: false, isLegacy: false,
      includedSeats: includedSeats ?? active?.includedSeats ?? 3,
      maxSeats: maxSeats ?? active?.maxSeats ?? null,
      createdBy: req.platformUserId!,
      notes: notes ?? null,
    }).returning();

    // Clone feature mappings from active version if it exists
    if (active) {
      const [existingFeatures, existingPacks, existingAllowances] = await Promise.all([
        platformDb.select().from(planFeaturesTable).where(eq(planFeaturesTable.planVersionId, active.id)),
        platformDb.select().from(planWorkforcePacksTable).where(eq(planWorkforcePacksTable.planVersionId, active.id)),
        platformDb.select().from(planUsageAllowancesTable).where(eq(planUsageAllowancesTable.planVersionId, active.id)),
      ]);
      if (existingFeatures.length) {
        await platformDb.insert(planFeaturesTable).values(existingFeatures.map(f => ({ ...f, planVersionId: newId }))).onConflictDoNothing();
      }
      if (existingPacks.length) {
        await platformDb.insert(planWorkforcePacksTable).values(existingPacks.map(p => ({ ...p, planVersionId: newId }))).onConflictDoNothing();
      }
      if (existingAllowances.length) {
        await platformDb.insert(planUsageAllowancesTable).values(existingAllowances.map(a => ({ ...a, planVersionId: newId }))).onConflictDoNothing();
      }
    }

    await auditService.log({ eventType: "platform.plan_version_created", actorId: req.platformUserId, metadata: { planId: req.params.id, versionId: newId, versionNumber: newNum } });
    res.status(201).json({ version: newVersion });
  } catch (err) { next(err); }
});

router.post("/plans/:id/versions/:vid/activate", ...billingAuth, async (req, res, next) => {
  try {
    // Deactivate current active version
    await platformDb.update(planVersionsTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(planVersionsTable.planId, req.params.id!), eq(planVersionsTable.isActive, true)));

    const [activated] = await platformDb.update(planVersionsTable)
      .set({ isActive: true, activatedAt: new Date(), updatedAt: new Date() })
      .where(eq(planVersionsTable.id, req.params.vid!))
      .returning();

    await auditService.log({ eventType: "platform.plan_version_activated", actorId: req.platformUserId, metadata: { planId: req.params.id, versionId: req.params.vid } });
    res.json({ version: activated });
  } catch (err) { next(err); }
});

router.post("/plans/:id/versions/:vid/archive", ...billingAuth, async (req, res, next) => {
  try {
    const [archived] = await platformDb.update(planVersionsTable)
      .set({ isActive: false, isLegacy: true, archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(planVersionsTable.id, req.params.vid!))
      .returning();
    await auditService.log({ eventType: "platform.plan_version_archived", actorId: req.platformUserId, metadata: { versionId: req.params.vid } });
    res.json({ version: archived });
  } catch (err) { next(err); }
});

// ─── Features ─────────────────────────────────────────────────────────────────

router.get("/features", ...auth, async (_req, res, next) => {
  try {
    const features = await platformDb.select().from(featuresTable).orderBy(featuresTable.category, featuresTable.code);
    res.json({ features });
  } catch (err) { next(err); }
});

// ─── Usage Dimensions ─────────────────────────────────────────────────────────

router.get("/usage-dimensions", ...auth, async (_req, res, next) => {
  try {
    const dims = await platformDb.select().from(usageDimensionsTable);
    res.json({ dimensions: dims });
  } catch (err) { next(err); }
});

// ─── Cross-org Overrides ──────────────────────────────────────────────────────

router.get("/overrides", ...auth, async (req, res, next) => {
  try {
    const activeOnly = req.query.active !== "false";
    let q = platformDb.select({
      override: tenantOverridesTable,
      org: { id: tenantOverridesTable.organizationId },
    }).from(tenantOverridesTable).$dynamic();
    if (activeOnly) q = q.where(eq(tenantOverridesTable.isActive, true));
    const overrides = await q.orderBy(desc(tenantOverridesTable.createdAt)).limit(200);
    res.json({ overrides });
  } catch (err) { next(err); }
});

export default router;
