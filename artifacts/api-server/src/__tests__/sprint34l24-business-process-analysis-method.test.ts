import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
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

const NOW = new Date("2026-08-19T00:00:00Z");
const PROCESS_CODE = "business_process_analysis";

function blueprintFromRegistry(code = PROCESS_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = PROCESS_CODE): BlueprintSection[] {
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
  id: "tpl-business-process-analysis",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "business_process_analysis_template",
  title: "Business Process Analysis",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/business-process-analysis.docx",
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
    mode: "process_analysis",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with process scope, expected outcome, evidence authority, documented process, observed process, current-state reconstruction, processing time, waiting time, metrics, roles, handoffs, decisions, controls, designed-vs-observed differences, process defects, risks, causes, value analysis, automation test, future-state process design, dependencies, priorities, measures, validation after change, domain handoffs and evidence provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l24",
    organisationId: "org-34l24",
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
      text: `${category} process evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "business process analysis evidence",
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
    artifactId: null,
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

describe("Sprint 34L.24 business process analysis method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for process analysis only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("process_asset_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(PROCESS_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Process & Asset ownership while adding relevant domain supports", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(PROCESS_CODE)!)).toBe("process_asset_coordinator");
    expect(blueprint.primarySpecialist).toBe("process_asset_coordinator");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "operations_manager",
      "compliance_quality_manager",
      "service_delivery_coordinator",
      "incident_safeguarding_specialist",
      "authorised_program_officer",
      "workforce_compliance_specialist",
      "payroll_workforce_cost_officer",
      "finance_officer",
      "people_culture_manager",
      "knowledge_documentation_specialist",
    ]));
  });

  it("3. remains deterministically routed by process-analysis intents", () => {
    expect(resolveIntent("operations.process_analysis")).toMatchObject({ code: PROCESS_CODE });
    expect(resolveIntent("process.map")).toMatchObject({ code: PROCESS_CODE });
    expect(resolveIntent("process.review")).toMatchObject({ code: PROCESS_CODE });
    expect(resolveIntent("process.workflow")).toMatchObject({ code: PROCESS_CODE });
    expect(resolveIntent("process.control_review")).toMatchObject({ code: PROCESS_CODE });
    expect(resolveIntent("process.handoff_review")).toMatchObject({ code: PROCESS_CODE });
  });
});

describe("Sprint 34L.24 approved process-analysis method representation", () => {
  it("4. binds the approved current-state to future-state sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "PROCESS_SCOPE_AND_BOUNDARIES",
      "EXPECTED_OUTCOME_AND_SUCCESS_STATE",
      "EVIDENCE_REVIEWED_AUTHORITY_AND_CURRENTNESS",
      "CURRENT_STATE_RECONSTRUCTION",
      "PROCESS_TIME_WAIT_TIME_AND_METRICS",
      "ROLES_HANDOFFS_AND_DECISION_POINTS",
      "CONTROL_POINTS_AND_NECESSARY_FRICTION",
      "DESIGNED_VS_OBSERVED_PROCESS",
      "FAILURE_FRICTION_AND_RISK_ANALYSIS",
      "ROOT_AND_CONTRIBUTING_CAUSE",
      "VALUE_CONTROL_AND_AUTOMATION_TEST",
      "IMPROVEMENT_OPPORTUNITIES",
      "FUTURE_STATE_PROCESS_DESIGN",
      "CURRENT_TO_FUTURE_GAP_AND_DEPENDENCIES",
      "IMPLEMENTATION_PRIORITY_AND_EFFECTIVENESS_MEASURES",
      "VALIDATION_AFTER_CHANGE_AND_HANDOFFS",
      "PROFESSIONAL_CONCLUSION",
    ]);
  });

  it("5. requires process scope and expected outcome before efficiency analysis", () => {
    expect(sectionByCode("PROCESS_SCOPE_AND_BOUNDARIES").instructions).toContain("Prevent scope creep");
    expect(sectionByCode("EXPECTED_OUTCOME_AND_SUCCESS_STATE").instructions).toContain("Do not assess efficiency before understanding successful completion");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "approved_business_process_analysis_method_applied" }),
    ]));
  });

  it("6. enforces documented-process vs actual-process separation", () => {
    expect(sectionByCode("CURRENT_STATE_RECONSTRUCTION").instructions).toContain("DOCUMENTED PROCESS is not ACTUAL PROCESS");
    expect(sectionByCode("DESIGNED_VS_OBSERVED_PROCESS").description).toContain("Designed process");
    expect(sectionByCode("DESIGNED_VS_OBSERVED_PROCESS").description).toContain("observed process");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "documented_process_not_equal_actual_process" }),
    ]));
  });

  it("7. treats process time, wait time and metrics as evidence-based calculations", () => {
    expect(sectionByCode("PROCESS_TIME_WAIT_TIME_AND_METRICS").description).toContain("Processing time");
    expect(sectionByCode("PROCESS_TIME_WAIT_TIME_AND_METRICS").description).toContain("waiting time");
    expect(sectionByCode("PROCESS_TIME_WAIT_TIME_AND_METRICS").instructions).toContain("Do not invent timings or metrics");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "processing_time_wait_time_and_metrics_evidence_required" }),
    ]));
  });

  it("8. makes handoffs, decisions and necessary controls first-class", () => {
    expect(sectionByCode("ROLES_HANDOFFS_AND_DECISION_POINTS").instructions).toContain("Handoffs are first-class analytical objects");
    expect(sectionByCode("ROLES_HANDOFFS_AND_DECISION_POINTS").instructions).toContain("professional decision authority");
    expect(sectionByCode("CONTROL_POINTS_AND_NECESSARY_FRICTION").instructions).toContain("Do not automatically classify controls as inefficiency");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "necessary_controls_not_treated_as_waste" }),
    ]));
  });

  it("9. separates observed causes, supported inferences and possible causes", () => {
    expect(sectionByCode("ROOT_AND_CONTRIBUTING_CAUSE").instructions).toContain("Do not invent causation");
    expect(sectionByCode("ROOT_AND_CONTRIBUTING_CAUSE").instructions).toContain("OBSERVED_CAUSE");
    expect(sectionByCode("PROFESSIONAL_CONCLUSION").instructions).toContain("supported inference");
  });

  it("10. requires automation recommendations to pass control and judgement tests", () => {
    expect(sectionByCode("VALUE_CONTROL_AND_AUTOMATION_TEST").description).toContain("professional judgement");
    expect(sectionByCode("VALUE_CONTROL_AND_AUTOMATION_TEST").description).toContain("segregation of duties");
    expect(sectionByCode("VALUE_CONTROL_AND_AUTOMATION_TEST").instructions).toContain("must not silently replace safeguarding");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "automation_recommendations_must_pass_control_test" }),
    ]));
  });
});

describe("Sprint 34L.24 process evidence, deliverable and authority boundaries", () => {
  it("11. requires process map, workflow and operational evidence", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    expect(contract.requiredEvidenceCategories).toEqual([
      "process_map",
      "workflow_record",
      "operational_record",
    ]);
    expect(contract.optionalEvidenceCategories).toEqual(expect.arrayContaining([
      "controlled_document",
      "policy",
      "sop",
      "audit_log",
      "timestamp_record",
      "staff_feedback",
      "capa_record",
      "continuous_improvement_record",
    ]));
    expect(contract.freshnessRules).toMatchObject({
      currentnessRequired: true,
      documentedProcessDoesNotProveActualProcess: true,
      timestampsRequiredForTimingClaims: true,
      metricsRequireSourceRecords: true,
    });
  });

  it("12. keeps memory-only and user-assertion-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "process_map" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("13. returns clarification when required actual-process evidence is missing", () => {
    const result = validate({ evidencePack: evidencePack(["process_map"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("14. remains structured analysis and does not require artifact rendering", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: false,
      primaryFormat: "structured_analysis",
      templateRequired: false,
    });
    expect(blueprint.templateRequired).toBe(false);
    expect(validate({ contract: contractFor(null) }).failures.some((failure) => failure.gate === "template_required")).toBe(false);
  });

  it("15. prohibits approvals, control bypass, adjacent deliverables and domain conclusions", () => {
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "operating_model_approval",
      "resource_allocation_approval",
      "control_bypass",
      "standard_operating_procedure",
      "policy_change",
      "professional_domain_conclusion",
      "automation_execution",
      "workflow_system_mutation",
      "payroll_interpretation",
      "workforce_compliance_determination",
      "restrictive_practice_determination",
      "incident_reportability_finding",
      "standalone_capa_deliverable",
    ]));
  });

  it("16. routes SOP, CAPA, implementation and domain-owner work without emitting unsolicited deliverables", () => {
    expect(sectionByCode("VALIDATION_AFTER_CHANGE_AND_HANDOFFS").instructions).toContain("Do not automatically generate separate CAPA or SOP deliverables");
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "domain_professional_decision_required", action: "defer_to_relevant_domain_owner" }),
      expect.objectContaining({ trigger: "sop_creation_or_amendment_required", action: "recommend_standard_operating_procedure_blueprint_without_emitting_unsolicited_sop" }),
      expect.objectContaining({ trigger: "control_failure_or_systemic_weakness_identified", action: "recommend_capa_or_continuous_improvement_pathway_without_unsolicited_deliverable" }),
      expect.objectContaining({ trigger: "automation_or_workflow_execution_requested", action: "require_authorised_implementation_workflow" }),
    ]));
  });
});
