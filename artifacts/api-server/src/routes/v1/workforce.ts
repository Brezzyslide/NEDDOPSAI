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
// By default only returns active catalogue entries (available + dna_pending).
// Pass ?includeDeprecated=true (platform admin use) to see all statuses.
router.get("/specialists", (req, res) => {
  const { pack, status, includeDeprecated } = req.query as {
    pack?: string;
    status?: string;
    includeDeprecated?: string;
  };

  let list = SPECIALISTS;

  // Default filter: exclude deprecated and archived unless caller opts in
  if (includeDeprecated !== "true") {
    list = list.filter(s =>
      s.executionStatus !== "deprecated" &&
      s.executionStatus !== "archived",
    );
  }

  if (pack) list = list.filter(s => s.packCode === pack);
  if (status) list = list.filter(s => s.executionStatus === status);

  res.json({ specialists: list, total: list.length });
});

// GET /v1/workforce/specialists/:code
router.get("/specialists/:code", (req, res) => {
  const specialist = SPECIALISTS.find(s => s.code === req.params.code);
  if (!specialist) {
    res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Specialist not found." } });
    return;
  }
  const capabilities = getSpecialistCapabilities(specialist.code);
  res.json({ specialist, capabilities });
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
