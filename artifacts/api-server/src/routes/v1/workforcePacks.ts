/**
 * Workforce packs routes — /v1/workforce-packs/*
 * Sprint 9.6: now DB-driven; registry supplements specialist metadata.
 * No auth required — public catalogue.
 */
import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import { db, workforcePacksTable } from "@workspace/db";
import { SPECIALISTS, getSpecialistsByPack, getSpecialistCapabilities } from "../../lib/workforceRegistry.js";

const router = Router();

function formatPack(row: any, includeSpecialists = false) {
  const base = {
    id:               row.id,
    code:             row.code,
    name:             row.name,
    description:      row.description,
    marketingTagline: row.marketingTagline,
    industry:         row.industry,
    iconEmoji:        row.iconEmoji,
    colorHex:         row.colorHex,
    tier:             row.tier,
    status:           row.status,
    priceMonthly:     row.priceMonthly,
    priceAnnual:      row.priceAnnual,
    priceMonthlyAud:  row.priceMonthly != null ? (row.priceMonthly / 100).toFixed(2) : null,
    priceAnnualAud:   row.priceAnnual  != null ? (row.priceAnnual  / 100).toFixed(2) : null,
    currency:         row.currency,
    featured:         row.featured,
    displayOrder:     row.displayOrder,
    specialistCount:  getSpecialistsByPack(row.code).length,
  };
  if (!includeSpecialists) return base;
  const specialists = getSpecialistsByPack(row.code).map(s => ({
    ...s,
    resolvedCapabilities: getSpecialistCapabilities(s.code),
  }));
  return { ...base, specialists };
}

// GET /v1/workforce-packs  — publicly visible packs
router.get("/", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(workforcePacksTable)
      .orderBy(asc(workforcePacksTable.displayOrder));

    let packs = rows.filter(p => p.isPubliclyVisible);
    if (req.query.status) packs = packs.filter(p => p.status === req.query.status);
    res.json({ packs: packs.map(p => formatPack(p)) });
  } catch {
    // Fallback to registry if DB not ready
    const { WORKFORCE_PACKS } = await import("../../lib/workforceRegistry.js");
    res.json({ packs: WORKFORCE_PACKS });
  }
});

// GET /v1/workforce-packs/:code
router.get("/:code", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(workforcePacksTable)
      .where(eq(workforcePacksTable.code, req.params.code))
      .limit(1);

    if (!rows.length || !rows[0]!.isPubliclyVisible) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workforce pack not found." } });
      return;
    }
    res.json(formatPack(rows[0]!, true));
  } catch {
    const { WORKFORCE_PACKS, SPECIALISTS: S, getSpecialistCapabilities: gc } = await import("../../lib/workforceRegistry.js");
    const pack = WORKFORCE_PACKS.find(p => p.code === req.params.code);
    if (!pack) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workforce pack not found." } }); return; }
    const specialists = S.filter(s => s.packCode === pack.code).map(s => ({ ...s, resolvedCapabilities: gc(s.code) }));
    res.json({ ...pack, specialists });
  }
});

export default router;
