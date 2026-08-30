import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_REGISTRY, getRegistryEntry, getRegistryBlueprintReadinessState } from "../services/blueprintRegistry";
import { resolveIntent } from "../services/blueprintIntentMap";
import {
  compileProfessionalExecutionContext,
  buildProfessionalExecutionContextBlock,
  deriveDeliverableStandardisation,
  derivePlaceholderTokensFromTemplateField,
  deriveProfessionalIntentKey,
  deriveProfessionalOperation,
} from "../services/professionalExecutionContextService";
import {
  auditBlueprintRequirementCompatibility,
  buildDeliverableOutputSchema,
  buildRequirementToDeliverablePlan,
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
  formatRequirementCoveragePrompt,
  groupRequirementFailuresForRepair,
  validateDeliverableRequirementCoverage,
} from "../services/deliverableRequirementCoverageService";
import { validateBlueprintRuntimeCompletion } from "../services/blueprintRuntimeValidationService";
import type { BlueprintExecutionContract } from "../services/workBlueprintService";
import type { WorkPackageManifest } from "../services/workPackageService";
import {
  assembleDeterministicTemplateDeliverableSections,
  assembleDeliverableMarkdownFromSections,
  mergeDeliverableSectionDeltas,
  parseSpecialistJsonOutput,
} from "../services/claimValidationService";
import { planTask } from "../services/chiefOfStaffService";
import { buildAuthoritativeTaskProposalPresentation } from "../services/taskProposalWorkforcePresentationService";
import { validateWorkPackage } from "../services/workValidationService";

const root = resolve(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function manifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id: "manifest-professional-context",
    organizationId: "org-professional-context",
    completedWorkId: null,
    executionId: "execution-professional-context",
    taskId: "task-professional-context",
    blueprintId: "service_agreement_review",
    blueprintVersion: "1.0.0",
    canonicalIntent: "agreements.create",
    blueprintFamily: "agreements",
    blueprintMode: "create",
    primarySpecialist: "policy_governance_specialist",
    supportingSpecialists: ["compliance_quality_manager", "knowledge_documentation_specialist"],
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
    selectionMetadata: {},
    observability: {},
    status: "assembled",
    assembledAt: new Date("2026-08-26T00:00:00Z"),
    createdAt: new Date("2026-08-26T00:00:00Z"),
    updatedAt: new Date("2026-08-26T00:00:00Z"),
    ...overrides,
  };
}

function serviceAgreementContract(): BlueprintExecutionContract {
  const blueprint = getRegistryEntry("service_agreement_review");
  if (!blueprint) throw new Error("missing service agreement blueprint");
  return {
    blueprint,
    sections: blueprint.sections,
    template: null,
    mode: "create",
  };
}

function keywordCandidatesForTest(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/& -]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .filter((word) => !["contains", "template", "provisions", "professional"].includes(word));
}

function coveredServiceAgreementMarkdown(options: {
  omitServicePeriod?: boolean;
  totalMode?: "line_and_agreement" | "line_only";
  shallowClauses?: boolean;
  selfAssertionOnly?: boolean;
} = {}): string {
  const headers = [
    "Support/service",
    "NDIS support item/code",
    "Description",
    "Unit/basis",
    "Quantity/frequency/hours/weeks",
    "Unit price/rate",
    ...(options.omitServicePeriod ? [] : ["Service period"]),
    options.totalMode === "line_only" ? "Total/Subtotal" : "Subtotal / line total",
    ...(options.totalMode === "line_only" ? [] : ["Agreement period total amount"]),
  ];
  const row = [
    "[SUPPORT_NAME]",
    "[SUPPORT_ITEM_CODE]",
    "[SUPPORT_DESCRIPTION]",
    "[UNIT_BASIS]",
    "[QUANTITY_FREQUENCY]",
    "[UNIT_PRICE]",
    ...(options.omitServicePeriod ? [] : ["[SERVICE_PERIOD]"]),
    "[LINE_TOTAL]",
    ...(options.totalMode === "line_only" ? [] : ["[AGREEMENT_PERIOD_TOTAL]"]),
  ];
  const shallow = [
    "## Delivery of Supports",
    "Delivery of supports is covered.",
    "## Provider Responsibilities",
    "Provider responsibilities are addressed.",
    "## Participant and Representative Responsibilities",
    "Participant responsibilities are included.",
    "## Rights, Privacy, Complaints and Advocacy",
    options.selfAssertionOnly ? "All rights, privacy, complaints and advocacy clauses are covered." : "Privacy is addressed.",
    "## Payment, Pricing, GST and Non-NDIS Costs",
    "Pricing and changes are represented.",
    "## Cancellation, No-show and Rescheduling",
    "Cancellation is included.",
    "## Variation and Change",
    "Variation is covered.",
    "## Termination, Exit and Transition",
    "Termination is addressed.",
    "## Continuity, Emergency and Disaster",
    "Continuity and emergency arrangements are represented.",
  ];
  const substantive = [
    "## Delivery of Supports",
    "The provider must deliver the agreed supports safely, respectfully and within its stated operational capability. The provider will notify the participant of material interruptions, coordinate alternate arrangements where reasonable, and record escalations when delivery risks affect continuity.",
    "## Provider Responsibilities",
    "The provider is responsible for safe service delivery, accurate records, clear billing explanations, privacy protection, complaints handling, continuity planning and escalation of critical risks. The provider must not promise supports outside its capability or the agreed Schedule of Supports.",
    "## Participant and Representative Responsibilities",
    "The participant or authorised representative must communicate relevant needs, preferences and changes, keep contact and NDIS plan information current, give reasonable notice for cancellations or changes, engage respectfully with workers, and pay agreed non-NDIS expenses where applicable.",
    "## Rights, Privacy, Complaints and Advocacy",
    "The participant retains choice, control, privacy, confidentiality and advocacy rights. The provider must explain how feedback, complaints and disputes can be raised, how the provider will respond or escalate the pathway, and that advocacy or complaints will not reduce participant choice.",
    "## Payment, Pricing, GST and Non-NDIS Costs",
    "Payment and pricing must follow the agreed schedule and applicable pricing authority where relevant. The clause explains billing, GST or non-NDIS cost treatment, price change notice, participant agreement requirements and how changed prices take effect.",
    "## Cancellation, No-show and Rescheduling",
    "The agreement must explain participant cancellation, provider cancellation, no-show and rescheduling notice expectations. It must also describe emergency circumstances, late-notice treatment and how cancelled or changed supports affect billing and scheduling.",
    "## Variation and Change",
    "Changes to services, prices, funding, the support schedule or agreement terms require notice, consent where required, an effective date and document-control records. Material variations should be confirmed by signature or equivalent written acceptance.",
    "## Termination, Exit and Transition",
    "Termination and exit provisions must explain notice, participant choice, transition support, final invoices, records, handover and final obligations. The provider should support continuity during transition and avoid abrupt exit except where safety or authority requires it.",
    "## Continuity, Emergency and Disaster",
    "Continuity, emergency and disaster arrangements must explain temporary disruption, alternate support arrangements, communication responsibilities, escalation steps and post-event review where applicable. The template should make clear which arrangements are activated by the provider and participant.",
  ];

  return [
    "# NDIS Service Agreement Template",
    "## Agreement Parties and Period",
    "Provider: [PROVIDER_NAME]. ABN: [PROVIDER_ABN]. Participant: [PARTICIPANT_NAME]. Representative authority: [REPRESENTATIVE_AUTHORITY]. Agreement period: [AGREEMENT_PERIOD].",
    "## NDIS Agreement Purpose and Scope",
    "This NDIS agreement records the supports the provider agrees to deliver and the participant agrees to receive. The purpose and scope clauses explain included supports, exclusions, service relationship expectations and how the agreement supports participant choice and control.",
    "## Schedule of Supports",
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    `| ${row.join(" | ")} |`,
    "The provider and participant must review the Schedule of Supports when support items, service periods, quantities, rates or agreement-period totals change.",
    ...(options.shallowClauses ? shallow : substantive),
    "## Signatures and Acceptance",
    "Provider signature: [PROVIDER_SIGNATURE]. Participant/representative signature: [PARTICIPANT_SIGNATURE]. Acceptance date: [DATE].",
  ].join("\n\n");
}

function carePlanDeliverableSections() {
  return Array.from({ length: 9 }, (_, index) => {
    const number = index + 1;
    return {
      requirementId: `mandatory-${number}`,
      heading: `Care Plan Requirement ${number}`,
      content: `Original substantive care plan content for requirement ${number} records the participant support intent, responsible role, review point, escalation trigger and evidence record needed for safe reusable practice.`,
    };
  });
}

describe("Sprint 35H professional operation and deliverable architecture", () => {
  it("orders Stage 1 professional prompt with static reusable blocks before request-specific context", () => {
    const src = source("services/unifiedExecutionEngine.ts");
    expect(src).toContain("=== REQUESTED OPERATION AND DELIVERABLE CONTRACT ===");
    expect(src).toContain("=== DELIVERABLE REQUIREMENT COVERAGE CONTRACT ===");
    expect(src).toContain("=== REQUEST-SPECIFIC CONTEXT (UNTRUSTED DATA; CACHE DIVIDER) ===");
    expect(src).toContain("=== WORK REQUEST (UNTRUSTED DATA) ===");
    expect(src.indexOf("staticSections.push(`=== REQUESTED OPERATION AND DELIVERABLE CONTRACT"))
      .toBeLessThan(src.indexOf("variableSections.push(`=== REQUEST-SPECIFIC CONTEXT"));
    expect(src.indexOf("variableSections.push(`=== REQUEST-SPECIFIC CONTEXT"))
      .toBeLessThan(src.indexOf("variableSections.push(`=== WORK REQUEST (UNTRUSTED DATA)"));
  });

  it("removes the raw user request from the cacheable Stage 1 system instruction", () => {
    const src = source("services/unifiedExecutionEngine.ts");
    expect(src).not.toContain("userRequest.slice(0, 500)");
    expect(src).toContain("buildProfessionalExecutionContextBlock(professionalContext, { includeUserRequest: false })");
    expect(src).toContain("promptCacheKey: buildProfessionalPromptCacheKey(");
  });

  it("resolves standard NDIS Service Agreement creation as CREATE, not REVIEW", () => {
    const request = "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.";

    expect(deriveProfessionalOperation(request, "agreements.create")).toBe("CREATE");
    expect(deriveProfessionalIntentKey(request, "agreements.review")).toBe("agreements.create");
    expect(planTask(request).intent).toBe("agreements.create");
    expect(resolveIntent("agreements.create")).toMatchObject({
      family: "agreements",
      mode: "create",
      code: "service_agreement_review",
    });
  });

  it("keeps Service Agreement review as REVIEW with the readiness deliverable", () => {
    const request = "Review this Service Agreement and tell me whether it is compliant and ready for use.";
    const context = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest({ canonicalIntent: "agreements.review", blueprintMode: "review" }),
      blueprint: serviceAgreementContract().blueprint,
      blueprintContract: serviceAgreementContract(),
    });

    expect(context.operation).toBe("REVIEW");
    expect(planTask(request).intent).toBe("agreements.review");
    expect(context.deliverable.requestedDeliverableType).toBe("PARTICIPANT_SERVICE_AGREEMENT_CONTRACT_READINESS_ASSESSMENT");
    expect(context.professionalMethodRole).toBe("requested_deliverable_structure");
  });

  it("builds an explicit user-facing deliverable contract for Service Agreement CREATE", () => {
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: serviceAgreementContract().blueprint,
      blueprintContract: serviceAgreementContract(),
    });

    expect(context.operation).toBe("CREATE");
    expect(context.deliverable.requestedDeliverableType).toBe("STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT");
    expect(context.professionalDomain).toBe("agreements");
    expect(context.specificity).toBe("STANDARD_NON_PARTICIPANT_SPECIFIC");
    expect(context.outputDepth.expectedDepth).toBe("comprehensive");
    expect(context.deliverable.audience).toContain("NDIS provider");
    expect(context.deliverable.allowedFactualPlaceholders).toContain("[PARTICIPANT_NAME]");
    expect(context.deliverable.mandatoryProfessionalContent).toEqual(expect.arrayContaining([
      "Provider responsibilities",
      "Privacy and confidentiality",
      "Cancellations, notice and no-show terms",
      "Termination, exit and transition provisions",
    ]));
    expect(context.professionalMethodRole).toBe("internal_method_only");
  });

  it("can omit the user request from the reusable professional context block", () => {
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard reusable NDIS care plan template.",
      manifest: manifest({ canonicalIntent: "care_plan.create", blueprintFamily: "participant_support", blueprintMode: "create" }),
      blueprint: getRegistryEntry("care_plan") ?? null,
      blueprintContract: null,
    });

    const withRequest = buildProfessionalExecutionContextBlock(context);
    const withoutRequest = buildProfessionalExecutionContextBlock(context, { includeUserRequest: false });

    expect(withRequest).toContain("USER_REQUEST: Create a standard reusable NDIS care plan template.");
    expect(withoutRequest).not.toContain("USER_REQUEST:");
    expect(withoutRequest).toContain("OPERATION: CREATE");
    expect(withoutRequest).toContain("DELIVERABLE_TYPE: STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE");
  });

  it("separates professional_work from deliverable content in the model response parser", () => {
    const parsed = parseSpecialistJsonOutput(JSON.stringify({
      professional_work: { blueprint_completion: ["Provider Responsibilities Review"] },
      deliverable: {
        type: "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT",
        sections: [
          {
            requirementId: "provider-responsibilities",
            heading: "Provider Responsibilities",
            content: "Provider responsibilities are fully drafted.",
          },
        ],
        assembledMarkdown: "# NDIS Service Agreement\n\n## Provider Responsibilities\n\nProvider responsibilities are fully drafted.",
      },
      completion: { unresolvedProfessionalContent: 0, methodologyLeakage: false, readyForCompletedWork: true },
      claims: [],
    }));

    expect(parsed.content).toContain("## Provider Responsibilities");
    expect(parsed.content).not.toContain("Provider Responsibilities Review");
    expect(parsed.content).not.toContain("NDIS Service Agreement");
    expect(parsed.professionalWork).toBeTruthy();
    expect(parsed.deliverable).toBeTruthy();
    expect(parsed.deliverableSections).toEqual([
      {
        requirementId: "provider-responsibilities",
        heading: "Provider Responsibilities",
        content: "Provider responsibilities are fully drafted.",
      },
    ]);
  });

  it("parses model-supplied requirement coverage as structured professional output", () => {
    const parsed = parseSpecialistJsonOutput(JSON.stringify({
      professional_work: { summary: "Professional findings completed." },
      requirement_coverage: {
        satisfied: ["service-agreement-parties"],
        missing: [],
      },
      deliverable: { content: "# Agreement\n\nDrafted content." },
      completion: { readyForCompletedWork: true },
      claims: [],
    }));

    expect(parsed.requirementCoverage).toEqual({
      satisfied: ["service-agreement-parties"],
      missing: [],
    });
  });

  it("makes Blueprint sections internal method checks for CREATE prompts", () => {
    const src = source("services/unifiedExecutionEngine.ts");
    const contextService = source("services/professionalExecutionContextService.ts");

    expect(contextService).toContain("PROFESSIONAL EXECUTION CONTEXT");
    expect(src).toContain("professional_work");
    expect(src).toContain("deliverable.sections[]");
    expect(src).toContain("The server assembles the final artifact markdown from deliverable.sections[] only");
    expect(src).toContain("Do not return assembledMarkdown");
    expect(src).toContain("buildProfessionalDeliverableResponseSchema");
    expect(src).toContain("responseSchema: buildProfessionalDeliverableResponseSchema");
    expect(src).toContain("deriveOutputTypeForProfessionalContext");
    expect(src).toContain("deliverableType.toLowerCase()");
    expect(contextService).toContain("STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT");
    expect(src).toContain("completedWork.title");
    expect(src).toContain("INTERNAL PROFESSIONAL METHOD CHECKLIST (DO NOT COPY AS DELIVERABLE HEADINGS)");
    expect(src).toContain("shouldRunCanonicalFinalDeliverableSynthesis");
    expect(src).toContain('professionalContext.operation === "CREATE"');
    expect(src).toContain("requiresCanonicalFinalDeliverablePayload");
    expect(src).toContain("Canonical final synthesis response did not include deliverable.sections[]");
    expect(src).toContain("REQUIRED USER-FACING DELIVERABLE CONTENT");
    expect(src).toContain("professionalContext.deliverable.mandatoryProfessionalContent");
    expect(src).not.toContain("=== STRUCTURED BLUEPRINT SECTIONS ===");
  });

  it("threads canonical operation intent from task planning into execution", () => {
    const coordinator = source("services/executionCoordinatorService.ts");

    expect(coordinator).toContain("getTaskPlan");
    expect(coordinator).toContain("deriveProfessionalIntentKey(userRequest, plan?.intent ?? null)");
    expect(coordinator).toContain("canonicalIntent,");
  });

  it("proves generic operation separation beyond Service Agreements", () => {
    expect(deriveProfessionalIntentKey("Create an incident investigation report", "incident.review")).toBe("incident.investigation");
    expect(deriveProfessionalIntentKey("Review this incident investigation", "incident.review")).toBe("incident.review");
    expect(deriveProfessionalIntentKey("Create a standard risk template", "risk.review")).toBe("risk.create");
    expect(deriveProfessionalIntentKey("Complete this participant risk assessment", "risk.review")).toBe("risk.assessment");
    expect(deriveProfessionalIntentKey("Create a medication policy", "policy.review")).toBe("policy.create");
    expect(deriveProfessionalIntentKey("Review this medication policy", "policy.create")).toBe("policy.review");
  });

  it("routes standard Care Plan template creation to service delivery, not compliance audit readiness", () => {
    const request = "Create a standard comprehensive NDIS care plan template covering all professionally relevant areas.";
    const plan = planTask(request);

    expect(deriveProfessionalOperation(request, "compliance.audit_readiness")).toBe("CREATE");
    expect(deriveProfessionalIntentKey(request, "compliance.audit_readiness")).toBe("care_plan.create");
    expect(deriveDeliverableStandardisation(request)).toBe("standard_reusable");
    expect(plan.intent).toBe("care_plan.create");
    expect(plan.primarySpecialist).toBe("service_delivery_coordinator");
    expect(plan.assignedSpecialists).toContain("chief_of_staff");
    expect(plan.assignedSpecialists).toContain("service_delivery_coordinator");
    expect(plan.assignedSpecialists).not.toContain("compliance_quality_manager");
    expect(plan.requiresApproval).toBe(false);
    expect(resolveIntent("care_plan.create")).toMatchObject({
      family: "care_plan",
      mode: "create",
      code: "care_plan",
    });
  });

  it("routes generic individual support plan intents to care_plan while keeping SIL support plan standalone", () => {
    expect(resolveIntent("support_plan.create")).toMatchObject({
      family: "care_plan",
      mode: "create",
      code: "care_plan",
    });
    expect(resolveIntent("support_plan.review")).toMatchObject({
      family: "care_plan",
      mode: "review",
      code: "care_plan",
    });
    expect(resolveIntent("support_plan.sil.create")).toMatchObject({
      family: "support_plan",
      mode: "create",
      code: "sil_support_plan",
    });
  });

  it("preserves the original CREATE operation when CoS paraphrases the outcome as ready for use", () => {
    const sourceUserRequest = "Create a standard comprehensive NDIS care plan template covering all professionally relevant areas.";
    const paraphrasedDescription = [
      "Develop a comprehensive NDIS care plan template for standard use.",
      "Requested outcome: A standard care plan template ready for use in NDIS service delivery.",
    ].join("\n\n");

    expect(planTask("Create Standard Comprehensive NDIS Care Plan Template", paraphrasedDescription).intent).toBe("care_plan.review");
    expect(planTask("Create Standard Comprehensive NDIS Care Plan Template", paraphrasedDescription, sourceUserRequest).intent).toBe("care_plan.create");

    const proposal = buildAuthoritativeTaskProposalPresentation({
      conversationMode: "task_intent",
      confidence: 0.94,
      proposedTask: {
        title: "Create Standard Comprehensive NDIS Care Plan Template",
        summary: "Develop a comprehensive NDIS care plan template for standard use.",
        priority: "normal",
        requestedOutcome: "A standard care plan template ready for use in NDIS service delivery.",
        knownConstraints: [],
        sourceUserRequest,
      },
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      relatedWorkforceRoles: [],
      customerResponse: "",
    }, sourceUserRequest);

    expect(proposal?.workforce.intent).toBe("care_plan.create");
    expect(proposal?.workforce.primaryProfessionalOwner).toBe("service_delivery_coordinator");
  });

  it("audits all canonical Blueprints for generic operation/deliverable/evidence compatibility", () => {
    const exceptions: Array<{ code: string; reason: string }> = [];
    const coverageExceptions: Array<{ code: string; reason: string }> = [];

    for (const entry of BLUEPRINT_REGISTRY) {
      if (!entry.code) exceptions.push({ code: entry.code, reason: "missing_code" });
      if (!entry.blueprintFamily) exceptions.push({ code: entry.code, reason: "missing_professional_domain" });
      if (!entry.futureOwnerRoleCode) exceptions.push({ code: entry.code, reason: "missing_primary_specialist" });
      if (!Array.isArray(entry.outputTypes) || entry.outputTypes.length === 0) {
        exceptions.push({ code: entry.code, reason: "missing_deliverable_contract" });
      }
      if (!Array.isArray(entry.sections) || entry.sections.length === 0) {
        exceptions.push({ code: entry.code, reason: "missing_professional_method" });
      }
      if (getRegistryBlueprintReadinessState(entry) !== "professionally_authored") {
        exceptions.push({ code: entry.code, reason: "not_professionally_authored" });
      }

      const audit = auditBlueprintRequirementCompatibility({
        blueprint: entry as any,
        sections: entry.sections as any,
        template: null,
        mode: entry.supportedModes[0] ?? "create",
      });
      if (!audit.compatible) {
        coverageExceptions.push(...audit.exceptions.map((reason) => ({ code: entry.code, reason })));
      }
      expect(audit.classificationCounts.INTERNAL_METHODOLOGY +
        audit.classificationCounts.EVIDENCE_REQUIREMENT +
        audit.classificationCounts.QUALITY_CONTROL +
        audit.classificationCounts.MUST_BE_REPRESENTED +
        audit.classificationCounts.CONDITIONAL +
        audit.classificationCounts.FACTUAL_FIELD +
        audit.classificationCounts.OPTIONAL_ENRICHMENT).toBe(entry.sections.length);
    }

    const engine = source("services/professionalExecutionContextService.ts");
    const validator = source("services/workValidationService.ts");
    const runner = source("services/unifiedExecutionEngine.ts");
    const coverage = source("services/deliverableRequirementCoverageService.ts");

    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(exceptions).toEqual([]);
    expect(coverageExceptions).toEqual([]);
    expect(engine).toContain("deriveProfessionalOperation");
    expect(engine).toContain("deriveDeliverableStandardisation");
    expect(engine).toContain("requestedDeliverableType");
    expect(engine).toContain("mandatoryProfessionalContent");
    expect(coverage).toContain("MANDATORY DELIVERABLE REQUIREMENT COVERAGE");
    expect(coverage).toContain("buildRequirementToDeliverablePlan");
    expect(coverage).toContain("evaluateDeliverableRequirementCoverage");
    expect(coverage).toContain("MUST_BE_REPRESENTED");
    expect(coverage).toContain("FACTUAL_FIELD");
    expect(coverage).toContain("CONDITIONAL");
    expect(source("services/blueprintRuntimeValidationService.ts")).toContain("mandatory_deliverable_coverage");
    expect(validator).toContain("isStandardReusableTemplate");
    expect(validator).toContain("participant_context_present");
    expect(runner).toContain("INTERNAL PROFESSIONAL METHOD CHECKLIST (DO NOT COPY AS DELIVERABLE HEADINGS)");
    expect(runner).toContain("REQUIRED USER-FACING DELIVERABLE CONTENT");
  });

  it("blocks Service Agreement CREATE when Schedule of Supports substantive fields are omitted", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const weakAgreement = coveredServiceAgreementMarkdown({ omitServicePeriod: true, totalMode: "line_only" })
      .replace(/\n\n\| Support\/service \| NDIS support item\/code \| Description \| Unit\/basis \| Quantity\/frequency\/hours\/weeks \| Unit price\/rate \| Total\/Subtotal \|\n\n\| --- \| --- \| --- \| --- \| --- \| --- \| --- \|\n\n\| \[SUPPORT_NAME\] \| \[SUPPORT_ITEM_CODE\] \| \[SUPPORT_DESCRIPTION\] \| \[UNIT_BASIS\] \| \[QUANTITY_FREQUENCY\] \| \[UNIT_PRICE\] \| \[LINE_TOTAL\] \|/m, "\n\nThe agreement includes a support schedule section for agreed supports, but this defective draft does not include the required professional schedule columns. This prose is intentionally long enough to prove the coverage gate catches the omission rather than the earlier incomplete-section guard.");

    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const failures = validateDeliverableRequirementCoverage(weakAgreement, profile);
    const report = evaluateDeliverableRequirementCoverage(weakAgreement, profile);

    expect(failures.map((failure) => failure.requirementId)).toEqual(expect.arrayContaining([
      "support-item-code-field",
      "support-unit-basis-field",
      "support-quantity-frequency-field",
      "support-unit-price-field",
      "support-service-period-field",
      "support-total-field",
    ]));
    expect(report.mandatoryRequirementCount).toBe(20);
    expect(report.satisfiedCount).toBe(12);
    expect(report.missingCount).toBe(8);
    expect(report.coveragePercentage).toBe(60);
    expect(report.missing.map((failure) => failure.requirementId)).toEqual(expect.arrayContaining([
      "support-item-code-field",
      "support-unit-basis-field",
      "support-quantity-frequency-field",
      "support-unit-price-field",
      "support-service-period-field",
      "support-total-field",
    ]));
    expect(report.missing.find((failure) => failure.requirementId === "support-item-code-field")?.requiredDeliverableRepresentation)
      .toBe("Schedule column for NDIS support item/code");

    const gate = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown: weakAgreement,
      rawClaims: [],
      evidencePack: null,
      artifactId: "__artifact_generation_pending__",
      deferApprovalGate: true,
      standardTemplateEvidence: {
        standardTemplateRequested: true,
        existingTemplateRequested: false,
        participantSpecificRequested: false,
        organisationSpecificRequested: false,
        customerExampleOptional: true,
      },
      professionalContext: context,
    });

    expect(gate.passed).toBe(false);
    expect(gate.failures.some((failure) => failure.gate === "mandatory_deliverable_coverage")).toBe(true);
    expect(gate.failures.some((failure) => failure.gate === "professional_placeholder")).toBe(true);
    expect(gate.failures.some((failure) => failure.gate === "methodology_leak")).toBe(false);
  });

  it("builds an internal requirement-to-deliverable plan rather than exposing Blueprint methodology", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const plan = buildRequirementToDeliverablePlan(profile);

    expect(plan).toHaveLength(20);
    expect(plan.find((item) => item.requirementId === "support-item-code-field")).toMatchObject({
      classification: "FACTUAL_FIELD",
      expectedUserFacingRepresentation: "Schedule column for NDIS support item/code",
      targetDeliverableLocation: "Schedule of Supports table/fields",
      applicability: "applicable",
    });
  });

  it("derives an explicit output schema for every mandatory Service Agreement requirement", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const schema = buildDeliverableOutputSchema(profile);
    const schemaIds = schema.groups.flatMap((group) => group.fields.map((field) => field.requirementId));

    expect(schemaIds).toHaveLength(20);
    expect(new Set(schemaIds).size).toBe(20);
    const supportScheduleGroup = schema.groups.find((group) => group.groupKey === "support-schedule-and-pricing");
    expect(supportScheduleGroup).toMatchObject({
      targetSection: "Schedule of Supports and Pricing Structure",
      sectionType: "table",
      generationInstruction: expect.stringContaining("support-service-period-field"),
    });
    expect(supportScheduleGroup?.fields)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          requirementId: "support-service-period-field",
          classification: "FACTUAL_FIELD",
          representationKind: "table_column",
          fieldLabel: "Service Period",
          requiredRepresentation: "Schedule column for service period",
          minimumSubstance: expect.arrayContaining([
            expect.stringContaining("labelled fillable field"),
          ]),
        }),
        expect.objectContaining({
          requirementId: "support-total-field",
          representationKind: "calculation_total",
          minimumSubstance: expect.arrayContaining([
            expect.stringContaining("distinct line subtotal"),
          ]),
        }),
      ]));
  });

  it("groups broad Service Agreement misses into logical repair sections instead of one vague repair batch", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const report = evaluateDeliverableRequirementCoverage(
      "## NDIS Service Agreement\n\n## Schedule of Supports\n| Support | Unit Price / Rate |\n| --- | --- |\n| [SUPPORT] | [PRICE] |\n\n## Complaints\nParticipants can complain.",
      profile,
    );
    const groups = groupRequirementFailuresForRepair(profile, report.missing);
    const groupedIds = groups.map((group) => group.map((failure) => failure.requirementId));

    expect(report.missingCount).toBeGreaterThan(5);
    expect(groupedIds).toContainEqual(expect.arrayContaining([
      "support-total-field",
      "support-service-period-field",
    ]));
    expect(groupedIds).toContainEqual(expect.arrayContaining([
      "provider-responsibilities",
      "participant-responsibilities",
    ]));
    expect(groupedIds).toContainEqual(expect.arrayContaining([
      "rights-privacy-complaints-advocacy",
    ]));
    expect(groups.length).toBeGreaterThan(1);
  });

  it("treats an omitted FACTUAL_FIELD as missing even when every other Service Agreement requirement is present", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const agreementMissingOneField = coveredServiceAgreementMarkdown({ omitServicePeriod: true });

    const report = evaluateDeliverableRequirementCoverage(
      agreementMissingOneField,
      deriveDeliverableRequirementCoverageProfile(context, contract),
    );

    expect(report.mandatoryRequirementCount).toBe(20);
    expect(report.satisfiedCount).toBe(19);
    expect(report.missingCount).toBe(1);
    expect(report.coveragePercentage).toBe(95);
    expect(report.missing).toEqual([
      expect.objectContaining({
        requirementId: "support-service-period-field",
        classification: "FACTUAL_FIELD",
        requiredDeliverableRepresentation: "Schedule column for service period",
      }),
    ]);
  });

  it("moves coverage from 19/20 to 20/20 when targeted repair adds only the missing factual field", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const missingServicePeriod = coveredServiceAgreementMarkdown({ omitServicePeriod: true });
    const repaired = missingServicePeriod
      .replace(
        "| Support/service | NDIS support item/code | Description | Unit/basis | Quantity/frequency/hours/weeks | Unit price/rate | Subtotal / line total | Agreement period total amount |",
        "| Support/service | NDIS support item/code | Description | Unit/basis | Quantity/frequency/hours/weeks | Unit price/rate | Service period | Subtotal / line total | Agreement period total amount |",
      )
      .replace(
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      )
      .replace(
        "| [SUPPORT_NAME] | [SUPPORT_ITEM_CODE] | [SUPPORT_DESCRIPTION] | [UNIT_BASIS] | [QUANTITY_FREQUENCY] | [UNIT_PRICE] | [LINE_TOTAL] | [AGREEMENT_PERIOD_TOTAL] |",
        "| [SUPPORT_NAME] | [SUPPORT_ITEM_CODE] | [SUPPORT_DESCRIPTION] | [UNIT_BASIS] | [QUANTITY_FREQUENCY] | [UNIT_PRICE] | [SERVICE_PERIOD] | [LINE_TOTAL] | [AGREEMENT_PERIOD_TOTAL] |",
      );

    const before = evaluateDeliverableRequirementCoverage(missingServicePeriod, profile);
    const after = evaluateDeliverableRequirementCoverage(repaired, profile);

    expect(before.missing.map((failure) => failure.requirementId)).toEqual(["support-service-period-field"]);
    expect(after.missing).toEqual([]);
    expect(after.satisfiedCount).toBe(20);
    expect(repaired).toContain("Provider: [PROVIDER_NAME]");
    expect(repaired).toContain("Participant: [PARTICIPANT_NAME]");
    expect((repaired.match(/Service period/g) ?? [])).toHaveLength(1);
  });

  it("uses the same coverage schema mechanism for non-document structured deliverables", () => {
    const profile = {
      deliverableType: "XLSX_RISK_REGISTER",
      operation: "CREATE" as const,
      standardisation: "standard_reusable" as const,
      requirements: [
        {
          id: "risk-id-column",
          description: "Risk register contains risk ID column.",
          classification: "FACTUAL_FIELD" as const,
          professionalRationale: "Structured outputs must preserve required fields.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Worksheet column for risk ID",
          coverageRules: [{ allOf: ["risk id"] }],
        },
        {
          id: "risk-rating-column",
          description: "Risk register contains risk rating column.",
          classification: "FACTUAL_FIELD" as const,
          professionalRationale: "Structured outputs must preserve required fields.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Worksheet column for risk rating",
          coverageRules: [{ allOf: ["risk rating"] }],
        },
      ],
    };

    const schema = buildDeliverableOutputSchema(profile);
    const before = evaluateDeliverableRequirementCoverage("| Risk ID | Risk description |", profile);
    const after = evaluateDeliverableRequirementCoverage("| Risk ID | Risk description | Risk rating |", profile);

    expect(schema.groups.flatMap((group) => group.fields.map((field) => field.requirementId))).toEqual([
      "risk-id-column",
      "risk-rating-column",
    ]);
    expect(before.missing.map((failure) => failure.requirementId)).toEqual(["risk-rating-column"]);
    expect(after.missing).toEqual([]);
  });

  it("persists professional provenance through existing execution events and manifest observability", () => {
    const runner = source("services/unifiedExecutionEngine.ts");
    const manifestSchema = source("../../../lib/db/src/schema/workPackageManifests.ts");

    expect(runner).toContain("executionEventsTable");
    expect(runner).toContain("executionSessionsTable");
    expect(runner).toContain("persistInlineExecutionSession");
    expect(runner).toContain('runtimeName: "aws_native"');
    expect(runner).toContain("eventType: `professional.${input.stage}`");
    expect(runner).toContain('"primary_draft"');
    expect(runner).toContain('"final_synthesis_candidate"');
    expect(runner).toContain('"targeted_repair_candidate"');
    expect(runner).toContain('"gate_failure"');
    expect(runner).toContain("contentHash");
    expect(runner).toContain("coverageSnapshot");
    expect(runner).toContain("modelTelemetry");
    expect(runner).toContain("finishReason");
    expect(manifestSchema).toContain("professionalContext?");
    expect(manifestSchema).toContain("requirementPlan?");
    expect(manifestSchema).toContain("deliverableOutputSchema?");
    expect(runner).not.toContain("professionalWorkSnapshots");
  });

  it("keeps targeted coverage repair separate from broad self-review", () => {
    const runner = source("services/unifiedExecutionEngine.ts");
    const review = source("services/selfReviewService.ts");

    expect(runner).toContain("repairMissingDeliverableRequirements");
    expect(runner).toContain("repairedRequirementIds");
    expect(runner).toContain("disableAutoRevision: true");
    expect(runner).toContain("Targeted requirement repair");
    expect(runner).toContain("## DEFICIENT DELIVERABLE SECTION(S)");
    expect(runner).toContain("currentDeliverable.deficientSections");
    expect(runner).toContain("evidencePack.relevantChunks");
    expect(runner).toContain("buildRelevantRepairEvidenceSection");
    expect(runner).toContain("failure_reason");
    expect(runner).not.toContain("actual_location");
    expect(runner).not.toContain("structural_result");
    expect(runner).not.toContain("substantive_result");
    expect(runner).toContain("Repair only the missing requirement IDs listed above");
    expect(review).toContain("disableAutoRevision");
  });

  it("gives self-review the requirement plan, failed requirements and deliverable contract", () => {
    const runner = source("services/unifiedExecutionEngine.ts");
    const review = source("services/selfReviewService.ts");

    expect(runner).toContain("requirementPlan,");
    expect(runner).toContain("failedRequirements: toReviewFailedRequirements");
    expect(runner).toContain("deliverableContract: blueprint?.deliverableContract ?? null");
    expect(review).toContain("## Requirement Plan");
    expect(review).toContain("## Specific Failed Requirements");
    expect(review).toContain("## Deliverable Contract");
    expect(review).toContain("## Full Deliverable Under Review");
    expect(review).toContain("Requirement plan supplied:");
    expect(review).toContain("completion gate reported unsatisfied requirements");
  });

  it("self-review rejects a worse automatic revision candidate", () => {
    const review = source("services/selfReviewService.ts");

    expect(review).toContain("candidateScore >= qualityScore");
    expect(review).toContain("Auto-revision rejected because score would fall");
    expect(review).toContain("retained prior draft");
  });

  it("accepts Service Agreement coverage when mandatory clauses and factual Schedule fields are represented", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const coveredAgreement = coveredServiceAgreementMarkdown();

    const failures = validateDeliverableRequirementCoverage(
      coveredAgreement,
      deriveDeliverableRequirementCoverageProfile(context, contract),
    );

    expect(failures).toEqual([]);
  });

  it("rejects keyword-only factual fields, collapsed totals and self-asserted clause coverage", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const report = evaluateDeliverableRequirementCoverage(coveredServiceAgreementMarkdown({
      totalMode: "line_only",
      shallowClauses: true,
      selfAssertionOnly: true,
    }), profile);
    const byId = new Map(report.requirementResults.map((item) => [item.requirementId, item]));

    expect(byId.get("support-unit-price-field")).toMatchObject({
      structuralResult: "STRUCTURE_PASS",
      finalResult: "SATISFIED",
      actualLocation: expect.stringContaining("Unit price/rate"),
    });
    expect(byId.get("support-total-field")).toMatchObject({
      structuralResult: "STRUCTURE_PARTIAL",
      finalResult: "PARTIAL",
      failureReason: expect.stringContaining("line subtotal from agreement-period"),
    });
    expect(byId.get("rights-privacy-complaints-advocacy")).toMatchObject({
      structuralResult: "STRUCTURE_PASS",
      substantiveResult: "SUBSTANTIVE_FAIL",
      finalResult: "PARTIAL",
    });
    expect(report.missing.map((failure) => failure.requirementId)).toEqual(expect.arrayContaining([
      "support-total-field",
      "rights-privacy-complaints-advocacy",
      "provider-responsibilities",
    ]));
  });

  it("does not let pricing prose satisfy a required Unit Price / Rate structure", () => {
    const profile = {
      deliverableType: "XLSX_PRICING_TEMPLATE",
      operation: "CREATE" as const,
      standardisation: "standard_reusable" as const,
      requirements: [
        {
          id: "unit-price-column",
          description: "Template contains a unit price/rate field.",
          classification: "FACTUAL_FIELD" as const,
          professionalRationale: "Structured outputs must preserve pricing fields.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Worksheet column for Unit Price / Rate",
          coverageRules: [{ allOf: ["unit", "price"] }, { allOf: ["rate"] }],
        },
      ],
    };

    const proseOnly = evaluateDeliverableRequirementCoverage(
      "## Pricing\n\nPricing will be reviewed before each service starts.",
      profile,
    );
    const structured = evaluateDeliverableRequirementCoverage(
      "| Support | Unit Price / Rate |\n| --- | --- |\n| [SUPPORT] | [PRICE] |",
      profile,
    );

    expect(proseOnly.missing[0]).toMatchObject({
      requirementId: "unit-price-column",
      structuralResult: "STRUCTURE_FAIL",
      finalResult: "NOT_SATISFIED",
    });
    expect(structured.missing).toEqual([]);
  });

  it("applies structural and substantive coverage rules across representative professional outputs", () => {
    const cases = [
      {
        name: "Care Plan",
        requirement: "Care plan contains participant goals, support domains and review/sign-off provisions.",
        representation: "Substantive care plan goals, support domains and review provisions",
        good: "## Care Plan Goals and Supports\n\nThe participant goals, support domains, daily living preferences and communication needs must be recorded with provider responsibilities, escalation pathways, review dates, consent and sign-off provisions so the plan can be used safely.",
        bad: "## Care Plan Goals and Supports\n\nAll care plan areas are covered.",
        rules: ["participant", "goals", "support"],
      },
      {
        name: "Risk Assessment",
        requirement: "Risk assessment contains hazard, likelihood, consequence, controls and residual rating columns.",
        representation: "Risk matrix table with required risk fields",
        good: "| Hazard | Likelihood | Consequence | Controls | Residual rating |\n| --- | --- | --- | --- | --- |\n| [HAZARD] | [LIKELIHOOD] | [CONSEQUENCE] | [CONTROLS] | [RATING] |",
        bad: "## Risk Assessment\n\nLikelihood and consequence are addressed in the risk approach.",
        factual: true,
        columns: ["hazard", "likelihood", "consequence", "controls", "residual rating"],
      },
      {
        name: "Restrictive Practice",
        requirement: "Restrictive practice template contains authorisation, consent, monitoring and reduction provisions.",
        representation: "Substantive restrictive practice authorisation and monitoring provisions",
        good: "## Restrictive Practice Authorisation and Monitoring\n\nThe template must record authorisation status, consent, monitoring responsibilities, review dates, reporting expectations and reduction or elimination actions. The provider must escalate expired or missing authority before implementation.",
        bad: "## Restrictive Practice\n\nAuthorisation and monitoring are included.",
        rules: ["authorisation", "monitoring", "consent"],
      },
      {
        name: "Incident Investigation",
        requirement: "Incident investigation contains incident details, chronology, immediate response, findings and corrective actions.",
        representation: "Substantive incident investigation report provisions",
        good: "## Incident Investigation Findings and Actions\n\nThe report must record incident details, chronology, immediate response, evidence reviewed, findings, participant impact, corrective actions, action owners, due dates and escalation or notification requirements where applicable.",
        bad: "## Incident Investigation\n\nFindings and actions are covered.",
        rules: ["incident", "findings", "actions"],
      },
      {
        name: "Policy",
        requirement: "Policy contains purpose, scope, responsibilities, procedure, review and approval controls.",
        representation: "Substantive policy clauses and governance controls",
        good: "## Policy Purpose, Scope and Controls\n\nThe policy must define purpose, scope, provider responsibilities, participant safeguards, operating procedure, exceptions, records, review cycle and approval controls so staff know what must happen and when escalation is required.",
        bad: "## Policy\n\nPurpose, scope and responsibilities are addressed.",
        rules: ["purpose", "scope", "responsibilities"],
      },
      {
        name: "XLSX",
        requirement: "Workbook contains action owner, due date and status columns.",
        representation: "Worksheet columns for action owner, due date and status",
        good: "| Action owner | Due date | Status |\n| --- | --- | --- |\n| [OWNER] | [DATE] | [STATUS] |",
        bad: "## Workbook\n\nAction owners, due dates and status are discussed.",
        factual: true,
        columns: ["action owner", "due date", "status"],
      },
    ];

    for (const entry of cases) {
      const profile = {
        deliverableType: entry.name.toUpperCase().replace(/\s+/g, "_"),
        operation: "CREATE" as const,
        standardisation: "standard_reusable" as const,
        requirements: [
          {
            id: `${entry.name.toLowerCase().replace(/\s+/g, "-")}-requirement`,
            description: entry.requirement,
            classification: entry.factual ? "FACTUAL_FIELD" as const : "MUST_BE_REPRESENTED" as const,
            professionalRationale: "Representative generic professional output must be validated by requirement type.",
            evidenceAuthority: [],
            requiredDeliverableRepresentation: entry.representation,
            coverageRules: [{ allOf: entry.columns ?? entry.rules ?? keywordCandidatesForTest(entry.requirement).slice(0, 3) }],
          },
        ],
      };

      expect(evaluateDeliverableRequirementCoverage(entry.good, profile).missing).toEqual([]);
      expect(evaluateDeliverableRequirementCoverage(entry.bad, profile).missing[0]).toMatchObject({
        finalResult: expect.stringMatching(/PARTIAL|NOT_SATISFIED/),
      });
    }
  });

  it("does not require participant evidence for standard reusable Care Plan templates", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");

    const result = validateWorkPackage(
      manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        primarySpecialist: "service_delivery_coordinator",
        supportingSpecialists: ["operations_manager", "compliance_quality_manager"],
        selectionMetadata: {
          method: "canonical",
          confidence: 1,
          matchedKeywords: [],
          fallbackUsed: false,
          canonicalIntent: "care_plan.create",
          blueprintFamily: "care_plan",
          blueprintMode: "create",
          requestedDeliverableType: "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE",
          deliverableStandardisation: "standard_reusable",
        },
      }),
      blueprint as any,
      { chunks: [], totalChunks: 0 } as any,
    );

    expect(result.passed).toBe(true);
    expect(result.missingItems).toContain("Participant Document");
    expect(result.missingEvidenceItems.find((item) => item.displayLabel === "Participant Document")?.required)
      .toBe(false);
    expect(result.issues.some(issue => issue.rule === "participant_context_present" && issue.level === "info")).toBe(true);
  });

  it("gives Care Plan CREATE final synthesis the authored fourteen-section user-facing structure", () => {
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard comprehensive NDIS care plan template covering all professionally relevant areas.",
      manifest: manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        primarySpecialist: "service_delivery_coordinator",
      }),
      blueprint: getRegistryEntry("care_plan") as any,
      blueprintContract: {
        blueprint: getRegistryEntry("care_plan") as any,
        sections: (getRegistryEntry("care_plan") as any)?.sections ?? [],
        template: null,
        mode: "create",
      },
    });
    const carePlan = getRegistryEntry("care_plan") as any;
    const supportPlan = getRegistryEntry("individual_support_plan") as any;

    expect(context.operation).toBe("CREATE");
    expect(context.deliverable.requestedDeliverableType).toBe("STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE");
    expect(context.professionalMethodRole).toBe("internal_method_only");
    expect(carePlan.sections).toHaveLength(14);
    expect(carePlan.sections.every((section: any) => section.sectionRole === "user_facing")).toBe(true);
    expect(carePlan.sections.map((section: any) => section.sectionCode)).toEqual([
      "SUPPORT_PLAN_MEETING",
      "GOALS",
      "ABOUT_ME",
      "HISTORY_BACKGROUND",
      "UNDERTAKING_ADL",
      "COMMUNICATION_STRATEGY",
      "MOBILITY_STRATEGY",
      "SUPPORT_DELIVERY_CLIENT_SAFETY",
      "BEHAVIOURAL_MANAGEMENT",
      "RESTRICTIVE_PRACTICES",
      "MEALTIME_MANAGEMENT_STRATEGY",
      "DISASTER_MANAGEMENT_STRATEGY",
      "CLIENT_ENDORSEMENT",
      "DOCUMENT_CONTROL",
    ]);
    expect((supportPlan.sections ?? []).some((section: any) => Object.prototype.hasOwnProperty.call(section, "sectionRole"))).toBe(false);
    expect(carePlan.deliverableContract.requirementPlan).toHaveLength(14);
    expect(carePlan.deliverableContract.requirementPlan[0]).toMatchObject({
      id: "care-plan-support-plan-meeting",
      targetLocation: "Support Plan Meeting (header)",
    });
    expect(carePlan.sections[0].fixedContent).toContain("This plan describes the supports to be delivered to the participant and how support workers are to deliver them. It must be read together with the participant's NDIS plan, service agreement, and any behaviour support plan, health support plan or risk assessment referenced in it.");
    expect(carePlan.sections[0].fields).toContain("Participant name");
    expect(carePlan.sections[0].completionPrompt).toBe("Record every person who attended the planning meeting and their relationship to the participant. Where reports were used instead, name each report and its date.");
    expect(carePlan.sections.every((section: any) => (section.fixedContent ?? []).length > 0)).toBe(true);
    expect(carePlan.sections.every((section: any) => (section.fields ?? []).length > 0)).toBe(true);
    expect(carePlan.sections.every((section: any) => Boolean(section.completionPrompt))).toBe(true);
    expect(carePlan.sections[8].fixedContent).toContain("Non-applicability wording: Based on [SOURCE_DOCUMENT] dated [DATE], no behaviour support plan is in place and no behaviours of concern have been identified for this participant. Workers should report any emerging concern to the service manager.");
    expect(carePlan.sections[10].fixedContent).toContain("Non-applicability wording: Based on the mealtime management risk assessment dated [DATE], no hands-on mealtime strategy is required for this participant. Support is limited to [SUPPORT_TYPE]. Workers should report any change in eating or drinking to the service manager.");
    expect(carePlan.sections[12].fixedContent.join("\n")).toContain("I have been involved in the development of this Care Plan.");
    expect(carePlan.sections[13].completionPrompt).toBe("Record the form ID, version and date. The review date must match the date recorded in the plan header.");

    const src = source("services/unifiedExecutionEngine.ts");
    expect(src).toContain("Authored fixedContent, fields, required structures and completionPrompt below are deterministic template elements assembled by the server");
    expect(src).toContain("fixed content, fields, structure, completion prompt, model-generated content");
    expect(src).toContain("Fixed content assembled by server:");
    expect(src).toContain("Fields/structures assembled by server:");
    expect(src).toContain("Completion prompt assembled by server:");
    expect(src).toContain("Section role:");
    expect(src).toContain("Deliverable structure: internal method only; do not copy this section code or title as a user-facing heading unless a requirement explicitly maps to it.");
    expect(src).toContain("Allowed source types:");
    expect(src).toContain("Evidence requirements:");
    expect(src).toContain("Validation rules:");
    expect(src).toContain("Quality criteria:");
    expect(src).toContain("Use these as the final document structure or merge them into equivalent user-facing headings");
    expect(src).toContain("Do not use internal Blueprint section titles as the document structure for CREATE/TEMPLATE work");
    expect(src).toContain("prior draft leaked internal Blueprint methodology");
    expect(src).toContain("it is intentionally omitted from this synthesis prompt");
    expect(src).not.toContain("## BLUEPRINT PROFESSIONAL METHOD");
    expect(src).not.toContain("## INTERNAL BLUEPRINT COMPLETENESS CHECKS");
    expect(src).toContain("Build the final deliverable from the requested deliverable contract, mandatory user-facing content, requirement plan and authoritative evidence.");
    expect(src).toContain("Factual placeholders may appear only inside otherwise drafted professional clauses");
    expect(src).toContain("Every mandatory user-facing section must contain substantive professional prose");
  });

  it("carries authored requirements and adequacy criteria through verbatim when present", () => {
    const blueprint = {
      ...getRegistryEntry("care_plan"),
      deliverableContract: {
        primaryDeliverable: "care_plan",
        requirementPlan: [
          {
            id: "authored-worker-responsibilities",
            requirementText: "Worker responsibilities must specify the responsible role, action, escalation trigger and evidence record.",
            targetLocation: "Worker responsibilities section",
            adequacyCriteria: [
              "Names the responsible worker role.",
              "States the action the worker must complete.",
              "States the escalation trigger.",
              "States the evidence record that must be completed.",
            ],
          },
        ],
      },
    } as any;
    const contract = {
      blueprint,
      sections: [],
      template: null,
      mode: "create",
    } as BlueprintExecutionContract;
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a care plan template.",
      manifest: manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        primarySpecialist: "service_delivery_coordinator",
      }),
      blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const prompt = formatRequirementCoveragePrompt(profile);

    expect(profile.requirements).toHaveLength(1);
    expect(profile.requirements[0]).toMatchObject({
      id: "authored-worker-responsibilities",
      origin: "AUTHORED",
      description: "Worker responsibilities must specify the responsible role, action, escalation trigger and evidence record.",
      requiredDeliverableRepresentation: "Worker responsibilities section",
      adequacyCriteria: [
        "Names the responsible worker role.",
        "States the action the worker must complete.",
        "States the escalation trigger.",
        "States the evidence record that must be completed.",
      ],
    });
    expect(prompt).toContain("Origin: AUTHORED");
    expect(prompt).toContain("Requirement: Worker responsibilities must specify the responsible role, action, escalation trigger and evidence record.");
    expect(prompt).toContain("Target location: Worker responsibilities section");
    expect(prompt).toContain("    - Names the responsible worker role.");

    const filler = [
      "## Worker Responsibilities",
      Array.from({ length: 162 }, (_, index) => `filler${index}`).join(" "),
    ].join("\n\n");
    const fillerReport = evaluateDeliverableRequirementCoverage(filler, profile);
    expect(fillerReport.requirementResults[0]?.substantiveValidationMode).toBe("ADEQUACY_CRITERIA");
    expect(fillerReport.missing[0]?.reason).toContain("authored adequacy criteria");

    const substantive = [
      "## Worker Responsibilities",
      "The responsible worker role is the support worker allocated to the participant's shift. The action the worker must complete is the agreed personal support action during the shift. The escalation trigger is any change in participant support need or any emerging risk, and the worker must escalate to the service coordinator. The evidence record that must be completed is the participant support note before shift handover.",
    ].join("\n\n");
    const substantiveReport = evaluateDeliverableRequirementCoverage(substantive, profile);
    expect(substantiveReport.missing).toHaveLength(0);
    expect(substantiveReport.requirementResults[0]?.substantiveValidationMode).toBe("ADEQUACY_CRITERIA");

    const structuredReport = evaluateDeliverableRequirementCoverage("This assembled document is intentionally not scanned for the requirement.", profile, {
      deliverableSections: [
        {
          requirementId: "authored-worker-responsibilities",
          heading: "Worker Responsibilities",
          content: "The responsible worker role is the support worker. The action the worker must complete is personal support. The escalation trigger is a changed support need. The evidence record that must be completed is the participant support note.",
        },
      ],
    });
    expect(structuredReport.missing).toHaveLength(0);

    const missingStructuredEntry = evaluateDeliverableRequirementCoverage(substantive, profile, {
      deliverableSections: [
        {
          requirementId: "wrong-requirement-id",
          heading: "Worker Responsibilities",
          content: "The responsible worker role is the support worker. The action the worker must complete is personal support. The escalation trigger is a changed support need. The evidence record that must be completed is the participant support note.",
        },
      ],
    });
    expect(missingStructuredEntry.missing[0]?.reason).toContain('deliverable.sections is missing an entry for required requirementId "authored-worker-responsibilities"');
  });

  it("uses authored Care Plan requirements and adequacy criteria instead of derived fallback requirements", () => {
    const blueprint = getRegistryEntry("care_plan") as any;
    const contract = {
      blueprint,
      sections: blueprint.sections ?? [],
      template: null,
      mode: "create",
    } as BlueprintExecutionContract;
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard comprehensive NDIS care plan template.",
      manifest: manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        primarySpecialist: "service_delivery_coordinator",
      }),
      blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const prompt = formatRequirementCoveragePrompt(profile);

    expect(profile.requirements).toHaveLength(14);
    expect(profile.requirements.every((requirement) => requirement.origin === "AUTHORED")).toBe(true);
    expect(profile.requirements.every((requirement) => requirement.adequacyCriteria.length > 0)).toBe(true);
    expect(profile.requirements.map((requirement) => requirement.id)).toEqual([
      "care-plan-support-plan-meeting",
      "care-plan-goals",
      "care-plan-about-me",
      "care-plan-history-background",
      "care-plan-undertaking-adl",
      "care-plan-communication-strategy",
      "care-plan-mobility-strategy",
      "care-plan-support-delivery-client-safety",
      "care-plan-behavioural-management",
      "care-plan-restrictive-practices",
      "care-plan-mealtime-management-strategy",
      "care-plan-disaster-management-strategy",
      "care-plan-client-endorsement",
      "care-plan-document-control",
    ]);
    expect(prompt).toContain("Origin: AUTHORED");
    expect(prompt).toContain("Requirement: Support Plan Meeting section contains client name, date of birth, gender, language spoken, NDIS number, diagnosis, people present, support plan developed by, and date for review.");
    expect(prompt).toContain("Template criteria:");
    expect(prompt).toContain("    - All authored fixedContent paragraphs are emitted verbatim.");
    expect(prompt).toContain("    - All declared template fields are present and labelled.");
    expect(prompt).toContain("    - Every field present and labelled");
    expect(prompt).toContain("Requirement: Behavioural Management section contains a table with behaviour, possible trigger, and redirection strategy.");
    expect(prompt).toContain("    - Redirection strategies are drawn from the BSP, not invented");
    expect(prompt).not.toContain("Participant criteria: DERIVED_FALLBACK_HEURISTIC");
  });

  it("validates reusable Care Plan templates against derived template criteria without treating declared fields or user-facing headings as leaks", () => {
    const blueprint = getRegistryEntry("care_plan") as any;
    const contract = {
      blueprint,
      sections: blueprint.sections ?? [],
      template: null,
      mode: "create",
    } as BlueprintExecutionContract;
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard reusable NDIS care plan template.",
      manifest: manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        primarySpecialist: "service_delivery_coordinator",
      }),
      blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract);
    const supportPlanMeeting = blueprint.sections.find((section: any) => section.sectionCode === "SUPPORT_PLAN_MEETING");
    const content = [
      "## Support Plan Meeting",
      "Participant name: [PARTICIPANT_NAME]",
      "Date of birth: [DATE_OF_BIRTH]",
      "Gender: [GENDER]",
      "Language spoken: [LANGUAGE_SPOKEN]",
      "NDIS number: [NDIS_NUMBER]",
      "Diagnosis: [DIAGNOSIS]",
      "People present: [PEOPLE_PRESENT]",
      "Support plan developed by: [SUPPORT_PLAN_DEVELOPED_BY]",
      "Plan date: [PLAN_DATE]",
      "Date for review: [REVIEW_DATE]",
      "",
      ...supportPlanMeeting.fixedContent,
      "",
      supportPlanMeeting.completionPrompt,
    ].join("\n");
    const oneRequirementProfile = {
      ...profile,
      requirements: profile.requirements.filter((requirement) => requirement.id === "care-plan-support-plan-meeting"),
    };
    const coverage = evaluateDeliverableRequirementCoverage(content, oneRequirementProfile);

    expect(coverage.requirementResults[0]?.substantiveValidationMode).toBe("TEMPLATE_CRITERIA");
    expect(coverage.missing).toHaveLength(0);

    const runtime = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown: content,
      standardTemplateEvidence: {
        standardTemplateRequested: true,
        existingTemplateRequested: false,
        participantSpecificRequested: false,
        organisationSpecificRequested: false,
        customerExampleOptional: true,
      },
      professionalContext: context,
    });
    expect(runtime.failures.some((failure) => failure.gate === "professional_placeholder")).toBe(false);
    expect(runtime.failures.some((failure) => failure.gate === "methodology_leak")).toBe(false);
  });

  it("carries the authored Care Plan evidence contract and authority boundary from the specification", () => {
    const blueprint = getRegistryEntry("care_plan") as any;

    expect(blueprint.evidenceContract.documentToSections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        documentType: "Behaviour support plan",
        requiredWhen: "where one exists",
        feeds: expect.arrayContaining(["BEHAVIOURAL_MANAGEMENT", "RESTRICTIVE_PRACTICES", "COMMUNICATION_STRATEGY", "GOALS"]),
      }),
      expect.objectContaining({
        documentType: "Mealtime management risk assessment",
        requiredWhen: "always",
        feeds: ["MEALTIME_MANAGEMENT_STRATEGY"],
      }),
    ]));
    expect(blueprint.externalAuthorityRequiredFor).toEqual(expect.arrayContaining([
      "Clinical, medication, dysphagia, mealtime or other credentialed health judgements require external or appropriately credentialed professional authority.",
      "Does not author or amend a behaviour support plan; implements an existing one.",
      "Does not determine, grant or assess restrictive practice authorisation.",
      "Does not carry clinical management, medication schedules or treating-professional contacts — those belong to health_support_plan.",
    ]));
  });

  it("enforces Care Plan conditional non-applicability and mechanical gate rules", () => {
    const blueprint = getRegistryEntry("care_plan") as any;
    const contract = {
      blueprint,
      sections: blueprint.sections ?? [],
      template: null,
      mode: "create",
    } as BlueprintExecutionContract;
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard comprehensive NDIS care plan template.",
      manifest: manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        primarySpecialist: "service_delivery_coordinator",
      }),
      blueprint,
      blueprintContract: contract,
    });
    const validation = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown: [
        "## Goals",
        "| Current situation | Goal | Actions | Person responsible | Timeframe | Outcomes |",
        "| --- | --- | --- | --- | --- | --- |",
        "| [CURRENT] | [GOAL] | [ACTIONS] | The team | ongoing | [OUTCOMES] |",
        "",
        "## Communication and Communication Strategy",
        "- Verbal: [VERBAL]",
        "- Non-verbal: [NON_VERBAL]",
        "",
        "## Support Delivery and Client Safety",
        "- [x] Personal care:",
        "",
        "## Behavioural Management",
        "",
        "## Restrictive Practices",
        "Based on the behaviour support plan, no restrictive practice is recorded and this section does not apply.",
        "",
        "## Disaster Management Strategy",
        "Based on the community access risk assessment, no hands-on disaster strategy is required for this template.",
      ].join("\n"),
      standardTemplateEvidence: {
        standardTemplateRequested: true,
        existingTemplateRequested: false,
        participantSpecificRequested: false,
        organisationSpecificRequested: false,
        customerExampleOptional: true,
      },
      professionalContext: context,
    });
    const mechanicalDetails = validation.failures
      .filter((failure) => failure.gate === "mechanical_gate")
      .flatMap((failure) => failure.details ?? []);

    expect(mechanicalDetails).toEqual(expect.arrayContaining([
      expect.stringContaining("care_plan_no_invalid_timeframe"),
      expect.stringContaining("care_plan_goal_rows_complete"),
      expect.stringContaining("care_plan_minimum_three_personal_goals"),
      expect.stringContaining("care_plan_selected_supports_described"),
      expect.stringContaining("care_plan_capacity_strategy_narratives_present"),
      expect.stringContaining("care_plan_no_blank_conditional_sections"),
    ]));
  });

  it("strips self-describing Care Plan prose before substantive word-count validation", () => {
    const profile = {
      deliverableType: "CARE_PLAN",
      operation: "CREATE" as const,
      standardisation: "standard_reusable" as const,
      requirements: [
        {
          id: "mandatory-1",
          description: "Participant identity and factual placeholder framework",
          classification: "MUST_BE_REPRESENTED" as const,
          origin: "DERIVED" as const,
          professionalRationale: "Previous item 11 coverage regression fixture.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Participant identity section",
          adequacyCriteria: [],
          coverageRules: [{ allOf: ["participant"] }],
        },
        {
          id: "mandatory-2",
          description: "Participant goals, preferences and communication needs",
          classification: "MUST_BE_REPRESENTED" as const,
          origin: "DERIVED" as const,
          professionalRationale: "Previous item 11 coverage regression fixture.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Goals and preferences section",
          adequacyCriteria: [],
          coverageRules: [{ allOf: ["goals", "preferences"] }],
        },
        {
          id: "mandatory-3",
          description: "Support domains and daily living support structure",
          classification: "MUST_BE_REPRESENTED" as const,
          origin: "DERIVED" as const,
          professionalRationale: "Previous item 11 coverage regression fixture.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Support domains section",
          adequacyCriteria: [],
          coverageRules: [{ allOf: ["support", "domains"] }],
        },
        {
          id: "mandatory-4",
          description: "Provider and worker responsibilities",
          classification: "MUST_BE_REPRESENTED" as const,
          origin: "DERIVED" as const,
          professionalRationale: "Previous item 11 coverage regression fixture.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Responsibilities section",
          adequacyCriteria: [],
          coverageRules: [{ allOf: ["support", "delivery"] }],
        },
        {
          id: "mandatory-9",
          description: "Review, updates, consent and sign-off provisions",
          classification: "MUST_BE_REPRESENTED" as const,
          origin: "DERIVED" as const,
          professionalRationale: "Previous item 11 coverage regression fixture.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Review section",
          adequacyCriteria: [],
          coverageRules: [{ allOf: ["review", "consent"] }],
        },
      ],
    };
    const report = evaluateDeliverableRequirementCoverage("", profile, {
      deliverableSections: [
        {
          requirementId: "mandatory-1",
          heading: "Participant Identity",
          content: "This section serves to identify the participant and provide necessary contact information.",
        },
        {
          requirementId: "mandatory-2",
          heading: "Goals and Preferences",
          content: "This section outlines the participant's goals, preferences, and any specific communication needs.",
        },
        {
          requirementId: "mandatory-4",
          heading: "Provider and Worker Responsibilities",
          content: "This section describes the support delivery obligations and operational boundaries.",
        },
        {
          requirementId: "mandatory-3",
          heading: "Support Domains and Daily Living Support Structure",
          content: "Support Domains:\n- Daily Living Skills\n- Community Participation\n- Health and Wellbeing\nDaily Living Support Structure:\n- Personal Care support is recorded with the support worker role and participant support priorities.\n- Community Access support is recorded with coordination responsibilities and escalation pathways.",
        },
        {
          requirementId: "mandatory-9",
          heading: "Review, Updates, Consent and Sign-off Provisions",
          content: "Review Date: [REVIEW_DATE]\nRecord goals, communication preferences and support priorities. Record plan updates, the reviewer, participant consent, update reason, sign-off date, responsible provider role, review provisions and evidence retained for the care plan review.",
        },
      ],
    });
    const byId = new Map(report.requirementResults.map((item) => [item.requirementId, item]));

    for (const [requirementId, stripped] of [
      ["mandatory-1", "This section serves to identify the participant and provide necessary contact information."],
      ["mandatory-2", "This section outlines the participant's goals, preferences, and any specific communication needs."],
      ["mandatory-4", "This section describes the support delivery obligations and operational boundaries."],
    ]) {
      expect(byId.get(requirementId)).toMatchObject({
        structuralResult: "STRUCTURE_PASS",
        substantiveResult: "SUBSTANTIVE_FAIL",
        failureReason: "Relevant section is too thin to prove substantive professional coverage.",
      });
      expect(byId.get(requirementId)?.finalResult).toMatch(/PARTIAL|NOT_SATISFIED/);
      expect(byId.get(requirementId)?.substantiveBreakdown?.strippedSelfDescription).toEqual([stripped]);
      expect(byId.get(requirementId)?.substantiveBreakdown?.countedWordCount).toBe(0);
    }

    expect(byId.get("mandatory-3")).toMatchObject({
      structuralResult: "STRUCTURE_PASS",
      substantiveResult: "SUBSTANTIVE_PASS",
      finalResult: "SATISFIED",
    });
    expect(byId.get("mandatory-3")?.substantiveBreakdown?.strippedSelfDescription).toEqual([]);
    expect(byId.get("mandatory-3")?.substantiveBreakdown?.countedContent).toContain("Support Domains:");
    expect(byId.get("mandatory-3")?.substantiveBreakdown?.countedContent).toContain("Daily Living Skills");

    expect(byId.get("mandatory-9")).toMatchObject({
      structuralResult: "STRUCTURE_PASS",
      substantiveResult: "SUBSTANTIVE_PASS",
      finalResult: "SATISFIED",
    });
    expect(byId.get("mandatory-9")?.substantiveBreakdown?.strippedSelfDescription).toEqual([]);
    expect(byId.get("mandatory-9")?.substantiveBreakdown?.countedContent).toContain("Review Date: [REVIEW_DATE]");
    expect(byId.get("mandatory-9")?.substantiveBreakdown?.countedContent).toContain("Record goals, communication preferences and support priorities");
    expect(byId.get("mandatory-9")?.substantiveBreakdown).toMatchObject({
      fieldLabelCount: 1,
      placeholderCount: 1,
    });
    expect(byId.get("mandatory-9")?.substantiveBreakdown?.proseWordCount).toBeGreaterThan(18);
  });

  it("reports field labels and placeholders separately from prose without changing fallback pass/fail", () => {
    const profile = {
      deliverableType: "CARE_PLAN",
      operation: "CREATE" as const,
      standardisation: "standard_reusable" as const,
      requirements: [
        {
          id: "mandatory-1",
          description: "Participant identity and factual placeholder framework",
          classification: "MUST_BE_REPRESENTED" as const,
          origin: "DERIVED" as const,
          professionalRationale: "Previous item 11 coverage reporting fixture.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Participant identity section",
          adequacyCriteria: [],
          coverageRules: [{ allOf: ["participant", "ndis"] }],
        },
      ],
    };
    const report = evaluateDeliverableRequirementCoverage("", profile, {
      deliverableSections: [
        {
          requirementId: "mandatory-1",
          heading: "Participant Identity",
          content: [
            "Participant Name: [PARTICIPANT_NAME]",
            "Date of Birth: [DATE_OF_BIRTH]",
            "NDIS Number: [NDIS_NUMBER]",
            "Contact Information: [CONTACT_INFORMATION]",
            "Preferred Communication Method: [PREFERENCES]",
            "Gender: [GENDER]",
            "Address: [ADDRESS]",
            "Emergency Contact: [EMERGENCY_CONTACT]",
          ].join("\n"),
        },
      ],
    });
    const participantIdentity = report.requirementResults.find((item) => item.requirementId === "mandatory-1");

    expect(participantIdentity?.finalResult).toMatch(/SATISFIED|PARTIAL|NOT_SATISFIED/);
    expect(participantIdentity?.substantiveBreakdown).toMatchObject({
      countedWordCount: 30,
      proseWordCount: 0,
      fieldLabelCount: 8,
      placeholderCount: 8,
      fieldAndPlaceholderWordCount: 30,
      strippedSelfDescription: [],
    });
  });

  it("counts authored fixed content separately even when it starts like self-description", () => {
    const fixedContent = "This plan describes the supports to be delivered to the participant and how support workers are to deliver them.";
    const profile = {
      deliverableType: "CARE_PLAN",
      operation: "CREATE" as const,
      standardisation: "standard_reusable" as const,
      requirements: [
        {
          id: "care-plan-support-plan-meeting",
          description: "Support Plan Meeting section contains the standing support plan purpose.",
          classification: "MUST_BE_REPRESENTED" as const,
          origin: "AUTHORED" as const,
          professionalRationale: "Authored fixed care plan content must count.",
          evidenceAuthority: [],
          requiredDeliverableRepresentation: "Support Plan Meeting",
          adequacyCriteria: [],
          fixedContent: [fixedContent],
          templateFields: [],
          completionPrompt: null,
          coverageRules: [{ allOf: ["supports", "support workers"] }],
        },
      ],
    };
    const report = evaluateDeliverableRequirementCoverage("", profile, {
      deliverableSections: [
        {
          requirementId: "care-plan-support-plan-meeting",
          heading: "Support Plan Meeting",
          content: fixedContent,
        },
      ],
    });
    const result = report.requirementResults[0];

    expect(result.substantiveBreakdown?.strippedSelfDescription).toEqual([]);
    expect(result.substantiveBreakdown?.fixedContentWordCount).toBeGreaterThan(0);
    expect(result.substantiveBreakdown?.proseWordCount).toBe(0);
  });

  it("assembles deterministic care plan template elements before model-generated content", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const contract = {
      blueprint,
      sections: blueprint.sections ?? [],
      template: null,
      mode: "create",
    } satisfies BlueprintExecutionContract;
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: "Create a standard reusable NDIS care plan template.",
      manifest: manifest({ blueprintId: "care_plan", canonicalIntent: "care_plan.create" }),
      blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract);
    const assembly = assembleDeterministicTemplateDeliverableSections({
      requirements: profile.requirements,
      blueprintSections: contract.sections,
      modelSections: [
        {
          requirementId: "care-plan-about-me",
          heading: "About Me",
          content: "Additional model-generated content appears after the deterministic template blocks.",
        },
        {
          requirementId: "care-plan-goals",
          heading: "Goals",
          content: "NDIS plan goals and personal goals are recorded together in the table above.",
        },
        {
          requirementId: "care-plan-undertaking-adl",
          heading: "Undertaking ADL",
          content: "Activities:\n- [ACTIVITY_1]: [TIER]\n- [ACTIVITY_2]: [TIER]\n- [ACTIVITY_3]: [TIER]",
        },
      ],
    });
    const meeting = assembly.sections.find((section) => section.requirementId === "care-plan-support-plan-meeting");
    const goals = assembly.sections.find((section) => section.requirementId === "care-plan-goals");
    const adl = assembly.sections.find((section) => section.requirementId === "care-plan-undertaking-adl");
    const aboutMe = assembly.sections.find((section) => section.requirementId === "care-plan-about-me");

    expect(assembly.sections).toHaveLength(14);
    expect(assembly.deterministicCompleteness.fixedContentComplete).toBe(true);
    expect(assembly.deterministicCompleteness.goalRowCount).toBe(3);
    expect(meeting?.content).toContain("This plan describes the supports to be delivered to the participant");
    expect(meeting?.content).toContain("Participant name: [PARTICIPANT_NAME]");
    expect(meeting?.content).toContain("Record every person who attended the planning meeting");
    expect(goals?.content.match(/\[CURRENT_SITUATION_\d+\]/g)).toHaveLength(3);
    expect(goals?.content).toContain("| Current situation | Goal | Actions | Person responsible | Timeframe | Outcomes |");
    expect(goals?.content).not.toContain("table above");
    expect(adl?.content).toContain("| Activity | Support level | What the worker does |");
    expect(adl?.content.match(/\| [^|\n]+ \| \[SUPPORT_LEVEL_[A-Z0-9_]+\] \| \[WHAT_THE_WORKER_DOES_[A-Z0-9_]+\] \|/g)).toHaveLength(26);
    expect(adl?.content).toContain("| Personal hygiene and grooming | [SUPPORT_LEVEL_PERSONAL_HYGIENE_AND_GROOMING] | [WHAT_THE_WORKER_DOES_PERSONAL_HYGIENE_AND_GROOMING] |");
    expect(adl?.content).toContain("| Decision-making relating to daily activities | [SUPPORT_LEVEL_DECISION_MAKING_RELATING_TO_DAILY_ACTIVITIES] | [WHAT_THE_WORKER_DOES_DECISION_MAKING_RELATING_TO_DAILY_ACTIVITIES] |");
    expect(derivePlaceholderTokensFromTemplateField(
      blueprint.sections?.find((section: any) => section.sectionCode === "UNDERTAKING_ADL")?.fields?.[0] ?? "",
    )).toEqual(["[ACTIVITY]", "[SUPPORT_LEVEL]", "[WHAT_THE_WORKER_DOES]"]);
    expect(assembly.modelGeneratedSections.find((section) => section.requirementId === "care-plan-goals")?.content).toBe("");
    expect(assembly.modelGeneratedSections.find((section) => section.requirementId === "care-plan-undertaking-adl")?.content).toBe("");
    expect(aboutMe?.content.indexOf("This section is about who the participant is")).toBeLessThan(
      aboutMe?.content.indexOf("Strengths: [STRENGTHS]") ?? Number.MAX_SAFE_INTEGER,
    );
    expect(aboutMe?.content.indexOf("Write in the participant's own words where possible")).toBeLessThan(
      aboutMe?.content.indexOf("Additional model-generated content appears") ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it("validates deterministic care plan template prompts and structures by construction", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const contract = {
      blueprint,
      sections: blueprint.sections ?? [],
      template: null,
      mode: "create",
    } satisfies BlueprintExecutionContract;
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: "Create a standard reusable NDIS care plan template.",
      manifest: manifest({ blueprintId: "care_plan", canonicalIntent: "care_plan.create" }),
      blueprint,
      blueprintContract: contract,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract);
    const assembly = assembleDeterministicTemplateDeliverableSections({
      requirements: profile.requirements,
      blueprintSections: contract.sections,
      modelSections: [],
    });
    const markdown = assembleDeliverableMarkdownFromSections(
      assembly.sections,
      profile.requirements.map((requirement) => requirement.id),
    );
    const coverage = evaluateDeliverableRequirementCoverage(markdown, profile, {
      deliverableSections: assembly.sections,
    });
    const runtime = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown: markdown,
      deliverableSections: assembly.sections,
      standardTemplateEvidence: {
        standardTemplateRequested: true,
        existingTemplateRequested: false,
        participantSpecificRequested: false,
        organisationSpecificRequested: false,
        customerExampleOptional: true,
      },
      professionalContext,
    });
    const mechanicalDetails = runtime.failures
      .filter((failure) => failure.gate === "mechanical_gate")
      .flatMap((failure) => failure.details ?? []);

    expect(coverage.totalApplicableRequirements).toBe(14);
    expect(coverage.missing.filter((failure) => failure.reason.includes("missing authored completionPrompt"))).toHaveLength(0);
    expect(coverage.requirementResults.find((item) => item.requirementId === "care-plan-goals")?.failureReason ?? "").not.toContain("three personal goal rows");
    expect(coverage.requirementResults.find((item) => item.requirementId === "care-plan-support-delivery-client-safety")?.failureReason ?? "").not.toContain("support type list");
    expect(mechanicalDetails).not.toContainEqual(expect.stringContaining("care_plan_selected_supports_described"));
  });

  it("merges targeted repair deltas into the existing 9-section deliverable", () => {
    const currentSections = carePlanDeliverableSections();
    const repairSections = [
      {
        requirementId: "mandatory-2",
        heading: "Repaired Risk Controls",
        content: "Repaired substantive wording for requirement two now explains the concrete risk controls, responsible owner, review trigger, escalation pathway and evidence record expected in the reusable care plan.",
      },
      {
        requirementId: "mandatory-7",
        heading: "Repaired Review Responsibilities",
        content: "Repaired substantive wording for requirement seven now explains who reviews the care plan, when review occurs, what changes trigger review and how updates are recorded.",
      },
    ];

    const merged = mergeDeliverableSectionDeltas({
      currentSections,
      repairSections,
      allowedRequirementIds: ["mandatory-2", "mandatory-7"],
    });
    const assembled = assembleDeliverableMarkdownFromSections(
      merged,
      currentSections.map((section) => section.requirementId),
    );

    expect(merged).toHaveLength(9);
    expect(merged.find((section) => section.requirementId === "mandatory-2")?.heading).toBe("Repaired Risk Controls");
    expect(merged.find((section) => section.requirementId === "mandatory-7")?.heading).toBe("Repaired Review Responsibilities");
    expect(merged.find((section) => section.requirementId === "mandatory-3")?.content).toContain("Original substantive care plan content");
    expect(assembled.match(/^## /gm)).toHaveLength(9);
    expect(assembled).toContain("## Repaired Risk Controls");
    expect(assembled).toContain("## Care Plan Requirement 9");
  });

  it("rejects empty targeted repair deltas and leaves the current document unchanged", () => {
    const currentSections = carePlanDeliverableSections();
    const before = assembleDeliverableMarkdownFromSections(
      currentSections,
      currentSections.map((section) => section.requirementId),
    );

    expect(() =>
      mergeDeliverableSectionDeltas({
        currentSections,
        repairSections: [],
        allowedRequirementIds: ["mandatory-2"],
      }),
    ).toThrow("Targeted repair returned no deliverable.sections[] deltas.");
    expect(assembleDeliverableMarkdownFromSections(
      currentSections,
      currentSections.map((section) => section.requirementId),
    )).toBe(before);
  });

  it("rejects targeted repair deltas for unknown requirement IDs", () => {
    const currentSections = carePlanDeliverableSections();

    expect(() =>
      mergeDeliverableSectionDeltas({
        currentSections,
        repairSections: [
          {
            requirementId: "mandatory-99",
            heading: "Unknown Requirement",
            content: "This section should not be accepted because it is not in the current deliverable section set.",
          },
        ],
        allowedRequirementIds: ["mandatory-99"],
      }),
    ).toThrow('Targeted repair returned unknown requirementId "mandatory-99".');
  });

  it("assembles byte-identical markdown before and after no-op equivalent repair", () => {
    const currentSections = carePlanDeliverableSections();
    const order = currentSections.map((section) => section.requirementId);
    const stageTwoAssembly = assembleDeliverableMarkdownFromSections(currentSections, order);
    const merged = mergeDeliverableSectionDeltas({
      currentSections,
      repairSections: [currentSections[0]],
      allowedRequirementIds: ["mandatory-1"],
    });

    expect(assembleDeliverableMarkdownFromSections(merged, order)).toBe(stageTwoAssembly);
  });

  it("still requires participant evidence for participant-specific Care Plan work", () => {
    const request = "Create a Care Plan for Participant X.";
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");

    expect(deriveProfessionalIntentKey(request, "compliance.audit_readiness")).toBe("care_plan.create");
    expect(deriveDeliverableStandardisation(request)).toBe("participant_specific");

    const result = validateWorkPackage(
      manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        primarySpecialist: "service_delivery_coordinator",
        selectionMetadata: {
          method: "canonical",
          confidence: 1,
          matchedKeywords: [],
          fallbackUsed: false,
          canonicalIntent: "care_plan.create",
          blueprintFamily: "care_plan",
          blueprintMode: "create",
          requestedDeliverableType: "PARTICIPANT_NDIS_CARE_PLAN",
          deliverableStandardisation: "participant_specific",
        },
      }),
      blueprint as any,
      { chunks: [], totalChunks: 0 } as any,
    );

    expect(result.passed).toBe(false);
    expect(result.missingItems).toContain("Participant Document");
    expect(result.clarificationMessage).not.toMatch(/approval required/i);
  });
});
