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
const BCP_CODE = "business_continuity_plan";

function blueprintFromRegistry(code = BCP_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = BCP_CODE): BlueprintSection[] {
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
  id: "tpl-business-continuity-plan",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "business_continuity_plan_template",
  title: "Business Continuity Plan",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/business-continuity-plan.docx",
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
    mode: "business_continuity",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with continuity scope, organisational context, evidence authority, critical functions, business impact, dependencies, single points of failure, disruption scenarios, minimum viable operating requirements, participant safety, safeguarding, continuity controls, activation authority, communication, escalation, recovery criteria, testing evidence, residual risks, actions, review triggers, provenance and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l21",
    organisationId: "org-34l21",
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
      query: "business continuity evidence",
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
    artifactId: "artifact-34l21",
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

describe("Sprint 34L.21 business continuity method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for BCP only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("operations_owner", true);
    expect(blueprint.requiredApprovals).toHaveProperty("executive_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(BCP_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Operations Manager ownership and restrained domain supports", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(BCP_CODE)!)).toBe("operations_manager");
    expect(blueprint.primarySpecialist).toBe("operations_manager");
    expect(blueprint.supportingSpecialists).toEqual([
      "workforce_rostering_coordinator",
      "process_asset_coordinator",
      "finance_officer",
      "payroll_workforce_cost_officer",
      "compliance_quality_manager",
      "incident_safeguarding_specialist",
      "service_delivery_coordinator",
      "knowledge_documentation_specialist",
    ]);
    expect(blueprint.primarySpecialist).not.toBe("chief_of_staff");
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });

  it("3. remains deterministically routed by the business-continuity intent", () => {
    expect(resolveIntent("disaster.business_continuity")).toMatchObject({ code: BCP_CODE });
  });
});

describe("Sprint 34L.21 approved business continuity method representation", () => {
  it("4. binds the approved critical-function-first continuity sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "EXECUTIVE_CONTINUITY_POSITION",
      "SCOPE_ORGANISATIONAL_CONTEXT_AND_TRIGGER",
      "EVIDENCE_REVIEWED_AUTHORITY_AND_CURRENTNESS",
      "CRITICAL_FUNCTION_PROFILE",
      "BUSINESS_IMPACT_ASSESSMENT",
      "DEPENDENCY_MAP",
      "SINGLE_POINTS_OF_FAILURE",
      "DISRUPTION_SCENARIO_ASSESSMENT",
      "MINIMUM_VIABLE_OPERATING_REQUIREMENTS",
      "PARTICIPANT_SAFETY_SAFEGUARDING_AND_PRIORITY_HIERARCHY",
      "CONTINUITY_STRATEGIES_AND_CONTROLS",
      "ACTIVATION_AND_DELEGATED_AUTHORITY",
      "COMMUNICATION_AND_ESCALATION",
      "RECOVERY_PRIORITIES_AND_RETURN_TO_NORMAL",
      "TESTING_EXERCISE_AND_EFFECTIVENESS_EVIDENCE",
      "RESIDUAL_RISKS_CONTINUITY_GAPS_AND_ACTIONS",
      "REVIEW_REASSESSMENT_AND_PROVENANCE",
    ]);
  });

  it("5. requires critical functions and dependency mapping before generic scenarios", () => {
    expect(sectionByCode("CRITICAL_FUNCTION_PROFILE").instructions).toContain("what must continue");
    expect(sectionByCode("CRITICAL_FUNCTION_PROFILE").instructions).toContain("Do not begin with a generic disaster list");
    expect(sectionByCode("DISRUPTION_SCENARIO_ASSESSMENT").instructions).toContain("Only test scenarios after critical functions and dependencies are understood");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "critical_functions_before_scenarios" }),
    ]));
  });

  it("6. protects RTOs, currentness, supersession and unresolved conflicts", () => {
    expect(sectionByCode("BUSINESS_IMPACT_ASSESSMENT").instructions).toContain("RECOVERY_OBJECTIVE_NOT_ESTABLISHED");
    expect(sectionByCode("EVIDENCE_REVIEWED_AUTHORITY_AND_CURRENTNESS").instructions).toContain("source identity");
    expect(sectionByCode("EVIDENCE_REVIEWED_AUTHORITY_AND_CURRENTNESS").instructions).toContain("supersession");
    expect(sectionByCode("EVIDENCE_REVIEWED_AUTHORITY_AND_CURRENTNESS").instructions).toContain("Newer does not automatically supersede");
  });

  it("7. distinguishes redundancy, single points of failure, controls and tested effectiveness", () => {
    expect(sectionByCode("SINGLE_POINTS_OF_FAILURE").instructions).toContain("REDUNDANCY_VERIFIED");
    expect(sectionByCode("SINGLE_POINTS_OF_FAILURE").instructions).toContain("SINGLE_POINT_OF_FAILURE_IDENTIFIED");
    expect(sectionByCode("CONTINUITY_STRATEGIES_AND_CONTROLS").instructions).toContain("Policy statement alone does not prove implementation");
    expect(sectionByCode("TESTING_EXERCISE_AND_EFFECTIVENESS_EVIDENCE").instructions).toContain("PLAN_DOCUMENTED");
    expect(sectionByCode("TESTING_EXERCISE_AND_EFFECTIVENESS_EVIDENCE").instructions).toContain("CONTROL_EFFECTIVE");
  });

  it("8. preserves participant safety, activation authority and return-to-normal distinctions", () => {
    expect(sectionByCode("PARTICIPANT_SAFETY_SAFEGUARDING_AND_PRIORITY_HIERARCHY").description).toContain("participant safety");
    expect(sectionByCode("ACTIVATION_AND_DELEGATED_AUTHORITY").description).toContain("Activation trigger");
    expect(sectionByCode("ACTIVATION_AND_DELEGATED_AUTHORITY").instructions).toContain("Use organisation-specific delegation evidence");
    expect(sectionByCode("RECOVERY_PRIORITIES_AND_RETURN_TO_NORMAL").instructions).toContain("SERVICE_AVAILABLE");
    expect(sectionByCode("RECOVERY_PRIORITIES_AND_RETURN_TO_NORMAL").instructions).toContain("NORMAL_OPERATIONS_RESTORED");
  });
});

describe("Sprint 34L.21 evidence, deliverable and authority boundaries", () => {
  it("9. requires authoritative continuity, operational, governance and delegation evidence", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    expect(contract.requiredEvidenceCategories).toEqual([
      "controlled_document",
      "operational_record",
      "governance_framework",
      "delegation_record",
    ]);
    expect(contract.optionalEvidenceCategories).toEqual(expect.arrayContaining([
      "disaster_emergency_management_plan",
      "risk_register",
      "roster_schedule",
      "financial_record",
      "payroll_record",
      "exercise_record",
      "capa_record",
      "current_authority",
    ]));
    expect(contract.freshnessRules).toMatchObject({
      currentnessRequired: true,
      policyStatementDoesNotProveControlImplemented: true,
      testingEvidenceRequiredForEffectivenessClaims: true,
      currentAuthorityRequiredForChangingExternalObligations: true,
    });
  });

  it("10. keeps memory-only and user-assertion-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "controlled_document" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. blocks completion when required governance/delegation evidence is missing", () => {
    const result = validate({ evidencePack: evidencePack(["controlled_document", "operational_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("12. binds the existing downstream DOCX/PDF artifact contract without making Blueprint a renderer", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
    });
    expect(blueprint.validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "artifact_downstream_not_blueprint_method" }),
    ]));
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("13. prohibits certification, resource approval, unrelated disaster/risk/CAPA deliverables and commitments", () => {
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "business_continuity_certification",
      "resource_allocation_approval",
      "contract_commitment",
      "emergency_services_determination",
      "clinical_determination",
      "whs_certification",
      "standalone_risk_assessment",
      "standalone_capa_deliverable",
      "disaster_emergency_management_plan",
    ]));
    expect(getRegistryEntry(BCP_CODE)?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "business-continuity certification",
      "resource allocation decision",
      "contract commitment",
      "legal advice",
      "emergency-services determination",
    ]));
  });

  it("14. KDS packaging support cannot rewrite professional continuity conclusions", () => {
    const kds = profile("knowledge_documentation_specialist_profile");
    expect(kds.prohibitedActions).toContain("rewrite_professional_conclusion");
    expect(kds.approvalRequiredActions).toContain("generate_controlled_docx_pdf_artifact");
  });

  it("15. residual continuity weakness feeds existing risk/CAPA/governance workflows without unsolicited extra deliverables", () => {
    expect(sectionByCode("RESIDUAL_RISKS_CONTINUITY_GAPS_AND_ACTIONS").instructions).toContain("do not emit unsolicited standalone CAPA");
    expect(blueprintFromRegistry().deliverableContract?.allowedInternalAnalysis).toEqual(expect.arrayContaining([
      "residual_gap_review",
      "single_point_of_failure_review",
    ]));
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "standalone_risk_assessment",
      "standalone_capa_deliverable",
    ]));
  });
});
