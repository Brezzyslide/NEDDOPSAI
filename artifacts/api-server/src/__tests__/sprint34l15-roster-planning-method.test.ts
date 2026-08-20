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

const NOW = new Date("2026-08-19T00:00:00Z");
const ROSTER_PLANNING_CODE = "roster_planning";

function blueprintFromRegistry(code = ROSTER_PLANNING_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = ROSTER_PLANNING_CODE): BlueprintSection[] {
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
  id: "tpl-roster-planning",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "participant_workforce_roster_plan_template",
  title: "Participant & Workforce Roster Plan",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/participant-workforce-roster-plan.docx",
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
    mode: "planning",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified participant and service requirements, required shifts, shift structure, worker availability, leave, eligibility, compliance, credential, training, competency, continuity, preferences, existing allocation, conflicts, overlap checks, candidate allocation, coverage validation, suitability, fatigue concern, workforce rule dependency, cost interface, uncovered shifts, exceptions, approval status, publish readiness, provenance and unresolved gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l15",
    organisationId: "org-34l15",
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
      query: "roster planning service requirements availability competency coverage",
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
    artifactId: "artifact-34l15",
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

describe("Sprint 34L.15 roster planning method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for roster planning only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("rostering_owner", true);
    expect(blueprint.requiredApprovals).toHaveProperty("roster_publication_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(ROSTER_PLANNING_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Workforce Rostering Coordinator ownership and restrained support roles", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(ROSTER_PLANNING_CODE)!)).toBe("workforce_rostering_coordinator");
    expect(blueprint.primarySpecialist).toBe("workforce_rostering_coordinator");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "service_delivery_coordinator",
      "workforce_compliance_specialist",
      "operations_manager",
      "payroll_workforce_cost_officer",
      "people_culture_manager",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("operations_manager");
  });
});

describe("Sprint 34L.15 approved roster planning method representation", () => {
  it("3. binds the Participant & Workforce Roster Plan sequence", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "PLANNING_SCOPE",
      "SERVICE_REQUIREMENT_DISCOVERY",
      "REQUIRED_COVERAGE_AND_SHIFT_STRUCTURE",
      "PARTICIPANT_SPECIFIC_STAFFING_REQUIREMENTS",
      "WORKER_AVAILABILITY_AND_UNAVAILABILITY",
      "ELIGIBILITY_COMPLIANCE_AND_COMPETENCY_RETRIEVAL",
      "CONTINUITY_PREFERENCE_AND_EXISTING_ALLOCATION_REVIEW",
      "CANDIDATE_ALLOCATION_AND_CONSTRAINT_CHECKS",
      "COVERAGE_CONFLICT_AND_SUITABILITY_VALIDATION",
      "FATIGUE_WORKFORCE_RULE_AND_COST_INTERFACES",
      "GAPS_EXCEPTIONS_OPTIMISATION_AND_REBALANCE",
      "PROPOSED_ROSTER_AND_ALLOCATION_RATIONALE",
      "APPROVAL_AND_PUBLISH_READINESS",
    ]);
  });

  it("4. builds demand before allocation and refuses historical-roster demand invention", () => {
    expect(sectionByCode("SERVICE_REQUIREMENT_DISCOVERY").instructions).toContain("Do not invent shifts merely because historical rosters contain them");
    expect(sectionByCode("REQUIRED_COVERAGE_AND_SHIFT_STRUCTURE").instructions).toContain("Determine required coverage before allocation");
    expect(sectionByCode("REQUIRED_COVERAGE_AND_SHIFT_STRUCTURE").description).toContain("ratio");
    expect(sectionByCode("REQUIRED_COVERAGE_AND_SHIFT_STRUCTURE").description).toContain("required competency");
  });

  it("5. separates availability, suitability, rostered and covered states", () => {
    expect(sectionByCode("WORKER_AVAILABILITY_AND_UNAVAILABILITY").instructions).toContain("AVAILABLE does not automatically mean SUITABLE");
    expect(sectionByCode("CANDIDATE_ALLOCATION_AND_CONSTRAINT_CHECKS").instructions).toContain("SUITABLE does not automatically mean AVAILABLE");
    expect(sectionByCode("CANDIDATE_ALLOCATION_AND_CONSTRAINT_CHECKS").instructions).toContain("ROSTERED does not prove service coverage");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "available_suitable_rostered_covered_states_separated" }),
    ]));
  });

  it("6. keeps eligibility, competency, continuity and preference within authority", () => {
    expect(sectionByCode("ELIGIBILITY_COMPLIANCE_AND_COMPETENCY_RETRIEVAL").instructions).toContain("Do not independently certify credentials");
    expect(sectionByCode("CONTINUITY_PREFERENCE_AND_EXISTING_ALLOCATION_REVIEW").instructions).toContain("cannot override safety");
    expect(sectionByCode("PARTICIPANT_SPECIFIC_STAFFING_REQUIREMENTS").instructions).toContain("Do not invent participant preferences");
  });

  it("7. validates coverage honestly and routes fatigue/workforce dependencies", () => {
    expect(sectionByCode("COVERAGE_CONFLICT_AND_SUITABILITY_VALIDATION").description).toContain("coverage");
    expect(sectionByCode("COVERAGE_CONFLICT_AND_SUITABILITY_VALIDATION").instructions).toContain("PARTIALLY_COVERED");
    expect(sectionByCode("FATIGUE_WORKFORCE_RULE_AND_COST_INTERFACES").instructions).toContain("do not duplicate the full fatigue method");
    expect(sectionByCode("FATIGUE_WORKFORCE_RULE_AND_COST_INTERFACES").instructions).toContain("Do not hard-code SCHADS");
  });

  it("8. exposes uncovered shifts and protects publish-state boundaries", () => {
    expect(sectionByCode("GAPS_EXCEPTIONS_OPTIMISATION_AND_REBALANCE").instructions).toContain("Never hide an uncovered shift");
    expect(sectionByCode("GAPS_EXCEPTIONS_OPTIMISATION_AND_REBALANCE").instructions).toContain("STAFFING_CAPACITY_ESCALATION_REQUIRED");
    expect(sectionByCode("DOCUMENT_CONTROL").instructions).toContain("PROPOSED");
    expect(sectionByCode("DOCUMENT_CONTROL").instructions).toContain("PAID");
    expect(sectionByCode("APPROVAL_AND_PUBLISH_READINESS").instructions).toContain("do not fabricate approval or publish");
  });
});

describe("Sprint 34L.15 evidence, deliverable and completion gates", () => {
  it("9. requires service, availability, eligibility, competency and roster evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["service_requirement", "worker_availability", "credential_record", "training_record", "roster_schedule"],
      optionalEvidenceCategories: expect.arrayContaining([
        "participant_service_agreement",
        "support_schedule",
        "care_plan",
        "support_plan",
        "behaviour_support_plan",
        "leave_record",
        "worker_preference",
        "participant_preference",
        "competency_record",
        "previous_fatigue_concern",
        "rostering_fatigue_record",
        "payroll_record",
        "workforce_requirement",
        "previous_roster_exception",
      ]),
      requiredEntityTypes: ["worker"],
      minimumEvidenceCount: 5,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("10. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "service_requirement" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("11. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Participant & Workforce Roster Plan");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "participant_workforce_roster_plan",
      namingConvention: "PARTICIPANT_WORKFORCE_ROSTER_PLAN_{participant_or_site}_{period}",
      prohibitedDeliverables: expect.arrayContaining([
        "published_roster",
        "worked_roster",
        "timesheet_record",
        "paid_roster",
        "support_ratio_change",
        "credential_certification",
        "competency_certification",
        "final_schads_determination",
        "payroll_entitlement_calculation",
      ]),
    });
  });

  it("12. blocks completion when artifact, template or roster approvals are missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("13. passes runtime validation when required evidence, sections, artifact, template and approvals are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.15 authority boundaries", () => {
  it("14. KDS cannot rewrite roster planning conclusions", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "knowledge_documentation_specialist",
      workerProfile: profile("knowledge_documentation_specialist_profile"),
      actionIdentifier: "rewrite_professional_conclusion",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("15. WRC can draft roster plan but cannot publish or certify external determinations", () => {
    const wrc = profile("workforce_rostering_coordinator_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrc,
      actionIdentifier: "draft_roster_plan",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const publishDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrc,
      actionIdentifier: "publish_roster",
      actionType: "update_file",
      executionChannel: "calendar_system",
      toolCategory: "calendar_tools",
      connectorCategory: "calendar_system",
    });
    const credentialDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrc,
      actionIdentifier: "certify_worker_credential",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "data_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(publishDecision.decision).toBe("APPROVAL_REQUIRED");
    expect(credentialDecision.decision).toBe("PROHIBITED");
  });
});
