/**
 * Platform Pack Builder — /v1/platform/packs/*
 * Sprint 9.6: Extended with versioned pricing CRUD.
 *
 * PACK routes:
 * GET    /v1/platform/packs              list all (incl. draft/archived)
 * GET    /v1/platform/packs/:code        single pack with specialist + price detail
 * POST   /v1/platform/packs              create new pack
 * PATCH  /v1/platform/packs/:code        update pack metadata (NOT pricing)
 * POST   /v1/platform/packs/:code/publish    → status=available, publicly visible
 * POST   /v1/platform/packs/:code/unpublish  → status=draft, not publicly visible
 * POST   /v1/platform/packs/:code/archive    → status=archived
 * POST   /v1/platform/packs/:code/grant      grant pack to an org
 *
 * PRICE VERSION routes:
 * GET    /v1/platform/packs/:code/prices              list all price versions
 * POST   /v1/platform/packs/:code/prices              create draft price version
 * PATCH  /v1/platform/packs/:code/prices/:vid         edit DRAFT only
 * POST   /v1/platform/packs/:code/prices/:vid/activate   make active (supersedes current)
 * POST   /v1/platform/packs/:code/prices/:vid/archive    archive
 */

import {
  Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { randomUUID } from "crypto";
import { eq,
  asc,
  and,
  desc } from "drizzle-orm";
import {
  workforcePacksTable,
  tenantWorkforcePacksTable,
  workforcePackPriceVersionsTable,
} from "@workspace/db";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import { getSpecialistsByPack } from "../../lib/workforceRegistry.js";
import { invalidatePublicPacksCache } from "./workforcePacks.js";
import * as auditService from "../../services/auditService.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// ─── helpers ─────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

async function packWithDetail(pack: any) {
  const specialists = getSpecialistsByPack(pack.code).map(s => ({
    code: s.code,
    displayName: s.displayName,
    icon: s.icon,
    executionStatus: s.executionStatus,
  }));

  const priceVersions = await platformDb.select()
    .from(workforcePackPriceVersionsTable)
    .where(eq(workforcePackPriceVersionsTable.workforcePackId, pack.id))
    .orderBy(desc(workforcePackPriceVersionsTable.versionNumber));

  const currentPrice = priceVersions.find(v => v.isCurrent && v.status === "active") ?? null;

  return { ...pack, specialists, priceVersions, currentPrice };
}

function validatePricing(monthlyPriceCents?: number, annualPriceCents?: number, isFree?: boolean) {
  if (monthlyPriceCents !== undefined && monthlyPriceCents < 0) {
    return "Monthly price cannot be negative.";
  }
  if (annualPriceCents !== undefined && annualPriceCents < 0) {
    return "Annual price cannot be negative.";
  }
  if (isFree && ((monthlyPriceCents ?? 0) !== 0 || (annualPriceCents ?? 0) !== 0)) {
    return "Free packs must have zero pricing.";
  }
  return null;
}

// ─── Pack CRUD routes ─────────────────────────────────────────────────────────

// GET /v1/platform/packs
router.get("/", ...auth, async (req, res) => {
  try {
    const packs = await platformDb.select()
      .from(workforcePacksTable)
      .orderBy(asc(workforcePacksTable.displayOrder));
    const result = await Promise.all(packs.map(packWithDetail));
    res.json({ packs: result });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// GET /v1/platform/packs/:code
router.get("/:code/prices", ...auth, async (_req, _res, _next) => { _next(); }); // pass-through to price routes below

router.get("/:code", ...auth, async (req, res) => {
  try {
    const [pack] = await platformDb.select()
      .from(workforcePacksTable)
      .where(eq(workforcePacksTable.code, req.params.code))
      .limit(1);
    if (!pack) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } });
      return;
    }
    const grantRows = await platformDb.select({ orgId: tenantWorkforcePacksTable.organizationId })
      .from(tenantWorkforcePacksTable)
      .where(eq(tenantWorkforcePacksTable.packCode, req.params.code));
    res.json({ ...(await packWithDetail(pack)), orgGrantCount: grantRows.length });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs — create
router.post("/", ...auth, async (req, res) => {
  const {
    name, description, marketingTagline, industry = "ndis_provider",
    iconEmoji, colorHex, tier = "professional",
    displayOrder = 99, featured = false,
    isFree = false, pricingStatus = "not_configured", fallbackDisplayText,
    autoGrantOnSignup = false, trialEligible = true, trialLengthDays = 14,
    requiresManualApproval = false, requiresPayment = false,
    publiclySelectable = true, selectionMode = "trial",
  } = req.body;

  if (!name) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "name is required." } });
    return;
  }

  const code = (req.body.code ?? slugify(name)) as string;
  const id = `pack_${code}`;

  try {
    const existing = await platformDb.select({ id: workforcePacksTable.id }).from(workforcePacksTable).where(eq(workforcePacksTable.code, code)).limit(1);
    if (existing.length) {
      res.status(409).json({ error: { code: "CONFLICT", message: `Pack code '${code}' already exists.` } });
      return;
    }

    const [pack] = await platformDb.insert(workforcePacksTable).values({
      id, code, name, description, marketingTagline, industry, iconEmoji, colorHex, tier,
      status: "draft",
      isFree, pricingStatus, fallbackDisplayText,
      autoGrantOnSignup, trialEligible, trialLengthDays,
      requiresManualApproval, requiresPayment, publiclySelectable, selectionMode,
      displayOrder, featured, isPubliclyVisible: false, workers: [],
    }).returning();

    res.status(201).json({ pack: await packWithDetail(pack) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PATCH /v1/platform/packs/:code — update metadata (pricing must go via price versions)
router.patch("/:code", ...auth, async (req, res) => {
  const allowed = [
    "name", "description", "marketingTagline", "industry",
    "iconEmoji", "colorHex", "tier", "displayOrder", "featured", "isPubliclyVisible",
    "isFree", "pricingStatus", "fallbackDisplayText",
    "autoGrantOnSignup", "trialEligible", "trialLengthDays",
    "requiresManualApproval", "requiresPayment", "publiclySelectable", "selectionMode",
  ];
  const updates: Record<string, any> = { updatedAt: new Date() };
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  try {
    const [pack] = await platformDb.update(workforcePacksTable).set(updates).where(eq(workforcePacksTable.code, req.params.code)).returning();
    if (!pack) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } }); return; }
    invalidatePublicPacksCache();
    await auditService.writeAuditEvent({
      actorUserId: req.platformUserId!, actorType: "platform_staff",
      eventType: "workforce_pack.updated" as any, resourceType: "workforce_pack",
      resourceId: pack.id, metadata: { packCode: pack.code, changes: Object.keys(updates).filter(k => k !== "updatedAt") },
    }).catch(() => {});
    res.json({ pack: await packWithDetail(pack) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/publish
router.post("/:code/publish", ...auth, async (req, res) => {
  try {
    const [pack] = await platformDb.update(workforcePacksTable)
      .set({ status: "available", isPubliclyVisible: true, updatedAt: new Date() })
      .where(eq(workforcePacksTable.code, req.params.code)).returning();
    if (!pack) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } }); return; }
    invalidatePublicPacksCache();
    await auditService.writeAuditEvent({
      actorUserId: req.platformUserId, actorType: "platform_staff",
      eventType: "workforce_pack.published" as any, resourceType: "workforce_pack", resourceId: pack.id,
      metadata: { packCode: pack.code },
    }).catch(() => {});
    res.json({ pack: await packWithDetail(pack) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/unpublish
router.post("/:code/unpublish", ...auth, async (req, res) => {
  try {
    const [pack] = await platformDb.update(workforcePacksTable)
      .set({ status: "draft", isPubliclyVisible: false, updatedAt: new Date() })
      .where(eq(workforcePacksTable.code, req.params.code)).returning();
    if (!pack) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } }); return; }
    invalidatePublicPacksCache();
    await auditService.writeAuditEvent({
      actorUserId: req.platformUserId, actorType: "platform_staff",
      eventType: "workforce_pack.unpublished" as any, resourceType: "workforce_pack", resourceId: pack.id,
      metadata: { packCode: pack.code },
    }).catch(() => {});
    res.json({ pack: await packWithDetail(pack) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/archive
router.post("/:code/archive", ...auth, async (req, res) => {
  try {
    const [pack] = await platformDb.update(workforcePacksTable)
      .set({ status: "archived", isPubliclyVisible: false, updatedAt: new Date() })
      .where(eq(workforcePacksTable.code, req.params.code)).returning();
    if (!pack) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } }); return; }
    invalidatePublicPacksCache();
    await auditService.writeAuditEvent({
      actorUserId: req.platformUserId, actorType: "platform_staff",
      eventType: "workforce_pack.archived" as any, resourceType: "workforce_pack", resourceId: pack.id,
      metadata: { packCode: pack.code },
    }).catch(() => {});
    res.json({ pack: await packWithDetail(pack) });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/grant — grant pack to an org
router.post("/:code/grant", ...auth, async (req, res) => {
  const { organizationId, expiresAt, reason = "Manual grant by platform staff" } = req.body;
  if (!organizationId) {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "organizationId is required." } });
    return;
  }
  try {
    const [pack] = await platformDb.select({ id: workforcePacksTable.id }).from(workforcePacksTable).where(eq(workforcePacksTable.code, req.params.code)).limit(1);
    if (!pack) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } }); return; }

    const [grant] = await platformDb.insert(tenantWorkforcePacksTable).values({
      id: `twp_${randomUUID()}`,
      organizationId,
      packCode: req.params.code,
      source: "manual_grant",
      grantedBy: req.platformUserId,
      reason,
      status: "active",
      activatedAt: new Date(),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      approvedBy: req.platformUserId,
    }).returning();

    await auditService.writeAuditEvent({
      organizationId, actorUserId: req.platformUserId, actorType: "platform_staff",
      eventType: "workforce_pack.granted_during_onboarding" as any,
      resourceType: "workforce_pack", resourceId: pack.id,
      metadata: { packCode: req.params.code, source: "manual_grant", reason },
    }).catch(() => {});

    res.status(201).json({ grant });
  } catch (err: any) {
    if (err.message?.includes("unique")) {
      res.status(409).json({ error: { code: "ALREADY_GRANTED", message: "Pack already granted to this org." } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// ─── Price Version routes ─────────────────────────────────────────────────────

// GET /v1/platform/packs/:code/prices
router.get("/:code/prices", ...auth, async (req, res) => {
  try {
    const [pack] = await platformDb.select({ id: workforcePacksTable.id }).from(workforcePacksTable).where(eq(workforcePacksTable.code, req.params.code)).limit(1);
    if (!pack) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } }); return; }

    const versions = await platformDb.select().from(workforcePackPriceVersionsTable)
      .where(eq(workforcePackPriceVersionsTable.workforcePackId, pack.id))
      .orderBy(desc(workforcePackPriceVersionsTable.versionNumber));
    res.json({ priceVersions: versions });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/prices — create draft price version
router.post("/:code/prices", ...auth, async (req, res) => {
  const { monthlyPriceCents, annualPriceCents, currency = "AUD", notes, effectiveFrom } = req.body;
  const staff = req.platformUserId!;

  // Validation
  const validErr = validatePricing(monthlyPriceCents, annualPriceCents);
  if (validErr) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: validErr } }); return; }
  if (!currency) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "currency is required." } }); return; }

  try {
    const [pack] = await platformDb.select().from(workforcePacksTable).where(eq(workforcePacksTable.code, req.params.code)).limit(1);
    if (!pack) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Pack not found." } }); return; }
    if (pack.status === "archived") { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Archived pack cannot have new pricing." } }); return; }

    // Determine next version number
    const existing = await platformDb.select({ versionNumber: workforcePackPriceVersionsTable.versionNumber })
      .from(workforcePackPriceVersionsTable)
      .where(eq(workforcePackPriceVersionsTable.workforcePackId, pack.id))
      .orderBy(desc(workforcePackPriceVersionsTable.versionNumber))
      .limit(1);

    const nextVersion = (existing[0]?.versionNumber ?? 0) + 1;

    const [version] = await platformDb.insert(workforcePackPriceVersionsTable).values({
      id:               `ppv_${randomUUID()}`,
      workforcePackId:  pack.id,
      versionNumber:    nextVersion,
      monthlyPriceCents: monthlyPriceCents != null ? Number(monthlyPriceCents) : null,
      annualPriceCents:  annualPriceCents  != null ? Number(annualPriceCents)  : null,
      currency,
      status:           "draft",
      effectiveFrom:    effectiveFrom ? new Date(effectiveFrom) : null,
      isCurrent:        false,
      notes,
      createdBy:        staff,
    }).returning();

    await auditService.writeAuditEvent({
      actorUserId: staff, actorType: "platform_staff",
      eventType: "workforce_pack.price_created" as any, resourceType: "pack_price_version",
      resourceId: version!.id, metadata: { packCode: pack.code, versionNumber: nextVersion, currency },
    }).catch(() => {});

    res.status(201).json({ priceVersion: version });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// PATCH /v1/platform/packs/:code/prices/:vid — edit DRAFT only
router.patch("/:code/prices/:vid", ...auth, async (req, res) => {
  const { monthlyPriceCents, annualPriceCents, currency, notes, effectiveFrom } = req.body;

  try {
    const [version] = await platformDb.select().from(workforcePackPriceVersionsTable).where(eq(workforcePackPriceVersionsTable.id, req.params.vid)).limit(1);
    if (!version) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Price version not found." } }); return; }
    if (version.status !== "draft") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Only draft price versions can be edited. To change an active price, create a new version." } });
      return;
    }

    const validErr = validatePricing(monthlyPriceCents, annualPriceCents);
    if (validErr) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: validErr } }); return; }

    const updates: Record<string, any> = { updatedAt: new Date() };
    if (monthlyPriceCents !== undefined) updates.monthlyPriceCents = Number(monthlyPriceCents);
    if (annualPriceCents  !== undefined) updates.annualPriceCents  = Number(annualPriceCents);
    if (currency   !== undefined) updates.currency   = currency;
    if (notes      !== undefined) updates.notes      = notes;
    if (effectiveFrom !== undefined) updates.effectiveFrom = new Date(effectiveFrom);

    const [updated] = await platformDb.update(workforcePackPriceVersionsTable).set(updates).where(eq(workforcePackPriceVersionsTable.id, req.params.vid)).returning();
    res.json({ priceVersion: updated });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/prices/:vid/activate — publish price version
router.post("/:code/prices/:vid/activate", ...auth, async (req, res) => {
  const staff = req.platformUserId!;

  try {
    const [version] = await platformDb.select().from(workforcePackPriceVersionsTable).where(eq(workforcePackPriceVersionsTable.id, req.params.vid)).limit(1);
    if (!version) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Price version not found." } }); return; }
    if (!["draft", "scheduled"].includes(version.status)) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Only draft or scheduled versions can be activated." } }); return;
    }
    if (!version.currency) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Active price requires currency." } }); return;
    }

    // Supersede previous active version for same currency
    await platformDb.update(workforcePackPriceVersionsTable)
      .set({ status: "superseded", isCurrent: false, updatedAt: new Date() })
      .where(and(
        eq(workforcePackPriceVersionsTable.workforcePackId, version.workforcePackId),
        eq(workforcePackPriceVersionsTable.currency, version.currency),
        eq(workforcePackPriceVersionsTable.isCurrent, true),
      ));

    // Activate this version
    const [activated] = await platformDb.update(workforcePackPriceVersionsTable)
      .set({ status: "active", isCurrent: true, publishedAt: new Date(), approvedBy: staff, updatedAt: new Date() })
      .where(eq(workforcePackPriceVersionsTable.id, version.id))
      .returning();

    // Update pack pricingStatus to reflect it now has pricing
    await platformDb.update(workforcePacksTable)
      .set({ pricingStatus: "not_configured", updatedAt: new Date() }) // reset; public endpoint derives from price versions
      .where(eq(workforcePacksTable.id, version.workforcePackId));

    invalidatePublicPacksCache();

    await auditService.writeAuditEvent({
      actorUserId: staff, actorType: "platform_staff",
      eventType: "workforce_pack.price_activated" as any, resourceType: "pack_price_version",
      resourceId: version.id, metadata: { versionNumber: version.versionNumber, currency: version.currency },
    }).catch(() => {});

    res.json({ priceVersion: activated });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// POST /v1/platform/packs/:code/prices/:vid/archive
router.post("/:code/prices/:vid/archive", ...auth, async (req, res) => {
  try {
    const [version] = await platformDb.select().from(workforcePackPriceVersionsTable).where(eq(workforcePackPriceVersionsTable.id, req.params.vid)).limit(1);
    if (!version) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Price version not found." } }); return; }

    const [archived] = await platformDb.update(workforcePackPriceVersionsTable)
      .set({ status: "archived", isCurrent: false, archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(workforcePackPriceVersionsTable.id, version.id))
      .returning();

    if (version.isCurrent) invalidatePublicPacksCache();

    await auditService.writeAuditEvent({
      actorUserId: req.platformUserId, actorType: "platform_staff",
      eventType: "workforce_pack.price_archived" as any, resourceType: "pack_price_version",
      resourceId: version.id, metadata: { versionNumber: version.versionNumber },
    }).catch(() => {});

    res.json({ priceVersion: archived });
  } catch (err: any) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

export default router;
