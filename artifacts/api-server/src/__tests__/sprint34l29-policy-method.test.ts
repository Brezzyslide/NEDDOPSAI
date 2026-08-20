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

const NOW = new Date("2026-08-20T00:00:00Z");
const POLICY_CODE = "policy";

function blueprintFromRegistry(code = POLICY_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = POLICY_CODE): BlueprintSection[] {
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
  id: "tpl-policy",
  organizationId: "org-34l29",
  ownerType: "organisation_owned",
  code: "policy_template",
  title: "Policy Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/policy.docx",
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
    mode: "create",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with policy evidence about purpose, scope, need, existing governance, external authority, organisational context, current practice, required practice, policy choice, risk, domain input, governance decisions, definitions, policy position, roles, controls, prohibitions, escalation, implementation, monitoring, review triggers, related governance, professional review, lifecycle state and provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l29",
    organisationId: "org-34l29",
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
      text: `${category} policy evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "policy development evidence",
      selectedSourceIds: categories,
      selectedChunkIds: categories,
      selectedMemoryIds: [],
      selectedTaskUploadIds: [],
      retrievalMethod: "deterministic",
      ranking: [],
      tokenEstimate: 100,
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
    artifactId: "artifact-34l29",
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

describe("Sprint 34L.29 policy method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for policy only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("policy_governance_owner", true);
    expect(blueprint.requiredApprovals).toHaveProperty("controlled_document_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(POLICY_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Policy & Governance ownership and focused support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(POLICY_CODE)!)).toBe("policy_governance_specialist");
    expect(blueprint.primarySpecialist).toBe("policy_governance_specialist");
    expect(blueprint.supportingSpecialists).toEqual([
      "compliance_quality_manager",
      "knowledge_documentation_specialist",
    ]);
  });

  it("3. remains deterministically routed by policy create intent", () => {
    expect(resolveIntent("policy.create")).toMatchObject({ code: POLICY_CODE });
  });
});

describe("Sprint 34L.29 approved policy method representation", () => {
  it("4. binds the approved governance-first policy sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "POLICY_PURPOSE",
      "SCOPE_APPLICABILITY",
      "POLICY_NEED_GOVERNANCE_CONTEXT",
      "EXISTING_GOVERNANCE_SEARCH",
      "EXTERNAL_AUTHORITY_GOVERNING_REQUIREMENTS",
      "ORGANISATIONAL_CONTEXT",
      "CURRENT_REQUIRED_AND_POLICY_CHOICE",
      "RISKS",
      "DOMAIN_SPECIALIST_INPUTS",
      "GOVERNANCE_DECISIONS",
      "DEFINITIONS",
      "POLICY_POSITION",
      "ROLES_RESPONSIBILITIES",
      "GOVERNANCE_CONTROLS",
      "PROHIBITIONS_BOUNDARIES",
      "ESCALATION",
      "IMPLEMENTATION_REQUIREMENTS",
      "MONITORING_ASSURANCE",
      "REVIEW_TRIGGERS",
      "RELATED_GOVERNANCE",
      "PROFESSIONAL_POLICY_REVIEW",
      "POLICY_LIFECYCLE_STATE",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. requires policy subject, need and existing governance search before drafting", () => {
    expect(sectionByCode("POLICY_PURPOSE").instructions).toContain("Do not draft against an undefined subject");
    expect(sectionByCode("POLICY_NEED_GOVERNANCE_CONTEXT").description).toContain("governance gap");
    expect(sectionByCode("EXISTING_GOVERNANCE_SEARCH").description).toContain("POLICY_CONSOLIDATION");
    expect(sectionByCode("EXISTING_GOVERNANCE_SEARCH").instructions).toContain("Do not create duplicate policy");
  });

  it("6. represents current external authority through existing KRS/current-authority architecture", () => {
    expect(sectionByCode("EXTERNAL_AUTHORITY_GOVERNING_REQUIREMENTS").description).toContain("legislative instruments");
    expect(sectionByCode("EXTERNAL_AUTHORITY_GOVERNING_REQUIREMENTS").instructions).toContain("existing KRS/current-authority architecture");
    expect(sectionByCode("EXTERNAL_AUTHORITY_GOVERNING_REQUIREMENTS").instructions).toContain("LEGISLATIVE_REQUIREMENT");
    expect(sectionByCode("EXTERNAL_AUTHORITY_GOVERNING_REQUIREMENTS").instructions).toContain("ORGANISATIONAL_POLICY_CHOICE");
  });

  it("7. separates current practice, required practice and policy choice", () => {
    expect(sectionByCode("ORGANISATIONAL_CONTEXT").description).toContain("Current operating model");
    expect(sectionByCode("CURRENT_REQUIRED_AND_POLICY_CHOICE").description).toContain("CURRENT_PRACTICE");
    expect(sectionByCode("CURRENT_REQUIRED_AND_POLICY_CHOICE").description).toContain("REQUIRED_PRACTICE");
    expect(sectionByCode("CURRENT_REQUIRED_AND_POLICY_CHOICE").description).toContain("PROPOSED_POLICY_POSITION");
    expect(sectionByCode("CURRENT_REQUIRED_AND_POLICY_CHOICE").instructions).toContain("organisational preference is law");
  });

  it("8. represents risk, domain collaboration and unresolved governance decisions", () => {
    expect(sectionByCode("RISKS").instructions).toContain("RISK -> POLICY POSITION -> CONTROL");
    expect(sectionByCode("DOMAIN_SPECIALIST_INPUTS").description).toContain("restrictive practice");
    expect(sectionByCode("DOMAIN_SPECIALIST_INPUTS").instructions).toContain("must not rewrite authoritative domain findings");
    expect(sectionByCode("GOVERNANCE_DECISIONS").description).toContain("Organisational policy choices");
    expect(sectionByCode("GOVERNANCE_DECISIONS").instructions).toContain("ORGANISATIONAL_POLICY_DECISION_REQUIRED");
  });

  it("9. represents policy position, roles, controls, prohibitions and escalation", () => {
    expect(sectionByCode("POLICY_POSITION").instructions).toContain("Policy governs what is required/permitted/prohibited");
    expect(sectionByCode("ROLES_RESPONSIBILITIES").description).toContain("Policy owner");
    expect(sectionByCode("GOVERNANCE_CONTROLS").description).toContain("segregation of duties");
    expect(sectionByCode("PROHIBITIONS_BOUNDARIES").description).toContain("Actions outside authority");
    expect(sectionByCode("ESCALATION").instructions).toContain("Do not invent regulator reporting obligations");
  });

  it("10. represents implementation impact, monitoring, review triggers and related governance", () => {
    expect(sectionByCode("IMPLEMENTATION_REQUIREMENTS").description).toContain("IMPLEMENTATION_IMPACT_PROFILE");
    expect(sectionByCode("IMPLEMENTATION_REQUIREMENTS").instructions).toContain("without automatically generating downstream deliverables");
    expect(sectionByCode("MONITORING_ASSURANCE").instructions).toContain("Do not invent frequencies");
    expect(sectionByCode("REVIEW_TRIGGERS").description).toContain("event-driven review");
    expect(sectionByCode("RELATED_GOVERNANCE").instructions).toContain("Do not silently leave conflicting governance");
  });

  it("11. keeps lifecycle states distinct from approval, release, implementation and effectiveness", () => {
    expect(sectionByCode("PROFESSIONAL_POLICY_REVIEW").instructions).toContain("Professional completion does not equal governance approval");
    expect(sectionByCode("POLICY_LIFECYCLE_STATE").description).toContain("READY_FOR_GOVERNANCE_APPROVAL");
    expect(sectionByCode("POLICY_LIFECYCLE_STATE").description).toContain("EFFECTIVE_IN_PRACTICE");
    expect(sectionByCode("POLICY_LIFECYCLE_STATE").instructions).toContain("Approved policy does not prove implementation");
  });
});

describe("Sprint 34L.29 evidence contract and source hierarchy", () => {
  it("12. requires controlled document, current authority, organisation context and domain input evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["controlled_document", "current_authority", "organisation_context", "domain_owner_input"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("13. enforces currentness, source hierarchy and policy-state distinctions", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      currentnessRequired: true,
      memoryCannotProveCurrentness: true,
      legalOrRegulatorySourcesRequireCurrentAuthority: true,
      externalAuthorityRequiresSourceHierarchy: true,
      sectorGuidanceDoesNotEqualLegislation: true,
      regulatorGuidanceDoesNotEqualStatutoryLaw: true,
      organisationalPreferenceDoesNotEqualExternalObligation: true,
      currentPracticeDoesNotEqualRequiredPractice: true,
      requiredPracticeDoesNotEqualPolicyChoice: true,
      approvedPolicyDoesNotProveImplemented: true,
      implementationDoesNotProveEffectiveInPractice: true,
      templateDoesNotDefineProfessionalMethod: true,
    });
  });

  it("14. blocks memory-only and uncontrolled-copy evidence from proving policy authority", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, {
      chunks: [
        { sourceType: "memory_only", category: "current_authority" },
        { sourceType: "uncontrolled_copy", category: "controlled_document" },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("15. validates completion when required sections, evidence, template, artifact and approvals are present", () => {
    const result = validate();
    expect(result.passed).toBe(true);
  });

  it("16. missing current-authority evidence blocks policy completion", () => {
    const result = validate({ evidencePack: evidencePack(["controlled_document", "organisation_context", "domain_owner_input"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });
});

describe("Sprint 34L.29 authority, template and downstream boundaries", () => {
  it("17. prevents policy from becoming legal opinion, domain rewrite, publication or downstream implementation", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "legal_opinion",
      "domain_professional_conclusion",
      "domain_method_rewrite",
      "controlled_publication",
      "policy_approval",
      "policy_release",
      "implementation_execution",
      "sop_deliverable_without_request",
      "new_krs_system",
      "new_current_authority_system",
      "new_template_system",
      "new_approval_workflow",
    ]));
  });

  it("18. records professional validation rules for KRS, source hierarchy and lifecycle boundaries", () => {
    expect(blueprintFromRegistry().validationRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "approved_policy_method_applied",
      "krs_current_authority_boundary_preserved",
      "external_source_hierarchy_preserved",
      "current_required_and_policy_choice_not_collapsed",
      "domain_professional_authority_preserved",
      "organisational_policy_decision_required_where_unresolved",
      "policy_vs_procedure_boundary_preserved",
      "policy_lifecycle_states_not_collapsed",
      "approval_publication_implementation_effectiveness_not_fabricated",
      "downstream_deliverables_not_auto_emitted",
    ]));
  });

  it("19. routes current authority, legal, domain, decision, SOP and publication issues correctly", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "current_external_authority_unclear_or_conflicting", action: "use_current_authority_architecture_or_return_clarification_required" }),
      expect.objectContaining({ trigger: "legal_opinion_or_binding_external_interpretation_required", action: "defer_to_authorised_legal_or_external_authority" }),
      expect.objectContaining({ trigger: "domain_professional_conclusion_required", action: "defer_to_relevant_domain_owner_without_rewriting_findings" }),
      expect.objectContaining({ trigger: "organisational_policy_choice_unresolved", action: "return_organisational_policy_decision_required" }),
      expect.objectContaining({ trigger: "detailed_operational_instruction_required", action: "recommend_standard_operating_procedure_without_emitting_unsolicited_sop" }),
      expect.objectContaining({ trigger: "controlled_publication_release_or_supersession_required", action: "handoff_to_document_control_or_controlled_document_assembly_with_approval" }),
    ]));
  });

  it("20. keeps controlled document approval, template and artifact gates in place", () => {
    const approvalStates = approvalsFor();
    approvalStates.controlled_document_owner = false;
    const missingApproval = validate({ approvalStates });
    expect(missingApproval.passed).toBe(false);
    expect(missingApproval.failures.some((failure) => failure.gate === "approval_required")).toBe(true);

    const noTemplate = validate({ contract: contractFor(null) });
    expect(noTemplate.passed).toBe(false);
    expect(noTemplate.failures.some((failure) => failure.gate === "template_required")).toBe(true);

    const noArtifact = validate({ artifactId: null });
    expect(noArtifact.passed).toBe(false);
    expect(noArtifact.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });
});
