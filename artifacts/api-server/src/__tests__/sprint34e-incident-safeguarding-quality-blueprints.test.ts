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

const INCIDENT_CODES = [
  "incident_investigation",
  "incident_review_improvement",
  "reportable_incident_assessment",
  "safeguarding_assessment",
] as const;

const QUALITY_CODES = [
  "corrective_action_improvement",
  "clinical_governance_review",
] as const;

const ALL_34E_CODES = [
  ...INCIDENT_CODES,
  ...QUALITY_CODES,
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
  id: "tpl-incident",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "incident_report_template",
  title: "Incident / Quality Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/incident-report.docx",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with verified source evidence, visible USER_DEFINITION_REQUIRED method status, professional boundaries, escalation route, and unresolved evidence gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34e",
    organisationId: "org-34e",
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
      query: "incident safeguarding quality evidence",
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
    artifactId: contract.blueprint.deliverableContract?.artifactRequired ? "artifact-34e" : null,
    approvalStates: approvalsFor(code),
    ...overrides,
  });
}

describe("Sprint 34E ownership and routing", () => {
  it("1. routes incident and safeguarding Blueprints to Incident Safeguarding Specialist", () => {
    for (const code of INCIDENT_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("incident_safeguarding_specialist");
    }
  });

  it("2. routes quality and clinical-governance Blueprints to Compliance Quality Manager", () => {
    for (const code of QUALITY_CODES) {
      expect(resolveRegistryProfessionalOwner(getRegistryEntry(code)!)).toBe("compliance_quality_manager");
    }
  });

  it("3. Chief of Staff does not become professional owner by fallback", () => {
    for (const code of ALL_34E_CODES) {
      expect(blueprintFromRegistry(code).primarySpecialist).not.toBe("chief_of_staff");
    }
  });

  it("4. deterministic intents point at the authored 34E Blueprints", () => {
    expect(resolveIntent("incident.investigation")).toMatchObject({ code: "incident_investigation" });
    expect(resolveIntent("incident.review")).toMatchObject({ code: "incident_review_improvement" });
    expect(resolveIntent("incident.reportable")).toMatchObject({ code: "reportable_incident_assessment" });
    expect(resolveIntent("safeguarding.assessment")).toMatchObject({ code: "safeguarding_assessment" });
    expect(resolveIntent("quality.corrective_action")).toMatchObject({ code: "corrective_action_improvement" });
    expect(resolveIntent("governance.clinical")).toMatchObject({ code: "clinical_governance_review" });
  });
});

describe("Sprint 34E human professional method gate", () => {
  it("5. every 34E Blueprint carries visible USER_DEFINITION_REQUIRED method status", () => {
    for (const code of ALL_34E_CODES) {
      const methodSection = sectionsFromRegistry(code)[0];
      expect(methodSection.sectionCode).toBe("USER_DEFINITION_REQUIRED_METHOD");
      expect(methodSection.instructions).toContain("USER_DEFINITION_REQUIRED");
      expect(methodSection.minimumContentExpectation).toContain("USER_DEFINITION_REQUIRED");
    }
  });

  it("6. every 34E Blueprint requires human professional method approval", () => {
    for (const code of ALL_34E_CODES) {
      expect(blueprintFromRegistry(code).requiredApprovals).toHaveProperty("human_professional_method_owner", true);
    }
  });

  it("7. missing human method approval blocks completion", () => {
    const result = validate("incident_investigation", { approvalStates: approvalsFor("incident_investigation", false) });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([expect.objectContaining({ gate: "approval_required" })]));
  });

  it("8. missing method section blocks completion", () => {
    const result = validate("reportable_incident_assessment", {
      contentMarkdown: "## INCIDENT_FACTS_AND_SOURCE_STATUS\nFacts are populated, but the method gate is absent.",
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(true);
  });
});

describe("Sprint 34E evidence and currentness controls", () => {
  it("9. incident investigation requires incident record and incident policy evidence", () => {
    expect(blueprintFromRegistry("incident_investigation").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["incident_record", "incident_policy"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. reportable incident assessment requires supplied threshold criteria", () => {
    expect(blueprintFromRegistry("reportable_incident_assessment").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["incident_record", "reportability_criteria"],
      missingEvidenceBehaviour: "block_completion",
    });
  });

  it("11. corrective action requires CAPA source evidence", () => {
    expect(blueprintFromRegistry("corrective_action_improvement").evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["capa_record"],
      claimIntegrityRequired: true,
    });
  });

  it("12. memory-only evidence remains restricted", () => {
    const contract = blueprintFromRegistry("safeguarding_assessment").evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "safeguarding_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("13. missing required evidence blocks high-risk reportability work", () => {
    const result = validate("reportable_incident_assessment", { evidencePack: evidencePack(["incident_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("14. evidence contracts require current source discipline", () => {
    for (const code of ALL_34E_CODES) {
      expect(blueprintFromRegistry(code).evidenceContract?.freshnessRules).toMatchObject({
        currentnessRequired: true,
        historicalRecordsRemainHistorical: true,
      });
    }
  });
});

describe("Sprint 34E authority boundaries", () => {
  it("15. incident investigation cannot become legal, HR, clinical or reportability determination", () => {
    const deliverable = blueprintFromRegistry("incident_investigation").deliverableContract!;
    expect(deliverable.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_finding",
      "disciplinary_finding",
      "clinical_determination",
      "final_reportability_determination",
    ]));
  });

  it("16. reportable incident assessment prepares package readiness but not external submission", () => {
    const blueprint = blueprintFromRegistry("reportable_incident_assessment");
    expect(blueprint.requiredApprovals).toHaveProperty("external_submission_owner", true);
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "final_reportability_determination",
      "external_regulatory_submission",
    ]));
  });

  it("17. safeguarding assessment cannot close concern or make final findings", () => {
    const blueprint = blueprintFromRegistry("safeguarding_assessment");
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_determination",
      "clinical_determination",
      "formal_investigation_finding",
    ]));
    expect(blueprint.validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "protective_actions_not_final_findings" }),
    ]));
  });

  it("18. clinical governance review preserves clinical/external certification boundaries", () => {
    const entry = getRegistryEntry("clinical_governance_review")!;
    expect(entry.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "clinical determination",
      "credentialing decision",
      "external clinical governance certification",
    ]));
    expect(blueprintFromRegistry("clinical_governance_review").deliverableContract?.prohibitedDeliverables).toContain("external_certification");
  });
});

describe("Sprint 34E deliverable and completion gates", () => {
  it("19. incident investigation requires controlled DOCX artifact and template", () => {
    const blueprint = blueprintFromRegistry("incident_investigation");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
  });

  it("20. missing incident artifact blocks completion", () => {
    const result = validate("incident_investigation", { artifactId: null });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });

  it("21. missing reportable incident template blocks controlled completion", () => {
    const result = validate("reportable_incident_assessment", {
      contract: contractFor("reportable_incident_assessment", null),
    });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("22. incident review remains structured analysis rather than forced DOCX artifact", () => {
    const blueprint = blueprintFromRegistry("incident_review_improvement");
    expect(blueprint.deliverableContract?.artifactRequired).toBe(false);
    expect(blueprint.templateRequired).toBe(false);
  });

  it("23. corrective action cannot be marked complete without quality approval", () => {
    const approvalStates = approvalsFor("corrective_action_improvement");
    approvalStates.compliance_quality_owner = false;
    const result = validate("corrective_action_improvement", { approvalStates });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("24. clinical governance review is a governance analysis, not clinical certification", () => {
    const blueprint = blueprintFromRegistry("clinical_governance_review");
    expect(blueprint.deliverableContract?.artifactRequired).toBe(false);
    expect(blueprint.validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "governance_review_not_clinical_certification" }),
    ]));
  });
});
