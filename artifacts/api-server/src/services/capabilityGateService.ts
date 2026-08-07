/**
 * Capability Gate Service — Sprint 9.4
 *
 * Generates polite, commercially clear Chief of Staff responses when capability
 * access is blocked or partially blocked. Also builds structured conversation
 * cards for the UI (spec §14).
 *
 * Response rules (spec §8):
 *   - Never use hostile wording ("access denied", "payment required")
 *   - Always explain what IS available
 *   - Name the required Workforce Pack
 *   - Offer real upgrade options from commercial service
 *   - Never claim work started when it was blocked
 *   - Never invent a price
 */

import {
  getCapability,
  type CapabilityLevel,
} from "../lib/capabilityRegistry.js";
import type {
  CapabilityAccessDecision,
  MixedCapabilityDecision,
  UpgradeOption,
} from "./capabilityAccessDecisionService.js";
import type { StructuredContent } from "./conversationIntelligenceService.js";

// ─── Response generation ───────────────────────────────────────────────────────

/** Build a polite Chief of Staff text response for a fully blocked capability. */
export function buildBlockedCapabilityResponse(decision: CapabilityAccessDecision): string {
  const cap = getCapability(decision.capabilityCode);
  const capName = cap?.displayName ?? decision.capabilityCode;
  const packName = decision.requiredWorkforcePack
    ? `${packDisplayName(decision.requiredWorkforcePack)} Workforce Pack`
    : "a Workforce Pack that is not currently included in your organisation's plan";

  const levelDescription = levelDesc(decision.requestedLevel);

  const availableNow = buildAvailableNowText(decision);

  let response = `That request requires ${packName}.\n\n`;
  response += `To ${levelDescription} for **${capName}** using your organisation's records, the ${packName} is required.\n\n`;

  if (availableNow.length > 0) {
    response += `What I can help with now:\n${availableNow}\n\n`;
  }

  response += buildUpgradeText(decision.upgradeOptions, packName);

  return response.trim();
}

// Fix 29H.3 Defect 3: segment blocked capabilities by reasonCode so each group
// gets an accurate label rather than collapsing everything into "Requires upgrade".
// Commercial reasons (pack/subscription) → "Requires upgrade"
// Level mismatch       → "Not supported for this request type"
// Execution entitlement → "Requires execution entitlement"
// Explicit denial       → "Access restricted by your administrator"

const COMMERCIAL_REASON_CODES = new Set([
  "workforce_pack_not_included",
  "subscription_inactive",
  "capability_not_included",
  "usage_limit_reached",
]);

const LEVEL_REASON_CODES = new Set([
  "level_not_supported",
]);

const EXECUTION_REASON_CODES = new Set([
  "execution_not_included",
  "connector_not_eligible",
]);

const ADMIN_REASON_CODES = new Set([
  "explicitly_denied",
]);

function blockedLabel(reasonCode: string): string {
  if (LEVEL_REASON_CODES.has(reasonCode))      return "Not supported for this request type";
  if (EXECUTION_REASON_CODES.has(reasonCode))  return "Requires execution entitlement";
  if (ADMIN_REASON_CODES.has(reasonCode))      return "Access restricted by your administrator";
  return "Requires upgrade"; // commercial / subscription / unknown
}

function groupBlockedByLabel(decisions: CapabilityAccessDecision[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const d of decisions) {
    const label = blockedLabel(d.reasonCode);
    const cap = getCapability(d.capabilityCode);
    const name = cap?.displayName ?? d.capabilityCode;
    const existing = groups.get(label) ?? [];
    existing.push(name);
    groups.set(label, existing);
  }
  return groups;
}

/** Build a polite response for a partially blocked mixed-capability request. */
export function buildMixedCapabilityResponse(mixed: MixedCapabilityDecision): string {
  const allowed = mixed.allowedCapabilities.map(d => {
    const cap = getCapability(d.capabilityCode);
    return cap?.displayName ?? d.capabilityCode;
  });
  const partial = mixed.partialCapabilities.map(d => {
    const cap = getCapability(d.capabilityCode);
    const allowedAtLevel = d.allowedLevel ? ` (${levelDesc(d.allowedLevel)} only)` : "";
    return `${cap?.displayName ?? d.capabilityCode}${allowedAtLevel}`;
  });

  let response = "";

  if (!mixed.canProceedPartially && mixed.blockedCapabilities.length > 0) {
    response += `I'm unable to proceed with that request under the current plan.\n\n`;
    response += `The following capabilities are not included:\n`;
    response += mixed.blockedCapabilities.map(d => {
      const cap = getCapability(d.capabilityCode);
      return `- ${cap?.displayName ?? d.capabilityCode}`;
    }).join("\n") + "\n\n";
  } else if (mixed.blockedCapabilities.length > 0 || partial.length > 0) {
    response += `Part of this request is available, but some components have restrictions.\n\n`;
    if (allowed.length > 0) {
      response += `**Available now:**\n${allowed.map(a => `- ${a}`).join("\n")}\n\n`;
    }
    if (partial.length > 0) {
      response += `**Available with limitations:**\n${partial.map(p => `- ${p}`).join("\n")}\n\n`;
    }
    // Group blocked by accurate reason label
    const blockedGroups = groupBlockedByLabel(mixed.blockedCapabilities);
    for (const [label, names] of blockedGroups) {
      response += `**${label}:**\n${names.map(n => `- ${n}`).join("\n")}\n\n`;
    }
  }

  const packsNeeded = mixed.blockedPacksRequired;
  if (packsNeeded.length > 0) {
    const packNames = packsNeeded.map(p => packDisplayName(p) + " Workforce Pack").join(" and ");
    response += `To complete the full request, the ${packNames} would be required.\n\n`;
  }

  if (mixed.canProceedPartially && mixed.requiresUserConfirmationForPartialWork) {
    response += `Would you like me to continue with the parts that are available? Or I can explain what's needed to unlock the rest.`;
  }

  return response.trim();
}

/** Build a polite response for a general-info access (educational, no pack needed). */
export function buildGeneralInfoResponse(capabilityCode: string): string {
  const cap = getCapability(capabilityCode);
  if (!cap) return "";
  const packName = cap.packCode
    ? `${packDisplayName(cap.packCode)} Workforce Pack`
    : undefined;
  if (packName) {
    return `I can provide general information about **${cap.displayName}** at any time.\n\nTo access ${cap.displayName} using your organisation's specific records and data, the ${packName} is required.`;
  }
  return "";
}

// ─── Structured cards ─────────────────────────────────────────────────────────

/** Build a structured capability_blocked card for the conversation UI. */
export function buildCapabilityBlockedCard(
  decision: CapabilityAccessDecision,
  availableActions: Array<"general_guidance" | "view_plan" | "request_access" | "start_trial">,
): StructuredContent {
  const cap = getCapability(decision.capabilityCode);

  return {
    type: "capability_blocked",
    data: {
      capabilityCode: decision.capabilityCode,
      capabilityDisplayName: cap?.displayName ?? decision.capabilityCode,
      requestedWork: cap?.description ?? "Requested work",
      requestedLevel: decision.requestedLevel,
      currentAccess: decision.partiallyAllowed
        ? `General information only (${decision.allowedLevel})`
        : "Not included in current plan",
      availableNow: buildAvailableNowItems(decision),
      requiresUpgrade: buildRequiresUpgradeItems(decision),
      upgradeOptions: decision.upgradeOptions,
      requiredWorkforcePack: decision.requiredWorkforcePack
        ? packDisplayName(decision.requiredWorkforcePack) + " Workforce Pack"
        : undefined,
      availableActions,
      decisionId: decision.decisionId,
    },
  };
}

/** Build a mixed-capability partial access card. */
export function buildMixedCapabilityCard(
  mixed: MixedCapabilityDecision,
): StructuredContent {
  return {
    type: "capability_partial",
    data: {
      allowedCapabilities: mixed.allowedCapabilities.map(d => ({
        code: d.capabilityCode,
        name: getCapability(d.capabilityCode)?.displayName ?? d.capabilityCode,
        level: d.requestedLevel,
      })),
      blockedCapabilities: mixed.blockedCapabilities.map(d => ({
        code: d.capabilityCode,
        name: getCapability(d.capabilityCode)?.displayName ?? d.capabilityCode,
        level: d.requestedLevel,
        reasonCode: d.reasonCode,
        reasonLabel: blockedLabel(d.reasonCode),
        requiredPack: d.requiredWorkforcePack ? packDisplayName(d.requiredWorkforcePack) + " Workforce Pack" : undefined,
        upgradeOptions: d.upgradeOptions,
      })),
      partialCapabilities: mixed.partialCapabilities.map(d => ({
        code: d.capabilityCode,
        name: getCapability(d.capabilityCode)?.displayName ?? d.capabilityCode,
        allowedLevel: d.allowedLevel,
        requestedLevel: d.requestedLevel,
        requiredPack: d.requiredWorkforcePack ? packDisplayName(d.requiredWorkforcePack) + " Workforce Pack" : undefined,
        upgradeOptions: d.upgradeOptions,
      })),
      canProceedPartially: mixed.canProceedPartially,
      requiresConfirmation: mixed.requiresUserConfirmationForPartialWork,
      blockedPacksRequired: mixed.blockedPacksRequired.map(p => ({
        code: p,
        name: packDisplayName(p) + " Workforce Pack",
      })),
    },
  };
}

// ─── Analytics event helpers ──────────────────────────────────────────────────

export function buildCapabilityAnalyticsEvent(
  decision: CapabilityAccessDecision,
  upgradeOptionSelected?: string,
): Record<string, unknown> {
  return {
    capabilityCode: decision.capabilityCode,
    requestedLevel: decision.requestedLevel,
    decision: decision.allowed ? "allowed" : decision.partiallyAllowed ? "partially_allowed" : "blocked",
    reasonCode: decision.reasonCode,
    requiredWorkforcePack: decision.requiredWorkforcePack,
    upgradePromptShown: !decision.allowed,
    upgradeOptionSelected: upgradeOptionSelected ?? null,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function levelDesc(level: CapabilityLevel): string {
  if (level === "general_information") return "get general information";
  if (level === "professional_analysis") return "run professional analysis";
  if (level === "execution") return "execute this work";
  return level;
}

function packDisplayName(packCode: string): string {
  const names: Record<string, string> = {
    compliance: "Compliance", finance: "Finance", hr: "HR",
    operations: "Operations", marketing: "Marketing", core: "Core",
  };
  return names[packCode] ?? packCode;
}

function buildAvailableNowText(decision: CapabilityAccessDecision): string {
  const cap = getCapability(decision.capabilityCode);
  if (!cap) return "";
  const items: string[] = [];
  if (cap.informationAllowed) {
    items.push(`- Explain ${cap.displayName} at a general level`);
    items.push(`- Provide a process overview and documentation checklist`);
  }
  return items.join("\n");
}

function buildAvailableNowItems(decision: CapabilityAccessDecision): string[] {
  const cap = getCapability(decision.capabilityCode);
  if (!cap) return [];
  if (cap.informationAllowed) {
    return [
      `Explain the ${cap.displayName} process`,
      `Provide a documentation checklist`,
      `Answer general questions about ${cap.category.replace(/_/g, " ")} requirements`,
    ];
  }
  return [];
}

function buildRequiresUpgradeItems(decision: CapabilityAccessDecision): string[] {
  const cap = getCapability(decision.capabilityCode);
  if (!cap) return [];
  const items: string[] = [];
  if (cap.analysisAllowed && decision.requestedLevel !== "general_information") {
    items.push(`Analyse your organisation's ${cap.displayName.toLowerCase()} records`);
  }
  if (cap.executionAllowed) {
    items.push(`${cap.displayName} — execution and submission`);
    if (cap.requiredConnectorCategories.length > 0) {
      items.push(`Connection to ${cap.requiredConnectorCategories.join(", ")} systems`);
    }
  }
  return items;
}

function buildUpgradeText(options: UpgradeOption[], packName: string): string {
  if (options.length === 0) {
    return `To proceed with the full request, please contact NeedsOps to discuss the available Workforce Pack options.`;
  }
  const lines = options.map(o => {
    if (o.contactSalesRequired) return `- **${o.displayName}**: Contact NeedsOps to discuss access`;
    return `- **${o.displayName}**: View plan options to add this capability`;
  });
  return `To unlock the full capability:\n${lines.join("\n")}`;
}
