import { describe, expect, it } from "vitest";
import { BUSINESS_CAPABILITIES } from "../lib/capabilityRegistry";
import { SPECIALISTS } from "../lib/workforceRegistry";
import { BLUEPRINT_REGISTRY, getRegistryEntry } from "../services/blueprintRegistry";
import { resolveIntent } from "../services/blueprintIntentMap";
import { planTask } from "../services/chiefOfStaffService";
import {
  compileProfessionalExecutionContext,
  deriveProfessionalIntentKey,
  deriveProfessionalOperation,
  deriveRequestedDeliverableType,
} from "../services/professionalExecutionContextService";
import {
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
  type DeliverableRequirementCoverageProfile,
} from "../services/deliverableRequirementCoverageService";
import { validateProfessionalExecutionPreflight } from "../services/professionalExecutionPreflightService";
import { classifyMessage } from "../services/conversationIntelligenceService";
import type { BlueprintExecutionContract, WorkBlueprint } from "../services/workBlueprintService";
import type { WorkPackageManifest } from "../services/workPackageService";

function manifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id: "manifest-sprint36a",
    organizationId: "org-sprint36a",
    completedWorkId: null,
    executionId: "execution-sprint36a",
    blueprintId: "blueprint-sprint36a",
    blueprintVersion: "1.0.0",
    canonicalIntent: "people.onboarding",
    blueprintFamily: "people_culture",
    blueprintMode: "onboarding",
    templateId: null,
    templateVersion: null,
    contractSnapshot: null,
    primarySpecialist: "people_culture_manager",
    supportingSpecialists: ["talent_learning_specialist"],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    entityKnowledge: {},
    taskUploads: [],
    selectionMetadata: { canonicalIntent: "people.onboarding", blueprintMode: "onboarding" } as never,
    modelVersion: null,
    promptVersion: null,
    assembledAt: new Date("2026-08-27T00:00:00Z"),
    requesterId: "user-sprint36a",
    createdAt: new Date("2026-08-27T00:00:00Z"),
    ...overrides,
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

describe("Sprint 36A professional routing and domain isolation", () => {
  it("keeps the current professional registry broad enough for workforce onboarding", () => {
    expect(BLUEPRINT_REGISTRY.length).toBeGreaterThanOrEqual(75);
    expect(BUSINESS_CAPABILITIES.length).toBeGreaterThan(100);
    expect(SPECIALISTS.length).toBeGreaterThanOrEqual(19);
    expect(resolveIntent("hr.onboarding")).toMatchObject({
      code: "people_management_review",
      family: "people_culture",
      isAction: false,
    });
    expect(resolveIntent("people.onboarding")).toMatchObject({
      code: "people_management_review",
      family: "people_culture",
      isAction: false,
    });
  });

  it.each([
    "Can you give me a checklist for onboarding a new staff",
    "Create a new staff onboarding checklist.",
    "Give me a checklist for onboarding a new employee.",
    "Prepare a staff induction checklist.",
    "I need an onboarding checklist for a support worker.",
    "Develop a checklist for bringing a new staff member into the organisation.",
  ])("routes onboarding checklist request to a professional workforce capability: %s", (request) => {
    const plan = planTask(request, undefined, request);
    expect(plan.intent).toBe("people.onboarding");
    expect(plan.primarySpecialist).toBe("people_culture_manager");
    expect(plan.assignedSpecialists).toContain("chief_of_staff");
    expect(plan.reasoning).not.toContain("Routed to Chief of Staff for manual handling");
    expect(deriveProfessionalIntentKey(request, plan.intent)).toBe("people.onboarding");
  });

  it("treats 'give me a checklist' onboarding language as task intent, not optional role clarification", () => {
    const request = "Can you give me a checklist for onboarding a new staff";
    const understanding = classifyMessage(request, { conversationId: "conv-sprint36a", organizationId: "org-sprint36a" });

    expect(understanding.conversationMode).toBe("task_intent");
    expect(understanding.clarificationRequired).toBe(false);
    expect(understanding.proposedTask?.sourceUserRequest).toBe(request);
  });

  it.each([
    ["Create a checklist", "CREATE"],
    ["Give me a checklist", "CREATE"],
    ["Prepare a checklist", "CREATE"],
    ["Create a standard assessment template", "CREATE"],
    ["Review this checklist", "REVIEW"],
    ["Check this checklist for compliance", "REVIEW"],
    ["Update this checklist", "UPDATE"],
    ["Complete this assessment for John", "COMPLETE"],
    ["Draft an audit template", "CREATE"],
    ["Audit this incident file", "REVIEW"],
    ["Prepare a planning checklist", "CREATE"],
  ] as const)("classifies operation by request semantics, not noun substrings: %s", (request, expected) => {
    expect(deriveProfessionalOperation(request)).toBe(expected);
  });

  it("builds workforce onboarding context without service-agreement factual-field contamination", () => {
    const blueprint = getRegistryEntry("people_management_review");
    expect(blueprint).toBeTruthy();
    const request = "Can you give me a checklist for onboarding a new staff";
    const context = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest(),
      blueprint: blueprint!,
      blueprintContract: contract(blueprint!, "onboarding"),
    });

    expect(context.operation).toBe("CREATE");
    expect(context.deliverable.requestedDeliverableType).toBe("WORKFORCE_ONBOARDING_CHECKLIST");
    expect(context.deliverable.audience).toContain("People & Culture");
    expect(context.professionalDomain).toBe("people_culture");
    expect(context.deliverable.mandatoryProfessionalContent.join(" ")).toContain("Required screening");
    expect(context.deliverable.allowedFactualPlaceholders).toEqual(
      expect.arrayContaining(["[STAFF_NAME]", "[ROLE]", "[START_DATE]", "[MANAGER]"]),
    );
    expect(context.deliverable.allowedFactualPlaceholders).not.toEqual(
      expect.arrayContaining(["[PARTICIPANT_NAME]", "[PROVIDER_NAME]", "[AGREEMENT_PERIOD]", "[PROVIDER_ABN]", "[NDIS_NUMBER]"]),
    );
  });

  it("keeps service-agreement placeholders out of generic non-agreement deliverables", () => {
    const blueprint = getRegistryEntry("standard_operating_procedure");
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a handover procedure for office administration",
      manifest: manifest({
        canonicalIntent: "operations.sop.create",
        blueprintFamily: "operations",
        blueprintMode: "create",
        primarySpecialist: "process_asset_coordinator",
        supportingSpecialists: ["operations_manager"],
      }),
      blueprint: blueprint ?? null,
      blueprintContract: blueprint ? contract(blueprint, "create") : null,
    });

    expect(context.deliverable.allowedFactualPlaceholders).not.toEqual(
      expect.arrayContaining(["[PARTICIPANT_NAME]", "[PROVIDER_ABN]", "[NDIS_NUMBER]", "[AGREEMENT_PERIOD]"]),
    );
  });

  it("does not treat an accidental empty professional requirement plan as complete", () => {
    const emptyProfile: DeliverableRequirementCoverageProfile = {
      deliverableType: "UNRESOLVED_PROFESSIONAL_DELIVERABLE",
      operation: "CREATE",
      standardisation: "general",
      requirements: [],
    };
    const report = evaluateDeliverableRequirementCoverage("All requested sections are covered.", emptyProfile);
    expect(report.requirementPlanStatus).toBe("UNRESOLVED");
    expect(report.mandatoryRequirementCount).toBe(0);
    expect(report.coveragePercentage).toBe(0);
  });

  it("fails professional execution pre-flight before LLM when capability and owner are unresolved", () => {
    const unresolvedContext = compileProfessionalExecutionContext({
      userRequest: "Produce a quantum astrology compliance charter",
      manifest: manifest({
        canonicalIntent: null,
        blueprintId: null,
        blueprintFamily: null,
        blueprintMode: null,
        primarySpecialist: "chief_of_staff",
        supportingSpecialists: [],
        selectionMetadata: null,
      }),
      blueprint: null,
      blueprintContract: null,
    });
    const profile = deriveDeliverableRequirementCoverageProfile(unresolvedContext, null);
    const requirementPlan = [];

    const preflight = validateProfessionalExecutionPreflight({
      blueprint: null,
      manifest: manifest({
        canonicalIntent: null,
        blueprintId: null,
        blueprintFamily: null,
        blueprintMode: null,
        primarySpecialist: "chief_of_staff",
        supportingSpecialists: [],
        selectionMetadata: null,
      }),
      professionalContext: unresolvedContext,
      coverageProfile: { ...profile, requirements: [] },
      requirementPlan,
      schemaCheck: { passed: true, missingRequirementIds: [] },
    });

    expect(preflight.passed).toBe(false);
    expect(preflight.failedChecks).toEqual(
      expect.arrayContaining([
        "BLUEPRINT_RESOLVED",
        "CAPABILITY_RESOLVED",
        "OPERATION_SUPPORTED",
        "DELIVERABLE_RESOLVED",
        "PROFESSIONAL_OWNER_RESOLVED",
        "REQUIREMENT_PLAN_RESOLVED",
      ]),
    );
  });

  it("passes professional execution pre-flight for a resolved onboarding task contract", () => {
    const blueprint = getRegistryEntry("people_management_review");
    expect(blueprint).toBeTruthy();
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a new staff onboarding checklist.",
      manifest: manifest(),
      blueprint: blueprint!,
      blueprintContract: contract(blueprint!, "onboarding"),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(context, contract(blueprint!, "onboarding"));
    const plan = profile.requirements.map((requirement) => ({
      requirementId: requirement.id,
      professionalRequirement: requirement.description,
      classification: requirement.classification,
      authority: [],
      applicability: "applicable" as const,
      expectedUserFacingRepresentation: requirement.requiredDeliverableRepresentation,
      targetDeliverableLocation: requirement.requiredDeliverableRepresentation,
      status: "missing" as const,
    }));

    const preflight = validateProfessionalExecutionPreflight({
      blueprint: blueprint!,
      manifest: manifest(),
      professionalContext: context,
      coverageProfile: profile,
      requirementPlan: plan,
      schemaCheck: { passed: true, missingRequirementIds: [] },
    });

    expect(preflight.passed).toBe(true);
    expect(preflight.requirementPlanStatus).toBe("RESOLVED");
  });

  it.each([
    ["Create a standard compliant NDIS Service Agreement template covering all relevant clauses.", "STANDARD_REUSABLE_NDIS_SERVICE_AGREEMENT"],
    ["Review this participant service agreement.", "PARTICIPANT_SERVICE_AGREEMENT_CONTRACT_READINESS_ASSESSMENT"],
    ["Create a standard risk assessment template.", "STANDARD_RISK_TEMPLATE"],
    ["Complete this participant risk assessment.", "PARTICIPANT_RISK_ASSESSMENT"],
    ["Create a medication policy.", "POLICY_DOCUMENT"],
    ["Review this medication policy.", "POLICY_REVIEW"],
    ["Create an incident investigation report.", "INCIDENT_INVESTIGATION_REPORT"],
  ])("preserves representative non-onboarding deliverable typing: %s", (request, deliverable) => {
    expect(deriveProfessionalIntentKey(request, null)).toBeNull();
    expect(deriveRequestedDeliverableType(request)).toBe(deliverable);
  });
});
