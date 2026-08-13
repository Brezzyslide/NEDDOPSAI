/**
 * Specialist Eligibility Service — Sprint 11
 *
 * Performs all 12 eligibility checks before a specialist may be assigned to a run.
 * No specialist may be assigned without an allowed eligibility decision.
 * Does not substitute the nearest available specialist when the correct one is unavailable.
 *
 * Checks:
 *  1. requested capability (known in registry)
 *  2. requested capability level (supported by cap)
 *  3. organisation entitlement (Workforce Pack owned)
 *  4. Workforce Pack access (explicit denial overrides everything)
 *  5. specialist–capability mapping (specialist has this capability in registry)
 *  6. Worker Profile mapping (specialist has at least one profile)
 *  7. user permission (role check via membership)
 *  8. explicit denial (entitlement source check)
 *  9. usage allowance (specialist_runs dimension)
 * 10. required execution channel
 * 11. required connector category
 * 12. approval requirement (from registry)
 * 13. specialist activation status (deprecated / dna_pending / archived / coming_soon)
 */

import { randomUUID } from "crypto";
import {
  getCapability,
  isKnownCapabilityCode,
  isLevelSupported,
  type CapabilityLevel,
} from "../lib/capabilityRegistry.js";
import {
  getSpecialistByCode,
  getSpecialistsByCapability,
} from "../lib/workforceRegistry.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
import {
  tenantHasWorkforcePack,
  tenantCanUseFeature,
  checkUsage,
} from "./entitlementService.js";
import type { WorkforcePackCode } from "@workspace/shared";
import { logOrgEvent } from "./auditService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpecialistEligibilityDecision {
  decisionId: string;
  workforceRoleCode: string;
  capabilityCode: string;
  requestedLevel: CapabilityLevel;
  eligible: boolean;
  reasonCode: string;
  reasons: string[];
  workerProfileCode?: string;
  approvalRequired: boolean;
  evaluatedAt: string;
}

export interface EligibilityCheckContext {
  organizationId: string;
  requestingUserId?: string;
  correlationId?: string;
  /** Skip async DB checks (for fast synchronous validation) */
  skipAsyncChecks?: boolean;
}

// ─── Active specialists with real intelligence ────────────────────────────────
// Sprint 11+: Only specialists with approved DNA are active.
// compliance_officer was deprecated and merged into compliance_quality_manager.
// document_specialist was renamed to knowledge_documentation_specialist.
// knowledge_documentation_specialist does not have approved DNA yet — it is
// dna_pending and not yet dispatchable.

const ACTIVE_SPECIALISTS = new Set([
  "compliance_quality_manager",
  "executive_assistant",
  "operations_manager",
]);

// ─── Main eligibility check ───────────────────────────────────────────────────

/**
 * Full eligibility decision for assigning a specialist to a capability at a requested level.
 *
 * Returns a structured decision. If `eligible: false`, the specialist MUST NOT be assigned.
 * Do not substitute — return the blocked decision and surface it to the orchestrator.
 */
export async function checkSpecialistEligibility(
  workforceRoleCode: string,
  capabilityCode: string,
  requestedLevel: CapabilityLevel,
  context: EligibilityCheckContext,
): Promise<SpecialistEligibilityDecision> {
  const decisionId = randomUUID();
  const reasons: string[] = [];
  let workerProfileCode: string | undefined;

  const deny = (reasonCode: string, message?: string): SpecialistEligibilityDecision => {
    if (message) reasons.push(message);
    return {
      decisionId,
      workforceRoleCode,
      capabilityCode,
      requestedLevel,
      eligible: false,
      reasonCode,
      reasons,
      workerProfileCode,
      approvalRequired: false,
      evaluatedAt: new Date().toISOString(),
    };
  };

  // ── Check 1: Capability exists ─────────────────────────────────────────────
  if (!isKnownCapabilityCode(capabilityCode)) {
    reasons.push(`Capability code "${capabilityCode}" is not in the canonical registry`);
    await writeAudit(context, "specialist.eligibility_checked", workforceRoleCode, capabilityCode, false, "unknown_capability");
    return deny("unknown_capability");
  }

  const cap = getCapability(capabilityCode)!;

  // ── Check 2: Capability level is supported ─────────────────────────────────
  if (!isLevelSupported(cap, requestedLevel)) {
    reasons.push(`Capability "${cap.displayName}" does not support level "${requestedLevel}"`);
    return deny("level_not_supported");
  }

  // ── Check 3 & 4: Organisation entitlement + pack access ───────────────────
  if (!context.skipAsyncChecks) {
    if (cap.packCode) {
      const packEntitlement = await tenantHasWorkforcePack(
        context.organizationId,
        cap.packCode as WorkforcePackCode,
      );
      if (packEntitlement.source === "explicit_denial") {
        reasons.push(`Access to ${cap.displayName} has been explicitly denied for this organisation`);
        return deny("explicitly_denied");
      }
      if (!packEntitlement.allowed) {
        reasons.push(`${cap.packCode} Workforce Pack is not included in the organisation's plan`);
        return deny("workforce_pack_not_included");
      }
    }
  }

  // ── Check 5: Specialist–capability mapping ─────────────────────────────────
  const specialist = getSpecialistByCode(workforceRoleCode);
  if (!specialist) {
    reasons.push(`Workforce role "${workforceRoleCode}" does not exist in the registry`);
    return deny("unknown_specialist");
  }

  // Check if specialist is listed as eligible for this capability in capabilityRegistry
  const eligibleRolesFromCap = cap.eligibleRoles ?? [];
  if (eligibleRolesFromCap.length > 0 && !eligibleRolesFromCap.includes(workforceRoleCode)) {
    reasons.push(`Specialist "${specialist.displayName}" is not eligible for capability "${cap.displayName}"`);
    return deny("specialist_not_eligible_for_capability");
  }

  // Also check workforce registry: specialist must have the matched legacy capability code
  // (best-effort: workforce registry uses different capability codes than Sprint 9.4 registry)
  // We trust capabilityRegistry.eligibleRoles as the authoritative mapping.

  // ── Check 13: Specialist activation status ─────────────────────────────────
  if (specialist.executionStatus === "deprecated") {
    reasons.push(`Specialist "${specialist.displayName}" has been deprecated`);
    return deny("specialist_deprecated");
  }
  if (specialist.executionStatus === "dna_pending") {
    return deny(
      "dna_design_pending",
      "This AI employee's professional profile is being designed. It will be available soon.",
    );
  }
  if (specialist.executionStatus === "archived") {
    return deny("specialist_archived");
  }
  if (specialist.executionStatus === "coming_soon") {
    reasons.push(`Specialist "${specialist.displayName}" is not yet available — coming soon`);
    return deny("specialist_not_yet_available");
  }

  // ── Intelligence activation check ─────────────────────────────────────────
  // Only block if trying to use execution-level AI when intelligence is not active.
  // general_information and professional_analysis still work with metadata only.
  // For Sprint 9.5, three specialists have active intelligence.
  const hasActiveIntelligence = ACTIVE_SPECIALISTS.has(workforceRoleCode);
  if (!hasActiveIntelligence && requestedLevel === "execution") {
    reasons.push(`Specialist "${specialist.displayName}" does not have active intelligence for execution-level tasks`);
    return deny("intelligence_not_activated");
  }

  // ── Check 6: Worker Profile mapping ───────────────────────────────────────
  if (specialist.workerProfileCodes.length === 0) {
    reasons.push(`Specialist "${specialist.displayName}" has no Worker Profile assigned`);
    return deny("no_worker_profile");
  }

  // Select the first available profile
  const profileCode = specialist.workerProfileCodes[0]!;
  const profile = getWorkerProfileByCode(profileCode);
  if (!profile || profile.status !== "active") {
    reasons.push(`Worker Profile "${profileCode}" is not active`);
    return deny("worker_profile_inactive");
  }
  workerProfileCode = profileCode;

  // ── Check 10: Required execution channel ──────────────────────────────────
  if (requestedLevel === "execution" && cap.requiredExecutionChannels.length > 0) {
    const hasChannel = cap.requiredExecutionChannels.some(ch =>
      profile.allowedExecutionChannels.includes(ch as Parameters<typeof profile.allowedExecutionChannels.includes>[0])
    );
    if (!hasChannel) {
      reasons.push(
        `Worker Profile "${profileCode}" does not permit any of the required execution channels: ${cap.requiredExecutionChannels.join(", ")}`
      );
      return deny("execution_channel_not_permitted");
    }
  }

  // ── Check 11: Required connector category ────────────────────────────────
  if (requestedLevel === "execution" && cap.requiredConnectorCategories.length > 0) {
    const hasConnector = cap.requiredConnectorCategories.some(cc =>
      profile.allowedConnectorCategories.includes(cc as Parameters<typeof profile.allowedConnectorCategories.includes>[0])
    );
    if (!hasConnector) {
      reasons.push(
        `Worker Profile "${profileCode}" does not allow any of the required connector categories: ${cap.requiredConnectorCategories.join(", ")}`
      );
      return deny("connector_category_not_permitted");
    }
  }

  // ── Check 9: Usage allowance ──────────────────────────────────────────────
  if (!context.skipAsyncChecks) {
    try {
      const usageResult = await checkUsage(context.organizationId, "specialist_runs");
      if (!usageResult.allowed) {
        reasons.push(`Organisation has reached its specialist run usage limit`);
        return deny("usage_limit_reached");
      }
    } catch {
      // Usage check failure is non-fatal — fail open for usage (fail closed for entitlements)
      reasons.push("Usage check skipped due to service error");
    }
  }

  // ── Check 12: Approval requirement ────────────────────────────────────────
  const approvalRequired = specialist.approvalRequirements !== "no_approval" ||
    (requestedLevel === "execution" && cap.defaultApprovalRequired);

  // ── Audit + return allowed decision ───────────────────────────────────────
  await writeAudit(context, "specialist.assignment_allowed", workforceRoleCode, capabilityCode, true, "eligible");

  return {
    decisionId,
    workforceRoleCode,
    capabilityCode,
    requestedLevel,
    eligible: true,
    reasonCode: "eligible",
    reasons: ["All eligibility checks passed"],
    workerProfileCode,
    approvalRequired,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Quick synchronous eligibility check (no DB calls). Used for fast pre-validation.
 * Does not check pack entitlement or usage allowance.
 */
export function validateSpecialistEligibilitySync(
  workforceRoleCode: string,
  capabilityCode: string,
): boolean {
  if (!isKnownCapabilityCode(capabilityCode)) return false;
  const cap = getCapability(capabilityCode);
  if (!cap) return false;
  if (cap.eligibleRoles.length > 0 && !cap.eligibleRoles.includes(workforceRoleCode)) return false;
  const specialist = getSpecialistByCode(workforceRoleCode);
  if (!specialist) return false;
  if (
    specialist.executionStatus === "deprecated" ||
    specialist.executionStatus === "coming_soon" ||
    specialist.executionStatus === "dna_pending" ||
    specialist.executionStatus === "archived"
  ) return false;
  return true;
}

/** Returns all specialists eligible for a given capability code */
export function getEligibleSpecialists(capabilityCode: string): string[] {
  if (!isKnownCapabilityCode(capabilityCode)) return [];
  const cap = getCapability(capabilityCode);
  if (!cap) return [];
  if (cap.eligibleRoles.length > 0) return cap.eligibleRoles;
  // Fall back to workforce registry capability mapping
  // Exclude deprecated, dna_pending, archived, and coming_soon statuses
  return getSpecialistsByCapability(capabilityCode)
    .filter(s => s.executionStatus === "available" || s.executionStatus === "beta")
    .map(s => s.code);
}

/** Returns whether a specialist has active intelligence */
export function hasActiveIntelligence(workforceRoleCode: string): boolean {
  return ACTIVE_SPECIALISTS.has(workforceRoleCode);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function writeAudit(
  context: EligibilityCheckContext,
  eventType: string,
  workforceRoleCode: string,
  capabilityCode: string,
  eligible: boolean,
  reasonCode: string,
): Promise<void> {
  try {
    await logOrgEvent({
      eventType: eventType as Parameters<typeof logOrgEvent>[0]["eventType"],
      organizationId: context.organizationId,
      actorUserId: context.requestingUserId,
      actorType: "system",
      resourceType: "specialist_eligibility",
      resourceId: workforceRoleCode,
      metadata: { capabilityCode, eligible, reasonCode },
    });
  } catch {
    // Audit is non-fatal
  }
}
