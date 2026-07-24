/**
 * Plans routes — /v1/plans/*
 * Public catalogue of available plans. No auth required.
 */

import { Router } from "express";
import { db, plansTable, planVersionsTable, planFeaturesTable, planWorkforcePacksTable, planUsageAllowancesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// GET /v1/plans
router.get("/", async (_req, res, next) => {
  try {
    const plans = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.isActive, true))
      .orderBy(plansTable.displayOrder);

    const enriched = await Promise.all(
      plans.map(async plan => {
        const [version] = await db
          .select()
          .from(planVersionsTable)
          .where(and(eq(planVersionsTable.planId, plan.id), eq(planVersionsTable.isActive, true)))
          .limit(1);
        return { ...plan, activeVersion: version ?? null };
      }),
    );

    res.json({ plans: enriched });
  } catch (err) { next(err); }
});

// GET /v1/plans/:code
router.get("/:code", async (req, res, next) => {
  try {
    const [plan] = await db
      .select()
      .from(plansTable)
      .where(eq(plansTable.code, req.params.code!))
      .limit(1);

    if (!plan) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Plan not found." } }); return; }

    const [version] = await db
      .select()
      .from(planVersionsTable)
      .where(and(eq(planVersionsTable.planId, plan.id), eq(planVersionsTable.isActive, true)))
      .limit(1);

    if (!version) { res.json({ ...plan, activeVersion: null, features: [], workforcePacks: [], usageAllowances: [] }); return; }

    const [features, workforcePacks, usageAllowances] = await Promise.all([
      db.select().from(planFeaturesTable).where(eq(planFeaturesTable.planVersionId, version.id)),
      db.select().from(planWorkforcePacksTable).where(eq(planWorkforcePacksTable.planVersionId, version.id)),
      db.select().from(planUsageAllowancesTable).where(eq(planUsageAllowancesTable.planVersionId, version.id)),
    ]);

    res.json({ ...plan, activeVersion: version, features, workforcePacks, usageAllowances });
  } catch (err) { next(err); }
});

export default router;
