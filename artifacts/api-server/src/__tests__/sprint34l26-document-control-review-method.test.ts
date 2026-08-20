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
} from "../services/workBlueprintService.js";

const NOW = new Date("2026-08-20T00:00:00Z");
const DOCUMENT_CONTROL_CODE = "document_control_review";

function blueprintFromRegistry(code = DOCUMENT_CONTROL_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = DOCUMENT_CONTROL_CODE): BlueprintSection[] {
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
    mode: "control_review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with document-control evidence about review scope, controlled document population, register reconciliation, identity, ownership, approval, authority, version control, currentness, review status, supersession, active operational circulation, duplicate and conflicting copies, access, security, amendment traceability, archive, retention, disposal, actual practice verification, findings, risk, corrective actions, closure evidence, reassessment, monitoring and provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l26",
    organisationId: "org-34l26",
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
      text: `${category} document control evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "document control governance evidence",
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

describe("Sprint 34L.26 document control method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for document control only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("knowledge_documentation_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(DOCUMENT_CONTROL_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Knowledge & Documentation ownership and focused support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(DOCUMENT_CONTROL_CODE)!)).toBe("knowledge_documentation_specialist");
    expect(blueprint.primarySpecialist).toBe("knowledge_documentation_specialist");
    expect(blueprint.supportingSpecialists).toEqual([
      "policy_governance_specialist",
      "compliance_quality_manager",
    ]);
  });

  it("3. remains deterministically routed by document-control intent", () => {
    expect(resolveIntent("knowledge.document_control")).toMatchObject({ code: DOCUMENT_CONTROL_CODE });
  });
});

describe("Sprint 34L.26 approved document-control method representation", () => {
  it("4. binds the approved document-control work-product sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "EXECUTIVE_DOCUMENT_CONTROL_POSITION",
      "REVIEW_SCOPE",
      "EVIDENCE_REVIEWED",
      "CONTROLLED_DOCUMENT_POPULATION",
      "REGISTER_RECONCILIATION",
      "DOCUMENT_IDENTITY_AND_OWNERSHIP",
      "APPROVAL_AUTHORITY_STATUS",
      "VERSION_CONTROL",
      "CURRENTNESS_REVIEW_STATUS",
      "SUPERSESSION",
      "ACTIVE_OPERATIONAL_CIRCULATION",
      "DUPLICATE_CONFLICTING_COPIES",
      "ACCESS_SECURITY",
      "AMENDMENT_TRACEABILITY",
      "ARCHIVE_RETENTION_DISPOSAL",
      "ACTUAL_PRACTICE_VERIFICATION",
      "DOCUMENT_CONTROL_FINDINGS",
      "RISK_IMPACT",
      "CORRECTIVE_ACTIONS",
      "CLOSURE_EVIDENCE",
      "REASSESSMENT_MONITORING",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. represents scope, population and register reconciliation", () => {
    expect(sectionByCode("REVIEW_SCOPE").description).toContain("document population");
    expect(sectionByCode("CONTROLLED_DOCUMENT_POPULATION").instructions).toContain("single repository");
    expect(sectionByCode("REGISTER_RECONCILIATION").description).toContain("operational copies");
    expect(sectionByCode("REGISTER_RECONCILIATION").instructions).toContain("labelled authoritative");
  });

  it("6. represents approval, version control, currentness and review-due distinctions", () => {
    expect(sectionByCode("APPROVAL_AUTHORITY_STATUS").description).toContain("draft/reviewed/approved/released/archived");
    expect(sectionByCode("APPROVAL_AUTHORITY_STATUS").instructions).toContain("marked final");
    expect(sectionByCode("VERSION_CONTROL").description).toContain("VERSION_CONFLICT");
    expect(sectionByCode("CURRENTNESS_REVIEW_STATUS").description).toContain("review overdue");
    expect(sectionByCode("CURRENTNESS_REVIEW_STATUS").instructions).toContain("inside review date");
  });

  it("7. represents supersession, operational circulation and duplicate/conflicting copies", () => {
    expect(sectionByCode("SUPERSESSION").instructions).toContain("ARCHIVED");
    expect(sectionByCode("ACTIVE_OPERATIONAL_CIRCULATION").description).toContain("workers actually access");
    expect(sectionByCode("ACTIVE_OPERATIONAL_CIRCULATION").instructions).toContain("correct register");
    expect(sectionByCode("DUPLICATE_CONFLICTING_COPIES").description).toContain("uncontrolled local copies");
  });

  it("8. keeps access/view/edit/approve/release permissions distinct", () => {
    expect(sectionByCode("ACCESS_SECURITY").description).toContain("viewer access");
    expect(sectionByCode("ACCESS_SECURITY").description).toContain("edit access");
    expect(sectionByCode("ACCESS_SECURITY").description).toContain("approval authority");
    expect(sectionByCode("ACCESS_SECURITY").description).toContain("release authority");
    expect(sectionByCode("ACCESS_SECURITY").instructions).toContain("CAN VIEW");
  });

  it("9. represents amendment traceability, archive/retention and actual practice verification", () => {
    expect(sectionByCode("AMENDMENT_TRACEABILITY").description).toContain("revision history");
    expect(sectionByCode("AMENDMENT_TRACEABILITY").instructions).toContain("AMENDMENT_TRACEABILITY_GAP");
    expect(sectionByCode("ARCHIVE_RETENTION_DISPOSAL").description).toContain("disposal prohibited");
    expect(sectionByCode("ACTUAL_PRACTICE_VERIFICATION").description).toContain("old procedure used");
    expect(sectionByCode("ACTUAL_PRACTICE_VERIFICATION").description).toContain("CONTROL_INEFFECTIVE");
  });

  it("10. represents findings, risk, corrective actions and verified closure", () => {
    expect(sectionByCode("DOCUMENT_CONTROL_FINDINGS").description).toContain("CONTROLLED_AND_CURRENT");
    expect(sectionByCode("DOCUMENT_CONTROL_FINDINGS").description).toContain("CLARIFICATION_REQUIRED");
    expect(sectionByCode("RISK_IMPACT").description).toContain("evidence integrity");
    expect(sectionByCode("CORRECTIVE_ACTIONS").instructions).toContain("without mutating registers");
    expect(sectionByCode("CLOSURE_EVIDENCE").instructions).toContain("EVIDENCE VERIFIED");
  });
});

describe("Sprint 34L.26 evidence contract and control-state model", () => {
  it("11. requires document register, controlled document and approval evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["document_register", "controlled_document", "approval_record"],
      minimumEvidenceCount: 3,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("12. enforces currentness, authority, conflict and source controls", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      currentnessRequired: true,
      memoryCannotProveCurrentness: true,
      documentExistsDoesNotProveRegistered: true,
      registeredDoesNotProveApproved: true,
      approvedDoesNotProveCurrent: true,
      currentDoesNotProveOperationallyCirculated: true,
      conflictingVersionsRequireResolution: true,
      currentAuthorityRequiredForRetentionPrivacyOrRegulatedRecords: true,
    });
  });

  it("13. blocks memory-only and uncontrolled-copy evidence from proving control status", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, {
      chunks: [
        { sourceType: "memory_only", category: "document_register" },
        { sourceType: "uncontrolled_copy", category: "controlled_document" },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("14. validates completion when required sections, evidence and KDS approval are present", () => {
    const result = validate();
    expect(result.passed).toBe(true);
  });

  it("15. missing approval evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(["document_register", "controlled_document"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });
});

describe("Sprint 34L.26 authority boundaries", () => {
  it("16. prevents document control from rewriting domain professional content", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "professional_content_change",
      "domain_method_rewrite",
      "controlled_publication",
      "supersession_execution",
      "archive_execution",
      "access_override",
      "document_deletion",
    ]));
    expect(blueprint.validationRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "substantive_professional_content_review_boundary_preserved",
    ]));
  });

  it("17. routes content, lifecycle execution, retention and CAPA work to the right owner", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "substantive_professional_content_problem_identified", action: "route_to_relevant_domain_blueprint_without_rewriting_content" }),
      expect.objectContaining({ trigger: "publication_supersession_archive_owner_change_or_access_change_required", action: "prepare_document_control_recommendation_and_require_authorised_approval" }),
      expect.objectContaining({ trigger: "legal_retention_privacy_or_regulated_record_determination_required", action: "require_current_authority_or_external_authorised_advice" }),
      expect.objectContaining({ trigger: "material_control_gap_requires_capa", action: "recommend_capa_pathway_without_emitting_unsolicited_capa_deliverable" }),
    ]));
  });
});
