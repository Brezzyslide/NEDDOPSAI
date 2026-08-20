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
  WorkTemplate,
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-18T00:00:00Z");
const FUNDING_CODE = "funding_utilisation_review";

function blueprintFromRegistry(code = FUNDING_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = FUNDING_CODE): BlueprintSection[] {
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
  id: "tpl-34l1",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "funding_utilisation_template",
  title: "Funding Utilisation Review Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/funding-utilisation-review.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mergeFieldSchema: {},
  createdAt: NOW,
  updatedAt: NOW,
};

function contractFor(templateOverride: WorkTemplate | null = template): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template: templateOverride,
    mode: "review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with plan funding, ratios, pricing, utilisation, variance, Irregular SIL, transport, recommendations, assumptions, approvals and source evidence.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l1",
    organisationId: "org-34l1",
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
      text: `${category} evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "funding utilisation review",
      selectedSourceIds: categories,
      selectedChunkIds: categories,
      selectedMemoryIds: [],
      selectedTaskUploadIds: [],
      retrievalMethod: "deterministic",
      ranking: [],
      tokenEstimate: 80,
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
    artifactId: "artifact-34l1",
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

function sectionByCode(code: string): BlueprintSection {
  const section = sectionsFromRegistry().find((candidate) => candidate.sectionCode === code);
  if (!section) throw new Error(`Missing section: ${code}`);
  return section;
}

function methodPendingCodes(): string[] {
  return BLUEPRINT_REGISTRY
    .filter((entry) =>
      entry.requiredApprovals?.human_professional_method_owner === true
      || entry.sections?.[0]?.sectionCode === "USER_DEFINITION_REQUIRED_METHOD",
    )
    .map((entry) => entry.code);
}

describe("Sprint 34L.1 ownership and USER_DEFINITION_REQUIRED removal", () => {
  it("1. resolves to the canonical Service Delivery Coordinator owner, not Chief of Staff", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(FUNDING_CODE)!)).toBe("service_delivery_coordinator");
    expect(blueprintFromRegistry().primarySpecialist).toBe("service_delivery_coordinator");
    expect(blueprintFromRegistry().primarySpecialist).not.toBe("chief_of_staff");
  });

  it("2. remains deterministically routed by funding.review", () => {
    expect(resolveIntent("funding.review")).toMatchObject({ code: FUNDING_CODE });
  });

  it("3. keeps funding_utilisation_review out of USER_DEFINITION_REQUIRED status", () => {
    const funding = blueprintFromRegistry();
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(funding.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(FUNDING_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("4. leaves still-unapproved method-gated Blueprints unchanged", () => {
    expect(methodPendingCodes()).not.toContain("unauthorised_restrictive_practice_review");
    expect(methodPendingCodes()).not.toContain("incident_investigation");
    expect(methodPendingCodes()).not.toContain("incident_review_improvement");
    expect(methodPendingCodes()).not.toContain("reportable_incident_assessment");
    expect(methodPendingCodes()).not.toContain("safeguarding_assessment");
    expect(methodPendingCodes()).not.toContain("rostering_fatigue_review");
    expect(methodPendingCodes()).not.toContain("policy");
    expect(methodPendingCodes()).not.toContain("governance_framework");
    expect(methodPendingCodes()).not.toContain("regulatory_change_impact_assessment");
    expect(methodPendingCodes()).not.toContain("governance_gap_analysis");
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });
});

describe("Sprint 34L.1 approved funding utilisation method", () => {
  it("5. includes plan dates, funding periods and plan lapse/exhaustion distinctions", () => {
    expect(sectionByCode("PLAN_AND_FUNDING_PERIOD").description).toContain("Plan start/end");
    expect(sectionByCode("PLAN_REVIEW_LAPSE_POSITION").instructions).toContain("plan end, funding-period end, exhaustion, unused balance");
  });

  it("6. represents support ratios, time bands and step-up or step-down changes", () => {
    const section = sectionByCode("SUPPORT_RATIOS_TIME_BANDS");
    expect(section.description).toContain("1:1");
    expect(section.description).toContain("active overnight");
    expect(section.instructions).toContain("step-up or step-down");
  });

  it("7. represents weekly, monthly and remaining-period modelling", () => {
    expect(sectionByCode("WEEKLY_FUNDING_POSITION").description).toContain("Available weekly funding");
    expect(sectionByCode("MONTHLY_FUNDING_POSITION").description).toContain("Available monthly funding");
    expect(sectionByCode("FINANCIAL_PROJECTION").description).toContain("remaining-period cost");
  });

  it("8. requires current NDIS pricing provenance instead of hard-coded rates", () => {
    const section = sectionByCode("CURRENT_NDIS_PRICING_LINE_ITEMS");
    expect(section.description).toContain("Support item/line item code");
    expect(section.description).toContain("effective period");
    expect(section.instructions).toContain("existing Authority Registry/retrieval architecture");
    expect(section.instructions).toContain("never hard-code rates");
  });

  it("9. preserves historical pricing effective-date handling", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      historicalPricingRequiresEffectivePeriodMatch: true,
    });
    expect(sectionByCode("EVIDENCE_AND_SOURCES").instructions).toContain("historical pricing/effective-period distinctions");
  });

  it("10. keeps Roster of Care important but not conclusive", () => {
    const section = sectionByCode("ROC_APPROVED_SUPPORT_EVIDENCE");
    expect(section.description).toContain("Roster of Care");
    expect(section.instructions).toContain("not automatic proof every proposed amount was approved");
  });

  it("11. preserves funded vs rostered vs delivered vs invoiced distinctions", () => {
    const section = sectionByCode("VARIANCE_ANALYSIS");
    expect(section.description).toContain("funded/approved model");
    expect(section.description).toContain("planned roster");
    expect(section.description).toContain("actual delivered support");
    expect(section.instructions).toContain("approved, planned, delivered and invoiced support");
  });

  it("12. requires variance diagnosis rather than overspent or underspent labels", () => {
    expect(sectionByCode("OVER_UNDER_UTILISATION_DRIVERS").instructions).toContain("Identify drivers only where supported by evidence");
  });

  it("13. prevents underspend from becoming spend-the-money behaviour", () => {
    expect(sectionByCode("RECOMMENDATIONS").instructions).toContain("never recommend unnecessary services to consume funding");
  });

  it("14. treats Irregular SIL as rule-bound, not a generic contingency pool", () => {
    expect(sectionByCode("IRREGULAR_SIL_REVIEW").instructions).toContain("not treat Irregular SIL as a generic spare funding pool");
  });

  it("15. requires clarification for BSP training and reflective-practice funding uncertainty", () => {
    const section = sectionByCode("BSP_TRAINING_REFLECTIVE_PRACTICE");
    expect(section.description).toContain("reflective practice");
    expect(section.instructions).toContain("seek Support Coordinator/planner or relevant authority clarification");
  });

  it("16. models transport and kilometres without one universal rate", () => {
    const section = sectionByCode("TRANSPORT_TRAVEL_KILOMETRES");
    expect(section.description).toContain("kilometres");
    expect(section.instructions).toContain("Do not use one universal kilometre rate");
  });

  it("17. makes the recommended support model non-binding", () => {
    const section = sectionByCode("RECOMMENDED_SUPPORT_MODEL");
    expect(section.instructions).toContain("professional recommendation only");
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "claiming_decision",
      "ndia_approval",
      "plan_variation",
      "support_reduction_authorisation",
    ]));
  });

  it("18. requires missing evidence to be surfaced rather than fabricated", () => {
    expect(sectionByCode("RISKS_GAPS_MISSING_EVIDENCE").instructions).toContain("do not fabricate missing evidence");
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      memoryCannotProveCurrentness: true,
      missingAuthorityMustBeMarkedUnknown: true,
    });
  });
});

describe("Sprint 34L.1 evidence, artifact and approval gates", () => {
  it("19. requires funding, service agreement, pricing and actual-delivery evidence", () => {
    expect(blueprintFromRegistry().evidenceContract?.requiredEvidenceCategories).toEqual([
      "funding_record",
      "service_agreement",
      "current_pricing_source",
      "actual_service_delivery",
    ]);
    const result = validate({ evidencePack: evidencePack(["funding_record", "service_agreement", "actual_service_delivery"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("20. rejects memory-only evidence for current funding, pricing and support state", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "funding_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("21. requires a DOCX/PDF artifact through the existing artifact architecture", () => {
    expect(blueprintFromRegistry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
      secondaryFormats: ["pdf"],
    });
    const result = validate({ artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("22. requires the controlled template when artifact output is expected", () => {
    const result = validate({ contract: contractFor(null) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("23. keeps service delivery and finance approvals while removing method approval", () => {
    expect(blueprintFromRegistry().requiredApprovals).toEqual({
      service_delivery_owner: true,
      finance_owner: true,
    });
    const result = validate({ approvalStates: { service_delivery_owner: true, finance_owner: false } });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("24. passes runtime validation when required sections, evidence, artifact and approvals are present", () => {
    expect(validate().passed).toBe(true);
  });
});
