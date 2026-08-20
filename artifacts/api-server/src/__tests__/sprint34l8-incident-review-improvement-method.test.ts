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
const INCIDENT_REVIEW_CODE = "incident_review_improvement";

function blueprintFromRegistry(code = INCIDENT_REVIEW_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = INCIDENT_REVIEW_CODE): BlueprintSection[] {
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
  id: "tpl-incident-review-improvement",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "participant_incident_review_improvement_report_template",
  title: "Participant Incident Review & Improvement Report",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/participant-incident-review-improvement-report.docx",
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
    mode: "review",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified incident evidence, participant impact, participant voice, response adequacy, what worked, improvement gaps, recurrence, pattern analysis, contributing factors, plan reconciliation, risk reassessment, lessons learned, action owners, due dates, effectiveness measures, escalation state and unresolved matters.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l8",
    organisationId: "org-34l8",
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
      query: "participant incident review improvement evidence",
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
    artifactId: "artifact-34l8",
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

describe("Sprint 34L.8 incident review improvement method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for incident review only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("incident_safeguarding_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(INCIDENT_REVIEW_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves ISS ownership and supporting-specialist authority boundaries", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(INCIDENT_REVIEW_CODE)!)).toBe("incident_safeguarding_specialist");
    expect(blueprint.primarySpecialist).toBe("incident_safeguarding_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "service_delivery_coordinator",
      "compliance_quality_manager",
      "behaviour_support_implementation_specialist",
      "authorised_program_officer",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.8 approved incident review improvement method representation", () => {
  it("3. binds the participant-specific review report structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_REVIEW_OUTCOME",
      "INCIDENT_CONTEXT",
      "PARTICIPANT_IMPACT_AND_VOICE",
      "IMMEDIATE_RESPONSE_AND_ADEQUACY",
      "WHAT_WORKED_AND_CONTROLS_TO_PRESERVE",
      "IMPROVEMENT_GAPS_AND_NON_COMPLIANCE_DISTINCTION",
      "PREVIOUS_INCIDENTS_PATTERN_AND_RECURRENCE",
      "CONTRIBUTING_FACTORS",
      "PLAN_BSP_RISK_RECONCILIATION",
      "STAFF_PRACTICE_AND_SYSTEM_IMPACT",
      "RISK_REASSESSMENT",
      "LESSONS_LEARNED",
      "IMPROVEMENT_ACTIONS_AND_EFFECTIVENESS",
      "PROFESSIONAL_CONCLUSION_AND_CLOSURE_STATE",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("incident reference");
    expect(sectionByCode("EXECUTIVE_REVIEW_OUTCOME").description).toContain("response adequacy");
  });

  it("4. preserves related Blueprint boundaries", () => {
    const summary = sectionByCode("EXECUTIVE_REVIEW_OUTCOME");
    expect(summary.instructions).toContain("incident investigation");
    expect(summary.instructions).toContain("reportability assessment");
    expect(summary.instructions).toContain("safeguarding assessment");
    expect(summary.instructions).toContain("formal CAPA");
    const context = sectionByCode("INCIDENT_CONTEXT");
    expect(context.instructions).toContain("Reuse verified investigation findings");
    expect(context.instructions).toContain("not substantiated into did not happen");
  });

  it("5. requires participant impact, voice and response adequacy analysis", () => {
    const participant = sectionByCode("PARTICIPANT_IMPACT_AND_VOICE");
    expect(participant.description).toContain("participant account");
    expect(participant.description).toContain("communication assistance");
    expect(participant.instructions).toContain("Do not invent impact or participant voice");
    expect(sectionByCode("IMMEDIATE_RESPONSE_AND_ADEQUACY").instructions).toContain("what should have happened");
    expect(sectionByCode("IMMEDIATE_RESPONSE_AND_ADEQUACY").instructions).toContain("consequence of any gap");
  });

  it("6. searches for what worked as well as improvement gaps", () => {
    expect(sectionByCode("WHAT_WORKED_AND_CONTROLS_TO_PRESERVE").instructions).toContain("Do not make the review search only for failure");
    expect(sectionByCode("WHAT_WORKED_AND_CONTROLS_TO_PRESERVE").description).toContain("preserved or standardised");
    expect(sectionByCode("IMPROVEMENT_GAPS_AND_NON_COMPLIANCE_DISTINCTION").instructions).toContain("Keep non-compliance separate from compliant but improvable practice");
  });

  it("7. separates patterns, causes, risk changes, lessons and action effectiveness", () => {
    expect(sectionByCode("PREVIOUS_INCIDENTS_PATTERN_AND_RECURRENCE").instructions).toContain("Distinguish pattern from cause");
    expect(sectionByCode("CONTRIBUTING_FACTORS").instructions).toContain("without performing a full formal RCA");
    expect(sectionByCode("RISK_REASSESSMENT").instructions).toContain("risk increased");
    expect(sectionByCode("LESSONS_LEARNED").instructions).toContain("Avoid generic statements");
    expect(sectionByCode("IMPROVEMENT_ACTIONS_AND_EFFECTIVENESS").instructions).toContain("Completion of an action does not prove effectiveness");
    expect(sectionByCode("IMPROVEMENT_ACTIONS_AND_EFFECTIVENESS").instructions).toContain("Do not duplicate formal CAPA");
  });
});

describe("Sprint 34L.8 evidence, deliverable and completion gates", () => {
  it("8. requires participant-specific incident and participant evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["incident_record", "participant_record"],
      optionalEvidenceCategories: expect.arrayContaining([
        "completed_incident_investigation",
        "participant_account",
        "case_note",
        "medication_record",
        "restrictive_practice_record",
        "behaviour_support_plan",
        "previous_incident_record",
        "risk_register",
        "continuous_improvement_register",
        "implementation_evidence",
      ]),
      requiredEntityTypes: ["incident", "participant"],
      minimumEvidenceCount: 4,
      missingEvidenceBehaviour: "block_completion",
      claimIntegrityRequired: true,
    });
  });

  it("9. keeps memory-only evidence restricted", () => {
    const contract = blueprintFromRegistry().evidenceContract!;
    const result = enforceEvidenceContract(contract as never, { chunks: [{ sourceType: "memory_only", category: "incident" }] });
    expect(result.passed).toBe(false);
    expect(result.violations.some((violation) => violation.code === "RESTRICTED_SOURCE_TYPE_PRESENT")).toBe(true);
  });

  it("10. binds the existing DOCX/PDF artifact architecture", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.primaryDeliverable).toBe("Participant Incident Review & Improvement Report");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "participant_incident_review_improvement_report",
      namingConvention: "INCIDENT_REVIEW_IMPROVEMENT_{participant}_{incident}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "incident_investigation_report",
        "reportable_incident_assessment",
        "safeguarding_assessment",
        "standalone_capa_deliverable",
        "incident_closure",
        "regulatory_submission",
      ]),
    });
  });

  it("11. blocks completion when artifact, template or ISS approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(validate({ approvalStates: approvalsFor(false) }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("12. passes runtime validation when required evidence, sections, artifact, template and ISS approval are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.8 authority boundaries", () => {
  it("13. KDS cannot rewrite professional conclusions", () => {
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

  it("14. ISS can draft the review but cannot close serious incidents or submit externally", () => {
    const iss = profile("incident_safeguarding_specialist_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "draft_incident_review_improvement_report",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
    });
    const closeDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "close_serious_incident",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });
    const submitDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "submit_regulatory_notification",
      actionType: "update_file",
      executionChannel: "internal_api",
      toolCategory: "form_tools",
      approvalGranted: true,
    });

    expect(draftDecision.decision).toBe("PERMITTED");
    expect(closeDecision.decision).toBe("PROHIBITED");
    expect(submitDecision.decision).toBe("PROHIBITED");
  });
});
