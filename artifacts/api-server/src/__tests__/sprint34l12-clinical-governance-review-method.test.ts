import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
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

const NOW = new Date("2026-08-19T00:00:00Z");
const CLINICAL_CODE = "clinical_governance_review";

function blueprintFromRegistry(code = CLINICAL_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = CLINICAL_CODE): BlueprintSection[] {
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
  id: "tpl-clinical-strategy-implementation",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "clinical_professional_strategy_implementation_plan_template",
  title: "Clinical & Professional Strategy Implementation Plan",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/clinical-professional-strategy-implementation-plan.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: NOW,
  updatedAt: NOW,
};

function contractFor(templateOverride: WorkTemplate | null = template): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template: templateOverride,
    mode: "clinical",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified participant professional recommendation evidence, participant record, source authority, currentness, supersession, provenance, strategy taxonomy, cross-document reconciliation, PROFESSIONAL_CLARIFICATION_REQUIRED where needed, operational translation into who what when where how avoid resources escalation evidence, competency, implementation state, implementation evidence, frontline consistency, drift monitoring and review.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l12",
    organisationId: "org-34l12",
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
      query: "participant professional strategy implementation evidence",
      selectedSourceIds: categories,
      selectedChunkIds: categories,
      selectedMemoryIds: [],
      selectedTaskUploadIds: [],
      retrievalMethod: "deterministic",
      ranking: [],
      tokenEstimate: 100,
      durationMs: 1,
    },
  };
}

function approvalsFor(approved = true): Record<string, boolean> {
  return Object.fromEntries(
    Object.keys(blueprintFromRegistry().requiredApprovals ?? {}).map((approval) => [approval, approved]),
  );
}

function validate(overrides: Partial<BlueprintRuntimeValidationInput> = {}) {
  const contract = contractFor();
  const evidenceCategories = Array.from(new Set([
    ...(contract.blueprint.evidenceContract?.requiredEvidenceCategories ?? []),
    ...(contract.blueprint.evidenceContract?.requiredEntityTypes ?? []),
    ...(contract.blueprint.evidenceContract?.optionalEvidenceCategories ?? []),
    ...contract.sections.flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ]));
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(),
    rawClaims: [],
    evidencePack: evidencePack(evidenceCategories),
    artifactId: "artifact-34l12",
    approvalStates: approvalsFor(),
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

function sectionByCode(code: string): BlueprintSection {
  const section = sectionsFromRegistry().find((candidate) => candidate.sectionCode === code);
  if (!section) throw new Error(`Missing section: ${code}`);
  return section;
}

function profile(code: string) {
  const workerProfile = getWorkerProfileByCode(code);
  if (!workerProfile) throw new Error(`Missing worker profile: ${code}`);
  return workerProfile;
}

describe("Sprint 34L.12 clinical strategy implementation method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for clinical strategy implementation only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("compliance_quality_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(CLINICAL_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves CQM ownership without giving CQM clinical authority", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(CLINICAL_CODE)!)).toBe("compliance_quality_manager");
    expect(blueprint.primarySpecialist).toBe("compliance_quality_manager");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "behaviour_support_implementation_specialist",
      "service_delivery_coordinator",
      "authorised_program_officer",
      "incident_safeguarding_specialist",
      "operations_manager",
      "knowledge_documentation_specialist",
    ]));
    expect(getRegistryEntry(CLINICAL_CODE)?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "clinical determination",
      "professional recommendation change",
      "BSP strategy change",
      "therapy program creation",
    ]));
  });
});

describe("Sprint 34L.12 approved clinical strategy method representation", () => {
  it("3. binds the participant-specific strategy implementation structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_STRATEGY_OUTCOME",
      "PARTICIPANT_TASK_AND_SOURCE_DISCOVERY",
      "SOURCE_AUTHORITY_CURRENTNESS_AND_SUPERSESSION",
      "PROFESSIONAL_RECOMMENDATION_PROVENANCE",
      "STRATEGY_TAXONOMY_AND_CLASSIFICATION",
      "CROSS_DOCUMENT_RECONCILIATION",
      "OPERATIONAL_TRANSLATION_STANDARD",
      "PROACTIVE_REACTIVE_PROTECTIVE_STRATEGIES",
      "STRUCTURE_PREDICTABILITY_AND_FEELING_SAFE",
      "COMMUNICATION_ENVIRONMENT_AND_SKILL_BUILDING",
      "HEALTH_CLINICAL_AND_ESCALATION_STRATEGIES",
      "WORKFORCE_COMPETENCY_RESOURCE_AND_ENVIRONMENT_READINESS",
      "OPERATIONAL_DOCUMENT_ALIGNMENT_AND_IMPLEMENTATION_STATE",
      "IMPLEMENTATION_EVIDENCE_CONSISTENCY_DRIFT_AND_REVIEW",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("strategy implementation reference");
    expect(sectionByCode("EXECUTIVE_STRATEGY_OUTCOME").instructions).toContain("Do not change, diagnose, prescribe");
  });

  it("4. preserves source authority, currentness and recommendation provenance", () => {
    expect(sectionByCode("SOURCE_AUTHORITY_CURRENTNESS_AND_SUPERSESSION").instructions).toContain("Newer is not automatically more authoritative");
    expect(sectionByCode("SOURCE_AUTHORITY_CURRENTNESS_AND_SUPERSESSION").instructions).toContain("actually been superseded");
    expect(sectionByCode("PROFESSIONAL_RECOMMENDATION_PROVENANCE").instructions).toContain("Every material operational strategy must be traceable");
    expect(sectionByCode("PROFESSIONAL_RECOMMENDATION_PROVENANCE").instructions).toContain("Do not produce orphan strategies");
  });

  it("5. classifies strategies by function and protects RP boundaries", () => {
    const taxonomy = sectionByCode("STRATEGY_TAXONOMY_AND_CLASSIFICATION");
    expect(taxonomy.description).toContain("Proactive");
    expect(taxonomy.description).toContain("reactive");
    expect(taxonomy.description).toContain("protective");
    expect(taxonomy.description).toContain("feeling safe");
    expect(taxonomy.description).toContain("communication");
    expect(taxonomy.instructions).toContain("Do not disguise restrictive practice");
  });

  it("6. reconciles cross-document recommendations without inventing merged clinical advice", () => {
    const reconciliation = sectionByCode("CROSS_DOCUMENT_RECONCILIATION");
    expect(reconciliation.description).toContain("consistent");
    expect(reconciliation.description).toContain("complementary");
    expect(reconciliation.description).toContain("superseded");
    expect(reconciliation.description).toContain("clarification-required");
    expect(reconciliation.instructions).toContain("Do not invent a merged clinical recommendation");
    expect(reconciliation.instructions).toContain("PROFESSIONAL_CLARIFICATION_REQUIRED");
  });

  it("7. requires practical operational translation and implementation evidence", () => {
    expect(sectionByCode("OPERATIONAL_TRANSLATION_STANDARD").description).toContain("what staff must do");
    expect(sectionByCode("OPERATIONAL_TRANSLATION_STANDARD").instructions).toContain("maintain routine");
    expect(sectionByCode("HEALTH_CLINICAL_AND_ESCALATION_STRATEGIES").instructions).toContain("Do not independently interpret clinical ambiguity");
    expect(sectionByCode("OPERATIONAL_DOCUMENT_ALIGNMENT_AND_IMPLEMENTATION_STATE").instructions).toContain("Documented does not mean operationalised");
    expect(sectionByCode("IMPLEMENTATION_EVIDENCE_CONSISTENCY_DRIFT_AND_REVIEW").instructions).toContain("Do not mark a strategy implemented simply because it appears in a plan");
  });
});

describe("Sprint 34L.12 evidence, deliverable and completion gates", () => {
  it("8. requires participant-specific professional recommendation evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["participant_professional_recommendation", "participant_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "behaviour_support_plan",
        "care_plan",
        "support_plan",
        "allied_health_report",
        "occupational_therapy_report",
        "speech_pathology_report",
        "physiotherapy_report",
        "psychology_report",
        "clinical_report",
        "health_management_plan",
        "communication_profile",
        "mealtime_plan",
        "mobility_plan",
        "implementation_record",
        "training_record",
        "competency_record",
      ]),
      requiredEntityTypes: ["participant"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("9. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "participant_professional_recommendation" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Clinical & Professional Strategy Implementation Plan");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "clinical_professional_strategy_implementation_plan",
      namingConvention: "CLINICAL_STRATEGY_IMPLEMENTATION_{participant}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "clinical_determination",
        "diagnosis",
        "prescription",
        "medication_change",
        "treatment_change",
        "bsp_strategy_change",
        "therapy_program",
      ]),
    });
  });

  it("11. blocks completion when artifact, template or CQM approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("12. passes runtime validation when required evidence, sections, artifact, template and approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.12 authority boundaries", () => {
  it("13. KDS cannot rewrite professional strategy conclusions", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "knowledge_documentation_specialist",
      workerProfile: profile("knowledge_documentation_specialist_profile"),
      actionIdentifier: "rewrite_professional_conclusion",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("14. CQM can draft implementation output but cannot mutate participant records or submit externally", () => {
    const cqm = profile("compliance_quality_manager_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: cqm,
      actionIdentifier: "draft_clinical_strategy_implementation_plan",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const mutateDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: cqm,
      actionIdentifier: "modify_participant_records",
      actionType: "update_file",
      executionChannel: "database_query",
      toolCategory: "data_tools",
    });
    const submitDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: cqm,
      actionIdentifier: "submit_regulatory_notification",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(mutateDecision.decision).toBe("PROHIBITED");
    expect(submitDecision.decision).toBe("PROHIBITED");
  });
});
