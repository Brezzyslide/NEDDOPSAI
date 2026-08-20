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
const CAPA_CODE = "corrective_action_improvement";

function blueprintFromRegistry(code = CAPA_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = CAPA_CODE): BlueprintSection[] {
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
  id: "tpl-capa-effectiveness",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "corrective_preventive_action_plan_effectiveness_review_template",
  title: "Corrective & Preventive Action Plan and Effectiveness Review",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/corrective-preventive-action-plan-effectiveness-review.docx",
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
    mode: "corrective_action",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified CAPA evidence, trigger source, problem definition, requirement actual gap, risk materiality, containment, correction, evidence collection, root cause or ROOT_CAUSE_NOT_YET_ESTABLISHED, contributing factors, previous CAPA review, corrective action, preventive action, role owner, due date, implementation evidence, effectiveness test, sustainability, reopen logic, closure approval and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l11",
    organisationId: "org-34l11",
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
      query: "corrective preventive action effectiveness review evidence",
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
    artifactId: "artifact-34l11",
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

describe("Sprint 34L.11 corrective action improvement method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for CAPA only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("compliance_quality_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(CAPA_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves CQM ownership and restrained supporting specialists", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(CAPA_CODE)!)).toBe("compliance_quality_manager");
    expect(blueprint.primarySpecialist).toBe("compliance_quality_manager");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "incident_safeguarding_specialist",
      "operations_manager",
      "process_asset_coordinator",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.11 approved CAPA method representation", () => {
  it("3. binds the authoritative CAPA work-product structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_CAPA_OUTCOME",
      "TRIGGER_AND_PROBLEM_DEFINITION",
      "REQUIREMENT_ACTUAL_GAP",
      "RISK_MATERIALITY_AND_CAPA_DEPTH",
      "IMMEDIATE_CONTAINMENT",
      "CORRECTION",
      "EVIDENCE_COLLECTION_AND_SOURCE_DISCOVERY",
      "ROOT_CAUSE_AND_CONTRIBUTING_FACTORS",
      "PREVIOUS_OCCURRENCE_TREND_AND_PRIOR_CAPA",
      "CORRECTIVE_ACTION_DESIGN",
      "PREVENTIVE_ACTION_DESIGN",
      "OWNERS_DUE_DATES_AND_AUTHORITY",
      "IMPLEMENTATION_AND_EFFECTIVENESS_REVIEW",
      "REOPEN_SUSTAINABILITY_AND_CLOSURE",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("CAPA reference");
    expect(sectionByCode("EXECUTIVE_CAPA_OUTCOME").description).toContain("effectiveness state");
  });

  it("4. preserves correction, corrective action and preventive action distinctions", () => {
    expect(sectionByCode("IMMEDIATE_CONTAINMENT").instructions).toContain("temporary risk control");
    expect(sectionByCode("CORRECTION").instructions).toContain("Correction fixes the detected problem only");
    expect(sectionByCode("CORRECTIVE_ACTION_DESIGN").instructions).toContain("address an identified cause");
    expect(sectionByCode("PREVENTIVE_ACTION_DESIGN").instructions).toContain("Preventive action must be risk-based");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "correction_corrective_preventive_distinction_preserved" }),
    ]));
  });

  it("5. requires problem definition, requirement gap and risk-based depth", () => {
    expect(sectionByCode("TRIGGER_AND_PROBLEM_DEFINITION").instructions).toContain("Define the problem before solving it");
    expect(sectionByCode("TRIGGER_AND_PROBLEM_DEFINITION").instructions).toContain("staff need more training");
    expect(sectionByCode("REQUIREMENT_ACTUAL_GAP").description).toContain("Required or expected state");
    expect(sectionByCode("RISK_MATERIALITY_AND_CAPA_DEPTH").instructions).toContain("Use existing risk/materiality architecture");
  });

  it("6. prevents invented root cause and default training CAPA", () => {
    const rootCause = sectionByCode("ROOT_CAUSE_AND_CONTRIBUTING_FACTORS");
    expect(rootCause.instructions).toContain("Do not invent root cause");
    expect(rootCause.instructions).toContain("ROOT_CAUSE_NOT_YET_ESTABLISHED");
    expect(rootCause.instructions).toContain("Do not stop at human error");
    expect(rootCause.instructions).toContain("retrain staff");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "root_cause_not_invented" }),
    ]));
  });

  it("7. requires prior occurrence, effectiveness and reopen logic", () => {
    expect(sectionByCode("PREVIOUS_OCCURRENCE_TREND_AND_PRIOR_CAPA").instructions).toContain("Recurrence after prior CAPA requires deeper review");
    expect(sectionByCode("IMPLEMENTATION_AND_EFFECTIVENESS_REVIEW").instructions).toContain("Action completed does not mean problem solved");
    expect(sectionByCode("IMPLEMENTATION_AND_EFFECTIVENESS_REVIEW").instructions).toContain("NOT_YET_TESTED");
    expect(sectionByCode("REOPEN_SUSTAINABILITY_AND_CLOSURE").instructions).toContain("reopen and reassess");
    expect(sectionByCode("REOPEN_SUSTAINABILITY_AND_CLOSURE").instructions).toContain("Closure requires evidence");
  });
});

describe("Sprint 34L.11 evidence, deliverable and completion gates", () => {
  it("8. requires CAPA and trigger-source evidence with broad optional discovery", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["capa_record", "trigger_source_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "incident_record",
        "incident_investigation",
        "incident_review",
        "safeguarding_assessment",
        "complaint_record",
        "internal_audit",
        "external_audit",
        "regulator_finding",
        "risk_register",
        "continuous_improvement_register",
        "previous_capa_record",
        "effectiveness_review",
        "trend_data",
      ]),
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("9. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "capa_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Corrective & Preventive Action Plan and Effectiveness Review");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "corrective_preventive_action_plan_effectiveness_review",
      namingConvention: "CAPA_EFFECTIVENESS_{issue}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "quality_certification",
        "incident_closure",
        "external_regulatory_submission",
        "legal_determination",
        "disciplinary_finding",
        "clinical_determination",
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

describe("Sprint 34L.11 authority boundaries", () => {
  it("13. KDS cannot rewrite CAPA effectiveness conclusions", () => {
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

  it("14. CQM can draft CAPA but high-risk closure remains approval-gated and regulatory submission prohibited", () => {
    const cqm = profile("compliance_quality_manager_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: cqm,
      actionIdentifier: "draft_capa_effectiveness_review",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const closeDecision = evaluateWorkerProfileAuthority({
      specialistCode: "compliance_quality_manager",
      workerProfile: cqm,
      actionIdentifier: "close_high_risk_corrective_action",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
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
    expect(closeDecision.decision).toBe("APPROVAL_REQUIRED");
    expect(submitDecision.decision).toBe("PROHIBITED");
  });
});
