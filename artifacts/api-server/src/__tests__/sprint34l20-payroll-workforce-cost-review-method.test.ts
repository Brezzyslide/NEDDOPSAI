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
const PAYROLL_CODE = "payroll_workforce_cost_review";

function blueprintFromRegistry(code = PAYROLL_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = PAYROLL_CODE): BlueprintSection[] {
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
  id: "tpl-payroll-workforce-cost",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "payroll_workforce_cost_reconciliation_review_template",
  title: "Payroll & Workforce Cost Reconciliation Review",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/payroll-workforce-cost-reconciliation-review.docx",
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
    mode: "reconciliation",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with payroll period, worker identity, employment context, scheduled work, actual work, timesheeted work, payroll-calculated state, paid state, classification, pay point, current authority, ordinary earnings, penalty, overtime, allowance, superannuation, PAYG withholding, long service leave, employer workforce cost, expected vs actual reconciliation, variance, underpayment, overpayment, correction, approval, follow-up evidence and unresolved specialist boundaries.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l20",
    organisationId: "org-34l20",
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
      query: "payroll workforce cost reconciliation evidence",
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
    artifactId: "artifact-34l20",
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

describe("Sprint 34L.20 payroll workforce cost method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for payroll only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("payroll_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(PAYROLL_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Payroll & Workforce Cost Officer ownership and restrained supports", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(PAYROLL_CODE)!)).toBe("payroll_workforce_cost_officer");
    expect(blueprint.primarySpecialist).toBe("payroll_workforce_cost_officer");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "workforce_rostering_coordinator",
      "workforce_compliance_specialist",
      "people_culture_manager",
      "finance_officer",
      "financial_planning_reporting_manager",
      "service_delivery_coordinator",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("financial_planning_reporting_manager");
  });
});

describe("Sprint 34L.20 approved payroll reconciliation method representation", () => {
  it("3. binds the approved Payroll & Workforce Cost Reconciliation sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "REVIEW_SCOPE_WORKER_IDENTITY_AND_CONTEXT",
      "SCHEDULED_ACTUAL_AND_TIMESHEETED_WORK",
      "CLASSIFICATION_RATE_AND_CURRENT_AUTHORITY_BASIS",
      "EXPECTED_EARNINGS_CALCULATION",
      "SUPERANNUATION_ASSESSMENT",
      "PAYG_TAX_WITHHOLDING_ASSESSMENT",
      "LONG_SERVICE_LEAVE_AND_LEAVE_ASSESSMENT",
      "EXPECTED_VS_ACTUAL_PAYROLL_RECONCILIATION",
      "VARIANCE_CAUSE_AND_RISK_ANALYSIS",
      "WORKFORCE_COST_AND_CROSS_BLUEPRINT_INTERFACES",
      "CORRECTION_REMEDIATION_AND_FOLLOW_UP",
      "PROFESSIONAL_CONCLUSION_AND_APPROVAL",
    ]);
  });

  it("4. keeps scheduled, actual, timesheeted, payroll, paid, super, tax and leave states separate", () => {
    const section = sectionByCode("SCHEDULED_ACTUAL_AND_TIMESHEETED_WORK");
    expect(section.description).toContain("Scheduled work");
    expect(section.description).toContain("actual work performed");
    expect(section.description).toContain("timesheeted/recorded work");
    expect(section.instructions).toContain("SCHEDULED");
    expect(section.instructions).toContain("PAYROLL-CALCULATED");
    expect(section.instructions).toContain("SUPERANNUATION ACCRUED/CONTRIBUTED");
    expect(section.instructions).toContain("TAX WITHHELD");
    expect(section.instructions).toContain("LEAVE ACCRUED");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "scheduled_actual_timesheeted_payroll_paid_super_tax_leave_states_distinguished" }),
    ]));
  });

  it("5. requires classification and current authority without hard-coded changing rates", () => {
    const section = sectionByCode("CLASSIFICATION_RATE_AND_CURRENT_AUTHORITY_BASIS");
    expect(section.description).toContain("Worker classification");
    expect(section.description).toContain("current-authority retrieval");
    expect(section.instructions).toContain("Do not hard-code changing SCHADS rates");
    expect(section.instructions).toContain("superannuation percentages");
    expect(section.instructions).toContain("PAYG tables");
    expect(section.instructions).toContain("LSL rules");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "current_authority_used_for_changing_payroll_parameters" }),
    ]));
  });

  it("6. uses deterministic calculations for ordinary, penalty, overtime and allowance components", () => {
    const section = sectionByCode("EXPECTED_EARNINGS_CALCULATION");
    expect(section.description).toContain("ordinary earnings");
    expect(section.description).toContain("penalty components");
    expect(section.description).toContain("overtime components");
    expect(section.description).toContain("allowances");
    expect(section.instructions).toContain("Use deterministic calculations");
    expect(section.instructions).toContain("Do not use LLM mental arithmetic");
  });

  it("7. treats superannuation, PAYG and LSL as first-class dimensions", () => {
    expect(sectionByCode("SUPERANNUATION_ASSESSMENT").instructions).toContain("Treat superannuation as first-class");
    expect(sectionByCode("SUPERANNUATION_ASSESSMENT").instructions).toContain("SUPER CONTRIBUTED");
    expect(sectionByCode("PAYG_TAX_WITHHOLDING_ASSESSMENT").instructions).toContain("not personal income-tax advice");
    expect(sectionByCode("PAYG_TAX_WITHHOLDING_ASSESSMENT").instructions).toContain("final personal income-tax liability");
    expect(sectionByCode("LONG_SERVICE_LEAVE_AND_LEAVE_ASSESSMENT").instructions).toContain("jurisdiction-specific current authority");
    expect(sectionByCode("LONG_SERVICE_LEAVE_AND_LEAVE_ASSESSMENT").instructions).toContain("universal LSL formula");
  });

  it("8. reconciles expected and actual payroll and supports variance outcome states", () => {
    expect(sectionByCode("EXPECTED_VS_ACTUAL_PAYROLL_RECONCILIATION").description).toContain("Expected gross payroll");
    expect(sectionByCode("EXPECTED_VS_ACTUAL_PAYROLL_RECONCILIATION").description).toContain("actual payment");
    expect(sectionByCode("VARIANCE_CAUSE_AND_RISK_ANALYSIS").description).toContain("potential underpayment");
    expect(sectionByCode("VARIANCE_CAUSE_AND_RISK_ANALYSIS").description).toContain("potential overpayment");
    expect(sectionByCode("VARIANCE_CAUSE_AND_RISK_ANALYSIS").instructions).toContain("Do not invent the cause");
  });

  it("9. preserves correction, workforce-cost and cross-Blueprint boundaries", () => {
    expect(sectionByCode("WORKFORCE_COST_AND_CROSS_BLUEPRINT_INTERFACES").instructions).toContain("Feed verified outputs to Finance/FP&R");
    expect(sectionByCode("WORKFORCE_COST_AND_CROSS_BLUEPRINT_INTERFACES").instructions).toContain("without transferring professional ownership");
    expect(sectionByCode("CORRECTION_REMEDIATION_AND_FOLLOW_UP").description).toContain("Correction identified");
    expect(sectionByCode("CORRECTION_REMEDIATION_AND_FOLLOW_UP").description).toContain("payment made");
    expect(sectionByCode("CORRECTION_REMEDIATION_AND_FOLLOW_UP").description).toContain("super contributed");
    expect(sectionByCode("CORRECTION_REMEDIATION_AND_FOLLOW_UP").instructions).toContain("Payroll correction must be evidenced");
  });
});

describe("Sprint 34L.20 evidence, deliverable and completion gates", () => {
  it("10. requires payroll, timesheet and employment evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["payroll_record", "timesheet", "employment_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "roster_schedule",
        "actual_work_record",
        "payslip",
        "payroll_export",
        "classification_record",
        "award_source",
        "current_authority",
        "superannuation_record",
        "payg_withholding_record",
        "long_service_leave_record",
        "payroll_correction_record",
        "finance_record",
      ]),
      requiredEntityTypes: ["worker"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("11. keeps memory-only payroll evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "payroll_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("12. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Payroll & Workforce Cost Reconciliation Review");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "payroll_workforce_cost_reconciliation_review",
      namingConvention: "PAYROLL_WORKFORCE_COST_RECONCILIATION_{worker}_{period}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "schads_legal_analysis",
        "tax_advice",
        "finance_report",
        "employment_review",
        "payrun_approval",
        "fund_transfer",
        "payroll_system_mutation",
        "personal_income_tax_advice",
        "legal_entitlement_determination",
      ]),
    });
  });

  it("13. blocks completion when artifact, template or Payroll approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("14. passes runtime validation when required evidence, sections, artifact, template and approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.20 authority boundaries", () => {
  it("15. KDS cannot rewrite payroll conclusions", () => {
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

  it("16. Payroll can draft reconciliation but cannot approve payrun, transfer funds or give tax advice", () => {
    const payroll = profile("payroll_workforce_cost_officer_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: payroll,
      actionIdentifier: "draft_payroll_workforce_cost_reconciliation_review",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const payrunDecision = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: payroll,
      actionIdentifier: "approve_payrun",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });
    const fundDecision = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: payroll,
      actionIdentifier: "transfer_funds",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });
    const taxDecision = evaluateWorkerProfileAuthority({
      specialistCode: "payroll_workforce_cost_officer",
      workerProfile: payroll,
      actionIdentifier: "provide_tax_agent_advice",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(payrunDecision.decision).toBe("PROHIBITED");
    expect(fundDecision.decision).toBe("PROHIBITED");
    expect(taxDecision.decision).toBe("PROHIBITED");
  });
});
