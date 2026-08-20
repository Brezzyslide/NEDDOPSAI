import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  LEGACY_CODE_MAP,
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

const NOW = new Date("2026-08-18T00:00:00Z");

const CLOSEOUT_CODES = [
  "funding_utilisation_review",
  "site_environmental_risk_assessment",
  "fire_risk_assessment",
  "disaster_emergency_management_plan",
  "business_continuity_plan",
  "governance_executive_review",
  "formal_stakeholder_correspondence",
  "complaints_review_response",
] as const;

const STILL_METHOD_PENDING_CLOSEOUT_CODES = CLOSEOUT_CODES.filter(
  (code) => ![
    "funding_utilisation_review",
    "site_environmental_risk_assessment",
    "fire_risk_assessment",
    "disaster_emergency_management_plan",
    "business_continuity_plan",
    "governance_executive_review",
    "formal_stakeholder_correspondence",
    "complaints_review_response",
  ].includes(code),
);

function blueprintFromRegistry(code: string): WorkBlueprint {
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

function sectionsFromRegistry(code: string): BlueprintSection[] {
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
  id: "tpl-34j",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "closeout_template",
  title: "Close-Out Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/closeout.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: NOW,
  updatedAt: NOW,
};

function contractFor(code: string, templateOverride: WorkTemplate | null = template): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(code),
    sections: sectionsFromRegistry(code),
    template: templateOverride,
    mode: "review",
  };
}

function contentFor(code: string): string {
  return sectionsFromRegistry(code)
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with source-backed evidence, visible USER_DEFINITION_REQUIRED method status, approval boundaries and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34j",
    organisationId: "org-34j",
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
      sectionTitle: category,
      pageNumber: null,
      text: `${category} evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "legacy coverage closeout evidence",
      selectedSourceIds: categories,
      selectedChunkIds: categories,
      selectedMemoryIds: [],
      selectedTaskUploadIds: [],
      retrievalMethod: "deterministic",
      ranking: [],
      tokenEstimate: 50,
      durationMs: 1,
    },
  };
}

function approvalsFor(code: string, approved = true): Record<string, boolean> {
  return Object.fromEntries(
    Object.keys(blueprintFromRegistry(code).requiredApprovals ?? {}).map((approval) => [approval, approved]),
  );
}

function validate(code: string, overrides: Partial<BlueprintRuntimeValidationInput> = {}) {
  const contract = contractFor(code);
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(code),
    rawClaims: [],
    evidencePack: evidencePack(contract.blueprint.evidenceContract?.requiredEvidenceCategories ?? []),
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34j" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

describe("Sprint 34J registry close-out", () => {
  it("1. leaves no registry Blueprint in placeholder maturity", () => {
    expect(BLUEPRINT_REGISTRY.filter((entry) => entry.maturityState === "placeholder")).toHaveLength(0);
  });

  it("2. keeps every close-out Blueprint production-ready with an explicit professional owner", () => {
    for (const code of CLOSEOUT_CODES) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.maturityState).toBe("production_ready");
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).not.toBe("owner_unresolved");
      expect(blueprint.primarySpecialist).not.toBe("owner_unresolved");
    }
  });

  it("3. routes close-out ownership to the intended current-v2 specialists", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("funding_utilisation_review")!)).toBe("service_delivery_coordinator");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("site_environmental_risk_assessment")!)).toBe("operations_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("fire_risk_assessment")!)).toBe("operations_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("disaster_emergency_management_plan")!)).toBe("operations_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("business_continuity_plan")!)).toBe("operations_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("governance_executive_review")!)).toBe("chief_of_staff");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("formal_stakeholder_correspondence")!)).toBe("executive_assistant");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("complaints_review_response")!)).toBe("compliance_quality_manager");
  });

  it("4. preserves legacy aliases without converting them into new professional methods", () => {
    expect(LEGACY_CODE_MAP.executive_brief).toBe("governance_executive_review");
    expect(LEGACY_CODE_MAP.customer_response).toBe("formal_stakeholder_correspondence");
    expect(LEGACY_CODE_MAP.action_plan).toBe("corrective_action_improvement");
    expect(LEGACY_CODE_MAP.risk_assessment).toBe("participant_risk_assessment");
  });
});

describe("Sprint 34J deterministic routing", () => {
  it("5. routes close-out intent aliases to authored registry Blueprints", () => {
    expect(resolveIntent("funding.review")).toMatchObject({ code: "funding_utilisation_review" });
    expect(resolveIntent("risk_assessment.site")).toMatchObject({ code: "site_environmental_risk_assessment" });
    expect(resolveIntent("risk_assessment.fire")).toMatchObject({ code: "fire_risk_assessment" });
    expect(resolveIntent("disaster.organisational")).toMatchObject({ code: "disaster_emergency_management_plan" });
    expect(resolveIntent("disaster.business_continuity")).toMatchObject({ code: "business_continuity_plan" });
    expect(resolveIntent("governance.executive")).toMatchObject({ code: "governance_executive_review" });
    expect(resolveIntent("correspondence.create")).toMatchObject({ code: "formal_stakeholder_correspondence" });
    expect(resolveIntent("complaints.response")).toMatchObject({ code: "complaints_review_response" });
  });
});

describe("Sprint 34J human professional method gate", () => {
  it("6. no close-out Blueprints remain method-pending", () => {
    expect(STILL_METHOD_PENDING_CLOSEOUT_CODES).toHaveLength(0);
    for (const code of STILL_METHOD_PENDING_CLOSEOUT_CODES) {
      const methodSection = sectionsFromRegistry(code)[0];
      expect(methodSection.sectionCode).toBe("USER_DEFINITION_REQUIRED_METHOD");
      expect(methodSection.instructions).toContain("USER_DEFINITION_REQUIRED");
      expect(methodSection.minimumContentExpectation).toContain("USER_DEFINITION_REQUIRED");
    }
  });

  it("7. close-out Blueprints no longer require human professional method approval", () => {
    for (const code of STILL_METHOD_PENDING_CLOSEOUT_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).toHaveProperty("human_professional_method_owner", true);
    }
    for (const code of CLOSEOUT_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    }
  });

  it("8. missing correspondence send approval blocks completion", () => {
    const result = validate("formal_stakeholder_correspondence", { approvalStates: approvalsFor("formal_stakeholder_correspondence", false) });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });

  it("9. missing complaint closure section blocks completion", () => {
    const result = validate("complaints_review_response", {
      contentMarkdown: "## COMPLAINT_IDENTITY_AND_INTAKE\nComplaint identity is present, but closure readiness is absent.",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });
});

describe("Sprint 34J evidence and completion gates", () => {
  it("10. funding utilisation requires service agreement and actual delivery evidence", () => {
    const result = validate("funding_utilisation_review", { evidencePack: evidencePack(["service_agreement"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("11. complaints response requires complaint record evidence", () => {
    const result = validate("complaints_review_response", { evidencePack: evidencePack(["incident_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("12. memory-only evidence remains restricted for close-out Blueprints", () => {
    const contract = blueprintFromRegistry("business_continuity_plan").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "controlled_document" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("13. DOCX close-out Blueprints require artifacts", () => {
    for (const code of ["disaster_emergency_management_plan", "business_continuity_plan", "formal_stakeholder_correspondence", "complaints_review_response"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.deliverableContract).toMatchObject({
        artifactRequired: true,
        primaryFormat: "docx",
        templateRequired: true,
      });
      const result = validate(code, { artifactId: null });
      expect(result.passed).toBe(false);
      expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    }
  });

  it("14. missing template blocks controlled DOCX completion", () => {
    const result = validate("formal_stakeholder_correspondence", {
      contract: contractFor("formal_stakeholder_correspondence", null),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });
});

describe("Sprint 34J authority boundaries", () => {
  it("15. site and fire risk Blueprints cannot certify safety, WHS or fire compliance", () => {
    expect(blueprintFromRegistry("site_environmental_risk_assessment").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "safety_certification",
      "whs_determination",
      "technical_certification",
    ]));
    expect(blueprintFromRegistry("fire_risk_assessment").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "fire_safety_certification",
      "engineering_certification",
      "whs_determination",
    ]));
  });

  it("16. continuity and executive review cannot approve resources, contracts or commitments", () => {
    expect(blueprintFromRegistry("business_continuity_plan").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "business_continuity_certification",
      "resource_allocation_approval",
      "contract_commitment",
    ]));
    expect(blueprintFromRegistry("governance_executive_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "approval_decision",
      "investment_approval",
      "contract_commitment",
    ]));
  });

  it("17. correspondence and complaints response cannot be sent or create final positions without approval", () => {
    expect(blueprintFromRegistry("formal_stakeholder_correspondence").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "sent_correspondence",
      "legal_commitment",
      "financial_commitment",
      "service_commitment",
      "employment_decision",
      "regulatory_position",
    ]));
    expect(blueprintFromRegistry("complaints_review_response").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "final_legal_position",
      "disciplinary_decision",
      "reportability_determination",
      "sent_response",
    ]));
  });
});
