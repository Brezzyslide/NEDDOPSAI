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
const PEOPLE_MANAGEMENT_CODE = "people_management_review";

function blueprintFromRegistry(code = PEOPLE_MANAGEMENT_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = PEOPLE_MANAGEMENT_CODE): BlueprintSection[] {
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
  id: "tpl-people-management-case-review",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "people_management_case_review_resolution_plan_template",
  title: "People Management Case Review & Resolution Plan",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/people-management-case-review-resolution-plan.docx",
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
    mode: "performance_management",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified people-management evidence, matter trigger, immediate participant and workplace safety, scope, parties, roles, workplace expectations, chronology, party accounts, witness accounts, documentary evidence, corroboration, contradictions, participant service implications, issue classification, system factors, procedural fairness, formal investigation boundary, mediation suitability, mediation outcome, management actions, support, review period, closure state, escalation and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l17",
    organisationId: "org-34l17",
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
      query: "people management case review resolution evidence",
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
    artifactId: "artifact-34l17",
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

describe("Sprint 34L.17 people-management review method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for people-management only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("people_culture_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(PEOPLE_MANAGEMENT_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves People & Culture Manager ownership and restrained support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(PEOPLE_MANAGEMENT_CODE)!)).toBe("people_culture_manager");
    expect(blueprint.primarySpecialist).toBe("people_culture_manager");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "service_delivery_coordinator",
      "incident_safeguarding_specialist",
      "compliance_quality_manager",
      "workforce_compliance_specialist",
      "talent_learning_specialist",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("incident_safeguarding_specialist");
  });
});

describe("Sprint 34L.17 approved people-management method representation", () => {
  it("3. binds the People Management Case Review & Resolution Plan sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "MATTER_TRIGGER_AND_IMMEDIATE_SAFETY",
      "SCOPE_PARTIES_ROLES_AND_EXPECTATIONS",
      "EVIDENCE_DISCOVERY_AND_CHRONOLOGY",
      "PARTY_AND_WITNESS_ACCOUNTS",
      "CORROBORATION_CONTRADICTIONS_AND_FINDING_STANDARD",
      "PARTICIPANT_SERVICE_AND_WORKPLACE_IMPLICATIONS",
      "ISSUE_CLASSIFICATION_AND_SYSTEM_FACTORS",
      "PROCEDURAL_FAIRNESS_AND_FORMAL_PROCESS_BOUNDARY",
      "MEDIATION_RESOLUTION_OPTIONS_AND_SUPPORT",
      "MANAGEMENT_ACTIONS_REVIEW_AND_CLOSURE",
      "PROFESSIONAL_CONCLUSION",
    ]);
  });

  it("4. requires immediate safety without prejudging the matter", () => {
    expect(sectionByCode("MATTER_TRIGGER_AND_IMMEDIATE_SAFETY").description).toContain("participant safety");
    expect(sectionByCode("MATTER_TRIGGER_AND_IMMEDIATE_SAFETY").description).toContain("workplace safety");
    expect(sectionByCode("MATTER_TRIGGER_AND_IMMEDIATE_SAFETY").instructions).toContain("Interim controls are not proof of wrongdoing");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "participant_safety_and_service_continuity_prioritised" }),
    ]));
  });

  it("5. preserves scope, parties, workplace expectations and chronology discipline", () => {
    expect(sectionByCode("SCOPE_PARTIES_ROLES_AND_EXPECTATIONS").instructions).toContain("Avoid uncontrolled scope creep");
    expect(sectionByCode("SCOPE_PARTIES_ROLES_AND_EXPECTATIONS").instructions).toContain("Do not infer authority from job title alone");
    expect(sectionByCode("EVIDENCE_DISCOVERY_AND_CHRONOLOGY").instructions).toContain("Search only authorised and relevant evidence");
    expect(sectionByCode("EVIDENCE_DISCOVERY_AND_CHRONOLOGY").instructions).toContain("reported, verified, disputed and inferred");
  });

  it("6. represents each party fairly and separates allegation, account, evidence and finding", () => {
    expect(sectionByCode("PARTY_AND_WITNESS_ACCOUNTS").instructions).toContain("Represent each relevant party fairly");
    expect(sectionByCode("PARTY_AND_WITNESS_ACCOUNTS").instructions).toContain("Do not invent a party response");
    expect(sectionByCode("CORROBORATION_CONTRADICTIONS_AND_FINDING_STANDARD").description).toContain("Allegation");
    expect(sectionByCode("CORROBORATION_CONTRADICTIONS_AND_FINDING_STANDARD").instructions).toContain("Do not convert allegations into facts");
    expect(sectionByCode("CORROBORATION_CONTRADICTIONS_AND_FINDING_STANDARD").instructions).toContain("Repeated copying of one complaint");
  });

  it("7. distinguishes workplace relationship issues from participant/service risk", () => {
    expect(sectionByCode("PARTICIPANT_SERVICE_AND_WORKPLACE_IMPLICATIONS").instructions).toContain("Distinguish workplace relationship issue");
    expect(sectionByCode("PARTICIPANT_SERVICE_AND_WORKPLACE_IMPLICATIONS").instructions).toContain("Immediate participant controls");
    expect(sectionByCode("ISSUE_CLASSIFICATION_AND_SYSTEM_FACTORS").description).toContain("Interpersonal conflict");
    expect(sectionByCode("ISSUE_CLASSIFICATION_AND_SYSTEM_FACTORS").description).toContain("serious allegation requiring formal investigation");
    expect(sectionByCode("ISSUE_CLASSIFICATION_AND_SYSTEM_FACTORS").instructions).toContain("Do not force every matter into misconduct");
  });

  it("8. protects formal process, mediation and closure boundaries", () => {
    expect(sectionByCode("PROCEDURAL_FAIRNESS_AND_FORMAL_PROCESS_BOUNDARY").instructions).toContain("Do not finalise material adverse findings solely from one side");
    expect(sectionByCode("PROCEDURAL_FAIRNESS_AND_FORMAL_PROCESS_BOUNDARY").instructions).toContain("Do not resolve serious disputed allegations through informal mediation");
    expect(sectionByCode("MEDIATION_RESOLUTION_OPTIONS_AND_SUPPORT").instructions).toContain("Do not force mediation");
    expect(sectionByCode("MEDIATION_RESOLUTION_OPTIONS_AND_SUPPORT").instructions).toContain("attendance as agreement");
    expect(sectionByCode("MANAGEMENT_ACTIONS_REVIEW_AND_CLOSURE").instructions).toContain("do not terminate, suspend or issue formal disciplinary/legal outcomes");
  });
});

describe("Sprint 34L.17 evidence, deliverable and completion gates", () => {
  it("9. requires employment and party-response evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["employment_record", "employee_response"],
      optionalEvidenceCategories: expect.arrayContaining([
        "complaint_record",
        "grievance_record",
        "manager_observation",
        "staff_statement",
        "witness_account",
        "meeting_note",
        "email_record",
        "message_record",
        "supervision_record",
        "performance_record",
        "incident_record",
        "participant_record",
        "case_note",
        "roster_schedule",
        "handover_record",
        "workplace_policy",
        "code_of_conduct",
        "mediation_record",
        "previous_management_action",
      ]),
      requiredEntityTypes: ["worker"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "employment_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("People Management Case Review & Resolution Plan");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "people_management_case_review_resolution_plan",
      namingConvention: "PEOPLE_MANAGEMENT_CASE_REVIEW_{matter}_{period}",
      prohibitedDeliverables: expect.arrayContaining([
        "termination_decision",
        "suspension_decision",
        "disciplinary_decision",
        "formal_misconduct_finding",
        "formal_workplace_investigation_finding",
        "legal_advice",
        "industrial_advocacy",
      ]),
    });
  });

  it("12. blocks completion when artifact, template or P&C approval is missing", () => {
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

describe("Sprint 34L.17 authority boundaries", () => {
  it("14. KDS cannot rewrite people-management conclusions", () => {
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

  it("15. P&C can draft the case review but severe employment actions remain controlled", () => {
    const pcm = profile("people_culture_manager_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: pcm,
      actionIdentifier: "draft_people_management_case_review",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const formalCorrespondenceDecision = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: pcm,
      actionIdentifier: "issue_formal_disciplinary_correspondence",
      actionType: "send_email",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
      connectorCategory: "email_system",
    });
    const severeDisciplineDecision = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: pcm,
      actionIdentifier: "make_severe_disciplinary_decision",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(formalCorrespondenceDecision.decision).toBe("APPROVAL_REQUIRED");
    expect(severeDisciplineDecision.decision).toBe("PROHIBITED");
  });
});
