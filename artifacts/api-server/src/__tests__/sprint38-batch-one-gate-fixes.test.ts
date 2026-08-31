import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { getRegistryEntry } from "../services/blueprintRegistry";
import {
  classifyBracketedPlaceholderToken,
  classifyStandardTemplateEvidenceContext,
  detectUnresolvedProfessionalPlaceholders,
  validateBlueprintRuntimeCompletion,
} from "../services/blueprintRuntimeValidationService";
import {
  compileProfessionalExecutionContext,
} from "../services/professionalExecutionContextService";
import {
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
} from "../services/deliverableRequirementCoverageService";
import { validateWorkPackage } from "../services/workValidationService";
import type { EvidencePack } from "../services/knowledgeResolutionService";
import type { BlueprintExecutionContract, WorkBlueprint } from "../services/workBlueprintService";
import type { WorkPackageManifest } from "../services/workPackageService";

const root = resolve(__dirname, "..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function manifest(overrides: Partial<WorkPackageManifest> = {}): WorkPackageManifest {
  return {
    id: "manifest-batch-one",
    organizationId: "org-batch-one",
    completedWorkId: null,
    executionId: "execution-batch-one",
    taskId: "task-batch-one",
    blueprintId: "care_plan",
    blueprintVersion: "1.0.0",
    canonicalIntent: "care_plan.create",
    blueprintFamily: "care_plan",
    blueprintMode: "create",
    primarySpecialist: "service_delivery_coordinator",
    supportingSpecialists: [],
    organisationLibrarySources: [],
    cosMemories: [],
    specialistMemories: [],
    taskUploads: [],
    entityKnowledge: {},
    selectionMetadata: {
      canonicalIntent: "care_plan.create",
      blueprintFamily: "care_plan",
      blueprintMode: "create",
      requestedDeliverableType: "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE",
      deliverableStandardisation: "standard_reusable",
    },
    modelVersion: null,
    promptVersion: "sprint38",
    assembledAt: new Date("2026-08-28T00:00:00Z"),
    requesterId: "user-batch-one",
    createdAt: new Date("2026-08-28T00:00:00Z"),
    ...overrides,
  };
}

function emptyEvidencePack(): EvidencePack {
  return {
    executionId: "execution-batch-one",
    organisationId: "org-batch-one",
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

function contract(blueprint: WorkBlueprint): BlueprintExecutionContract {
  return {
    blueprint,
    sections: blueprint.sections,
    template: null,
    mode: "create",
  };
}

function syntheticBlueprint(overrides: Partial<WorkBlueprint> = {}): WorkBlueprint {
  return {
    id: "blueprint-batch-one",
    organizationId: null,
    ownerType: "platform_owned",
    code: "care_plan",
    title: "Care Plan",
    version: "1.0.0",
    blueprintFamily: "care_plan",
    category: "clinical",
    purpose: "Create a care plan.",
    professionalAuthority: "needsops_ai",
    externalAuthorityRequiredFor: [],
    supportedModes: ["create", "review"],
    maturityState: "production_ready",
    primaryDeliverable: "Care Plan",
    deliverableContract: null,
    evidenceContract: null,
    permittedOrgOverrides: {},
    defaultTemplateId: null,
    templateRequired: false,
    allowedOrgTemplateOverride: true,
    templateVersionPolicy: "pin_at_execution",
    status: "published",
    objective: "Create a care plan.",
    primarySpecialist: "service_delivery_coordinator",
    supportingSpecialists: [],
    requiredLibraryKnowledge: [],
    requiredEntityKnowledge: {},
    requiredMemories: [],
    requiredApprovals: {},
    validationRules: [],
    qualityRules: [],
    successCriteria: [],
    outputTypes: ["care_plan"],
    escalationRules: [],
    mandatoryCitations: [],
    isBuiltIn: true,
    isActive: true,
    sections: [],
    createdAt: new Date("2026-08-28T00:00:00Z"),
    updatedAt: new Date("2026-08-28T00:00:00Z"),
    ...overrides,
  };
}

const completedWork53ca2237Body = [
  "# NDIS Care Plan Template",
  "",
  "## Participant Details",
  "- **Participant Name:** [PARTICIPANT_NAME]",
  "- **NDIS Number:** [NDIS_NUMBER]",
  "- **Provider Name:** [PROVIDER_NAME]",
  "- **Provider ABN:** [PROVIDER_ABN]",
  "- **Agreement Period:** [AGREEMENT_PERIOD]",
  "",
  "## Goals and Preferences",
  "- **Goals:**",
  "  - Goal 1: [Insert goal description]",
  "  - Goal 2: [Insert goal description]",
  "- **Preferences:**",
  "  - Preferred communication methods: [Insert preferences]",
  "  - Strengths and interests: [Insert strengths]",
  "",
  "## Risks, Safeguards, and Escalation",
  "- **Known Risks:**",
  "  - [Insert known risks]",
  "- **Safeguards:**",
  "  - [Insert safeguards]",
  "- **Escalation Pathways:**",
  "  - In the event of a concern or incident, follow these escalation pathways: [Insert escalation pathways]",
  "",
  "## Signatures",
  "- **Date:** [Insert date]",
].join("\n");

describe("Sprint 38 Batch One gate fixes", () => {
  it("classifies every bracket token from Completed Work 53ca2237 and hard-fails instructional placeholders", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const request = "Create a standard comprehensive NDIS Care Plan template covering all professionally relevant areas.";
    const standardTemplateEvidence = classifyStandardTemplateEvidenceContext(request);
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });

    const tokens = [...completedWork53ca2237Body.matchAll(/\[([^\]\r\n]{2,160})\](?!\()/g)]
      .map((match) => match[1] ?? "");
    const classifications = new Map(tokens.map((token) => [
      token,
      classifyBracketedPlaceholderToken(token, standardTemplateEvidence, professionalContext),
    ]));

    expect(classifications.get("PARTICIPANT_NAME")).toBe("legitimate_factual_field");
    expect(classifications.get("NDIS_NUMBER")).toBe("legitimate_factual_field");
    const adlActivities = [
      "Personal hygiene and grooming",
      "Showering and bathing",
      "Dressing and undressing",
      "Toileting and continence",
      "Oral hygiene",
      "Eating and drinking",
      "Meal preparation",
      "Medication management",
      "Mobility within the home",
      "Transfers and positioning",
      "Bedtime and morning routines",
      "Household cleaning",
      "Laundry and clothing care",
      "Making and changing bedding",
      "Shopping for essential items",
      "Managing personal belongings",
      "Using household appliances",
      "Maintaining a safe home environment",
      "Managing daily routines",
      "Time awareness and task initiation",
      "Attending appointments",
      "Community access",
      "Transport and travel",
      "Money handling and everyday purchases",
      "Communication of daily needs",
      "Decision-making relating to daily activities",
    ];
    const toToken = (label: string) => label
      .replace(/["']/g, "")
      .replace(/&/g, " and ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase();
    expect(adlActivities.map((activity) =>
      classifyBracketedPlaceholderToken(
        `SUPPORT_LEVEL_${toToken(activity)}`,
        standardTemplateEvidence,
        professionalContext,
      ),
    )).toEqual(Array.from({ length: 26 }, () => "legitimate_factual_field"));
    expect(classifyBracketedPlaceholderToken(
      "SUPPORT_LEVEL_UNKNOWN_THING",
      standardTemplateEvidence,
      professionalContext,
    )).toBe("unresolved_professional_content");
    expect(classifications.get("PROVIDER_NAME")).toBe("unresolved_professional_content");
    expect(classifications.get("PROVIDER_ABN")).toBe("unresolved_professional_content");
    expect(classifications.get("AGREEMENT_PERIOD")).toBe("unresolved_professional_content");
    expect(classifications.get("Insert goal description")).toBe("unresolved_professional_content");
    expect(classifications.get("Insert known risks")).toBe("unresolved_professional_content");

    const findings = detectUnresolvedProfessionalPlaceholders(
      completedWork53ca2237Body,
      standardTemplateEvidence,
      professionalContext,
    );
    expect(findings).toEqual(expect.arrayContaining([
      "[Insert goal description]",
      "[Insert known risks]",
      "[Insert date]",
      "[PROVIDER_NAME]",
      "[PROVIDER_ABN]",
      "[AGREEMENT_PERIOD]",
    ]));
  });

  it("reports all unmet declared evidence and memory requirements while allowing standard reusable work to proceed", () => {
    const blueprint = syntheticBlueprint({
      requiredLibraryKnowledge: ["care_plan", "policy", "legislation"],
      requiredMemories: ["operating_preference"],
    });

    const result = validateWorkPackage(
      manifest(),
      blueprint,
      emptyEvidencePack(),
      {
        standardTemplateEvidence: classifyStandardTemplateEvidenceContext(
          "Create a standard comprehensive NDIS Care Plan template.",
        ),
      },
    );

    expect(result.passed).toBe(true);
    expect(result.recommendedAction).toBe("proceed");
    expect(result.missingItems).toEqual(expect.arrayContaining([
      "Care Plan",
      "Organisation Policy",
      "Legislation",
      "Operating Preference",
    ]));
    expect(result.summary).toContain("proceeding with unmet evidence/context requirements");
    expect(result.summary).not.toContain("validated");
    expect(result.missingEvidenceItems.every((item) => item.required === false)).toBe(true);
  });

  it("allows declared factual placeholders in standard reusable templates but still hard-fails instructions", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const request = "Create a standard comprehensive NDIS Care Plan template.";
    const standardTemplateEvidence = classifyStandardTemplateEvidenceContext(request);
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });

    const gate = validateBlueprintRuntimeCompletion({
      contract: contract(blueprint),
      contentMarkdown: completedWork53ca2237Body,
      evidencePack: emptyEvidencePack(),
      artifactId: "artifact",
      deferApprovalGate: true,
      standardTemplateEvidence,
      professionalContext,
    });

    expect(gate.failures.some((failure) =>
      failure.gate === "professional_placeholder" &&
      failure.details?.includes("[Insert goal description]") &&
      failure.details?.includes("[Insert known risks]"),
    )).toBe(true);
    expect(gate.failures.find((failure) => failure.gate === "professional_placeholder")?.details)
      .not.toEqual(expect.arrayContaining(["[PARTICIPANT_NAME]", "[NDIS_NUMBER]"]));
  });

  it("fails coverage when structured sections contain 14 sections but persisted markdown contains only 5", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const request = "Create a standard comprehensive NDIS Care Plan template.";
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract(blueprint));
    const fullStructuredSections = profile.requirements.slice(0, 14).map((requirement, index) => ({
      requirementId: requirement.id,
      heading: `Section ${index + 1}`,
      content: [
        `Complete structured content for ${requirement.description}.`,
        ...(requirement.templateCriteria.length > 0 ? requirement.templateCriteria : requirement.adequacyCriteria),
      ].join(" "),
    }));
    const truncatedMarkdown = fullStructuredSections.slice(0, 5)
      .map((section) => `## ${section.heading}\n\n${section.content}`)
      .join("\n\n");

    const coverage = evaluateDeliverableRequirementCoverage(truncatedMarkdown, profile, {
      deliverableSections: fullStructuredSections,
    });

    expect(coverage.missing).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requirementId: "__deliverable_section_integrity__",
        reason: expect.stringContaining("markdown section count (5) does not match structured deliverable section count (14)"),
      }),
    ]));
    expect(coverage.missingCount).toBeGreaterThan(0);
  });

  it("keeps participant-specific placeholder enforcement strict even for declared care-plan fields", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const request = "Complete a care plan for participant Alex.";
    const reusableEvidence = classifyStandardTemplateEvidenceContext("Create a standard comprehensive NDIS Care Plan template.");
    const reusableContext = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const participantContext = {
      ...reusableContext,
      specificity: "PARTICIPANT_SPECIFIC" as const,
      deliverable: {
        ...reusableContext.deliverable,
        standardisation: "participant_specific" as const,
      },
    };

    expect(classifyBracketedPlaceholderToken(
      "NDIS_NUMBER",
      reusableEvidence,
      participantContext,
    )).toBe("unresolved_professional_content");

    const findings = detectUnresolvedProfessionalPlaceholders(
      "Participant NDIS Number: [NDIS_NUMBER]",
      reusableEvidence,
      participantContext,
    );
    expect(findings).toEqual(["[NDIS_NUMBER]"]);
  });

  it("resolves the standard NDIS care plan template request deterministically across repeated context compilation", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const request = "Create a standard NDIS care plan template";

    const contexts = Array.from({ length: 10 }, () => compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest({
        selectionMetadata: {
          canonicalIntent: "care_plan.create",
          blueprintFamily: "care_plan",
          blueprintMode: "create",
          requestedDeliverableType: "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE",
          deliverableStandardisation: "standard_reusable",
        },
      }),
      blueprint,
      blueprintContract: contract(blueprint),
    }));

    expect(contexts.map((context) => context.specificity))
      .toEqual(Array.from({ length: 10 }, () => "STANDARD_NON_PARTICIPANT_SPECIFIC"));
    expect(contexts.map((context) => context.deliverable.standardisation))
      .toEqual(Array.from({ length: 10 }, () => "standard_reusable"));
    expect(contexts.map((context) => context.deliverable.requestedDeliverableType))
      .toEqual(Array.from({ length: 10 }, () => "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE"));
  });

  it("does not let standard reusable manifest metadata override an explicit participant-specific care plan request", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const context = compileProfessionalExecutionContext({
      userRequest: "Create a care plan for participant Michael.",
      manifest: manifest({
        selectionMetadata: {
          canonicalIntent: "care_plan.create",
          blueprintFamily: "care_plan",
          blueprintMode: "create",
          requestedDeliverableType: "STANDARD_REUSABLE_NDIS_CARE_PLAN_TEMPLATE",
          deliverableStandardisation: "standard_reusable",
        },
      }),
      blueprint,
      blueprintContract: contract(blueprint),
    });

    expect(context.specificity).toBe("PARTICIPANT_SPECIFIC");
    expect(context.deliverable.standardisation).toBe("participant_specific");
    expect(context.deliverable.requestedDeliverableType).toBe("PARTICIPANT_NDIS_CARE_PLAN");
  });

  it("keeps sub-threshold self-review output in draft instead of moving it to awaiting approval", () => {
    const uee = source("services/unifiedExecutionEngine.ts");
    expect(uee).toContain("const qualityGatePassed = reviewResult.passed");
    expect(uee).toContain("const requiresApproval = qualityGatePassed &&");
    expect(uee).toContain('failedStage: "quality_review"');
    expect(uee).toContain("Draft is saved but cannot move to awaiting approval");
  });

  it("persists exact gate failure details synchronously and does not swallow persistence failures", () => {
    const uee = source("services/unifiedExecutionEngine.ts");
    const gateFailurePath = uee.slice(
      uee.indexOf("if (!runtimeGate.passed)"),
      uee.indexOf('await progress("creating_completed_work")'),
    );
    const snapshotPersistence = uee.slice(
      uee.indexOf("async function recordProfessionalSnapshot"),
      uee.indexOf("async function persistInlineExecutionSession"),
    );
    const sessionPersistence = uee.slice(
      uee.indexOf("async function persistInlineExecutionSession"),
      uee.indexOf("function buildCompletionMessage"),
    );

    expect(gateFailurePath).toContain("await updateManifestObservability");
    expect(gateFailurePath).toContain("gateFailures: runtimeGate.failures");
    expect(gateFailurePath).toContain("buildRuntimeGateFailureItems(runtimeGate.failures)");
    expect(snapshotPersistence).toContain("throw err");
    expect(sessionPersistence).toContain("throw err");
    expect(gateFailurePath).not.toContain("}).catch(() => {})");
  });
});
