import { describe, expect, it } from "vitest";
import { getRegistryEntry } from "../services/blueprintRegistry";
import {
  classifyStandardTemplateEvidenceContext,
  validateBlueprintRuntimeCompletion,
} from "../services/blueprintRuntimeValidationService";
import {
  buildDeliverableOutputSchema,
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
  groupRequirementFailuresForRepair,
} from "../services/deliverableRequirementCoverageService";
import { evaluateEvidenceSufficiency } from "../services/evidenceSufficiencyService";
import {
  compileProfessionalExecutionContext,
  deriveDeliverableStandardisation,
  deriveProfessionalOperation,
} from "../services/professionalExecutionContextService";
import { validateWorkPackage } from "../services/workValidationService";
import type { EvidencePack } from "../services/knowledgeResolutionService";
import type { BlueprintExecutionContract, WorkBlueprint } from "../services/workBlueprintService";
import type { WorkPackageManifest } from "../services/workPackageService";

function manifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id: "manifest-sprint37",
    organizationId: "org-sprint37",
    completedWorkId: null,
    executionId: "execution-sprint37",
    taskId: "task-sprint37",
    blueprintId: "people_management_review",
    blueprintVersion: "1.0.0",
    canonicalIntent: "people.onboarding",
    blueprintFamily: "people_culture",
    blueprintMode: "onboarding",
    primarySpecialist: "people_culture_manager",
    supportingSpecialists: ["talent_learning_specialist"],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    taskUploads: [],
    entityKnowledge: {},
    exclusions: [],
    warnings: [],
    retrievalSummary: {
      requestedKnowledge: [],
      providedSources: 0,
      providedMemories: 0,
      providedUploads: 0,
      providedEntityKnowledge: 0,
      excludedSources: 0,
    },
    selectionMetadata: {
      canonicalIntent: "people.onboarding",
      blueprintFamily: "people_culture",
      blueprintMode: "onboarding",
      requestedDeliverableType: "WORKFORCE_ONBOARDING_CHECKLIST",
      deliverableStandardisation: "standard_reusable",
    },
    observability: {},
    status: "assembled",
    assembledAt: new Date("2026-08-27T00:00:00Z"),
    requesterId: "user-sprint37",
    createdAt: new Date("2026-08-27T00:00:00Z"),
    updatedAt: new Date("2026-08-27T00:00:00Z"),
    ...overrides,
  };
}

function emptyEvidencePack(): EvidencePack {
  return {
    executionId: "execution-sprint37",
    organisationId: "org-sprint37",
    resolvedAt: new Date("2026-08-27T00:00:00Z"),
    chunks: [],
    sourceIds: [],
    citationsByType: {},
    totalChunks: 0,
    avgConfidence: 0,
    retrievalMetrics: {
      queryCount: 1,
      totalCandidates: 0,
      selectedChunks: 0,
      cacheHit: false,
      retrievalMs: 10,
      embeddingUsed: false,
      embeddingMs: 0,
    },
  };
}

function contract(blueprint: WorkBlueprint, mode = "onboarding"): BlueprintExecutionContract {
  return {
    blueprint,
    sections: blueprint.sections,
    template: null,
    mode,
  };
}

function syntheticBlueprint(overrides: Partial<WorkBlueprint> = {}): WorkBlueprint {
  return {
    id: "blueprint-sprint37",
    organizationId: null,
    ownerType: "platform_owned",
    code: "sprint37_standard_template",
    title: "Sprint 37 Standard Template",
    version: "1.0.0",
    blueprintFamily: "people_culture",
    category: "workforce",
    purpose: "Validate Sprint 2 standard reusable evidence semantics.",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [],
    supportedModes: ["create", "review", "onboarding"],
    maturityState: "production_ready",
    primaryDeliverable: "Standard Template",
    deliverableContract: null,
    evidenceContract: null,
    permittedOrgOverrides: {},
    defaultTemplateId: null,
    templateRequired: false,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    status: "published",
    objective: "Validate standard reusable evidence semantics.",
    primarySpecialist: "people_culture_manager",
    supportingSpecialists: ["talent_learning_specialist"],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: [],
    outputTypes: ["workforce_onboarding_checklist"],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: true,
    isActive: true,
    sections: [],
    createdAt: new Date("2026-08-27T00:00:00Z"),
    updatedAt: new Date("2026-08-27T00:00:00Z"),
    ...overrides,
  };
}

describe("Sprint 37 professional generation evidence sufficiency", () => {
  it.each([
    "Can you give me a checklist for onboarding a new staff",
    "Give me a checklist for onboarding a new employee.",
    "I need an onboarding checklist for a support worker.",
    "Provide a standard staff induction checklist.",
  ])("treats natural checklist CREATE requests as standard reusable work: %s", (request) => {
    const evidenceContext = classifyStandardTemplateEvidenceContext(request);

    expect(deriveProfessionalOperation(request)).toBe("CREATE");
    expect(deriveDeliverableStandardisation(request)).toBe("standard_reusable");
    expect(evidenceContext).toMatchObject({
      standardTemplateRequested: true,
      existingTemplateRequested: false,
      participantSpecificRequested: false,
      customerExampleOptional: true,
    });
  });

  it("does not treat existing-document review as a standard reusable template", () => {
    const request = "Review this staff onboarding checklist for compliance.";

    expect(deriveProfessionalOperation(request)).toBe("REVIEW");
    expect(deriveDeliverableStandardisation(request)).not.toBe("standard_reusable");
    expect(classifyStandardTemplateEvidenceContext(request).customerExampleOptional).toBe(false);
  });

  it("allows standard reusable onboarding to proceed without organisation template or staff context", () => {
    const request = "Can you give me a checklist for onboarding a new staff";
    const blueprint = syntheticBlueprint({
      validationRules: [
        { rule: "template_present", required: true, description: "Organisation onboarding template must be present." },
        { rule: "staff_context_present", required: true, description: "Staff member context must be present." },
        { rule: "related_policy_present", required: true, description: "Related policy must be present." },
      ],
      requiredLibraryKnowledge: ["onboarding_template", "workforce_policy"],
    });

    const result = validateWorkPackage(
      manifest(),
      blueprint,
      emptyEvidencePack(),
      { standardTemplateEvidence: classifyStandardTemplateEvidenceContext(request) },
    );

    expect(result.passed).toBe(true);
    expect(result.recommendedAction).not.toBe("request_information");
    expect(result.missingItems).toEqual([]);
    expect(result.issues.filter((issue) => issue.level === "error")).toEqual([]);
    expect(result.issues.filter((issue) => issue.level === "info").map((issue) => issue.rule))
      .toEqual(expect.arrayContaining(["template_present", "staff_context_present", "related_policy_present"]));
  });

  it("still blocks review work when the reviewed document or organisation source is missing", () => {
    const request = "Review this staff onboarding checklist for compliance.";
    const blueprint = syntheticBlueprint({
      validationRules: [
        { rule: "template_present", required: true, description: "Source checklist/template must be present." },
      ],
    });

    const result = validateWorkPackage(
      manifest({ selectionMetadata: { requestedDeliverableType: "WORKFORCE_ONBOARDING_CHECKLIST_REVIEW" } }),
      blueprint,
      emptyEvidencePack(),
      { standardTemplateEvidence: classifyStandardTemplateEvidenceContext(request) },
    );

    expect(result.passed).toBe(false);
    expect(result.recommendedAction).toBe("request_information");
    expect(result.missingItems).toContain("Organisation Template");
  });

  it("keeps participant-specific work evidence-required when no participant evidence is retrieved", () => {
    const result = evaluateEvidenceSufficiency({
      userRequest: "Complete a participant risk assessment for John.",
      specialistCode: "risk_safety_specialist",
      blueprint: null,
      evidencePack: emptyEvidencePack(),
      standardTemplateEvidence: classifyStandardTemplateEvidenceContext("Complete a participant risk assessment for John."),
    });

    expect(result.status).toBe("SOURCE_NOT_AVAILABLE");
    expect(result.isEscalationRecommended).toBe(true);
  });

  it("classifies empty organisation context as sufficient only for standard reusable non-authority work", () => {
    const standard = evaluateEvidenceSufficiency({
      userRequest: "Can you give me a checklist for onboarding a new staff",
      specialistCode: "people_culture_manager",
      blueprint: null,
      evidencePack: emptyEvidencePack(),
      standardTemplateEvidence: classifyStandardTemplateEvidenceContext("Can you give me a checklist for onboarding a new staff"),
    });

    const legal = evaluateEvidenceSufficiency({
      userRequest: "Create a standard onboarding checklist covering statutory employment law requirements.",
      specialistCode: "people_culture_manager",
      blueprint: null,
      evidencePack: emptyEvidencePack(),
      standardTemplateEvidence: classifyStandardTemplateEvidenceContext("Create a standard onboarding checklist covering statutory employment law requirements."),
    });

    expect(standard.status).toBe("SUFFICIENT");
    expect(standard.reasons[0]?.code).toBe("STANDARD_REUSABLE_NO_ORG_CONTEXT");
    expect(legal.status).toBe("SOURCE_NOT_AVAILABLE");
  });

  it("suppresses platform template requirements only for standard reusable runtime validation", () => {
    const request = "Can you give me a checklist for onboarding a new staff";
    const blueprint = syntheticBlueprint({
      templateRequired: true,
      deliverableContract: {
        templateRequired: true,
        artifactRequired: false,
        defaultFileNamePattern: "ONBOARDING_CHECKLIST",
        outputFormat: "docx",
        namingConvention: "ONBOARDING_CHECKLIST",
        requiredSections: [],
        prohibitedDeliverables: [],
      } as never,
    });

    const standardGate = validateBlueprintRuntimeCompletion({
      contract: contract(blueprint),
      contentMarkdown: "# Staff Onboarding Checklist\n\n- Confirm role and start date.\n- Complete induction.",
      evidencePack: emptyEvidencePack(),
      standardTemplateEvidence: classifyStandardTemplateEvidenceContext(request),
      deferApprovalGate: true,
    });
    const reviewGate = validateBlueprintRuntimeCompletion({
      contract: contract(blueprint),
      contentMarkdown: "# Staff Onboarding Checklist Review\n\n- Review the supplied checklist.",
      evidencePack: emptyEvidencePack(),
      standardTemplateEvidence: classifyStandardTemplateEvidenceContext("Review this staff onboarding checklist."),
      deferApprovalGate: true,
    });

    expect(standardGate.failures.some((failure) => failure.gate === "template_required")).toBe(false);
    expect(reviewGate.failures.some((failure) => failure.gate === "template_required")).toBe(true);
  });

  it("derives onboarding deliverable schema from the current professional context without service-agreement fields", () => {
    const blueprint = getRegistryEntry("people_management_review");
    if (!blueprint) throw new Error("missing people_management_review blueprint");

    const context = compileProfessionalExecutionContext({
      userRequest: "Can you give me a checklist for onboarding a new staff",
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract(blueprint));
    const schema = buildDeliverableOutputSchema(profile);
    const schemaText = JSON.stringify(schema);

    expect(context.deliverable.standardisation).toBe("standard_reusable");
    expect(profile.requirements.length).toBeGreaterThanOrEqual(6);
    expect(schema.groups.length).toBeGreaterThan(0);
    expect(schemaText).toContain("screening");
    expect(schemaText).toContain("induction");
    expect(schemaText).not.toContain("PARTICIPANT_NAME");
    expect(schemaText).not.toContain("AGREEMENT_PERIOD");
    expect(schemaText).not.toContain("NDIS_NUMBER");
  });

  it("groups deficient onboarding requirements for targeted repair while preserving accepted content", () => {
    const blueprint = getRegistryEntry("people_management_review");
    if (!blueprint) throw new Error("missing people_management_review blueprint");

    const context = compileProfessionalExecutionContext({
      userRequest: "Can you give me a checklist for onboarding a new staff",
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract(blueprint));
    const weakChecklist = [
      "# Staff Onboarding Checklist",
      "",
      "## Role, Employment and Start Date",
      "- [ ] Record staff name, role, employment type, manager and start date.",
    ].join("\n");
    const report = evaluateDeliverableRequirementCoverage(weakChecklist, profile);
    const repairGroups = groupRequirementFailuresForRepair(profile, report.missing);

    expect(report.missing.length).toBeGreaterThan(0);
    expect(repairGroups.length).toBeGreaterThan(0);
    expect(repairGroups.flat().map((failure) => failure.requirementId))
      .toEqual(expect.arrayContaining(report.missing.map((failure) => failure.requirementId)));
  });
});
