import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { BLUEPRINT_REGISTRY, getRegistryEntry, getRegistryBlueprintReadinessState } from "../services/blueprintRegistry";
import { resolveIntent } from "../services/blueprintIntentMap";
import {
  compileProfessionalExecutionContext,
  deriveDeliverableStandardisation,
  deriveProfessionalIntentKey,
  deriveProfessionalOperation,
} from "../services/professionalExecutionContextService";
import {
  auditBlueprintRequirementCompatibility,
  buildDeliverableOutputSchema,
  buildRequirementToDeliverablePlan,
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
  validateDeliverableRequirementCoverage,
} from "../services/deliverableRequirementCoverageService";
import { validateBlueprintRuntimeCompletion } from "../services/blueprintRuntimeValidationService";
import type { BlueprintExecutionContract } from "../services/workBlueprintService";
import type { WorkPackageManifest } from "../services/workPackageService";
import { parseSpecialistJsonOutput } from "../services/claimValidationService";
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

describe("Sprint 35H professional operation and deliverable architecture", () => {
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

  it("separates professional_work from deliverable content in the model response parser", () => {
    const parsed = parseSpecialistJsonOutput(JSON.stringify({
      professional_work: { blueprint_completion: ["Provider Responsibilities Review"] },
      deliverable: {
        type: "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT",
        content: "# NDIS Service Agreement\n\nProvider responsibilities are fully drafted.",
      },
      completion: { unresolvedProfessionalContent: 0, methodologyLeakage: false, readyForCompletedWork: true },
      claims: [],
    }));

    expect(parsed.content).toContain("NDIS Service Agreement");
    expect(parsed.content).not.toContain("Provider Responsibilities Review");
    expect(parsed.professionalWork).toBeTruthy();
    expect(parsed.deliverable).toBeTruthy();
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
    expect(src).toContain("deliverable.content");
    expect(src).toContain("deriveOutputTypeForProfessionalContext");
    expect(src).toContain("deliverableType.toLowerCase()");
    expect(contextService).toContain("STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT");
    expect(src).toContain("completedWork.title");
    expect(src).toContain("INTERNAL PROFESSIONAL METHOD CHECKLIST (DO NOT COPY AS DELIVERABLE HEADINGS)");
    expect(src).toContain("shouldRunCanonicalFinalDeliverableSynthesis");
    expect(src).toContain('professionalContext.operation === "CREATE"');
    expect(src).toContain("requiresCanonicalFinalDeliverablePayload");
    expect(src).toContain("Canonical final synthesis response did not include deliverable.content");
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
    const weakAgreement = [
      "# NDIS Service Agreement",
      "## Parties",
      "Provider and participant details will be recorded, including the provider identity, participant identity, representative authority where applicable, and the agreement period. These fields support a reusable agreement without inventing organisation or participant facts.",
      "## NDIS Agreement Purpose",
      "This agreement explains the purpose of the NDIS service relationship and records how the provider and participant agree to work together. It describes the supports at a high level and preserves participant choice and control.",
      "## Support Schedule",
      "The agreement includes a support schedule section for agreed supports, but this defective draft does not include the required professional schedule columns. This prose is intentionally long enough to prove the coverage gate catches the omission rather than the earlier incomplete-section guard.",
      "## Payment and Pricing",
      "Prices will be charged in line with the agreed terms and applicable pricing authority where relevant. The provider must explain pricing changes, GST or non-NDIS cost treatment, billing responsibilities and participant agreement requirements before changes take effect.",
      "## Provider Responsibilities",
      "The provider will deliver supports safely, respectfully and lawfully, keep appropriate records, explain billing, protect privacy, respond to feedback, notify interruptions and escalate critical risks according to the agreement and applicable obligations.",
      "## Participant Responsibilities",
      "The participant or representative will communicate relevant needs, preferences and changes, keep contact and plan information current, engage respectfully with workers, give reasonable notice for changes and pay agreed participant expenses where applicable.",
      "## Privacy and Complaints",
      "The agreement protects privacy and confidentiality, explains feedback and complaint pathways, preserves advocacy rights and explains how disputes can be raised and responded to without affecting participant choice and control.",
      "## Cancellation and Changes",
      "The agreement explains cancellation, no-show and rescheduling notice expectations, including emergency circumstances. It also explains how variations, funding changes, schedule changes and consent/signature controls are handled.",
      "## Termination",
      "Either party may end the agreement with notice according to the agreed terms. The agreement must preserve participant choice, transition support, final obligations, final invoices and secure handover where supports end.",
      "## Continuity and Emergency",
      "Continuity, emergency and disaster arrangements explain temporary service disruption, alternate support arrangements, communication responsibilities, escalation and review after the event where applicable.",
      "## Signatures",
      "Provider and participant or representative signature and acceptance fields are included so the reusable template can be completed once the factual details are known.",
    ].join("\n\n");

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
    expect(report.satisfiedCount).toBe(14);
    expect(report.missingCount).toBe(6);
    expect(report.coveragePercentage).toBe(70);
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
    expect(gate.failures.some((failure) => failure.gate === "professional_placeholder")).toBe(false);
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
    expect(schema.groups.find((group) => group.targetSection === "Schedule of Supports table/fields")?.fields)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          requirementId: "support-service-period-field",
          classification: "FACTUAL_FIELD",
          fieldLabel: "Service Period",
          requiredRepresentation: "Schedule column for service period",
        }),
      ]));
  });

  it("treats an omitted FACTUAL_FIELD as missing even when every other Service Agreement requirement is present", () => {
    const contract = serviceAgreementContract();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a standard compliant NDIS Service Agreement template covering all relevant clauses.",
      manifest: manifest(),
      blueprint: contract.blueprint,
      blueprintContract: contract,
    });
    const agreementMissingOneField = [
      "# NDIS Service Agreement Template",
      "Provider, participant, representative authority and agreement period are recorded as factual fields.",
      "This NDIS agreement describes the purpose and scope of supports and the service relationship.",
      "## Schedule of Supports",
      "| Support/service | NDIS support item/code | Description | Unit/basis | Quantity/frequency | Unit price/rate | Subtotal / estimated total | Agreement total amount |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| [SUPPORT_NAME] | [SUPPORT_ITEM_CODE] | [SUPPORT_DESCRIPTION] | [UNIT_BASIS] | [QUANTITY_FREQUENCY] | [UNIT_PRICE] | [ESTIMATED_TOTAL] | [AGREEMENT_TOTAL] |",
      "Delivery obligations, provider responsibilities, participant responsibilities, rights, privacy, complaints and advocacy are drafted.",
      "Payment, pricing, GST, price change, cancellation, no-show, notice, variation, consent, termination, exit, transition, continuity, emergency and disaster clauses are included.",
      "Signature and acceptance fields are present.",
    ].join("\n\n");

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
    const missingServicePeriod = [
      "# NDIS Service Agreement Template",
      "Provider, participant, representative authority and agreement period are recorded as factual fields.",
      "This NDIS agreement describes the purpose and scope of supports and the service relationship.",
      "## Schedule of Supports",
      "| Support/service | NDIS support item/code | Description | Unit/basis | Quantity/frequency | Unit price/rate | Subtotal / estimated total | Agreement total amount |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| [SUPPORT_NAME] | [SUPPORT_ITEM_CODE] | [SUPPORT_DESCRIPTION] | [UNIT_BASIS] | [QUANTITY_FREQUENCY] | [UNIT_PRICE] | [ESTIMATED_TOTAL] | [AGREEMENT_TOTAL] |",
      "Delivery obligations, provider responsibilities, participant responsibilities, rights, privacy, complaints and advocacy are drafted.",
      "Payment, pricing, GST, price change, cancellation, no-show, notice, variation, consent, termination, exit, transition, continuity, emergency and disaster clauses are included.",
      "Signature and acceptance fields are present.",
    ].join("\n\n");
    const repaired = missingServicePeriod
      .replace(
        "| Support/service | NDIS support item/code | Description | Unit/basis | Quantity/frequency | Unit price/rate | Subtotal / estimated total | Agreement total amount |",
        "| Support/service | NDIS support item/code | Description | Unit/basis | Quantity/frequency | Unit price/rate | Service period | Subtotal / estimated total | Agreement total amount |",
      )
      .replace(
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      )
      .replace(
        "| [SUPPORT_NAME] | [SUPPORT_ITEM_CODE] | [SUPPORT_DESCRIPTION] | [UNIT_BASIS] | [QUANTITY_FREQUENCY] | [UNIT_PRICE] | [ESTIMATED_TOTAL] | [AGREEMENT_TOTAL] |",
        "| [SUPPORT_NAME] | [SUPPORT_ITEM_CODE] | [SUPPORT_DESCRIPTION] | [UNIT_BASIS] | [QUANTITY_FREQUENCY] | [UNIT_PRICE] | [SERVICE_PERIOD] | [ESTIMATED_TOTAL] | [AGREEMENT_TOTAL] |",
      );

    const before = evaluateDeliverableRequirementCoverage(missingServicePeriod, profile);
    const after = evaluateDeliverableRequirementCoverage(repaired, profile);

    expect(before.missing.map((failure) => failure.requirementId)).toEqual(["support-service-period-field"]);
    expect(after.missing).toEqual([]);
    expect(after.satisfiedCount).toBe(20);
    expect(repaired).toContain("Provider, participant, representative authority and agreement period");
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
    expect(runner).toContain("Repair only the missing requirement IDs listed above");
    expect(review).toContain("disableAutoRevision");
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
    const coveredAgreement = [
      "# NDIS Service Agreement Template",
      "## Agreement Parties and Period",
      "Provider: [PROVIDER_NAME]. ABN: [PROVIDER_ABN]. Participant: [PARTICIPANT_NAME]. Representative authority: [REPRESENTATIVE_DETAILS]. Agreement period: [AGREEMENT_PERIOD].",
      "## NDIS Agreement Purpose and Scope",
      "This agreement records the NDIS supports the provider agrees to deliver and the participant agrees to receive. The scope explains included supports, exclusions and how agreed services relate to the participant's NDIS plan.",
      "## Schedule of Supports",
      "| Support/service | NDIS support item/code | Description | Unit/basis | Quantity/frequency/hours/weeks | Unit price/rate | Service period | Subtotal / estimated total | Agreement total amount |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      "| [SUPPORT_NAME] | [SUPPORT_ITEM_CODE] | [SUPPORT_DESCRIPTION] | [UNIT_BASIS] | [QUANTITY_FREQUENCY] | [UNIT_PRICE] | [SERVICE_PERIOD] | [ESTIMATED_TOTAL] | [AGREEMENT_TOTAL] |",
      "The provider and participant must review this schedule when supports, service periods, quantities or prices change.",
      "## Delivery of Supports",
      "The provider is responsible for delivering agreed supports safely, respectfully and within the provider's operational capability. The provider must notify the participant of material interruptions and coordinate replacement or alternative arrangements where appropriate.",
      "## Provider Responsibilities",
      "The provider will deliver supports with dignity and respect, keep appropriate records, explain billing, maintain privacy, respond to feedback and escalate critical risks.",
      "## Participant and Representative Responsibilities",
      "The participant or representative will share relevant needs and preferences, keep contact and plan information current, give reasonable notice of changes and pay any agreed non-NDIS expenses.",
      "## Rights, Privacy, Complaints and Advocacy",
      "The participant has rights to choice, control, privacy, confidentiality, complaints, feedback, disputes and advocacy. The provider must explain complaints pathways and protect participant information.",
      "## Payment, Pricing, GST and Non-NDIS Costs",
      "Payment and pricing will follow the agreed schedule, applicable pricing authority where relevant, GST or non-NDIS cost terms, and a clear price change notice and participant agreement process.",
      "## Cancellation, No-show and Rescheduling",
      "The agreement explains participant cancellation, provider cancellation, no-show and rescheduling notice expectations, including emergency circumstances.",
      "## Variation and Change",
      "Changes to services, prices, funding or the support schedule require notice, consent where required, an effective date and document-control records.",
      "## Termination, Exit and Transition",
      "Termination and exit provisions explain notice, transition support, participant choice, final invoices, records and continuity obligations.",
      "## Continuity, Emergency and Disaster",
      "Continuity, emergency and disaster arrangements explain temporary disruption, alternate support arrangements, communication and post-event review where applicable.",
      "## Signatures and Acceptance",
      "Provider signature: [SIGNATURE]. Participant/representative signature: [SIGNATURE]. Date: [DATE].",
    ].join("\n\n");

    const failures = validateDeliverableRequirementCoverage(
      coveredAgreement,
      deriveDeliverableRequirementCoverageProfile(context, contract),
    );

    expect(failures).toEqual([]);
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
    expect(result.missingItems).not.toContain("Participant Document");
    expect(result.issues.some(issue => issue.rule === "participant_context_present" && issue.level === "info")).toBe(true);
  });

  it("gives Care Plan CREATE final synthesis a user-facing structure independent of Blueprint section titles", () => {
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

    expect(context.operation).toBe("CREATE");
    expect(context.deliverable.requestedDeliverableType).toBe("STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE");
    expect(context.professionalMethodRole).toBe("internal_method_only");
    expect(context.deliverable.mandatoryProfessionalContent).toEqual(expect.arrayContaining([
      "Participant goals, preferences and communication needs",
      "Support domains and daily living support structure",
      "Risk, safety, incident and escalation arrangements",
      "Review, updates, consent and sign-off provisions",
    ]));

    const src = source("services/unifiedExecutionEngine.ts");
    expect(src).toContain("Use these as the final document structure or merge them into equivalent user-facing headings");
    expect(src).toContain("Do not use internal Blueprint section titles as the document structure for CREATE/TEMPLATE work");
    expect(src).toContain("prior draft leaked internal Blueprint methodology");
    expect(src).toContain("it is intentionally omitted from this synthesis prompt");
    expect(src).toContain("shouldOmitBlueprintSectionTitlesFromFinalSynthesis");
    expect(src).toContain("Omitted from this standard reusable final synthesis");
    expect(src).toContain("Blueprint section titles and deliverableContract JSON are intentionally omitted");
    expect(src).toContain("do not reconstruct Blueprint section titles");
    expect(src).toContain("Factual placeholders may appear only inside otherwise drafted professional clauses");
    expect(src).toContain("Every mandatory user-facing section must contain substantive professional prose");
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
