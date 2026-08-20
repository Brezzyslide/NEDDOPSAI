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
const ROSTER_FATIGUE_CODE = "rostering_fatigue_review";

function blueprintFromRegistry(code = ROSTER_FATIGUE_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = ROSTER_FATIGUE_CODE): BlueprintSection[] {
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
  id: "tpl-roster-fatigue",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "workforce_rostering_fatigue_risk_review_template",
  title: "Workforce Rostering & Fatigue Risk Review",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/workforce-rostering-fatigue-risk-review.docx",
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
    mode: "fatigue_review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified roster schedule, actual work/timesheet evidence, service requirements, scheduled vs actual variance, actual hours, rest and recovery, consecutive work, overnight work, breaks, travel, worker availability, fatigue indicators, incident association, workforce requirement interface, fatigue risk assessment, roster action, participant coverage, monitoring, effectiveness review and evidence gaps.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l14",
    organisationId: "org-34l14",
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
      query: "rostering fatigue actual work evidence",
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
    ...(contract.blueprint.evidenceContract?.requiredEntityTypes ?? []),
    ...(contract.blueprint.evidenceContract?.optionalEvidenceCategories ?? []),
    ...contract.sections.flatMap((section) => section.evidenceRequirements.requiredEvidenceCategories ?? []),
  ]));
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(),
    rawClaims: [],
    evidencePack: evidencePack(evidenceCategories),
    artifactId: "artifact-34l14",
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

describe("Sprint 34L.14 rostering fatigue review method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for rostering fatigue only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("rostering_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(ROSTER_FATIGUE_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves Workforce Rostering Coordinator ownership and restrained supports", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(ROSTER_FATIGUE_CODE)!)).toBe("workforce_rostering_coordinator");
    expect(blueprint.primarySpecialist).toBe("workforce_rostering_coordinator");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "payroll_workforce_cost_officer",
      "workforce_compliance_specialist",
      "service_delivery_coordinator",
      "operations_manager",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("payroll_workforce_cost_officer");
  });
});

describe("Sprint 34L.14 approved roster fatigue method representation", () => {
  it("3. binds the Workforce Rostering & Fatigue Risk Review structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_OUTCOME",
      "REVIEW_SCOPE_AND_CONTEXT",
      "PARTICIPANT_SERVICE_REQUIREMENTS",
      "SCHEDULED_ROSTER_RECONSTRUCTION",
      "ACTUAL_WORK_RECONSTRUCTION",
      "SCHEDULED_VS_ACTUAL_COMPARISON",
      "ACTUAL_HOURS_REST_AND_RECOVERY",
      "CONSECUTIVE_OVERNIGHT_BREAKS_AND_ADDITIONAL_WORK",
      "TRAVEL_TRANSITION_AVAILABILITY_AND_COMPETENCY_CONTEXT",
      "FATIGUE_INDICATORS_AND_INCIDENT_CORRELATION",
      "WORKFORCE_REQUIREMENT_INTERFACE",
      "FATIGUE_RISK_ASSESSMENT_AND_OUTCOME",
      "ROSTER_ACTIONS_AND_PARTICIPANT_COVERAGE",
      "MONITORING_EFFECTIVENESS_AND_PROFESSIONAL_CONCLUSION",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("review period");
    expect(sectionByCode("EXECUTIVE_OUTCOME").description).toContain("Overall roster/fatigue risk");
  });

  it("4. separates scheduled, actual, timesheeted and paid states", () => {
    const comparison = sectionByCode("SCHEDULED_VS_ACTUAL_COMPARISON");
    expect(comparison.description).toContain("scheduled, actual, variance and evidence");
    expect(comparison.instructions).toContain("SCHEDULED");
    expect(comparison.instructions).toContain("ACTUAL_HOURS_WORKED");
    expect(comparison.instructions).toContain("PAID");
    expect(blueprintFromRegistry().validationRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "scheduled_actual_timesheet_paid_states_separated" }),
    ]));
  });

  it("5. requires actual-work reconstruction before fatigue assessment", () => {
    expect(sectionByCode("ACTUAL_WORK_RECONSTRUCTION").instructions).toContain("Do not infer actual hours solely from scheduled hours");
    expect(sectionByCode("ACTUAL_HOURS_REST_AND_RECOVERY").instructions).toContain("previous actual finish to next actual start");
    expect(sectionByCode("CONSECUTIVE_OVERNIGHT_BREAKS_AND_ADDITIONAL_WORK").instructions).toContain("sleepover as restorative");
    expect(sectionByCode("WORKFORCE_REQUIREMENT_INTERFACE").instructions).toContain("Do not hard-code changing Award/legal rules");
  });

  it("6. preserves lateness, incident-correlation and participant-coverage boundaries", () => {
    expect(sectionByCode("FATIGUE_INDICATORS_AND_INCIDENT_CORRELATION").instructions).toContain("Late attendance does not automatically equal fatigue");
    expect(sectionByCode("FATIGUE_INDICATORS_AND_INCIDENT_CORRELATION").instructions).toContain("does not prove fatigue caused the incident");
    expect(sectionByCode("ROSTER_ACTIONS_AND_PARTICIPANT_COVERAGE").instructions).toContain("participant understaffing");
    expect(sectionByCode("ROSTER_ACTIONS_AND_PARTICIPANT_COVERAGE").instructions).toContain("STAFFING_CAPACITY_OPERATIONAL_ESCALATION_REQUIRED");
  });

  it("7. supports fatigue-risk outcomes and monitoring without legal conclusion", () => {
    expect(sectionByCode("FATIGUE_RISK_ASSESSMENT_AND_OUTCOME").description).toContain("roster adjustment recommended");
    expect(sectionByCode("FATIGUE_RISK_ASSESSMENT_AND_OUTCOME").description).toContain("high fatigue risk prompt action");
    expect(sectionByCode("FATIGUE_RISK_ASSESSMENT_AND_OUTCOME").description).toContain("workforce compliance review required");
    expect(sectionByCode("FATIGUE_RISK_ASSESSMENT_AND_OUTCOME").instructions).toContain("Do not create pseudo-scientific fatigue scores");
    expect(sectionByCode("MONITORING_EFFECTIVENESS_AND_PROFESSIONAL_CONCLUSION").instructions).toContain("Do not create excessive surveillance");
  });
});

describe("Sprint 34L.14 evidence, deliverable and completion gates", () => {
  it("8. requires roster, actual work and service requirement evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["roster_schedule", "timesheet", "service_requirement"],
      optionalEvidenceCategories: expect.arrayContaining([
        "roster_series",
        "shift_allocation",
        "attendance_record",
        "approved_overtime",
        "call_out_record",
        "sleepover_record",
        "active_night_record",
        "case_note",
        "hourly_observation",
        "participant_service_agreement",
        "worker_availability",
        "payroll_record",
        "employment_record",
        "previous_fatigue_concern",
        "incident_record",
        "worker_report",
      ]),
      requiredEntityTypes: ["worker"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("9. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "roster_schedule" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Workforce Rostering & Fatigue Risk Review");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "workforce_rostering_fatigue_risk_review",
      namingConvention: "ROSTER_FATIGUE_REVIEW_{scope}_{period}",
      prohibitedDeliverables: expect.arrayContaining([
        "final_schads_determination",
        "payroll_entitlement_calculation",
        "disciplinary_decision",
        "attendance_performance_finding",
        "roster_publication",
        "employment_law_determination",
      ]),
    });
  });

  it("11. blocks completion when artifact, template or rostering approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("12. passes runtime validation when required evidence, sections, artifact, template and approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.14 authority boundaries", () => {
  it("13. KDS cannot rewrite roster/fatigue conclusions", () => {
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

  it("14. WRC can draft fatigue review but cannot publish roster or make SCHADS/payroll determinations", () => {
    const wrc = profile("workforce_rostering_coordinator_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrc,
      actionIdentifier: "draft_roster_fatigue_review",
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
    const schadsDecision = evaluateWorkerProfileAuthority({
      specialistCode: "workforce_rostering_coordinator",
      workerProfile: wrc,
      actionIdentifier: "make_final_schads_determination",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(publishDecision.decision).toBe("APPROVAL_REQUIRED");
    expect(schadsDecision.decision).toBe("PROHIBITED");
  });
});
