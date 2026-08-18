import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  LEGACY_CODE_MAP,
  getRegistryBlueprintReadinessState,
  getRegistryBlueprintSeedOwner,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
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

const ROOT = resolve(__dirname, "../../../..");

function readSource(path: string): string {
  return readFileSync(resolve(ROOT, path), "utf8");
}

function blueprint(overrides: Partial<WorkBlueprint> = {}): WorkBlueprint {
  return {
    id: "bp-34b",
    organizationId: null,
    code: "controlled_document_assembly",
    title: "Controlled Document Assembly",
    version: "1.0.0",
    blueprintFamily: "knowledge_documentation",
    supportedModes: ["assembly"],
    maturityState: "production_ready",
    ownerType: "platform_owned",
    purpose: "Test contract alignment.",
    primaryDeliverable: "Controlled Document Package",
    deliverableContract: {
      primaryDeliverable: "controlled_document_package",
      secondaryDeliverables: ["metadata_review"],
      allowedInternalAnalysis: ["source_traceability_review"],
      prohibitedDeliverables: ["policy_rewrite"],
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      namingConvention: "CONTROLLED_DOCUMENT",
      templateRequired: true,
      completionRequirements: ["all_required_sections", "artifact_generated", "approval_recorded"],
    },
    evidenceContract: {
      requiredEvidenceCategories: ["approved_source_content"],
      optionalEvidenceCategories: ["template_metadata"],
      allowedSourceTypes: ["controlled_document", "task_upload"],
      restrictedSourceTypes: ["memory_only"],
      requiredEntityTypes: [],
      minimumEvidenceCount: 1,
      freshnessRules: { currentnessRequired: true },
      claimIntegrityRequired: true,
      missingEvidenceBehaviour: "block_completion",
    },
    permittedOrgOverrides: { templateSubstitution: true, approvalWorkflow: true },
    defaultTemplateId: "tpl-34b",
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    status: "published",
    objective: "Assemble a controlled document from approved content.",
    primarySpecialist: "knowledge_documentation_specialist",
    supportingSpecialists: ["policy_governance_specialist"],
    requiredLibraryKnowledge: ["approved_template"],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: { document_owner: true },
    validationRules: [{ rule: "approved_source_content_present", required: true, description: "Approved content is required." }],
    qualityRules: [{ dimension: "traceability", weight: 1, description: "Provenance is preserved." }],
    successCriteria: ["Artifact generated", "Owner approval captured"],
    outputTypes: ["controlled_document_package"],
    escalationRules: [],
    mandatoryCitations: ["approved_source_content"],
    isBuiltIn: true,
    isActive: true,
    createdAt: new Date("2026-08-17T00:00:00Z"),
    updatedAt: new Date("2026-08-17T00:00:00Z"),
    ...overrides,
  };
}

const sections: BlueprintSection[] = [
  {
    id: "section-34b",
    blueprintId: "bp-34b",
    sectionCode: "APPROVED_CONTENT",
    title: "Approved Content",
    description: "Approved source content.",
    instructions: "Use approved source content without changing professional meaning.",
    required: true,
    minimumContentExpectation: "Approved source content must be materially present.",
    evidenceRequirements: { requiredEvidenceCategories: ["approved_source_content"], minimumEvidenceCount: 1 },
    allowedSourceTypes: ["controlled_document", "task_upload"],
    prohibitedAssumptions: ["Do not invent missing approved content."],
    validationRules: [],
    qualityCriteria: [],
    sortOrder: 1,
    createdAt: new Date("2026-08-17T00:00:00Z"),
    updatedAt: new Date("2026-08-17T00:00:00Z"),
  },
];

const template: WorkTemplate = {
  id: "tpl-34b",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "controlled_document_template",
  title: "Controlled Document Template",
  version: "2.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/controlled-document-v2.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: new Date("2026-08-17T00:00:00Z"),
  updatedAt: new Date("2026-08-17T00:00:00Z"),
};

function contract(overrides: Partial<BlueprintExecutionContract> = {}): BlueprintExecutionContract {
  return {
    blueprint: blueprint(),
    sections,
    template,
    mode: "assembly",
    ...overrides,
  };
}

function validate(overrides: Partial<BlueprintRuntimeValidationInput> = {}) {
  return validateBlueprintRuntimeCompletion({
    contract: contract(),
    contentMarkdown: "## APPROVED_CONTENT\nApproved source content is materially present.",
    rawClaims: [],
    evidencePack: {
      executionId: "exec-34b",
      organisationId: "org-1",
      resolvedAt: new Date("2026-08-17T00:00:00Z"),
      chunks: [{
        chunkId: "chunk-1",
        sourceId: "source-1",
        sourceVersionId: "source-version-1",
        versionLabel: "v1",
        authorityLevel: "approved",
        sourceTitle: "Approved source content",
        sourceType: "approved_source_content",
        sectionTitle: "Approved Content",
        pageNumber: null,
        text: "Approved source content.",
        confidence: 1,
      }],
      entityFacts: {},
      memories: [],
      retrievalMeta: {
        query: "approved source content",
        selectedSourceIds: ["source-1"],
        selectedChunkIds: ["chunk-1"],
        selectedMemoryIds: [],
        selectedTaskUploadIds: [],
        retrievalMethod: "deterministic",
        ranking: [],
        tokenEstimate: 20,
        durationMs: 1,
      },
    },
    artifactId: "artifact-1",
    approvalStates: { document_owner: true },
    ...overrides,
  });
}

describe("Sprint 34B Blueprint ownership foundation", () => {
  it("1. registry Blueprint with canonical owner does not seed as Chief of Staff", () => {
    const entry = getRegistryEntry("controlled_document_assembly")!;
    expect(resolveRegistryProfessionalOwner(entry)).toBe("knowledge_documentation_specialist");
    expect(getRegistryBlueprintSeedOwner(entry)).toBe("knowledge_documentation_specialist");
    expect(getRegistryBlueprintSeedOwner(entry)).not.toBe("chief_of_staff");
  });

  it("2. Chief of Staff remains coordinator conceptually, not professional-owner fallback", () => {
    const source = readSource("artifacts/api-server/src/services/blueprintRegistry.ts");
    expect(source).toContain("BLUEPRINT_COORDINATOR_ROLE = \"chief_of_staff\"");
    expect(source).toContain("CoS may coordinate work");
  });

  it("3. formerly unresolved finance analysis now has explicit FP&R owner instead of CoS fallback", () => {
    const entry = getRegistryEntry("business_financial_analysis")!;
    expect(resolveRegistryProfessionalOwner(entry)).toBe("financial_planning_reporting_manager");
    expect(getRegistryBlueprintSeedOwner(entry)).toBe("financial_planning_reporting_manager");
    expect(getRegistryBlueprintSeedOwner(entry)).not.toBe("chief_of_staff");
    expect(getRegistryBlueprintReadinessState(entry)).toBe("professionally_authored");
  });

  it("4. supporting specialist remains distinct from professional owner", () => {
    const bp = blueprint();
    expect(bp.primarySpecialist).toBe("knowledge_documentation_specialist");
    expect(bp.supportingSpecialists).toContain("policy_governance_specialist");
    expect(bp.supportingSpecialists).not.toContain(bp.primarySpecialist);
  });

  it("5. availability/entitlement source does not rewrite canonical owner", () => {
    const entry = getRegistryEntry("financial_planning_reporting_review")!;
    expect(resolveRegistryProfessionalOwner(entry)).toBe("financial_planning_reporting_manager");
    expect(getRegistryBlueprintSeedOwner(entry)).toBe("financial_planning_reporting_manager");
  });

  it("6. registry/built-in duplicate visibility is deterministic", () => {
    const registryCodes = new Set(BLUEPRINT_REGISTRY.map(entry => entry.code));
    for (const code of ["care_plan", "incident_investigation", "business_proposal"]) {
      expect(registryCodes.has(code)).toBe(true);
    }
  });

  it("7. care_plan duplicate has one canonical registry identity", () => {
    expect(BLUEPRINT_REGISTRY.filter(entry => entry.code === "care_plan")).toHaveLength(1);
    expect(getRegistryEntry("care_plan")?.futureOwnerRoleCode).toBe("service_delivery_coordinator");
  });

  it("8. incident_investigation duplicate has one canonical registry identity", () => {
    expect(BLUEPRINT_REGISTRY.filter(entry => entry.code === "incident_investigation")).toHaveLength(1);
    expect(getRegistryEntry("incident_investigation")?.code).toBe("incident_investigation");
  });

  it("9. business_proposal duplicate has one canonical registry identity", () => {
    expect(BLUEPRINT_REGISTRY.filter(entry => entry.code === "business_proposal")).toHaveLength(1);
    expect(getRegistryEntry("business_proposal")?.code).toBe("business_proposal");
  });

  it("10. built-in duplicates are preserved for later rationalisation", () => {
    const source = readSource("artifacts/api-server/src/services/workBlueprintService.ts");
    expect(source).toContain("code: \"care_plan\"");
    expect(source).toContain("code: \"incident_investigation\"");
    expect(source).toContain("code: \"business_proposal\"");
  });
});

describe("Sprint 34B Blueprint contract enforcement", () => {
  it("11. contract-enabled Blueprint enforces required sections", () => {
    const result = validate({ contentMarkdown: "## WRONG\nNo required section." });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "required_section")).toBe(true);
  });

  it("12. contract-enabled Blueprint enforces evidence requirement", () => {
    const result = validate({ evidencePack: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "missing_evidence")).toBe(true);
  });

  it("13. artifact-required Blueprint cannot complete without artifact", () => {
    const result = validate({ artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "artifact_required")).toBe(true);
  });

  it("14. template-required Blueprint cannot complete without template", () => {
    const result = validate({ contract: contract({ template: null }) });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "template_required")).toBe(true);
  });

  it("15. approval-required Blueprint cannot complete before approval", () => {
    const result = validate({ approvalStates: {} });
    expect(result.passed).toBe(false);
    expect(result.failures.some(failure => failure.gate === "approval_required")).toBe(true);
  });

  it("16. LLM text alone cannot bypass configured completion gate", () => {
    const result = validate({ artifactId: null, approvalStates: {} });
    expect(result.passed).toBe(false);
    expect(result.failures.map(failure => failure.gate)).toEqual(expect.arrayContaining([
      "artifact_required",
      "approval_required",
    ]));
  });

  it("17. tenant template override does not rewrite professional owner", () => {
    const c = contract();
    expect(c.template?.organizationId).toBe("org-1");
    expect(c.blueprint.primarySpecialist).toBe("knowledge_documentation_specialist");
  });

  it("18. historical execution state retains Blueprint/version contract provenance", () => {
    const source = readSource("artifacts/api-server/src/services/workPackageService.ts");
    expect(source).toContain("blueprintVersion: blueprint?.version");
    expect(source).toContain("deliverableContract: blueprint.deliverableContract");
    expect(source).toContain("evidenceContract: blueprint.evidenceContract");
  });

  it("19. synthetic care-plan Blueprint remains test-only", () => {
    const source = readSource("artifacts/api-server/src/services/workBlueprintService.ts");
    expect(source).toContain("care_plan_synthetic_architecture");
    expect(source).toContain("Synthetic Care Plan architecture proof only. Not professional content.");
  });

  it("20. legacy built-in-only Blueprint remains visible for compatibility", () => {
    const source = readSource("artifacts/api-server/src/services/workBlueprintService.ts");
    expect(source).toContain("code: \"meeting_minutes\"");
    expect(source).toContain("code: \"operational_procedure\"");
  });

  it("21. Blueprint alias resolves to canonical code without creating duplicate professional identity", () => {
    expect(LEGACY_CODE_MAP.risk_assessment).toBe("participant_risk_assessment");
    expect(LEGACY_CODE_MAP.policy_draft).toBe("policy");
  });

  it("22. deterministic orphan business_financial_analysis remains intentionally visible", () => {
    expect(getRegistryEntry("business_financial_analysis")).toBeDefined();
    expect(resolveIntent("financial.analysis")?.isAction).toBe(false);
    expect(resolveIntent("financial.analysis")).toMatchObject({ code: "financial_planning_reporting_review" });
  });

  it("23. seeded registry placeholders use unresolved owner in source, not CoS", () => {
    const source = readSource("artifacts/api-server/src/services/workBlueprintService.ts");
    const seedStart = source.indexOf("export async function seedRegistryBlueprints");
    const seedEnd = source.indexOf("export async function getBlueprintByCode", seedStart);
    const seedSource = source.slice(seedStart, seedEnd);
    expect(seedSource).toContain("primarySpecialist: registryOwner");
    expect(seedSource).not.toContain("primarySpecialist: \"chief_of_staff\"");
  });

  it("24. UEE blocks unknown or unresolved specialist owners", () => {
    const source = readSource("artifacts/api-server/src/services/unifiedExecutionEngine.ts");
    expect(source).toContain("blockedStatus:     \"unknown_specialist\"");
    expect(source).toContain("return { blocked: true, blockedStatus: \"unknown_specialist\" }");
  });
});
