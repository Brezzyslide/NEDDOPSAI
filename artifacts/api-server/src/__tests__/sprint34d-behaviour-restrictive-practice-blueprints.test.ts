import { describe, expect, it } from "vitest";
import {
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import {
  validateBlueprintRuntimeCompletion,
  type BlueprintRuntimeValidationInput,
} from "../services/blueprintRuntimeValidationService.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
import type {
  BlueprintExecutionContract,
  BlueprintSection,
  WorkBlueprint,
  WorkTemplate,
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-17T00:00:00Z");

const BEHAVIOUR_CODES = [
  "behaviour_support_plan_review",
  "behaviour_trigger_analysis",
] as const;

const RESTRICTIVE_PRACTICE_CODES = [
  "restrictive_practice_risk_assessment",
  "restrictive_practice_comparison",
  "restrictive_practice_authorisation",
  "unauthorised_restrictive_practice_review",
] as const;

const ALL_34D_CODES = [
  ...BEHAVIOUR_CODES,
  ...RESTRICTIVE_PRACTICE_CODES,
] as const;

const STILL_METHOD_PENDING_34D_CODES = [
  "restrictive_practice_authorisation",
  "unauthorised_restrictive_practice_review",
] as const;

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
  id: "tpl-rp",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "restrictive_practice_template",
  title: "Restrictive Practice Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/restrictive-practice.docx",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with verified source evidence, visible USER_DEFINITION_REQUIRED status where needed, professional boundaries, escalation route, and unresolved evidence gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34d",
    organisationId: "org-34d",
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
      query: "behaviour restrictive practice evidence",
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
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34d" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

describe("Sprint 34D ownership and routing", () => {
  it("1. routes behaviour support work to Behaviour Support Implementation Specialist", () => {
    for (const code of BEHAVIOUR_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("behaviour_support_implementation_specialist");
    }
  });

  it("2. routes RP governance work to APO except unauthorised RP review", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("restrictive_practice_risk_assessment")!)).toBe("authorised_program_officer");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("restrictive_practice_comparison")!)).toBe("authorised_program_officer");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("restrictive_practice_authorisation")!)).toBe("authorised_program_officer");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("unauthorised_restrictive_practice_review")!)).toBe("incident_safeguarding_specialist");
  });

  it("3. Chief of Staff does not become professional owner by fallback", () => {
    for (const code of ALL_34D_CODES) {
      expect(blueprintFromRegistry(code).primarySpecialist).not.toBe("chief_of_staff");
    }
  });

  it("4. deterministic intents point at the authored 34D blueprints", () => {
    expect(resolveIntent("behaviour_support.review")).toMatchObject({ code: "behaviour_support_plan_review" });
    expect(resolveIntent("behaviour_support.analysis")).toMatchObject({ code: "behaviour_trigger_analysis" });
    expect(resolveIntent("restrictive_practice.risk_assessment")).toMatchObject({ code: "restrictive_practice_risk_assessment" });
    expect(resolveIntent("restrictive_practice.comparison")).toMatchObject({ code: "restrictive_practice_comparison" });
    expect(resolveIntent("restrictive_practice.authorisation")).toMatchObject({ code: "restrictive_practice_authorisation" });
    expect(resolveIntent("restrictive_practice.review")).toMatchObject({ code: "unauthorised_restrictive_practice_review" });
  });
});

describe("Sprint 34D human professional method gate", () => {
  it("5. still-unapproved 34D RP blueprints carry a visible USER_DEFINITION_REQUIRED method section", () => {
    for (const code of STILL_METHOD_PENDING_34D_CODES) {
      const methodSection = sectionsFromRegistry(code)[0];
      expect(methodSection.sectionCode).toBe("USER_DEFINITION_REQUIRED_METHOD");
      expect(methodSection.instructions).toContain("USER_DEFINITION_REQUIRED");
      expect(methodSection.minimumContentExpectation).toContain("USER_DEFINITION_REQUIRED");
    }
  });

  it("6. still-unapproved 34D RP blueprints require human professional method approval", () => {
    for (const code of STILL_METHOD_PENDING_34D_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).toHaveProperty("human_professional_method_owner", true);
    }
  });

  it("7. missing human professional method approval blocks completion", () => {
    const result = validate("restrictive_practice_authorisation", { approvalStates: approvalsFor("restrictive_practice_authorisation", false) });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });

  it("8. missing method section blocks completion", () => {
    const result = validate("restrictive_practice_authorisation", {
      contentMarkdown: "## AUTHORITY_CONSENT_STATUS\nThis section is populated but the method gate is absent.",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });
});

describe("Sprint 34D evidence and currentness controls", () => {
  it("9. BSP review requires approved BSP and implementation evidence", () => {
    expect(blueprintFromRegistry("behaviour_support_plan_review").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["behaviour_support_plan", "behaviour_implementation_evidence", "participant_context"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. RP authorisation requires RP records and usage records", () => {
    expect(blueprintFromRegistry("restrictive_practice_authorisation").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["restrictive_practice_record"],
      optionalEvidenceCategories: expect.arrayContaining(["rp_usage_record", "consent_or_authority_record"]),
      missingEvidenceBehaviour: "block_completion",
    });
  });

  it("11. memory-only evidence remains restricted", () => {
    const contract = blueprintFromRegistry("restrictive_practice_authorisation").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "restrictive_practice_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("12. missing required evidence blocks high-risk RP completion", () => {
    const result = validate("restrictive_practice_risk_assessment", { evidencePack: evidencePack(["case_note"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("13. evidence contracts require current source discipline", () => {
    for (const code of ALL_34D_CODES) {
      expect(blueprintFromRegistry(code).evidenceContract?.freshnessRules).toMatchObject({
        currentnessRequired: true,
        historicalPlansRemainHistorical: true,
      });
    }
  });
});

describe("Sprint 34D authority boundaries", () => {
  it("14. BSP review cannot author or amend formal Behaviour Support Plans", () => {
    const deliverable = blueprintFromRegistry("behaviour_support_plan_review").deliverableContract!;
    expect(deliverable.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "behaviour_support_plan",
      "restrictive_practice_authorisation",
    ]));
    expect(getRegistryEntry("behaviour_support_plan_review")?.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "formal Behaviour Support Plan authorship",
      "formal Behaviour Support Plan amendment",
    ]));
  });

  it("15. behaviour trigger analysis cannot become a functional behaviour assessment", () => {
    const deliverable = blueprintFromRegistry("behaviour_trigger_analysis").deliverableContract!;
    expect(deliverable.prohibitedDeliverables).toContain("functional_behaviour_assessment");
    expect(blueprintFromRegistry("behaviour_trigger_analysis").validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "approved_trigger_analysis_method_applied" }),
    ]));
  });

  it("16. RP risk assessment remains unable to authorise or make clinical/prescribing decisions", () => {
    const deliverable = blueprintFromRegistry("restrictive_practice_risk_assessment").deliverableContract!;
    expect(deliverable.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "clinical_assessment",
      "medication_prescribing_decision",
      "formal_authorisation",
    ]));
  });

  it("17. unauthorised RP review separates ISS and APO ownership", () => {
    const blueprint = blueprintFromRegistry("unauthorised_restrictive_practice_review");
    expect(blueprint.primarySpecialist).toBe("incident_safeguarding_specialist");
    expect(blueprint.supportingSpecialists).toContain("authorised_program_officer");
    expect(blueprint.validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "no_final_reportability_or_legal_determination" }),
    ]));
  });
});

describe("Sprint 34D deliverable and completion gates", () => {
  it("18. RP risk assessment requires DOCX artifact and template", () => {
    const blueprint = blueprintFromRegistry("restrictive_practice_risk_assessment");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
  });

  it("18a. RP risk assessment no longer carries the human method-definition blocker", () => {
    const blueprint = blueprintFromRegistry("restrictive_practice_risk_assessment");
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(sectionsFromRegistry("restrictive_practice_risk_assessment")[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
  });

  it("18b. RP comparison no longer carries the human method-definition blocker", () => {
    const blueprint = blueprintFromRegistry("restrictive_practice_comparison");
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(sectionsFromRegistry("restrictive_practice_comparison")[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
  });

  it("19. missing RP artifact blocks completion", () => {
    const result = validate("restrictive_practice_risk_assessment", { artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("20. missing RP template blocks controlled completion", () => {
    const result = validate("restrictive_practice_authorisation", {
      contract: contractFor("restrictive_practice_authorisation", null),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("21. structured behaviour analysis does not pretend to generate a controlled DOCX artifact", () => {
    const blueprint = blueprintFromRegistry("behaviour_trigger_analysis");
    expect(blueprint.deliverableContract?.artifactRequired).toBe(false);
    expect(blueprint.templateRequired).toBe(false);
  });
});
