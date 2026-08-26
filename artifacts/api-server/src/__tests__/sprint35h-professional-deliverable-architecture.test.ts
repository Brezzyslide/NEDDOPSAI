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
    }

    const engine = source("services/professionalExecutionContextService.ts");
    const validator = source("services/workValidationService.ts");
    const runner = source("services/unifiedExecutionEngine.ts");

    expect(BLUEPRINT_REGISTRY).toHaveLength(75);
    expect(exceptions).toEqual([]);
    expect(engine).toContain("deriveProfessionalOperation");
    expect(engine).toContain("deriveDeliverableStandardisation");
    expect(engine).toContain("requestedDeliverableType");
    expect(engine).toContain("mandatoryProfessionalContent");
    expect(validator).toContain("isStandardReusableTemplate");
    expect(validator).toContain("participant_context_present");
    expect(runner).toContain("INTERNAL PROFESSIONAL METHOD CHECKLIST (DO NOT COPY AS DELIVERABLE HEADINGS)");
    expect(runner).toContain("REQUIRED USER-FACING DELIVERABLE CONTENT");
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
