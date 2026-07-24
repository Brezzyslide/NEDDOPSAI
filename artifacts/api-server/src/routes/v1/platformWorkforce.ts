/**
 * Platform Workforce Designer routes — /v1/platform/workforce
 * Sprint 4: Metadata-only workforce pack and specialist management.
 * No runtime behaviour changed — data from workforceRegistry (static).
 *
 * GET  /packs            — all packs with specialist counts
 * GET  /packs/:code      — pack detail with full specialist list
 * GET  /specialists      — all specialists
 * GET  /specialists/:code — specialist detail
 * GET  /profiles         — all worker profiles (metadata)
 * GET  /stats            — workforce usage stats across orgs
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import { WORKFORCE_PACKS, SPECIALISTS, getSpecialistCapabilities } from "../../lib/workforceRegistry.js";
import { db, tenantWorkforcePacksTable, organizationsTable, workforcePacksTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

router.get("/packs", ...auth, async (_req, res, next) => {
  try {
    // Cross-org grant counts from DB
    const grantCounts = await db
      .select({ packCode: tenantWorkforcePacksTable.packCode, n: count() })
      .from(tenantWorkforcePacksTable)
      .groupBy(tenantWorkforcePacksTable.packCode);
    const grantMap = Object.fromEntries(grantCounts.map(g => [g.packCode, Number(g.n)]));

    const packs = WORKFORCE_PACKS.map(p => ({
      ...p,
      specialistCount: SPECIALISTS.filter(s => s.packCode === p.code).length,
      orgGrantCount: grantMap[p.code] ?? 0,
    }));
    res.json({ packs });
  } catch (err) { next(err); }
});

router.get("/packs/:code", ...auth, (req, res) => {
  const pack = WORKFORCE_PACKS.find(p => p.code === req.params.code);
  if (!pack) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Pack not found." } }); return; }
  const specialists = SPECIALISTS
    .filter(s => s.packCode === pack.code)
    .map(s => ({ ...s, resolvedCapabilities: getSpecialistCapabilities(s.code) }));
  res.json({ ...pack, specialists });
});

router.get("/specialists", ...auth, (_req, res) => {
  const specialists = SPECIALISTS.map(s => ({
    ...s,
    resolvedCapabilities: getSpecialistCapabilities(s.code),
  }));
  res.json({ specialists, total: specialists.length });
});

router.get("/specialists/:code", ...auth, (req, res) => {
  const s = SPECIALISTS.find(sp => sp.code === req.params.code);
  if (!s) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Specialist not found." } }); return; }
  res.json({ ...s, resolvedCapabilities: getSpecialistCapabilities(s.code) });
});

router.get("/stats", ...auth, async (_req, res, next) => {
  try {
    const grantCounts = await db
      .select({ packCode: tenantWorkforcePacksTable.packCode, n: count() })
      .from(tenantWorkforcePacksTable).groupBy(tenantWorkforcePacksTable.packCode);

    const packStats = WORKFORCE_PACKS.map(p => ({
      code: p.code,
      name: p.name,
      specialistCount: SPECIALISTS.filter(s => s.packCode === p.code).length,
      orgCount: Number(grantCounts.find(g => g.packCode === p.code)?.n ?? 0),
    })).sort((a, b) => b.orgCount - a.orgCount);

    res.json({
      packStats,
      totalSpecialists: SPECIALISTS.length,
      totalPacks: WORKFORCE_PACKS.length,
    });
  } catch (err) { next(err); }
});

export default router;
