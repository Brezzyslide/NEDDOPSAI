import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { getRegistryEntry, resolveRegistryProfessionalOwner } from "../services/blueprintRegistry";

const root = resolve(__dirname, "..");
const repoRoot = resolve(root, "../../..");

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function repoSource(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
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
});
