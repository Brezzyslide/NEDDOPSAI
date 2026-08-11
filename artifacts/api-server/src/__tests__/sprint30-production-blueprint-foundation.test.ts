import { describe, expect, it } from "vitest";
import {
  parseCanonicalCarePlanIntent,
  toBlueprintDescriptor,
  type BlueprintExecutionContract,
  type BlueprintSection,
  type WorkBlueprint,
  type WorkTemplate,
} from "../services/workBlueprintService.js";
import { validateBlueprintRuntimeCompletion } from "../services/blueprintRuntimeValidationService.js";
import type { EvidencePack } from "../services/knowledgeResolutionService.js";
import type { RawClaim } from "../services/claimValidationService.js";

function syntheticBlueprint(overrides: Partial<WorkBlueprint> = {}): WorkBlueprint {
  return {
    id: "bp-synthetic-care-plan",
    organizationId: null,
    code: "care_plan_synthetic_architecture",
    title: "Synthetic Care Plan Architecture Proof",
    version: "1.0.0",
    blueprintFamily: "care_plan",
    supportedModes: ["create", "review", "revise"],
    maturityState: "placeholder",
    ownerType: "platform_owned",
    purpose: "Synthetic architecture proof only.",
    primaryDeliverable: "care_plan",
    deliverableContract: {
      primaryDeliverable: "care_plan",
      secondaryDeliverables: [],
      allowedInternalAnalysis: ["risk_context_review"],
      prohibitedDeliverables: ["risk_assessment"],
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      namingConvention: "synthetic-care-plan",
      templateRequired: true,
      completionRequirements: ["synthetic_sections_complete"],
    },
    evidenceContract: {
      requiredEvidenceCategories: ["synthetic_participant_context"],
      optionalEvidenceCategories: [],
      allowedSourceTypes: ["synthetic_participant_context"],
      restrictedSourceTypes: [],
      requiredEntityTypes: ["participant"],
      minimumEvidenceCount: 1,
      freshnessRules: {},
      claimIntegrityRequired: true,
      missingEvidenceBehaviour: "block_completion",
    },
    permittedOrgOverrides: {
      templateSubstitution: true,
      outputFormatPreferences: true,
      namingConvention: true,
      approvalWorkflow: false,
    },
    defaultTemplateId: "tpl-synthetic-care-plan",
    templateRequired: true,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    status: "published",
    objective: "Private synthetic instructions",
    primarySpecialist: "document_specialist",
    supportingSpecialists: [],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [{ rule: "private_validation", required: true, description: "Private" }],
    qualityRules: [{ dimension: "private_quality", weight: 1, description: "Private" }],
    successCriteria: [],
    outputTypes: ["docx"],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: true,
    isActive: true,
    createdAt: new Date("2026-08-11T00:00:00Z"),
    updatedAt: new Date("2026-08-11T00:00:00Z"),
    ...overrides,
  };
}

const sections: BlueprintSection[] = [
  {
    id: "section-a",
    blueprintId: "bp-synthetic-care-plan",
    sectionCode: "TEST_SECTION_A",
    title: "TEST_SECTION_A",
    description: "Synthetic section A",
    instructions: "Synthetic private instruction A",
    required: true,
    minimumContentExpectation: "Synthetic content must be present.",
    evidenceRequirements: {
      minimumEvidenceCount: 1,
      requiredEvidenceCategories: ["synthetic_participant_context"],
    },
    allowedSourceTypes: ["synthetic_participant_context"],
    prohibitedAssumptions: ["Do not invent synthetic participant context."],
    validationRules: [{ rule: "min_length_30", required: true }],
    qualityCriteria: [],
    sortOrder: 1,
    createdAt: new Date("2026-08-11T00:00:00Z"),
    updatedAt: new Date("2026-08-11T00:00:00Z"),
  },
  {
    id: "section-b",
    blueprintId: "bp-synthetic-care-plan",
    sectionCode: "TEST_SECTION_B",
    title: "TEST_SECTION_B",
    description: "Synthetic section B",
    instructions: "Synthetic private instruction B",
    required: true,
    minimumContentExpectation: "Synthetic content must be present.",
    evidenceRequirements: {},
    allowedSourceTypes: [],
    prohibitedAssumptions: [],
    validationRules: [{ rule: "min_length_30", required: true }],
    qualityCriteria: [],
    sortOrder: 2,
    createdAt: new Date("2026-08-11T00:00:00Z"),
    updatedAt: new Date("2026-08-11T00:00:00Z"),
  },
];

const template: WorkTemplate = {
  id: "tpl-synthetic-care-plan",
  organizationId: null,
  ownerType: "platform_owned",
  code: "synthetic_care_plan_template",
  title: "Synthetic Care Plan Template",
  version: "1.0.0",
  status: "published",
  maturityState: "placeholder",
  templateType: "docx",
  sourceFileReference: "synthetic://template",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: new Date("2026-08-11T00:00:00Z"),
  updatedAt: new Date("2026-08-11T00:00:00Z"),
};

function contract(overrides: Partial<BlueprintExecutionContract> = {}): BlueprintExecutionContract {
  return {
    blueprint: syntheticBlueprint(),
    sections,
    template,
    mode: "create",
    ...overrides,
  };
}

function evidencePack(): EvidencePack {
  return {
    executionId: "exec-synthetic",
    organisationId: "org-synthetic",
    resolvedAt: new Date("2026-08-11T00:00:00Z"),
    chunks: [
      {
        chunkId: "chunk-1",
        sourceId: "source-1",
        sourceTitle: "Synthetic participant context",
        sourceType: "synthetic_participant_context",
        pageNumber: null,
        text: "Synthetic participant context says the required synthetic fact.",
        confidence: 0.99,
        citation: "Synthetic source",
        selectionReason: "required category",
      },
    ],
    sourceIds: ["source-1"],
    citationsByType: {},
    totalChunks: 1,
    avgConfidence: 0.99,
    retrievalMetrics: {
      queryCount: 1,
      totalCandidates: 1,
      selectedChunks: 1,
      cacheHit: false,
      retrievalMs: 1,
      embeddingUsed: false,
      embeddingMs: 0,
    },
  };
}

const completeMarkdown = `# TEST_SECTION_A
Synthetic participant context says the required synthetic fact and enough section material.

# TEST_SECTION_B
This synthetic section contains enough non-professional placeholder content to pass.`;

describe("Sprint 30 production blueprint foundation", () => {
  it("maps canonical Care Plan intents deterministically", () => {
    expect(parseCanonicalCarePlanIntent("care_plan.create")).toEqual({
      canonicalIntent: "care_plan.create",
      family: "care_plan",
      mode: "create",
    });
    expect(parseCanonicalCarePlanIntent("care_plan.review")?.mode).toBe("review");
    expect(parseCanonicalCarePlanIntent("care_plan.revise")?.mode).toBe("revise");
    expect(parseCanonicalCarePlanIntent("risk assessment care plan")).toBeNull();
  });

  it("returns tenant-safe platform descriptors without private specification fields", () => {
    const descriptor = toBlueprintDescriptor(syntheticBlueprint());
    expect(descriptor).toMatchObject({
      code: "care_plan_synthetic_architecture",
      family: "care_plan",
      maturity: "placeholder",
      primaryDeliverable: "care_plan",
    });
    expect("objective" in descriptor).toBe(false);
    expect("validationRules" in descriptor).toBe(false);
    expect("qualityRules" in descriptor).toBe(false);
    expect("evidenceContract" in descriptor).toBe(false);
    expect("deliverableContract" in descriptor).toBe(false);
  });

  it("blocks completion when a required section is missing", () => {
    const result = validateBlueprintRuntimeCompletion({
      contract: contract(),
      contentMarkdown: "# TEST_SECTION_A\nSynthetic participant context says the required synthetic fact.",
      rawClaims: [],
      evidencePack: evidencePack(),
      artifactId: "artifact-1",
    });
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });

  it("blocks completion when a required section is materially incomplete", () => {
    const result = validateBlueprintRuntimeCompletion({
      contract: contract(),
      contentMarkdown: "# TEST_SECTION_A\nToo short.\n# TEST_SECTION_B\nAlso too short.",
      rawClaims: [],
      evidencePack: evidencePack(),
      artifactId: "artifact-1",
    });
    expect(result.failures.filter((failure) => failure.gate === "required_section").length).toBeGreaterThan(0);
  });

  it("applies configured missing-evidence behaviour", () => {
    const result = validateBlueprintRuntimeCompletion({
      contract: contract(),
      contentMarkdown: completeMarkdown,
      rawClaims: [],
      evidencePack: null,
      artifactId: "artifact-1",
    });
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ gate: "missing_evidence", state: "validation" }),
      ]),
    );
  });

  it("blocks unsupported claims when claim integrity is required", () => {
    const unsupportedClaim: RawClaim = {
      clientClaimId: "C1",
      claimText: "Unsupported synthetic claim.",
      claimType: "observation",
      confidence: 0.9,
      evidence: [],
      relatedClaimIds: [],
    };
    const result = validateBlueprintRuntimeCompletion({
      contract: contract(),
      contentMarkdown: completeMarkdown,
      rawClaims: [unsupportedClaim],
      evidencePack: evidencePack(),
      artifactId: "artifact-1",
    });
    expect(result.failures.some((failure) => failure.gate === "claim_integrity")).toBe(true);
  });

  it("blocks prohibited standalone deliverables", () => {
    const result = validateBlueprintRuntimeCompletion({
      contract: contract(),
      contentMarkdown: `${completeMarkdown}\n\n# Risk Assessment\nThis should not be a standalone deliverable.`,
      rawClaims: [],
      evidencePack: evidencePack(),
      artifactId: "artifact-1",
    });
    expect(result.failures.some((failure) => failure.gate === "prohibited_deliverable")).toBe(true);
  });

  it("blocks text-only completion when artifact is required", () => {
    const result = validateBlueprintRuntimeCompletion({
      contract: contract(),
      contentMarkdown: completeMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(),
      artifactId: null,
    });
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("blocks free-form completion when a required template is missing", () => {
    const result = validateBlueprintRuntimeCompletion({
      contract: contract({ template: null }),
      contentMarkdown: completeMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(),
      artifactId: "artifact-1",
    });
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });
});
