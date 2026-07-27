/**
 * Platform Pack Builder — /v1/platform/packs/*
 * Full CRUD for workforce packs. Platform-admin only.
 *
 * GET    /v1/platform/packs              list all (incl. draft/archived)
 * GET    /v1/platform/packs/:code        single pack with specialist detail
 * POST   /v1/platform/packs              create new pack
 * PATCH  /v1/platform/packs/:code        update pack fields
 * POST   /v1/platform/packs/:code/publish   → status=available, publicly visible
 * POST   /v1/platform/packs/:code/unpublish → status=draft, not publicly visible
 * POST   /v1/platform/packs/:code/archive   → status=archived
 * POST   /v1/platform/packs/:code/grant     grant pack to an org
 */

import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import { db, workforcePacksTable, tenantWorkforcePacksTable, organizationsTable } from "@workspace/db";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import { SPECIALISTS, getSpecialistsByPack } from "../../lib/workforceRegistry.js";

const router = Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function packWithSpecialists(pack: any) {
  const specialists = getSpecialistsByPack(pack.code).map(s => ({
    code: s.code,
    displayName: s.displayName,
    icon: s.icon,
    executionStatus: s.executionStatus,
  }));
  return {
    ...pack,
    priceMonthlyAud: pack.priceMonthly != null ? (pack.priceMonthly / 100).toFixed(2) : null,
    priceAnnualAud: pack.priceAnnual != null ? (pack.priceAnnual / 100).toFixed(2) : null,
    specialists,
  };
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ── routes ────────────────────────────────────────────────────────────────────

// GET /v1/platform/packs
router.get("/", requirePlatformAuth, async (req, res) => {
  try {
    const packs = await db
      .select()
      .from(workforcePacksTable)
      .orderBy(asc(workforcePacksTable.displayOrder));
    res.json({ packs: packs.map(packWithSpecialists) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /v1/platform/packs/:code
router.get("/:code", requirePlatformAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(workforcePacksTable)
      .where(eq(workforcePacksTable.code, req.params.code))
      .limit(1);
    if (!rows.length) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } });
      return;
    }
    // grant count
    const grantRows = await db
      .select({ orgId: tenantWorkforcePacksTable.organizationId })
      .from(tenantWorkforcePacksTable)
      .where(eq(tenantWorkforcePacksTable.packCode, req.params.code));
    res.json({ ...packWithSpecialists(rows[0]), orgGrantCount: grantRows.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs — create
router.post("/", requirePlatformAuth, async (req, res) => {
  const {
    name, description, marketingTagline, industry = "ndis_provider",
    iconEmoji, colorHex, tier = "professional",
    priceMonthly, priceAnnual, currency = "AUD",
    displayOrder = 99, featured = false,
  } = req.body;

  if (!name) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required." } });
    return;
  }

  const code = req.body.code ?? slugify(name);
  const id = `pack_${code}`;

  try {
    const existing = await db
      .select({ id: workforcePacksTable.id })
      .from(workforcePacksTable)
      .where(eq(workforcePacksTable.code, code))
      .limit(1);
    if (existing.length) {
      res.status(409).json({ error: { code: "CONFLICT", message: `Pack code '${code}' already exists.` } });
      return;
    }

    const rows = await db
      .insert(workforcePacksTable)
      .values({
        id,
        code,
        name,
        description,
        marketingTagline,
        industry,
        iconEmoji,
        colorHex,
        tier,
        status: "draft",
        priceMonthly: priceMonthly != null ? Math.round(Number(priceMonthly) * 100) : null,
        priceAnnual: priceAnnual != null ? Math.round(Number(priceAnnual) * 100) : null,
        currency,
        displayOrder,
        featured,
        isPubliclyVisible: false,
        workers: [],
      })
      .returning();

    res.status(201).json({ pack: packWithSpecialists(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PATCH /v1/platform/packs/:code — update fields
router.patch("/:code", requirePlatformAuth, async (req, res) => {
  const {
    name, description, marketingTagline, industry,
    iconEmoji, colorHex, tier,
    priceMonthly, priceAnnual, currency,
    displayOrder, featured, isPubliclyVisible,
  } = req.body;

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (name !== undefined)              updates.name = name;
  if (description !== undefined)       updates.description = description;
  if (marketingTagline !== undefined)  updates.marketingTagline = marketingTagline;
  if (industry !== undefined)          updates.industry = industry;
  if (iconEmoji !== undefined)         updates.iconEmoji = iconEmoji;
  if (colorHex !== undefined)          updates.colorHex = colorHex;
  if (tier !== undefined)              updates.tier = tier;
  if (priceMonthly !== undefined)      updates.priceMonthly = priceMonthly != null ? Math.round(Number(priceMonthly) * 100) : null;
  if (priceAnnual !== undefined)       updates.priceAnnual = priceAnnual != null ? Math.round(Number(priceAnnual) * 100) : null;
  if (currency !== undefined)          updates.currency = currency;
  if (displayOrder !== undefined)      updates.displayOrder = displayOrder;
  if (featured !== undefined)          updates.featured = featured;
  if (isPubliclyVisible !== undefined) updates.isPubliclyVisible = isPubliclyVisible;

  try {
    const rows = await db
      .update(workforcePacksTable)
      .set(updates)
      .where(eq(workforcePacksTable.code, req.params.code))
      .returning();
    if (!rows.length) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } });
      return;
    }
    res.json({ pack: packWithSpecialists(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/publish
router.post("/:code/publish", requirePlatformAuth, async (req, res) => {
  try {
    const rows = await db
      .update(workforcePacksTable)
      .set({ status: "available", isPubliclyVisible: true, updatedAt: new Date() })
      .where(eq(workforcePacksTable.code, req.params.code))
      .returning();
    if (!rows.length) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } });
      return;
    }
    res.json({ pack: packWithSpecialists(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/unpublish
router.post("/:code/unpublish", requirePlatformAuth, async (req, res) => {
  try {
    const rows = await db
      .update(workforcePacksTable)
      .set({ status: "draft", isPubliclyVisible: false, updatedAt: new Date() })
      .where(eq(workforcePacksTable.code, req.params.code))
      .returning();
    if (!rows.length) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } });
      return;
    }
    res.json({ pack: packWithSpecialists(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/archive
router.post("/:code/archive", requirePlatformAuth, async (req, res) => {
  try {
    const rows = await db
      .update(workforcePacksTable)
      .set({ status: "archived", isPubliclyVisible: false, updatedAt: new Date() })
      .where(eq(workforcePacksTable.code, req.params.code))
      .returning();
    if (!rows.length) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } });
      return;
    }
    res.json({ pack: packWithSpecialists(rows[0]) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/grant — grant to org
router.post("/:code/grant", requirePlatformAuth, async (req, res) => {
  const { organizationId, source = "override", expiresAt } = req.body;
  if (!organizationId) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "organizationId is required." } });
    return;
  }
  try {
    const packRows = await db
      .select({ id: workforcePacksTable.id })
      .from(workforcePacksTable)
      .where(eq(workforcePacksTable.code, req.params.code))
      .limit(1);
    if (!packRows.length) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } });
      return;
    }

    const grant = await db
      .insert(tenantWorkforcePacksTable)
      .values({
        id: `twp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        organizationId,
        packCode: req.params.code,
        source,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

    res.status(201).json({ grant: grant[0] });
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      res.status(409).json({ error: { code: "ALREADY_GRANTED", message: "Pack already granted to this org." } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

export default router;
