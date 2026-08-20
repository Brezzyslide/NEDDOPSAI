import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
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
const SOP_CODE = "standard_operating_procedure";

function blueprintFromRegistry(code = SOP_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = SOP_CODE): BlueprintSection[] {
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
  id: "tpl-standard-operating-procedure",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "standard_operating_procedure_template",
  title: "Standard Operating Procedure",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/standard-operating-procedure.docx",
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
    mode: "create",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with the procedural question, authoritative sources, governing requirements, scope, users, roles, responsibilities, authority, competency, authorisation, preconditions, inputs, normal operating sequence, verification points, decision points, stop conditions, exception handling, escalation, records, completion criteria, monitoring, review triggers, related documents, unresolved procedural definitions, artifact handoff and evidence provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l23",
    organisationId: "org-34l23",
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
      text: `${category} SOP evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "standard operating procedure evidence",
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
    artifactId: "artifact-34l23",
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

describe("Sprint 34L.23 SOP method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for SOP only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("process_asset_owner", true);
    expect(blueprint.requiredApprovals).toHaveProperty("controlled_document_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(SOP_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Process & Asset ownership and controlled-document approval", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(SOP_CODE)!)).toBe("process_asset_coordinator");
    expect(blueprint.primarySpecialist).toBe("process_asset_coordinator");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "operations_manager",
      "policy_governance_specialist",
      "compliance_quality_manager",
      "service_delivery_coordinator",
      "authorised_program_officer",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });

  it("3. remains deterministically routed by SOP intents", () => {
    expect(resolveIntent("operations.sop.create")).toMatchObject({ code: SOP_CODE });
    expect(resolveIntent("operations.sop.review")).toMatchObject({ code: SOP_CODE });
    expect(resolveIntent("process.sop")).toMatchObject({ code: SOP_CODE });
    expect(resolveIntent("process.work_instruction")).toMatchObject({ code: SOP_CODE });
  });
});

describe("Sprint 34L.23 approved SOP method representation", () => {
  it("4. binds the approved professional SOP sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "PROCEDURE_TITLE_PURPOSE_AND_QUESTION",
      "AUTHORITATIVE_SOURCES_AND_CURRENTNESS",
      "GOVERNING_REQUIREMENTS",
      "SCOPE_APPLICATION_AND_USERS",
      "ROLES_RESPONSIBILITIES_AND_AUTHORITY",
      "COMPETENCY_AUTHORISATION_AND_PRECONDITIONS",
      "REQUIRED_INPUTS_INFORMATION_AND_RESOURCES",
      "NORMAL_OPERATING_SEQUENCE",
      "VERIFICATION_AND_DECISION_POINTS",
      "STOP_CONDITIONS_AND_EXCEPTION_HANDLING",
      "ESCALATION_PATHWAY",
      "DOCUMENTATION_RECORDS_AND_EVIDENCE_CREATED",
      "COMPLETION_CLOSURE_AND_OBSERVABLE_END_STATE",
      "MONITORING_ASSURANCE_AND_REVIEW",
      "RELATED_DOCUMENTS_PROCESSES_AND_BOUNDARIES",
      "UNRESOLVED_PROCEDURAL_DEFINITIONS",
      "PROFESSIONAL_CONCLUSION_AND_ARTIFACT_HANDOFF",
    ]);
  });

  it("5. requires a concrete procedural question before drafting", () => {
    expect(sectionByCode("PROCEDURE_TITLE_PURPOSE_AND_QUESTION").instructions).toContain("Define the procedural question before drafting");
    expect(sectionByCode("PROCEDURE_TITLE_PURPOSE_AND_QUESTION").instructions).toContain("vague subject");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "approved_sop_method_applied" }),
    ]));
  });

  it("6. protects authority/currentness and prevents policy-only procedural invention", () => {
    expect(sectionByCode("AUTHORITATIVE_SOURCES_AND_CURRENTNESS").instructions).toContain("superseded instructions");
    expect(sectionByCode("GOVERNING_REQUIREMENTS").instructions).toContain("recommendations as existing procedure");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "authoritative_sources_and_currentness_verified" }),
      expect.objectContaining({ rule: "high_level_requirement_not_converted_to_invented_detail" }),
    ]));
  });

  it("7. preserves policy, procedure, process-analysis and document-assembly boundaries", () => {
    expect(sectionByCode("RELATED_DOCUMENTS_PROCESSES_AND_BOUNDARIES").instructions).toContain("Policy states what is required");
    expect(sectionByCode("RELATED_DOCUMENTS_PROCESSES_AND_BOUNDARIES").instructions).toContain("business_process_analysis analyses current operation");
    expect(sectionByCode("PROFESSIONAL_CONCLUSION_AND_ARTIFACT_HANDOFF").instructions).toContain("It does not publish");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "policy_procedure_process_analysis_and_document_assembly_boundaries_preserved" }),
    ]));
  });

  it("8. separates responsibility, competency, authorisation, approval and domain ownership", () => {
    expect(sectionByCode("ROLES_RESPONSIBILITIES_AND_AUTHORITY").instructions).toContain("RESPONSIBLE, COMPETENT, AUTHORISED, APPROVER");
    expect(sectionByCode("ROLES_RESPONSIBILITIES_AND_AUTHORITY").instructions).toContain("Process & Asset owns procedural operationalisation");
    expect(sectionByCode("COMPETENCY_AUTHORISATION_AND_PRECONDITIONS").instructions).toContain("mandatory prerequisite is absent");
  });

  it("9. requires executable steps, verification, decisions, stops, exceptions and escalation", () => {
    expect(sectionByCode("NORMAL_OPERATING_SEQUENCE").description).toContain("trigger, pre-check, action, verify, decision");
    expect(sectionByCode("VERIFICATION_AND_DECISION_POINTS").instructions).toContain("expose branching");
    expect(sectionByCode("STOP_CONDITIONS_AND_EXCEPTION_HANDLING").description).toContain("STOP - DO NOT PROCEED");
    expect(sectionByCode("ESCALATION_PATHWAY").instructions).toContain("Derive the hierarchy from tenant and domain evidence");
  });

  it("10. keeps records, completion, monitoring and unresolved definitions explicit", () => {
    expect(sectionByCode("DOCUMENTATION_RECORDS_AND_EVIDENCE_CREATED").instructions).toContain("Do not confuse the SOP itself with evidence");
    expect(sectionByCode("COMPLETION_CLOSURE_AND_OBSERVABLE_END_STATE").instructions).toContain("operationally observable");
    expect(sectionByCode("MONITORING_ASSURANCE_AND_REVIEW").instructions).toContain("Do not invent monitoring frequencies");
    expect(sectionByCode("UNRESOLVED_PROCEDURAL_DEFINITIONS").description).toContain("professional authority gap");
  });
});

describe("Sprint 34L.23 SOP evidence, deliverable and authority boundaries", () => {
  it("11. requires controlled document, process map and delegation evidence", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    expect(contract.requiredEvidenceCategories).toEqual([
      "controlled_document",
      "process_map",
      "delegation_record",
    ]);
    expect(contract.optionalEvidenceCategories).toEqual(expect.arrayContaining([
      "policy",
      "procedure",
      "manual",
      "professional_guidance",
      "clinical_instruction",
      "competency_record",
      "current_authority",
      "document_register",
    ]));
    expect(contract.freshnessRules).toMatchObject({
      currentnessRequired: true,
      policyAloneDoesNotDefineProcedure: true,
      recommendationsAreNotExistingProcedure: true,
      currentAuthorityRequiredForChangingExternalRequirements: true,
    });
  });

  it("12. keeps memory-only and user-assertion-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "controlled_document" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("13. blocks completion when required delegation/procedural authority evidence is missing", () => {
    const result = validate({ evidencePack: evidencePack(["controlled_document", "process_map"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("14. binds the existing DOCX/PDF artifact pathway without transferring professional ownership to KDS", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
    });
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(profile("knowledge_documentation_specialist_profile").prohibitedActions).toContain("rewrite_professional_conclusion");
    expect(blueprint.validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "artifact_packaging_does_not_transfer_ownership" }),
    ]));
  });

  it("15. prohibits policy changes, domain conclusions, publication and adjacent Blueprint deliverables", () => {
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "policy_change",
      "professional_domain_conclusion",
      "controlled_publication",
      "document_control_review",
      "controlled_document_assembly",
      "business_process_analysis",
      "clinical_determination",
      "restrictive_practice_authorisation",
      "payroll_interpretation",
      "financial_control_approval",
      "employment_decision",
      "compliance_certification",
    ]));
  });

  it("16. routes unclear professional meaning or missing procedure detail to the right authority", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "policy_or_professional_meaning_change_required", action: "defer_to_policy_or_domain_owner" }),
      expect.objectContaining({ trigger: "domain_professional_requirement_unclear", action: "defer_to_relevant_domain_specialist" }),
      expect.objectContaining({ trigger: "procedural_detail_missing_from_authority", action: "PROCEDURAL_DEFINITION_REQUIRED" }),
      expect.objectContaining({ trigger: "controlled_publication_or_supersession_required", action: "defer_to_controlled_document_assembly_or_document_control_review" }),
    ]));
  });
});
