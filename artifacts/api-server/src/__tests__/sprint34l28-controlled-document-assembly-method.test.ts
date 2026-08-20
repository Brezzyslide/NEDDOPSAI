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
const ASSEMBLY_CODE = "controlled_document_assembly";

function blueprintFromRegistry(code = ASSEMBLY_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = ASSEMBLY_CODE): BlueprintSection[] {
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
  id: "tpl-controlled-assembly",
  organizationId: "org-34l28",
  ownerType: "organisation_owned",
  code: "controlled_document_assembly_template",
  title: "Controlled Document Assembly Template",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/controlled-document-assembly.docx",
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
    mode: "assembly",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with controlled assembly evidence about source professional content, ownership, authority, status, template identity, document identity, control metadata, section mapping, appendices, citations, provenance, content integrity, missing professional content, conflicts, sensitive information, assembly completeness, document-control completeness, approval readiness, release prerequisites, artifact handoff and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l28",
    organisationId: "org-34l28",
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
      text: `${category} controlled assembly evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "controlled document assembly evidence",
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
    artifactId: "artifact-34l28",
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

describe("Sprint 34L.28 controlled document assembly method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for controlled assembly only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("knowledge_documentation_owner", true);
    expect(blueprint.requiredApprovals).toHaveProperty("controlled_publication_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(ASSEMBLY_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Knowledge & Documentation ownership and focused support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(ASSEMBLY_CODE)!)).toBe("knowledge_documentation_specialist");
    expect(blueprint.primarySpecialist).toBe("knowledge_documentation_specialist");
    expect(blueprint.supportingSpecialists).toEqual([
      "policy_governance_specialist",
      "compliance_quality_manager",
    ]);
  });

  it("3. remains deterministically routed by controlled assembly and template intents", () => {
    expect(resolveIntent("documentation.controlled_assembly")).toMatchObject({ code: ASSEMBLY_CODE });
    expect(resolveIntent("documentation.template_application")).toMatchObject({ code: ASSEMBLY_CODE });
  });
});

describe("Sprint 34L.28 approved controlled-assembly method representation", () => {
  it("4. binds the approved controlled assembly work-product sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "ASSEMBLY_POSITION",
      "ASSEMBLY_SCOPE",
      "SOURCE_PROFESSIONAL_CONTENT",
      "PROFESSIONAL_OWNERSHIP_AUTHORITY",
      "SOURCE_CONTENT_STATUS",
      "AUTHORITATIVE_TEMPLATE",
      "TEMPLATE_CONFLICTS_CLARIFICATIONS",
      "DOCUMENT_IDENTITY",
      "CONTROL_METADATA",
      "SECTION_CONTENT_MAPPING",
      "TABLES_FORMS_APPENDICES",
      "CITATIONS_PROVENANCE",
      "CONTENT_INTEGRITY_VERIFICATION",
      "MISSING_PROFESSIONAL_CONTENT",
      "CONFLICTS_CLARIFICATIONS",
      "SENSITIVE_INFORMATION_DISTRIBUTION",
      "ASSEMBLY_COMPLETENESS",
      "DOCUMENT_CONTROL_COMPLETENESS",
      "APPROVAL_READINESS",
      "RELEASE_PREREQUISITES",
      "ARTIFACT_HANDOFF_REQUIREMENTS",
      "EVIDENCE_PROVENANCE",
    ]);
  });

  it("5. represents assembly scope and source professional content status", () => {
    expect(sectionByCode("ASSEMBLY_SCOPE").description).toContain("Document/work-product type");
    expect(sectionByCode("ASSEMBLY_SCOPE").instructions).toContain("actually document assembly");
    expect(sectionByCode("SOURCE_PROFESSIONAL_CONTENT").description).toContain("approved Blueprint output");
    expect(sectionByCode("SOURCE_CONTENT_STATUS").description).toContain("PROFESSIONALLY_COMPLETE");
    expect(sectionByCode("SOURCE_CONTENT_STATUS").instructions).toContain("Do not silently upgrade draft content");
  });

  it("6. separates content owner, assembler, approver and releaser", () => {
    expect(sectionByCode("ASSEMBLY_POSITION").instructions).toContain("CONTENT OWNER");
    expect(sectionByCode("PROFESSIONAL_OWNERSHIP_AUTHORITY").description).toContain("document assembler");
    expect(sectionByCode("PROFESSIONAL_OWNERSHIP_AUTHORITY").description).toContain("releaser");
    expect(sectionByCode("PROFESSIONAL_OWNERSHIP_AUTHORITY").instructions).toContain("KDS does not acquire domain authority");
  });

  it("7. resolves template, document identity and control metadata without inventing values", () => {
    expect(sectionByCode("AUTHORITATIVE_TEMPLATE").description).toContain("Template identity");
    expect(sectionByCode("AUTHORITATIVE_TEMPLATE").instructions).toContain("existing template-bound work-product architecture");
    expect(sectionByCode("TEMPLATE_CONFLICTS_CLARIFICATIONS").description).toContain("TEMPLATE_CLARIFICATION_REQUIRED");
    expect(sectionByCode("DOCUMENT_IDENTITY").instructions).toContain("Do not invent document codes");
    expect(sectionByCode("CONTROL_METADATA").description).toContain("controlled/uncontrolled-copy notice");
  });

  it("8. maps sections, tables, citations and provenance without fabricating gaps", () => {
    expect(sectionByCode("SECTION_CONTENT_MAPPING").description).toContain("CONTENT_MISSING");
    expect(sectionByCode("SECTION_CONTENT_MAPPING").instructions).toContain("Do not fill substantive gaps");
    expect(sectionByCode("TABLES_FORMS_APPENDICES").instructions).toContain("rather than fabricated values");
    expect(sectionByCode("CITATIONS_PROVENANCE").instructions).toContain("Mandatory citations remain mandatory");
  });

  it("9. preserves professional meaning and blocks missing professional content fabrication", () => {
    expect(sectionByCode("CONTENT_INTEGRITY_VERIFICATION").description).toContain("altered conclusion");
    expect(sectionByCode("CONTENT_INTEGRITY_VERIFICATION").description).toContain("changed calculation");
    expect(sectionByCode("CONTENT_INTEGRITY_VERIFICATION").instructions).toContain("KDS must not alter professional findings");
    expect(sectionByCode("MISSING_PROFESSIONAL_CONTENT").description).toContain("PROFESSIONAL_CONTENT_REQUIRED");
    expect(sectionByCode("MISSING_PROFESSIONAL_CONTENT").description).toContain("DOMAIN_OWNER_REVIEW_REQUIRED");
  });

  it("10. represents conflicts, sensitive information, approval readiness and release prerequisites", () => {
    expect(sectionByCode("CONFLICTS_CLARIFICATIONS").description).toContain("professional sources");
    expect(sectionByCode("SENSITIVE_INFORMATION_DISTRIBUTION").description).toContain("need-to-know");
    expect(sectionByCode("APPROVAL_READINESS").description).toContain("READY_FOR_APPROVAL");
    expect(sectionByCode("APPROVAL_READINESS").instructions).toContain("Do not approve");
    expect(sectionByCode("RELEASE_PREREQUISITES").instructions).toContain("APPROVED does not automatically mean RELEASED");
  });

  it("11. keeps artifact generation downstream", () => {
    expect(sectionByCode("ARTIFACT_HANDOFF_REQUIREMENTS").description).toContain("Completed Work handoff");
    expect(sectionByCode("ARTIFACT_HANDOFF_REQUIREMENTS").description).toContain("artifact/export infrastructure");
    expect(sectionByCode("ARTIFACT_HANDOFF_REQUIREMENTS").instructions).toContain("not the DOCX/PDF renderer");
    expect(sectionByCode("ARTIFACT_HANDOFF_REQUIREMENTS").instructions).toContain("do not embed rendering logic");
  });
});

describe("Sprint 34L.28 evidence contract and lifecycle-state model", () => {
  it("12. requires professional content, authoritative template, control metadata and approval evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["professional_source_content", "authoritative_template", "document_control_metadata", "approval_record"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("13. enforces source authority, status, template, approval, release and artifact-state separation", () => {
    expect(blueprintFromRegistry().evidenceContract?.freshnessRules).toMatchObject({
      currentnessRequired: true,
      memoryCannotProveCurrentness: true,
      contentExistsDoesNotProveAuthoritative: true,
      authoritativeDoesNotProveApproved: true,
      approvedDoesNotProveReleased: true,
      assembledDoesNotProveApproved: true,
      releasedDoesNotProveArtifactGenerated: true,
      artifactGeneratedDoesNotProveCurrentOperationalCopy: true,
      templateResolvedDoesNotProveContentMapped: true,
      missingProfessionalContentCannotBeFabricated: true,
    });
  });

  it("14. blocks memory-only and uncontrolled-copy evidence from proving assembly readiness", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, {
      chunks: [
        { sourceType: "memory_only", category: "professional_source_content" },
        { sourceType: "uncontrolled_copy", category: "authoritative_template" },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("15. validates completion when required sections, evidence, template, artifact and approvals are present", () => {
    const result = validate();
    expect(result.passed).toBe(true);
  });

  it("16. missing authoritative template evidence blocks completion", () => {
    const result = validate({ evidencePack: evidencePack(["professional_source_content", "document_control_metadata", "approval_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("17. missing template or artifact still blocks the downstream controlled package", () => {
    const noTemplate = validate({ contract: contractFor(null) });
    expect(noTemplate.passed).toBe(false);
    expect(noTemplate.failures.some((failure) => failure.gate === "template_required")).toBe(true);

    const noArtifact = validate({ artifactId: null });
    expect(noArtifact.passed).toBe(false);
    expect(noArtifact.failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
  });
});

describe("Sprint 34L.28 KDS authority, approval and adjacent Blueprint boundaries", () => {
  it("18. prevents KDS from rewriting content, approving, releasing or rendering artifacts", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "professional_content_change",
      "professional_content_creation",
      "professional_content_rewrite",
      "domain_method_rewrite",
      "domain_approval",
      "controlled_publication",
      "release_execution",
      "document_owner_change",
      "supersession_or_archive",
      "access_override",
      "artifact_renderer",
      "new_template_system",
      "new_approval_workflow",
    ]));
    expect(blueprint.validationRules.map((rule) => rule.rule)).toEqual(expect.arrayContaining([
      "content_owner_assembler_approver_releaser_separated",
      "professional_meaning_preserved",
      "missing_professional_content_not_fabricated",
      "approval_and_release_not_fabricated",
      "artifact_generation_remains_downstream",
    ]));
  });

  it("19. routes missing content, template conflicts, source conflicts, release and artifact work correctly", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "missing_substantive_professional_content", action: "return_professional_content_required_or_domain_owner_review_required" }),
      expect.objectContaining({ trigger: "template_unclear_conflicting_or_unfit", action: "return_template_clarification_required_and_route_to_template_or_document_control_owner" }),
      expect.objectContaining({ trigger: "professional_source_conflict", action: "preserve_source_findings_and_route_to_domain_owner_without_resolution" }),
      expect.objectContaining({ trigger: "controlled_publication_release_supersession_archive_or_owner_change_required", action: "require_controlled_publication_owner_or_document_control_owner_approval" }),
      expect.objectContaining({ trigger: "artifact_generation_or_storage_required", action: "handoff_to_existing_completed_work_template_artifact_export_infrastructure" }),
    ]));
  });

  it("20. keeps controlled publication approval separate from KDS assembly approval", () => {
    const approvalStates = approvalsFor();
    approvalStates.controlled_publication_owner = false;
    const result = validate({ approvalStates });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });
});
