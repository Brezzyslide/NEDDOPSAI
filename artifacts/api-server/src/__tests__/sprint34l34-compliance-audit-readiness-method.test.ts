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

const CODE = "compliance_audit_readiness";
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
  id: "tpl-audit-readiness",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "audit_readiness_template",
  title: "Audit Readiness Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/audit-readiness.docx",
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
    mode: "audit_readiness",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current audit-scope evidence, requirement mapping, evidence quality findings, implementation evidence, domain readiness and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories = allRequiredEvidenceCategories()) {
  return {
    executionId: "exec-audit-readiness",
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
      query: "audit readiness compliance evidence",
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
    artifactId: "artifact-audit-readiness",
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

describe("Sprint 34L.34 compliance audit readiness method gate and ownership", () => {
  it("1. removes the human professional method blocker for compliance_audit_readiness only", () => {
    const blueprint = blueprintFromRegistry();
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Compliance & Quality ownership with Policy/KDS/Ops support", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(CODE)!)).toBe("compliance_quality_manager");
    expect(blueprint.primarySpecialist).toBe("compliance_quality_manager");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining(["policy_governance_specialist", "knowledge_documentation_specialist", "operations_manager"]));
    expect(blueprint.requiredApprovals).toMatchObject({ compliance_quality_owner: true });
  });

  it("3. remains deterministically routed by the audit-readiness intent", () => {
    expect(resolveIntent("compliance.audit_readiness")).toMatchObject({ code: CODE });
  });

  it("4. names the professional audit readiness and evidence assurance method", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.title).toBe("Compliance Audit Readiness & Evidence Assurance Review");
    expect(blueprint.purpose).toContain("current, reliable, retrievable and implementation-linked evidence");
  });
});

describe("Sprint 34L.34 approved audit-readiness method representation", () => {
  it("5. binds the approved audit readiness sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "AUDIT_ASSURANCE_CONTEXT",
      "APPLICABLE_REQUIREMENTS",
      "REQUIREMENT_EVIDENCE_MAP",
      "EVIDENCE_DISCOVERY",
      "EVIDENCE_QUALITY_TEST",
      "DOCUMENT_CONTROL_CURRENTNESS",
      "IMPLEMENTATION_EVIDENCE_TEST",
      "EVIDENCE_OWNERSHIP_ACCOUNTABILITY",
      "CONTRADICTIONS_AND_CONFLICTS",
      "READINESS_GAP_IDENTIFICATION",
      "RISK_MATERIALITY",
      "READINESS_ACTIONS",
      "DOMAIN_READINESS",
      "OVERALL_READINESS_CONCLUSION",
      "BOUNDARIES_AND_HANDOFFS",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("6. represents audit context and scope establishment", () => {
    expect(sectionByCode("AUDIT_ASSURANCE_CONTEXT").description).toContain("Audit or review type");
    expect(sectionByCode("AUDIT_ASSURANCE_CONTEXT").description).toContain("registration groups");
    expect(sectionByCode("AUDIT_ASSURANCE_CONTEXT").instructions).toContain("Do not assume a generic NDIS audit");
  });

  it("7. represents applicable requirement and current-authority resolution", () => {
    expect(sectionByCode("APPLICABLE_REQUIREMENTS").description).toContain("NDIS Practice Standards");
    expect(sectionByCode("APPLICABLE_REQUIREMENTS").description).toContain("workforce obligations");
    expect(sectionByCode("APPLICABLE_REQUIREMENTS").instructions).toContain("Use existing KRS/current-authority architecture");
  });

  it("8. maps requirements to evidence rather than dumping documents", () => {
    expect(sectionByCode("REQUIREMENT_EVIDENCE_MAP").description).toContain("required control/practice");
    expect(sectionByCode("REQUIREMENT_EVIDENCE_MAP").description).toContain("implementation support");
    expect(sectionByCode("REQUIREMENT_EVIDENCE_MAP").instructions).toContain("Avoid document dumping");
  });

  it("9. represents evidence discovery and quality verification", () => {
    expect(sectionByCode("EVIDENCE_DISCOVERY").description).toContain("participant service delivery");
    expect(sectionByCode("EVIDENCE_DISCOVERY").description).toContain("corrective-action");
    expect(sectionByCode("EVIDENCE_QUALITY_TEST").description).toContain("retrieval accessibility");
    expect(sectionByCode("EVIDENCE_QUALITY_TEST").instructions).toContain("File presence alone is not sufficient");
  });

  it("10. tests document control, currentness and supersession", () => {
    expect(sectionByCode("DOCUMENT_CONTROL_CURRENTNESS").description).toContain("supersession");
    expect(sectionByCode("DOCUMENT_CONTROL_CURRENTNESS").description).toContain("obsolete versions");
    expect(sectionByCode("DOCUMENT_CONTROL_CURRENTNESS").instructions).toContain("Do not treat workers or systems as compliant based on superseded documents");
  });

  it("11. separates policy existence from implementation and operating evidence", () => {
    expect(sectionByCode("IMPLEMENTATION_EVIDENCE_TEST").description).toContain("process implemented");
    expect(sectionByCode("IMPLEMENTATION_EVIDENCE_TEST").description).toContain("outcome/effectiveness evidence");
    expect(sectionByCode("IMPLEMENTATION_EVIDENCE_TEST").instructions).toContain("Policy exists does not equal requirement implemented");
  });

  it("12. represents evidence ownership and accountability", () => {
    expect(sectionByCode("EVIDENCE_OWNERSHIP_ACCOUNTABILITY").description).toContain("Evidence owner");
    expect(sectionByCode("EVIDENCE_OWNERSHIP_ACCOUNTABILITY").description).toContain("responsible remediation owner");
    expect(sectionByCode("EVIDENCE_OWNERSHIP_ACCOUNTABILITY").instructions).toContain("Do not create generic unowned gaps");
  });

  it("13. preserves contradictions and unsupported compliance claims", () => {
    expect(sectionByCode("CONTRADICTIONS_AND_CONFLICTS").description).toContain("bypassed approval records");
    expect(sectionByCode("CONTRADICTIONS_AND_CONFLICTS").instructions).toContain("Do not silently choose");
    expect(sectionByCode("READINESS_GAP_IDENTIFICATION").description).toContain("unsupported compliance claim");
    expect(sectionByCode("READINESS_GAP_IDENTIFICATION").instructions).toContain("Do not invent missing records");
  });

  it("14. represents previous findings, CAPA closure evidence and effectiveness separation", () => {
    expect(sectionByCode("READINESS_GAP_IDENTIFICATION").description).toContain("unresolved previous finding");
    expect(sectionByCode("READINESS_GAP_IDENTIFICATION").description).toContain("closure without effectiveness evidence");
    expect(sectionByCode("READINESS_ACTIONS").instructions).toContain("corrective_action_improvement");
  });

  it("15. represents risk/materiality and domain-level readiness", () => {
    expect(sectionByCode("RISK_MATERIALITY").description).toContain("Participant safety");
    expect(sectionByCode("RISK_MATERIALITY").instructions).toContain("formatting issue is not equivalent");
    expect(sectionByCode("DOMAIN_READINESS").description).toContain("restrictive practice");
    expect(sectionByCode("DOMAIN_READINESS").instructions).toContain("One ready domain must not mask another domain");
  });

  it("16. supports evidence-backed overall readiness conclusions", () => {
    expect(sectionByCode("OVERALL_READINESS_CONCLUSION").description).toContain("READY_WITH_MINOR_GAPS");
    expect(sectionByCode("OVERALL_READINESS_CONCLUSION").description).toContain("EVIDENCE_INSUFFICIENT");
    expect(sectionByCode("OVERALL_READINESS_CONCLUSION").instructions).toContain("Readiness must be justified by evidence");
  });
});

describe("Sprint 34L.34 evidence, validation and boundary controls", () => {
  it("17. requires audit scope, criteria, current authority, controlled document and implementation evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["audit_scope", "audit_criteria", "current_authority", "controlled_document", "implementation_evidence"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("18. enforces currentness, retrievability and non-inference rules", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      supersededEvidenceCannotProveCurrentReadiness: true,
      oldAuditChecklistDoesNotOverrideCurrentAuthority: true,
      policyExistenceDoesNotProveImplementation: true,
      evidenceMustBeRetrievableToBeVerified: true,
      absenceOfContraryEvidenceDoesNotProveCompliance: true,
      closureEvidenceDoesNotProveEffectiveness: true,
      readinessIsRequirementSpecific: true,
      materialityMustDrivePriority: true,
    });
  });

  it("19. rejects memory-only evidence for audit readiness proof", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "audit_criteria" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("20. validates completion when required sections, evidence, artifact and approval are present", () => {
    expect(validate().passed).toBe(true);
  });

  it("21. missing implementation evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(allRequiredEvidenceCategories().filter((category) => category !== "implementation_evidence")) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence" && failure.details?.includes("implementation_evidence"))).toBe(true);
  });

  it("22. blocks completion without the controlled artifact", () => {
    const result = validate({ artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("23. preserves neighbouring Blueprint and infrastructure boundaries", () => {
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("governance_gap_analysis");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("domain-specific compliance Blueprints");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("corrective_action_improvement");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("evidence-management/KRS architecture");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("template/artifact/export infrastructure");
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "audit_certification",
      "regulator_submission",
      "domain_professional_conclusion",
      "capa_without_request",
      "evidence_repository_creation",
    ]));
  });

  it("24. routes material gaps without replacing CAPA, document control or domain methods", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "evidence_not_produced", action: "mark_EVIDENCE_NOT_PRODUCED_and_identify_owner_or_gap" }),
      expect.objectContaining({ trigger: "implementation_evidence_missing", action: "mark_missing_implementation_evidence_without_inferring_compliance" }),
      expect.objectContaining({ trigger: "substantial_capa_required", action: "recommend_corrective_action_improvement_without_performing_full_CAPA_methodology" }),
      expect.objectContaining({ trigger: "domain_specific_professional_review_required", action: "route_to_relevant_domain_Blueprint_without_replacing_method" }),
      expect.objectContaining({ trigger: "document_control_failure_identified", action: "recommend_document_control_review_without_replacing_lifecycle_architecture" }),
    ]));
  });

  it("25. keeps existing evidence and KRS/current-authority architecture authoritative", () => {
    expect(sectionByCode("EVIDENCE_DISCOVERY").instructions).toContain("Use existing evidence discovery");
    expect(sectionByCode("APPLICABLE_REQUIREMENTS").instructions).toContain("Use existing KRS/current-authority architecture");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("evidence-management/KRS architecture");
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toContain("evidence_repository_creation");
  });

  it("26. keeps sibling 34F Blueprints method-gated", () => {
    expect(methodPendingCodes()).not.toContain("policy");
    expect(methodPendingCodes()).not.toContain("governance_framework");
    expect(methodPendingCodes()).not.toContain("regulatory_change_impact_assessment");
    expect(methodPendingCodes()).not.toContain("governance_gap_analysis");
    expect(methodPendingCodes()).not.toContain("delegation_framework");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });
});
