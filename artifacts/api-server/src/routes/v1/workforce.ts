/**
 * Workforce routes — /v1/workforce/*
 *
 * Serves the static registry: packs, specialists, capabilities.
 * No auth required for read (public catalogue).
 * Tenant-aware endpoints (e.g. which packs are installed) require requireAuth.
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import {
  WORKFORCE_PACKS,
  SPECIALISTS,
  CAPABILITIES,
  getSpecialistsByPack,
  getSpecialistCapabilities,
} from "../../lib/workforceRegistry.js";
import { getCatalogueEntry, listCatalogue } from "../../services/specialistCatalogueService.js";
import { getSafeDNADescriptor } from "@workspace/workforce-dna";

const router = Router();

// GET /v1/workforce/packs
router.get("/packs", (_req, res) => {
  res.json({ packs: WORKFORCE_PACKS });
});

// GET /v1/workforce/packs/:code
router.get("/packs/:code", (req, res) => {
  const pack = WORKFORCE_PACKS.find(p => p.code === req.params.code);
  if (!pack) {
    res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workforce pack not found." } });
    return;
  }
  const specialists = getSpecialistsByPack(pack.code);
  res.json({ pack, specialists });
});

// GET /v1/workforce/specialists
// Task #40/#41: overlays catalogue commercial fields (displayName, comingSoon,
// isArchived, executionStatus, etc.) so callers always see DB-authoritative state.
// By default excludes deprecated and archived; pass ?includeDeprecated=true to opt in.
router.get("/specialists", async (req, res, next) => {
  try {
    const { pack, status, includeDeprecated } = req.query as {
      pack?: string;
      status?: string;
      includeDeprecated?: string;
    };

    // Fetch all catalogue entries (including archived) to build a complete overlay map.
    const { entries: catalogueEntries } = await listCatalogue({
      includeArchived:   true,
      includeDeprecated: true,
      limit:             500,
    });
    const catalogueMap = new Map(catalogueEntries.map(e => [e.specialistCode, e]));

    let list: any[] = SPECIALISTS.map(s => {
      const cat = catalogueMap.get(s.code);
      return {
        ...s,
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
          packCode:        cat.packMembership,
          dnaStatus:       cat.versionMetadata.dnaStatus,
          displayOrder:    cat.displayOrder,
          _source: "catalogue",
        } : {
          isArchived: false,
          comingSoon:  false,
          _source: "registry_only",
        }),
        safeDnaDescriptor: getSafeDNADescriptor(s.code, s.dnaStatus === "approved" ? "available" : "pending"),
      };
    });

    // Default: exclude deprecated and archived unless caller opts in
    if (includeDeprecated !== "true") {
      list = list.filter(s => s.executionStatus !== "deprecated" && !s.isArchived);
    }

    if (pack)   list = list.filter(s => s.packCode === pack);
    if (status) list = list.filter(s => s.executionStatus === status);

    res.json({ specialists: list, total: list.length });
  } catch (err) { next(err); }
});

// GET /v1/workforce/specialists/:code
// Task #41: overlays catalogue commercial/status fields so the detail page
// can derive SpecialistDisplayState from the response.
router.get("/specialists/:code", async (req, res, next) => {
  try {
    const registryEntry = SPECIALISTS.find(s => s.code === req.params.code);
    if (!registryEntry) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Specialist not found." } });
      return;
    }
    const capabilities = getSpecialistCapabilities(registryEntry.code);
    const cat = await getCatalogueEntry(registryEntry.code);

    // Overlay catalogue display fields over registry runtime fields
    const specialist = {
      ...registryEntry,
      ...(cat ? {
        displayName:    cat.displayName,
        description:    cat.description,
        executionStatus: cat.executionStatus,
        availability:   cat.availability,
        comingSoon:     cat.comingSoon,
        isArchived:     cat.isArchived,
        isActive:       cat.isActive,
        icon:           cat.iconMetadata.icon,
        colour:         cat.iconMetadata.colour,
        packCode:       cat.packMembership,
        dnaStatus:      cat.versionMetadata.dnaStatus,
        _source: "catalogue",
      } : {
        isArchived: false,
        comingSoon: false,
        _source: "registry_only",
      }),
      safeDnaDescriptor: getSafeDNADescriptor(
        registryEntry.code,
        registryEntry.dnaStatus === "approved" ? "available" : "pending",
      ),
    };

    res.json({ specialist, capabilities });
  } catch (err) { next(err); }
});

// GET /v1/workforce/capabilities
router.get("/capabilities", (_req, res) => {
  res.json({ capabilities: CAPABILITIES, total: CAPABILITIES.length });
});

// GET /v1/workforce/capabilities/:code
router.get("/capabilities/:code", (req, res) => {
  const cap = CAPABILITIES.find(c => c.code === req.params.code);
  if (!cap) {
    res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Capability not found." } });
    return;
  }
  const specialists = SPECIALISTS.filter(s => s.capabilities.includes(cap.code));
  res.json({ capability: cap, specialists });
});

// GET /v1/workforce/plan — Chief of Staff planning endpoint (requires auth for org context)
router.post("/plan", requireAuth, (req, res, next) => {
  try {
    const { title, description } = req.body as { title?: string; description?: string };
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "title is required." } });
      return;
    }
    // Import lazily to avoid circular
    import("../../services/chiefOfStaffService.js").then(({ planTask }) => {
      const plan = planTask(title, description);
      res.json({ plan });
    }).catch(next);
  } catch (err) {
    next(err);
  }
});

export default router;
