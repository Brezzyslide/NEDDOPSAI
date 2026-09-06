/**
 * Capability Access Decision Service — Sprint 9.4
 *
 * Deterministically decides whether an organisation may perform work at a
 * given capability level. Uses the existing entitlement layer (entitlementService.ts)
 * and the canonical capability registry.
 *
 * Security rules (spec §20):
 *   - Explicit denial always overrides plan access
 *   - LLM output has NO authority over access decisions
 *   - All access decisions are server-side only
 *   - Invented capability codes are rejected before reaching here
 *   - Tenant isolation: all queries are scoped to organizationId
 *
 * No Stripe calls. No billing. Uses NeedsOps internal tables only.
 */

import { randomUUID } from "crypto";
import { db, withSystemTenantContext } from "@workspace/db";
import {
  capabilityDecisionsTable,
  orgAuditLogTable,
} from "@workspace/db";
import {
  tenantHasWorkforcePack,
  tenantCanUseFeature,
} from "./entitlementService.js";
import {
  getCapability,
  isKnownCapabilityCode,
  isLevelSupported,
  type BusinessCapability,
  type CapabilityLevel,
} from "../lib/capabilityRegistry.js";
import type {
  CapabilityIdentificationResult,
} from "./capabilityIdentificationService.js";
import type { WorkforcePackCode } from "@workspace/shared";

type DbClient = typeof db;

function withCapabilityTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "capability_access_decision_service", purpose },
    fn,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type CapabilityReasonCode =
  | "included_in_plan"
  | "workforce_pack_included"
  | "tenant_override"
  | "trial_access"
  | "general_information_allowed"
  | "workforce_pack_not_included"
  | "capability_not_included"
  | "execution_not_included"
  | "connector_not_eligible"
  | "usage_limit_reached"
  | "subscription_inactive"
  | "explicitly_denied"
  | "unknown_capability"
  | "level_not_supported";

export interface UpgradeOption {
  type: "workforce_pack" | "plan_upgrade" | "capability_addon" | "execution_addon" | "connector_addon" | "trial";
  code: string;
  displayName: string;
  description: string;
  available: boolean;
  contactSalesRequired: boolean;
}

export interface CapabilityAccessDecision {
  capabilityCode: string;
  requestedLevel: CapabilityLevel;
  /** Full access granted */
  allowed: boolean;
  /** Partially allowed (e.g. general_information only when analysis was requested) */
  partiallyAllowed: boolean;
  /** The level that IS allowed (if partiallyAllowed) */
  allowedLevel?: CapabilityLevel;
  /** The level that is blocked */
  deniedLevel?: CapabilityLevel;
  reasonCode: CapabilityReasonCode;
  source: string;
  requiredWorkforcePack?: string;
  requiredPlanFeature?: string;
  upgradeOptions: UpgradeOption[];
  /** Decision record ID (for audit trail / specialist run linkage) */
  decisionId: string;
}

export interface MixedCapabilityDecision {
  allowedCapabilities: CapabilityAccessDecision[];
  blockedCapabilities: CapabilityAccessDecision[];
  partialCapabilities: CapabilityAccessDecision[];
  canProceedPartially: boolean;
  requiresUserConfirmationForPartialWork: boolean;
  hasFullAccess: boolean;
  blockedPacksRequired: string[];
}

// ─── Main decision entry point ────────────────────────────────────────────────

export async function decideCapabilityAccess(
  organizationId: string,
  userId: string,
  capabilityCode: string,
  requestedLevel: CapabilityLevel,
  context: {
    conversationId?: string;
    taskId?: string;
    specialistRunId?: string;
    correlationId?: string;
  },
): Promise<CapabilityAccessDecision> {
  const decisionId = randomUUID();
  const correlationId = context.correlationId ?? randomUUID();

  // 1. Validate capability code against registry (reject invented codes)
  if (!isKnownCapabilityCode(capabilityCode)) {
    const decision = makeDenied(decisionId, capabilityCode, requestedLevel, "unknown_capability",
      "Capability not found in canonical registry", []);
    await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "blocked", decision, context, correlationId);
    await writeAuditEvent(organizationId, userId, "capability.validation_failed",
      { capabilityCode, reason: "unknown_capability" });
    return decision;
  }

  const cap = getCapability(capabilityCode)!;

  // 2. Check that the requested level is supported by this capability
  if (!isLevelSupported(cap, requestedLevel)) {
    const decision = makeDenied(decisionId, capabilityCode, requestedLevel, "level_not_supported",
      `${cap.displayName} does not support ${requestedLevel} level`, []);
    await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "blocked", decision, context, correlationId);
    return decision;
  }

  // 3. General information is always available when cap.informationAllowed is true
  if (requestedLevel === "general_information" && cap.informationAllowed) {
    const decision = makeAllowed(decisionId, capabilityCode, requestedLevel,
      "general_information_allowed", "General information access — no pack required");
    await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "allowed", decision, context, correlationId);
    await writeAuditEvent(organizationId, userId, "capability.access_allowed",
      { capabilityCode, level: requestedLevel, reasonCode: "general_information_allowed" });
    return decision;
  }

  // 4. Core capabilities (no pack) — always allowed
  if (!cap.packCode) {
    const decision = makeAllowed(decisionId, capabilityCode, requestedLevel,
      "included_in_plan", "Core capability — available on all plans");
    await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "allowed", decision, context, correlationId);
    await writeAuditEvent(organizationId, userId, "capability.access_allowed",
      { capabilityCode, level: requestedLevel, reasonCode: "included_in_plan" });
    return decision;
  }

  // 5. Pack-required capability — check entitlements
  try {
    // a) Check explicit denial (highest precedence)
    const packFeatureCode = `workforce_pack.${cap.packCode}`;
    const packEntitlement = await tenantCanUseFeature(
      organizationId,
      packFeatureCode as Parameters<typeof tenantCanUseFeature>[1],
    );

    if (!packEntitlement.allowed && packEntitlement.source === "explicit_denial") {
      const decision = makeDenied(decisionId, capabilityCode, requestedLevel, "explicitly_denied",
        packEntitlement.reason ?? `Access to ${cap.displayName} has been explicitly denied`,
        buildPackUpgradeOptions(cap), cap.packCode);
      await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "blocked", decision, context, correlationId);
      await writeAuditEvent(organizationId, userId, "capability.access_blocked",
        { capabilityCode, level: requestedLevel, reason: "explicitly_denied" });
      return decision;
    }

    // b) Check pack access
    const packResult = await tenantHasWorkforcePack(organizationId, cap.packCode as WorkforcePackCode);

    if (!packResult.allowed) {
      // Offer partial at general_information level if informationAllowed
      if (cap.informationAllowed && requestedLevel !== "general_information") {
        const decision = makePartial(decisionId, capabilityCode, requestedLevel,
          "workforce_pack_not_included",
          `${packDisplayName(cap.packCode)} Workforce Pack is not included in the current plan`,
          "general_information", requestedLevel, buildPackUpgradeOptions(cap), cap.packCode);
        await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "partially_allowed", decision, context, correlationId);
        await writeAuditEvent(organizationId, userId, "capability.access_partially_allowed",
          { capabilityCode, level: requestedLevel, allowedLevel: "general_information" });
        return decision;
      }

      const decision = makeDenied(decisionId, capabilityCode, requestedLevel,
        "workforce_pack_not_included",
        `${packDisplayName(cap.packCode)} Workforce Pack is not included in the current plan`,
        buildPackUpgradeOptions(cap), cap.packCode);
      await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "blocked", decision, context, correlationId);
      await writeAuditEvent(organizationId, userId, "capability.access_blocked",
        { capabilityCode, level: requestedLevel, reason: "workforce_pack_not_included" });
      return decision;
    }

    // c) Pack is owned — check execution-specific requirements
    if (requestedLevel === "execution" && cap.executionAllowed) {
      // Check execution.professional_work first (Cloud UEE gate).
      // Fall back to legacy execution.openclaw_runtime for backwards compatibility.
      let execResult = await tenantCanUseFeature(
        organizationId,
        "execution.professional_work" as Parameters<typeof tenantCanUseFeature>[1],
      );
      if (
        !execResult.allowed &&
        execResult.source !== "no_subscription" &&
        execResult.source !== "subscription_inactive" &&
        execResult.source !== "explicit_denial"
      ) {
        const legacyExecCheck = await tenantCanUseFeature(
          organizationId,
          "execution.openclaw_runtime" as Parameters<typeof tenantCanUseFeature>[1],
        );
        if (legacyExecCheck.allowed) execResult = legacyExecCheck;
      }

      if (!execResult.allowed) {
        // Offer partial at professional_analysis if supported
        if (cap.analysisAllowed) {
          const decision = makePartial(decisionId, capabilityCode, requestedLevel,
            "execution_not_included",
            "Execution capability requires the OpenClaw runtime entitlement",
            "professional_analysis", requestedLevel, buildExecutionUpgradeOptions(), cap.packCode);
          await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "partially_allowed", decision, context, correlationId);
          await writeAuditEvent(organizationId, userId, "capability.access_partially_allowed",
            { capabilityCode, level: requestedLevel, allowedLevel: "professional_analysis" });
          return decision;
        }

        const decision = makeDenied(decisionId, capabilityCode, requestedLevel,
          "execution_not_included",
          "Execution capability requires the OpenClaw runtime entitlement",
          buildExecutionUpgradeOptions(), cap.packCode);
        await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "blocked", decision, context, correlationId);
        await writeAuditEvent(organizationId, userId, "capability.access_blocked",
          { capabilityCode, level: requestedLevel, reason: "execution_not_included" });
        return decision;
      }
    }

    // d) Pack owned + all level checks passed → allow
    const sourceLabel = packResult.source === "subscription" || packResult.source === "addon" ? "workforce_pack_included"
      : packResult.source === "override" ? "tenant_override"
      : packResult.source === "trial" ? "trial_access"
      : "workforce_pack_included";

    const decision = makeAllowed(decisionId, capabilityCode, requestedLevel,
      sourceLabel as CapabilityReasonCode,
      `${packDisplayName(cap.packCode)} Workforce Pack grants access to ${cap.displayName}`);
    await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "allowed", decision, context, correlationId);
    await writeAuditEvent(organizationId, userId, "capability.access_allowed",
      { capabilityCode, level: requestedLevel, reasonCode: sourceLabel });
    return decision;

  } catch (err) {
    // Fail-closed: entitlement service error → deny
    console.error("[CapabilityAccess] Entitlement check error, failing closed:", err);
    const decision = makeDenied(decisionId, capabilityCode, requestedLevel,
      "subscription_inactive",
      "Entitlement check failed — access denied by fail-closed policy", []);
    await persistDecision(organizationId, userId, capabilityCode, requestedLevel, "blocked", decision, context, correlationId);
    return decision;
  }
}

// ─── Mixed-capability decision ────────────────────────────────────────────────

export async function decideMixedCapabilityAccess(
  organizationId: string,
  userId: string,
  identificationResult: CapabilityIdentificationResult,
  context: {
    conversationId?: string;
    taskId?: string;
    correlationId?: string;
  },
): Promise<MixedCapabilityDecision> {
  const correlationId = context.correlationId ?? randomUUID();

  const decisions = await Promise.all(
    identificationResult.requestedCapabilities.map(rc =>
      decideCapabilityAccess(organizationId, userId, rc.capabilityCode, rc.requestedLevel,
        { ...context, correlationId })
    )
  );

  const allowed = decisions.filter(d => d.allowed);
  const partial = decisions.filter(d => !d.allowed && d.partiallyAllowed);
  const blocked = decisions.filter(d => !d.allowed && !d.partiallyAllowed);

  // Required capabilities: those the identification marked as required
  const requiredCodes = new Set(
    identificationResult.requestedCapabilities.filter(c => c.required).map(c => c.capabilityCode)
  );
  // Material partial = a required capability is blocked OR only partially available.
  // Both cases require user confirmation before proceeding with incomplete work.
  const requiredNotFullyAllowed = [...blocked, ...partial].filter(d => requiredCodes.has(d.capabilityCode));
  const materialPartBlocked = requiredNotFullyAllowed.length > 0;

  const blockedPacksRequired = [
    ...new Set(
      [...blocked, ...partial]
        .filter(d => d.requiredWorkforcePack)
        .map(d => d.requiredWorkforcePack!)
    ),
  ];

  return {
    allowedCapabilities: allowed,
    blockedCapabilities: blocked,
    partialCapabilities: partial,
    canProceedPartially: allowed.length > 0 || partial.length > 0,
    requiresUserConfirmationForPartialWork: materialPartBlocked,
    hasFullAccess: blocked.length === 0 && partial.length === 0,
    blockedPacksRequired,
  };
}

// ─── Guard helpers (for task creation, specialist routing, OpenClaw) ──────────

/** Validate that a specialist role is eligible for the given capability code. */
export function validateSpecialistEligibility(
  specialistCode: string,
  capabilityCode: string,
): boolean {
  const cap = getCapability(capabilityCode);
  if (!cap) return false;
  return cap.eligibleRoles.includes(specialistCode);
}

/** Check a list of capability codes against the registry — reject any unknown. */
export function validateCapabilityCodes(codes: string[]): {
  valid: string[];
  invalid: string[];
} {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const code of codes) {
    if (isKnownCapabilityCode(code)) valid.push(code);
    else invalid.push(code);
  }
  return { valid, invalid };
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function makeAllowed(
  id: string,
  code: string,
  level: CapabilityLevel,
  reasonCode: CapabilityReasonCode,
  source: string,
): CapabilityAccessDecision {
  return { decisionId: id, capabilityCode: code, requestedLevel: level, allowed: true, partiallyAllowed: false, reasonCode, source, upgradeOptions: [] };
}

function makeDenied(
  id: string,
  code: string,
  level: CapabilityLevel,
  reasonCode: CapabilityReasonCode,
  source: string,
  upgradeOptions: UpgradeOption[],
  requiredWorkforcePack?: string,
): CapabilityAccessDecision {
  return { decisionId: id, capabilityCode: code, requestedLevel: level, allowed: false, partiallyAllowed: false, reasonCode, source, upgradeOptions, requiredWorkforcePack };
}

function makePartial(
  id: string,
  code: string,
  requestedLevel: CapabilityLevel,
  reasonCode: CapabilityReasonCode,
  source: string,
  allowedLevel: CapabilityLevel,
  deniedLevel: CapabilityLevel,
  upgradeOptions: UpgradeOption[],
  requiredWorkforcePack?: string,
): CapabilityAccessDecision {
  return { decisionId: id, capabilityCode: code, requestedLevel, allowed: false, partiallyAllowed: true, allowedLevel, deniedLevel, reasonCode, source, upgradeOptions, requiredWorkforcePack };
}

function buildPackUpgradeOptions(cap: BusinessCapability): UpgradeOption[] {
  if (!cap.packCode) return [];
  return [{
    type: "workforce_pack",
    code: cap.packCode,
    displayName: `${packDisplayName(cap.packCode)} Workforce Pack`,
    description: `Unlocks ${cap.displayName} and all ${packDisplayName(cap.packCode)} capabilities`,
    available: true,
    contactSalesRequired: false,
  }];
}

function buildExecutionUpgradeOptions(): UpgradeOption[] {
  return [{
    type: "execution_addon",
    code: "openclaw_runtime",
    displayName: "OpenClaw Runtime",
    description: "Enables AI workforce to execute actions in connected systems",
    available: true,
    contactSalesRequired: true,
  }];
}

function packDisplayName(packCode: string): string {
  const names: Record<string, string> = {
    compliance: "Compliance", finance: "Finance", hr: "HR",
    operations: "Operations", marketing: "Marketing", core: "Core",
  };
  return names[packCode] ?? packCode;
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistDecision(
  organizationId: string,
  userId: string,
  capabilityCode: string,
  requestedLevel: CapabilityLevel,
  decision: "allowed" | "partially_allowed" | "blocked",
  decisionData: CapabilityAccessDecision,
  context: { conversationId?: string; taskId?: string; specialistRunId?: string },
  correlationId: string,
): Promise<void> {
  try {
    await withCapabilityTenant(organizationId, "capability_decision.persist", async (client) => {
      await client.insert(capabilityDecisionsTable).values({
      id: decisionData.decisionId,
      organizationId,
      userId,
      conversationId: context.conversationId ?? null,
      taskId: context.taskId ?? null,
      specialistRunId: context.specialistRunId ?? null,
      requestedCapabilityCode: capabilityCode,
      requestedLevel,
      decision,
      reasonCode: decisionData.reasonCode,
      source: decisionData.source,
      requiredWorkforcePack: decisionData.requiredWorkforcePack ?? null,
      upgradeOptions: decisionData.upgradeOptions,
      evaluatedAt: new Date(),
      expiresAt: null,
      correlationId,
    });
    });
  } catch { /* non-critical — do not break the request */ }
}

async function writeAuditEvent(
  orgId: string,
  userId: string,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    await withCapabilityTenant(orgId, "capability_decision.audit", async (client) => {
      await client.insert(orgAuditLogTable).values({
      id: randomUUID(),
      organizationId: orgId,
      actorUserId: userId,
      actorType: "system",
      eventType,
      resourceType: "capability_decision",
      resourceId: (metadata.capabilityCode as string) ?? "unknown",
      isSensitive: false,
      metadata,
      occurredAt: new Date(),
    });
    });
  } catch { /* non-critical */ }
}
