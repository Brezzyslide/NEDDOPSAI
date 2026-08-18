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
const RP_CODE = "restrictive_practice_risk_assessment";

function blueprintFromRegistry(code = RP_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = RP_CODE): BlueprintSection[] {
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
  id: "tpl-rp-risk",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "restrictive_practice_risk_assessment_template",
  title: "Restrictive Practice Risk Assessment Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/restrictive-practice-risk-assessment.docx",
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
    mode: "risk_assessment",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with RP source evidence, chronology, currentness, conflicts, untreated risk, alternatives, necessity, proportionality, rights impact, safeguards, residual risk, reduction and elimination, consultation, BSP reconciliation, authorisation pathway, conclusion, actions and provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l3",
    organisationId: "org-34l3",
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
      query: "restrictive practice risk assessment evidence",
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
    artifactId: "artifact-34l3",
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

describe("Sprint 34L.3 RP method gate and ownership", () => {
  it("1. removes the Product Owner method blocker from RP risk assessment only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(RP_CODE);
    expect(methodPendingCodes()).toHaveLength(48);
  });

  it("2. leaves other RP Blueprints method-gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
      "restrictive_practice_comparison",
      "restrictive_practice_authorisation",
      "unauthorised_restrictive_practice_review",
    ]));
  });

  it("3. preserves APO ownership and KDS artifact-only support boundary", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(RP_CODE)!)).toBe("authorised_program_officer");
    expect(blueprint.primarySpecialist).toBe("authorised_program_officer");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "behaviour_support_implementation_specialist",
      "incident_safeguarding_specialist",
      "compliance_quality_manager",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.3 approved RP risk method representation", () => {
  it("4. includes all major approved professional stages", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "ASSESSMENT_CONTEXT",
      "BEHAVIOUR_RISK_AND_HARM",
      "EVIDENCE_RECONCILIATION",
      "RISK_WITHOUT_RP",
      "FUNCTIONAL_CONTEXT",
      "LESS_RESTRICTIVE_ALTERNATIVES",
      "RESTRICTIVE_PRACTICE_DEFINITION",
      "NECESSITY_PROPORTIONALITY",
      "RIGHTS_IMPACT_AND_SAFEGUARDS",
      "RISK_WITH_RP_AND_RESIDUAL_RISK",
      "REDUCTION_ELIMINATION_AND_REVIEW",
      "CONSULTATION_BSP_AND_AUTHORISATION",
      "PROFESSIONAL_CONCLUSION_ACTIONS",
    ]);
  });

  it("5. requires untreated risk analysis before necessity", () => {
    expect(sectionByCode("RISK_WITHOUT_RP").instructions).toContain("Do not assume the RP is necessary");
    expect(sectionByCode("NECESSITY_PROPORTIONALITY").instructions).toContain("Assess necessity and proportionality separately");
  });

  it("6. requires less restrictive alternatives and implementation fidelity", () => {
    const section = sectionByCode("LESS_RESTRICTIVE_ALTERNATIVES");
    expect(section.description).toContain("implementation fidelity");
    expect(section.instructions).toContain("A BSP mention is not proof of implementation");
  });

  it("7. represents rights, safeguards, residual risk and reduction/elimination", () => {
    expect(sectionByCode("RIGHTS_IMPACT_AND_SAFEGUARDS").description.toLowerCase()).toContain("dignity");
    expect(sectionByCode("RISK_WITH_RP_AND_RESIDUAL_RISK").instructions).toContain("may introduce risk");
    expect(sectionByCode("REDUCTION_ELIMINATION_AND_REVIEW").instructions).toContain("not treat RP as a permanent endpoint");
  });

  it("8. separates BSP inclusion, authorisation and professional assessment", () => {
    const section = sectionByCode("CONSULTATION_BSP_AND_AUTHORISATION");
    expect(section.instructions).toContain("BSP inclusion does not itself establish legal/administrative authorisation");
    expect(section.instructions).toContain("proposed, assessed, BSP included, authorisation requested, authorised, expired, not authorised and unknown");
  });

  it("9. preserves negative and insufficient-evidence conclusions", () => {
    expect(sectionByCode("PROFESSIONAL_CONCLUSION_ACTIONS").instructions).toContain("not professionally supported");
    expect(blueprintFromRegistry().successCriteria).toContain("Negative or insufficient-evidence conclusion remains available");
  });
});

describe("Sprint 34L.3 RP evidence, deliverable and completion gates", () => {
  it("10. requires current RP, BSP, incident and risk evidence with provenance", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["restrictive_practice_record", "behaviour_support_plan", "incident_record", "risk_context"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
    expect(blueprintFromRegistry().mandatoryCitations).toEqual(expect.arrayContaining([
      "restrictive_practice_record",
      "behaviour_support_plan",
      "incident_record",
      "risk_context",
    ]));
  });

  it("11. missing required evidence cannot silently become verified fact", () => {
    const result = validate({ evidencePack: evidencePack(["restrictive_practice_record", "behaviour_support_plan"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("12. memory-only evidence remains restricted", () => {
    const result = enforceEvidenceContract(blueprintFromRegistry().evidenceContract as never, {
      chunks: [{ sourceType: "memory_only", category: "restrictive_practice_record" }],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("13. required artifact, template and APO approval gates remain active", () => {
    expect(blueprintFromRegistry().deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      templateRequired: true,
    });
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({ contract: contractFor(null) }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("14. passes runtime validation when method sections, evidence, template, artifact and APO approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.3 RP authority boundaries", () => {
  it("15. supporting KDS cannot change restrictive-practice professional conclusions", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "knowledge_documentation_specialist",
      workerProfile: profile("knowledge_documentation_specialist_profile"),
      actionIdentifier: "change_restrictive_practice_conclusion",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("16. APO can draft the assessment but cannot authorise restrictive practice", () => {
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

  it("17. supporting analysis stays internal and prohibited deliverables remain blocked", () => {
    expect(blueprintFromRegistry().deliverableContract?.allowedInternalAnalysis).toEqual(expect.arrayContaining([
      "rp_governance_review",
    ]));
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "clinical_assessment",
      "medication_prescribing_decision",
      "formal_authorisation",
    ]));
  });
});
