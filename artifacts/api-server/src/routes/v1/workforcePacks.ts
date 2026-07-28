/**
 * Workforce packs routes — /v1/workforce-packs/*
 * Sprint 9.6: DB-driven public catalogue with versioned pricing.
 * No auth required — public endpoint.
 *
 * Pricing display rules (server-enforced):
 *  - isFree=true         → displayMode="free"
 *  - active price version → displayMode="priced", return cents
 *  - status="coming_soon" → displayMode="coming_soon"
 *  - pricingStatus        → displayMode per enum value
 *  - fallback             → displayMode="contact_sales"
 */
import { Router } from "express";
import { eq, asc, and } from "drizzle-orm";
import { db, workforcePacksTable, workforcePackPriceVersionsTable } from "@workspace/db";
import { getSpecialistsByPack, getSpecialistCapabilities } from "../../lib/workforceRegistry.js";
import { getPublicPacksFromCache, setPublicPacksCache, invalidatePublicPacksCache } from "../../services/packCacheService.js";

export { invalidatePublicPacksCache };

const router = Router();

// ─── helpers ─────────────────────────────────────────────────────────────────

type DisplayMode = "free" | "priced" | "contact_sales" | "coming_soon";

function buildPricingObject(pack: any, priceVersion: any): {
  isFree: boolean;
  currency?: string;
  monthlyPriceCents?: number;
  annualPriceCents?: number;
  displayMode: DisplayMode;
  fallbackText?: string;
} {
  // Explicitly free
  if (pack.isFree) {
    return { isFree: true, displayMode: "free" };
  }

  // Coming soon pack
  if (pack.status === "coming_soon") {
    return { isFree: false, displayMode: "coming_soon", fallbackText: "Coming soon" };
  }

  // Active price version present
  if (priceVersion && priceVersion.status === "active" && priceVersion.isCurrent) {
    return {
      isFree: false,
      currency: priceVersion.currency,
      monthlyPriceCents: priceVersion.monthlyPriceCents ?? undefined,
      annualPriceCents: priceVersion.annualPriceCents ?? undefined,
      displayMode: "priced",
    };
  }

  // Fallback by pricingStatus
  const pricingStatus = pack.pricingStatus ?? "not_configured";
  if (pricingStatus === "contact_sales") {
    return {
      isFree: false,
      displayMode: "contact_sales",
      fallbackText: pack.fallbackDisplayText ?? "Contact NeedsOps",
    };
  }
  if (pricingStatus === "coming_soon") {
    return { isFree: false, displayMode: "coming_soon", fallbackText: pack.fallbackDisplayText ?? "Pricing coming soon" };
  }

  // Default: not configured
  return {
    isFree: false,
    displayMode: "contact_sales",
    fallbackText: pack.fallbackDisplayText ?? "Contact NeedsOps",
  };
}

function formatPublicPack(pack: any, priceVersion: any, includeSpecialists = false) {
  const pricing = buildPricingObject(pack, priceVersion);
  const specialistCount = getSpecialistsByPack(pack.code).length;

  const base = {
    id:               pack.id,
    code:             pack.code,
    name:             pack.name,
    description:      pack.description,
    marketingTagline: pack.marketingTagline,
    industry:         pack.industry,
    iconEmoji:        pack.iconEmoji,
    colorHex:         pack.colorHex,
    tier:             pack.tier,
    status:           pack.status,
    featured:         pack.featured,
    displayOrder:     pack.displayOrder,
    specialistCount,
    // Onboarding config (needed by step 4 picker)
    trialEligible:    pack.trialEligible,
    trialLengthDays:  pack.trialLengthDays,
    selectionMode:    pack.selectionMode,
    publiclySelectable: pack.publiclySelectable,
    // Structured pricing (Sprint 9.6)
    pricing,
    // Legacy flat fields retained for backward-compat — do NOT add new pricing here
    priceMonthly:    null,   // deprecated
    priceAnnual:     null,   // deprecated
    priceMonthlyAud: null,   // deprecated
    priceAnnualAud:  null,   // deprecated
  };

  if (!includeSpecialists) return base;

  const specialists = getSpecialistsByPack(pack.code).map(s => ({
    ...s,
    resolvedCapabilities: getSpecialistCapabilities(s.code),
  }));
  return { ...base, specialists };
}

// ─── routes ──────────────────────────────────────────────────────────────────

// GET /v1/workforce-packs  — publicly visible, available packs with pricing
router.get("/", async (req, res) => {
  try {
    // Check cache (no status filter bypass cache)
    const statusFilter = req.query.status as string | undefined;
    if (!statusFilter) {
      const cached = getPublicPacksFromCache<any[]>();
      if (cached) {
        res.json({ packs: cached, source: "cache" });
        return;
      }
    }

    // Load packs + current active price versions
    const packs = await db
      .select()
      .from(workforcePacksTable)
      .orderBy(asc(workforcePacksTable.displayOrder));

    const priceVersions = await db
      .select()
      .from(workforcePackPriceVersionsTable)
      .where(and(
        eq(workforcePackPriceVersionsTable.isCurrent, true),
        eq(workforcePackPriceVersionsTable.status, "active"),
      ));

    const priceMap = new Map(priceVersions.map(v => [v.workforcePackId, v]));

    let visible = packs.filter(p => p.isPubliclyVisible && p.status !== "archived");
    if (statusFilter) visible = visible.filter(p => p.status === statusFilter);

    const result = visible.map(p => formatPublicPack(p, priceMap.get(p.id)));

    if (!statusFilter) setPublicPacksCache(result);

    res.json({ packs: result });
  } catch (err: any) {
    // Fallback to registry if DB not ready
    try {
      const { WORKFORCE_PACKS } = await import("../../lib/workforceRegistry.js");
      res.json({ packs: WORKFORCE_PACKS, source: "registry_fallback" });
    } catch {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
    }
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

    const pack = rows[0]!;
    const priceVersions = await db
      .select()
      .from(workforcePackPriceVersionsTable)
      .where(and(
        eq(workforcePackPriceVersionsTable.workforcePackId, pack.id),
        eq(workforcePackPriceVersionsTable.isCurrent, true),
        eq(workforcePackPriceVersionsTable.status, "active"),
      ))
      .limit(1);

    res.json(formatPublicPack(pack, priceVersions[0] ?? null, true));
  } catch (err: any) {
    try {
      const { WORKFORCE_PACKS, SPECIALISTS: S, getSpecialistCapabilities: gc } = await import("../../lib/workforceRegistry.js");
      const pack = WORKFORCE_PACKS.find((p: any) => p.code === req.params.code);
      if (!pack) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workforce pack not found." } }); return; }
      const specialists = S.filter((s: any) => s.packCode === pack.code).map((s: any) => ({ ...s, resolvedCapabilities: gc(s.code) }));
      res.json({ ...pack, specialists });
    } catch {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
    }
  }
});

export default router;
