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
const PERFORMANCE_CODE = "workforce_performance_review";

function blueprintFromRegistry(code = PERFORMANCE_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = PERFORMANCE_CODE): BlueprintSection[] {
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
  id: "tpl-workforce-performance-review",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "workforce_performance_development_review_template",
  title: "Workforce Performance & Development Review",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/workforce-performance-development-review.docx",
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
    mode: "performance_review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified performance record, employment record, worker response, role expectation, participant and service requirement, evidence relevance, currentness, provenance, strengths, concerns, participant impact, capability, competency, compliance, reliability, conduct boundary, incident and complaint finding state, documentation quality, training, supervision, fatigue interface, organisational support gap, corroboration, contradiction, pattern, outcome, development action, improvement action, review period, effectiveness and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l16",
    organisationId: "org-34l16",
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
      query: "workforce performance review evidence role expectations worker response",
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
    artifactId: "artifact-34l16",
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

describe("Sprint 34L.16 workforce performance review method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for workforce performance only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("people_culture_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(PERFORMANCE_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves People & Culture Manager ownership and restrained support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(PERFORMANCE_CODE)!)).toBe("people_culture_manager");
    expect(blueprint.primarySpecialist).toBe("people_culture_manager");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "talent_learning_specialist",
      "workforce_compliance_specialist",
      "service_delivery_coordinator",
      "incident_safeguarding_specialist",
      "compliance_quality_manager",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("talent_learning_specialist");
  });
});

describe("Sprint 34L.16 approved performance review method representation", () => {
  it("3. binds the Workforce Performance & Development Review sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "REVIEW_TRIGGER_SCOPE_AND_PERIOD",
      "ROLE_EXPECTATIONS_AND_PARTICIPANT_REQUIREMENTS",
      "EVIDENCE_DISCOVERY_RELEVANCE_AND_CURRENTNESS",
      "STRENGTHS_AND_EFFECTIVE_PERFORMANCE",
      "PERFORMANCE_CONCERNS_AND_PARTICIPANT_SERVICE_IMPACT",
      "CAPABILITY_COMPETENCY_COMPLIANCE_AND_RELIABILITY",
      "CONDUCT_INCIDENT_COMPLAINT_AND_DOCUMENTATION_BOUNDARY",
      "TRAINING_SUPERVISION_AND_SYSTEM_CONTEXT",
      "WORKER_RESPONSE_CORROBORATION_AND_CONTRADICTIONS",
      "PROFESSIONAL_ASSESSMENT_AND_OUTCOME",
      "DEVELOPMENT_IMPROVEMENT_AND_SUPPORT_PLAN",
      "REVIEW_EFFECTIVENESS_AND_APPROVAL",
    ]);
  });

  it("4. preserves fair trigger, role and evidence currentness discipline", () => {
    expect(sectionByCode("REVIEW_TRIGGER_SCOPE_AND_PERIOD").instructions).toContain("Do not assume a negative outcome");
    expect(sectionByCode("REVIEW_TRIGGER_SCOPE_AND_PERIOD").instructions).toContain("undefined historical period");
    expect(sectionByCode("ROLE_EXPECTATIONS_AND_PARTICIPANT_REQUIREMENTS").instructions).toContain("Do not invent role expectations");
    expect(sectionByCode("EVIDENCE_DISCOVERY_RELEVANCE_AND_CURRENTNESS").instructions).toContain("Search only evidence necessary");
    expect(sectionByCode("EVIDENCE_DISCOVERY_RELEVANCE_AND_CURRENTNESS").instructions).toContain("stale historical issues");
  });

  it("5. requires strengths and fair concern analysis", () => {
    expect(sectionByCode("STRENGTHS_AND_EFFECTIVE_PERFORMANCE").description).toContain("effective or strong performance");
    expect(sectionByCode("STRENGTHS_AND_EFFECTIVE_PERFORMANCE").instructions).toContain("Actively identify strengths");
    expect(sectionByCode("PERFORMANCE_CONCERNS_AND_PARTICIPANT_SERVICE_IMPACT").description).toContain("worker response");
    expect(sectionByCode("PERFORMANCE_CONCERNS_AND_PARTICIPANT_SERVICE_IMPACT").instructions).toContain("Keep allegations separate from established findings");
  });

  it("6. separates performance, capability, competency, conduct, compliance, reliability and system factors", () => {
    expect(sectionByCode("CAPABILITY_COMPETENCY_COMPLIANCE_AND_RELIABILITY").instructions).toContain("Keep performance, capability, competency, compliance and attendance/reliability distinct");
    expect(sectionByCode("CAPABILITY_COMPETENCY_COMPLIANCE_AND_RELIABILITY").instructions).toContain("Scheduled is not actual");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "performance_capability_competency_conduct_compliance_reliability_system_distinguished" }),
    ]));
  });

  it("7. preserves incident, complaint, worker-response and contradiction boundaries", () => {
    expect(sectionByCode("CONDUCT_INCIDENT_COMPLAINT_AND_DOCUMENTATION_BOUNDARY").instructions).toContain("An incident or complaint alone is not proof of poor performance");
    expect(sectionByCode("CONDUCT_INCIDENT_COMPLAINT_AND_DOCUMENTATION_BOUNDARY").instructions).toContain("NOT SUBSTANTIATED");
    expect(sectionByCode("WORKER_RESPONSE_CORROBORATION_AND_CONTRADICTIONS").instructions).toContain("Do not invent worker response");
    expect(sectionByCode("WORKER_RESPONSE_CORROBORATION_AND_CONTRADICTIONS").instructions).toContain("Repeated copying of the same allegation");
  });

  it("8. supports development and improvement without becoming discipline", () => {
    expect(sectionByCode("TRAINING_SUPERVISION_AND_SYSTEM_CONTEXT").instructions).toContain("ORGANISATIONAL_SUPPORT_GAP");
    expect(sectionByCode("PROFESSIONAL_ASSESSMENT_AND_OUTCOME").instructions).toContain("formal people-management review required");
    expect(sectionByCode("DEVELOPMENT_IMPROVEMENT_AND_SUPPORT_PLAN").instructions).toContain("Do not make every development action corrective");
    expect(sectionByCode("DEVELOPMENT_IMPROVEMENT_AND_SUPPORT_PLAN").instructions).toContain("formal correspondence");
  });
});

describe("Sprint 34L.16 evidence, deliverable and completion gates", () => {
  it("9. requires performance, employment and worker-response evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["performance_record", "employment_record", "employee_response"],
      optionalEvidenceCategories: expect.arrayContaining([
        "supervision_record",
        "training_record",
        "competency_record",
        "credential_record",
        "roster_schedule",
        "timesheet",
        "service_requirement",
        "incident_record",
        "complaint_record",
        "audit_record",
        "participant_feedback",
        "positive_feedback",
        "previous_improvement_action",
        "rostering_fatigue_record",
      ]),
      requiredEntityTypes: ["worker"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "performance_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Workforce Performance & Development Review");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "workforce_performance_development_review",
      namingConvention: "WORKFORCE_PERFORMANCE_DEVELOPMENT_REVIEW_{worker}_{period}",
      prohibitedDeliverables: expect.arrayContaining([
        "disciplinary_decision",
        "termination_decision",
        "suspension_decision",
        "formal_conduct_finding",
        "misconduct_finding",
        "legal_advice",
        "credential_certification",
        "competency_certification",
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

describe("Sprint 34L.16 authority boundaries", () => {
  it("14. KDS cannot rewrite performance conclusions", () => {
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

  it("15. P&C can draft internally but publication and severe employment decisions remain controlled", () => {
    const pcm = profile("people_culture_manager_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: pcm,
      actionIdentifier: "draft_workforce_performance_development_review",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const publishDecision = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: pcm,
      actionIdentifier: "publish_performance_outcome",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const terminateDecision = evaluateWorkerProfileAuthority({
      specialistCode: "people_culture_manager",
      workerProfile: pcm,
      actionIdentifier: "terminate_employee",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(publishDecision.decision).toBe("APPROVAL_REQUIRED");
    expect(terminateDecision.decision).toBe("PROHIBITED");
  });
});
