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
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-18T00:00:00Z");
const RP_COMPARISON_CODE = "restrictive_practice_comparison";

function blueprintFromRegistry(code = RP_COMPARISON_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = RP_COMPARISON_CODE): BlueprintSection[] {
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

function contractFor(): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template: null,
    mode: "comparison",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with participant-specific evidence, provenance, chronology, currentness, contradictions, missing evidence, risk foundation, options, comparison dimensions, participant voice, BSP reconciliation, authorisation boundary, professional synthesis and actions.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l4",
    organisationId: "org-34l4",
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
      query: "least restrictive alternatives comparison evidence",
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
    artifactId: null,
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

describe("Sprint 34L.4 RP comparison method gate and ownership", () => {
  it("1. removes the Product Owner method blocker from RP comparison only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(RP_COMPARISON_CODE);
    expect(methodPendingCodes()).toHaveLength(46);
  });

  it("2. leaves unapproved RP Blueprints method-gated", () => {
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
      "unauthorised_restrictive_practice_review",
    ]));
  });

  it("3. preserves APO ownership and supporting-specialist authority boundaries", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(RP_COMPARISON_CODE)!)).toBe("authorised_program_officer");
    expect(blueprint.primarySpecialist).toBe("authorised_program_officer");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "behaviour_support_implementation_specialist",
      "service_delivery_coordinator",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.4 approved comparison method representation", () => {
  it("4. includes all major approved professional stages", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DECISION_QUESTION_AND_SCOPE",
      "EVIDENCE_AND_RISK_FOUNDATION",
      "COMPARISON_SET_AND_PRIOR_TRIALS",
      "MANDATORY_COMPARISON_DIMENSIONS",
      "COMPARATIVE_MATRIX_AND_EVIDENCE_STRENGTH",
      "PARTICIPANT_VOICE_AND_BSP_RECONCILIATION",
      "AUTHORISATION_AND_BOUNDARIES",
      "PROFESSIONAL_SYNTHESIS_AND_OUTCOME",
      "RECOMMENDATIONS_ACTIONS_AND_GAPS",
    ]);
  });

  it("5. requires the risk foundation before comparing interventions", () => {
    expect(sectionByCode("EVIDENCE_AND_RISK_FOUNDATION").instructions).toContain("behaviour, risk, harm");
    expect(sectionByCode("EVIDENCE_AND_RISK_FOUNDATION").instructions).toContain("do not let a prior assessment predetermine");
  });

  it("6. requires a genuine alternatives set and previous-trial fidelity checks", () => {
    const section = sectionByCode("COMPARISON_SET_AND_PRIOR_TRIALS");
    expect(section.description).toContain("ordinary supports");
    expect(section.instructions).toContain("Strategy mentioned is not strategy properly trialled");
  });

  it("7. represents all ten mandatory comparison dimensions", () => {
    const section = sectionByCode("MANDATORY_COMPARISON_DIMENSIONS");
    for (const expected of [
      "Risk reduction",
      "rights impact",
      "restrictiveness",
      "evidence strength",
      "feasibility",
      "duration/frequency",
      "safeguards",
      "participant impact",
      "reversibility",
      "reduction/elimination potential",
    ]) {
      expect(section.description.toLowerCase()).toContain(expected.toLowerCase());
    }
  });

  it("8. prevents scoring-only comparison and false equivalence", () => {
    expect(sectionByCode("COMPARATIVE_MATRIX_AND_EVIDENCE_STRENGTH").instructions).toContain("Do not reduce professional reasoning to a simplistic numeric score");
    expect(sectionByCode("PROFESSIONAL_SYNTHESIS_AND_OUTCOME").instructions).toContain("no adequately supported option");
  });

  it("9. separates BSP inclusion, consultation and authorisation", () => {
    const section = sectionByCode("PARTICIPANT_VOICE_AND_BSP_RECONCILIATION");
    expect(section.instructions).toContain("Distinguish consulted, informed, agreed, consented, recommended and authorised");
    expect(section.instructions).toContain("BSP inclusion remains separate from authorisation");
  });

  it("10. preserves non-RP and insufficient-evidence outcomes", () => {
    expect(blueprintFromRegistry().successCriteria).toEqual(expect.arrayContaining([
      "Insufficient-evidence and non-restrictive-option outcomes supported",
    ]));
    expect(sectionByCode("PROFESSIONAL_SYNTHESIS_AND_OUTCOME").instructions).toContain("non-restrictive option preferred");
    expect(sectionByCode("PROFESSIONAL_SYNTHESIS_AND_OUTCOME").instructions).toContain("insufficient evidence");
  });
});

describe("Sprint 34L.4 RP comparison evidence, deliverable and completion gates", () => {
  it("11. requires current RP, BSP, risk and alternative-strategy evidence with provenance", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["restrictive_practice_record", "behaviour_support_plan", "risk_context", "alternative_strategy_evidence"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
    expect(blueprintFromRegistry().mandatoryCitations).toEqual(expect.arrayContaining([
      "restrictive_practice_record",
      "behaviour_support_plan",
      "risk_context",
      "alternative_strategy_evidence",
    ]));
  });

  it("12. missing required evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(["restrictive_practice_record", "behaviour_support_plan"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("13. memory-only evidence remains restricted", () => {
    const result = enforceEvidenceContract(blueprintFromRegistry().evidenceContract as never, {
      chunks: [{ sourceType: "memory_only", category: "alternative_strategy_evidence" }],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("14. keeps supporting analyses internal rather than emitting unsolicited deliverables", () => {
    expect(blueprintFromRegistry().deliverableContract?.allowedInternalAnalysis).toEqual(expect.arrayContaining([
      "rp_usage_pattern_review",
      "options_comparison_matrix",
    ]));
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "restrictive_practice_risk_assessment",
      "restrictive_practice_authorisation",
      "behaviour_support_plan",
    ]));
  });

  it("15. preserves APO approval and runtime completion gates", () => {
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.4 RP comparison authority boundaries", () => {
  it("16. supporting KDS cannot change or authorise the professional RP conclusion", () => {
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

  it("17. APO may draft comparison but cannot fabricate external authorisation", () => {
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
