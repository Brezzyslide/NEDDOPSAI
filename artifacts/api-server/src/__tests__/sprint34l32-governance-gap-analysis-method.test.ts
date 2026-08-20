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
} from "../services/workBlueprintService.js";

const CODE = "governance_gap_analysis";
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

function contractFor(): BlueprintExecutionContract {
  return {
    blueprint: blueprintFromRegistry(),
    sections: sectionsFromRegistry(),
    template: null,
    mode: "review",
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
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated with source-backed governance gap evidence, comparison findings, remediation and closure states.`)
    .join("\n\n");
}

function evidencePack(categories = allRequiredEvidenceCategories()) {
  return {
    executionId: "exec-governance-gap",
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
      query: "governance gap evidence",
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
    artifactId: null,
    approvalStates: approvalsFor(),
    ...overrides,
  });
}

describe("Sprint 34L.32 governance gap analysis method gate and ownership", () => {
  it("1. removes the human professional method blocker for governance_gap_analysis only", () => {
    const blueprint = blueprintFromRegistry();
    expect(sectionsFromRegistry()[0].sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Policy & Governance ownership with CQM/KDS support", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(CODE)!)).toBe("policy_governance_specialist");
    expect(blueprint.primarySpecialist).toBe("policy_governance_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining(["compliance_quality_manager", "knowledge_documentation_specialist"]));
    expect(blueprint.requiredApprovals).toMatchObject({ policy_governance_owner: true, compliance_quality_owner: true });
  });

  it("3. remains deterministically routed by the governance gap-analysis intent", () => {
    expect(resolveIntent("governance.gap_analysis")).toMatchObject({ code: CODE });
  });
});

describe("Sprint 34L.32 approved governance gap method representation", () => {
  it("4. binds the approved required/design/implementation/evidence/effectiveness sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "EXECUTIVE_GOVERNANCE_GAP_POSITION",
      "SCOPE_GOVERNANCE_DOMAIN",
      "EVIDENCE_REVIEWED",
      "REQUIRED_GOVERNANCE_BASELINE",
      "DESIGNED_GOVERNANCE",
      "IMPLEMENTED_GOVERNANCE",
      "EVIDENCED_GOVERNANCE",
      "GOVERNANCE_EFFECTIVENESS",
      "REQUIRED_VS_DESIGNED_ANALYSIS",
      "DESIGNED_VS_IMPLEMENTED_ANALYSIS",
      "IMPLEMENTED_VS_EVIDENCED_ANALYSIS",
      "EVIDENCE_VS_EFFECTIVENESS_ANALYSIS",
      "GAP_CLASSIFICATION",
      "AUTHORITY_ACCOUNTABILITY_GAPS",
      "GOVERNANCE_FORUM_OVERSIGHT_GAPS",
      "REPORTING_INFORMATION_FLOW_GAPS",
      "ASSURANCE_GAPS",
      "RISK_SEVERITY",
      "CROSS_DOMAIN_SPECIALIST_INPUT",
      "REMEDIATION_REQUIREMENTS",
      "CORRECTIVE_ACTION_BOUNDARY",
      "ACTION_CLOSURE_STATE",
      "CLOSURE_EVIDENCE",
      "REASSESSMENT_TRIGGERS",
      "BOUNDARIES_AND_HANDOFFS",
      "PARTICIPANT_STAKEHOLDER_VOICE",
      "TREND_ANALYSIS",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. defines scope and consumes existing KRS/evidence architecture", () => {
    expect(sectionByCode("SCOPE_GOVERNANCE_DOMAIN").instructions).toContain("Do not silently expand scope");
    expect(sectionByCode("EVIDENCE_REVIEWED").instructions).toContain("Use existing KRS/evidence/current-authority architecture");
  });

  it("6. represents required governance baseline and source authority distinctions", () => {
    expect(sectionByCode("REQUIRED_GOVERNANCE_BASELINE").description).toContain("Applicable legislation");
    expect(sectionByCode("REQUIRED_GOVERNANCE_BASELINE").instructions).toContain("EXTERNAL_MANDATORY_REQUIREMENT");
    expect(sectionByCode("REQUIRED_GOVERNANCE_BASELINE").instructions).toContain("Do not invent requirements");
  });

  it("7. separates designed governance from implementation", () => {
    expect(sectionByCode("DESIGNED_GOVERNANCE").description).toContain("Formal governance design");
    expect(sectionByCode("DESIGNED_GOVERNANCE").instructions).toContain("DESIGN_PRESENT");
    expect(sectionByCode("IMPLEMENTED_GOVERNANCE").instructions).toContain("DESIGN does not prove IMPLEMENTATION");
  });

  it("8. separates claimed, recorded and verified governance evidence", () => {
    expect(sectionByCode("EVIDENCED_GOVERNANCE").description).toContain("Minutes");
    expect(sectionByCode("EVIDENCED_GOVERNANCE").instructions).toContain("CLAIMED, RECORDED and VERIFIED are distinct");
    expect(sectionByCode("IMPLEMENTED_VS_EVIDENCED_ANALYSIS").instructions).toContain("IMPLEMENTATION_UNVERIFIED");
  });

  it("9. separates control existence, operation and effectiveness", () => {
    expect(sectionByCode("GOVERNANCE_EFFECTIVENESS").description).toContain("Recurring incidents");
    expect(sectionByCode("GOVERNANCE_EFFECTIVENESS").instructions).toContain("CONTROL EXISTS, CONTROL OPERATES and CONTROL EFFECTIVE");
    expect(sectionByCode("EVIDENCE_VS_EFFECTIVENESS_ANALYSIS").instructions).toContain("Do not claim effectiveness solely from implementation evidence");
  });

  it("10. represents all four comparison axes", () => {
    expect(sectionByCode("REQUIRED_VS_DESIGNED_ANALYSIS").description).toContain("REQUIRED_GOVERNANCE against DESIGNED_GOVERNANCE");
    expect(sectionByCode("DESIGNED_VS_IMPLEMENTED_ANALYSIS").description).toContain("DESIGNED_GOVERNANCE against IMPLEMENTED_GOVERNANCE");
    expect(sectionByCode("IMPLEMENTED_VS_EVIDENCED_ANALYSIS").description).toContain("IMPLEMENTED_GOVERNANCE against EVIDENCED_GOVERNANCE");
    expect(sectionByCode("EVIDENCE_VS_EFFECTIVENESS_ANALYSIS").description).toContain("EVIDENCED_GOVERNANCE against EFFECTIVE_GOVERNANCE");
  });

  it("11. represents professional gap classifications", () => {
    expect(sectionByCode("GAP_CLASSIFICATION").description).toContain("REQUIREMENT_GAP");
    expect(sectionByCode("GAP_CLASSIFICATION").description).toContain("EFFECTIVENESS_GAP");
    expect(sectionByCode("GAP_CLASSIFICATION").description).toContain("CLOSURE_GAP");
  });

  it("12. represents authority, forum, reporting and assurance gaps", () => {
    expect(sectionByCode("AUTHORITY_ACCOUNTABILITY_GAPS").instructions).toContain("RESPONSIBILITY, DECISION_AUTHORITY");
    expect(sectionByCode("GOVERNANCE_FORUM_OVERSIGHT_GAPS").instructions).toContain("A recurring meeting is not automatically effective governance");
    expect(sectionByCode("REPORTING_INFORMATION_FLOW_GAPS").description).toContain("what actually flows");
    expect(sectionByCode("ASSURANCE_GAPS").instructions).toContain("Do not confuse control-owner self-report");
  });

  it("13. represents risk, domain input, remediation and CAPA boundary", () => {
    expect(sectionByCode("RISK_SEVERITY").description).toContain("Participant harm");
    expect(sectionByCode("CROSS_DOMAIN_SPECIALIST_INPUT").instructions).toContain("must not replace domain professional findings");
    expect(sectionByCode("REMEDIATION_REQUIREMENTS").instructions).toContain("Do not invent root cause");
    expect(sectionByCode("CORRECTIVE_ACTION_BOUNDARY").instructions).toContain("does not automatically become corrective_action_improvement");
  });

  it("14. separates action completion, closure evidence, reassessment and effectiveness", () => {
    expect(sectionByCode("ACTION_CLOSURE_STATE").description).toContain("ACTION REPORTED COMPLETE");
    expect(sectionByCode("ACTION_CLOSURE_STATE").instructions).toContain("Closure is not effectiveness");
    expect(sectionByCode("CLOSURE_EVIDENCE").description).toContain("practice observation");
    expect(sectionByCode("REASSESSMENT_TRIGGERS").description).toContain("repeated control failure");
  });

  it("15. preserves boundaries with governance framework, audit readiness, executive review and internal audit", () => {
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("governance_framework");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("compliance_audit_readiness");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").description).toContain("governance_executive_review");
    expect(sectionByCode("BOUNDARIES_AND_HANDOFFS").instructions).toContain("Do not redesign the entire framework");
  });
});

describe("Sprint 34L.32 evidence, validation and closure controls", () => {
  it("16. requires current authority, governance framework, implementation and assurance evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["current_authority", "governance_framework", "implementation_evidence", "assurance_record"],
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("17. enforces five-state and evidence-state distinctions", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      requiredDoesNotEqualDesigned: true,
      designedDoesNotEqualImplemented: true,
      implementedDoesNotEqualEvidenced: true,
      evidencedDoesNotEqualEffective: true,
      claimedDoesNotEqualRecorded: true,
      recordedDoesNotEqualVerified: true,
      actionReportedCompleteDoesNotEqualGapClosed: true,
    });
  });

  it("18. rejects memory-only evidence for governance verification", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "assurance_record" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("19. validates completion when required sections, evidence and approvals are present", () => {
    expect(validate().passed).toBe(true);
  });

  it("20. missing assurance evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(allRequiredEvidenceCategories().filter((category) => category !== "assurance_record")) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence" && failure.details?.includes("assurance_record"))).toBe(true);
  });

  it("21. prevents unrequested framework, audit, executive review and CAPA deliverables", () => {
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "governance_framework_without_request",
      "compliance_audit_readiness_without_request",
      "governance_executive_review_without_request",
      "internal_audit_program_replacement",
      "capa_without_request",
    ]));
  });

  it("22. routes root cause, CAPA, closure and framework issues without inventing conclusions", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "missing_governance_architecture_identified", action: "recommend_governance_framework_without_redesigning_it" }),
      expect.objectContaining({ trigger: "substantial_capa_required", action: "recommend_corrective_action_improvement_without_emitting_unsolicited_capa" }),
      expect.objectContaining({ trigger: "root_cause_not_established", action: "state_root_cause_not_established_and_route_deeper_review_if_required" }),
      expect.objectContaining({ trigger: "closure_or_effectiveness_unverified", action: "keep_gap_open_or_reassessment_required_until_evidence_exists" }),
    ]));
  });

  it("23. keeps unrelated pending 34F Blueprints method-gated", () => {
    expect(methodPendingCodes()).not.toContain("policy");
    expect(methodPendingCodes()).not.toContain("governance_framework");
    expect(methodPendingCodes()).not.toContain("regulatory_change_impact_assessment");
    expect(methodPendingCodes()).not.toContain(CODE);
    expect(methodPendingCodes()).toHaveLength(0);
    expect(methodPendingCodes()).toEqual(expect.arrayContaining([
    ]));
  });
});
