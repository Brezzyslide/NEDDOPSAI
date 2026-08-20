import { readFileSync } from "node:fs";
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
} from "../services/workBlueprintService.js";

const CODE = "regulatory_change_impact_assessment";
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

function contractFor(code = CODE): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(code),
    sections: sectionsFromRegistry(code),
    template: null,
    mode: "review",
  };
}

function allRequiredEvidenceCategories(): string[] {
  return [
    ...(blueprintFromRegistry().evidenceContract?.requiredEvidenceCategories ?? []),
    ...sectionsFromRegistry().flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ].filter((category, index, categories) => categories.indexOf(category) === index);
}

function contentFor(code = CODE): string {
  return sectionsFromRegistry(code)
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current regulatory source evidence, organisational state, impact, action, verification and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories = allRequiredEvidenceCategories()) {
  return {
    executionId: "exec-reg-change",
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
      query: "regulatory change impact evidence",
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

describe("Sprint 34L.31 regulatory change impact method gate and ownership", () => {
  it("1. removes the human professional method blocker for regulatory_change_impact_assessment only", () => {
    const blueprint = blueprintFromRegistry();
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Policy & Governance ownership and compliance/KDS support", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(CODE)!)).toBe("policy_governance_specialist");
    expect(blueprint.primarySpecialist).toBe("policy_governance_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining(["compliance_quality_manager", "knowledge_documentation_specialist"]));
    expect(blueprint.requiredApprovals).toMatchObject({ policy_governance_owner: true, compliance_quality_owner: true });
  });

  it("3. remains deterministically routed by the authored impact-assessment intent", () => {
    expect(resolveIntent("governance.regulatory_change_impact")).toMatchObject({ code: CODE });
  });
});

describe("Sprint 34L.31 approved regulatory change impact method representation", () => {
  it("4. binds the approved change-impact sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "EXECUTIVE_REGULATORY_CHANGE_POSITION",
      "CHANGE_SCOPE",
      "AUTHORITATIVE_SOURCE",
      "SOURCE_AUTHORITY_CURRENTNESS",
      "EFFECTIVE_TRANSITION_DATES",
      "PREVIOUS_REQUIREMENT",
      "NEW_REQUIREMENT",
      "MATERIAL_CHANGE",
      "APPLICABILITY",
      "AFFECTED_ORGANISATIONAL_DOMAINS",
      "CURRENT_ORGANISATIONAL_STATE",
      "REQUIRED_FUTURE_STATE",
      "GAP_ANALYSIS",
      "POLICY_IMPACT",
      "PROCEDURE_SOP_IMPACT",
      "WORKFORCE_IMPACT",
      "TRAINING_CAPABILITY_IMPACT",
      "SYSTEM_WORKFLOW_IMPACT",
      "DOCUMENT_TEMPLATE_FORM_IMPACT",
      "REGISTER_EVIDENCE_IMPACT",
      "SERVICE_PARTICIPANT_SAFEGUARDING_IMPACT",
      "DOMAIN_SPECIALIST_FINDINGS",
      "RISK_PRIORITY",
      "REQUIRED_ACTIONS",
      "OWNERS_DEPENDENCIES",
      "EFFECTIVE_DATES_INTERNAL_DEADLINES",
      "IMPLEMENTATION_EVIDENCE",
      "EFFECTIVENESS_VERIFICATION",
      "OUTSTANDING_ACTIONS",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. consumes current authority through existing KRS architecture", () => {
    expect(sectionByCode("AUTHORITATIVE_SOURCE").instructions).toContain("existing KRS/current-authority/Trusted External Sources architecture");
    expect(sectionByCode("EVIDENCE_PROVENANCE").instructions).toContain("Existing KRS resolves sources");
  });

  it("6. represents source authority classification without flattening authority", () => {
    expect(sectionByCode("SOURCE_AUTHORITY_CURRENTNESS").description).toContain("LEGISLATION");
    expect(sectionByCode("SOURCE_AUTHORITY_CURRENTNESS").description).toContain("REGULATOR_GUIDANCE");
    expect(sectionByCode("SOURCE_AUTHORITY_CURRENTNESS").instructions).toContain("Do not treat all external material as equal");
  });

  it("7. preserves announced, effective, transitional and applicable states", () => {
    expect(sectionByCode("SOURCE_AUTHORITY_CURRENTNESS").description).toContain("FUTURE_EFFECTIVE");
    expect(sectionByCode("SOURCE_AUTHORITY_CURRENTNESS").description).toContain("TRANSITIONAL");
    expect(sectionByCode("APPLICABILITY").instructions).toContain("APPLICABILITY_REQUIRES_CLARIFICATION");
  });

  it("8. requires previous versus new requirement and material delta", () => {
    expect(sectionByCode("PREVIOUS_REQUIREMENT").description).toContain("Previous requirement");
    expect(sectionByCode("NEW_REQUIREMENT").description).toContain("New requirement");
    expect(sectionByCode("MATERIAL_CHANGE").instructions).toContain("material difference");
  });

  it("9. represents organisational applicability, current state, required state and gap", () => {
    expect(sectionByCode("APPLICABILITY").instructions).toContain("Do not assume every change applies");
    expect(sectionByCode("CURRENT_ORGANISATIONAL_STATE").description).toContain("training matrix");
    expect(sectionByCode("REQUIRED_FUTURE_STATE").description).toContain("New required organisational state");
    expect(sectionByCode("GAP_ANALYSIS").description).toContain("CURRENT_ORGANISATIONAL_STATE vs NEW_REQUIRED_STATE");
  });

  it("10. represents affected domains without assuming all domains are affected", () => {
    expect(sectionByCode("AFFECTED_ORGANISATIONAL_DOMAINS").description).toContain("safeguarding");
    expect(sectionByCode("AFFECTED_ORGANISATIONAL_DOMAINS").description).toContain("systems/workflows");
    expect(sectionByCode("AFFECTED_ORGANISATIONAL_DOMAINS").instructions).toContain("Do not treat every domain as affected");
  });

  it("11. keeps policy and SOP impact distinct from drafting", () => {
    expect(sectionByCode("POLICY_IMPACT").instructions).toContain("Do not automatically rewrite policy");
    expect(sectionByCode("PROCEDURE_SOP_IMPACT").instructions).toContain("Do not automatically emit a new SOP");
  });

  it("12. represents workforce, training, system, document, register, service and safeguarding impacts", () => {
    expect(sectionByCode("WORKFORCE_IMPACT").description).toContain("deployment restriction");
    expect(sectionByCode("TRAINING_CAPABILITY_IMPACT").instructions).toContain("Do not invent training frequency");
    expect(sectionByCode("SYSTEM_WORKFLOW_IMPACT").description).toContain("validation rule");
    expect(sectionByCode("DOCUMENT_TEMPLATE_FORM_IMPACT").description).toContain("controlled documents");
    expect(sectionByCode("REGISTER_EVIDENCE_IMPACT").description).toContain("legislative");
    expect(sectionByCode("SERVICE_PARTICIPANT_SAFEGUARDING_IMPACT").instructions).toContain("Safeguarding is not an administrative afterthought");
  });

  it("13. preserves domain specialist authority", () => {
    expect(sectionByCode("DOMAIN_SPECIALIST_FINDINGS").description).toContain("Finance/payroll");
    expect(sectionByCode("DOMAIN_SPECIALIST_FINDINGS").instructions).toContain("does not inherit every domain's professional authority");
  });

  it("14. separates regulatory dates from internal due dates", () => {
    expect(sectionByCode("EFFECTIVE_DATES_INTERNAL_DEADLINES").description).toContain("Regulatory effective date");
    expect(sectionByCode("EFFECTIVE_DATES_INTERNAL_DEADLINES").description).toContain("action due date");
    expect(sectionByCode("EFFECTIVE_DATES_INTERNAL_DEADLINES").instructions).toContain("Do not confuse external deadlines with internal due dates");
  });

  it("15. separates implementation completion from effectiveness verification", () => {
    expect(sectionByCode("IMPLEMENTATION_EVIDENCE").description).toContain("training completion");
    expect(sectionByCode("EFFECTIVENESS_VERIFICATION").instructions).toContain("ACTION_REPORTED_COMPLETE does not equal IMPLEMENTATION_VERIFIED");
    expect(sectionByCode("OUTSTANDING_ACTIONS").instructions).toContain("IMPACT_ASSESSMENT_COMPLETE");
  });
});

describe("Sprint 34L.31 evidence, duplicate and boundary controls", () => {
  it("16. requires regulatory source, organisational context and current-practice evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["current_regulatory_source", "organisational_context", "current_practice_evidence"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("17. enforces currentness, source hierarchy and lifecycle distinctions", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      retrievalTimestampDoesNotProveCurrentness: true,
      regulatorGuidanceDoesNotEqualLegislation: true,
      announcedDoesNotEqualEffective: true,
      effectiveDoesNotEqualApplicable: true,
      applicableDoesNotEqualImplemented: true,
      regulatoryEffectiveDateDoesNotEqualInternalDueDate: true,
      implementationVerifiedDoesNotEqualEffectivenessVerified: true,
    });
  });

  it("18. rejects memory-only evidence for current regulatory truth", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "current_regulatory_source" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("19. validates completion when all required method sections, evidence and approvals are present", () => {
    expect(validate().passed).toBe(true);
  });

  it("20. missing current regulatory source blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(allRequiredEvidenceCategories().filter((category) => category !== "current_regulatory_source")) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence" && failure.details?.includes("current_regulatory_source"))).toBe(true);
  });

  it("21. prevents downstream deliverables and preserves duplicate boundary", () => {
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "policy_rewrite_without_request",
      "sop_without_request",
      "system_change_execution",
      "regulatory_change_impact_rationalisation",
    ]));
    expect(blueprintFromRegistry().validationRules.map((rule) => rule.rule)).toContain("regulatory_change_impact_duplicate_boundary_preserved");
  });

  it("22. treats regulatory_change_impact as a legacy compatibility route, not a second method", () => {
    const duplicate = blueprintFromRegistry(DUPLICATE_CODE);
    expect(sectionsFromRegistry(DUPLICATE_CODE)[0].sectionCode).toBe("LEGACY_COMPATIBILITY_ROUTE");
    expect(duplicate.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(DUPLICATE_CODE);
    expect(duplicate.validationRules.map((rule) => rule.rule)).toContain("legacy_regulatory_change_impact_routes_to_canonical_assessment");
  });

  it("23. keeps unrelated pending 34F Blueprints method-gated", () => {
    expect(methodPendingCodes()).not.toContain("policy");
    expect(methodPendingCodes()).not.toContain("governance_framework");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });
});
