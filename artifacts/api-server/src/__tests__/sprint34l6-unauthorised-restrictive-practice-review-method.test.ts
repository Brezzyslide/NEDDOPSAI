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
const UNAUTHORISED_RP_CODE = "unauthorised_restrictive_practice_review";

function blueprintFromRegistry(code = UNAUTHORISED_RP_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = UNAUTHORISED_RP_CODE): BlueprintSection[] {
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
  id: "tpl-unauthorised-rp-review",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "unauthorised_restrictive_practice_review_template",
  title: "Unauthorised Restrictive Practice Review",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/unauthorised-rp-review.docx",
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
    mode: "review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified event-time evidence, chronology, provenance, contradictions, actual practice, BSP reconciliation, authorisation reconciliation, participant voice, safeguarding, incident/reportability states, correction, corrective action, preventive action, required review actions and closure evidence.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l6",
    organisationId: "org-34l6",
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
      query: "unauthorised restrictive practice event-time evidence",
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
    ...(contract.blueprint.evidenceContract?.optionalEvidenceCategories ?? []),
    ...contract.sections.flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ]));
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(),
    rawClaims: [],
    evidencePack: evidencePack(evidenceCategories),
    artifactId: "artifact-34l6",
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

describe("Sprint 34L.6 unauthorised RP method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for this Blueprint only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("incident_safeguarding_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(UNAUTHORISED_RP_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves ISS ownership while keeping APO and KDS as supporting specialists only", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(UNAUTHORISED_RP_CODE)!)).toBe("incident_safeguarding_specialist");
    expect(blueprint.primarySpecialist).toBe("incident_safeguarding_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "authorised_program_officer",
      "behaviour_support_implementation_specialist",
      "compliance_quality_manager",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("authorised_program_officer");
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.6 approved unauthorised RP method representation", () => {
  it("3. binds the participant-specific authoritative template structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_OUTCOME",
      "PURPOSE_TRIGGER_AND_SCOPE",
      "IMMEDIATE_SAFETY_AND_EVIDENCE_PRESERVATION",
      "EVENT_CHRONOLOGY_AND_ACTUAL_PRACTICE",
      "RP_CLASSIFICATION_ANALYSIS",
      "BSP_EVENT_TIME_RECONCILIATION",
      "AUTHORISATION_EVENT_TIME_RECONCILIATION",
      "VARIANCE_MATRIX_REASON_METHOD_DURATION_FREQUENCY",
      "WORKER_PROVIDER_COMPETENCY_AUTHORITY",
      "PARTICIPANT_IMPACT_VOICE_AND_RIGHTS",
      "SAFEGUARDING_INCIDENT_REPORTABILITY",
      "CAUSES_CORRECTION_CAPA_AND_REVIEW",
      "PROFESSIONAL_FINDING_AND_CLOSURE",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("participant name");
    expect(sectionByCode("EXECUTIVE_OUTCOME").description).toContain("overall professional finding");
  });

  it("4. represents the critical reasoning boundary and event-time rule", () => {
    expect(sectionByCode("EVENT_CHRONOLOGY_AND_ACTUAL_PRACTICE").instructions).toContain("Establish what actually occurred before deciding whether it was unauthorised");
    expect(sectionByCode("RP_CLASSIFICATION_ANALYSIS").instructions).toContain("Never reason that RP occurred therefore unauthorised RP occurred");
    expect(sectionByCode("BSP_EVENT_TIME_RECONCILIATION").instructions).toContain("BSP inclusion is not authorisation");
    expect(sectionByCode("AUTHORISATION_EVENT_TIME_RECONCILIATION").instructions).toContain("Authorisation granted after the event does not retrospectively authorise");
    expect(sectionByCode("AUTHORISATION_EVENT_TIME_RECONCILIATION").instructions).toContain("actual authoritative evidence");
  });

  it("5. requires exact implementation reconciliation beyond category match", () => {
    const matrix = sectionByCode("VARIANCE_MATRIX_REASON_METHOD_DURATION_FREQUENCY");
    expect(matrix.description).toContain("reason");
    expect(matrix.description).toContain("method");
    expect(matrix.description).toContain("duration");
    expect(matrix.description).toContain("frequency");
    expect(matrix.description).toContain("provider");
    expect(matrix.instructions).toContain("Do not treat category match as compliance");
  });

  it("6. includes participant voice, safeguarding, CAPA and defensible finding outcomes", () => {
    expect(sectionByCode("PARTICIPANT_IMPACT_VOICE_AND_RIGHTS").instructions).toContain("Participant voice is mandatory");
    expect(sectionByCode("SAFEGUARDING_INCIDENT_REPORTABILITY").instructions).toContain("Distinguish event occurred, incident recorded, reportability assessed");
    expect(sectionByCode("CAUSES_CORRECTION_CAPA_AND_REVIEW").instructions).toContain("ROOT_CAUSE_NOT_YET_ESTABLISHED");
    expect(sectionByCode("CAUSES_CORRECTION_CAPA_AND_REVIEW").instructions).toContain("Correction is not corrective action");
    expect(sectionByCode("PROFESSIONAL_FINDING_AND_CLOSURE").instructions).toContain("UNAUTHORISED_RESTRICTIVE_PRACTICE_ESTABLISHED");
    expect(sectionByCode("PROFESSIONAL_FINDING_AND_CLOSURE").instructions).toContain("INSUFFICIENT_OR_CONFLICTING_EVIDENCE");
  });
});

describe("Sprint 34L.6 evidence, deliverable and completion gates", () => {
  it("7. requires event-time incident, RP, BSP and authorisation evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["incident_record", "restrictive_practice_record", "behaviour_support_plan", "authorisation_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "case_note",
        "rp_usage_record",
        "rp_register",
        "medication_record",
        "training_record",
        "corrective_action_record",
      ]),
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("8. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "participant" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("9. binds the existing template-bound DOCX artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.templateVersionPolicy).toBe("pin_at_execution");
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
      primaryDeliverable: "unauthorised_restrictive_practice_review",
      namingConvention: "UNAUTHORISED_RP_REVIEW_{participant}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "formal_reportability_determination",
        "external_regulatory_submission",
        "formal_authorisation",
        "behaviour_support_plan",
        "legal_determination",
        "disciplinary_finding",
      ]),
    });
  });

  it("10. blocks completion when artifact, template or ISS approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("11. passes runtime validation when required evidence, sections, artifact, template and ISS approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.6 authority boundaries", () => {
  it("12. KDS can package artifacts but cannot change the professional RP finding", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "knowledge_documentation_specialist",
      workerProfile: profile("knowledge_documentation_specialist_profile"),
      actionIdentifier: "change_restrictive_practice_conclusion",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("13. ISS may draft safeguarding review but cannot authorise RP", () => {
    const iss = profile("incident_safeguarding_specialist_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "draft_safeguarding_review",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const authorisationDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "authorise_restrictive_practice",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(authorisationDecision.decision).toBe("PROHIBITED");
  });
});
