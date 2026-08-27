import type { ProfessionalExecutionContext } from "./professionalExecutionContextService.js";
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

export function validateProfessionalExecutionPreflight(
  input: ProfessionalExecutionPreflightInput,
): ProfessionalExecutionPreflightResult {
  const { blueprint, manifest, professionalContext, coverageProfile, requirementPlan, schemaCheck } = input;
  const failedChecks: string[] = [];
  const applicableRequirements = requirementPlan.filter((item) => item.applicability === "applicable");
  const primaryOwner = manifest.primarySpecialist || professionalContext.primarySpecialist;
  const isGenericDeliverable = professionalContext.deliverable.requestedDeliverableType === "PROFESSIONAL_DELIVERABLE";
  const domainText = [
    professionalContext.deliverable.requestedDeliverableType,
    professionalContext.professionalDomain,
    blueprint?.blueprintFamily,
    blueprint?.code,
  ].filter(Boolean).join(" ").toLowerCase();
  const agreementLike = /service_agreement|service agreement|agreement/.test(domainText);
  const careLike = /care_plan|support_plan|care plan|support plan/.test(domainText);
  const disallowedPlaceholders = professionalContext.deliverable.allowedFactualPlaceholders.filter((placeholder) => {
    const value = placeholder.toUpperCase();
    const agreementPlaceholder = value.includes("PROVIDER_") ||
      value.includes("PARTICIPANT_") ||
      value.includes("NDIS_") ||
      value.includes("AGREEMENT_") ||
      value.includes("SUPPORT_") ||
      value.includes("PRICE");
    if (agreementLike) return false;
    if (careLike && value.includes("PARTICIPANT_")) return false;
    return agreementPlaceholder;
  });

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
  if (disallowedPlaceholders.length > 0) failedChecks.push("FACTUAL_FIELDS_DOMAIN_VALID");

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
      disallowedPlaceholders,
    },
  };
}
