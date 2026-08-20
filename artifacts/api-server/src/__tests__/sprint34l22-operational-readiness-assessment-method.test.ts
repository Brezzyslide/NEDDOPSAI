import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_REGISTRY,
  getRegistryEntry,
  resolveRegistryProfessionalOwner,
} from "../services/blueprintRegistry.js";
import { resolveIntent } from "../services/blueprintIntentMap.js";
import { enforceEvidenceContract } from "../services/blueprintContractService.js";
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

const NOW = new Date("2026-08-19T00:00:00Z");
const READINESS_CODE = "operational_readiness_assessment";

function blueprintFromRegistry(code = READINESS_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = READINESS_CODE): BlueprintSection[] {
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
  id: "tpl-operational-readiness",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "operational_readiness_template",
  title: "Operational Readiness Assessment",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/operational-readiness.docx",
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
    mode: "readiness",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with the proposed operation, preceding decision state, required operational readiness profile, source authority, participant/service readiness, plan readiness, workforce compliance, roster coverage, site and equipment readiness, systems access, commercial preconditions, staff briefing, cross-specialist findings, blocking gaps, conditions, improvement actions, commencement authority, reassessment triggers and evidence provenance.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l22",
    organisationId: "org-34l22",
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
      text: `${category} readiness evidence`,
      confidence: 1,
    })),
    entityFacts: {},
    memories: [],
    retrievalMeta: {
      query: "operational readiness evidence",
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

function profile(code: string) {
  const workerProfile = getWorkerProfileByCode(code);
  if (!workerProfile) throw new Error(`Missing worker profile: ${code}`);
  return workerProfile;
}

describe("Sprint 34L.22 operational readiness method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for operational readiness only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("operations_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(READINESS_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Operations Manager ownership with multidisciplinary support", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(READINESS_CODE)!)).toBe("operations_manager");
    expect(blueprint.primarySpecialist).toBe("operations_manager");
    expect(blueprint.supportingSpecialists).toEqual([
      "service_delivery_coordinator",
      "workforce_compliance_specialist",
      "workforce_rostering_coordinator",
      "talent_learning_specialist",
      "compliance_quality_manager",
      "incident_safeguarding_specialist",
      "behaviour_support_implementation_specialist",
      "authorised_program_officer",
      "process_asset_coordinator",
      "finance_officer",
      "knowledge_documentation_specialist",
    ]);
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });

  it("3. remains deterministically routed by operations.readiness", () => {
    expect(resolveIntent("operations.readiness")).toMatchObject({ code: READINESS_CODE });
  });
});

describe("Sprint 34L.22 approved operational readiness method representation", () => {
  it("4. binds the approved readiness-profile-first sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "READINESS_DECISION",
      "SCOPE_AND_PROPOSED_OPERATION",
      "PRECEDING_DECISION_STATE",
      "REQUIRED_OPERATIONAL_READINESS_PROFILE",
      "EVIDENCE_REVIEWED_AUTHORITY_AND_CURRENTNESS",
      "PARTICIPANT_SERVICE_READINESS",
      "PLAN_AND_PROFESSIONAL_DOCUMENTATION_READINESS",
      "WORKFORCE_COMPLIANCE_AND_COMPETENCY",
      "ROSTER_STAFFING_AND_FATIGUE_READINESS",
      "SITE_ENVIRONMENT_AND_EQUIPMENT_READINESS",
      "SYSTEMS_INFORMATION_AND_ACCESS_READINESS",
      "COMMERCIAL_FUNDING_AND_SERVICE_PRECONDITIONS",
      "STAFF_BRIEFING_HANDOVER_AND_IMPLEMENTATION",
      "CROSS_SPECIALIST_FINDINGS_AND_NON_OVERRIDE",
      "GAPS_ACTIONS_AND_ESCALATIONS",
      "APPROVAL_COMMENCEMENT_AUTHORITY_AND_LIMITS",
      "REASSESSMENT_TRIGGERS_AND_PROVENANCE",
    ]);
  });

  it("5. requires the Required Operational Readiness Profile before gap assessment", () => {
    expect(sectionByCode("REQUIRED_OPERATIONAL_READINESS_PROFILE").description).toContain("organisation requirements");
    expect(sectionByCode("REQUIRED_OPERATIONAL_READINESS_PROFILE").instructions).toContain("before assessing current state");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "required_operational_readiness_profile_before_gap_assessment" }),
    ]));
  });

  it("6. preserves the future service-capacity boundary", () => {
    expect(sectionByCode("PRECEDING_DECISION_STATE").instructions).toContain("future service_capacity_assessment");
    expect(sectionByCode("REASSESSMENT_TRIGGERS_AND_PROVENANCE").instructions).toContain("Future service_capacity_assessment remains a separate Blueprint requirement");
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toContain("service_capacity_assessment");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "service_capacity_boundary_preserved" }),
    ]));
  });

  it("7. preserves non-override boundaries for domain blocks", () => {
    expect(sectionByCode("CROSS_SPECIALIST_FINDINGS_AND_NON_OVERRIDE").instructions).toContain("must not override");
    expect(sectionByCode("WORKFORCE_COMPLIANCE_AND_COMPETENCY").instructions).toContain("AVAILABLE, COMPLIANT, COMPETENT, AUTHORISED, ROSTERED");
    expect(sectionByCode("ROSTER_STAFFING_AND_FATIGUE_READINESS").instructions).toContain("WORKFORCE_NOT_DEPLOYMENT_READY");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "domain_blocks_cannot_be_overridden_by_operations" }),
    ]));
  });

  it("8. distinguishes plan, system, briefing and commencement states", () => {
    expect(sectionByCode("PLAN_AND_PROFESSIONAL_DOCUMENTATION_READINESS").instructions).toContain("PLAN REQUIRED");
    expect(sectionByCode("SYSTEMS_INFORMATION_AND_ACCESS_READINESS").instructions).toContain("SYSTEM EXISTS");
    expect(sectionByCode("STAFF_BRIEFING_HANDOVER_AND_IMPLEMENTATION").instructions).toContain("WORKER BRIEFED");
    expect(sectionByCode("APPROVAL_COMMENCEMENT_AUTHORITY_AND_LIMITS").instructions).toContain("READY is not AUTHORISED_TO_COMMENCE");
  });
});

describe("Sprint 34L.22 evidence, deliverable and authority boundaries", () => {
  it("9. requires service, operational, controlled-document and approval evidence", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    expect(contract.requiredEvidenceCategories).toEqual([
      "service_requirement",
      "operational_record",
      "controlled_document",
      "approval_record",
    ]);
    expect(contract.optionalEvidenceCategories).toEqual(expect.arrayContaining([
      "service_acceptance_decision",
      "participant_record",
      "workforce_compliance_record",
      "roster_schedule",
      "staff_briefing_record",
      "system_access_record",
      "service_agreement",
      "current_authority",
    ]));
    expect(contract.freshnessRules).toMatchObject({
      currentnessRequired: true,
      documentPresenceDoesNotProveOperationalReadiness: true,
      planExistsDoesNotProveOperationalised: true,
      currentAuthorityRequiredForChangingExternalObligations: true,
    });
  });

  it("10. keeps memory-only and user-assertion-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "service_requirement" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. blocks completion when required readiness evidence is missing", () => {
    const result = validate({ evidencePack: evidencePack(["service_requirement", "operational_record"]) });
    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(true);
  });

  it("12. remains structured analysis and does not become an artifact renderer", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: false,
      primaryFormat: "structured_analysis",
      templateRequired: false,
    });
    expect(blueprint.templateRequired).toBe(false);
    expect(validate({ contract: contractFor(null) }).failures.some((failure) => failure.gate === "template_required")).toBe(false);
  });

  it("13. prohibits go-live, resource, service-commitment and domain-owner deliverables", () => {
    expect(blueprintFromRegistry().deliverableContract?.prohibitedDeliverables).toEqual(expect.arrayContaining([
      "go_live_approval",
      "resource_allocation_approval",
      "service_commitment_approval",
      "participant_service_acceptance_decision",
      "business_continuity_plan",
      "workforce_compliance_assessment",
      "roster_plan",
      "clinical_determination",
      "restrictive_practice_authorisation",
    ]));
  });

  it("14. routes unresolved domain blocks to existing Blueprints or specialists", () => {
    expect(blueprintFromRegistry().escalationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ trigger: "workforce_not_deployment_ready", action: "defer_to_workforce_compliance_assessment" }),
      expect.objectContaining({ trigger: "suitable_roster_coverage_missing", action: "defer_to_roster_planning_or_workforce_rostering_coordinator" }),
      expect.objectContaining({ trigger: "capability_or_participant_specific_competency_gap", action: "defer_to_learning_capability_development_plan" }),
      expect.objectContaining({ trigger: "restrictive_practice_authority_unresolved", action: "defer_to_authorised_program_officer" }),
    ]));
  });

  it("15. KDS support does not transfer professional readiness ownership", () => {
    const kds = profile("knowledge_documentation_specialist_profile");
    expect(blueprintFromRegistry().supportingSpecialists).toContain("knowledge_documentation_specialist");
    expect(blueprintFromRegistry().primarySpecialist).toBe("operations_manager");
    expect(kds.prohibitedActions).toContain("rewrite_professional_conclusion");
  });
});
