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
const INCIDENT_INVESTIGATION_CODE = "incident_investigation";

function blueprintFromRegistry(code = INCIDENT_INVESTIGATION_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = INCIDENT_INVESTIGATION_CODE): BlueprintSection[] {
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
  id: "tpl-incident-investigation",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "participant_incident_investigation_report_template",
  title: "Participant Incident Investigation Report",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/participant-incident-investigation-report.docx",
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
    mode: "investigation",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified investigation evidence, allegations, accounts, chronology, provenance, contradictions, objective evidence, applicable requirements, issue-by-issue analysis, findings, rationale, procedural gaps, ongoing risk, actions, approval status and unresolved matters.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l7",
    organisationId: "org-34l7",
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
      query: "participant incident investigation evidence",
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
    artifactId: "artifact-34l7",
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

describe("Sprint 34L.7 incident investigation method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for incident investigation only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("incident_safeguarding_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(INCIDENT_INVESTIGATION_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves ISS ownership and supporting-specialist authority boundaries", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(INCIDENT_INVESTIGATION_CODE)!)).toBe("incident_safeguarding_specialist");
    expect(blueprint.primarySpecialist).toBe("incident_safeguarding_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "compliance_quality_manager",
      "service_delivery_coordinator",
      "authorised_program_officer",
      "behaviour_support_implementation_specialist",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.7 approved incident investigation method representation", () => {
  it("3. binds the participant-specific investigation report structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_SUMMARY",
      "TRIGGER_THRESHOLD_AND_SCOPE",
      "IMMEDIATE_SAFEGUARDING",
      "CONFLICT_INDEPENDENCE_AND_INVESTIGATION_QUESTIONS",
      "EVIDENCE_PLAN_AND_PRESERVATION",
      "EVIDENCE_DOCTRINE_AND_CHRONOLOGY",
      "PARTICIPANT_ACCOUNT_CONTEXT_AND_DIGNITY",
      "WORKER_WITNESS_AND_OBJECTIVE_EVIDENCE",
      "CORROBORATION_CONTRADICTION_AND_SOURCE_WEIGHT",
      "APPLICABLE_REQUIREMENTS",
      "ISSUE_BY_ISSUE_ANALYSIS_AND_FINDINGS",
      "PROCEDURAL_FAILURE_PREVENTABILITY_AND_ONGOING_RISK",
      "CAUSES_ACTIONS_APPROVAL_AND_CLOSURE",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("investigation reference");
    expect(sectionByCode("EXECUTIVE_SUMMARY").description).toContain("key findings");
  });

  it("4. preserves the critical evidence doctrine and chronology requirements", () => {
    const doctrine = sectionByCode("EVIDENCE_DOCTRINE_AND_CHRONOLOGY");
    expect(doctrine.description).toContain("allegation");
    expect(doctrine.description).toContain("account");
    expect(doctrine.description).toContain("verified fact");
    expect(doctrine.description).toContain("inference");
    expect(doctrine.instructions).toContain("Never convert one evidence category into another without reasoning");
    expect(doctrine.instructions).toContain("must not simply paste case notes in date order");
  });

  it("5. represents participant voice, historical context and fair account handling", () => {
    const participant = sectionByCode("PARTICIPANT_ACCOUNT_CONTEXT_AND_DIGNITY");
    expect(participant.description).toContain("Participant account");
    expect(participant.description).toContain("communication support");
    expect(participant.instructions).toContain("Do not invent participant views");
    expect(participant.instructions).toContain("known presentation/history to automatically dismiss");
  });

  it("6. requires corroboration, contradiction register and issue-by-issue findings", () => {
    expect(sectionByCode("CORROBORATION_CONTRADICTION_AND_SOURCE_WEIGHT").instructions).toContain("same original allegation");
    expect(sectionByCode("CORROBORATION_CONTRADICTION_AND_SOURCE_WEIGHT").instructions).toContain("Material contradictions must show proposition");
    const findings = sectionByCode("ISSUE_BY_ISSUE_ANALYSIS_AND_FINDINGS");
    expect(findings.description).toContain("evidence supporting");
    expect(findings.description).toContain("evidence against");
    expect(findings.instructions).toContain("SUBSTANTIATED");
    expect(findings.instructions).toContain("UNABLE_TO_DETERMINE");
    expect(findings.instructions).toContain("PROCEDURAL_OR_SYSTEM_FAILURE_IDENTIFIED");
  });

  it("7. separates procedural failures, ongoing risk, root cause and actions", () => {
    expect(sectionByCode("PROCEDURAL_FAILURE_PREVENTABILITY_AND_ONGOING_RISK").instructions).toContain("unsubstantiated allegation does not erase established process failures");
    expect(sectionByCode("PROCEDURAL_FAILURE_PREVENTABILITY_AND_ONGOING_RISK").instructions).toContain("Final finding does not by itself answer ongoing risk");
    expect(sectionByCode("CAUSES_ACTIONS_APPROVAL_AND_CLOSURE").instructions).toContain("ROOT_CAUSE_NOT_YET_ESTABLISHED");
    expect(sectionByCode("CAUSES_ACTIONS_APPROVAL_AND_CLOSURE").instructions).toContain("Do not automatically blame worker or system");
    expect(sectionByCode("CAUSES_ACTIONS_APPROVAL_AND_CLOSURE").instructions).toContain("do not default to retrain staff");
  });
});

describe("Sprint 34L.7 evidence, deliverable and completion gates", () => {
  it("8. requires participant-specific incident, policy and participant evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["incident_record", "incident_policy", "participant_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "participant_account",
        "staff_statement",
        "witness_statement",
        "case_note",
        "medication_record",
        "restrictive_practice_record",
        "behaviour_support_plan",
        "cctv_record",
        "medical_record",
        "police_record",
        "capa_record",
      ]),
      requiredEntityTypes: ["incident", "participant"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("9. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "incident" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Participant Incident Investigation Report");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "participant_incident_investigation_report",
      namingConvention: "INCIDENT_INVESTIGATION_{participant}_{incident}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "legal_finding",
        "disciplinary_finding",
        "clinical_determination",
        "final_reportability_determination",
        "external_regulatory_submission",
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

  it("12. passes runtime validation when required evidence, sections, artifact, template and ISS approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.7 authority boundaries", () => {
  it("13. KDS cannot alter incident facts or investigation findings", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "knowledge_documentation_specialist",
      workerProfile: profile("knowledge_documentation_specialist_profile"),
      actionIdentifier: "alter_incident_fact",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("14. ISS can draft investigation output but cannot close serious incidents or submit externally", () => {
    const iss = profile("incident_safeguarding_specialist_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "draft_incident_investigation_report",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const closeDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "close_serious_incident",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
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

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(closeDecision.decision).toBe("PROHIBITED");
    expect(submitDecision.decision).toBe("PROHIBITED");
  });
});
