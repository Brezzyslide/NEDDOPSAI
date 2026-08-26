import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { getRegistryEntry } from "../services/blueprintRegistry";
import { resolveIntent } from "../services/blueprintIntentMap";
import {
  compileProfessionalExecutionContext,
  deriveProfessionalIntentKey,
  deriveProfessionalOperation,
} from "../services/professionalExecutionContextService";
import type { BlueprintExecutionContract } from "../services/workBlueprintService";
import type { WorkPackageManifest } from "../services/workPackageService";
import { parseSpecialistJsonOutput } from "../services/claimValidationService";
import { planTask } from "../services/chiefOfStaffService";

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
});
