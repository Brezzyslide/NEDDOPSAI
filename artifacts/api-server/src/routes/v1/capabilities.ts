/**
 * Capability routes — /v1/capabilities and /v1/organisations/:slug/capabilities
 *
 * Sprint 9.4: Capability registry access and organisation-scoped capability
 * entitlement checking.
 *
 * GET  /v1/capabilities                              — list all active capabilities (public catalogue)
 * GET  /v1/capabilities/:code                        — single capability detail
 * GET  /v1/organisations/:slug/capabilities          — capabilities with access decisions for this org
 * POST /v1/organisations/:slug/capabilities/check    — check access for specific capability + level
 */

import { Router } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import {
  BUSINESS_CAPABILITIES,
  getCapability,
  getCapabilitiesForPack,
  isKnownCapabilityCode,
  type CapabilityLevel,
} from "../../lib/capabilityRegistry.js";
import {
  decideCapabilityAccess,
} from "../../services/capabilityAccessDecisionService.js";
import { randomUUID } from "crypto";

const router = Router({ mergeParams: true });

// ── GET /v1/capabilities ───────────────────────────────────────────────────────

router.get("/", async (_req, res, next) => {
  try {
    const active = BUSINESS_CAPABILITIES.filter(c => c.status === "active");
    res.json({
      capabilities: active.map(c => ({
        code: c.code,
        displayName: c.displayName,
        description: c.description,
        category: c.category,
        packCode: c.packCode,
        informationAllowed: c.informationAllowed,
        analysisAllowed: c.analysisAllowed,
        executionAllowed: c.executionAllowed,
        status: c.status,
        version: c.version,
      })),
      total: active.length,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /v1/capabilities/:code ────────────────────────────────────────────────

router.get("/:code", async (req, res, next) => {
  try {
    const { code } = req.params as { code: string };
    if (!isKnownCapabilityCode(code)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Capability not found" } });
      return;
    }
    const cap = getCapability(code)!;
    res.json({ capability: cap });
  } catch (err) {
    next(err);
  }
});

export { router as capabilitiesRouter };

// ── Organisation-scoped capability router ──────────────────────────────────────

const orgCapRouter = Router({ mergeParams: true });

/**
 * GET /v1/organisations/:slug/capabilities
 *
 * Returns all capabilities grouped by pack with access decisions for this org.
 * Used by the Plan page to show included/locked capabilities.
 */
orgCapRouter.get("/", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const correlationId = randomUUID();

    // Group capabilities by pack
    const packGroups = new Map<string | null, typeof BUSINESS_CAPABILITIES>();
    for (const cap of BUSINESS_CAPABILITIES.filter(c => c.status === "active")) {
      const key = cap.packCode;
      if (!packGroups.has(key)) packGroups.set(key, []);
      packGroups.get(key)!.push(cap);
    }

    // For each capability, evaluate access at each level
    const result: Array<{
      packCode: string | null;
      packDisplayName: string;
      capabilities: Array<{
        code: string;
        displayName: string;
        description: string;
        category: string;
        informationAccess: { allowed: boolean; reasonCode: string };
        analysisAccess: { allowed: boolean; partial: boolean; reasonCode: string } | null;
        executionAccess: { allowed: boolean; partial: boolean; reasonCode: string } | null;
      }>;
    }> = [];

    for (const [packCode, caps] of packGroups) {
      const packResult: (typeof result)[0] = {
        packCode,
        packDisplayName: packCode ? packDisplayNameFn(packCode) + " Workforce Pack" : "Core",
        capabilities: [],
      };

      for (const cap of caps.slice(0, 20)) { // cap at 20 per pack for perf
        const [infoDecision, analysisDecision, execDecision] = await Promise.all([
          cap.informationAllowed
            ? decideCapabilityAccess(ctx.tenantId, user.id, cap.code, "general_information", { correlationId })
            : null,
          cap.analysisAllowed
            ? decideCapabilityAccess(ctx.tenantId, user.id, cap.code, "professional_analysis", { correlationId })
            : null,
          cap.executionAllowed
            ? decideCapabilityAccess(ctx.tenantId, user.id, cap.code, "execution", { correlationId })
            : null,
        ]);

        packResult.capabilities.push({
          code: cap.code,
          displayName: cap.displayName,
          description: cap.description,
          category: cap.category,
          informationAccess: {
            allowed: infoDecision?.allowed ?? false,
            reasonCode: infoDecision?.reasonCode ?? "level_not_supported",
          },
          analysisAccess: analysisDecision ? {
            allowed: analysisDecision.allowed,
            partial: analysisDecision.partiallyAllowed,
            reasonCode: analysisDecision.reasonCode,
          } : null,
          executionAccess: execDecision ? {
            allowed: execDecision.allowed,
            partial: execDecision.partiallyAllowed,
            reasonCode: execDecision.reasonCode,
          } : null,
        });
      }

      result.push(packResult);
    }

    res.json({ capabilityGroups: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /v1/organisations/:slug/capabilities/check
 *
 * Validates capability access for a specific code + level.
 * Used by the conversation UI before presenting task proposals.
 *
 * Body: { capabilityCode: string; requestedLevel: CapabilityLevel; conversationId?: string }
 */
orgCapRouter.post("/check", requireAuth, resolveTenantFromSlug, async (req, res, next) => {
  try {
    const user = req.appUser!;
    const ctx = req.tenantContext!;
    const { capabilityCode, requestedLevel, conversationId } = req.body as {
      capabilityCode?: string;
      requestedLevel?: string;
      conversationId?: string;
    };

    if (!capabilityCode || typeof capabilityCode !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "capabilityCode is required" } });
      return;
    }

    const validLevels: CapabilityLevel[] = ["general_information", "professional_analysis", "execution"];
    const level: CapabilityLevel = validLevels.includes(requestedLevel as CapabilityLevel)
      ? requestedLevel as CapabilityLevel
      : "professional_analysis";

    const decision = await decideCapabilityAccess(
      ctx.tenantId,
      user.id,
      capabilityCode,
      level,
      { conversationId, correlationId: randomUUID() },
    );

    res.json({ decision });
  } catch (err) {
    next(err);
  }
});

function packDisplayNameFn(packCode: string): string {
  const names: Record<string, string> = {
    compliance: "Compliance", finance: "Finance", hr: "HR",
    operations: "Operations", marketing: "Marketing", core: "Core",
  };
  return names[packCode] ?? packCode;
}

export { orgCapRouter };
