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

const ROSTER_CODES = [
  "rostering_fatigue_review",
  "roster_planning",
] as const;

const PEOPLE_CODES = [
  "workforce_performance_review",
  "people_management_review",
] as const;

const ALL_34G_CODES = [
  ...ROSTER_CODES,
  ...PEOPLE_CODES,
  "learning_capability_development_plan",
  "workforce_compliance_assessment",
  "payroll_workforce_cost_review",
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
  id: "tpl-34g",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "workforce_template",
  title: "Workforce / People Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/workforce-report.docx",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with current workforce evidence, visible USER_DEFINITION_REQUIRED method status, specialist boundaries, approvals and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34g",
    organisationId: "org-34g",
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
      query: "workforce payroll people learning evidence",
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
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34g" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

describe("Sprint 34G ownership and routing", () => {
  it("1. routes rostering Blueprints to Workforce Rostering Coordinator", () => {
    for (const code of ROSTER_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("workforce_rostering_coordinator");
    }
  });

  it("2. routes people, learning, workforce compliance and payroll Blueprints to current-v2 owners", () => {
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("workforce_performance_review")!)).toBe("people_culture_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("people_management_review")!)).toBe("people_culture_manager");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("learning_capability_development_plan")!)).toBe("talent_learning_specialist");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("workforce_compliance_assessment")!)).toBe("workforce_compliance_specialist");
    expect(resolveRegistryProfessionalOwner(getRegistryEntry("payroll_workforce_cost_review")!)).toBe("payroll_workforce_cost_officer");
  });

  it("3. Chief of Staff does not become professional owner by fallback", () => {
    for (const code of ALL_34G_CODES) {
      expect(blueprintFromRegistry(code).primarySpecialist).not.toBe("chief_of_staff");
    }
  });

  it("4. deterministic intents point at authored 34G Blueprints", () => {
    expect(resolveIntent("roster.plan")).toMatchObject({ code: "roster_planning" });
    expect(resolveIntent("roster.fatigue_review")).toMatchObject({ code: "rostering_fatigue_review" });
    expect(resolveIntent("people.performance_management")).toMatchObject({ code: "people_management_review" });
    expect(resolveIntent("learning.training_plan")).toMatchObject({ code: "learning_capability_development_plan" });
    expect(resolveIntent("workforce_compliance.eligibility_review")).toMatchObject({ code: "workforce_compliance_assessment" });
    expect(resolveIntent("payroll.reconciliation")).toMatchObject({ code: "payroll_workforce_cost_review" });
  });
});

describe("Sprint 34G human professional method gate", () => {
  it("5. every 34G Blueprint carries visible USER_DEFINITION_REQUIRED method status", () => {
    for (const code of ALL_34G_CODES) {
      const methodSection = sectionsFromRegistry(code)[0];
      expect(methodSection.sectionCode).toBe("USER_DEFINITION_REQUIRED_METHOD");
      expect(methodSection.instructions).toContain("USER_DEFINITION_REQUIRED");
      expect(methodSection.minimumContentExpectation).toContain("USER_DEFINITION_REQUIRED");
    }
  });

  it("6. every 34G Blueprint requires human professional method approval", () => {
    for (const code of ALL_34G_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).toHaveProperty("human_professional_method_owner", true);
    }
  });

  it("7. missing human method approval blocks completion", () => {
    const result = validate("roster_planning", { approvalStates: approvalsFor("roster_planning", false) });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });

  it("8. missing method section blocks completion", () => {
    const result = validate("people_management_review", {
      contentMarkdown: "## PEOPLE_MATTER_SCOPE\nMatter scope is populated, but the method gate is absent.",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });
});

describe("Sprint 34G evidence and currentness controls", () => {
  it("9. roster planning requires service requirement and current availability evidence", () => {
    expect(blueprintFromRegistry("roster_planning").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["service_requirement", "worker_availability"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. memory-only evidence remains restricted", () => {
    const contract = blueprintFromRegistry("workforce_compliance_assessment").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "credential_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. expired or historical workforce evidence cannot silently prove currentness", () => {
    for (const code of ALL_34G_CODES) {
      expect(blueprintFromRegistry(code).evidenceContract?.freshnessRules).toMatchObject({
        currentnessRequired: true,
        memoryCannotProveCurrentness: true,
        conflictingVersionsRequireResolution: true,
      });
    }
    expect(blueprintFromRegistry("workforce_compliance_assessment").evidenceContract?.freshnessRules).toMatchObject({
      expiredCredentialsRemainExpired: true,
    });
  });

  it("12. missing required credential evidence blocks workforce compliance assessment", () => {
    const result = validate("workforce_compliance_assessment", { evidencePack: evidencePack(["training_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("13. payroll review requires payroll and timesheet evidence", () => {
    expect(blueprintFromRegistry("payroll_workforce_cost_review").evidenceContract?.requiredEvidenceCategories).toEqual(["payroll_record", "timesheet"]);
  });
});

describe("Sprint 34G authority boundaries", () => {
  it("14. roster planning cannot become roster publication or credential certification", () => {
    const blueprint = blueprintFromRegistry("roster_planning");
    expect(blueprint.requiredApprovals).toHaveProperty("roster_publication_owner", true);
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "published_roster",
      "shift_allocation_approval",
      "credential_certification",
    ]));
  });

  it("15. fatigue review cannot make SCHADS, payroll or disciplinary decisions", () => {
    expect(blueprintFromRegistry("rostering_fatigue_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "final_schads_determination",
      "payroll_entitlement_calculation",
      "disciplinary_decision",
    ]));
  });

  it("16. people and performance reviews cannot make final HR/legal decisions", () => {
    expect(blueprintFromRegistry("workforce_performance_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "disciplinary_decision",
      "termination_decision",
      "legal_advice",
    ]));
    expect(blueprintFromRegistry("people_management_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "termination_decision",
      "suspension_decision",
      "disciplinary_decision",
    ]));
  });

  it("17. learning plan cannot certify competence or deployment eligibility", () => {
    expect(blueprintFromRegistry("learning_capability_development_plan").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "competency_certification",
      "deployment_eligibility_certification",
      "disciplinary_decision",
    ]));
  });

  it("18. payroll review cannot execute payroll, transfer funds or provide legal/tax certification", () => {
    expect(blueprintFromRegistry("payroll_workforce_cost_review").deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "payrun_approval",
      "fund_transfer",
      "tax_agent_certification",
      "legal_entitlement_determination",
    ]));
  });
});

describe("Sprint 34G deliverable and completion gates", () => {
  it("19. roster plan and people-facing packages require controlled DOCX artifacts", () => {
    for (const code of ["roster_planning", "workforce_performance_review", "people_management_review", "learning_capability_development_plan"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.templateRequired).toBe(true);
      expect(blueprint.deliverableContract).toMatchObject({
        artifactRequired: true,
        primaryFormat: "docx",
        templateRequired: true,
      });
    }
  });

  it("20. missing roster artifact blocks completion", () => {
    const result = validate("roster_planning", { artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("21. missing people-management template blocks controlled completion", () => {
    const result = validate("people_management_review", {
      contract: contractFor("people_management_review", null),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("22. workforce compliance and payroll reviews remain structured analysis rather than forced DOCX artifacts", () => {
    for (const code of ["workforce_compliance_assessment", "payroll_workforce_cost_review"] as const) {
      const blueprint = blueprintFromRegistry(code);
      expect(blueprint.deliverableContract?.artifactRequired).toBe(false);
      expect(blueprint.templateRequired).toBe(false);
    }
  });

  it("23. roster publication approval must be present before roster plan completion", () => {
    const approvalStates = approvalsFor("roster_planning");
    approvalStates.roster_publication_owner = false;
    const result = validate("roster_planning", { approvalStates });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });
});
