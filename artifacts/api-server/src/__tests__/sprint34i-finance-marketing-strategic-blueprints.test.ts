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

const FINANCE_CODES = [
  "business_financial_analysis",
  "financial_planning_reporting_review",
  "tax_financial_obligation_review",
  "operational_finance_reconciliation_review",
] as const;

const MARKETING_CODES = [
  "ndis_marketing_strategy",
  "marketing_communications_review",
  "ndis_market_analysis",
] as const;

const STRATEGIC_CODES = [
  "business_growth_analysis",
  "business_proposal",
] as const;

const ALL_34I_CODES = [
  ...FINANCE_CODES,
  ...MARKETING_CODES,
  ...STRATEGIC_CODES,
] as const;

const STILL_METHOD_PENDING_34I_CODES = ALL_34I_CODES.filter((code) =>
  code !== "business_financial_analysis"
  && code !== "financial_planning_reporting_review"
  && code !== "tax_financial_obligation_review"
  && code !== "operational_finance_reconciliation_review"
  && code !== "ndis_marketing_strategy"
  && code !== "ndis_market_analysis"
  && code !== "marketing_communications_review"
  && code !== "business_growth_analysis"
  && code !== "business_proposal"
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
  id: "tpl-34i",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "business_template",
  title: "Business / Marketing Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/business-marketing.docx",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current financial, market or business evidence, visible USER_DEFINITION_REQUIRED method status, approvals and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34i",
    organisationId: "org-34i",
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
      query: "finance marketing strategic evidence",
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
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34i" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

describe("Sprint 34I ownership and routing", () => {
  it("1. routes finance and FP&R Blueprints to the current-v2 owners", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("business_financial_analysis")!)).toBe("financial_planning_reporting_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("financial_planning_reporting_review")!)).toBe("financial_planning_reporting_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("tax_financial_obligation_review")!)).toBe("finance_officer");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("operational_finance_reconciliation_review")!)).toBe("finance_officer");
  });

  it("2. routes marketing and market analysis to Marketing Communications Manager", () => {
    for (const code of MARKETING_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("marketing_communications_manager");
    }
  });

  it("3. routes strategic proposal/growth work to explicit Chief of Staff ownership, not fallback", () => {
    for (const code of STRATEGIC_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("chief_of_staff");
      expect(blueprintFromRegistry(code).primarySpecialist).toBe("chief_of_staff");
    }
  });

  it("4. deterministic intents point at authored 34I Blueprints while preserving business_financial_analysis visibility", () => {
    expect(resolveIntent("financial.analysis")).toMatchObject({ code: "financial_planning_reporting_review" });
    expect(getRegistryEntry("business_financial_analysis")).toBeDefined();
    expect(resolveIntent("finance.reconciliation")).toMatchObject({ code: "operational_finance_reconciliation_review" });
    expect(resolveIntent("marketing.campaign")).toMatchObject({ code: "marketing_communications_review" });
    expect(resolveIntent("strategic.market_analysis")).toMatchObject({ code: "ndis_market_analysis" });
    expect(resolveIntent("business_proposal.create")).toMatchObject({ code: "business_proposal" });
  });
});

describe("Sprint 34I human professional method gate", () => {
  it("5. still-pending 34I Blueprints carry visible USER_DEFINITION_REQUIRED method status", () => {
    for (const code of STILL_METHOD_PENDING_34I_CODES) {
      const methodSection = sectionsFromRegistry(code)[0];
      expect(methodSection.sectionCode).toBe("USER_DEFINITION_REQUIRED_METHOD");
      expect(methodSection.instructions).toContain("USER_DEFINITION_REQUIRED");
      expect(methodSection.minimumContentExpectation).toContain("USER_DEFINITION_REQUIRED");
    }
  });

  it("6. still-pending 34I Blueprints require human professional method approval", () => {
    for (const code of STILL_METHOD_PENDING_34I_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).toHaveProperty("human_professional_method_owner", true);
    }
    expect(blueprintFromRegistry("business_financial_analysis").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("financial_planning_reporting_review").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("tax_financial_obligation_review").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("operational_finance_reconciliation_review").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("ndis_marketing_strategy").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("ndis_market_analysis").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("marketing_communications_review").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("business_growth_analysis").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprintFromRegistry("business_proposal").requiredApprovals).not.toHaveProperty("human_professional_method_owner");
  });

  it("7. missing executive proposal approval blocks completion", () => {
    const result = validate("business_proposal", { approvalStates: approvalsFor("business_proposal", false) });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });

  it("8. missing growth objective section blocks completion for approved growth analysis", () => {
    const result = validate("business_growth_analysis", {
      contentMarkdown: "## OPTION_DEFINITION_AND_BASELINE\nOptions are populated, but the growth objective is absent.",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });
});

describe("Sprint 34I evidence and currentness controls", () => {
  it("9. financial work requires current financial source evidence and explicit assumptions", () => {
    for (const code of FINANCE_CODES) {
      expect(blueprintFromRegistry(code).evidenceContract?.freshnessRules).toMatchObject({
        currentnessRequired: true,
        memoryCannotProveCurrentness: true,
        assumptionsMustBeExplicit: true,
      });
    }
  });

  it("10. memory-only evidence remains restricted", () => {
    const contract = blueprintFromRegistry("financial_planning_reporting_review").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "financial_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. missing required tax evidence blocks tax review", () => {
    const result = validate("tax_financial_obligation_review", { evidencePack: evidencePack(["financial_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("12. marketing claims require approved claim sources", () => {
    expect(blueprintFromRegistry("marketing_communications_review").evidenceContract?.freshnessRules).toMatchObject({
      claimsRequireApprovedSource: true,
      existingPublicContentIsEvidenceNotAuthority: true,
      materialClaimsRequireEvidence: true,
      participantRightsAccessibilityPrivacyAndConsentRequired: true,
      publicationRequiresSeparateApproval: true,
    });
    expect(blueprintFromRegistry("ndis_marketing_strategy").evidenceContract?.freshnessRules).toMatchObject({
      claimsRequireApprovedSource: true,
      serviceCapabilityMustPrecedeMarketingClaim: true,
      operationalCapacityMustConstrainCampaignScale: true,
      participantDignityPrivacyAndConsentRequiredForCaseContent: true,
    });
    expect(blueprintFromRegistry("ndis_market_analysis").evidenceContract?.freshnessRules).toMatchObject({
      currentMarketClaimRequiresCurrentEvidence: true,
      internalSignalsAreNotMarketSize: true,
      registeredProviderIsNotActiveAvailableSupply: true,
      competitorPublicClaimsAreNotVerifiedFact: true,
    });
    const result = validate("ndis_marketing_strategy", { evidencePack: evidencePack(["market_source"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });
});

describe("Sprint 34I authority boundaries", () => {
  it("13. financial analyses cannot approve investment, tax/legal advice or audit certification", () => {
    expect(blueprintFromRegistry("business_financial_analysis").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "investment_approval",
      "audit_certification",
      "tax_advice",
      "legal_advice",
    ]));
    expect(blueprintFromRegistry("financial_planning_reporting_review").deliverableContract?.prohibitedDeliverables).toContain("budget_approval");
  });

  it("14. tax and operational finance cannot lodge, approve payments or mutate systems", () => {
    expect(blueprintFromRegistry("tax_financial_obligation_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "tax_agent_advice",
      "lodgement",
      "audit_certification",
    ]));
    expect(blueprintFromRegistry("operational_finance_reconciliation_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "payment_approval",
      "ndis_claim_submission",
      "financial_system_mutation",
      "payroll_determination",
    ]));
  });

  it("15. marketing work cannot publish externally or approve regulated claims/ad spend", () => {
    expect(blueprintFromRegistry("ndis_marketing_strategy").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "public_publication",
      "regulated_claim_approval",
      "ad_spend_approval",
      "campaign_launch",
      "referral_partner_contact",
      "participant_story_publication",
    ]));
    expect(blueprintFromRegistry("marketing_communications_review").requiredApprovals).toHaveProperty("external_publication_owner", true);
    expect(blueprintFromRegistry("marketing_communications_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "public_publication",
      "website_change",
      "social_media_post",
      "stakeholder_communication_send",
      "campaign_launch",
      "ad_spend_approval",
    ]));
  });

  it("16. market analysis and growth analysis cannot guarantee demand or approve expansion", () => {
    expect(blueprintFromRegistry("ndis_market_analysis").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "guaranteed_revenue_claim",
      "service_launch_approval",
      "service_expansion_approval",
      "campaign_launch",
      "public_market_claim",
    ]));
    expect(blueprintFromRegistry("business_growth_analysis").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "investment_approval",
      "service_launch_approval",
      "contract_commitment",
      "business_case_document",
      "registration_submission",
    ]));
  });

  it("17. business proposal cannot approve spend, contracts, launch or legal advice", () => {
    expect(blueprintFromRegistry("business_proposal").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "investment_approval",
      "budget_approval",
      "expenditure_approval",
      "contract_commitment",
      "service_launch_approval",
      "hiring_decision",
      "property_acquisition",
      "registration_submission",
      "payment_execution",
      "legal_advice",
    ]));
  });
});

describe("Sprint 34I deliverable and completion gates", () => {
  it("18. marketing strategy, communications and business proposal require controlled DOCX artifacts", () => {
    for (const code of ["ndis_marketing_strategy", "marketing_communications_review", "business_proposal"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.templateRequired).toBe(true);
      expect(blueprint.deliverableContract).toMatchObject({
        artifactRequired: true,
        primaryFormat: "docx",
        templateRequired: true,
      });
    }
  });

  it("19. missing business proposal artifact blocks completion", () => {
    const result = validate("business_proposal", { artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("20. missing marketing template blocks controlled completion", () => {
    const result = validate("ndis_marketing_strategy", {
      contract: contractFor("ndis_marketing_strategy", null),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("21. FP&R, NDIS market analysis and growth viability remain structured analysis where no artifact is required", () => {
    for (const code of ["financial_planning_reporting_review", "ndis_market_analysis", "business_growth_analysis"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.deliverableContract?.artifactRequired).toBe(false);
      expect(blueprint.templateRequired).toBe(false);
    }
  });

  it("21b. operational finance reconciliation is template-bound after professionalisation", () => {
    const blueprint = blueprintFromRegistry("operational_finance_reconciliation_review");
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
    expect(blueprint.templateRequired).toBe(true);
  });

  it("22. external publication approval must be present before marketing strategy completion", () => {
    const approvalStates = approvalsFor("ndis_marketing_strategy");
    approvalStates.external_publication_owner = false;
    const result = validate("ndis_marketing_strategy", { approvalStates });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });
});
