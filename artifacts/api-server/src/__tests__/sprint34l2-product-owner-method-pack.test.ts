import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
import {
  validateBlueprintRuntimeCompletion,
  type BlueprintRuntimeValidationInput,
} from "../services/blueprintRuntimeValidationService.js";
import type {
  BlueprintExecutionContract,
  BlueprintSection,
  WorkBlueprint,
  WorkTemplate,
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-18T00:00:00Z");

const APPROVED_34L2_CODES = [
  "site_environmental_risk_assessment",
  "fire_risk_assessment",
  "disaster_emergency_management_plan",
  "behaviour_support_plan_review",
  "behaviour_trigger_analysis",
] as const;

function blueprintFromRegistry(code: string): WorkBlueprint {
  const entry = getRegistryEntry(code);
  if (!entry) throw new Error(`Missing registry entry: ${code}`);

  return {
    id: `bp-${code}`,
    organizationId: null,
    code: entry.code,
    title: entry.title,
    version: "1.0.0",
    blueprintFamily: entry.blueprintFamily,
    supportedModes: entry.supportedModes,
    maturityState: entry.maturityState,
    ownerType: entry.ownerType,
    purpose: entry.purpose,
    primaryDeliverable: entry.primaryDeliverable,
    deliverableContract: entry.deliverableContract ?? null,
    evidenceContract: entry.evidenceContract ?? null,
    permittedOrgOverrides: entry.permittedOrgOverrides ?? {},
    defaultTemplateId: entry.defaultTemplateId ?? null,
    templateRequired: entry.templateRequired ?? entry.deliverableContract?.templateRequired ?? false,
    allowedOrgTemplateOverride: entry.allowedOrgTemplateOverride ?? false,
    templateVersionPolicy: entry.templateVersionPolicy ?? "pin_at_execution",
    status: "published",
    objective: entry.purpose,
    primarySpecialist: entry.futureOwnerRoleCode ?? "owner_unresolved",
    supportingSpecialists: entry.supportingSpecialists ?? [],
    requiredLibraryKnowledge: entry.requiredLibraryKnowledge ?? [],
    requiredEntityKnowledge: entry.requiredEntityKnowledge ?? {},
    requiredMemories: [],
    requiredApprovals: entry.requiredApprovals ?? {},
    validationRules: entry.validationRules ?? [],
    qualityRules: entry.qualityRules ?? [],
    successCriteria: entry.successCriteria ?? [],
    outputTypes: entry.outputTypes ?? [entry.primaryDeliverable],
    escalationRules: entry.escalationRules ?? [],
    mandatoryCitations: entry.mandatoryCitations ?? [],
    isBuiltIn: true,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function sectionsFromRegistry(code: string): BlueprintSection[] {
  const entry = getRegistryEntry(code);
  if (!entry?.sections) return [];
  return entry.sections.map((section, index) => ({
    id: `section-${code}-${section.sectionCode}`,
    blueprintId: `bp-${code}`,
    sectionCode: section.sectionCode,
    title: section.title,
    description: section.description,
    instructions: section.instructions,
    required: section.required,
    minimumContentExpectation: section.minimumContentExpectation,
    evidenceRequirements: section.evidenceRequirements ?? {},
    allowedSourceTypes: section.allowedSourceTypes ?? [],
    prohibitedAssumptions: section.prohibitedAssumptions ?? [],
    validationRules: section.validationRules ?? [],
    qualityCriteria: section.qualityCriteria ?? [],
    sortOrder: section.sortOrder ?? index + 1,
    createdAt: NOW,
    updatedAt: NOW,
  }));
}

const template: WorkTemplate = {
  id: "tpl-34l2",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "method_pack_template",
  title: "Method Pack Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/method-pack.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: NOW,
  updatedAt: NOW,
};

function contractFor(code: string, templateOverride: WorkTemplate | null = template): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(code),
    sections: sectionsFromRegistry(code),
    template: templateOverride,
    mode: "review",
  };
}

function contentFor(code: string): string {
  return sectionsFromRegistry(code)
    .map((section) => `## ${section.sectionCode}\nThis approved method section is materially populated with current evidence, chronology, conflicts, authority boundaries, provenance, controls, approvals and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l2",
    organisationId: "org-34l2",
    resolvedAt: NOW,
    totalChunks: categories.length,
    chunks: categories.map((category, index) => ({
      chunkId: `chunk-${index}`,
      sourceId: `source-${index}`,
      sourceVersionId: `source-version-${index}`,
      versionLabel: "current",
      authorityLevel: "approved",
      sourceTitle: category,
      sourceType: category,
      category,
      sectionTitle: category,
      pageNumber: null,
      text: `${category} evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "approved product owner professional method pack",
      selectedSourceIds: categories,
      selectedChunkIds: categories,
      selectedMemoryIds: [],
      selectedTaskUploadIds: [],
      retrievalMethod: "deterministic",
      ranking: [],
      tokenEstimate: 80,
      durationMs: 1,
    },
  };
}

function approvalsFor(code: string, approved = true): Record<string, boolean> {
  return Object.fromEntries(
    Object.keys(blueprintFromRegistry(code).requiredApprovals ?? {}).map((approval) => [approval, approved]),
  );
}

function validate(code: string, overrides: Partial<BlueprintRuntimeValidationInput> = {}) {
  const contract = contractFor(code);
  const evidenceCategories = Array.from(new Set([
    ...(contract.blueprint.evidenceContract?.requiredEvidenceCategories ?? []),
    ...(contract.blueprint.evidenceContract?.optionalEvidenceCategories ?? []),
    ...contract.sections.flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ]));
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(code),
    rawClaims: [],
    evidencePack: evidencePack(evidenceCategories),
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34l2" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

function methodPendingCodes(): string[] {
  return BLUEPRINT_REGISTRY
    .filter((entry) =>
      entry.requiredApprovals?.human_professional_method_owner === true
      || entry.sections?.[0]?.sectionCode === "USER_DEFINITION_REQUIRED_METHOD",
    )
    .map((entry) => entry.code);
}

function sectionCodes(code: string): string[] {
  return sectionsFromRegistry(code).map((section) => section.sectionCode);
}

describe("Sprint 34L.2 Product Owner method-pack activation", () => {
  it("1. removes USER_DEFINITION_REQUIRED only from the five complete approved methods", () => {
    for (const code of APPROVED_34L2_CODES) {
      expect(sectionsFromRegistry(code)[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
      expect(blueprintFromRegistry(code).requiredApprovals).not.toHaveProperty("human_professional_method_owner");
      expect(methodPendingCodes()).not.toContain(code);
    }

    expect(methodPendingCodes()).toContain("restrictive_practice_comparison");
    expect(methodPendingCodes()).toHaveLength(48);
  });

  it("2. marks BSP review and trigger analysis production-ready while preserving professional boundaries", () => {
    expect(blueprintFromRegistry("behaviour_support_plan_review").maturityState).toBe("production_ready");
    expect(blueprintFromRegistry("behaviour_trigger_analysis").maturityState).toBe("production_ready");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("behaviour_support_plan_review")!)).toBe("behaviour_support_implementation_specialist");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("behaviour_trigger_analysis")!)).toBe("behaviour_support_implementation_specialist");
    expect(getRegistryEntry("behaviour_support_plan_review")?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "formal Behaviour Support Plan authorship",
      "formal Behaviour Support Plan amendment",
    ]));
  });

  it("3. keeps other RP work behind the method gate", () => {
    const rp = blueprintFromRegistry("restrictive_practice_risk_assessment");
    expect(rp.maturityState).toBe("production_ready");
    expect(rp.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(sectionsFromRegistry("restrictive_practice_comparison")[0]?.sectionCode).toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(blueprintFromRegistry("restrictive_practice_comparison").requiredApprovals).toHaveProperty("human_professional_method_owner", true);
  });
});

describe("Sprint 34L.2 site, fire and emergency methods", () => {
  it("4. site assessment covers participant-environment compatibility, operational evidence, controls and reassessment", () => {
    expect(sectionCodes("site_environmental_risk_assessment")).toEqual([
      "SITE_SERVICE_CONTEXT",
      "PARTICIPANT_ENVIRONMENT_COMPATIBILITY",
      "PHYSICAL_ENVIRONMENT_HAZARDS",
      "EMERGENCY_AND_OPERATIONAL_READINESS",
      "STAFF_READINESS_AND_REINDUCTION",
      "RISK_RATING_CONTROLS_AND_CLOSURE",
      "SUITABILITY_CONCLUSION_REASSESSMENT",
    ]);
    expect(sectionsFromRegistry("site_environmental_risk_assessment").find((section) => section.sectionCode === "PARTICIPANT_ENVIRONMENT_COMPATIBILITY")?.instructions).toContain("this participant and this support model");
  });

  it("5. fire assessment covers participant vulnerability, evacuation, RP interaction and reassessment", () => {
    expect(sectionCodes("fire_risk_assessment")).toEqual([
      "PARTICIPANT_SERVICE_FIRE_CONTEXT",
      "CROSS_SYSTEM_FIRE_EVIDENCE",
      "FIRE_VULNERABILITY_EVACUATION_CAPACITY",
      "PROPERTY_CONTROLS_AND_STAFFING",
      "CONFLICTS_RP_AND_ESCALATION",
      "FIRE_CONTROLS_ACTIONS_AND_REASSESSMENT",
    ]);
    expect(sectionsFromRegistry("fire_risk_assessment").find((section) => section.sectionCode === "CONFLICTS_RP_AND_ESCALATION")?.instructions).toContain("restrictive practice");
  });

  it("6. disaster plan is participant and site specific and requires a controlled artifact", () => {
    expect(sectionCodes("disaster_emergency_management_plan")).toEqual([
      "PARTICIPANT_SERVICE_SITE_CONTEXT",
      "CREDIBLE_SCENARIOS_AND_VULNERABILITIES",
      "PREPAREDNESS_RESPONSE_AND_CONTINUITY",
      "RECONCILIATION_RESOURCES_AND_RECOVERY",
      "DRILLS_TESTING_REVIEW_AND_ARTIFACT",
    ]);
    expect(blueprintFromRegistry("disaster_emergency_management_plan").deliverableContract).toMatchObject({
      artifactRequired: true,
      templateRequired: true,
    });
  });
});

describe("Sprint 34L.2 behaviour methods", () => {
  it("7. BSP review implements currentness, consultation, formulation, RRP, training and output classification", () => {
    expect(sectionCodes("behaviour_support_plan_review")).toEqual([
      "BSP_IDENTITY_CURRENTNESS",
      "CONSULTATION_AND_PERSON_CENTRED_CONTENT",
      "EVIDENCE_BASE_AND_CHRONOLOGY",
      "BEHAVIOURS_FUNCTION_GOALS_STRATEGIES",
      "IMPLEMENTATION_RRP_TRAINING_MONITORING",
      "CLASSIFICATION_ESCALATION_AND_GAPS",
    ]);
    expect(sectionsFromRegistry("behaviour_support_plan_review").find((section) => section.sectionCode === "CLASSIFICATION_ESCALATION_AND_GAPS")?.instructions).toContain("practitioner review required");
  });

  it("8. trigger analysis separates association from established function", () => {
    expect(sectionCodes("behaviour_trigger_analysis")).toEqual([
      "TARGET_BEHAVIOUR_AND_SOURCE_DATA",
      "CHRONOLOGY_AND_EVENT_SEQUENCE",
      "PATTERN_AND_TRIGGER_CLASSIFICATION",
      "HEALTH_CONTEXT_BSP_COMPARISON",
      "RECOMMENDATIONS_ESCALATION_AND_GAPS",
    ]);
    expect(sectionsFromRegistry("behaviour_trigger_analysis").find((section) => section.sectionCode === "PATTERN_AND_TRIGGER_CLASSIFICATION")?.instructions).toContain("correlation from established behavioural function");
  });
});

describe("Sprint 34L.2 evidence and runtime gates", () => {
  it("9. site, fire and disaster contracts require participant/site currentness and block memory-only evidence", () => {
    for (const code of ["site_environmental_risk_assessment", "fire_risk_assessment", "disaster_emergency_management_plan"] as const) {
      expect(blueprintFromRegistry(code).evidenceContract?.requiredEntityTypes).toEqual(expect.arrayContaining(["participant", "site"]));
      expect(blueprintFromRegistry(code).evidenceContract?.freshnessRules).toMatchObject({
        currentnessRequired: true,
        conflictingVersionsRequireResolution: true,
      });
      const result = enforceEvidenceContract(blueprintFromRegistry(code).evidenceContract as never, { chunks: [{ sourceType: "memory_only", category: "risk_context" }] });
      expect(result.passed).toBe(false);
      expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
    }
  });

  it("10. missing cross-document evidence blocks approved site method completion", () => {
    const result = validate("site_environmental_risk_assessment", {
      evidencePack: evidencePack(["risk_context", "inspection_record"]),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("11. approved methods pass runtime validation when evidence, approvals and artifacts are present", () => {
    for (const code of APPROVED_34L2_CODES) {
      const result = validate(code);
      expect(result.failures, `${code}: ${JSON.stringify(result.failures)}`).toEqual([]);
      expect(result.passed).toBe(true);
    }
  });

  it("12. missing operations owner approval still blocks site and fire completion", () => {
    const result = validate("fire_risk_assessment", {
      approvalStates: approvalsFor("fire_risk_assessment", false),
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });
});
