import { createHash, randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import {
  completedWorkTable,
  workArtifactsTable,
  type WorkArtifactStatus,
} from "@workspace/db";
import { db } from "@workspace/db";
import { logOrgEvent } from "./auditService.js";
import { completedWorkExportService, type ExportFormat } from "./completedWorkExportService.js";
import { generateDownloadUrl, uploadFileToStorage } from "./knowledgeStorageService.js";

export interface GeneratedWorkArtifact {
  id: string;
  organizationId: string;
  taskId: string | null;
  completedWorkId: string;
  conversationId: string | null;
  artifactType: "primary_deliverable" | "secondary_deliverable";
  fileFormat: "docx" | "pdf";
  storageReference: string;
  storageProvider: string;
  mimeType: string;
  fileSize: number;
  checksum: string;
  generationStatus: WorkArtifactStatus;
}

interface GenerateCompletedWorkArtifactsInput {
  organizationId: string;
  organizationName: string;
  completedWorkId: string;
  taskId?: string | null;
  conversationId?: string | null;
  actorUserId: string;
  primaryFormat?: "docx";
  secondaryFormats?: Array<"pdf">;
}

interface DownloadWorkArtifactInput {
  organizationId: string;
  completedWorkId: string;
  artifactId: string;
}

function artifactStorageKey(input: {
  organizationId: string;
  completedWorkId: string;
  artifactId: string;
  format: "docx" | "pdf";
}): string {
  return [
    "orgs",
    input.organizationId,
    "completed-work",
    input.completedWorkId,
    "artifacts",
    `${input.artifactId}.${input.format}`,
  ].join("/");
}

function storageProviderName(): string {
  if ((process.env["KNOWLEDGE_STORAGE_PROVIDER"] ?? "").toLowerCase() === "s3") return "s3";
  if (process.env["APP_STORAGE_BUCKET"] || process.env["KNOWLEDGE_S3_BUCKET"]) return "s3";
  return "gcs";
}

export async function generateCompletedWorkArtifacts(
  input: GenerateCompletedWorkArtifactsInput,
): Promise<GeneratedWorkArtifact[]> {
  const formats: Array<"docx" | "pdf"> = [
    input.primaryFormat ?? "docx",
    ...(input.secondaryFormats ?? ["pdf"]),
  ];
  const now = new Date();
  const generated: GeneratedWorkArtifact[] = [];

  await db
    .update(completedWorkTable)
    .set({ artifactState: "generating", updatedAt: now })
    .where(and(
      eq(completedWorkTable.id, input.completedWorkId),
      eq(completedWorkTable.organizationId, input.organizationId),
    ));

  try {
    for (const format of formats) {
      const artifactId = randomUUID();
      const exportResult = await completedWorkExportService.export({
        workId: input.completedWorkId,
        organisationId: input.organizationId,
        organisationName: input.organizationName,
        format: format as ExportFormat,
        actorUserId: input.actorUserId,
      });
      if (exportResult.buffer.length <= 0) {
        throw new Error(`Generated ${format.toUpperCase()} artifact is empty.`);
      }

      const storageReference = artifactStorageKey({
        organizationId: input.organizationId,
        completedWorkId: input.completedWorkId,
        artifactId,
        format,
      });
      await uploadFileToStorage(storageReference, exportResult.buffer, exportResult.mimeType);

      const artifact: GeneratedWorkArtifact = {
        id: artifactId,
        organizationId: input.organizationId,
        taskId: input.taskId ?? null,
        completedWorkId: input.completedWorkId,
        conversationId: input.conversationId ?? null,
        artifactType: format === "docx" ? "primary_deliverable" : "secondary_deliverable",
        fileFormat: format,
        storageReference,
        storageProvider: storageProviderName(),
        mimeType: exportResult.mimeType,
        fileSize: exportResult.buffer.length,
        checksum: createHash("sha256").update(exportResult.buffer).digest("hex"),
        generationStatus: "stored",
      };

      await db.insert(workArtifactsTable).values({
        id: artifact.id,
        organizationId: artifact.organizationId,
        taskId: artifact.taskId,
        completedWorkId: artifact.completedWorkId,
        workroomId: null,
        conversationId: artifact.conversationId,
        artifactType: artifact.artifactType,
        fileFormat: artifact.fileFormat,
        storageReference: artifact.storageReference,
        storageProvider: artifact.storageProvider,
        mimeType: artifact.mimeType,
        fileSize: artifact.fileSize,
        checksum: artifact.checksum,
        version: 1,
        generationStatus: artifact.generationStatus,
        createdAt: now,
      });
      generated.push(artifact);
    }

    const primary = generated.find((artifact) => artifact.fileFormat === "docx") ?? generated[0];
    await db
      .update(completedWorkTable)
      .set({
        artifactState: "stored",
        artifactId: primary?.id ?? null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(completedWorkTable.id, input.completedWorkId),
        eq(completedWorkTable.organizationId, input.organizationId),
      ));

    await logOrgEvent({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "completed_work_artifacts_generated" as any,
      resourceType: "completed_work",
      resourceId: input.completedWorkId,
      metadata: {
        taskId: input.taskId ?? null,
        artifactIds: generated.map((artifact) => artifact.id),
        formats: generated.map((artifact) => artifact.fileFormat),
      },
    });

    return generated;
  } catch (err) {
    await db
      .update(completedWorkTable)
      .set({ artifactState: "generation_failed", updatedAt: new Date() })
      .where(and(
        eq(completedWorkTable.id, input.completedWorkId),
        eq(completedWorkTable.organizationId, input.organizationId),
      ));
    throw err;
  }
}

export async function listCompletedWorkGeneratedArtifacts(
  completedWorkId: string,
  organizationId: string,
): Promise<GeneratedWorkArtifact[]> {
  const rows = await db
    .select()
    .from(workArtifactsTable)
    .where(and(
      eq(workArtifactsTable.completedWorkId, completedWorkId),
      eq(workArtifactsTable.organizationId, organizationId),
    ));

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organizationId,
    taskId: row.taskId ?? null,
    completedWorkId: row.completedWorkId ?? completedWorkId,
    conversationId: row.conversationId ?? null,
    artifactType: row.artifactType === "primary_deliverable" ? "primary_deliverable" : "secondary_deliverable",
    fileFormat: row.fileFormat === "docx" ? "docx" : "pdf",
    storageReference: row.storageReference ?? "",
    storageProvider: row.storageProvider ?? "",
    mimeType: row.mimeType ?? "",
    fileSize: row.fileSize ?? 0,
    checksum: row.checksum ?? "",
    generationStatus: row.generationStatus,
  }));
}

export async function getGeneratedArtifactDownloadUrl(
  input: DownloadWorkArtifactInput,
): Promise<{ artifact: GeneratedWorkArtifact; downloadUrl: string }> {
  const artifacts = await listCompletedWorkGeneratedArtifacts(input.completedWorkId, input.organizationId);
  const artifact = artifacts.find((item) => item.id === input.artifactId);
  if (!artifact || !artifact.storageReference) {
    throw Object.assign(new Error("Generated artifact not found"), { statusCode: 404 });
  }
  if (artifact.generationStatus !== "stored") {
    throw Object.assign(new Error("Generated artifact is not available for download"), { statusCode: 409 });
  }

  return {
    artifact,
    downloadUrl: await generateDownloadUrl(artifact.storageReference),
  };
}
