import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { getRegistryEntry, resolveRegistryProfessionalOwner } from "../services/blueprintRegistry";
import {
  classifyStandardTemplateEvidenceContext,
  validateBlueprintRuntimeCompletion,
  type BlueprintRuntimeValidationInput,
} from "../services/blueprintRuntimeValidationService";
import type { BlueprintExecutionContract } from "../services/workBlueprintService";

const root = resolve(__dirname, "..");
const repoRoot = resolve(root, "../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function repoSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

function contractFor(code: string): BlueprintExecutionContract {
  const blueprint = getRegistryEntry(code);
  if (!blueprint) throw new Error(`Missing blueprint ${code}`);
  return {
    blueprint,
    sections: blueprint.sections,
    template: null,
    mode: "create",
  };
}

function contentFor(contract: BlueprintExecutionContract): string {
  return contract.sections
    .map((section) => `## ${section.sectionCode}\nThis section is materially populated and any missing evidence is surfaced instead of invented.`)
    .join("\n\n");
}

function evidencePack(categories: string[]) {
  return {
    executionId: "exec-standard-template",
    organisationId: "org-standard-template",
    resolvedAt: new Date("2026-08-24T00:00:00Z"),
    totalChunks: categories.length,
    sourceIds: categories.map((category) => `source-${category}`),
    avgConfidence: categories.length > 0 ? 1 : 0,
    citationsByType: {},
    retrievalMetrics: {
      lexicalMs: 1,
      vectorMs: 0,
      totalMs: 1,
      chunksScanned: categories.length,
      chunksReturned: categories.length,
      sourcesConsidered: categories.length,
      embeddingUsed: false,
      embeddingMs: 0,
    },
    chunks: categories.map((category, index) => ({
      chunkId: `chunk-${index}`,
      sourceId: `source-${category}`,
      sourceVersionId: `version-${category}`,
      sourceTitle: category,
      versionLabel: "current",
      sourceType: category,
      authorityLevel: "mandatory",
      sectionTitle: category,
      pageNumber: null,
      text: `${category} authoritative evidence`,
      confidence: 1,
      citation: `${category} citation`,
      selectionReason: "deterministic_test",
    })),
  };
}

function validate(
  code: string,
  requestText: string,
  overrides: Partial<BlueprintRuntimeValidationInput> = {},
) {
  const contract = contractFor(code);
  return validateBlueprintRuntimeCompletion({
    contract,
    contentMarkdown: contentFor(contract),
    rawClaims: [],
    evidencePack: evidencePack([]),
    artifactId: "artifact-standard-template",
    approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map((key) => [key, true])),
    standardTemplateEvidence: classifyStandardTemplateEvidenceContext(requestText),
    ...overrides,
  });
}

describe("Sprint 35F AWS-native execution and artifact completion", () => {
  it("classifies NDIS service-agreement work as AWS-native professional execution", () => {
    const blueprint = getRegistryEntry("service_agreement_review");
    const executionService = source("services/executionService.ts");

    expect(blueprint).toBeTruthy();
    expect(resolveRegistryProfessionalOwner(blueprint!)).toBe("policy_governance_specialist");
    expect(blueprint?.deliverableContract.artifactRequired).toBe(true);
    expect(blueprint?.deliverableContract.primaryFormat).toBe("docx");
    expect(blueprint?.deliverableContract.secondaryFormats).toContain("pdf");
    expect(executionService).toContain("function requiresOpenClawRuntime");
    expect(executionService).toContain('"browser"');
    expect(executionService).toContain('"local_files"');
    expect(executionService).toContain('"local_applications"');
    expect(executionService).toContain("await startAwsNativeExecution");
  });

  it("does not route broker-free professional document work through OpenClaw by default", () => {
    const executionService = source("services/executionService.ts");

    expect(executionService).toContain("permitted connector surface, not a task-specific connector requirement");
    expect(executionService).toContain("Do not force AWS-native professional work through a desktop broker");
    expect(executionService).not.toContain('process.env.OPENCLAW_URL ?? "http://127.0.0.1:18789"');
    expect(executionService).not.toContain("~/.openclaw");
  });

  it("keeps desktop-only capabilities on the OpenClaw runtime path", () => {
    const executionService = source("services/executionService.ts");

    const runtimeCheck = executionService.slice(
      executionService.indexOf("function requiresOpenClawRuntime"),
      executionService.indexOf("async function startAwsNativeExecution"),
    );
    expect(runtimeCheck).toContain('"browser"');
    expect(runtimeCheck).toContain('"local_files"');
    expect(runtimeCheck).toContain('"local_applications"');
    expect(runtimeCheck).toContain("desktopChannels.has(channel)");
  });

  it("generates persisted DOCX and PDF artifacts from Completed Work before final completion", () => {
    const service = source("services/completedWorkArtifactService.ts");
    const uee = source("services/unifiedExecutionEngine.ts");

    expect(service).toContain("export async function generateCompletedWorkArtifacts");
    expect(service).toContain('format: "docx"');
    expect(service).toContain('secondaryFormats ?? ["pdf"]');
    expect(uee).toContain('secondaryFormats: ["pdf"]');
    expect(service).toContain("completedWorkExportService.export");
    expect(service).toContain("uploadFileToStorage");
    expect(service).toContain("workArtifactsTable");
    expect(service).toContain('artifactType: "primary_deliverable"');
    expect(service).toContain('"secondary_deliverable"');
    expect(service).toContain("mimeType");
    expect(service).toContain("fileSize");
    expect(service).toContain("checksum");
    expect(uee).toContain("generateCompletedWorkArtifacts");
    expect(uee).toContain("__artifact_generation_pending__");
    expect(uee).toContain("primaryArtifactId");
    expect(uee).toContain('failedStage: "artifact_generation"');
  });

  it("defers approval gates while preserving evidence, section, template and artifact gates", () => {
    const validation = source("services/blueprintRuntimeValidationService.ts");
    const uee = source("services/unifiedExecutionEngine.ts");

    expect(validation).toContain("deferApprovalGate?: boolean");
    expect(validation).toContain("if (input.deferApprovalGate !== true)");
    expect(uee).toContain("deferApprovalGate: true");
    expect(uee).toContain("post_artifact_completion_gates");
  });

  it("does not report evidence or clarification blocks as approval-ready execution", () => {
    const execution = source("services/executionService.ts");
    const statusMessages = repoSource("lib/openclaw/src/executionPackageTranslator.ts");

    expect(execution).toContain('const requiresClarification = result.outcome === "awaiting_clarification"');
    expect(execution).toContain('const terminalStatus = requiresClarification ? "awaiting_clarification" : "failed"');
    expect(execution).toContain('currentState: "planning"');
    expect(execution).toContain("executionClarification");
    expect(execution).toContain('"execution.awaiting_clarification"');
    expect(execution).not.toContain('result.outcome === "awaiting_clarification" ? "awaiting_approval" : "failed"');
    expect(statusMessages).toContain('awaiting_clarification: "Waiting for required information"');
  });

  it("exposes generated artifacts through authenticated Completed Work routes", () => {
    const route = source("routes/v1/completedWork.ts");
    const viewer = repoSource("artifacts/needsops-web/src/pages/app/CompletedWorkViewer.tsx");

    expect(route).toContain("listCompletedWorkGeneratedArtifacts");
    expect(route).toContain("getGeneratedArtifactDownloadUrl");
    expect(route).toContain('"/organisations/:slug/completed-work/:id/artifacts"');
    expect(route).toContain('"/organisations/:slug/completed-work/:id/artifacts/:artifactId/download"');
    expect(viewer).toContain("GeneratedArtifactsPanel");
    expect(viewer).toContain("generatedArtifacts");
    expect(viewer).toContain("/artifacts/${artifact.id}/download");
  });

  it("adds additive generated-artifact metadata columns through the platform migration ledger", () => {
    const migration = repoSource("lib/db/migrations/0037_work_artifact_output_metadata.sql");
    const schema = repoSource("lib/db/src/schema/workArtifacts.ts");
    const registry = source("bootstrap/platformMigrations.ts");

    for (const column of ["storage_provider", "mime_type", "file_size", "checksum"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(schema).toContain("storageProvider");
    expect(schema).toContain("mimeType");
    expect(schema).toContain("fileSize");
    expect(schema).toContain("checksum");
    expect(registry).toContain("0037-work-artifact-output-metadata");
  });

  it("treats customer examples as optional for standard comprehensive NDIS risk-assessment templates", () => {
    const request = "Create a standard comprehensive NDIS participant risk assessment template covering all relevant areas";
    const context = classifyStandardTemplateEvidenceContext(request);
    const result = validate("participant_risk_assessment", request);

    expect(context).toMatchObject({
      standardTemplateRequested: true,
      participantSpecificRequested: false,
      customerExampleOptional: true,
    });
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(false);
    expect(result.failures.some((failure) =>
      failure.gate === "missing_evidence" || failure.gate === "section_evidence",
    )).toBe(false);
  });

  it("keeps participant-specific risk assessment completion blocked without participant evidence", () => {
    const request = "Complete a risk assessment for Participant Jane";
    const context = classifyStandardTemplateEvidenceContext(request);
    const result = validate("participant_risk_assessment", request);

    expect(context).toMatchObject({
      standardTemplateRequested: false,
      participantSpecificRequested: true,
      customerExampleOptional: false,
    });
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(true);
    expect(result.failures.some((failure) =>
      (failure.gate === "missing_evidence" || failure.gate === "section_evidence") &&
      failure.details?.some((detail) => detail.includes("participant_context") || detail.includes("risk_context")),
    )).toBe(true);
  });

  it("does not require an existing agreement example for a standard NDIS service-agreement template", () => {
    const request = "Create a standard compliant NDIS Service Agreement template";
    const result = validate("service_agreement_review", request, {
      evidencePack: evidencePack(["current_authority"]),
    });

    expect(classifyStandardTemplateEvidenceContext(request).customerExampleOptional).toBe(true);
    expect(result.failures.some((failure) => failure.gate === "template_required")).toBe(false);
    expect(result.failures.some((failure) =>
      failure.gate === "missing_evidence" &&
      failure.details?.some((detail) =>
        ["service_agreement", "service_agreement_terms", "participant_record", "funding_record"].includes(detail),
      ),
    )).toBe(false);
  });

  it("still requires authoritative evidence for standard templates making compliance claims", () => {
    const request = "Create a standard compliant NDIS Service Agreement template";
    const result = validate("service_agreement_review", request);

    expect(result.failures.some((failure) =>
      failure.gate === "missing_evidence" &&
      failure.details?.includes("current_authority"),
    )).toBe(true);
  });
});
