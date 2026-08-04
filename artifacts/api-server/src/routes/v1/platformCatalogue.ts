/**
 * Platform Catalogue Management routes — /v1/platform/catalogue
 * Task #40: DB-backed specialist catalogue CRUD.
 *
 * GET    /                        — list all catalogue entries
 * GET    /:code                   — get specialist catalogue entry
 * PATCH  /:code                   — update commercial metadata
 * POST   /:code/archive           — archive specialist (blocked if active in runtime)
 * POST   /:code/unarchive         — unarchive specialist
 * POST   /:code/assign-pack       — reassign pack membership
 * POST   /:code/coming-soon       — toggle coming-soon flag
 * POST   /seed                    — re-seed catalogue from registry (idempotent)
 */

import { Router } from "express";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  listCatalogue,
  getCatalogueEntry,
  updateCatalogueEntry,
  archiveCatalogueEntry,
  unarchiveCatalogueEntry,
  assignToPack,
  markComingSoon,
  seedCatalogueFromRegistry,
} from "../../services/specialistCatalogueService.js";

const router = Router();
const auth = [requireAuth, requirePlatformAuth];

// ─── GET / — list catalogue ───────────────────────────────────────────────────

router.get("/", ...auth, async (req, res, next) => {
  try {
    const {
      includeArchived = "false",
      includeDeprecated = "true",
      packCode,
      search,
      page = "1",
      limit = "50",
    } = req.query as Record<string, string>;

    const result = await listCatalogue({
      includeArchived:   includeArchived === "true",
      includeDeprecated: includeDeprecated !== "false",
      packCode:          packCode || undefined,
      search:            search   || undefined,
      page:              Math.max(1, parseInt(page, 10) || 1),
      limit:             Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ─── GET /:code — get single entry ───────────────────────────────────────────

router.get("/:code", ...auth, async (req, res, next) => {
  try {
    const entry = await getCatalogueEntry(req.params.code!);
    if (!entry) {
      res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Specialist not found in catalogue." } });
      return;
    }
    res.json({ entry });
  } catch (err) { next(err); }
});

// ─── PATCH /:code — update commercial metadata ────────────────────────────────

router.patch("/:code", ...auth, async (req, res, next) => {
  try {
    const actorId = (req as any).auth?.userId ?? "unknown";
    const {
      displayName,
      description,
      comingSoon,
      availability,
      displayOrder,
      planVisibility,
      iconMetadata,
    } = req.body ?? {};

    // Validate only the allowed commercial fields are present
    const allowed = ["displayName", "description", "comingSoon", "availability", "displayOrder", "planVisibility", "iconMetadata"];
    const unknown  = Object.keys(req.body ?? {}).filter(k => !allowed.includes(k));
    if (unknown.length > 0) {
      res.status(400).json({
        error: {
          code:    "VALIDATION_ERROR",
          message: `Fields are not editable: ${unknown.join(", ")}. Only commercial metadata may be updated.`,
        },
      });
      return;
    }

    const updated = await updateCatalogueEntry(req.params.code!, {
      displayName,
      description,
      comingSoon,
      availability,
      displayOrder,
      planVisibility,
      iconMetadata,
    }, actorId);

    res.json({ entry: updated });
  } catch (err) { next(err); }
});

// ─── POST /:code/archive ──────────────────────────────────────────────────────

router.post("/:code/archive", ...auth, async (req, res, next) => {
  try {
    const actorId = (req as any).auth?.userId ?? "unknown";
    const updated = await archiveCatalogueEntry(req.params.code!, actorId);
    res.json({ entry: updated, archived: true });
  } catch (err) { next(err); }
});

// ─── POST /:code/unarchive ────────────────────────────────────────────────────

router.post("/:code/unarchive", ...auth, async (req, res, next) => {
  try {
    const actorId = (req as any).auth?.userId ?? "unknown";
    const updated = await unarchiveCatalogueEntry(req.params.code!, actorId);
    res.json({ entry: updated, archived: false });
  } catch (err) { next(err); }
});

// ─── POST /:code/assign-pack ──────────────────────────────────────────────────

router.post("/:code/assign-pack", ...auth, async (req, res, next) => {
  try {
    const actorId = (req as any).auth?.userId ?? "unknown";
    const { packCode } = req.body ?? {};

    if (!packCode) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "packCode is required." } });
      return;
    }

    const updated = await assignToPack(req.params.code!, packCode, actorId);
    res.json({ entry: updated });
  } catch (err) { next(err); }
});

// ─── POST /:code/coming-soon ──────────────────────────────────────────────────

router.post("/:code/coming-soon", ...auth, async (req, res, next) => {
  try {
    const actorId = (req as any).auth?.userId ?? "unknown";
    const { comingSoon } = req.body ?? {};

    if (typeof comingSoon !== "boolean") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "comingSoon (boolean) is required." } });
      return;
    }

    const updated = await markComingSoon(req.params.code!, comingSoon, actorId);
    res.json({ entry: updated });
  } catch (err) { next(err); }
});

// ─── POST /seed — re-seed from registry (idempotent) ─────────────────────────

router.post("/seed", ...auth, async (_req, res, next) => {
  try {
    const result = await seedCatalogueFromRegistry();
    res.json({ seeded: true, ...result });
  } catch (err) { next(err); }
});

export default router;
