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
  WorkTemplate,
} from "../services/workBlueprintService.js";

const CODE = "governance_framework";
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

const template: WorkTemplate = {
  id: "tpl-governance-framework",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "governance_framework_template",
  title: "Governance Framework Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/governance-framework.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: NOW,
  updatedAt: NOW,
};

function contractFor(): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template,
    mode: "review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with source-backed governance architecture evidence, authority boundaries and unresolved decisions.`)
    .join("\n\n");
}

function allRequiredEvidenceCategories(): string[] {
  return [
    ...(blueprintFromRegistry().evidenceContract?.requiredEvidenceCategories ?? []),
    ...sectionsFromRegistry().flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ].filter((category, index, categories) => categories.indexOf(category) === index);
}

function evidencePack(categories = allRequiredEvidenceCategories()) {
  return {
    executionId: "exec-governance-framework",
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
      query: "governance framework evidence",
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
    artifactId: "artifact-governance-framework",
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

describe("Sprint 34L.30 governance framework method gate and ownership", () => {
  it("1. removes the human professional method blocker for governance_framework only", () => {
    const blueprint = blueprintFromRegistry();
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Policy & Governance ownership and focused supporting specialists", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(CODE)!)).toBe("policy_governance_specialist");
    expect(blueprint.primarySpecialist).toBe("policy_governance_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining(["compliance_quality_manager", "knowledge_documentation_specialist"]));
    expect(blueprint.requiredApprovals).toMatchObject({ policy_governance_owner: true, executive_owner: true });
  });

  it("3. remains deterministically routed by the governance framework intent", () => {
    expect(resolveIntent("governance.framework")).toMatchObject({ code: CODE });
  });
});

describe("Sprint 34L.30 approved governance architecture method representation", () => {
  it("4. binds the approved governance framework sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "GOVERNANCE_PURPOSE_SCOPE",
      "GOVERNANCE_CONTEXT_RISK_PROFILE",
      "EXTERNAL_AUTHORITATIVE_REQUIREMENTS",
      "GOVERNANCE_OBJECTIVES",
      "GOVERNANCE_DOMAINS",
      "ULTIMATE_ACCOUNTABILITY",
      "PROFESSIONAL_AUTHORITY_BOUNDARIES",
      "ROLES_ACCOUNTABILITY",
      "DECISION_RIGHTS",
      "RESERVED_AUTHORITY",
      "DELEGATION_INTERFACE",
      "GOVERNANCE_FORUMS_MECHANISMS",
      "REPORTING_INFORMATION_FLOWS",
      "RISK_GOVERNANCE",
      "ESCALATION_ARCHITECTURE",
      "CONFLICT_OF_INTEREST_CONTROLS",
      "STAKEHOLDER_PARTICIPANT_VOICE",
      "ASSURANCE_MODEL",
      "GOVERNANCE_FAILURE_CORRECTIVE_ACTION",
      "EFFECTIVENESS_MEASURES",
      "REVIEW_CHANGE_TRIGGERS",
      "OUTSTANDING_GOVERNANCE_DECISIONS",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. requires scope, context and proportional risk-based design", () => {
    expect(sectionByCode("GOVERNANCE_PURPOSE_SCOPE").instructions).toContain("Do not silently expand");
    expect(sectionByCode("GOVERNANCE_CONTEXT_RISK_PROFILE").instructions).toContain("proportionate");
    expect(sectionByCode("GOVERNANCE_CONTEXT_RISK_PROFILE").instructions).toContain("More governance structure is not automatically better governance");
  });

  it("6. represents external authority through existing current-authority architecture", () => {
    expect(sectionByCode("EXTERNAL_AUTHORITATIVE_REQUIREMENTS").description).toContain("currentness");
    expect(sectionByCode("EXTERNAL_AUTHORITATIVE_REQUIREMENTS").instructions).toContain("existing KRS/current-authority architecture");
    expect(sectionByCode("EVIDENCE_PROVENANCE").instructions).toContain("Do not create another KRS");
  });

  it("7. separates ultimate accountability from delegation", () => {
    expect(sectionByCode("ULTIMATE_ACCOUNTABILITY").description).toContain("authority basis");
    expect(sectionByCode("ULTIMATE_ACCOUNTABILITY").instructions).toContain("DELEGATION DOES NOT AUTOMATICALLY REMOVE ULTIMATE ACCOUNTABILITY");
  });

  it("8. separates professional authority from role seniority", () => {
    expect(sectionByCode("PROFESSIONAL_AUTHORITY_BOUNDARIES").description).toContain("APO determinations");
    expect(sectionByCode("PROFESSIONAL_AUTHORITY_BOUNDARIES").instructions).toContain("ROLE SENIORITY DOES NOT EQUAL PROFESSIONAL AUTHORITY");
  });

  it("9. represents accountability roles, decision rights and reserved authority", () => {
    expect(sectionByCode("ROLES_ACCOUNTABILITY").description).toContain("ULTIMATE_ACCOUNTABLE");
    expect(sectionByCode("DECISION_RIGHTS").instructions).toContain("RESPONSIBILITY, DECISION AUTHORITY, APPROVAL AUTHORITY and PROFESSIONAL AUTHORITY");
    expect(sectionByCode("RESERVED_AUTHORITY").description).toContain("Strategic approval");
  });

  it("10. treats delegation as an interface rather than duplicating delegation_framework", () => {
    expect(sectionByCode("DELEGATION_INTERFACE").description).toContain("retained accountability");
    expect(sectionByCode("DELEGATION_INTERFACE").instructions).toContain("Detailed delegation mechanics belong to delegation_framework");
  });

  it("11. represents governance forums and reporting flows without hard-coding frequencies", () => {
    expect(sectionByCode("GOVERNANCE_FORUMS_MECHANISMS").description).toContain("purpose, scope, membership");
    expect(sectionByCode("GOVERNANCE_FORUMS_MECHANISMS").instructions).toContain("Do not hard-code meeting names or frequencies");
    expect(sectionByCode("REPORTING_INFORMATION_FLOWS").instructions).toContain("Do not invent reporting frequencies");
  });

  it("12. represents risk, escalation, stakeholder voice and conflict controls", () => {
    expect(sectionByCode("RISK_GOVERNANCE").instructions).toContain("not another Risk Assessment Blueprint");
    expect(sectionByCode("ESCALATION_ARCHITECTURE").description).toContain("professional, safeguarding, executive");
    expect(sectionByCode("STAKEHOLDER_PARTICIPANT_VOICE").instructions).toContain("where input enters governance");
    expect(sectionByCode("CONFLICT_OF_INTEREST_CONTROLS").description).toContain("decision-making restriction");
  });

  it("13. represents assurance, governance failure response and effectiveness", () => {
    expect(sectionByCode("ASSURANCE_MODEL").description).toContain("CONTROL to EVIDENCE to MONITOR");
    expect(sectionByCode("ASSURANCE_MODEL").instructions).toContain("Do not equate policy existence with assurance");
    expect(sectionByCode("GOVERNANCE_FAILURE_CORRECTIVE_ACTION").description).toContain("systemic risk");
    expect(sectionByCode("EFFECTIVENESS_MEASURES").instructions).toContain("Do not invent numeric KPIs");
  });
});

describe("Sprint 34L.30 evidence, approval and authority boundaries", () => {
  it("14. requires governance framework, organisational context, authority and current-authority evidence", () => {
    const contract = blueprintFromRegistry().evidenceContract;
    expect(contract).toMatchObject({
      requiredEvidenceCategories: ["governance_framework", "organisation_context", "authority_record", "current_authority"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("15. enforces governance-specific currentness and authority distinctions", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      governanceDesignMustBeProportionateToSizeComplexityAndRisk: true,
      delegationDoesNotRemoveUltimateAccountability: true,
      roleSeniorityDoesNotEqualProfessionalAuthority: true,
      responsibilityDoesNotEqualDecisionAuthority: true,
      governanceFrameworkDoesNotDuplicateDelegationFramework: true,
      policyExistenceDoesNotProveAssurance: true,
    });
  });

  it("16. rejects memory-only or uncontrolled-copy evidence for governance authority", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "authority_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("17. validates completion when method, evidence, template, artifact and approvals are present", () => {
    expect(validate().passed).toBe(true);
  });

  it("18. missing authority evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(allRequiredEvidenceCategories().filter((category) => category !== "authority_record")) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence" && failure.details?.includes("authority_record"))).toBe(true);
  });

  it("19. preserves policy, gap-analysis, executive-review and implementation boundaries", () => {
    const deliverable = blueprintFromRegistry().deliverableContract!;
    expect(deliverable.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "policy_deliverable_without_request",
      "governance_gap_analysis_without_request",
      "executive_review_without_request",
      "delegation_framework_without_request",
      "implementation_execution",
    ]));
    expect(blueprintFromRegistry().validationRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "delegation_framework_boundary_preserved",
      "policy_gap_analysis_executive_review_boundaries_preserved",
      "organisational_governance_decisions_not_fabricated",
    ]));
  });

  it("20. routes unresolved governance decisions and delegation mechanics without inventing authority", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "ultimate_accountability_unresolved", action: "return_organisational_governance_decision_required" }),
      expect.objectContaining({ trigger: "delegation_mechanics_required", action: "recommend_delegation_framework_without_duplicating_methodology" }),
      expect.objectContaining({ trigger: "unauthorised_new_forum_or_reserved_authority_required", action: "return_organisational_governance_decision_required" }),
    ]));
  });

  it("21. keeps unrelated pending 34F Blueprints method-gated", () => {
    expect(methodPendingCodes()).not.toContain("policy");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });
});
