import { createHash } from "crypto";
import type { BlueprintSection, WorkBlueprint } from "./workBlueprintService.js";

export const BLUEPRINT_CONTENT_HASH_ALGORITHM = "sha256";

export interface BlueprintContentHashInput {
  blueprint: Pick<
    WorkBlueprint,
    | "code"
    | "title"
    | "version"
    | "blueprintFamily"
    | "supportedModes"
    | "maturityState"
    | "ownerType"
    | "purpose"
    | "primaryDeliverable"
    | "deliverableContract"
    | "evidenceContract"
    | "permittedOrgOverrides"
    | "defaultTemplateId"
    | "templateRequired"
    | "allowedOrgTemplateOverride"
    | "templateVersionPolicy"
    | "objective"
    | "primarySpecialist"
    | "supportingSpecialists"
    | "requiredLibraryKnowledge"
    | "requiredEntityKnowledge"
    | "requiredMemories"
    | "requiredApprovals"
    | "validationRules"
    | "qualityRules"
    | "successCriteria"
    | "outputTypes"
    | "escalationRules"
    | "mandatoryCitations"
    | "isBuiltIn"
  >;
  sections: Array<Pick<
    BlueprintSection,
    | "sectionCode"
    | "title"
    | "description"
    | "instructions"
    | "sectionRole"
    | "fixedContent"
    | "fields"
    | "completionPrompt"
    | "required"
    | "minimumContentExpectation"
    | "evidenceRequirements"
    | "allowedSourceTypes"
    | "prohibitedAssumptions"
    | "validationRules"
    | "qualityCriteria"
    | "sortOrder"
  >>;
}

export function computeBlueprintContentHash(input: BlueprintContentHashInput): string {
  const canonical = canonicalJson({
    algorithm: BLUEPRINT_CONTENT_HASH_ALGORITHM,
    blueprint: {
      code: input.blueprint.code,
      title: input.blueprint.title,
      version: input.blueprint.version,
      blueprintFamily: input.blueprint.blueprintFamily,
      supportedModes: input.blueprint.supportedModes ?? [],
      maturityState: input.blueprint.maturityState,
      ownerType: input.blueprint.ownerType,
      purpose: input.blueprint.purpose,
      primaryDeliverable: input.blueprint.primaryDeliverable,
      deliverableContract: input.blueprint.deliverableContract,
      evidenceContract: input.blueprint.evidenceContract,
      permittedOrgOverrides: input.blueprint.permittedOrgOverrides ?? {},
      defaultTemplateId: input.blueprint.defaultTemplateId,
      templateRequired: input.blueprint.templateRequired,
      allowedOrgTemplateOverride: input.blueprint.allowedOrgTemplateOverride,
      templateVersionPolicy: input.blueprint.templateVersionPolicy,
      objective: input.blueprint.objective,
      primarySpecialist: input.blueprint.primarySpecialist,
      supportingSpecialists: input.blueprint.supportingSpecialists ?? [],
      requiredLibraryKnowledge: input.blueprint.requiredLibraryKnowledge ?? [],
      requiredEntityKnowledge: input.blueprint.requiredEntityKnowledge ?? {},
      requiredMemories: input.blueprint.requiredMemories ?? [],
      requiredApprovals: input.blueprint.requiredApprovals ?? {},
      validationRules: input.blueprint.validationRules ?? [],
      qualityRules: input.blueprint.qualityRules ?? [],
      successCriteria: input.blueprint.successCriteria ?? [],
      outputTypes: input.blueprint.outputTypes ?? [],
      escalationRules: input.blueprint.escalationRules ?? [],
      mandatoryCitations: input.blueprint.mandatoryCitations ?? [],
      isBuiltIn: input.blueprint.isBuiltIn,
    },
    sections: [...input.sections]
      .sort((a, b) => (a.sortOrder - b.sortOrder) || a.sectionCode.localeCompare(b.sectionCode))
      .map((section) => ({
        sectionCode: section.sectionCode,
        title: section.title,
        description: section.description,
        instructions: section.instructions,
        sectionRole: section.sectionRole,
        fixedContent: section.fixedContent ?? [],
        fields: section.fields ?? [],
        completionPrompt: section.completionPrompt,
        required: section.required,
        minimumContentExpectation: section.minimumContentExpectation,
        evidenceRequirements: section.evidenceRequirements ?? {},
        allowedSourceTypes: section.allowedSourceTypes ?? [],
        prohibitedAssumptions: section.prohibitedAssumptions ?? [],
        validationRules: section.validationRules ?? [],
        qualityCriteria: section.qualityCriteria ?? [],
        sortOrder: section.sortOrder,
      })),
  });

  return `${BLUEPRINT_CONTENT_HASH_ALGORITHM}:${createHash(BLUEPRINT_CONTENT_HASH_ALGORITHM).update(canonical, "utf8").digest("hex")}`;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, canonicalise(val)]),
  );
}
