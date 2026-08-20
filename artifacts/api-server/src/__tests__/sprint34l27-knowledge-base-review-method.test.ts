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
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-20T00:00:00Z");
const KNOWLEDGE_CODE = "knowledge_base_review";

function blueprintFromRegistry(code = KNOWLEDGE_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = KNOWLEDGE_CODE): BlueprintSection[] {
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

function contractFor(): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template: null,
    mode: "knowledge_base_review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with knowledge review evidence about scope, required knowledge profile, source repositories, repository mapping, authority, currentness, coverage, knowledge gaps, taxonomy, findability, retrieval effectiveness, duplication, conflicts, stale and historical knowledge, ownership, stewardship, access, actual use, knowledge capture, quality, AI/KRS retrieval readiness, risk, improvement priorities, closure effectiveness and provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l27",
    organisationId: "org-34l27",
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
      text: `${category} knowledge environment evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "knowledge environment retrieval usability evidence",
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

describe("Sprint 34L.27 knowledge-base method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for knowledge-base review only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("knowledge_documentation_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(KNOWLEDGE_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Knowledge & Documentation ownership and focused support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(KNOWLEDGE_CODE)!)).toBe("knowledge_documentation_specialist");
    expect(blueprint.primarySpecialist).toBe("knowledge_documentation_specialist");
    expect(blueprint.supportingSpecialists).toEqual([
      "policy_governance_specialist",
      "compliance_quality_manager",
    ]);
  });

  it("3. remains deterministically routed by retrieval-quality intent", () => {
    expect(resolveIntent("knowledge.retrieval_quality")).toMatchObject({ code: KNOWLEDGE_CODE });
  });
});

describe("Sprint 34L.27 approved knowledge-environment method representation", () => {
  it("4. binds the approved knowledge work-product sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "EXECUTIVE_KNOWLEDGE_POSITION",
      "REVIEW_SCOPE",
      "REQUIRED_KNOWLEDGE_PROFILE",
      "KNOWLEDGE_SOURCES_REPOSITORIES",
      "REPOSITORY_SOURCE_MAPPING",
      "AUTHORITY_CURRENTNESS",
      "COVERAGE_ASSESSMENT",
      "KNOWLEDGE_GAPS",
      "ORGANISATION_TAXONOMY",
      "FINDABILITY",
      "RETRIEVAL_EFFECTIVENESS",
      "DUPLICATION",
      "CONFLICTS_CONTRADICTIONS",
      "STALE_HISTORICAL_KNOWLEDGE",
      "OWNERSHIP_STEWARDSHIP",
      "ACCESS_SECURITY",
      "ACTUAL_USE",
      "KNOWLEDGE_CAPTURE_ORGANISATIONAL_LEARNING",
      "KNOWLEDGE_QUALITY",
      "AI_KRS_RETRIEVAL_READINESS",
      "KNOWLEDGE_RISKS",
      "IMPROVEMENT_PRIORITIES",
      "CLOSURE_EFFECTIVENESS",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. starts with scope and Required Knowledge Profile before judging available sources", () => {
    expect(sectionByCode("REVIEW_SCOPE").description).toContain("AI/KRS readiness scope");
    expect(sectionByCode("REVIEW_SCOPE").instructions).toContain("Do not silently expand scope");
    expect(sectionByCode("REQUIRED_KNOWLEDGE_PROFILE").description).toContain("Role requirements");
    expect(sectionByCode("REQUIRED_KNOWLEDGE_PROFILE").instructions).toContain("not merely what happens to exist");
  });

  it("6. represents source discovery and repository/source mapping without hard-coded tenant structure", () => {
    expect(sectionByCode("KNOWLEDGE_SOURCES_REPOSITORIES").description).toContain("SharePoint/Drive/intranet");
    expect(sectionByCode("KNOWLEDGE_SOURCES_REPOSITORIES").instructions).toContain("Do not create a second knowledge system");
    expect(sectionByCode("REPOSITORY_SOURCE_MAPPING").description).toContain("email, desktops, private folders");
    expect(sectionByCode("REPOSITORY_SOURCE_MAPPING").instructions).toContain("authoritative");
  });

  it("7. keeps authority/currentness, coverage and knowledge gaps distinct", () => {
    expect(sectionByCode("AUTHORITY_CURRENTNESS").description).toContain("supersession");
    expect(sectionByCode("AUTHORITY_CURRENTNESS").instructions).toContain("without the relevant domain authority");
    expect(sectionByCode("COVERAGE_ASSESSMENT").description).toContain("COVERAGE_UNVERIFIED");
    expect(sectionByCode("KNOWLEDGE_GAPS").description).toContain("KNOWLEDGE_GAP");
    expect(sectionByCode("KNOWLEDGE_GAPS").instructions).toContain("Do not invent the missing content");
  });

  it("8. represents taxonomy, findability, retrieval effectiveness and duplication", () => {
    expect(sectionByCode("ORGANISATION_TAXONOMY").description).toContain("metadata");
    expect(sectionByCode("FINDABILITY").description).toContain("KNOWLEDGE EXISTS BUT NOT FINDABLE");
    expect(sectionByCode("RETRIEVAL_EFFECTIVENESS").instructions).toContain("Do not declare retrieval effective");
    expect(sectionByCode("DUPLICATION").description).toContain("DUPLICATION_CAUSING_CONFLICT");
  });

  it("9. represents conflicts, stale knowledge and ownership/stewardship distinctions", () => {
    expect(sectionByCode("CONFLICTS_CONTRADICTIONS").description).toContain("CONFLICT_UNRESOLVED");
    expect(sectionByCode("STALE_HISTORICAL_KNOWLEDGE").description).toContain("HISTORICAL");
    expect(sectionByCode("STALE_HISTORICAL_KNOWLEDGE").instructions).toContain("evidential value");
    expect(sectionByCode("OWNERSHIP_STEWARDSHIP").description).toContain("knowledge steward");
    expect(sectionByCode("OWNERSHIP_STEWARDSHIP").instructions).toContain("DOMAIN OWNER");
  });

  it("10. separates access, actual use and knowledge capture", () => {
    expect(sectionByCode("ACCESS_SECURITY").description).toContain("point-of-need usability");
    expect(sectionByCode("ACCESS_SECURITY").instructions).toContain("existence as accessibility");
    expect(sectionByCode("ACTUAL_USE").description).toContain("KNOWLEDGE AVAILABLE_NOT_USED");
    expect(sectionByCode("ACTUAL_USE").instructions).toContain("Do not assume availability means application");
    expect(sectionByCode("KNOWLEDGE_CAPTURE_ORGANISATIONAL_LEARNING").instructions).toContain("IDENTIFIED -> VALIDATED -> OWNED -> CODIFIED -> PUBLISHED -> RETRIEVABLE -> USED");
  });

  it("11. represents AI/KRS retrieval readiness without creating new infrastructure", () => {
    expect(sectionByCode("AI_KRS_RETRIEVAL_READINESS").description).toContain("source ownership");
    expect(sectionByCode("AI_KRS_RETRIEVAL_READINESS").description).toContain("provenance availability");
    expect(sectionByCode("AI_KRS_RETRIEVAL_READINESS").instructions).toContain("Do not create or modify KRS");
    expect(sectionByCode("AI_KRS_RETRIEVAL_READINESS").instructions).toContain("APPROPRIATE FOR RELIANCE");
  });

  it("12. requires improvement and closure evidence beyond publication", () => {
    expect(sectionByCode("IMPROVEMENT_PRIORITIES").description).toContain("improve KRS source metadata");
    expect(sectionByCode("CLOSURE_EFFECTIVENESS").description).toContain("RETRIEVAL VERIFIED");
    expect(sectionByCode("CLOSURE_EFFECTIVENESS").description).toContain("USE/EFFECTIVENESS REASSESSED");
    expect(sectionByCode("CLOSURE_EFFECTIVENESS").instructions).toContain("Do not equate publication or upload with effectiveness");
  });
});

describe("Sprint 34L.27 evidence contract and knowledge-state model", () => {
  it("13. requires knowledge profile, source, repository and retrieval evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["required_knowledge_profile", "knowledge_source", "knowledge_repository", "retrieval_audit"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("14. enforces currentness, source ownership, retrieval and state-separation controls", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      currentnessRequired: true,
      memoryCannotProveCurrentness: true,
      knowledgeExistsDoesNotProveAuthoritative: true,
      authoritativeDoesNotProveCurrent: true,
      currentDoesNotProveOrganised: true,
      organisedDoesNotProveFindable: true,
      findableDoesNotProveAccessible: true,
      accessibleDoesNotProveUnderstoodOrUsed: true,
      ingestedDoesNotProveCurrentAuthoritativeRetrievableOrReliable: true,
      retrievalFunctionDoesNotProveRetrievalEffectiveness: true,
      sourceOwnershipRequiredForProfessionalContentClaims: true,
    });
  });

  it("15. blocks memory-only evidence from proving knowledge status", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, {
      chunks: [
        { sourceType: "memory_only", category: "knowledge_source" },
        { sourceType: "user_assertion_only", category: "retrieval_audit" },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("16. validates completion when required sections, evidence and KDS approval are present", () => {
    const result = validate();
    expect(result.passed).toBe(true);
  });

  it("17. missing retrieval evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(["required_knowledge_profile", "knowledge_source", "knowledge_repository"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });
});

describe("Sprint 34L.27 KDS authority and adjacent Blueprint boundaries", () => {
  it("18. prevents KDS from rewriting domain truth, building KRS or doing controlled assembly", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "new_knowledge_system",
      "new_retrieval_system",
      "krs_architecture_change",
      "professional_content_creation",
      "professional_content_rewrite",
      "domain_method_rewrite",
      "controlled_document_assembly",
      "controlled_publication",
      "access_override",
      "source_deletion",
    ]));
    expect(blueprint.validationRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "kds_authority_boundary_preserved",
      "document_control_and_controlled_assembly_boundaries_preserved",
      "ai_krs_readiness_uses_existing_architecture",
      "closure_requires_retrieval_access_use_or_effectiveness_evidence",
    ]));
  });

  it("19. routes domain truth, document-control, KRS architecture and access changes to the right owner", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "substantive_professional_content_or_domain_truth_required", action: "defer_to_relevant_domain_owner_without_rewriting_content" }),
      expect.objectContaining({ trigger: "controlled_document_authorisation_version_publication_or_archive_issue", action: "route_to_document_control_review_or_controlled_document_assembly_as_applicable" }),
      expect.objectContaining({ trigger: "krs_architecture_or_ingestion_pipeline_change_required", action: "prepare_retrieval_readiness_finding_without_modifying_krs" }),
      expect.objectContaining({ trigger: "access_permission_change_required", action: "prepare_access_finding_and_require_authorised_security_or_system_owner_approval" }),
      expect.objectContaining({ trigger: "knowledge_gap_requires_new_professional_content", action: "route_to_appropriate_professional_blueprint_or_domain_owner" }),
    ]));
  });

  it("20. records the changing external authority boundary in the registry", () => {
    expect(getRegistryEntry(KNOWLEDGE_CODE)?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "hard-coded interpretation of changing legislation, regulation, Award/payroll, privacy, NDIS or professional-standard requirements",
      "substantive professional interpretation or correction of domain knowledge content",
      "creating or modifying KRS, retrieval, memory, taxonomy-engine or repository architecture",
    ]));
  });
});
