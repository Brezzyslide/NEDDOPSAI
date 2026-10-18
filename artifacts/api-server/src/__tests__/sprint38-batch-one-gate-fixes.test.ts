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
  assembleDeliverableMarkdownFromSections,
  verifySpanDetailed,
} from "../services/claimValidationService";
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

function evidencePackWithChunk(chunk: Partial<EvidencePack["chunks"][number]> & { chunkId: string; text: string }): EvidencePack {
  return {
    ...emptyEvidencePack(),
    chunks: [{
      sourceId: "source-1",
      sourceVersionId: "version-1",
      sourceTitle: "20260324 MR NDIS CBSP (Updated Sexualised Behaviour)",
      versionLabel: null,
      sourceType: "participant_document",
      documentCategory: "behaviour_support_plan",
      evidenceClass: "PROFESSIONAL_SOURCE",
      authorityLevel: "primary",
      sectionTitle: null,
      pageNumber: 1,
      confidence: 0.9,
      citation: "CBSP p. 1",
      selectionReason: "test",
      ...chunk,
    }],
    sourceIds: ["source-1"],
    totalChunks: 1,
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

  it("allows participant completion placeholders only on declared completion-field lines", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const participantContext = compileProfessionalExecutionContext({
      userRequest: "Create a care plan for Micheal Rocca.",
      manifest: manifest({
        canonicalIntent: "care_plan.create",
        blueprintFamily: "care_plan",
        blueprintMode: "create",
        blueprintId: "care_plan",
        selectionMetadata: {
          canonicalIntent: "care_plan.create",
          blueprintFamily: "care_plan",
          blueprintMode: "create",
          requestedDeliverableType: "PARTICIPANT_NDIS_CARE_PLAN",
          deliverableStandardisation: "participant_specific",
        },
      }),
      blueprint,
      blueprintContract: contract(blueprint),
      subjectParticipantIds: ["participant-micheal"],
    });

    const content = [
      "## Mealtime Management Strategy",
      "The mealtime management risk assessment is not recorded in the retrieved evidence. Workers provide ordinary supervision and report any change in eating or drinking.",
      "",
      "## Document Control",
      "**Form ID:** [To be completed]",
      "**Version:** 1.0",
      "**Date:** [To be completed]",
      "**Next Review Date:** 19/02/2027",
    ].join("\n");

    expect(detectUnresolvedProfessionalPlaceholders(
      content,
      null,
      participantContext,
      contract(blueprint),
    )).toEqual([]);

    expect(detectUnresolvedProfessionalPlaceholders(
      "## Mealtime Management Strategy\nBased on the mealtime management risk assessment dated [DATE], no hands-on mealtime strategy is required.",
      null,
      participantContext,
      contract(blueprint),
    )).toEqual(["[DATE]"]);
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

  it("ignores blocked-draft presentation sections and compares ADL using the rendered structured rows", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const request = "Create a care plan for participant Alex.";
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract(blueprint));
    const structuredSections = profile.requirements.slice(0, 14).map((requirement, index) => ({
      requirementId: requirement.id,
      heading: requirement.id === "care-plan-undertaking-adl" ? "Undertaking ADL" : `Section ${index + 1}`,
      content: requirement.id === "care-plan-undertaking-adl"
        ? "Model supplied ADL prose that is superseded by structuredRows."
        : [
          `Complete structured content for ${requirement.description}.`,
          ...(requirement.templateCriteria.length > 0 ? requirement.templateCriteria : requirement.adequacyCriteria),
        ].join(" "),
      structuredRows: requirement.id === "care-plan-undertaking-adl"
        ? [{
          activity: "Eating and drinking",
          supportLevel: "Independent",
          workerDescription: "Worker monitors only.",
          sourceValue: "Independent",
          chunkId: "chunk-adl-1",
          mappingMode: "VERIFIED_MAPPING" as const,
        }]
        : undefined,
    }));
    const deliverableMarkdown = assembleDeliverableMarkdownFromSections(structuredSections, profile.requirements.map((requirement) => requirement.id));
    const blockedDraftMarkdown = [
      deliverableMarkdown,
      "## Unapproved Draft Blocked",
      "This presentation banner is not a deliverable section.",
      "## Gate Failures",
      "- mandatory_deliverable_coverage",
      "## Suppression Records",
      "- Suppressed provider claim.",
    ].join("\n\n");

    const coverage = evaluateDeliverableRequirementCoverage(blockedDraftMarkdown, profile, {
      deliverableSections: structuredSections,
    });

    expect(coverage.missing).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        requirementId: "__deliverable_section_integrity__",
      }),
    ]));
  });

  it("does not span-verify authored fixed content as if it were evidence", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: "Create a care plan for participant Alex.",
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract(blueprint));
    const fixedContent = "The strategies below implement the participant's behaviour support plan. They do not replace it. Workers must read the behaviour support plan before their first shift.";
    const coverage = evaluateDeliverableRequirementCoverage(`## Behavioural Management\n\n${fixedContent}\n\nProactive, reactive and protective strategies from the behaviour support plan tell workers what to do.`, profile, {
      deliverableSections: [{
        requirementId: "care-plan-behavioural-management",
        heading: "Behavioural Management",
        content: `${fixedContent}\n\nProactive, reactive and protective strategies from the behaviour support plan tell workers what to do.`,
        evidenceSources: [{
          chunkId: "chunk-fixed-content",
          documentTitle: "CBSP",
          passage: fixedContent,
          location: "CBSP p. 1",
          evidenceClass: "blueprint_fixed_content",
        }],
      }],
      evidencePack: evidencePackWithChunk({
        chunkId: "chunk-fixed-content",
        text: "The retrieved BSP chunk contains participant-specific strategies but not the authored provider preamble.",
      }),
    });
    const behavioural = coverage.requirementResults.find((item) => item.requirementId === "care-plan-behavioural-management");

    expect(behavioural?.citationFindings ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "UNSUPPORTED_CITATION",
        citedText: fixedContent,
      }),
    ]));
  });

  it("classifies source-supported paraphrase as cited interpretation instead of unsupported span", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: "Create a care plan for participant Alex.",
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract(blueprint));
    const paraphrase = "Michael is a sociable, resourceful and resilient person and possesses a warm and engaging personality when he is calm and regulated.";
    const coverage = evaluateDeliverableRequirementCoverage(`## About Me\n\n${paraphrase}`, profile, {
      deliverableSections: [{
        requirementId: "care-plan-about-me",
        heading: "About Me",
        content: paraphrase,
        evidenceSources: [{
          chunkId: "chunk-about-me",
          documentTitle: "CBSP",
          passage: paraphrase,
          location: "CBSP p. 3",
          evidenceClass: "participant_document",
          citationMode: "SUPPORTING_INTERPRETATION",
        }],
      }],
      evidencePack: evidencePackWithChunk({
        chunkId: "chunk-about-me",
        text: "Michael is sociable and warm when calm. He shows resilience, can be resourceful, and presents with an engaging personality when he is regulated.",
      }),
    });
    const aboutMe = coverage.requirementResults.find((item) => item.requirementId === "care-plan-about-me");

    expect(aboutMe?.citationFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "CITED_INTERPRETATION",
        passed: true,
        citedText: paraphrase,
      }),
    ]));
    expect(aboutMe?.citationFindings ?? []).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "UNSUPPORTED_CITATION",
        citedText: paraphrase,
      }),
    ]));
  });

  it("fails a cited interpretation when the cited chunk does not support the assertion", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: "Create a care plan for participant Alex.",
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract(blueprint));
    const unsupported = "Michael uses a wheelchair and requires two workers for all transfers.";
    const coverage = evaluateDeliverableRequirementCoverage(`## Mobility and Mobility Strategy\n\n${unsupported}`, profile, {
      deliverableSections: [{
        requirementId: "care-plan-mobility-strategy",
        heading: "Mobility and Mobility Strategy",
        content: unsupported,
        evidenceSources: [{
          chunkId: "chunk-mobility",
          documentTitle: "Intake checklist",
          passage: unsupported,
          location: "Intake p. 2",
          evidenceClass: "participant_document",
          citationMode: "SUPPORTING_INTERPRETATION",
        }],
      }],
      evidencePack: evidencePackWithChunk({
        chunkId: "chunk-mobility",
        text: "The intake checklist records walking without support and transfers to and from bed without support.",
      }),
    });
    const mobility = coverage.requirementResults.find((item) => item.requirementId === "care-plan-mobility-strategy");

    expect(mobility?.citationFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "UNSUPPORTED_CITATION",
        passed: false,
        citedText: unsupported,
      }),
    ]));
  });

  it("fails an inverted mobility interpretation against a without-support chunk", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: "Create a care plan for participant Alex.",
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract(blueprint));
    const inverted = "Michael requires staff assistance for transfers.";
    const coverage = evaluateDeliverableRequirementCoverage(`## Mobility and Mobility Strategy\n\n${inverted}`, profile, {
      deliverableSections: [{
        requirementId: "care-plan-mobility-strategy",
        heading: "Mobility and Mobility Strategy",
        content: inverted,
        evidenceSources: [{
          chunkId: "chunk-without-support",
          documentTitle: "Intake checklist",
          passage: inverted,
          location: "Intake p. 2",
          evidenceClass: "participant_document",
          citationMode: "SUPPORTING_INTERPRETATION",
        }],
      }],
      evidencePack: evidencePackWithChunk({
        chunkId: "chunk-without-support",
        text: "The intake checklist records walking without support and Transfer to/from bed: Without support.",
      }),
    });
    const mobility = coverage.requirementResults.find((item) => item.requirementId === "care-plan-mobility-strategy");

    expect(mobility?.citationFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        mode: "UNSUPPORTED_CITATION",
        passed: false,
        citedText: inverted,
      }),
    ]));
  });

  it("renders ADL and Mobility without provenance columns while preserving structured gate input", () => {
    const mobilityRows = [{
      activity: "Transfer method",
      supportLevel: "Transfers to and from bed without support.",
      workerDescription: "Allow independent bed transfers and escalate any change in falls risk.",
      sourceValue: "Transfer to/from bed: Without support",
      chunkId: "chunk-transfer",
      mappingMode: "VERIFIED_MAPPING" as const,
      derivedGuidance: {
        text: "Allow independent bed transfers and escalate any change in falls risk.",
        provenance: "SYSTEM_DERIVED" as const,
        basisField: "Transfer method",
      },
    }];
    const adlRows = [{
      activity: "Transfers and positioning",
      supportLevel: "Independent",
      workerDescription: "Michael completes transfers without assistance.",
      sourceValue: "Transfer to/from bed: Without support",
      chunkId: "chunk-transfer",
      mappingMode: "VERIFIED_MAPPING" as const,
    }];
    const markdown = assembleDeliverableMarkdownFromSections([
      {
        requirementId: "care-plan-undertaking-adl",
        heading: "Undertaking ADL",
        content: "Structured ADL rows supplied.",
        structuredRows: adlRows,
      },
      {
        requirementId: "care-plan-mobility-strategy",
        heading: "Mobility and Mobility Strategy",
        content: "Structured mobility rows supplied.",
        structuredRows: mobilityRows,
      },
    ]);

    expect(markdown).toContain("| Activity | Support level | What the worker does |");
    expect(markdown).toContain("| Field | Value | Worker guidance |");
    expect(markdown).not.toContain("Chunk ID");
    expect(markdown).not.toContain("Mapping mode");
    expect(markdown).not.toContain("Guidance provenance");
    expect(markdown).not.toContain("chunk-transfer");
    expect(markdown).not.toContain("VERIFIED_MAPPING");
  });

  it("keeps gate results stable when provenance columns are not rendered", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: "Create a care plan for participant Alex.",
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const profile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract(blueprint));
    const mobilityRows = [{
      activity: "Transfer method",
      supportLevel: "Transfers to and from bed without support.",
      workerDescription: "Allow independent bed transfers and escalate any change in falls risk.",
      sourceValue: "Transfer to/from bed: Without support",
      chunkId: "chunk-transfer",
      mappingMode: "VERIFIED_MAPPING" as const,
    }];
    const structuredSection = {
      requirementId: "care-plan-mobility-strategy",
      heading: "Mobility and Mobility Strategy",
      content: "| Field | Value | Worker guidance |\n| --- | --- | --- |\n| Transfer method | Transfers to and from bed without support. | Allow independent bed transfers and escalate any change in falls risk. |",
      structuredRows: mobilityRows,
    };
    const publicMarkdown = assembleDeliverableMarkdownFromSections([structuredSection]);
    const provenanceMarkdown = [
      "## Mobility and Mobility Strategy",
      "",
      "| Field | Value | Source value | Chunk ID | Mapping mode | Worker guidance |",
      "| --- | --- | --- | --- | --- | --- |",
      "| Transfer method | Transfers to and from bed without support. | Transfer to/from bed: Without support | chunk-transfer | VERIFIED_MAPPING | Allow independent bed transfers and escalate any change in falls risk. |",
    ].join("\n");
    const publicCoverage = evaluateDeliverableRequirementCoverage(publicMarkdown, profile, {
      deliverableSections: [structuredSection],
      evidencePack: evidencePackWithChunk({
        chunkId: "chunk-transfer",
        text: "Transfer to/from bed: Without support. Walk without aid: Without support.",
      }),
    });
    const provenanceCoverage = evaluateDeliverableRequirementCoverage(provenanceMarkdown, profile, {
      deliverableSections: [structuredSection],
      evidencePack: evidencePackWithChunk({
        chunkId: "chunk-transfer",
        text: "Transfer to/from bed: Without support. Walk without aid: Without support.",
      }),
    });

    expect(publicCoverage.requirementResults.find((item) => item.requirementId === "care-plan-mobility-strategy")?.finalResult)
      .toBe(provenanceCoverage.requirementResults.find((item) => item.requirementId === "care-plan-mobility-strategy")?.finalResult);
    expect(publicCoverage.missing.map((item) => item.requirementId))
      .toEqual(provenanceCoverage.missing.map((item) => item.requirementId));
  });

  it("treats adjacent care-plan date labels as separate declared fields", () => {
    const blueprint = getRegistryEntry("care_plan");
    if (!blueprint) throw new Error("missing care_plan blueprint");
    const request = "Create a care plan for participant Alex.";
    const professionalContext = compileProfessionalExecutionContext({
      userRequest: request,
      manifest: manifest(),
      blueprint,
      blueprintContract: contract(blueprint),
    });
    const supportPlanSection = {
      requirementId: "care-plan-support-plan-meeting",
      heading: "Support Plan Meeting",
      content: "**Plan Date:** 2026-10-15 **Date for Review:** 2027-10-15",
    };
    const content = assembleDeliverableMarkdownFromSections([supportPlanSection]);

    const gate = validateBlueprintRuntimeCompletion({
      contract: contract(blueprint),
      contentMarkdown: content,
      evidencePack: emptyEvidencePack(),
      artifactId: "artifact",
      deferApprovalGate: true,
      professionalContext,
      deliverableSections: [supportPlanSection],
    });

    expect(gate.failures).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        gate: "mechanical_gate",
        message: expect.stringContaining("Review date must be later than the plan date"),
      }),
    ]));
  });

  it("verifies CBSP goal passages when the model adds a trailing editorial ellipsis", () => {
    const cbspChunk = [
      "Outcome Measures",
      "(linked to each goal)",
      "- Support staff and Behaviour",
      "Support Practitioner to",
      "monitor and review goals",
      "- GAS reviewed on a regular",
      "basis as determined by Team",
    ].join("\n");

    const result = verifySpanDetailed(
      "Support staff and Behaviour Support Practitioner to monitor and review goals...",
      cbspChunk,
    );

    expect(result.verified).toBe(true);
    expect(result.byteExact).toBe(false);
    expect(result.normalisedSpan).toBe("support staff and behaviour support practitioner to monitor and review goals");
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
      contract(blueprint),
    )).toBe("unresolved_professional_content");

    expect(classifyBracketedPlaceholderToken(
      "Insert date",
      reusableEvidence,
      participantContext,
      contract(blueprint),
    )).toBe("unresolved_professional_content");
    expect(classifyBracketedPlaceholderToken(
      "Insert date, later than plan date",
      reusableEvidence,
      participantContext,
      contract(blueprint),
    )).toBe("unresolved_professional_content");
    expect(classifyBracketedPlaceholderToken(
      "Insert contact details",
      reusableEvidence,
      participantContext,
      contract(blueprint),
    )).toBe("unresolved_professional_content");
    expect(classifyBracketedPlaceholderToken(
      "BSP Reference",
      reusableEvidence,
      participantContext,
      contract(blueprint),
    )).toBe("unresolved_professional_content");

    const findings = detectUnresolvedProfessionalPlaceholders(
      "Plan date: [Insert date]\nDate for review: [Insert date, later than plan date]\nOn-call contact: [Insert contact details]\nBSP source: [BSP Reference]\nParticipant NDIS Number: [NDIS_NUMBER]",
      reusableEvidence,
      participantContext,
      contract(blueprint),
    );
    expect(findings).toEqual(["[BSP Reference]", "[NDIS_NUMBER]"]);
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
    expect(uee).toContain("const qualityGatePassed = reviewResult.passed ?? reviewPassed(reviewResult)");
    expect(uee).toContain("const requiresApproval = !approvalBlockedByCompletionGates && qualityGatePassed &&");
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
    expect(gateFailurePath).toContain("const blockingFailures = completionGateDisposition.hardFailures.length > 0");
    expect(gateFailurePath).toContain("gateFailures: blockingFailures");
    expect(gateFailurePath).toContain("buildRuntimeGateFailureItems(blockingFailures)");
    expect(snapshotPersistence).toContain("throw err");
    expect(sessionPersistence).toContain("throw err");
    expect(gateFailurePath).not.toContain("}).catch(() => {})");
  });
});
