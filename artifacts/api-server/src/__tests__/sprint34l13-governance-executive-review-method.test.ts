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
const EXECUTIVE_CODE = "governance_executive_review";

function blueprintFromRegistry(code = EXECUTIVE_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = EXECUTIVE_CODE): BlueprintSection[] {
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
  id: "tpl-executive-governance-review",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "executive_governance_review_action_brief_template",
  title: "Executive Governance Review & Action Brief",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/executive-governance-review-action-brief.docx",
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
    mode: "executive",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified executive governance evidence, review period, governance structure, source currentness, previous executive actions, risk position, incident safeguarding compliance complaints restrictive practice participant service workforce financial operational policy CAPA evidence, designed implemented evidenced effective controls, cross-domain pattern analysis, contradictions, materiality, executive priority, decision support, action owner, due date, closure evidence, monitoring, assurance confidence and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l13",
    organisationId: "org-34l13",
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
      query: "executive governance review assurance evidence",
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
    artifactId: "artifact-34l13",
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

describe("Sprint 34L.13 executive governance review method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for executive review only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("executive_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(EXECUTIVE_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Chief of Staff synthesis ownership without domain-owner takeover", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(EXECUTIVE_CODE)!)).toBe("chief_of_staff");
    expect(blueprint.primarySpecialist).toBe("chief_of_staff");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "compliance_quality_manager",
      "operations_manager",
      "service_delivery_coordinator",
      "policy_governance_specialist",
      "incident_safeguarding_specialist",
      "process_asset_coordinator",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "cos_synthesis_not_domain_rewrite" }),
    ]));
  });
});

describe("Sprint 34L.13 approved executive review method representation", () => {
  it("3. binds the Executive Governance Review & Action Brief structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_DASHBOARD",
      "EXECUTIVE_SUMMARY",
      "REVIEW_PURPOSE_SCOPE_AND_PERIOD",
      "GOVERNANCE_STRUCTURE_ACCOUNTABILITY",
      "DESIGNED_IMPLEMENTED_EVIDENCED_EFFECTIVE_CONTROLS",
      "PREVIOUS_EXECUTIVE_ACTIONS",
      "RISK_AND_CONTROL_POSITION",
      "INCIDENTS_SAFEGUARDING_COMPLAINTS_AND_RP",
      "PARTICIPANT_SERVICE_WORKFORCE_AND_OPERATIONAL_ASSURANCE",
      "COMPLIANCE_REGULATORY_POLICY_AND_GOVERNANCE_ASSURANCE",
      "CONTINUOUS_IMPROVEMENT_CAPA_AND_ACTION_RECONCILIATION",
      "CROSS_DOMAIN_PATTERNS_AND_CONTRADICTIONS",
      "MATERIALITY_PRIORITY_AND_DECISION_SUPPORT",
      "EXECUTIVE_ACTIONS_MONITORING_AND_ASSURANCE_CONCLUSION",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("review period");
    expect(sectionByCode("EXECUTIVE_DASHBOARD").description).toContain("Governance");
  });

  it("4. requires executive synthesis rather than report concatenation", () => {
    expect(sectionByCode("EXECUTIVE_DASHBOARD").instructions).toContain("Do not force a finding");
    expect(sectionByCode("EXECUTIVE_SUMMARY").instructions).toContain("Keep this genuinely executive");
    expect(sectionByCode("EXECUTIVE_SUMMARY").instructions).toContain("generic governance is generally effective");
  });

  it("5. preserves governance structure and control effectiveness distinctions", () => {
    expect(sectionByCode("GOVERNANCE_STRUCTURE_ACCOUNTABILITY").instructions).toContain("Do not invent organisational authority");
    const controls = sectionByCode("DESIGNED_IMPLEMENTED_EVIDENCED_EFFECTIVE_CONTROLS");
    expect(controls.description).toContain("designed state");
    expect(controls.description).toContain("implemented state");
    expect(controls.description).toContain("effectiveness evidence");
    expect(controls.instructions).toContain("policy as proof");
  });

  it("6. covers material domain assurance without duplicating specialist Blueprints", () => {
    expect(sectionByCode("INCIDENTS_SAFEGUARDING_COMPLAINTS_AND_RP").instructions).toContain("Do not rerun incident");
    expect(sectionByCode("PARTICIPANT_SERVICE_WORKFORCE_AND_OPERATIONAL_ASSURANCE").instructions).toContain("Use relevant specialist findings");
    expect(sectionByCode("COMPLIANCE_REGULATORY_POLICY_AND_GOVERNANCE_ASSURANCE").instructions).toContain("current-authority architecture");
    expect(sectionByCode("CONTINUOUS_IMPROVEMENT_CAPA_AND_ACTION_RECONCILIATION").instructions).toContain("Do not close CAPA");
  });

  it("7. requires cross-domain pattern analysis, contradiction handling and decision support", () => {
    expect(sectionByCode("CROSS_DOMAIN_PATTERNS_AND_CONTRADICTIONS").instructions).toContain("Do not assume correlation establishes causation");
    expect(sectionByCode("CROSS_DOMAIN_PATTERNS_AND_CONTRADICTIONS").instructions).toContain("Material contradictions must be exposed");
    expect(sectionByCode("MATERIALITY_PRIORITY_AND_DECISION_SUPPORT").instructions).toContain("Do not manufacture executive urgency");
    expect(sectionByCode("MATERIALITY_PRIORITY_AND_DECISION_SUPPORT").instructions).toContain("bury required decisions");
  });
});

describe("Sprint 34L.13 evidence, deliverable and completion gates", () => {
  it("8. requires governance framework and assurance evidence with broad optional discovery", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["governance_framework", "assurance_evidence"],
      optionalEvidenceCategories: expect.arrayContaining([
        "organisation_chart",
        "delegation_record",
        "internal_audit",
        "external_audit",
        "risk_register",
        "continuous_improvement_register",
        "complaints_register",
        "incident_register",
        "safeguarding_review",
        "reportable_incident_record",
        "restrictive_practice_register",
        "capa_record",
        "financial_governance_report",
        "previous_governance_review",
        "outstanding_action",
      ]),
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("9. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "governance_framework" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Executive Governance Review & Action Brief");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "executive_governance_review_action_brief",
      namingConvention: "EXECUTIVE_GOVERNANCE_REVIEW_{organisation}_{period}",
      prohibitedDeliverables: expect.arrayContaining([
        "approval_decision",
        "policy_change",
        "investment_approval",
        "contract_commitment",
        "audit_finding",
        "incident_finding",
        "financial_determination",
        "hr_determination",
        "capa_closure",
      ]),
    });
  });

  it("11. blocks completion when artifact, template or executive approval is missing", () => {
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

describe("Sprint 34L.13 authority boundaries", () => {
  it("13. KDS cannot rewrite executive conclusions", () => {
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

  it("14. Chief of Staff can prepare internal synthesis but is not a superuser", () => {
    const chiefOfStaff = profile("chief_of_staff_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "chief_of_staff",
      workerProfile: chiefOfStaff,
      actionIdentifier: "prepare_executive_governance_brief",
      actionType: "create_file",
      executionChannel: "internal_api",
      toolCategory: "reporting_tools",
    });
    const externalDecision = evaluateWorkerProfileAuthority({
      specialistCode: "chief_of_staff",
      workerProfile: chiefOfStaff,
      actionIdentifier: "send_external_communication",
      actionType: "send_email",
      executionChannel: "email_system",
      toolCategory: "communication_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(externalDecision.decision).toBe("PROHIBITED");
  });
});
