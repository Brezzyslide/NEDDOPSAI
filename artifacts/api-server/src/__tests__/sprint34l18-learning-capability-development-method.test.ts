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
const LEARNING_CODE = "learning_capability_development_plan";

function blueprintFromRegistry(code = LEARNING_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = LEARNING_CODE): BlueprintSection[] {
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
  id: "tpl-learning-capability",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "workforce_learning_competency_capability_development_plan_template",
  title: "Workforce Learning, Competency & Capability Development Plan",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/workforce-learning-competency-capability-development-plan.docx",
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
    mode: "capability_review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified employment, training, competency, credential, qualification, screening, certification, role, service, participant-specific, current-authority and learning evidence; Required Capability Profile; organisation standard; role requirement; external compliance requirement; service requirement; participant-specific requirement; worker evidence verification; qualification assessment; screening and certification assessment; practice competency; participant-specific competency; capability matrix; gap classification; readiness outcome; roster interface; learning and competency intervention; implementation evidence; workplace transfer; effectiveness, renewal, maintenance, handoffs and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l18",
    organisationId: "org-34l18",
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
      query: "learning capability required profile competency readiness",
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
    ...contract.sections.flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ]));
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(),
    rawClaims: [],
    evidencePack: evidencePack(evidenceCategories),
    artifactId: "artifact-34l18",
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

describe("Sprint 34L.18 learning capability method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for learning capability only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("talent_learning_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(LEARNING_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Talent & Learning ownership and restrained support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(LEARNING_CODE)!)).toBe("talent_learning_specialist");
    expect(blueprint.primarySpecialist).toBe("talent_learning_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "workforce_compliance_specialist",
      "people_culture_manager",
      "service_delivery_coordinator",
      "workforce_rostering_coordinator",
      "behaviour_support_implementation_specialist",
      "authorised_program_officer",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("workforce_compliance_specialist");
  });
});

describe("Sprint 34L.18 approved learning capability method representation", () => {
  it("3. binds the Workforce Learning, Competency & Capability Development sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "WORKER_ROLE_SERVICE_SCOPE",
      "ORGANISATION_ROLE_EXTERNAL_SERVICE_REQUIREMENTS",
      "REQUIRED_CAPABILITY_PROFILE",
      "WORKER_EVIDENCE_DISCOVERY_AND_VERIFICATION",
      "QUALIFICATION_SCREENING_AND_CERTIFICATION_ASSESSMENT",
      "PRACTICE_AND_PARTICIPANT_SPECIFIC_COMPETENCY",
      "CAPABILITY_MATRIX_GAP_AND_CRITICALITY_ASSESSMENT",
      "READINESS_AND_ROSTER_INTERFACE",
      "LEARNING_COMPETENCY_AND_DEVELOPMENT_PLAN",
      "IMPLEMENTATION_EVIDENCE_AND_COMPETENCY_APPLICATION",
      "READINESS_EFFECTIVENESS_RENEWAL_AND_MAINTENANCE",
      "PROFESSIONAL_CONCLUSION_AND_HANDOFFS",
    ]);
  });

  it("4. requires capability profile generation before worker assessment", () => {
    expect(sectionByCode("WORKER_ROLE_SERVICE_SCOPE").instructions).toContain("Do not start with a universal checklist");
    expect(sectionByCode("REQUIRED_CAPABILITY_PROFILE").description).toContain("requirement type");
    expect(sectionByCode("REQUIRED_CAPABILITY_PROFILE").description).toContain("whether absence blocks work");
    expect(sectionByCode("REQUIRED_CAPABILITY_PROFILE").instructions).toContain("before assessing the worker");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "required_capability_profile_before_worker_assessment" }),
    ]));
  });

  it("5. preserves organisational, role, external, service and participant-specific provenance", () => {
    expect(sectionByCode("ORGANISATION_ROLE_EXTERNAL_SERVICE_REQUIREMENTS").description).toContain("Organisation workforce standards");
    expect(sectionByCode("ORGANISATION_ROLE_EXTERNAL_SERVICE_REQUIREMENTS").description).toContain("participant-specific requirements");
    expect(sectionByCode("ORGANISATION_ROLE_EXTERNAL_SERVICE_REQUIREMENTS").description).toContain("NDIS Worker Orientation Module");
    expect(sectionByCode("ORGANISATION_ROLE_EXTERNAL_SERVICE_REQUIREMENTS").instructions).toContain("Do not hard-code MH&R standards");
    expect(sectionByCode("ORGANISATION_ROLE_EXTERNAL_SERVICE_REQUIREMENTS").instructions).toContain("invent legal/regulatory applicability");
  });

  it("6. keeps qualification, screening, certification, training, competency, authority and participant readiness separate", () => {
    expect(sectionByCode("REQUIRED_CAPABILITY_PROFILE").description).toContain("NDIS Worker Screening Check as screening/clearance");
    expect(sectionByCode("REQUIRED_CAPABILITY_PROFILE").description).toContain("NDIS Worker Orientation Module as mandatory NDIS learning/capability");
    expect(sectionByCode("REQUIRED_CAPABILITY_PROFILE").instructions).toContain("Do not collapse NDIS Worker Screening and NDIS Worker Orientation");
    expect(sectionByCode("QUALIFICATION_SCREENING_AND_CERTIFICATION_ASSESSMENT").instructions).toContain("Qualified, screened/cleared, trained, assessed competent, authorised for task and participant-specifically ready are not interchangeable");
    expect(sectionByCode("QUALIFICATION_SCREENING_AND_CERTIFICATION_ASSESSMENT").instructions).toContain("NDIS Worker Screening and NDIS Worker Orientation must not satisfy each other");
    expect(sectionByCode("PRACTICE_AND_PARTICIPANT_SPECIFIC_COMPETENCY").instructions).toContain("general competency from participant-specific readiness");
    expect(sectionByCode("PRACTICE_AND_PARTICIPANT_SPECIFIC_COMPETENCY").instructions).toContain("grant RP/medication authority");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "capability_states_not_interchangeable" }),
    ]));
  });

  it("7. makes the capability matrix drive gap, criticality and readiness", () => {
    expect(sectionByCode("CAPABILITY_MATRIX_GAP_AND_CRITICALITY_ASSESSMENT").description).toContain("qualification gap");
    expect(sectionByCode("CAPABILITY_MATRIX_GAP_AND_CRITICALITY_ASSESSMENT").description).toContain("mandatory NDIS learning/capability gap");
    expect(sectionByCode("CAPABILITY_MATRIX_GAP_AND_CRITICALITY_ASSESSMENT").description).toContain("participant-specific competency gap");
    expect(sectionByCode("CAPABILITY_MATRIX_GAP_AND_CRITICALITY_ASSESSMENT").instructions).toContain("must drive the development plan");
    expect(sectionByCode("READINESS_AND_ROSTER_INTERFACE").description).toContain("NOT_READY_MANDATORY_NDIS_CAPABILITY_GAP");
    expect(sectionByCode("READINESS_AND_ROSTER_INTERFACE").description).toContain("not ready due to participant-specific competency gap");
    expect(sectionByCode("READINESS_AND_ROSTER_INTERFACE").instructions).toContain("WORKER NOT READY FOR ALLOCATION TO THIS SUPPORT");
    expect(sectionByCode("READINESS_AND_ROSTER_INTERFACE").instructions).toContain("mandatory NDIS Worker Orientation Module evidence");
  });

  it("8. prevents training from substituting for competency, performance or deployment eligibility", () => {
    expect(sectionByCode("LEARNING_COMPETENCY_AND_DEVELOPMENT_PLAN").instructions).toContain("Before prescribing learning");
    expect(sectionByCode("LEARNING_COMPETENCY_AND_DEVELOPMENT_PLAN").instructions).toContain("Do not use repeated training as a substitute");
    expect(sectionByCode("IMPLEMENTATION_EVIDENCE_AND_COMPETENCY_APPLICATION").instructions).toContain("Attendance or training completion alone does not prove competency");
    expect(sectionByCode("READINESS_EFFECTIVENESS_RENEWAL_AND_MAINTENANCE").instructions).toContain("Do not publish deployment eligibility");
  });
});

describe("Sprint 34L.18 evidence, deliverable and completion gates", () => {
  it("9. requires worker, training and competency evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["employment_record", "training_record", "competency_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "credential_record",
        "qualification_record",
        "screening_record",
        "certification_record",
        "role_description",
        "service_requirement",
        "participant_record",
        "support_plan",
        "care_plan",
        "behaviour_support_plan",
        "restrictive_practice_authorisation",
        "medication_instruction",
        "manual_handling_plan",
        "mealtime_plan",
        "communication_plan",
        "workforce_compliance_record",
        "current_authority",
      ]),
      requiredEntityTypes: ["worker"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "training_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Workforce Learning, Competency & Capability Development Plan");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "workforce_learning_competency_capability_development_plan",
      namingConvention: "WORKFORCE_CAPABILITY_DEVELOPMENT_PLAN_{worker_or_role}_{period}",
      prohibitedDeliverables: expect.arrayContaining([
        "competency_certification",
        "deployment_eligibility_certification",
        "credential_certification",
        "screening_clearance_determination",
        "legal_or_regulatory_applicability_determination",
        "roster_publication",
        "clinical_bsp_or_restrictive_practice_decision",
      ]),
    });
  });

  it("12. blocks completion when artifact, template or Talent & Learning approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("13. passes runtime validation when required evidence, sections, artifact, template and approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.18 authority boundaries", () => {
  it("14. KDS cannot rewrite capability conclusions", () => {
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

  it("15. Talent & Learning can draft the plan but cannot certify competence or deployment eligibility", () => {
    const tls = profile("talent_learning_specialist_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "talent_learning_specialist",
      workerProfile: tls,
      actionIdentifier: "draft_learning_capability_development_plan",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const certifyDecision = evaluateWorkerProfileAuthority({
      specialistCode: "talent_learning_specialist",
      workerProfile: tls,
      actionIdentifier: "evidence_free_competency_certification",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });
    const deployDecision = evaluateWorkerProfileAuthority({
      specialistCode: "talent_learning_specialist",
      workerProfile: tls,
      actionIdentifier: "declare_deployment_eligibility",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(certifyDecision.decision).toBe("PROHIBITED");
    expect(deployDecision.decision).toBe("PROHIBITED");
  });
});
