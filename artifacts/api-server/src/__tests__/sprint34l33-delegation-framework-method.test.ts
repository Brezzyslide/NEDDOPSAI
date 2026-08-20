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
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";

const CODE = "delegation_framework";
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
  id: "tpl-delegation-framework",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "delegation_framework_template",
  title: "Delegation Framework Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/delegation-framework.docx",
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

function allRequiredEvidenceCategories(): string[] {
  return [
    ...(blueprintFromRegistry().evidenceContract?.requiredEvidenceCategories ?? []),
    ...sectionsFromRegistry().flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ].filter((category, index, categories) => categories.indexOf(category) === index);
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current delegation authority evidence, decision-right findings, limitations, conflicts, acting authority and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories = allRequiredEvidenceCategories()) {
  return {
    executionId: "exec-delegation-framework",
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
      query: "delegation authority decision rights evidence",
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
    artifactId: "artifact-delegation-framework",
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

describe("Sprint 34L.33 delegation framework method gate and ownership", () => {
  it("1. removes the human professional method blocker for delegation_framework only", () => {
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
    expect(blueprint.requiredApprovals).toMatchObject({ policy_governance_owner: true, executive_owner: true });
  });

  it("3. remains deterministically routed by the delegation framework intent", () => {
    expect(resolveIntent("governance.delegation_framework")).toMatchObject({ code: CODE });
  });

  it("4. names the professional delegation and decision-rights methodology", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.title).toBe("Delegation of Authority & Decision Rights Framework");
    expect(blueprint.purpose).toContain("who may make which organisational decisions");
  });
});

describe("Sprint 34L.33 approved delegation method representation", () => {
  it("5. binds the approved delegation sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "AUTHORITY_SOURCE_DISCOVERY",
      "DECISION_DOMAIN_MAP",
      "RESERVED_NON_DELEGABLE_AUTHORITY",
      "DECISION_RIGHTS_MATRIX",
      "AUTHORITY_LIMITS",
      "PROFESSIONAL_STATUTORY_BOUNDARIES",
      "CONFLICT_OF_INTEREST_CONTROLS",
      "SEGREGATION_OF_DUTIES",
      "ACTING_TEMPORARY_AUTHORITY",
      "DELEGATION_REGISTER_FIELDS",
      "OPERATING_EVIDENCE_VALIDATION",
      "GAPS_AND_CONTRADICTIONS",
      "CONCLUSION_AND_STATUS",
      "BOUNDARIES_AND_HANDOFFS",
    ]);
  });

  it("6. represents authority source discovery and currentness doctrine", () => {
    expect(sectionByCode("AUTHORITY_SOURCE_DISCOVERY").description).toContain("delegation policy");
    expect(sectionByCode("AUTHORITY_SOURCE_DISCOVERY").description).toContain("system/data access approvals");
    expect(sectionByCode("AUTHORITY_SOURCE_DISCOVERY").instructions).toContain("Do not treat historical");
  });

  it("7. represents decision-domain analysis without hard-coded organisational values", () => {
    expect(sectionByCode("DECISION_DOMAIN_MAP").description).toContain("governance");
    expect(sectionByCode("DECISION_DOMAIN_MAP").description).toContain("financial");
    expect(sectionByCode("DECISION_DOMAIN_MAP").description).toContain("digital/information");
    expect(sectionByCode("DECISION_DOMAIN_MAP").instructions).toContain("Do not hard-code MH&R-specific");
  });

  it("8. identifies reserved/non-delegable authority and separates authority concepts", () => {
    expect(sectionByCode("RESERVED_NON_DELEGABLE_AUTHORITY").description).toContain("Board-reserved");
    expect(sectionByCode("RESERVED_NON_DELEGABLE_AUTHORITY").description).toContain("professionally restricted");
    expect(sectionByCode("RESERVED_NON_DELEGABLE_AUTHORITY").instructions).toContain("ACCOUNTABILITY, AUTHORITY, RESPONSIBILITY and EXECUTION");
  });

  it("9. maps decision rights with source, limits, conditions and currentness", () => {
    expect(sectionByCode("DECISION_RIGHTS_MATRIX").description).toContain("permitted delegate");
    expect(sectionByCode("DECISION_RIGHTS_MATRIX").description).toContain("threshold/limit");
    expect(sectionByCode("DECISION_RIGHTS_MATRIX").description).toContain("review/currentness");
    expect(sectionByCode("DECISION_RIGHTS_MATRIX").instructions).toContain("AUTHORITY_NOT_EVIDENCED");
  });

  it("10. represents authority limits and prevents cross-domain authority transfer", () => {
    expect(sectionByCode("AUTHORITY_LIMITS").description).toContain("Monetary threshold");
    expect(sectionByCode("AUTHORITY_LIMITS").description).toContain("participant-specific scope");
    expect(sectionByCode("AUTHORITY_LIMITS").instructions).toContain("does not transfer to another domain");
  });

  it("11. protects professional, statutory and WorkerProfile boundaries", () => {
    expect(sectionByCode("PROFESSIONAL_STATUTORY_BOUNDARIES").description).toContain("Restrictive-practice authority");
    expect(sectionByCode("PROFESSIONAL_STATUTORY_BOUNDARIES").description).toContain("WorkerProfile authority boundary");
    expect(sectionByCode("PROFESSIONAL_STATUTORY_BOUNDARIES").instructions).toContain("must never create statutory");
    expect(getWorkerProfileByCode("policy_governance_specialist_profile")).toBeDefined();
  });

  it("12. represents conflict-of-interest and segregation-of-duties controls", () => {
    expect(sectionByCode("CONFLICT_OF_INTEREST_CONTROLS").description).toContain("Self-approval");
    expect(sectionByCode("CONFLICT_OF_INTEREST_CONTROLS").description).toContain("complaint subject as decision-maker");
    expect(sectionByCode("CONFLICT_OF_INTEREST_CONTROLS").instructions).toContain("Absence of a conflict declaration");
    expect(sectionByCode("SEGREGATION_OF_DUTIES").description).toContain("payment creator");
  });

  it("13. represents acting/temporary authority and duration/currentness", () => {
    expect(sectionByCode("ACTING_TEMPORARY_AUTHORITY").description).toContain("commencement");
    expect(sectionByCode("ACTING_TEMPORARY_AUTHORITY").description).toContain("end date");
    expect(sectionByCode("ACTING_TEMPORARY_AUTHORITY").description).toContain("reversion");
    expect(sectionByCode("ACTING_TEMPORARY_AUTHORITY").instructions).toContain("next-most-senior");
  });

  it("14. defines register/matrix fields without hard-coding rendering", () => {
    expect(sectionByCode("DELEGATION_REGISTER_FIELDS").description).toContain("conflict control");
    expect(sectionByCode("DELEGATION_REGISTER_FIELDS").description).toContain("evidence reference");
    expect(sectionByCode("DELEGATION_REGISTER_FIELDS").instructions).toContain("Template/artifact infrastructure controls presentation");
  });

  it("15. validates designed delegation against operating evidence", () => {
    expect(sectionByCode("OPERATING_EVIDENCE_VALIDATION").description).toContain("workflow logs");
    expect(sectionByCode("OPERATING_EVIDENCE_VALIDATION").description).toContain("system-access roles");
    expect(sectionByCode("OPERATING_EVIDENCE_VALIDATION").instructions).toContain("Do not treat written policy as proof");
  });

  it("16. surfaces delegation gaps and contradiction states", () => {
    expect(sectionByCode("GAPS_AND_CONTRADICTIONS").description).toContain("Responsibility with no authority");
    expect(sectionByCode("GAPS_AND_CONTRADICTIONS").description).toContain("system permissions inconsistent");
    expect(sectionByCode("GAPS_AND_CONTRADICTIONS").instructions).toContain("UNSAFE_OR_UNLAWFUL_DELEGATION");
  });

  it("17. supports defensible conclusion states without auto-readiness", () => {
    expect(sectionByCode("CONCLUSION_AND_STATUS").description).toContain("DEFINED");
    expect(sectionByCode("CONCLUSION_AND_STATUS").description).toContain("MATERIAL_GAPS");
    expect(sectionByCode("CONCLUSION_AND_STATUS").description).toContain("EVIDENCE_INSUFFICIENT");
    expect(sectionByCode("CONCLUSION_AND_STATUS").instructions).toContain("does not equal approval");
  });
});

describe("Sprint 34L.33 evidence, validation and boundary controls", () => {
  it("18. requires current delegation, authority, governance and structure evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["delegation_record", "authority_record", "governance_framework", "organisational_structure"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("19. enforces currentness and non-inference principles", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      historicalDelegationsRemainHistorical: true,
      supersededDelegationsCannotProveCurrentAuthority: true,
      absenceOfAuthorityRecordDoesNotCreateAuthority: true,
      seniorityDoesNotEqualAuthority: true,
      responsibilityDoesNotEqualAuthority: true,
      managerialDelegationCannotCreateStatutoryOrProfessionalAuthority: true,
      systemPermissionDoesNotEqualApprovedDelegation: true,
      writtenPolicyDoesNotProveOperatingPractice: true,
    });
  });

  it("20. rejects memory-only evidence for authority proof", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "delegation_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("21. validates completion when required sections, evidence, artifact and approvals are present", () => {
    expect(validate().passed).toBe(true);
  });

  it("22. missing authority evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(allRequiredEvidenceCategories().filter((category) => category !== "authority_record")) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence" && failure.details?.includes("authority_record"))).toBe(true);
  });

  it("23. blocks completion without the controlled artifact", () => {
    const result = validate({ artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("24. prevents sibling-method and authority-engine overreach", () => {
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("governance_framework");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("governance_gap_analysis");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("WorkerProfile");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("RBAC/system permissions");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").instructions).toContain("does not duplicate governance architecture");
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "binding_delegation",
      "rbac_system_redesign",
      "financial_control_audit",
      "approval_engine_change",
    ]));
  });

  it("25. routes conflicts without replacing neighbouring systems", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "authority_not_evidenced", action: "mark_AUTHORITY_NOT_EVIDENCED_and_request_authoritative_source" }),
      expect.objectContaining({ trigger: "worker_profile_conflict_identified", action: "surface_conflict_without_changing_WorkerProfile_authority" }),
      expect.objectContaining({ trigger: "system_permission_conflicts_with_delegation", action: "recommend_RBAC_review_without_redesigning_system_permissions" }),
      expect.objectContaining({ trigger: "governance_architecture_gap_identified", action: "recommend_governance_framework_or_governance_gap_analysis_without_merging_methods" }),
    ]));
  });

  it("26. keeps sibling 34F Blueprints method-gated", () => {
    expect(methodPendingCodes()).not.toContain("policy");
    expect(methodPendingCodes()).not.toContain("governance_framework");
    expect(methodPendingCodes()).not.toContain("regulatory_change_impact_assessment");
    expect(methodPendingCodes()).not.toContain("governance_gap_analysis");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });
});
