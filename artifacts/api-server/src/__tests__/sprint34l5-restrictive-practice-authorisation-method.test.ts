import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
import { evaluateWorkerProfileAuthority } from "../services/executionActionService.js";
import { getWorkerProfileByCode } from "../lib/workerProfileRegistry.js";
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
const RP_AUTHORISATION_CODE = "restrictive_practice_authorisation";

function blueprintFromRegistry(code = RP_AUTHORISATION_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = RP_AUTHORISATION_CODE): BlueprintSection[] {
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
  id: "tpl-rp-authorisation",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "restrictive_practice_authorisation_template",
  title: "Restrictive Practice Authorisation Pack Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/restrictive-practice-authorisation.docx",
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
    mode: "authorisation",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with RP identity, BSP status, professional assessment evidence, authorisation evidence, currentness, expiry, provider coverage, conditions, competency, reporting, implementation reconciliation, reduction and elimination, gaps, conflicts, actions and provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l5",
    organisationId: "org-34l5",
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
      query: "restrictive practice authorisation evidence",
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
    ...(contract.blueprint.evidenceContract?.optionalEvidenceCategories ?? []),
    ...contract.sections.flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ]));
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(),
    rawClaims: [],
    evidencePack: evidencePack(evidenceCategories),
    artifactId: "artifact-34l5",
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

function methodPendingCodes(): string[] {
  return BLUEPRINT_REGISTRY
    .filter((entry) =>
      entry.requiredApprovals?.human_professional_method_owner === true
      || entry.sections?.[0]?.sectionCode === "USER_DEFINITION_REQUIRED_METHOD",
    )
    .map((entry) => entry.code);
}

function sectionByCode(code: string): BlueprintSection {
  const section = sectionsFromRegistry().find((candidate) => candidate.sectionCode === code);
  if (!section) throw new Error(`Missing section: ${code}`);
  return section;
}

function profile(code: string) {
  const workerProfile = getWorkerProfileByCode(code);
  if (!workerProfile) throw new Error(`Missing profile fixture: ${code}`);
  return workerProfile;
}

describe("Sprint 34L.5 RP authorisation method gate and ownership", () => {
  it("1. removes the Product Owner method blocker from RP authorisation only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(RP_AUTHORISATION_CODE);
    expect(methodPendingCodes()).toHaveLength(46);
  });

  it("2. leaves unauthorised RP review method-gated", () => {
    expect(methodPendingCodes()).toContain("unauthorised_restrictive_practice_review");
  });

  it("3. preserves APO ownership and KDS artifact-only boundary", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(RP_AUTHORISATION_CODE)!)).toBe("authorised_program_officer");
    expect(blueprint.primarySpecialist).toBe("authorised_program_officer");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "behaviour_support_implementation_specialist",
      "compliance_quality_manager",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.5 approved authorisation method representation", () => {
  it("4. includes the mandatory authorisation-state sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "AUTHORISATION_QUESTION_AND_SCOPE",
      "PRACTICE_IDENTITY_AND_BSP_VERIFICATION",
      "EVIDENCE_AUTHORITY_AND_ASSESSMENT",
      "AUTHORISATION_EVIDENCE_AND_STATE",
      "IDENTITY_DATE_AND_PROVIDER_RECONCILIATION",
      "CONDITIONS_COMPETENCY_AND_CONSENT",
      "IMPLEMENTATION_AND_REPORTING_RECONCILIATION",
      "RENEWAL_REDUCTION_AND_REVIEW",
      "PROFESSIONAL_CONCLUSION_AND_ACTIONS",
    ]);
  });

  it("5. separates BSP inclusion, assessment, consent, authorisation, implementation and reporting", () => {
    expect(sectionByCode("PRACTICE_IDENTITY_AND_BSP_VERIFICATION").instructions).toContain("BSP inclusion does not prove consent");
    expect(sectionByCode("IMPLEMENTATION_AND_REPORTING_RECONCILIATION").instructions).toContain("Recorded, reported, submitted and accepted are separate states");
  });

  it("6. requires actual authoritative evidence for current authorisation", () => {
    const section = sectionByCode("EVIDENCE_AUTHORITY_AND_ASSESSMENT");
    expect(section.description).toContain("authorisation record");
    expect(section.instructions).toContain("Require actual authoritative evidence for current authorisation");
    expect(section.instructions).toContain("memory is not proof");
  });

  it("7. requires exact practice, identity, date and provider reconciliation", () => {
    expect(sectionByCode("PRACTICE_IDENTITY_AND_BSP_VERIFICATION").instructions).toContain("actual practice");
    expect(sectionByCode("IDENTITY_DATE_AND_PROVIDER_RECONCILIATION").instructions).toContain("Do not assume every provider is authorised");
  });

  it("8. represents authorisation state, expiry and outside-scope outcomes", () => {
    const section = sectionByCode("AUTHORISATION_EVIDENCE_AND_STATE");
    expect(section.instructions).toContain("not yet effective");
    expect(section.instructions).toContain("approaching expiry");
    expect(section.instructions).toContain("outside authorised scope");
  });

  it("9. represents competency, consent, implementation, reporting and reduction review", () => {
    expect(sectionByCode("CONDITIONS_COMPETENCY_AND_CONSENT").instructions).toContain("RP-specific competency");
    expect(sectionByCode("IMPLEMENTATION_AND_REPORTING_RECONCILIATION").description).toContain("monthly/periodic reporting");
    expect(sectionByCode("RENEWAL_REDUCTION_AND_REVIEW").instructions).toContain("Current authorisation does not establish");
  });

  it("10. preserves cannot-verify and evidence-conflict conclusions", () => {
    expect(sectionByCode("PROFESSIONAL_CONCLUSION_AND_ACTIONS").instructions).toContain("current authorisation cannot be verified");
    expect(blueprintFromRegistry().successCriteria).toContain("Current authorisation cannot-be-verified outcome supported");
  });
});

describe("Sprint 34L.5 RP authorisation evidence, deliverable and completion gates", () => {
  it("11. requires RP, BSP, authorisation and usage evidence with provenance", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["restrictive_practice_record", "behaviour_support_plan", "authorisation_record", "rp_usage_record"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
    expect(blueprintFromRegistry().mandatoryCitations).toEqual(expect.arrayContaining([
      "restrictive_practice_record",
      "behaviour_support_plan",
      "authorisation_record",
      "rp_usage_record",
    ]));
  });

  it("12. missing authorisation evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(["restrictive_practice_record", "behaviour_support_plan", "rp_usage_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("13. memory-only evidence remains restricted", () => {
    const result = enforceEvidenceContract(blueprintFromRegistry().evidenceContract as never, {
      chunks: [{ sourceType: "memory_only", category: "authorisation_record" }],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("14. preserves template, artifact and APO approval gates", () => {
    expect(blueprintFromRegistry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({ contract: contractFor(null) }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("15. passes runtime validation when evidence, sections, artifact, template and APO approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.5 RP authorisation authority boundaries", () => {
  it("16. cannot emit separate RP risk, comparison or unauthorised-RP deliverables by default", () => {
    expect(blueprintFromRegistry().deliverableContract?.allowedInternalAnalysis).toEqual(expect.arrayContaining([
      "rp_usage_reconciliation",
    ]));
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "formal_authorisation",
      "legal_determination",
      "clinical_decision",
    ]));
  });

  it("17. APO can draft the pack but cannot fabricate external RP authorisation", () => {
    const apo = profile("authorised_program_officer_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "authorised_program_officer",
      workerProfile: apo,
      actionIdentifier: "draft_rp_governance_review",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const authorisationDecision = evaluateWorkerProfileAuthority({
      specialistCode: "authorised_program_officer",
      workerProfile: apo,
      actionIdentifier: "authorise_restrictive_practice",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(authorisationDecision.decision).toBe("PROHIBITED");
  });
});
