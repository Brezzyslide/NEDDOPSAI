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
const REPORTABLE_INCIDENT_CODE = "reportable_incident_assessment";

function blueprintFromRegistry(code = REPORTABLE_INCIDENT_CODE): WorkBlueprint {
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

function sectionsFromRegistry(code = REPORTABLE_INCIDENT_CODE): BlueprintSection[] {
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
  id: "tpl-reportable-incident-assessment",
  organizationId: "org-1",
  ownerType: "organisation_owned",
  code: "reportable_incident_assessment_submission_readiness_report_template",
  title: "Reportable Incident Assessment & Submission Readiness Report",
  version: "1.0.0",
  status: "published",
  maturityState: "production_ready",
  templateType: "docx",
  sourceFileReference: "org://templates/reportable-incident-assessment-submission-readiness-report.docx",
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
    mode: "reportable",
  };
}

function contentFor(): string {
  return sectionsFromRegistry()
    .map((section) => `## ${section.sectionCode}
This section is populated with verified incident facts, participant evidence, current authority provenance, event time, awareness time, candidate reportability categories, threshold analysis, missing evidence, contradictory evidence, deadline calculation, internal reporting state, external submission state, submission readiness, safeguarding state, rationale and required next actions.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-34l9",
    organisationId: "org-34l9",
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
      query: "reportable incident assessment current authority evidence",
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
    artifactId: "artifact-34l9",
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

describe("Sprint 34L.9 reportable incident assessment method gate and ownership", () => {
  it("1. resolves the Product Owner method blocker for reportability only", () => {
    const blueprint = blueprintFromRegistry();
    expect(blueprint.maturityState).toBe("production_ready");
    expect(blueprint.requiredApprovals).not.toHaveProperty("human_professional_method_owner");
    expect(blueprint.requiredApprovals).toHaveProperty("incident_safeguarding_owner", true);
    expect(blueprint.requiredApprovals).toHaveProperty("external_submission_owner", true);
    expect(sectionsFromRegistry()[0]?.sectionCode).not.toBe("USER_DEFINITION_REQUIRED_METHOD");
    expect(methodPendingCodes()).not.toContain(REPORTABLE_INCIDENT_CODE);
    expect(methodPendingCodes()).toHaveLength(0);
  });

  it("2. preserves ISS ownership and supporting-specialist authority boundaries", () => {
    const blueprint = blueprintFromRegistry();
    expect(resolveRegistryProfessionalOwner(getRegistryEntry(REPORTABLE_INCIDENT_CODE)!)).toBe("incident_safeguarding_specialist");
    expect(blueprint.primarySpecialist).toBe("incident_safeguarding_specialist");
    expect(blueprint.supportingSpecialists).toEqual(expect.arrayContaining([
      "compliance_quality_manager",
      "service_delivery_coordinator",
      "authorised_program_officer",
      "behaviour_support_implementation_specialist",
      "knowledge_documentation_specialist",
    ]));
    expect(blueprint.primarySpecialist).not.toBe("knowledge_documentation_specialist");
  });
});

describe("Sprint 34L.9 approved reportability method representation", () => {
  it("3. binds the participant-specific submission-readiness report structure", () => {
    expect(sectionsFromRegistry().map((section) => section.sectionCode)).toEqual([
      "DOCUMENT_CONTROL",
      "EXECUTIVE_REPORTABILITY_OUTCOME",
      "MATERIAL_INCIDENT_FACTS_AND_SAFEGUARDING",
      "EVENT_AND_AWARENESS_TIME",
      "CURRENT_AUTHORITY_AND_CONTEXT",
      "POTENTIAL_REPORTING_CATEGORIES",
      "THRESHOLD_BY_THRESHOLD_ANALYSIS",
      "EVIDENCE_COMPLETENESS_AND_CONFLICTS",
      "REPORTABILITY_DECISION_STATE",
      "TIMEFRAME_DEADLINE_AND_DEADLINE_STATE",
      "INTERNAL_EXTERNAL_REPORTING_STATE",
      "SUBMISSION_READINESS",
      "SUBMISSION_SUPPORT_AND_AUTHORITY",
      "PARTICIPANT_IMPACT_AND_EXTERNAL_PARTIES",
      "RATIONALE_ACTIONS_AND_REASSESSMENT",
    ]);
    expect(sectionByCode("DOCUMENT_CONTROL").description).toContain("awareness date/time");
    expect(sectionByCode("EXECUTIVE_REPORTABILITY_OUTCOME").description).toContain("submission readiness");
  });

  it("4. requires current authority rather than hard-coded regulatory thresholds", () => {
    const authority = sectionByCode("CURRENT_AUTHORITY_AND_CONTEXT");
    expect(authority.description).toContain("Current authoritative external reporting framework");
    expect(authority.instructions).toContain("Do not permanently hard-code categories");
    expect(authority.instructions).toContain("Use existing current-authority retrieval");
    expect(authority.instructions).toContain("CURRENT_AUTHORITY_UNAVAILABLE");
  });

  it("5. separates event time, awareness time and deadline calculation", () => {
    expect(sectionByCode("EVENT_AND_AWARENESS_TIME").instructions).toContain("EVENT DATE/TIME and ORGANISATION AWARENESS DATE/TIME");
    expect(sectionByCode("EVENT_AND_AWARENESS_TIME").instructions).toContain("Do not assume event time equals awareness time");
    expect(sectionByCode("TIMEFRAME_DEADLINE_AND_DEADLINE_STATE").instructions).toContain("Do not permanently encode a specific number of hours or days");
    expect(sectionByCode("TIMEFRAME_DEADLINE_AND_DEADLINE_STATE").instructions).toContain("Use deterministic date/time calculation");
    expect(sectionByCode("TIMEFRAME_DEADLINE_AND_DEADLINE_STATE").instructions).toContain("DEADLINE_UNCLEAR");
  });

  it("6. tests every potentially relevant category threshold against evidence", () => {
    expect(sectionByCode("POTENTIAL_REPORTING_CATEGORIES").instructions).toContain("Do not stop at the first plausible category");
    const threshold = sectionByCode("THRESHOLD_BY_THRESHOLD_ANALYSIS");
    expect(threshold.description).toContain("Threshold element");
    expect(threshold.instructions).toContain("NOT_YET_SUBSTANTIATED is not automatically NOT_REPORTABLE");
    expect(threshold.instructions).toContain("SERIOUS_ALLEGATION is not automatically REPORTABLE");
    expect(threshold.instructions).toContain("CONFLICTING_EVIDENCE");
  });

  it("7. keeps reporting state, submission readiness and safeguarding separate", () => {
    expect(sectionByCode("INTERNAL_EXTERNAL_REPORTING_STATE").instructions).toContain("These states are not interchangeable");
    expect(sectionByCode("SUBMISSION_READINESS").instructions).toContain("READY_WITH_OUTSTANDING_FOLLOW_UP");
    expect(sectionByCode("SUBMISSION_SUPPORT_AND_AUTHORITY").instructions).toContain("must not automatically send or submit externally");
    expect(sectionByCode("PARTICIPANT_IMPACT_AND_EXTERNAL_PARTIES").instructions).toContain("do not infer reportability solely because police, ambulance or hospital were involved");
    expect(sectionByCode("REPORTABILITY_DECISION_STATE").instructions).toContain("Reportability and safeguarding remain separate");
  });
});

describe("Sprint 34L.9 evidence, deliverable and completion gates", () => {
  it("8. requires incident, participant and current authority evidence", () => {
    expect(blueprintFromRegistry().evidenceContract).toMatchObject({
      requiredEvidenceCategories: ["incident_record", "participant_record", "current_reportability_authority"],
      optionalEvidenceCategories: expect.arrayContaining([
        "incident_investigation",
        "incident_review_improvement",
        "participant_account",
        "restrictive_practice_record",
        "authorisation_record",
        "medication_record",
        "regulator_correspondence",
        "submission_record",
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
    expect(blueprint.primaryDeliverable).toBe("Reportable Incident Assessment & Submission Readiness Report");
    expect(blueprint.templateRequired).toBe(true);
    expect(blueprint.allowedOrgTemplateOverride).toBe(true);
    expect(blueprint.deliverableContract).toMatchObject({
      artifactRequired: true,
      primaryFormat: "docx",
      secondaryFormats: ["pdf"],
      templateRequired: true,
      primaryDeliverable: "reportable_incident_assessment_submission_readiness_report",
      namingConvention: "REPORTABLE_INCIDENT_ASSESSMENT_{participant}_{incident}_{date}",
      prohibitedDeliverables: expect.arrayContaining([
        "final_reportability_determination",
        "external_regulatory_submission",
        "regulator_communication",
        "legal_advice",
        "incident_investigation_report",
        "safeguarding_assessment",
      ]),
    });
  });

  it("11. blocks completion when artifact, template, ISS approval or external submission approval is missing", () => {
    expect(validate({ artifactId: null }).failures.some((failure) => failure.gate === "artifact_required")).toBe(true);
    expect(validate({
      contract: contractFor(null),
    }).failures.some((failure) => failure.gate === "template_required")).toBe(true);

    const approvalStates = approvalsFor();
    approvalStates.incident_safeguarding_owner = false;
    expect(validate({ approvalStates }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);

    const externalApprovalStates = approvalsFor();
    externalApprovalStates.external_submission_owner = false;
    expect(validate({ approvalStates: externalApprovalStates }).failures.some((failure) => failure.gate === "approval_required")).toBe(true);
  });

  it("12. passes runtime validation when required evidence, sections, artifact, template and approvals are present", () => {
    const result = validate();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("Sprint 34L.9 authority boundaries", () => {
  it("13. KDS cannot fabricate approval or submission success", () => {
    const decision = evaluateWorkerProfileAuthority({
      specialistCode: "knowledge_documentation_specialist",
      workerProfile: profile("knowledge_documentation_specialist_profile"),
      actionIdentifier: "fabricate_approval",
      actionType: "update_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
      approvalGranted: true,
    });

    expect(decision.decision).toBe("PROHIBITED");
  });

  it("14. ISS can draft readiness material but cannot submit externally", () => {
    const iss = profile("incident_safeguarding_specialist_profile");
    const draftDecision = evaluateWorkerProfileAuthority({
      specialistCode: "incident_safeguarding_specialist",
      workerProfile: iss,
      actionIdentifier: "draft_reportable_incident_readiness_report",
      actionType: "create_file",
      executionChannel: "document_store",
      toolCategory: "document_tools",
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
    expect(submitDecision.decision).toBe("PROHIBITED");
  });
});
