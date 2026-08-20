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
const ASSET_CODE = "asset_lifecycle_review";

function blueprintFromRegistry(code = ASSET_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = ASSET_CODE): BlueprintSection[] {
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
  id: "tpl-asset-lifecycle-review",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "asset_lifecycle_review_template",
  title: "Asset Lifecycle & Control Review",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/asset-lifecycle-review.docx",
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
    mode: "lifecycle_review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with asset scope, asset register reconciliation, identity, ownership, location, custody, criticality, service dependency, lifecycle stage, inspection, service, maintenance, condition, defects, restrictions, safety, compliance, operational fitness, maintenance closure verification, repair versus replacement, remaining useful life, lifecycle determination, register update, reassessment, approvals and evidence provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l25",
    organisationId: "org-34l25",
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
      text: `${category} asset evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "asset lifecycle evidence",
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

describe("Sprint 34L.25 asset lifecycle method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for asset lifecycle only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("process_asset_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(ASSET_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Process & Asset ownership and focused supporting specialists", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(ASSET_CODE)!)).toBe("process_asset_coordinator");
    expect(blueprint.primarySpecialist).toBe("process_asset_coordinator");
    expect(blueprint.supportingSpecialists).toEqual([
      "operations_manager",
      "finance_officer",
      "compliance_quality_manager",
      "service_delivery_coordinator",
      "knowledge_documentation_specialist",
    ]);
  });

  it("3. remains deterministically routed by asset lifecycle intent", () => {
    expect(resolveIntent("asset.lifecycle_review")).toMatchObject({ code: ASSET_CODE });
  });
});

describe("Sprint 34L.25 approved asset lifecycle method representation", () => {
  it("4. binds the approved register-to-reassessment lifecycle sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "ASSET_REVIEW_SCOPE",
      "ASSET_REGISTER_RECONCILIATION",
      "ASSET_IDENTITY_OWNERSHIP_LOCATION_AND_CUSTODY",
      "CRITICALITY_AND_SERVICE_DEPENDENCY",
      "LIFECYCLE_STAGE_AND_EXPECTED_USE",
      "INSPECTION_SERVICE_AND_MAINTENANCE_HISTORY",
      "CONDITION_DEFECTS_AND_RESTRICTIONS",
      "SAFETY_COMPLIANCE_AND_EXTERNAL_AUTHORITY",
      "OPERATIONAL_FITNESS_AND_AVAILABLE_USE",
      "MAINTENANCE_CLOSURE_VERIFICATION",
      "REPAIR_REPLACEMENT_AND_REMAINING_USEFUL_LIFE",
      "LIFECYCLE_DETERMINATION_AND_RECOMMENDATION",
      "REGISTER_UPDATE_REASSESSMENT_AND_APPROVAL",
      "PROFESSIONAL_CONCLUSION_AND_PROVENANCE",
    ]);
  });

  it("5. covers asset register reconciliation, identity, ownership, location and custody", () => {
    expect(sectionByCode("ASSET_REGISTER_RECONCILIATION").description).toContain("Register entry");
    expect(sectionByCode("ASSET_REGISTER_RECONCILIATION").instructions).toContain("does not by itself prove physical location");
    expect(sectionByCode("ASSET_IDENTITY_OWNERSHIP_LOCATION_AND_CUSTODY").description).toContain("ownership");
    expect(sectionByCode("ASSET_IDENTITY_OWNERSHIP_LOCATION_AND_CUSTODY").description).toContain("current physical location");
  });

  it("6. covers criticality, lifecycle stage, inspection, service and maintenance", () => {
    expect(sectionByCode("CRITICALITY_AND_SERVICE_DEPENDENCY").description).toContain("Operational criticality");
    expect(sectionByCode("LIFECYCLE_STAGE_AND_EXPECTED_USE").description).toContain("end-of-life");
    expect(sectionByCode("INSPECTION_SERVICE_AND_MAINTENANCE_HISTORY").description).toContain("planned maintenance");
    expect(sectionByCode("INSPECTION_SERVICE_AND_MAINTENANCE_HISTORY").instructions).toContain("does not prove the defect is closed");
  });

  it("7. covers condition, safety/compliance and operational fitness without certification", () => {
    expect(sectionByCode("CONDITION_DEFECTS_AND_RESTRICTIONS").description).toContain("Observed condition");
    expect(sectionByCode("SAFETY_COMPLIANCE_AND_EXTERNAL_AUTHORITY").instructions).toContain("must not issue licensed");
    expect(sectionByCode("OPERATIONAL_FITNESS_AND_AVAILABLE_USE").description).toContain("fit for the intended operational use");
    expect(sectionByCode("OPERATIONAL_FITNESS_AND_AVAILABLE_USE").instructions).toContain("not mark an asset available merely because it is owned");
  });

  it("8. covers maintenance closure, repair/replacement, useful life and register update", () => {
    expect(sectionByCode("MAINTENANCE_CLOSURE_VERIFICATION").instructions).toContain("VERIFIED_CLOSED");
    expect(sectionByCode("REPAIR_REPLACEMENT_AND_REMAINING_USEFUL_LIFE").description).toContain("expected remaining useful life");
    expect(sectionByCode("LIFECYCLE_DETERMINATION_AND_RECOMMENDATION").description).toContain("replacement planning required");
    expect(sectionByCode("REGISTER_UPDATE_REASSESSMENT_AND_APPROVAL").description).toContain("Recommended register update");
  });
});

describe("Sprint 34L.25 asset evidence, deliverable and authority boundaries", () => {
  it("9. adds an asset-lifecycle-specific evidence contract", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    expect(contract.requiredEvidenceCategories).toEqual([
      "asset_register",
      "maintenance_record",
      "inspection_record",
    ]);
    expect(contract.optionalEvidenceCategories).toEqual(expect.arrayContaining([
      "asset_record",
      "custody_record",
      "location_record",
      "condition_record",
      "safety_record",
      "replacement_record",
      "criticality_record",
      "approval_record",
      "current_authority",
    ]));
    expect(contract.requiredEntityTypes).toEqual(["asset"]);
    expect(contract.freshnessRules).toMatchObject({
      assetRegisterDoesNotProvePhysicalState: true,
      maintenanceLoggedDoesNotProveClosure: true,
      inspectionEvidenceRequiredForConditionClaims: true,
      replacementDecisionRequiresAuthority: true,
    });
  });

  it("10. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "asset_register" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. blocks completion when inspection or maintenance evidence is missing", () => {
    const result = validate({ evidencePack: evidencePack(["asset_register"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("12. remains structured analysis and does not require artifact rendering", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: false,
      primaryFormat: "structured_analysis",
      templateRequired: false,
    });
    expect(blueprint.templateRequired).toBe(false);
    expect(validate({ contract: contractFor(null) }).failures.some((failure) => failure.gate === "template_required")).toBe(false);
  });

  it("13. prohibits procurement, disposal, certification, accounting and register mutation", () => {
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "procurement_approval",
      "disposal_approval",
      "write_off_approval",
      "safety_certification",
      "technical_certification",
      "fire_safety_certification",
      "clinical_certification",
      "accounting_treatment",
      "financial_approval",
      "asset_register_mutation",
      "maintenance_closure_without_evidence",
    ]));
  });

  it("14. validates closure, certification and register-update authority boundaries", () => {
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "approved_asset_lifecycle_method_applied" }),
      expect.objectContaining({ rule: "asset_register_does_not_prove_physical_state" }),
      expect.objectContaining({ rule: "maintenance_closure_requires_verification" }),
      expect.objectContaining({ rule: "safety_compliance_and_technical_certification_boundaries_preserved" }),
      expect.objectContaining({ rule: "register_update_and_lifecycle_action_not_mutated_without_authority" }),
    ]));
  });

  it("15. routes lifecycle conflicts and decisions to appropriate authority", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "asset_identity_location_or_custody_conflict", action: "clarify_asset_register_and_operational_evidence" }),
      expect.objectContaining({ trigger: "safety_technical_fire_whs_clinical_or_licensed_certification_required", action: "defer_to_external_or_domain_authority" }),
      expect.objectContaining({ trigger: "procurement_disposal_writeoff_or_accounting_decision_required", action: "defer_to_finance_operations_or_authorised_approval" }),
      expect.objectContaining({ trigger: "maintenance_closure_or_return_to_service_unverified", action: "require_closure_verification_before_marking_complete" }),
      expect.objectContaining({ trigger: "register_update_or_lifecycle_state_change_required", action: "prepare_recommendation_without_mutating_register" }),
    ]));
  });
});
