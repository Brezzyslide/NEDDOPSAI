import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { planTask } from "../services/chiefOfStaffService";
import { getRegistryEntry } from "../services/blueprintRegistry";
import { resolveIntent } from "../services/blueprintIntentMap";
import {
  classifyStandardTemplateEvidenceContext,
  validateBlueprintRuntimeCompletion,
} from "../services/blueprintRuntimeValidationService";
import { compileProfessionalExecutionContext } from "../services/professionalExecutionContextService";
import type { BlueprintExecutionContract, WorkBlueprint } from "../services/workBlueprintService";
import type { EvidencePack } from "../services/knowledgeResolutionService";
import type { WorkPackageManifest } from "../services/workPackageService";

const root = resolve(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function contract(blueprint: WorkBlueprint, mode: string): BlueprintExecutionContract {
  return { blueprint, sections: blueprint.sections, template: null, mode };
}

function manifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id: "manifest-integration",
    organizationId: "org-integration",
    completedWorkId: null,
    executionId: "execution-integration",
    taskId: "task-integration",
    blueprintId: "service_agreement_review",
    blueprintVersion: "1.0.0",
    canonicalIntent: "agreements.create",
    blueprintFamily: "agreements",
    blueprintMode: "create",
    primarySpecialist: "policy_governance_specialist",
    supportingSpecialists: [],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    taskUploads: [],
    entityKnowledge: {},
    selectionMetadata: {},
    modelVersion: null,
    promptVersion: "sprint39-integration",
    assembledAt: new Date("2026-08-28T00:00:00Z"),
    requesterId: "user-integration",
    createdAt: new Date("2026-08-28T00:00:00Z"),
    ...overrides,
  };
}

function emptyEvidencePack(): EvidencePack {
  return {
    executionId: "execution-integration",
    organisationId: "org-integration",
    resolvedAt: new Date("2026-08-28T00:00:00Z"),
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
      retrievalMs: 1,
      embeddingUsed: false,
      embeddingMs: 0,
    },
  };
}

function runGate(input: {
  request: string;
  intent: string;
  contentMarkdown: string;
}) {
  const intent = resolveIntent(input.intent);
  expect(intent).toBeTruthy();
  const blueprint = getRegistryEntry(intent!.code);
  expect(blueprint).toBeTruthy();
  const blueprintContract = contract(blueprint!, intent!.mode);
  const ctx = compileProfessionalExecutionContext({
    userRequest: input.request,
    manifest: manifest({
      blueprintId: intent!.code,
      canonicalIntent: input.intent,
      blueprintFamily: intent!.family,
      blueprintMode: intent!.mode,
      primarySpecialist: blueprint!.primarySpecialist,
      supportingSpecialists: blueprint!.supportingSpecialists,
    }),
    blueprint: blueprint!,
    blueprintContract,
  });
  const gate = validateBlueprintRuntimeCompletion({
    contract: blueprintContract,
    contentMarkdown: input.contentMarkdown,
    evidencePack: emptyEvidencePack(),
    artifactId: "artifact-integration",
    deferApprovalGate: true,
    standardTemplateEvidence: classifyStandardTemplateEvidenceContext(input.request),
    professionalContext: ctx,
  });
  return {
    gate,
    terminalState: gate.passed ? "completed" : "gate_failed",
    gateNames: gate.failures.map((failure) => failure.gate),
  };
}

describe("Sprint 39 integration release readiness", () => {
  it("keeps proposal confirmation wired to one task creation path", () => {
    const ingress = source("services/messageIngressService.ts");
    expect(ingress).toContain("getLatestTaskProposalConfirmation");
    expect(ingress).toContain("answer.kind === \"confirm\" && input.confirmation.action === \"NEW_TASK\"");
    expect(ingress).toContain("autoCreateAndDispatch({");
    expect(ingress).toContain("idempotencyKey: `conversation_confirmation:${input.confirmation.id}`");
  });

  it("routes confirmed Service Agreement, onboarding and Care Plan requests to professional intents", () => {
    expect(planTask("Create a standard NDIS Service Agreement")).toMatchObject({
      intent: "agreements.create",
      primarySpecialist: "policy_governance_specialist",
    });
    expect(planTask("Can you give me a checklist for onboarding a new staff")).toMatchObject({
      intent: "people.onboarding",
      primarySpecialist: "people_culture_manager",
    });
    expect(planTask("Create a standard comprehensive NDIS Care Plan template")).toMatchObject({
      intent: "care_plan.create",
      primarySpecialist: "service_delivery_coordinator",
    });
  });

  it("derives participant-specific mode from bound subject participants before text", () => {
    const intent = resolveIntent("care_plan.create");
    expect(intent).toBeTruthy();
    const blueprint = getRegistryEntry(intent!.code);
    expect(blueprint).toBeTruthy();
    const ctx = compileProfessionalExecutionContext({
      userRequest: "Develop a comprehensive care plan tailored for John Deo",
      subjectParticipantIds: ["participant-john-doe"],
      manifest: manifest({
        blueprintId: intent!.code,
        canonicalIntent: "care_plan.create",
        blueprintFamily: intent!.family,
        blueprintMode: intent!.mode,
        primarySpecialist: blueprint!.primarySpecialist,
        selectionMetadata: { deliverableStandardisation: "standard_reusable" },
      }),
      blueprint: blueprint!,
      blueprintContract: contract(blueprint!, intent!.mode),
    });

    expect(ctx.subjectParticipantIds).toEqual(["participant-john-doe"]);
    expect(ctx.deliverable.standardisation).toBe("participant_specific");
    expect(ctx.specificity).toBe("PARTICIPANT_SPECIFIC");
  });

  it("blocks deterministic template bypass when a subject participant is bound", () => {
    const uee = source("services/unifiedExecutionEngine.ts");
    const renderFunction = uee.slice(
      uee.indexOf("function renderDeterministicStandardTemplateDraft"),
      uee.indexOf("function fallbackDraft", uee.indexOf("function renderDeterministicStandardTemplateDraft")),
    );
    const assembleFunction = uee.slice(
      uee.indexOf("function assembleTemplateSectionsForContext"),
      uee.indexOf("function renderDeterministicStandardTemplateDraft"),
    );

    expect(renderFunction).toContain("(professionalContext.subjectParticipantIds?.length ?? 0) > 0");
    expect(assembleFunction).toContain("(professionalContext.subjectParticipantIds?.length ?? 0) > 0");
  });

  it("runs completion gates to terminal pass/fail outcomes after task creation", () => {
    const serviceAgreement = runGate({
      request: "Create a standard NDIS Service Agreement",
      intent: "agreements.create",
      contentMarkdown: [
        "# Standard NDIS Service Agreement",
        "## Parties and Agreement Basis",
        "Provider, participant/representative, NDIS number, agreement period and authority details are captured in labelled fields.",
        "## Schedule of Supports",
        "| NDIS Support Item/Code | Support Description | Unit/Basis | Quantity/Frequency | Unit Price/Rate | Service Period | Total/Subtotal | Agreement Period Total |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        "| Enter support item code | Enter support description | Enter unit basis | Enter quantity/frequency | Enter unit price/rate | Enter service period | Calculate line subtotal | Calculate agreement-period total |",
        "## Provider Responsibilities",
        "The provider must deliver supports safely, lawfully, respectfully and in line with agreed support arrangements, privacy obligations, incident/escalation duties, records, communication and billing responsibilities.",
        "## Participant and Representative Responsibilities",
        "The participant or representative should provide current plan and contact information, communicate support needs and changes, engage respectfully, give required notice and pay agreed non-NDIS costs where applicable.",
        "## Rights, Privacy, Complaints and Advocacy",
        "The participant retains choice and control, privacy and confidentiality protections, access to advocacy, and a usable complaints pathway including provider contact, escalation and external options.",
        "## Pricing, Payment and Adjustments",
        "The agreement explains NDIS pricing, payment source, invoicing, non-NDIS costs, GST treatment where relevant, price changes, plan changes and notice of adjustment.",
        "## Cancellation, No-show and Rescheduling",
        "Cancellation and no-show terms explain required notice, late-cancellation consequences, rescheduling options, provider cancellation and recordkeeping.",
        "## Variation and Amendment",
        "Changes require documented agreement, effective date, affected supports/pricing and updated copies for parties.",
        "## Termination, Exit and Transition",
        "Termination covers notice, immediate safety exceptions, final payments, records, handover and transition to another provider.",
        "## Continuity, Emergency and Disaster",
        "Continuity arrangements identify critical supports, emergency contacts, disruption communication and temporary service changes.",
        "## Signatures and Acceptance",
        "Provider and participant/representative signature, name, role, date and acceptance fields are included.",
      ].join("\n"),
    });
    expect(serviceAgreement.terminalState).toMatch(/completed|gate_failed/);
    expect(serviceAgreement.gateNames).not.toContain("professional_placeholder");

    const onboarding = runGate({
      request: "Can you give me a checklist for onboarding a new staff",
      intent: "people.onboarding",
      contentMarkdown: [
        "# Staff Onboarding Checklist",
        "## Staff Details",
        "| Staff Name | Role | Start Date | Manager | Employment Type |",
        "| --- | --- | --- | --- | --- |",
        "| [STAFF_NAME] | [ROLE] | [START_DATE] | [MANAGER] | [EMPLOYMENT_TYPE] |",
        "## Pre-start Checks",
        "- Confirm right-to-work, role requirements, required screening and qualification evidence before commencement.",
        "- Issue employment documentation and capture acknowledgements.",
        "## Induction and Training",
        "- Complete organisation induction, role-specific training, mandatory compliance learning and supervisor check-in.",
        "## Systems, Equipment and Records",
        "- Provision approved access, equipment, payroll/HR records and completion evidence.",
        "## Sign-off",
        "- Hiring manager and staff member sign off completion and outstanding actions.",
      ].join("\n"),
    });
    expect(onboarding.terminalState).toMatch(/completed|gate_failed/);

    const carePlan = runGate({
      request: "Create a standard comprehensive NDIS Care Plan template",
      intent: "care_plan.create",
      contentMarkdown: [
        "# NDIS Care Plan Template",
        "## Participant Details",
        "- Participant Name: [PARTICIPANT_NAME]",
        "- NDIS Number: [NDIS_NUMBER]",
        "## Goals and Preferences",
        "- Goal 1: [Insert goal description]",
        "## Risks, Safeguards and Escalation",
        "- [Insert known risks]",
      ].join("\n"),
    });
    expect(carePlan.terminalState).toBe("gate_failed");
    expect(carePlan.gateNames).toContain("professional_placeholder");
    expect(carePlan.gate.failures.find((failure) => failure.gate === "professional_placeholder")?.details)
      .toEqual(expect.arrayContaining(["[Insert goal description]", "[Insert known risks]"]));
  });

  it("prevents sub-70 quality from moving to awaiting approval", () => {
    const uee = source("services/unifiedExecutionEngine.ts");
    expect(uee).toContain("const qualityGatePassed = reviewResult.passed");
    expect(uee).toContain("const requiresApproval = qualityGatePassed &&");
    expect(uee).toContain('failedStage: "quality_review"');
    expect(uee).toContain("Draft is saved but cannot move to awaiting approval");
  });

  it("renders non-computable governance metrics explicitly instead of as zero or a spinner", () => {
    const ui = source("../../needsops-web/src/pages/app/GovernanceCentre.tsx");
    expect(ui).toContain("memoryHealthScore:       number | null");
    expect(ui).toContain("governanceScore:         number | null");
    expect(ui).toContain('metrics.governanceScore === null ? "-"');
    expect(ui).toContain('metrics.memoryHealthScore === null ? "Not enough data"');
  });
});
