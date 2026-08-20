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

const POLICY_CODES = [
  "policy",
  "governance_framework",
  "regulatory_change_impact_assessment",
  "governance_gap_analysis",
  "delegation_framework",
] as const;

const COMPLIANCE_CODES = [
  "compliance_audit_readiness",
  "legislation_regulatory_review",
  "regulatory_change_impact",
  "regulator_response_submission",
] as const;

const EMPLOYMENT_CODES = [
  "schads_award_analysis",
  "employment_compliance_review",
] as const;

const ALL_34F_CODES = [
  ...POLICY_CODES,
  ...COMPLIANCE_CODES,
  ...EMPLOYMENT_CODES,
  "service_agreement_review",
] as const;

const STILL_METHOD_PENDING_34F_CODES = ALL_34F_CODES.filter((code) =>
  code !== "policy"
  && code !== "governance_framework"
  && code !== "regulatory_change_impact_assessment"
  && code !== "governance_gap_analysis"
  && code !== "delegation_framework"
  && code !== "compliance_audit_readiness"
  && code !== "legislation_regulatory_review"
  && code !== "regulatory_change_impact"
  && code !== "regulator_response_submission"
  && code !== "schads_award_analysis"
  && code !== "employment_compliance_review"
  && code !== "service_agreement_review"
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
  id: "tpl-34f",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "governance_template",
  title: "Governance / Compliance Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/governance-report.docx",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current source evidence, visible USER_DEFINITION_REQUIRED method status, approval boundaries, specialist handoffs and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34f",
    organisationId: "org-34f",
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
      query: "policy governance compliance evidence",
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
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34f" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

describe("Sprint 34F ownership and routing", () => {
  it("1. routes policy Blueprints to Policy Governance Specialist", () => {
    for (const code of POLICY_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("policy_governance_specialist");
    }
  });

  it("2. routes compliance Blueprints to the correct governance/compliance owner", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("compliance_audit_readiness")!)).toBe("compliance_quality_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("legislation_regulatory_review")!)).toBe("policy_governance_specialist");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("regulatory_change_impact")!)).toBe("policy_governance_specialist");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("regulator_response_submission")!)).toBe("compliance_quality_manager");
  });

  it("3. routes employment and service-agreement Blueprints without Chief of Staff fallback", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("schads_award_analysis")!)).toBe("payroll_workforce_cost_officer");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("employment_compliance_review")!)).toBe("workforce_compliance_specialist");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("service_agreement_review")!)).toBe("policy_governance_specialist");
    for (const code of ALL_34F_CODES) {
      expect(blueprintFromRegistry(code).primarySpecialist).not.toBe("chief_of_staff");
    }
  });

  it("4. deterministic intents point at the authored 34F Blueprints", () => {
    expect(resolveIntent("policy.create")).toMatchObject({ code: "policy" });
    expect(resolveIntent("governance.framework")).toMatchObject({ code: "governance_framework" });
    expect(resolveIntent("compliance.audit_readiness")).toMatchObject({ code: "compliance_audit_readiness" });
    expect(resolveIntent("compliance.response")).toMatchObject({ code: "regulator_response_submission" });
    expect(resolveIntent("employment.schads_analysis")).toMatchObject({ code: "schads_award_analysis" });
    expect(resolveIntent("agreements.review")).toMatchObject({ code: "service_agreement_review" });
  });
});

describe("Sprint 34F human professional method gate", () => {
  it("5. no 34F Blueprint remains USER_DEFINITION_REQUIRED method-pending", () => {
    expect(STILL_METHOD_PENDING_34F_CODES).toHaveLength(0);
    for (const code of ALL_34F_CODES) {
      expect(sectionsFromRegistry(code).map((section) => section.sectionCode)).not.toContain("USER_DEFINITION_REQUIRED_METHOD");
    }
  });

  it("6. no 34F Blueprint requires human professional method approval", () => {
    for (const code of ALL_34F_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    }
  });

  it("7. missing service-agreement domain approval blocks completion", () => {
    const approvalStates = approvalsFor("service_agreement_review");
    approvalStates.policy_governance_owner = false;
    const result = validate("service_agreement_review", { approvalStates });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });

  it("8. missing service-agreement document authority section blocks completion", () => {
    const result = validate("service_agreement_review", {
      contentMarkdown: "## MATERIAL_TERMS_COMPLETENESS_GATE\nMaterial terms are populated, but the document authority section is absent.",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });
});

describe("Sprint 34F evidence and currentness controls", () => {
  it("9. policy and governance work requires current controlled source evidence", () => {
    expect(blueprintFromRegistry("policy").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["controlled_document", "current_authority", "organisation_context", "domain_owner_input"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
    expect(blueprintFromRegistry("governance_framework").evidenceContract?.freshnessRules).toMatchObject({
      currentnessRequired: true,
      historicalInstrumentsRemainHistorical: true,
      governanceDesignMustBeProportionateToSizeComplexityAndRisk: true,
      delegationDoesNotRemoveUltimateAccountability: true,
    });
    expect(blueprintFromRegistry("governance_framework").evidenceContract?.requiredEvidenceCategories).toEqual(["governance_framework", "organisation_context", "authority_record", "current_authority"]);
    expect(blueprintFromRegistry("governance_gap_analysis").evidenceContract?.requiredEvidenceCategories).toEqual(["current_authority", "governance_framework", "implementation_evidence", "assurance_record"]);
    expect(blueprintFromRegistry("governance_gap_analysis").evidenceContract?.freshnessRules).toMatchObject({
      requiredDoesNotEqualDesigned: true,
      designedDoesNotEqualImplemented: true,
      evidencedDoesNotEqualEffective: true,
    });
    expect(blueprintFromRegistry("delegation_framework").evidenceContract?.requiredEvidenceCategories).toEqual(["delegation_record", "authority_record", "governance_framework", "organisational_structure"]);
    expect(blueprintFromRegistry("delegation_framework").evidenceContract?.freshnessRules).toMatchObject({
      absenceOfAuthorityRecordDoesNotCreateAuthority: true,
      managerialDelegationCannotCreateStatutoryOrProfessionalAuthority: true,
      systemPermissionDoesNotEqualApprovedDelegation: true,
    });
    expect(blueprintFromRegistry("compliance_audit_readiness").evidenceContract?.requiredEvidenceCategories).toEqual(["audit_scope", "audit_criteria", "current_authority", "controlled_document", "implementation_evidence"]);
    expect(blueprintFromRegistry("compliance_audit_readiness").evidenceContract?.freshnessRules).toMatchObject({
      policyExistenceDoesNotProveImplementation: true,
      evidenceMustBeRetrievableToBeVerified: true,
      absenceOfContraryEvidenceDoesNotProveCompliance: true,
      readinessIsRequirementSpecific: true,
    });
  });

  it("10. regulatory change and legislation reviews require authoritative regulatory source evidence", () => {
    expect(blueprintFromRegistry("legislation_regulatory_review").evidenceContract?.requiredEvidenceCategories).toEqual(["current_authority", "regulatory_source", "organisation_structure", "legislative_register"]);
    expect(blueprintFromRegistry("legislation_regulatory_review").evidenceContract?.freshnessRules).toMatchObject({
      primaryAuthorityPreferredWhereAvailable: true,
      oldRegisterCannotOverrideCurrentAuthority: true,
      registerAbsenceDoesNotProveObligationAbsence: true,
      sectorRelevanceDoesNotEqualApplicability: true,
    });
    expect(blueprintFromRegistry("regulatory_change_impact_assessment").evidenceContract?.requiredEvidenceCategories).toEqual(["current_regulatory_source", "organisational_context", "current_practice_evidence"]);
    expect(blueprintFromRegistry("regulatory_change_impact_assessment").evidenceContract?.freshnessRules).toMatchObject({
      announcedDoesNotEqualEffective: true,
      regulatoryEffectiveDateDoesNotEqualInternalDueDate: true,
      implementationVerifiedDoesNotEqualEffectivenessVerified: true,
    });
    expect(blueprintFromRegistry("regulatory_change_impact").evidenceContract).toBeNull();
    expect(blueprintFromRegistry("regulatory_change_impact").validationRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "legacy_regulatory_change_impact_routes_to_canonical_assessment",
      "no_independent_regulatory_change_impact_method",
    ]));
  });

  it("11. memory-only evidence remains restricted", () => {
    const contract = blueprintFromRegistry("compliance_audit_readiness").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "audit_criteria" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("12. missing required regulator correspondence blocks regulator-response completion", () => {
    const result = validate("regulator_response_submission", { evidencePack: evidencePack(["controlled_document"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("13. SCHADS analysis requires both award source and employment record evidence", () => {
    expect(blueprintFromRegistry("schads_award_analysis").evidenceContract?.requiredEvidenceCategories).toEqual(["current_award_source", "employment_record", "actual_work_record", "current_authority"]);
    const result = validate("schads_award_analysis", { evidencePack: evidencePack(["current_award_source", "employment_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("14. service-agreement review requires agreement, material terms, participant, authority and funding evidence", () => {
    expect(blueprintFromRegistry("service_agreement_review").evidenceContract?.requiredEvidenceCategories).toEqual(["service_agreement", "service_agreement_terms", "participant_record", "current_authority", "funding_record"]);
    expect(blueprintFromRegistry("service_agreement_review").evidenceContract?.freshnessRules).toMatchObject({
      termsNotConfiguredBlocksReadiness: true,
      signedDoesNotProveInformedConsent: true,
      currentAuthorityRequiredForPricingCancellationAndMaterialTerms: true,
    });
  });
});

describe("Sprint 34F authority boundaries", () => {
  it("15. policy document cannot become legal opinion, publication or domain professional conclusion", () => {
    const blueprint = blueprintFromRegistry("policy");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_opinion",
      "domain_professional_conclusion",
      "controlled_publication",
      "policy_approval",
      "implementation_execution",
    ]));
    expect(getRegistryEntry("policy")!.externalAuthorityRequiredFor).toContain("formal legal opinion");
  });

  it("16. regulator response prepares package readiness but not external submission", () => {
    const blueprint = blueprintFromRegistry("regulator_response_submission");
    expect(blueprint.requiredApprovals).toHaveProperty("external_submission_owner", true);
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "external_submission",
      "unsupported_admission",
      "unsupported_denial",
      "legal_admission",
      "binding_regulatory_position",
    ]));
  });

  it("17. SCHADS analysis cannot become payroll calculation or legal entitlement decision", () => {
    const blueprint = blueprintFromRegistry("schads_award_analysis");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_entitlement_determination",
      "payroll_calculation",
      "complete_payslip",
      "superannuation_reconciliation",
      "long_service_leave_liability",
      "backpay_approval",
    ]));
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "people_culture_manager",
      "workforce_compliance_specialist",
      "workforce_rostering_coordinator",
    ]));
  });

  it("18. employment compliance review cannot make HR/legal decisions", () => {
    const blueprint = blueprintFromRegistry("employment_compliance_review");
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_advice",
      "disciplinary_decision",
      "employment_decision",
    ]));
  });

  it("19. service-agreement review cannot alter terms or make legal commitments", () => {
    const blueprint = blueprintFromRegistry("service_agreement_review");
    expect(blueprint.requiredApprovals).toMatchObject({
      finance_owner: true,
      service_delivery_owner: true,
    });
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_advice",
      "unilateral_agreement_change",
      "service_commitment_approval",
      "agreement_signature",
      "participant_funding_change",
    ]));
  });
});

describe("Sprint 34F deliverable and completion gates", () => {
  it("20. policy, governance framework, delegation framework and service agreement review require controlled DOCX artifacts", () => {
    for (const code of ["policy", "governance_framework", "delegation_framework", "service_agreement_review"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.templateRequired).toBe(true);
      expect(blueprint.deliverableContract).toMatchObject({
        artifactRequired: true,
        primaryFormat: "docx",
        templateRequired: true,
      });
    }
  });

  it("21. missing policy artifact blocks completion", () => {
    const result = validate("policy", { artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("22. missing regulator-response template blocks controlled completion", () => {
    const result = validate("regulator_response_submission", {
      contract: contractFor("regulator_response_submission", null),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("23. structured regulatory and employment analyses are not forced to DOCX artifacts", () => {
    for (const code of ["regulatory_change_impact_assessment", "schads_award_analysis", "employment_compliance_review"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.deliverableContract?.artifactRequired).toBe(false);
      expect(blueprint.templateRequired).toBe(false);
    }
  });

  it("24. service-agreement package requires all domain approvals before completion", () => {
    const approvalStates = approvalsFor("service_agreement_review");
    approvalStates.finance_owner = false;
    const result = validate("service_agreement_review", { approvalStates });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });
});
