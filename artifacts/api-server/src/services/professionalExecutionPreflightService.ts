import {
  derivePlaceholderTokensFromTemplateField,
  type ProfessionalExecutionContext,
} from "./professionalExecutionContextService.js";
import type { DeliverableRequirementCoverageProfile, RequirementToDeliverablePlanItem } from "./deliverableRequirementCoverageService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";

export interface ProfessionalExecutionPreflightInput {
  blueprint: WorkBlueprint | null;
  manifest: WorkPackageManifest;
  professionalContext: ProfessionalExecutionContext;
  coverageProfile: DeliverableRequirementCoverageProfile;
  requirementPlan: RequirementToDeliverablePlanItem[];
  schemaCheck: { passed: boolean; missingRequirementIds: string[] };
}

export interface ProfessionalExecutionPreflightResult {
  passed: boolean;
  failedChecks: string[];
  requirementPlanStatus: "RESOLVED" | "UNRESOLVED";
  details: Record<string, unknown>;
}

interface DeclaredFactualPlaceholderIssue {
  placeholder: string;
  blueprintCode: string | null;
}

export function validateProfessionalExecutionPreflight(
  input: ProfessionalExecutionPreflightInput,
): ProfessionalExecutionPreflightResult {
  const { blueprint, manifest, professionalContext, coverageProfile, requirementPlan, schemaCheck } = input;
  const failedChecks: string[] = [];
  const applicableRequirements = requirementPlan.filter((item) => item.applicability === "applicable");
  const primaryOwner = manifest.primarySpecialist || professionalContext.primarySpecialist;
  const isGenericDeliverable = professionalContext.deliverable.requestedDeliverableType === "PROFESSIONAL_DELIVERABLE";
  const declaredFactualPlaceholders = collectDeclaredFactualPlaceholders(input);
  const undeclaredFactualPlaceholders = declaredFactualPlaceholders.size === 0
    ? []
    : professionalContext.deliverable.allowedFactualPlaceholders
      .map(normalisePlaceholderToken)
      .filter((placeholder) => placeholder && !declaredFactualPlaceholders.has(placeholder))
      .map((placeholder) => ({
        placeholder,
        blueprintCode: blueprint?.code ?? null,
      }));

  if (!blueprint) failedChecks.push("BLUEPRINT_RESOLVED");
  if (!manifest.canonicalIntent) failedChecks.push("CAPABILITY_RESOLVED");
  if (!manifest.blueprintMode && !manifest.selectionMetadata?.blueprintMode) failedChecks.push("OPERATION_SUPPORTED");
  if (isGenericDeliverable) failedChecks.push("DELIVERABLE_RESOLVED");
  if (!primaryOwner || primaryOwner === "chief_of_staff") failedChecks.push("PROFESSIONAL_OWNER_RESOLVED");
  if (blueprint?.primarySpecialist && primaryOwner && primaryOwner !== blueprint.primarySpecialist && !(manifest.supportingSpecialists ?? []).includes(primaryOwner)) {
    failedChecks.push("WORKERPROFILE_VALID");
  }
  if (blueprint && professionalContext.blueprintCode && professionalContext.blueprintCode !== blueprint.code) {
    failedChecks.push("DOMAIN_CONSISTENT");
  }
  if (coverageProfile.requirements.length === 0 || applicableRequirements.length === 0) {
    failedChecks.push("REQUIREMENT_PLAN_RESOLVED");
  }
  if (!schemaCheck.passed) failedChecks.push("DELIVERABLE_SCHEMA_RESOLVED");
  if (undeclaredFactualPlaceholders.length > 0) failedChecks.push("FACTUAL_FIELDS_DOMAIN_VALID");

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    requirementPlanStatus: coverageProfile.requirements.length > 0 && applicableRequirements.length > 0 ? "RESOLVED" : "UNRESOLVED",
    details: {
      blueprintCode: blueprint?.code ?? null,
      canonicalIntent: manifest.canonicalIntent ?? null,
      blueprintMode: manifest.blueprintMode ?? manifest.selectionMetadata?.blueprintMode ?? null,
      deliverableType: professionalContext.deliverable.requestedDeliverableType,
      professionalDomain: professionalContext.professionalDomain,
      primaryOwner,
      blueprintPrimarySpecialist: blueprint?.primarySpecialist ?? null,
      requirementCount: coverageProfile.requirements.length,
      applicableRequirementCount: applicableRequirements.length,
      declaredFactualPlaceholderCount: declaredFactualPlaceholders.size,
      factualPlaceholderDeclarationCheckSkipped: declaredFactualPlaceholders.size === 0,
      undeclaredFactualPlaceholders,
    },
  };
}

function collectDeclaredFactualPlaceholders(input: ProfessionalExecutionPreflightInput): Set<string> {
  const declared = new Set<string>();

  for (const requirement of input.coverageProfile.requirements) {
    for (const field of requirement.templateFields ?? []) {
      addPlaceholdersFromDeclaredField(declared, field);
    }
  }

  const blueprintSections = (input.blueprint as unknown as { sections?: Array<{ fields?: string[]; templateFields?: string[] }> } | null)?.sections ?? [];
  for (const section of blueprintSections) {
    for (const field of [...(section.fields ?? []), ...(section.templateFields ?? [])]) {
      addPlaceholdersFromDeclaredField(declared, field);
    }
  }

  collectBracketPlaceholdersFromValue(input.blueprint?.deliverableContract ?? null, declared);
  return declared;
}

function addPlaceholdersFromDeclaredField(declared: Set<string>, field: string): void {
  for (const bracketToken of field.match(/\[[A-Z0-9_]+\]/gi) ?? []) {
    declared.add(normalisePlaceholderToken(bracketToken));
  }

  for (const token of derivePlaceholderTokensFromTemplateField(field)) {
    declared.add(normalisePlaceholderToken(token));
  }
}

function collectBracketPlaceholdersFromValue(value: unknown, declared: Set<string>): void {
  if (typeof value === "string") {
    for (const token of value.match(/\[[A-Z0-9_]+\]/gi) ?? []) {
      declared.add(normalisePlaceholderToken(token));
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectBracketPlaceholdersFromValue(item, declared);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectBracketPlaceholdersFromValue(item, declared);
  }
}

function normalisePlaceholderToken(value: string): string {
  const token = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  const canonical = token
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toUpperCase();
  return canonical ? `[${canonical}]` : "";
}

export function formatUndeclaredFactualPlaceholderDetails(details: Record<string, unknown>): string | null {
  const issues = details.undeclaredFactualPlaceholders;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const formatted = issues
    .filter(isDeclaredFactualPlaceholderIssue)
    .map((issue) => `${issue.placeholder} not declared by blueprint ${issue.blueprintCode ?? "unknown"}`);
  return formatted.length > 0 ? formatted.join("; ") : null;
}

function isDeclaredFactualPlaceholderIssue(issue: unknown): issue is DeclaredFactualPlaceholderIssue {
  if (!issue || typeof issue !== "object") return false;
  const candidate = issue as Partial<DeclaredFactualPlaceholderIssue>;
  return typeof candidate.placeholder === "string";
}
