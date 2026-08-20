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
const SAFEGUARDING_CODE = "safeguarding_assessment";

function blueprintFromRegistry(code = SAFEGUARDING_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = SAFEGUARDING_CODE): BlueprintSection[] {
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
  id: "tpl-safeguarding-assessment",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "participant_safeguarding_assessment_protection_plan_template",
  title: "Participant Safeguarding Assessment & Protection Plan",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/participant-safeguarding-assessment-protection-plan.docx",
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
    mode: "assessment",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified safeguarding evidence, participant voice, immediate safety, current exposure, vulnerability factors, protective factors, risk assessment, proportionate controls, least restrictive alternatives, evidence preservation, medical police reporting referral needs, care plan reconciliation, monitoring, review triggers, safeguarding plan and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l10",
    organisationId: "org-34l10",
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
      query: "participant safeguarding assessment evidence",
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
    artifactId: "artifact-34l10",
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

describe("Sprint 34L.10 safeguarding assessment method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for safeguarding only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("incident_safeguarding_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(SAFEGUARDING_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves ISS ownership and supporting-specialist authority boundaries", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(SAFEGUARDING_CODE)!)).toBe("incident_safeguarding_specialist");
    expect(blueprint.primarySpecialist).toBe("incident_safeguarding_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "service_delivery_coordinator",
      "compliance_quality_manager",
      "behaviour_support_implementation_specialist",
      "authorised_program_officer",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.10 approved safeguarding method representation", () => {
  it("3. binds the participant-specific protection plan structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_SAFEGUARDING_OUTCOME",
      "TRIGGER_CONCERN_AND_EVIDENCE_DOCTRINE",
      "IMMEDIATE_SAFETY",
      "PARTICIPANT_VOICE_AND_PARTICIPATION_SUPPORT",
      "AUTONOMY_DIGNITY_COERCION_AND_INFLUENCE",
      "VULNERABILITY_EXPOSURE_AND_RISK_SOURCE",
      "PROTECTIVE_FACTORS_AND_RISK_ASSESSMENT",
      "IMMEDIATE_CONTROLS_AND_LEAST_RESTRICTIVE_SAFEGUARDING",
      "EVIDENCE_DISCOVERY_AND_PRESERVATION",
      "MEDICAL_POLICE_REPORTING_AND_REFERRAL_NEEDS",
      "CARE_BSP_RISK_RECONCILIATION",
      "PREVIOUS_CONCERNS_AND_PATTERN",
      "ONGOING_PROTECTION_PLAN_MONITORING_AND_REVIEW",
      "PROFESSIONAL_CONCLUSION_AND_SAFEGUARDING_PLAN",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("safeguarding reference");
    expect(sectionByCode("EXECUTIVE_SAFEGUARDING_OUTCOME").description).toContain("immediate controls");
  });

  it("4. separates safeguarding from investigation and reportability", () => {
    const doctrine = sectionByCode("TRIGGER_CONCERN_AND_EVIDENCE_DOCTRINE");
    expect(doctrine.description).toContain("safeguarding concern");
    expect(doctrine.instructions).toContain("Do not require investigation-level proof");
    expect(sectionByCode("EXECUTIVE_SAFEGUARDING_OUTCOME").instructions).toContain("protective action as proof");
    expect(sectionByCode("PROFESSIONAL_CONCLUSION_AND_SAFEGUARDING_PLAN").instructions).toContain("Do not make investigation findings");
  });

  it("5. prioritises immediate safety and participant voice", () => {
    expect(sectionByCode("IMMEDIATE_SAFETY").instructions).toContain("Immediate safety comes first");
    expect(sectionByCode("IMMEDIATE_SAFETY").instructions).toContain("urgent escalation");
    const participant = sectionByCode("PARTICIPANT_VOICE_AND_PARTICIPATION_SUPPORT");
    expect(participant.description).toContain("Participant account");
    expect(participant.description).toContain("Easy Read");
    expect(participant.instructions).toContain("Participant voice is central");
    expect(participant.instructions).toContain("absence of complaint as evidence of safety");
  });

  it("6. requires proportionate least-restrictive safeguarding controls", () => {
    expect(sectionByCode("AUTONOMY_DIGNITY_COERCION_AND_INFLUENCE").instructions).toContain("must not automatically become paternalistic restriction");
    expect(sectionByCode("AUTONOMY_DIGNITY_COERCION_AND_INFLUENCE").instructions).toContain("infer incapacity from disability");
    const controls = sectionByCode("IMMEDIATE_CONTROLS_AND_LEAST_RESTRICTIVE_SAFEGUARDING");
    expect(controls.description).toContain("cessation criteria");
    expect(controls.instructions).toContain("Do not implement restrictive practice under the label of safeguarding");
    expect(controls.instructions).toContain("less restrictive alternatives");
  });

  it("7. covers exposure, protective factors, external needs, monitoring and outcome states", () => {
    expect(sectionByCode("VULNERABILITY_EXPOSURE_AND_RISK_SOURCE").instructions).toContain("do not make guilt findings");
    expect(sectionByCode("PROTECTIVE_FACTORS_AND_RISK_ASSESSMENT").instructions).toContain("Do not manufacture numeric precision");
    expect(sectionByCode("MEDICAL_POLICE_REPORTING_AND_REFERRAL_NEEDS").instructions).toContain("must remain within WorkerProfile authority");
    expect(sectionByCode("ONGOING_PROTECTION_PLAN_MONITORING_AND_REVIEW").instructions).toContain("must not create unnecessary surveillance");
    expect(sectionByCode("PROFESSIONAL_CONCLUSION_AND_SAFEGUARDING_PLAN").instructions).toContain("IMMEDIATE_SAFEGUARDING_ACTION_REQUIRED");
    expect(sectionByCode("PROFESSIONAL_CONCLUSION_AND_SAFEGUARDING_PLAN").instructions).toContain("NO_CURRENT_SAFEGUARDING_ACTION_IDENTIFIED");
  });
});

describe("Sprint 34L.10 evidence, deliverable and completion gates", () => {
  it("8. requires participant-specific safeguarding evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["safeguarding_record", "participant_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "complaint_record",
        "incident_record",
        "incident_investigation",
        "participant_account",
        "case_note",
        "behaviour_support_plan",
        "restrictive_practice_record",
        "previous_safeguarding_record",
        "guardian_nominee_record",
        "advocate_record",
        "police_record",
        "medical_record",
      ]),
      requiredEntityTypes: ["participant"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("9. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "participant" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Participant Safeguarding Assessment & Protection Plan");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "participant_safeguarding_assessment_protection_plan",
      namingConvention: "SAFEGUARDING_ASSESSMENT_{participant}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "legal_determination",
        "clinical_determination",
        "formal_investigation_finding",
        "reportability_determination",
        "regulatory_submission",
        "restrictive_practice_authorisation",
      ]),
    });
  });

  it("11. blocks completion when artifact, template or ISS approval is missing", () => {
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

describe("Sprint 34L.10 authority boundaries", () => {
  it("13. KDS cannot rewrite professional conclusions", () => {
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

  it("14. ISS can draft safeguarding output but cannot submit externally or make clinical decisions", () => {
    const iss = profile("incident_safeguarding_specialist_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "draft_safeguarding_assessment",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const submitDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "submit_regulatory_notification",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });
    const clinicalDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "make_clinical_decision",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(submitDecision.decision).toBe("PROHIBITED");
    expect(clinicalDecision.decision).toBe("PROHIBITED");
  });
});
