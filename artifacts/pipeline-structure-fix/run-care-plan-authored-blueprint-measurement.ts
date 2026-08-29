import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getRegistryEntry } from "../api-server/src/services/blueprintRegistry.js";
import {
  compileProfessionalExecutionContext,
  buildProfessionalExecutionContextBlock,
} from "../api-server/src/services/professionalExecutionContextService.js";
import {
  buildDeliverableOutputSchema,
  deriveDeliverableRequirementCoverageProfile,
  evaluateDeliverableRequirementCoverage,
  formatRequirementCoveragePrompt,
  type PerRequirementDeliverableSection,
} from "../api-server/src/services/deliverableRequirementCoverageService.js";
import { validateBlueprintRuntimeCompletion } from "../api-server/src/services/blueprintRuntimeValidationService.js";
import {
  assembleDeliverableMarkdownFromSections,
  mergeDeliverableSectionDeltas,
  parseSpecialistJsonOutput,
} from "../api-server/src/services/claimValidationService.js";
import type { BlueprintExecutionContract } from "../api-server/src/services/workBlueprintService.js";
import type { WorkPackageManifest } from "../api-server/src/services/workPackageService.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDir = resolve(repoRoot, "artifacts/pipeline-structure-fix/care-plan-authored-blueprint");
mkdirSync(outputDir, { recursive: true });

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required");

const inputRatePerMillion = 0.15;
const outputRatePerMillion = 0.60;
const cachedInputRatePerMillion = 0.075;

const userRequest = "Create a standard reusable NDIS care plan template for provider staff, participants and representatives. Follow the authored care_plan blueprint specification exactly.";
const blueprint = getRegistryEntry("care_plan");
if (!blueprint) throw new Error("care_plan registry entry not found");

const contract = {
  blueprint,
  sections: blueprint.sections ?? [],
  template: null,
  mode: "create",
} as unknown as BlueprintExecutionContract;

const manifest: WorkPackageManifest = {
  id: "manifest-care-plan-authored-local",
  organizationId: "org-care-plan-authored-local",
  completedWorkId: null,
  executionId: "execution-care-plan-authored-local",
  taskId: "task-care-plan-authored-local",
  blueprintId: "care_plan",
  blueprintVersion: "1.0.0",
  canonicalIntent: "care_plan.create",
  blueprintFamily: "care_plan",
  blueprintMode: "create",
  primarySpecialist: "service_delivery_coordinator",
  supportingSpecialists: ["operations_manager", "behaviour_support_implementation_specialist", "authorised_program_officer", "incident_safeguarding_specialist", "compliance_quality_manager", "knowledge_documentation_specialist"],
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
  createdAt: new Date("2026-08-29T00:00:00.000Z"),
  updatedAt: new Date("2026-08-29T00:00:00.000Z"),
};

const professionalContext = compileProfessionalExecutionContext({
  userRequest,
  manifest,
  blueprint: blueprint as any,
  blueprintContract: contract,
});
const coverageProfile = deriveDeliverableRequirementCoverageProfile(professionalContext, contract);
const outputSchema = buildDeliverableOutputSchema(coverageProfile);
const authoredContentFraming = "Authored fixedContent below is standing template content to EMIT VERBATIM in the matching user-facing deliverable section. Do not paraphrase it and do not describe that it exists. fields are labelled participant/template values to render as fillable fields or tables. completionPrompt is legitimate template output for the person completing the form.";

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["professional_work", "requirement_coverage", "deliverable", "completion", "claims"],
  properties: {
    professional_work: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "blueprint_completion", "requirement_to_deliverable_plan", "evidence_map", "missing_information"],
      properties: {
        summary: { type: "string" },
        blueprint_completion: { type: "array", items: { type: "string" } },
        requirement_to_deliverable_plan: { type: "array", items: { type: "string" } },
        evidence_map: { type: "array", items: { type: "string" } },
        missing_information: { type: "array", items: { type: "string" } },
      },
    },
    requirement_coverage: {
      type: "object",
      additionalProperties: false,
      required: ["satisfied", "missing"],
      properties: {
        satisfied: { type: "array", items: { type: "string" } },
        missing: { type: "array", items: { type: "string" } },
      },
    },
    deliverable: {
      type: "object",
      additionalProperties: false,
      required: ["sections"],
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["requirementId", "heading", "content"],
            properties: {
              requirementId: { type: "string" },
              heading: { type: "string" },
              content: { type: "string" },
            },
          },
        },
      },
    },
    completion: {
      type: "object",
      additionalProperties: false,
      required: ["readyForCompletedWork", "methodologyLeakage", "notes"],
      properties: {
        readyForCompletedWork: { type: "boolean" },
        methodologyLeakage: { type: "boolean" },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "evidenceSource", "confidence"],
        properties: {
          statement: { type: "string" },
          evidenceSource: { type: "string" },
          confidence: { type: "string" },
        },
      },
    },
  },
};

function stagePayload(stage: "stage1" | "repair", userContent: string) {
  return {
    model: "gpt-4o-mini-2024-07-18",
    messages: [
      {
        role: "system",
        content: [
          "# Service Delivery Coordinator",
          buildProfessionalExecutionContextBlock(professionalContext),
          "Return only valid JSON matching the strict schema. The server assembles markdown from deliverable.sections[]. Do not include internal requirement IDs in user-facing headings or body content.",
        ].join("\n\n"),
      },
      { role: "user", content: userContent },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: `care_plan_authored_${stage}`,
        strict: true,
        schema: responseSchema,
      },
    },
    temperature: 0.2,
    max_tokens: 6000,
    prompt_cache_key: `care-plan-authored-blueprint-${stage}`,
  };
}

const baseUserContent = [
  "=== AUTHORITATIVE CARE_PLAN BLUEPRINT SECTIONS ===",
  authoredContentFraming,
  contract.sections.map((section) => [
    `${section.sortOrder}. ${section.sectionCode} — ${section.title}`,
    `Section role: ${section.sectionRole}`,
    `Description: ${section.description ?? ""}`,
    `Fixed content to emit verbatim: ${JSON.stringify(section.fixedContent ?? [])}`,
    `Fields to render as labelled template fields: ${JSON.stringify(section.fields ?? [])}`,
    `Completion prompt to emit in template: ${section.completionPrompt ?? ""}`,
    `Instructions: ${section.instructions ?? ""}`,
    `Evidence requirements: ${JSON.stringify(section.evidenceRequirements ?? {})}`,
    `Allowed source types: ${(section.allowedSourceTypes ?? []).join(", ")}`,
    `Validation rules: ${JSON.stringify(section.validationRules ?? [])}`,
    `Quality criteria: ${JSON.stringify(section.qualityCriteria ?? [])}`,
  ].join("\n")).join("\n\n"),
  "=== AUTHORED REQUIREMENT PLAN ===",
  formatRequirementCoveragePrompt(coverageProfile),
  "=== EVIDENCE CONTRACT ===",
  JSON.stringify(blueprint.evidenceContract ?? {}, null, 2),
  "=== STANDARD TEMPLATE AUTHORITY ===",
  "Template mode: all sections and fields present, labelled, with fixed professional content written out. Participant values appear as declared placeholders.",
  "Participant-specific evidence is not available in this local template measurement; do not fabricate participant values.",
  "=== WORK REQUEST ===",
  userRequest,
].join("\n\n");

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeMarkdown(path: string, value: string) {
  writeFileSync(path, `${value.replace(/[ \t]+$/gm, "")}\n`);
}

async function callOpenAI(payload: Record<string, unknown>) {
  const started = Date.now();
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${JSON.stringify(body)}`);
  return { ...body, latencyMs: Date.now() - started };
}

function parse(response: any) {
  const content = response.choices?.[0]?.message?.content ?? "";
  return parseSpecialistJsonOutput(content);
}

function sections(parsed: any): PerRequirementDeliverableSection[] {
  return Array.isArray(parsed?.deliverable?.sections) ? parsed.deliverable.sections : [];
}

function cost(usage: any) {
  const input = usage?.prompt_tokens ?? 0;
  const output = usage?.completion_tokens ?? 0;
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return ((Math.max(0, input - cached) * inputRatePerMillion) + (cached * cachedInputRatePerMillion) + (output * outputRatePerMillion)) / 1_000_000;
}

function validate(currentSections: PerRequirementDeliverableSection[]) {
  const requirementOrder = coverageProfile.requirements.map((requirement) => requirement.requirementId);
  const markdown = assembleDeliverableMarkdownFromSections(currentSections, requirementOrder);
  const coverage = evaluateDeliverableRequirementCoverage(markdown, coverageProfile, { deliverableSections: currentSections });
  const runtime = validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: markdown,
    deliverableSections: currentSections,
    standardTemplateEvidence: {
      standardTemplateRequested: true,
      existingTemplateRequested: false,
      participantSpecificRequested: false,
      organisationSpecificRequested: false,
      customerExampleOptional: true,
    },
    professionalContext,
  });
  return { markdown, coverage, runtime };
}

async function main() {
  const requestPayload = stagePayload("stage1", baseUserContent);
  writeJson(resolve(outputDir, "request.payload.json"), requestPayload);
  const stage1Response = await callOpenAI(requestPayload);
  writeJson(resolve(outputDir, "openai-response.json"), stage1Response);
  const stage1Parsed = parse(stage1Response);
  writeJson(resolve(outputDir, "parsed-response.json"), stage1Parsed);

  let finalSections = sections(stage1Parsed);
  let repairResponse: any = null;
  let repairParsed: any = null;
  let repairPayload: any = null;
  const stage1Validation = validate(finalSections);
  const missing = stage1Validation.coverage.missing;

  if (missing.length > 0) {
    const deficientSections = finalSections.filter((section) =>
      missing.some((failure) => failure.requirementId === section.requirementId),
    );
    repairPayload = stagePayload("repair", [
      "=== REPAIR ONLY THESE REQUIREMENTS ===",
      JSON.stringify(missing.map((failure) => ({
        requirementId: failure.requirementId,
        requirement: failure.requirement,
        targetLocation: failure.requiredDeliverableRepresentation,
        adequacyCriteria: failure.adequacyCriteria,
        reason: failure.reason,
      })), null, 2),
      "=== CURRENT DEFICIENT SECTIONS ===",
      JSON.stringify(deficientSections, null, 2),
      "Return deliverable.sections[] deltas only for the listed requirementIds. The server merges deltas into the existing section array and assembles markdown deterministically.",
    ].join("\n\n"));
    writeJson(resolve(outputDir, "repair-request.payload.json"), repairPayload);
    repairResponse = await callOpenAI(repairPayload);
    writeJson(resolve(outputDir, "repair-openai-response.json"), repairResponse);
    repairParsed = parse(repairResponse);
    writeJson(resolve(outputDir, "repair-parsed-response.json"), repairParsed);
    finalSections = mergeDeliverableSectionDeltas({
      currentSections: finalSections,
      repairSections: sections(repairParsed),
      allowedRequirementIds: missing.map((failure) => failure.requirementId),
    });
  }

  const finalValidation = validate(finalSections);
  writeMarkdown(resolve(outputDir, "produced-document.md"), stage1Validation.markdown);
  writeMarkdown(resolve(outputDir, "final-produced-document.md"), finalValidation.markdown);

  const summary = {
    status: finalValidation.runtime.passed && finalValidation.coverage.missing.length === 0 ? "completed_revalidated" : "blocked_by_validation",
    requirementCount: coverageProfile.requirements.length,
    templateCriteriaValidatedCount: finalValidation.coverage.requirementResults.filter((item) => item.substantiveValidationMode === "TEMPLATE_CRITERIA").length,
    adequacyCriteriaValidatedCount: finalValidation.coverage.requirementResults.filter((item) => item.substantiveValidationMode === "ADEQUACY_CRITERIA").length,
    fallbackHeuristicValidatedCount: finalValidation.coverage.requirementResults.filter((item) => item.substantiveValidationMode === "FALLBACK_HEURISTIC").length,
    stage1: {
      model: stage1Response.model,
      finishReason: stage1Response.choices?.[0]?.finish_reason ?? null,
      latencyMs: stage1Response.latencyMs,
      usage: stage1Response.usage,
      cost: cost(stage1Response.usage),
      missingRequirements: stage1Validation.coverage.missing.map((failure) => failure.requirementId),
    },
    repair: repairResponse ? {
      model: repairResponse.model,
      finishReason: repairResponse.choices?.[0]?.finish_reason ?? null,
      latencyMs: repairResponse.latencyMs,
      usage: repairResponse.usage,
      cost: cost(repairResponse.usage),
      returnedDeltaSectionCount: sections(repairParsed).length,
    } : null,
    totalCost: cost(stage1Response.usage) + (repairResponse ? cost(repairResponse.usage) : 0),
    output: {
      sectionCount: finalSections.length,
      wordCount: finalValidation.markdown.split(/\s+/).filter(Boolean).length,
    },
    gateResults: {
      runtimePassed: finalValidation.runtime.passed,
      runtimeFailures: finalValidation.runtime.failures,
      coverageMissing: finalValidation.coverage.missing,
    },
    requirementValidation: finalValidation.coverage.requirementResults.map((item) => ({
      requirementId: item.requirementId,
      requirement: item.requirement,
      finalResult: item.finalResult,
      substantiveResult: item.substantiveResult,
      mode: item.substantiveValidationMode,
      templateCriteria: item.templateCriteria,
      adequacyCriteria: item.adequacyCriteria,
      failureReason: item.failureReason,
      breakdown: item.substantiveBreakdown ?? null,
    })),
    openItems: [
      "History and Background (4.4): access restriction given its content?",
      "Disaster management (4.12): settings other than SIL, supported accommodation and community access?",
      "Emergency contacts: this document or the intake form?",
      "Decision-making capacity, guardian or nominee: recorded here or elsewhere?",
    ],
    founderAuthoringGaps: [
      "Support Plan Meeting (header): review cycle requirement",
      "History and Background: confidentiality statement for sensitive history",
      "Undertaking ADL: the ADL activity list to be used",
      "Mobility and Mobility Strategy: manual handling and equipment check requirements",
      "Support Delivery and Client Safety: worker screening and orientation requirements",
      "Mealtime Management Strategy: choking and emergency response",
      "Client Endorsement: participant agreement and consent wording",
    ],
  };

  writeJson(resolve(outputDir, "measurement-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
