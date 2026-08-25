import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { getRegistryEntry, resolveRegistryProfessionalOwner } from "../services/blueprintRegistry";
import {
  classifyStandardTemplateEvidenceContext,
  detectIncompleteProfessionalSections,
  detectInstructionalProfessionalText,
  detectLeakedBlueprintMethodologyHeadings,
  detectUnresolvedProfessionalPlaceholders,
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
    expect(service).toContain('export type CompletedWorkArtifactFormat = "docx" | "pdf" | "xlsx"');
    expect(service).toContain("primaryFormat ?? \"docx\"");
    expect(uee).toContain("resolveArtifactFormats");
    expect(uee).toContain('"xlsx"');
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

  it("packages PDFKit standard-font runtime data beside the bundled API output", () => {
    const buildScript = repoSource("artifacts/api-server/build.mjs");
    const smokeScript = source("pdf-runtime-smoke.ts");

    expect(buildScript).toContain("copyPdfKitRuntimeAssets");
    expect(buildScript).toContain('require.resolve("pdfkit"');
    expect(buildScript).toContain('path.join(distDir, "data")');
    expect(buildScript).toContain("src/pdf-runtime-smoke.ts");
    expect(smokeScript).toContain('"Helvetica.afm"');
    expect(smokeScript).toContain('"sRGB_IEC61966_2_1.icc"');
    expect(smokeScript).toContain("new PdfExporter().export(doc)");
    expect(smokeScript).toContain('result.buffer.slice(0, 4).toString("ascii") !== "%PDF"');
  });

  it("exports XLSX workbooks for spreadsheet deliverable contracts", () => {
    const exportService = source("services/completedWorkExportService.ts");
    const registry = source("services/blueprintRegistry.ts");
    const blueprint = getRegistryEntry("financial_planning_reporting_review");

    expect(exportService).toContain("export class XlsxExporter");
    expect(exportService).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(exportService).toContain("zipStore");
    expect(exportService).toContain("buildWorksheetXml");
    expect(registry).toContain("function xlsxDeliverable");
    expect(blueprint?.deliverableContract.artifactRequired).toBe(true);
    expect(blueprint?.deliverableContract.primaryFormat).toBe("xlsx");
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

  it("surfaces Completed Work and generated artifacts directly in the task workroom", () => {
    const route = source("routes/v1/taskWorkroom.ts");
    const page = repoSource("artifacts/needsops-web/src/pages/app/TaskWorkroomPage.tsx");

    expect(route).toContain("listCompletedWorkGeneratedArtifacts");
    expect(route).toContain("workArtifactsTable.taskId");
    expect(route).toContain("completedWork: completedWork.filter(Boolean)");
    expect(page).toContain("Completed Work");
    expect(page).toContain("handleDownloadArtifact");
    expect(page).toContain("/artifacts/${artifact.id}/download");
    expect(page).toContain("Word");
    expect(page).toContain("PDF");
    expect(page).toContain("Excel");
  });

  it("finalises the task when approved Completed Work matches the execution approval gate", () => {
    const taskService = source("services/taskService.ts");
    const route = source("routes/v1/completedWork.ts");

    expect(taskService).toContain("export async function reconcileTaskCompletedWorkApproval");
    expect(taskService).toContain("linkedCompletedWorkId !== input.completedWorkId");
    expect(taskService).toContain('currentState: "completed"');
    expect(taskService).toContain('approvalState: "approved"');
    expect(route).toContain("reconcileTaskCompletedWorkApproval");
    expect(route).toContain("listCompletedWorkGeneratedArtifacts(id, ctx.tenantId)");
  });

  it("adds additive generated-artifact metadata columns through the platform migration ledger", () => {
    const migration = repoSource("lib/db/migrations/0037_work_artifact_output_metadata.sql");
    const approvedVersionMigration = repoSource("lib/db/migrations/0038_completed_work_approved_version_pin.sql");
    const provenanceMigration = repoSource("lib/db/migrations/0039_completed_work_version_provenance_status.sql");
    const completedWorkSchema = repoSource("lib/db/src/schema/completedWork.ts");
    const completedWorkVersionsSchema = repoSource("lib/db/src/schema/completedWorkVersions.ts");
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
    expect(approvedVersionMigration).toContain("ADD COLUMN IF NOT EXISTS approved_version_id TEXT");
    expect(completedWorkSchema).toContain('approvedVersionId: text("approved_version_id")');
    expect(registry).toContain("0038-completed-work-approved-version-pin");
    expect(provenanceMigration).toContain(
      "ADD COLUMN IF NOT EXISTS provenance_status TEXT NOT NULL DEFAULT 'not_available_legacy'",
    );
    expect(completedWorkVersionsSchema).toContain('provenanceStatus: text("provenance_status")');
    expect(registry).toContain("0039-completed-work-version-provenance-status");
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

  it("treats internal review section headings as advisory for standard reusable service-agreement templates", () => {
    const request = "Create a standard compliant NDIS Service Agreement template covering all relevant clauses";
    const contract = contractFor("service_agreement_review");
    const contentMarkdown = [
      "## Standard NDIS Service Agreement Template",
      "This reusable template includes participant, provider, supports, payment, cancellation, rights, privacy, complaints, variation, termination and schedule placeholders for professional review.",
      "## Parties and agreement details",
      "Provider legal name, ABN, participant name, NDIS number, representative and plan details are placeholders because this is not a participant-specific agreement.",
      "## Supports, pricing and payment",
      "The support schedule, price, GST, payment method and cancellation terms are configurable placeholders that must be checked against current NDIS guidance before live use.",
      "## Participant rights and provider responsibilities",
      "The template includes clear-language obligations, consent, privacy, complaints and advocacy clauses grounded in current authority evidence.",
    ].join("\n\n");
    const result = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(["current_authority"]),
      artifactId: "artifact-standard-service-agreement",
      approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map((key) => [key, true])),
      standardTemplateEvidence: classifyStandardTemplateEvidenceContext(request),
    });

    expect(result.failures.some((failure) => failure.gate === "required_section")).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "section_evidence")).toBe(false);
    expect(result.failures.some((failure) => failure.gate === "missing_evidence")).toBe(false);
  });

  it("blocks professional-content placeholders before Completed Work/artifact finalisation", () => {
    const request = "Create a standard compliant NDIS Service Agreement template covering all relevant clauses";
    const contract = contractFor("service_agreement_review");
    const contentMarkdown = [
      "## Standard NDIS Service Agreement Template",
      "Parties: [PARTICIPANT_NAME] and [PROVIDER_NAME].",
      "## Operative clauses",
      "[CLAUSE_1]",
      "[DELIVERY_OBLIGATIONS]",
      "[PROVIDER_OBLIGATIONS]",
      "[PARTICIPANT_RESPONSIBILITIES]",
      "[CANCELLATION_TERMS]",
      "[RIGHTS_CLAUSES]",
      "[VARIATION_TERMS]",
      "[TERMINATION_TERMS]",
      "[GST_CLAUSE]",
      "[CONCLUSION]",
      "[INCOMPLETE: requires material terms configuration]",
    ].join("\n\n");
    const standardTemplateEvidence = classifyStandardTemplateEvidenceContext(request);
    const result = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(["current_authority"]),
      artifactId: "artifact-standard-service-agreement",
      approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map((key) => [key, true])),
      standardTemplateEvidence,
    });

    expect(detectUnresolvedProfessionalPlaceholders(contentMarkdown, standardTemplateEvidence)).toEqual([
      "[CANCELLATION_TERMS]",
      "[CLAUSE_1]",
      "[CONCLUSION]",
      "[DELIVERY_OBLIGATIONS]",
      "[GST_CLAUSE]",
      "[INCOMPLETE: requires material terms configuration]",
      "[PARTICIPANT_RESPONSIBILITIES]",
      "[PROVIDER_OBLIGATIONS]",
      "[RIGHTS_CLAUSES]",
      "[TERMINATION_TERMS]",
      "[VARIATION_TERMS]",
    ]);
    expect(result.failures.some((failure) =>
      failure.gate === "professional_placeholder" &&
      failure.details?.includes("[CLAUSE_1]") &&
      failure.details?.includes("[INCOMPLETE: requires material terms configuration]"),
    )).toBe(true);
  });

  it("blocks internal Blueprint methodology headings from customer-facing standard templates", () => {
    const request = "Create a standard compliant NDIS Service Agreement template covering all relevant clauses";
    const contract = contractFor("service_agreement_review");
    const contentMarkdown = [
      "## Standard NDIS Service Agreement Template",
      "Parties: [PARTICIPANT_NAME] and [PROVIDER_NAME].",
      "## Material Terms Extraction",
      "A working-method section leaked into the output.",
      "## Participant Safeguard Validation",
      "Another internal validation heading leaked into the document.",
      "## Governance Decision Trail",
      "Internal governance trace text leaked into customer-facing content.",
      "## Provider Responsibilities",
      "The provider must deliver supports with due care, protect privacy, maintain complaints pathways and explain changes before varying the agreement.",
    ].join("\n\n");
    const standardTemplateEvidence = classifyStandardTemplateEvidenceContext(request);
    const result = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(["current_authority"]),
      artifactId: "artifact-standard-service-agreement",
      approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map((key) => [key, true])),
      standardTemplateEvidence,
    });

    expect(detectLeakedBlueprintMethodologyHeadings(contentMarkdown, contract.sections, standardTemplateEvidence)).toEqual([
      "Governance Decision Trail",
      "Material Terms Extraction",
      "Participant Safeguard Validation",
    ]);
    expect(result.failures.some((failure) =>
      failure.gate === "methodology_leak" &&
      failure.details?.includes("Material Terms Extraction") &&
      failure.details?.includes("Governance Decision Trail"),
    )).toBe(true);
  });

  it("allows user-data placeholders in standard reusable templates while requiring drafted professional content", () => {
    const request = "Create a standard compliant NDIS Service Agreement template covering all relevant clauses";
    const contract = contractFor("service_agreement_review");
    const contentMarkdown = [
      "## Standard NDIS Service Agreement Template",
      "This agreement is between [PARTICIPANT_NAME] and [PROVIDER_NAME] ([PROVIDER_ABN]) for participant [NDIS_NUMBER].",
      "## Professional terms",
      "The provider must deliver supports with due care and skill, respect participant choice and control, protect privacy, maintain complaint pathways, apply the agreed cancellation framework and give written notice before any variation or termination.",
      "The participant must provide accurate plan and support information, communicate service changes promptly and meet agreed payment responsibilities for supports recorded in [SUPPORT_SCHEDULE].",
      "Fees, GST treatment where applicable, agreement period [AGREEMENT_PERIOD], signatures and dates remain data-entry placeholders for the completed participant-specific agreement.",
    ].join("\n\n");
    const standardTemplateEvidence = classifyStandardTemplateEvidenceContext(request);
    const result = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(["current_authority"]),
      artifactId: "artifact-standard-service-agreement",
      approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map((key) => [key, true])),
      standardTemplateEvidence,
    });

    expect(detectUnresolvedProfessionalPlaceholders(contentMarkdown, standardTemplateEvidence)).toEqual([]);
    expect(result.failures.some((failure) => failure.gate === "professional_placeholder")).toBe(false);
  });

  it("blocks instructional professional-method text where final clauses are required", () => {
    const request = "Create a standard compliant NDIS Service Agreement template covering all relevant clauses";
    const contract = contractFor("service_agreement_review");
    const standardTemplateEvidence = classifyStandardTemplateEvidenceContext(request);
    const contentMarkdown = [
      "## Standard NDIS Service Agreement Template",
      "This template is between [PARTICIPANT_NAME] and [PROVIDER_NAME].",
      "## Provider Obligations",
      "Review the provider obligations clause and validate whether delivery responsibilities have been mapped before use.",
      "## Cancellation Terms",
      "Assess cancellation terms and insert the correct cancellation provisions after professional review.",
    ].join("\n\n");
    const result = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(["current_authority"]),
      artifactId: "artifact-standard-service-agreement",
      approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map((key) => [key, true])),
      standardTemplateEvidence,
    });

    expect(detectInstructionalProfessionalText(contentMarkdown, standardTemplateEvidence)).toEqual([
      "instructional_text:Assess cancellation terms and insert the correct cancellation provisions after professional review.",
      "instructional_text:Review the provider obligations clause and validate whether delivery responsibilities have been mapped before use.",
    ]);
    expect(result.failures.some((failure) =>
      failure.gate === "methodology_leak" &&
      failure.details?.some((detail) => detail.startsWith("instructional_text:")),
    )).toBe(true);
  });

  it("blocks placeholder-only or empty substantive professional sections", () => {
    const request = "Create a standard compliant NDIS Service Agreement template covering all relevant clauses";
    const contract = contractFor("service_agreement_review");
    const standardTemplateEvidence = classifyStandardTemplateEvidenceContext(request);
    const contentMarkdown = [
      "## Standard NDIS Service Agreement Template",
      "This reusable agreement contains factual placeholders only for customer-specific data.",
      "## Termination Terms",
      "[TERMINATION_TERMS]",
      "## Conclusion",
      "To be completed.",
    ].join("\n\n");
    const result = validateBlueprintRuntimeCompletion({
      contract,
      contentMarkdown,
      rawClaims: [],
      evidencePack: evidencePack(["current_authority"]),
      artifactId: "artifact-standard-service-agreement",
      approvalStates: Object.fromEntries(Object.keys(contract.blueprint.requiredApprovals ?? {}).map((key) => [key, true])),
      standardTemplateEvidence,
    });

    expect(detectIncompleteProfessionalSections(contentMarkdown, standardTemplateEvidence)).toEqual([
      "incomplete_section:Conclusion",
      "incomplete_section:Termination Terms",
    ]);
    expect(result.failures.some((failure) =>
      failure.gate === "methodology_leak" &&
      failure.details?.includes("incomplete_section:Termination Terms"),
    )).toBe(true);
  });

  it("runs final professional deliverable synthesis before createDraft when gates catch placeholders or methodology", () => {
    const uee = source("services/unifiedExecutionEngine.ts");
    const reviewIndex = uee.indexOf("let runtimeGate = validateBlueprintRuntimeCompletion");
    const synthesisIndex = uee.indexOf("shouldAttemptFinalDeliverableSynthesis(runtimeGate.failures");
    const createIndex = uee.indexOf("const completedWork = await createDraft");

    expect(uee).toContain('purpose: "task_execution"');
    expect(uee).toContain("buildFinalDeliverableSynthesisSystemPrompt");
    expect(uee).toContain("internal professional analysis, evidence, Blueprint completion and specialist conclusions");
    expect(uee).toContain("INTERNAL ONLY");
    expect(uee).toContain("Allowed placeholders are factual/user-specific data placeholders");
    expect(uee).toContain("Not allowed: unresolved professional-content placeholders");
    expect(reviewIndex).toBeGreaterThan(-1);
    expect(synthesisIndex).toBeGreaterThan(reviewIndex);
    expect(createIndex).toBeGreaterThan(synthesisIndex);
  });

  it("still requires authoritative evidence for standard templates making compliance claims", () => {
    const request = "Create a standard compliant NDIS Service Agreement template";
    const result = validate("service_agreement_review", request);

    expect(result.failures.some((failure) =>
      failure.gate === "missing_evidence" &&
      failure.details?.includes("current_authority"),
    )).toBe(true);
  });

  it("adds bounded NDIS authority evidence for standard reusable service-agreement templates", () => {
    const krs = source("services/knowledgeResolutionService.ts");

    expect(krs).toContain("NDIS_STANDARD_TEMPLATE_AUTHORITY_SEEDS");
    expect(krs).toContain("authority_registry_standard_template_seed");
    expect(krs).toContain("ndis-service-agreement-how-to");
    expect(krs).toContain("ndis-commission-practice-standards-provision-supports");
    expect(krs).toContain("ar-au-002");
    expect(krs).toContain("ar-au-003");
  });
});
