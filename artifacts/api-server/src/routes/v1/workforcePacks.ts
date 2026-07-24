/**
 * Workforce packs routes — /v1/workforce-packs/*
 * Public catalogue of all workforce packs. No auth required.
 */

import { Router } from "express";
import { WORKFORCE_PACKS, SPECIALISTS, getSpecialistCapabilities } from "../../lib/workforceRegistry.js";

const router = Router();

// GET /v1/workforce-packs
router.get("/", (req, res) => {
  const { status } = req.query;
  let packs = WORKFORCE_PACKS;
  if (status) packs = packs.filter(p => p.status === status);
  res.json({ packs });
});

// GET /v1/workforce-packs/:code
router.get("/:code", (req, res) => {
  const pack = WORKFORCE_PACKS.find(p => p.code === req.params.code);
  if (!pack) {
    res.status(404).json({ error: { code: "RESOURCE_NOT_FOUND", message: "Workforce pack not found." } });
    return;
  }
  const specialists = SPECIALISTS
    .filter(s => s.packCode === pack.code)
    .map(s => ({ ...s, resolvedCapabilities: getSpecialistCapabilities(s.code) }));
  res.json({ ...pack, specialists });
});

export default router;
