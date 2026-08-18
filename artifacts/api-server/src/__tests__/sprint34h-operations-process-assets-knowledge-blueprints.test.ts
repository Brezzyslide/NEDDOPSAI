import { describe, expect, it } from "vitest";
import {
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

const OPERATIONS_CODES = [
  "operational_readiness_assessment",
  "standard_operating_procedure",
  "business_process_analysis",
  "asset_lifecycle_review",
] as const;

const KNOWLEDGE_CODES = [
  "document_control_review",
  "knowledge_base_review",
  "controlled_document_assembly",
] as const;

const ALL_34H_CODES = [
  ...OPERATIONS_CODES,
  ...KNOWLEDGE_CODES,
] as const;

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
  id: "tpl-34h",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "operations_knowledge_template",
  title: "Operations / Knowledge Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/operations-knowledge.docx",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current operations or knowledge evidence, visible USER_DEFINITION_REQUIRED method status, lifecycle boundaries, approvals and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34h",
    organisationId: "org-34h",
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
      query: "operations process asset knowledge evidence",
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
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34h" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

describe("Sprint 34H ownership and routing", () => {
  it("1. routes operational readiness to Operations Manager", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("operational_readiness_assessment")!)).toBe("operations_manager");
  });

  it("2. routes SOP, process and asset Blueprints to Process Asset Coordinator", () => {
    for (const code of ["standard_operating_procedure", "business_process_analysis", "asset_lifecycle_review"] as const) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("process_asset_coordinator");
    }
  });

  it("3. routes knowledge/documentation Blueprints to Knowledge Documentation Specialist", () => {
    for (const code of KNOWLEDGE_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("knowledge_documentation_specialist");
    }
  });

  it("4. deterministic intents point at authored 34H Blueprints", () => {
    expect(resolveIntent("operations.readiness")).toMatchObject({ code: "operational_readiness_assessment" });
    expect(resolveIntent("process.sop")).toMatchObject({ code: "standard_operating_procedure" });
    expect(resolveIntent("process.review")).toMatchObject({ code: "business_process_analysis" });
    expect(resolveIntent("asset.lifecycle_review")).toMatchObject({ code: "asset_lifecycle_review" });
    expect(resolveIntent("knowledge.document_control")).toMatchObject({ code: "document_control_review" });
    expect(resolveIntent("knowledge.retrieval_quality")).toMatchObject({ code: "knowledge_base_review" });
    expect(resolveIntent("documentation.controlled_assembly")).toMatchObject({ code: "controlled_document_assembly" });
  });
});

describe("Sprint 34H human professional method gate", () => {
  it("5. every 34H Blueprint carries visible USER_DEFINITION_REQUIRED method status", () => {
    for (const code of ALL_34H_CODES) {
      const methodSection = sectionsFromRegistry(code)[0];
      expect(methodSection.sectionCode).toBe("USER_DEFINITION_REQUIRED_METHOD");
      expect(methodSection.instructions).toContain("USER_DEFINITION_REQUIRED");
      expect(methodSection.minimumContentExpectation).toContain("USER_DEFINITION_REQUIRED");
    }
  });

  it("6. every 34H Blueprint requires human professional method approval", () => {
    for (const code of ALL_34H_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).toHaveProperty("human_professional_method_owner", true);
    }
  });

  it("7. missing human method approval blocks completion", () => {
    const result = validate("standard_operating_procedure", { approvalStates: approvalsFor("standard_operating_procedure", false) });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });

  it("8. missing method section blocks completion", () => {
    const result = validate("document_control_review", {
      contentMarkdown: "## DOCUMENT_IDENTITY_STATUS\nDocument status is populated, but the method gate is absent.",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });
});

describe("Sprint 34H evidence and currentness controls", () => {
  it("9. operational readiness requires service requirement and operational record evidence", () => {
    expect(blueprintFromRegistry("operational_readiness_assessment").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["service_requirement", "operational_record"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. memory-only evidence remains restricted", () => {
    const contract = blueprintFromRegistry("document_control_review").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "document_register" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. operations and knowledge evidence requires currentness and version discipline", () => {
    for (const code of ALL_34H_CODES) {
      expect(blueprintFromRegistry(code).evidenceContract?.freshnessRules).toMatchObject({
        currentnessRequired: true,
        memoryCannotProveCurrentness: true,
        conflictingVersionsRequireResolution: true,
      });
    }
    expect(blueprintFromRegistry("controlled_document_assembly").evidenceContract?.freshnessRules).toMatchObject({
      supersededDocumentsRemainSuperseded: true,
    });
  });

  it("12. missing required template evidence blocks controlled assembly", () => {
    const result = validate("controlled_document_assembly", { evidencePack: evidencePack(["controlled_document"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });
});

describe("Sprint 34H authority boundaries", () => {
  it("13. operational readiness cannot approve go-live, resources or service commitments", () => {
    expect(blueprintFromRegistry("operational_readiness_assessment").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "go_live_approval",
      "resource_allocation_approval",
      "service_commitment_approval",
    ]));
  });

  it("14. SOP cannot change policy meaning or publish controlled documents by itself", () => {
    const blueprint = blueprintFromRegistry("standard_operating_procedure");
    expect(blueprint.requiredApprovals).toHaveProperty("controlled_document_owner", true);
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "policy_change",
      "professional_domain_conclusion",
      "controlled_publication",
    ]));
  });

  it("15. process analysis cannot approve operating-model changes or bypass controls", () => {
    expect(blueprintFromRegistry("business_process_analysis").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "operating_model_approval",
      "resource_allocation_approval",
      "control_bypass",
    ]));
  });

  it("16. asset lifecycle review cannot approve procurement/disposal or safety certification", () => {
    expect(blueprintFromRegistry("asset_lifecycle_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "procurement_approval",
      "disposal_approval",
      "safety_certification",
      "accounting_treatment",
    ]));
  });

  it("17. KDS document control cannot change substantive professional meaning or lifecycle state without approval", () => {
    expect(blueprintFromRegistry("document_control_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "professional_content_change",
      "controlled_publication",
      "access_override",
      "document_deletion",
    ]));
  });

  it("18. controlled document assembly cannot publish, change owner, supersede or archive by itself", () => {
    const blueprint = blueprintFromRegistry("controlled_document_assembly");
    expect(blueprint.requiredApprovals).toHaveProperty("controlled_publication_owner", true);
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "controlled_publication",
      "document_owner_change",
      "supersession_or_archive",
    ]));
  });
});

describe("Sprint 34H deliverable and completion gates", () => {
  it("19. SOP and controlled assembly require controlled DOCX artifacts", () => {
    for (const code of ["standard_operating_procedure", "controlled_document_assembly"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.templateRequired).toBe(true);
      expect(blueprint.deliverableContract).toMatchObject({
        artifactRequired: true,
        primaryFormat: "docx",
        templateRequired: true,
      });
    }
  });

  it("20. missing SOP artifact blocks completion", () => {
    const result = validate("standard_operating_procedure", { artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("21. missing controlled assembly template blocks completion", () => {
    const result = validate("controlled_document_assembly", {
      contract: contractFor("controlled_document_assembly", null),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("22. process, asset, readiness and knowledge reviews remain structured analysis", () => {
    for (const code of ["operational_readiness_assessment", "business_process_analysis", "asset_lifecycle_review", "document_control_review", "knowledge_base_review"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.deliverableContract?.artifactRequired).toBe(false);
      expect(blueprint.templateRequired).toBe(false);
    }
  });

  it("23. controlled publication approval must be present before controlled document package completion", () => {
    const approvalStates = approvalsFor("controlled_document_assembly");
    approvalStates.controlled_publication_owner = false;
    const result = validate("controlled_document_assembly", { approvalStates });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });
});
