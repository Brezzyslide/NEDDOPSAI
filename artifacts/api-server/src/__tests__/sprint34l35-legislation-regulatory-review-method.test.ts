import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
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

const CODE = "legislation_regulatory_review";
const DUPLICATE_CODE = "regulatory_change_impact";
const NOW = new Date("2026-08-20T00:00:00Z");

function blueprintFromRegistry(code = CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = CODE): BlueprintSection[] {
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

function sectionByCode(sectionCode: string): BlueprintSection {
  const section = sectionsFromRegistry().find((candidate) => candidate.sectionCode === sectionCode);
  if (!section) throw new Error(`Missing section ${sectionCode}`);
  return section;
}

function methodPendingCodes(): string[] {
  const registry = readFileSync(new URL("../services/blueprintRegistry.ts", import.meta.url), "utf8");
  return [...registry.matchAll(/code: "([^"]+)"[\s\S]*?requiredApprovals: \{([^}]*)\}/g)]
    .filter((match) => match[2].includes("human_professional_method_owner"))
    .map((match) => match[1]);
}

function contractFor(): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template: null,
    mode: "legislation_review",
  };
}

function allRequiredEvidenceCategories(): string[] {
  return [
    ...(blueprintFromRegistry().evidenceContract?.requiredEvidenceCategories ?? []),
    ...sectionsFromRegistry().flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ].filter((category, index, categories) => categories.indexOf(category) === index);
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current authority evidence, applicability reasoning, obligation extraction, control mapping, register review and unresolved legal/currentness gaps.`)
    .join("\n\n");
}

function evidencePack(categories = allRequiredEvidenceCategories()) {
  return {
    executionId: "exec-legislation-review",
    organisationId: "org-1",
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
      query: "legislative regulatory obligations review evidence",
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

function approvalsFor(approved = true): Record<string, boolean> {
  return Object.fromEntries(
    Object.keys(blueprintFromRegistry().requiredApprovals ?? {}).map((approval) => [approval, approved]),
  );
}

function validate(overrides: Partial<BlueprintRuntimeValidationInput> = {}) {
  return validateBlueprintRuntimeCompletion({
    contract: contractFor(),
    contentMarkdown: contentFor(),
    rawClaims: [],
    evidencePack: evidencePack(),
    artifactId: null,
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

describe("Sprint 34L.35 legislation/regulatory review method gate and ownership", () => {
  it("1. removes the human professional method blocker for legislation_regulatory_review only", () => {
    const blueprint = blueprintFromRegistry();
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Policy & Governance ownership with CQM/KDS support", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(CODE)!)).toBe("policy_governance_specialist");
    expect(blueprint.primarySpecialist).toBe("policy_governance_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining(["compliance_quality_manager", "knowledge_documentation_specialist"]));
    expect(blueprint.requiredApprovals).toMatchObject({ policy_governance_owner: true, compliance_quality_owner: true });
  });

  it("3. names the professional legislative and regulatory obligations review", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.title).toBe("Legislative & Regulatory Obligations Review");
    expect(blueprint.purpose).toContain("authoritative obligations that apply");
  });
});

describe("Sprint 34L.35 approved obligations review method representation", () => {
  it("4. binds the approved legislative/regulatory obligations sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "ORGANISATIONAL_SCOPE",
      "SOURCE_UNIVERSE",
      "AUTHORITY_CURRENTNESS",
      "APPLICABILITY_ANALYSIS",
      "SPECIFIC_OBLIGATION_EXTRACTION",
      "OBLIGATION_CLASSIFICATION",
      "OWNER_AND_DOMAIN_ASSIGNMENT",
      "OBLIGATION_CONTROL_MAPPING",
      "REGISTER_REVIEW",
      "ORGANISATIONAL_CHANGE_APPLICABILITY",
      "CONFLICTS_AND_UNCERTAINTY",
      "GOVERNANCE_GAPS",
      "MATERIALITY",
      "REQUIRED_ACTIONS",
      "OBLIGATION_REGISTER_OUTPUT",
      "PROFESSIONAL_CONCLUSION",
      "BOUNDARIES_AND_HANDOFFS",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. represents organisational-scope determination", () => {
    expect(sectionByCode("ORGANISATIONAL_SCOPE").description).toContain("Jurisdictions");
    expect(sectionByCode("ORGANISATIONAL_SCOPE").description).toContain("registration groups");
    expect(sectionByCode("ORGANISATIONAL_SCOPE").description).toContain("privacy/data activities");
    expect(sectionByCode("ORGANISATIONAL_SCOPE").instructions).toContain("regulatory footprint");
  });

  it("6. represents current-authority discovery without new infrastructure", () => {
    expect(sectionByCode("SOURCE_UNIVERSE").description).toContain("Acts");
    expect(sectionByCode("SOURCE_UNIVERSE").description).toContain("registration conditions");
    expect(sectionByCode("SOURCE_UNIVERSE").instructions).toContain("Use existing KRS/current-authority architecture");
  });

  it("7. prefers primary authority and tests currentness, supersession and repeal", () => {
    expect(sectionByCode("AUTHORITY_CURRENTNESS").description).toContain("repeal status");
    expect(sectionByCode("AUTHORITY_CURRENTNESS").description).toContain("version/currentness");
    expect(sectionByCode("AUTHORITY_CURRENTNESS").instructions).toContain("Prefer primary authority");
  });

  it("8. represents applicability analysis and rejects sector relevance alone", () => {
    expect(sectionByCode("APPLICABILITY_ANALYSIS").description).toContain("applies, does not apply, applicability uncertain");
    expect(sectionByCode("APPLICABILITY_ANALYSIS").description).toContain("jurisdiction");
    expect(sectionByCode("APPLICABILITY_ANALYSIS").instructions).toContain("Sector relevance alone does not establish organisational obligation");
  });

  it("9. represents specific obligation extraction, jurisdiction and classification", () => {
    expect(sectionByCode("SPECIFIC_OBLIGATION_EXTRACTION").description).toContain("section/rule/standard");
    expect(sectionByCode("SPECIFIC_OBLIGATION_EXTRACTION").description).toContain("accountable owner");
    expect(sectionByCode("OBLIGATION_CLASSIFICATION").description).toContain("restrictive practice");
    expect(sectionByCode("OBLIGATION_CLASSIFICATION").instructions).toContain("without hard-coding MH&R-specific categories");
  });

  it("10. represents responsible owner and obligation-to-control mapping", () => {
    expect(sectionByCode("OWNER_AND_DOMAIN_ASSIGNMENT").description).toContain("Responsible organisational owner");
    expect(sectionByCode("OWNER_AND_DOMAIN_ASSIGNMENT").instructions).toContain("Missing owner");
    expect(sectionByCode("OBLIGATION_CONTROL_MAPPING").description).toContain("coverage status");
    expect(sectionByCode("OBLIGATION_CONTROL_MAPPING").instructions).toContain("FULLY_MAPPED");
    expect(sectionByCode("OBLIGATION_CONTROL_MAPPING").instructions).toContain("Policy existence is not proof of compliance");
  });

  it("11. reviews existing registers rather than blindly trusting them", () => {
    expect(sectionByCode("REGISTER_REVIEW").description).toContain("missing obligations");
    expect(sectionByCode("REGISTER_REVIEW").description).toContain("repealed sources");
    expect(sectionByCode("REGISTER_REVIEW").description).toContain("wrong jurisdiction");
    expect(sectionByCode("REGISTER_REVIEW").instructions).toContain("Register absence does not prove absence of obligation");
  });

  it("12. represents organisational change affecting applicability", () => {
    expect(sectionByCode("ORGANISATIONAL_CHANGE_APPLICABILITY").description).toContain("new registration groups");
    expect(sectionByCode("ORGANISATIONAL_CHANGE_APPLICABILITY").description).toContain("new data-processing activity");
    expect(sectionByCode("ORGANISATIONAL_CHANGE_APPLICABILITY").instructions).toContain("Do not duplicate regulatory_change_impact_assessment");
  });

  it("13. preserves uncertainty and legal-review boundaries", () => {
    expect(sectionByCode("CONFLICTS_AND_UNCERTAINTY").description).toContain("statutory wording requiring professional/legal interpretation");
    expect(sectionByCode("CONFLICTS_AND_UNCERTAINTY").instructions).toContain("APPLICABILITY_UNCERTAIN");
    expect(sectionByCode("CONFLICTS_AND_UNCERTAINTY").instructions).toContain("INTERPRETATION_REQUIRES_LEGAL_REVIEW");
  });

  it("14. surfaces governance gaps, materiality and actions without inventing controls", () => {
    expect(sectionByCode("GOVERNANCE_GAPS").description).toContain("unsupported compliance assertion");
    expect(sectionByCode("GOVERNANCE_GAPS").instructions).toContain("Do not invent a control");
    expect(sectionByCode("MATERIALITY").description).toContain("registration impact");
    expect(sectionByCode("REQUIRED_ACTIONS").instructions).toContain("regulatory_change_impact_assessment");
    expect(sectionByCode("REQUIRED_ACTIONS").instructions).toContain("corrective_action_improvement");
  });

  it("15. supports structured obligation register output without creating a subsystem", () => {
    expect(sectionByCode("OBLIGATION_REGISTER_OUTPUT").description).toContain("applicability trigger");
    expect(sectionByCode("OBLIGATION_REGISTER_OUTPUT").description).toContain("gap/status");
    expect(sectionByCode("OBLIGATION_REGISTER_OUTPUT").instructions).toContain("Do not build a new persistent register subsystem");
  });

  it("16. supports professional conclusion states", () => {
    expect(sectionByCode("PROFESSIONAL_CONCLUSION").description).toContain("OBLIGATION_UNIVERSE_CURRENT_AND_MAPPED");
    expect(sectionByCode("PROFESSIONAL_CONCLUSION").description).toContain("MATERIAL_REGULATORY_EXPOSURE");
    expect(sectionByCode("PROFESSIONAL_CONCLUSION").description).toContain("EVIDENCE_INSUFFICIENT");
  });
});

describe("Sprint 34L.35 evidence, validation and boundary controls", () => {
  it("17. requires current authority, regulatory source, organisation structure and legislative register evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["current_authority", "regulatory_source", "organisation_structure", "legislative_register"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("18. enforces currentness, register and applicability principles", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      primaryAuthorityPreferredWhereAvailable: true,
      secondarySourcesCannotReplacePrimaryAuthority: true,
      oldRegisterCannotOverrideCurrentAuthority: true,
      registerAbsenceDoesNotProveObligationAbsence: true,
      registerPresenceDoesNotProveCurrentApplicability: true,
      supersededSourcesCannotProveCurrentObligation: true,
      repealedSourcesCannotProveCurrentObligation: true,
      applicabilityMustBeTriggeredByEvidence: true,
      sectorRelevanceDoesNotEqualApplicability: true,
    });
  });

  it("19. rejects memory-only and secondary-commentary-only evidence as authority proof", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const memoryResult = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "regulatory_source" }] });
    const commentaryResult = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "secondary_commentary_only", category: "regulatory_source" }] });
    expect(memoryResult.passed).toBe(false);
    expect(commentaryResult.passed).toBe(false);
  });

  it("20. validates completion when required sections, evidence and approvals are present", () => {
    expect(validate().passed).toBe(true);
  });

  it("21. missing current authority blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(allRequiredEvidenceCategories().filter((category) => category !== "current_authority")) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence" && failure.details?.includes("current_authority"))).toBe(true);
  });

  it("22. preserves neighbouring Blueprint and legal-advice boundaries", () => {
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("regulatory_change_impact_assessment");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("regulatory_change_impact");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("compliance_audit_readiness");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("policy");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("governance_gap_analysis");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("formal legal advice");
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_advice",
      "binding_interpretation",
      "regulatory_change_impact_assessment_without_request",
      "audit_readiness_assessment_without_request",
      "policy_document_without_request",
      "persistent_register_system",
    ]));
  });

  it("23. routes downstream issues without merging methods", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "current_authority_not_established", action: "mark_CURRENT_AUTHORITY_NOT_ESTABLISHED_and_request_current_source" }),
      expect.objectContaining({ trigger: "applicability_uncertain", action: "mark_APPLICABILITY_UNCERTAIN_and_request_applicability_evidence_or_authorised_interpretation" }),
      expect.objectContaining({ trigger: "regulatory_change_implementation_analysis_required", action: "recommend_regulatory_change_impact_assessment_without_merging_methods" }),
      expect.objectContaining({ trigger: "substantial_policy_drafting_required", action: "recommend_policy_without_emitting_unrequested_policy" }),
      expect.objectContaining({ trigger: "major_corrective_action_required", action: "recommend_corrective_action_improvement_without_performing_CAPA" }),
    ]));
  });

  it("24. does not hard-code mutable law as permanent Blueprint truth", () => {
    expect(sectionByCode("SOURCE_UNIVERSE").instructions).toContain("Do not create a new web scraper");
    expect(sectionByCode("AUTHORITY_CURRENTNESS").instructions).toContain("secondary commentary may assist discovery");
    expect(sectionByCode("EVIDENCE_PROVENANCE").instructions).toContain("Current authority beats historical organisational material");
    expect(blueprintFromRegistry().validationRules.map((rule) => rule.rule)).toContain("current_authority_overrides_historical_register_or_policy");
  });

  it("25. keeps audit readiness, policy and governance gap methods separate", () => {
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("compliance_audit_readiness");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("policy");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("governance_gap_analysis");
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "audit_readiness_assessment_without_request",
      "policy_document_without_request",
    ]));
  });

  it("26. keeps regulatory_change_impact separate as a legacy compatibility route", () => {
    const duplicate = blueprintFromRegistry(DUPLICATE_CODE);
    expect(sectionsFromRegistry(DUPLICATE_CODE)[0].sectionCode).toBe("LEGACY_COMPATIBILITY_ROUTE");
    expect(duplicate.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(DUPLICATE_CODE);
  });

  it("27. keeps sibling 34F Blueprints method-gated", () => {
    expect(methodPendingCodes()).not.toContain("policy");
    expect(methodPendingCodes()).not.toContain("governance_framework");
    expect(methodPendingCodes()).not.toContain("regulatory_change_impact_assessment");
    expect(methodPendingCodes()).not.toContain("governance_gap_analysis");
    expect(methodPendingCodes()).not.toContain("delegation_framework");
    expect(methodPendingCodes()).not.toContain("compliance_audit_readiness");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });
});
