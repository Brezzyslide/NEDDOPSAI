import {
  BLUEPRINT_REGISTRY,
  resolveRegistryCodeForNewWork,
  type RegistryEntry,
} from "./blueprintRegistry.js";

export const TRUE_REGISTRY_OPERATIONS = [
  "create",
  "review",
  "revise",
  "assess",
  "complete",
  "investigate",
  "compare",
  "tailor",
] as const;

export type RegistryOperation = typeof TRUE_REGISTRY_OPERATIONS[number];

export const TARGET_BLUEPRINT_DOMAINS = [
  "agreements_correspondence",
  "participant_support",
  "clinical_mealtime",
  "behaviour_restrictive_practice",
  "incidents_safeguarding",
  "risk_emergency",
  "governance_policy",
  "compliance_regulatory",
  "workforce",
  "finance",
  "operations_strategy",
] as const;

export type TargetBlueprintDomain = typeof TARGET_BLUEPRINT_DOMAINS[number];

export type BlueprintSpecificity = "template" | "participant_specific" | "both";

export interface BlueprintConfusionBoundary {
  code: string;
  boundary: string;
}

export interface RestructuredRegistryEntry {
  code: string;
  name: string;
  domain: TargetBlueprintDomain;
  originalDomain: string;
  purpose: string;
  choose_when: string[];
  do_not_choose_when: string[];
  commonly_confused_with: BlueprintConfusionBoundary[];
  operations: RegistryOperation[];
  scopes: string[];
  specificity: BlueprintSpecificity;
  authority_boundary: string;
  authority_boundary_source: "extracted" | "authored_review_required";
  originalSupportedModes: string[];
  operationScopeMapping: Array<{
    original: string;
    mappedTo: RegistryOperation | "scope";
    status: "true_operation" | "operation_synonym" | "scope";
  }>;
  classifierSelectable: boolean;
}

export interface ClausePreservationItem {
  code: string;
  clause: string;
  status: "PRESERVED VERBATIM" | "MISSING";
  targetLocation: "purpose" | "authority_boundary" | null;
}

const DOMAIN_COLLAPSE: Record<string, TargetBlueprintDomain> = {
  agreements: "agreements_correspondence",
  correspondence: "agreements_correspondence",
  care_plan: "participant_support",
  support_plan: "participant_support",
  support_strategy: "participant_support",
  transition_plan: "participant_support",
  goals_review: "participant_support",
  funding_review: "participant_support",
  periodic_summary: "participant_support",
  service_delivery: "participant_support",
  clinical_management: "clinical_mealtime",
  mealtime: "clinical_mealtime",
  behaviour_support: "behaviour_restrictive_practice",
  restrictive_practice: "behaviour_restrictive_practice",
  incident: "incidents_safeguarding",
  safeguarding: "incidents_safeguarding",
  complaints: "incidents_safeguarding",
  risk_assessment: "risk_emergency",
  emergency_assessment: "risk_emergency",
  emergency_plan: "risk_emergency",
  policy: "governance_policy",
  governance: "governance_policy",
  knowledge_documentation: "governance_policy",
  compliance: "compliance_regulatory",
  employment: "workforce",
  payroll_workforce_cost: "workforce",
  people_culture: "workforce",
  talent_learning: "workforce",
  workforce_compliance: "workforce",
  workforce_ops: "workforce",
  financial: "finance",
  financial_planning: "finance",
  operational_finance: "finance",
  operations: "operations_strategy",
  process_asset: "operations_strategy",
  quality_improvement: "operations_strategy",
  strategic: "operations_strategy",
  marketing_communications: "operations_strategy",
};

const TRUE_OPERATION_SET = new Set<string>(TRUE_REGISTRY_OPERATIONS);
const BOUNDARY_KEYWORDS =
  /\b(require|requires|remains|remain outside|does not|without|outside normal|credentialed|external authority|professional authority|not replace|approval)\b/i;

export function isClassifierSelectableRegistryEntry(entry: RegistryEntry): boolean {
  return resolveRegistryCodeForNewWork(entry.code) === entry.code;
}

export function getCollapsedBlueprintDomain(entry: RegistryEntry): TargetBlueprintDomain {
  return DOMAIN_COLLAPSE[entry.blueprintFamily] ?? "operations_strategy";
}

export function splitRegistryOperations(entry: RegistryEntry): Pick<RestructuredRegistryEntry, "operations" | "scopes" | "operationScopeMapping"> {
  const operations = new Set<RegistryOperation>();
  const scopes = new Set<string>();
  const operationScopeMapping: RestructuredRegistryEntry["operationScopeMapping"] = [];

  for (const rawMode of entry.supportedModes) {
    const mode = rawMode.trim().toLowerCase();
    const mapped = normaliseRegistryOperation(mode);
    if (mapped) {
      operations.add(mapped);
      operationScopeMapping.push({
        original: rawMode,
        mappedTo: mapped,
        status: TRUE_OPERATION_SET.has(mode) ? "true_operation" : "operation_synonym",
      });
      if (!TRUE_OPERATION_SET.has(mode) && !isOperationSynonymOnly(mode)) {
        scopes.add(mode);
      }
      continue;
    }

    scopes.add(mode);
    operationScopeMapping.push({
      original: rawMode,
      mappedTo: "scope",
      status: "scope",
    });
  }

  if (operations.size === 0) {
    operations.add(deriveOperationFromPurpose(entry));
  }

  return {
    operations: Array.from(operations).sort(sortOperations),
    scopes: Array.from(scopes).sort(),
    operationScopeMapping,
  };
}

export function extractAuthorityBoundaryClauses(entry: RegistryEntry): string[] {
  return splitClauses(entry.purpose).filter((clause) => BOUNDARY_KEYWORDS.test(clause));
}

export function getRestructuredRegistryEntry(entry: RegistryEntry): RestructuredRegistryEntry {
  const split = splitRegistryOperations(entry);
  const boundaryClauses = extractAuthorityBoundaryClauses(entry);
  const authorityBoundary = boundaryClauses.length > 0
    ? boundaryClauses.join(" ")
    : "[AUTHORED — REVIEW REQUIRED] This Blueprint does not decide matters outside its stated professional scope; escalate legal, clinical, credentialed, external-authority or approval decisions to the appropriate authorised owner.";

  return {
    code: entry.code,
    name: entry.title,
    domain: getCollapsedBlueprintDomain(entry),
    originalDomain: entry.blueprintFamily,
    purpose: entry.purpose,
    choose_when: buildChooseWhen(entry, split.operations),
    do_not_choose_when: buildDoNotChooseWhen(entry),
    commonly_confused_with: buildCommonlyConfusedWith(entry),
    operations: split.operations,
    scopes: split.scopes,
    specificity: deriveSpecificity(entry),
    authority_boundary: authorityBoundary,
    authority_boundary_source: boundaryClauses.length > 0 ? "extracted" : "authored_review_required",
    originalSupportedModes: [...entry.supportedModes],
    operationScopeMapping: split.operationScopeMapping,
    classifierSelectable: isClassifierSelectableRegistryEntry(entry),
  };
}

export function getRestructuredRegistryEntries(): RestructuredRegistryEntry[] {
  return BLUEPRINT_REGISTRY.map(getRestructuredRegistryEntry);
}

export function getClassifierRegistryEntries(): RestructuredRegistryEntry[] {
  return getRestructuredRegistryEntries().filter((entry) => entry.classifierSelectable);
}

export function auditPurposeClausePreservation(): ClausePreservationItem[] {
  return BLUEPRINT_REGISTRY.flatMap((entry) => {
    const target = getRestructuredRegistryEntry(entry);
    const targetText = `${target.purpose}\n${target.authority_boundary}`;
    return extractAuthorityBoundaryClauses(entry).map((clause) => {
      const inBoundary = target.authority_boundary.includes(clause);
      const inPurpose = target.purpose.includes(clause);
      return {
        code: entry.code,
        clause,
        status: targetText.includes(clause) ? "PRESERVED VERBATIM" : "MISSING",
        targetLocation: inBoundary ? "authority_boundary" : inPurpose ? "purpose" : null,
      };
    });
  });
}

export function registryDomainCounts(): Record<TargetBlueprintDomain, number> {
  const counts = Object.fromEntries(TARGET_BLUEPRINT_DOMAINS.map((domain) => [domain, 0])) as Record<TargetBlueprintDomain, number>;
  for (const entry of getRestructuredRegistryEntries()) {
    counts[entry.domain] += 1;
  }
  return counts;
}

export function registryOperationScopeReport(): Array<{
  code: string;
  originalSupportedModes: string[];
  operations: RegistryOperation[];
  scopes: string[];
  mapping: RestructuredRegistryEntry["operationScopeMapping"];
}> {
  return getRestructuredRegistryEntries().map((entry) => ({
    code: entry.code,
    originalSupportedModes: entry.originalSupportedModes,
    operations: entry.operations,
    scopes: entry.scopes,
    mapping: entry.operationScopeMapping,
  }));
}

function normaliseRegistryOperation(value: string): RegistryOperation | null {
  if (TRUE_OPERATION_SET.has(value)) return value as RegistryOperation;
  if (value === "update" || value === "policy_amendment" || value === "version_review") return "revise";
  if (value === "investigation") return "investigate";
  if (value === "comparison") return "compare";
  if (value === "assessment" || value.endsWith("_assessment")) return "assess";
  if (value === "analysis" || value.endsWith("_analysis")) return "assess";
  if (value.includes("readiness") || value.includes("review") || value.includes("monitoring")) return "review";
  if (value.includes("reconciliation") || value.includes("classification") || value.includes("calculation")) return "assess";
  if (value.includes("planning") || value.includes("strategy") || value.includes("framework")) return "create";
  if (value.includes("assembly") || value.includes("packaging") || value.includes("map")) return "create";
  if (value.includes("development") || value.includes("response") || value.includes("reporting")) return "create";
  return null;
}

function isOperationSynonymOnly(value: string): boolean {
  return value === "update" ||
    value === "investigation" ||
    value === "comparison" ||
    value === "assessment" ||
    value === "analysis";
}

function deriveOperationFromPurpose(entry: RegistryEntry): RegistryOperation {
  const text = `${entry.title}. ${entry.purpose}`.toLowerCase();
  if (/\b(compare|comparison|contrast)\b/.test(text)) return "compare";
  if (/\b(investigate|investigation)\b/.test(text)) return "investigate";
  if (/\b(review|check|reconcile|monitor|validate)\b/.test(text)) return "review";
  if (/\b(assess|assessment|analyse|analyze|evaluate|determine|identify)\b/.test(text)) return "assess";
  if (/\b(revise|update|amend|refresh)\b/.test(text)) return "revise";
  if (/\b(tailor|adapt|customise|customize)\b/.test(text)) return "tailor";
  if (/\b(complete|populate|fill)\b/.test(text)) return "complete";
  return "create";
}

function deriveSpecificity(entry: RegistryEntry): BlueprintSpecificity {
  const text = `${entry.title} ${entry.purpose} ${entry.primaryDeliverable} ${entry.outputTypes?.join(" ") ?? ""}`.toLowerCase();
  if (/\b(template|standard|reusable|framework|procedure|policy)\b/.test(text) && /\b(participant|individual|client|worker|staff)\b/.test(text)) {
    return "both";
  }
  if (/\b(template|standard|reusable|framework|procedure|policy)\b/.test(text)) return "template";
  if (/\b(participant|individual|client|worker|staff|employee)\b/.test(text)) return "participant_specific";
  return "both";
}

function buildChooseWhen(entry: RegistryEntry, operations: RegistryOperation[]): string[] {
  const action = operations.includes("review") || operations.includes("assess")
    ? "reviewing or assessing"
    : operations.includes("investigate")
      ? "investigating"
      : "creating";
  return [
    `[AUTHORED — REVIEW REQUIRED] The request is about ${action} ${entry.title.toLowerCase()}.`,
    `[AUTHORED — REVIEW REQUIRED] The requested work product matches: ${entry.primaryDeliverable}.`,
    `[AUTHORED — REVIEW REQUIRED] The user's language aligns with this purpose: ${entry.purpose}`,
  ];
}

function buildDoNotChooseWhen(entry: RegistryEntry): string[] {
  const prohibited = entry.deliverableContract?.prohibitedDeliverables ?? [];
  const extracted = prohibited.slice(0, 3).map((item) =>
    `[AUTHORED — REVIEW REQUIRED] The request is for ${item}; choose the Blueprint that owns that work product instead.`,
  );
  if (extracted.length > 0) return extracted;

  return [
    "[AUTHORED — REVIEW REQUIRED] The request asks for legal, clinical, credentialed, external-authority or final approval decisions rather than this professional work product.",
    "[AUTHORED — REVIEW REQUIRED] Another registry Blueprint states a more specific purpose, scope or evidence contract for the requested deliverable.",
  ];
}

function buildCommonlyConfusedWith(entry: RegistryEntry): BlueprintConfusionBoundary[] {
  return BLUEPRINT_REGISTRY
    .filter((candidate) => candidate.code !== entry.code)
    .filter((candidate) => getCollapsedBlueprintDomain(candidate) === getCollapsedBlueprintDomain(entry))
    .map((candidate) => ({
      candidate,
      score: lexicalOverlap(entry, candidate),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ candidate }) => ({
      code: candidate.code,
      boundary: `[AUTHORED — REVIEW REQUIRED] ${entry.code} is for ${entry.primaryDeliverable}; ${candidate.code} is for ${candidate.primaryDeliverable}. Choose the more specific requested deliverable and evidence contract.`,
    }));
}

function lexicalOverlap(left: RegistryEntry, right: RegistryEntry): number {
  const leftTokens = tokenSet(`${left.title} ${left.purpose} ${left.primaryDeliverable}`);
  const rightTokens = tokenSet(`${right.title} ${right.purpose} ${right.primaryDeliverable}`);
  let score = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) score += 1;
  }
  return score;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_ ]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3)
      .filter((token) => !["blueprint", "review", "assessment", "professional", "work", "product"].includes(token)),
  );
}

function splitClauses(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|;\s+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function sortOperations(left: RegistryOperation, right: RegistryOperation): number {
  return TRUE_REGISTRY_OPERATIONS.indexOf(left) - TRUE_REGISTRY_OPERATIONS.indexOf(right);
}
