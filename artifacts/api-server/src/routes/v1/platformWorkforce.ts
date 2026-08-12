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
import { WORKFORCE_PACKS, SPECIALISTS, getSpecialistCapabilities, DEPRECATED_ROLE_ALIASES } from "../../lib/workforceRegistry.js";
import { db, tenantWorkforcePacksTable, organizationsTable, workforcePacksTable, specialistCatalogueTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { listCatalogue } from "../../services/specialistCatalogueService.js";
import { getCanonicalDNAProfile } from "@workspace/workforce-dna";

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

// Task #40: async, overlays catalogue commercial fields on each specialist in the pack.
router.get("/packs/:code", ...auth, async (req, res, next) => {
  try {
    const pack = WORKFORCE_PACKS.find(p => p.code === req.params.code);
    if (!pack) { res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Pack not found." } }); return; }

    // Fetch catalogue map (including archived so isArchived is correct)
    const { entries: catalogueEntries } = await listCatalogue({ includeArchived: true, limit: 500 });
    const catalogueMap = new Map(catalogueEntries.map(e => [e.specialistCode, e]));

    const specialists = SPECIALISTS
      .filter(s => s.packCode === pack.code)
      .map(s => {
        const cat = catalogueMap.get(s.code);
        return {
          ...s,
          resolvedCapabilities: getSpecialistCapabilities(s.code),
          ...(cat ? {
            displayName:     cat.displayName,
            description:     cat.description,
            executionStatus: cat.executionStatus,
            availability:    cat.availability,
            comingSoon:      cat.comingSoon,
            isArchived:      cat.isArchived,
            isActive:        cat.isActive,
            icon:            cat.iconMetadata.icon,
            colour:          cat.iconMetadata.colour,
            displayOrder:    cat.displayOrder,
            dnaStatus:       cat.versionMetadata.dnaStatus,
            _source: "catalogue",
          } : { isArchived: false, comingSoon: false, _source: "registry_only" }),
        };
      });
    res.json({ ...pack, specialists });
  } catch (err) { next(err); }
});

// Task #40: specialists endpoint now merges DB catalogue + registry.
// Always fetches catalogue with includeArchived:true so that archived entries
// appear in the map and are correctly filtered out after the merge.
// Query filters (packCode, search, status) are applied to the MERGED list, not
// just the catalogue query — otherwise registry-only entries bypass those filters.
router.get("/specialists", ...auth, async (req, res, next) => {
  try {
    const { status, includeArchived = "false", packCode, search } = req.query as Record<string, string>;

    // Fetch ALL catalogue entries (including archived) so the map is complete.
    // Filtering happens on the merged list below — not on the catalogue query.
    const { entries: catalogueEntries } = await listCatalogue({
      includeArchived:   true,   // ← always fetch archived so they appear in the map
      includeDeprecated: true,
      limit:             500,
    });

    // Map by specialist code
    const catalogueMap = new Map(catalogueEntries.map(e => [e.specialistCode, e]));

    // Build merged list from full registry
    let merged = SPECIALISTS.map(s => {
      const cat = catalogueMap.get(s.code);
      return {
        // Runtime fields from registry (code-defined)
        ...s,
        resolvedCapabilities: getSpecialistCapabilities(s.code),
        replacementRoleCode: DEPRECATED_ROLE_ALIASES[s.code] ?? null,
        // Commercial fields from catalogue DB (override registry if available)
        ...(cat ? {
          displayName:         cat.displayName,
          description:         cat.description,
          executionStatus:     cat.executionStatus,
          availability:        cat.availability,
          icon:                cat.iconMetadata.icon,
          colour:              cat.iconMetadata.colour,
          packCode:            cat.packMembership,
          comingSoon:          cat.comingSoon,
          displayOrder:        cat.displayOrder,
          isActive:            cat.isActive,
          isArchived:          cat.isArchived,
          planVisibility:      cat.planVisibility,
          catalogueVersion:    cat.versionMetadata.catalogueVersion,
          catalogueVersionNum: cat.versionCounter,
          _source: "catalogue",
        } : { isArchived: false, _source: "registry_only" }),
      };
    });

    // Apply filters to the merged list so registry-only entries cannot bypass them
    if (includeArchived !== "true") {
      merged = merged.filter(s => !s.isArchived);
    }
    if (status) {
      merged = merged.filter(s => s.executionStatus === status);
    }
    if (packCode) {
      // packCode filter: use catalogue packMembership when available, else registry packCode
      merged = merged.filter(s => (s as any).packCode === packCode);
    }
    if (search) {
      const q = search.toLowerCase();
      merged = merged.filter(s =>
        s.displayName.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q),
      );
    }

    res.json({ specialists: merged, total: merged.length });
  } catch (err) { next(err); }
});

// Platform-private canonical DNA inspection. Tenant workforce routes only expose
// safe descriptors; full DNA remains platform IP behind platform auth.
router.get("/specialists/:code/dna", ...auth, (req, res) => {
  const dna = getCanonicalDNAProfile(req.params.code);
  if (!dna) {
    res.status(404).json({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Canonical DNA is not published for this specialist.",
      },
    });
    return;
  }
  res.json({ dna });
});

router.get("/specialists/:code", ...auth, async (req, res, next) => {
  try {
    const s = SPECIALISTS.find(sp => sp.code === req.params.code);
    if (!s) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Specialist not found." } });
      return;
    }
    const { getCatalogueEntry } = await import("../../services/specialistCatalogueService.js");
    const cat = await getCatalogueEntry(s.code);
    res.json({
      ...s,
      resolvedCapabilities: getSpecialistCapabilities(s.code),
      ...(cat ? {
        displayName:       cat.displayName,
        description:       cat.description,
        executionStatus:   cat.executionStatus,
        availability:      cat.availability,
        icon:              cat.iconMetadata.icon,
        colour:            cat.iconMetadata.colour,
        packCode:          cat.packMembership,
        comingSoon:        cat.comingSoon,
        displayOrder:      cat.displayOrder,
        isActive:          cat.isActive,
        isArchived:        cat.isArchived,
        planVisibility:    cat.planVisibility,
        catalogueVersionNum: cat.versionCounter,
        _source: "catalogue",
      } : { _source: "registry_only" }),
    });
  } catch (err) { next(err); }
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
