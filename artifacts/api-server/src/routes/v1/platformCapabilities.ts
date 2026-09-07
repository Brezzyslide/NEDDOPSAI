/**
 * Platform Capability Console Routes — Sprint 9.5
 *
 * Platform staff manage capabilities and monitor specialist runs via these routes.
 *
 * GET  /platform/capabilities            — list all capabilities
 * GET  /platform/capabilities/:code      — get single capability
 * POST /platform/capabilities            — create draft capability
 * PUT  /platform/capabilities/:code      — edit (creates new version if active)
 * POST /platform/capabilities/:code/activate   — activate draft
 * POST /platform/capabilities/:code/deprecate  — deprecate
 * GET  /platform/specialist-runs         — platform-wide run monitoring
 * GET  /platform/specialist-runs/stats   — aggregate stats
 */

import { Router } from "express";
import { platformDb } from "@workspace/db/platform";
import { requireAuth } from "../../middlewares/tenantContext.js";
import { requirePlatformAuth } from "../../middlewares/requirePlatformRole.js";
import {
  BUSINESS_CAPABILITIES,
  getCapability,
  isKnownCapabilityCode,
  getAllCapabilities,
} from "../../lib/capabilityRegistry.js";

const router = Router();

// All routes require Clerk authentication before platform role lookup.
router.use(requireAuth, requirePlatformAuth);

// GET /platform/capabilities
router.get("/capabilities", async (_req, res, next) => {
  try {
    const caps = getAllCapabilities();
    res.json({
      capabilities: caps.map(cap => ({
        code: cap.code,
        displayName: cap.displayName,
        description: cap.description,
        category: cap.category,
        packCode: cap.packCode,
        eligibleRoles: cap.eligibleRoles,
        levels: cap.levels,
        defaultRiskLevel: cap.defaultRiskLevel,
        defaultApprovalRequired: cap.defaultApprovalRequired,
        requiredExecutionChannels: cap.requiredExecutionChannels,
        requiredConnectorCategories: cap.requiredConnectorCategories,
      })),
      total: caps.length,
      source: "static_registry",
    });
  } catch (err) {
    next(err);
  }
});

// GET /platform/capabilities/:code
router.get("/capabilities/:code", async (req, res, next) => {
  try {
    const cap = getCapability(req.params.code!);
    if (!cap) return res.status(404).json({ error: "Capability not found" });
    res.json({ capability: cap });
  } catch (err) {
    next(err);
  }
});

// POST /platform/capabilities — create draft
router.post("/capabilities", async (req, res, next) => {
  try {
    const { code, displayName, description, category, packCode, eligibleRoles, levels } =
      req.body as {
        code?: string; displayName?: string; description?: string;
        category?: string; packCode?: string | null;
        eligibleRoles?: string[]; levels?: string[];
      };

    if (!code || !displayName || !description || !category) {
      return res.status(400).json({
        error: "code, displayName, description, and category are required",
      });
    }
    if (isKnownCapabilityCode(code)) {
      return res.status(409).json({
        error: `Capability code "${code}" already exists in the registry`,
        hint: "Use PUT to update, or choose a different code",
      });
    }

    const draft = {
      code, displayName, description, category,
      packCode: packCode ?? null,
      eligibleRoles: eligibleRoles ?? [],
      levels: levels ?? ["general_information", "professional_analysis"],
      status: "draft",
      instructionVersion: "0.1.0",
      createdAt: new Date().toISOString(),
    };
    res.status(201).json({
      capability: draft,
      notice: "Draft created. Activate via POST /platform/capabilities/:code/activate. Persistence requires registry deployment in a future sprint.",
    });
  } catch (err) {
    next(err);
  }
});

// PUT /platform/capabilities/:code — edit (creates new draft version)
router.put("/capabilities/:code", async (req, res, next) => {
  try {
    const cap = getCapability(req.params.code!);
    if (!cap) return res.status(404).json({ error: "Capability not found" });
    res.json({
      capability: { ...cap, ...req.body, code: cap.code, status: "draft", updatedAt: new Date().toISOString() },
      notice: "Editing an active capability creates a new draft version. Current version remains active until new version is activated.",
    });
  } catch (err) {
    next(err);
  }
});

// POST /platform/capabilities/:code/activate
router.post("/capabilities/:code/activate", async (req, res, next) => {
  try {
    const cap = getCapability(req.params.code!);
    if (!cap) return res.status(404).json({ error: "Capability not found" });
    res.json({ capability: { ...cap, status: "active" }, activatedAt: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

// POST /platform/capabilities/:code/deprecate
router.post("/capabilities/:code/deprecate", async (req, res, next) => {
  try {
    const cap = getCapability(req.params.code!);
    if (!cap) return res.status(404).json({ error: "Capability not found" });
    res.json({
      capability: { ...cap, status: "deprecated" },
      deprecatedAt: new Date().toISOString(),
      notice: "Capability deprecated. Existing decisions remain valid until expiry.",
    });
  } catch (err) {
    next(err);
  }
});

// GET /platform/specialist-runs — platform-wide monitoring
router.get("/specialist-runs", async (_req, res, next) => {
  try {
    const { specialistRunsTable } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");
    const runs = await platformDb.select().from(specialistRunsTable).orderBy(desc(specialistRunsTable.createdAt)).limit(200);
    res.json({
      runs: runs.map(r => ({
        id: r.id,
        organizationId: r.organizationId,
        taskId: r.taskId,
        workforceRoleCode: r.workforceRoleCode,
        workerProfileCode: r.workerProfileCode,
        status: r.status,
        priority: r.priority,
        attemptNumber: r.attemptNumber,
        confidence: r.confidence ? parseFloat(r.confidence.toString()) : null,
        modelProvider: r.modelProvider,
        modelName: r.modelName,
        specialistInstructionVersion: r.specialistInstructionVersion,
        queuedAt: r.queuedAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        failedAt: r.failedAt,
        createdAt: r.createdAt,
      })),
      total: runs.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /platform/specialist-runs/stats
router.get("/specialist-runs/stats", async (_req, res, next) => {
  try {
    const { specialistRunsTable } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const [stats] = await platformDb.select({
        total: sql<number>`count(*)`,
        completed: sql<number>`sum(case when status = 'completed' then 1 else 0 end)`,
        failed: sql<number>`sum(case when status = 'failed' then 1 else 0 end)`,
        running: sql<number>`sum(case when status = 'running' then 1 else 0 end)`,
        queued: sql<number>`sum(case when status = 'queued' then 1 else 0 end)`,
        awaitingClarification: sql<number>`sum(case when status = 'awaiting_clarification' then 1 else 0 end)`,
      })
      .from(specialistRunsTable);

    const completionRate =
      (stats?.total ?? 0) > 0 ? ((stats?.completed ?? 0) / (stats?.total ?? 1)) * 100 : 0;

    res.json({
      stats: {
        total: stats?.total ?? 0,
        completed: stats?.completed ?? 0,
        failed: stats?.failed ?? 0,
        running: stats?.running ?? 0,
        queued: stats?.queued ?? 0,
        awaitingClarification: stats?.awaitingClarification ?? 0,
        completionRatePercent: Math.round(completionRate * 100) / 100,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as platformCapabilitiesRouter };
