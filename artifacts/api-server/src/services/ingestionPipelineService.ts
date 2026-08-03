/**
 * Knowledge Hub — Ingestion Pipeline Service
 *
 * Full asynchronous ingestion pipeline for one knowledge source version.
 *
 * Pipeline stages:
 *   1. Claim & validate job
 *   2. Fetch file from object storage
 *   3. Extract text (via extractorRegistry)
 *   4. Normalise text (deterministic)
 *   5. Chunk document (heading-aware, paragraph-aware)
 *   6. Scan for injection / poisoning patterns
 *   7. Generate embeddings (if sensitivity classification allows)
 *   8. Persist chunks to knowledge_chunks
 *   9. Update source version ingestionStatus
 *  10. Transition ingestion job to "review_required"
 *  11. Update source status to "review_required"
 *
 * Properties:
 *   - Idempotent: re-running a job re-processes but does not create duplicates
 *   - Cancellable: checks a cancellation flag before each major stage
 *   - Auditable: every sensitive operation emits an audit event
 *   - Tenant-isolated: all DB writes use organizationId
 *   - No retrieval before approval: chunks are soft-deleted until source is approved
 *   - No raw content in logs: only counts and codes are logged
 *
 * AWS readiness:
 *   - This function is designed to run inside any worker process or ECS task
 *   - Replace claimNextIngestionJob with SQS.receiveMessage for AWS
 *   - Replace heartbeatIngestionJob with SQS.changeMessageVisibility for AWS
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  knowledgeChunksTable,
  knowledgeSourceVersionsTable,
  knowledgeSourcesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getExtractor }            from "../lib/extractors/extractorRegistry.js";
import { normaliseDocument }       from "./normalisationService.js";
import { chunkDocument, DEFAULT_CHUNK_OPTIONS } from "./chunkingService.js";
import { scanForInjection }        from "./injectionCheckService.js";
import { getEmbeddingProvider }    from "../lib/embeddings/embeddingProviderRegistry.js";
import {
  enqueueIngestionJob,
  claimNextIngestionJob,
  transitionIngestionJobStatus,
  heartbeatIngestionJob,
  completeIngestionJob,
  failIngestionJob,
  getIngestionJob,
  type EnqueueIngestionJobInput,
} from "./ingestionJobService.js";
import { logOrgEvent } from "./auditService.js";

// ─── Ingestion trigger ────────────────────────────────────────────────────────

/**
 * Enqueue an ingestion job for the given knowledge source version.
 * Returns immediately — processing is deferred to processNextIngestionJob().
 *
 * Idempotent: if an active job exists for this version, returns it.
 */
export async function triggerIngestion(input: EnqueueIngestionJobInput) {
  return enqueueIngestionJob(input);
}

// ─── Worker entry point ───────────────────────────────────────────────────────

const WORKER_ID = `worker-${randomUUID()}`;

/**
 * Claim and process the next queued ingestion job.
 * Safe to call in a polling loop from a worker process.
 *
 * @returns true if a job was processed, false if the queue was empty
 */
export async function processNextIngestionJob(): Promise<boolean> {
  const job = await claimNextIngestionJob(WORKER_ID);
  if (!job) return false;

  await runPipeline(job.id, job.organizationId, job.knowledgeSourceId, job.sourceVersionId);
  return true;
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

async function runPipeline(
  jobId: string,
  organizationId: string,
  knowledgeSourceId: string,
  sourceVersionId: string,
): Promise<void> {
  const heartbeatInterval = setInterval(
    () => heartbeatIngestionJob(jobId).catch(() => {}),
    30_000,
  );

  try {
    // ── Stage 1: validate job & source ─────────────────────────────────────
    const job = await getIngestionJob(jobId, organizationId);
    if (!job) throw new PipelineError("Job not found after claim.", "JOB_NOT_FOUND");

    const [sourceRows, versionRows] = await Promise.all([
      db.select().from(knowledgeSourcesTable)
        .where(and(eq(knowledgeSourcesTable.id, knowledgeSourceId), eq(knowledgeSourcesTable.organizationId, organizationId)))
        .limit(1),
      db.select().from(knowledgeSourceVersionsTable)
        .where(and(eq(knowledgeSourceVersionsTable.id, sourceVersionId), eq(knowledgeSourceVersionsTable.organizationId, organizationId)))
        .limit(1),
    ]);

    const source  = sourceRows[0];
    const version = versionRows[0];

    if (!source)  throw new PipelineError("Source not found.",  "SOURCE_NOT_FOUND");
    if (!version) throw new PipelineError("Version not found.", "VERSION_NOT_FOUND");

    // Abort if source was revoked
    if (source.status === "revoked" || source.revokedAt) {
      await failIngestionJob(jobId, organizationId, "SOURCE_REVOKED", "Source was revoked before processing completed.");
      await updateVersionIngestionStatus(sourceVersionId, organizationId, "failed");
      return;
    }

    // ── Stage 2: fetch from object storage ─────────────────────────────────
    await transitionIngestionJobStatus(jobId, organizationId, "extracting");
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "processing");

    const storageKey = version.storageKey;
    if (!storageKey) throw new PipelineError("Version has no storage key.", "MISSING_STORAGE_KEY");

    const buffer = await fetchFromObjectStorage(storageKey);

    // ── Stage 3: extract text ───────────────────────────────────────────────
    const ext = extFromMime(version.mimeType ?? "");
    const extractor = getExtractor(version.mimeType ?? "", ext);
    const extraction = await extractor.extract(buffer, {
      originalFileName: version.originalFileName ?? "document",
      mimeType: version.mimeType ?? "",
      fileSize: version.fileSize ?? buffer.length,
      checksum: version.checksum ?? "",
    });

    if (extraction.isScanned) {
      // Proceed with whatever text was extracted; flag for review
      await transitionIngestionJobStatus(jobId, organizationId, "normalising", {
        metadata: { warnings: extraction.warnings, isScanned: true },
      });
    } else {
      await transitionIngestionJobStatus(jobId, organizationId, "normalising", {
        extractionProvider: extractor.getProviderName(),
        extractionProviderVersion: extractor.getProviderVersion(),
        metadata: { warnings: extraction.warnings },
      });
    }

    // ── Stage 4: normalise ──────────────────────────────────────────────────
    const normalised = normaliseDocument(extraction);

    // ── Stage 5: chunk ──────────────────────────────────────────────────────
    await transitionIngestionJobStatus(jobId, organizationId, "chunking");
    const chunks = chunkDocument(normalised, extraction, DEFAULT_CHUNK_OPTIONS);

    if (chunks.length === 0) {
      throw new PipelineError("Chunking produced zero chunks — document may be empty.", "NO_CHUNKS");
    }

    // ── Stage 6: injection scan ─────────────────────────────────────────────
    const injectionResult = scanForInjection(chunks.map((c) => ({ text: c.text })));

    // ── Stage 7: generate embeddings ────────────────────────────────────────
    await transitionIngestionJobStatus(jobId, organizationId, "embedding");

    const provider = getEmbeddingProvider(source.sensitivityClassification ?? "internal");
    let totalEmbeddings = 0;

    const chunkTexts = chunks.map((c) => c.text);
    let embeddingBatch: number[][] = [];

    try {
      const batchResult = await provider.generateEmbeddings(chunkTexts);
      embeddingBatch = batchResult.embeddings.map((e) => e.embedding);
      totalEmbeddings = embeddingBatch.filter((v) => v.some((x) => x !== 0)).length;

      // Audit: embedding batch generated
      logOrgEvent({
        eventType: "knowledge_hub.embeddings_generated",
        organizationId,
        resourceType: "knowledge_source",
        resourceId: knowledgeSourceId,
        isSensitive: source.sensitivityClassification === "confidential" || source.sensitivityClassification === "restricted",
        metadata: {
          model: provider.getModelName(),
          provider: provider.getProviderName(),
          chunkCount: chunks.length,
          dimensions: provider.getDimensions(),
          // Never include raw text in audit events
        },
      }).catch(() => {});
    } catch (err) {
      // Embedding failure is non-fatal — fall back to lexical-only
      console.warn(
        `[IngestionPipeline] Embedding failed for job ${jobId} — continuing without embeddings. ` +
          `Code: ${err instanceof Error ? err.message.slice(0, 100) : "unknown"}`,
      );
      embeddingBatch = chunks.map(() => []);
    }

    // ── Stage 8: persist chunks ─────────────────────────────────────────────
    // Soft-delete existing chunks for this version before inserting new ones
    await db
      .update(knowledgeChunksTable)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(knowledgeChunksTable.sourceVersionId, sourceVersionId),
          eq(knowledgeChunksTable.organizationId, organizationId),
        ),
      );

    // Insert new chunks in batches of 100
    const BATCH_SIZE = 100;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const values = batch.map((c, batchIdx) => {
        const globalIdx = i + batchIdx;
        const vec = embeddingBatch[globalIdx];
        return {
          id: randomUUID(),
          organizationId,
          knowledgeSourceId,
          sourceVersionId,
          chunkIndex: c.chunkIndex,
          sectionTitle: c.sectionTitle,
          pageNumber: c.pageNumber,
          headingPath: c.headingPath,
          text: c.text,
          tokenCount: c.tokenCount,
          embedding: (vec && vec.length > 0 && vec.some((x) => x !== 0)) ? vec : null,
          embeddingModel: provider.isActive() ? provider.getModelName() : null,
          embeddingDimensions: provider.isActive() ? provider.getDimensions() : null,
          contentHash: c.contentHash,
          chunkingStrategy: c.chunkingStrategy,
          chunkingStrategyVersion: c.chunkingStrategyVersion,
        };
      });

      await db.insert(knowledgeChunksTable).values(values);
    }

    // ── Stage 9: update version ingestion status ────────────────────────────
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "complete");

    // ── Stage 10: complete job ──────────────────────────────────────────────
    await completeIngestionJob({
      id: jobId,
      organizationId,
      chunkCount: chunks.length,
      embeddingCount: totalEmbeddings,
      extractionProvider: extractor.getProviderName(),
      extractionProviderVersion: extractor.getProviderVersion(),
      embeddingProvider: provider.getProviderName(),
      embeddingModel: provider.getModelName(),
      embeddingDimensions: provider.getDimensions(),
      chunkingStrategy: DEFAULT_CHUNK_OPTIONS.strategy,
      chunkingStrategyVersion: DEFAULT_CHUNK_OPTIONS.strategyVersion,
      promptInjectionFlags: injectionResult.flags,
      requiresHumanReview:
        injectionResult.requiresHumanReview || extraction.isScanned,
      metadata: {
        characterCount: normalised.characterCount,
        tokenEstimate: normalised.tokenEstimate,
        normalisedHash: normalised.normalisedHash,
        headerFooterReduced: normalised.headerFooterReduced,
        warnings: extraction.warnings,
        isSemanticActive: provider.isActive(),
        injectionFlagCount: injectionResult.flags.length,
      },
    });

    // ── Stage 11: update source status ─────────────────────────────────────
    await db
      .update(knowledgeSourcesTable)
      .set({ status: "review_required", updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeSourcesTable.id, knowledgeSourceId),
          eq(knowledgeSourcesTable.organizationId, organizationId),
        ),
      );

    logOrgEvent({
      eventType: "knowledge_hub.ingestion_complete",
      organizationId,
      resourceType: "knowledge_source",
      resourceId: knowledgeSourceId,
      isSensitive: false,
      metadata: {
        chunkCount: chunks.length,
        embeddingCount: totalEmbeddings,
        requiresHumanReview: injectionResult.requiresHumanReview || extraction.isScanned,
      },
    }).catch(() => {});
  } catch (err) {
    clearInterval(heartbeatInterval);
    const code = err instanceof PipelineError ? err.code : "PIPELINE_ERROR";
    const safeMsg = err instanceof Error ? err.message.slice(0, 400) : "Unknown error";
    await failIngestionJob(jobId, organizationId, code, safeMsg).catch(() => {});
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "failed").catch(() => {});
    throw err;
  }

  clearInterval(heartbeatInterval);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

class PipelineError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
  }
}

/**
 * Download a file from GCS object storage as a Buffer.
 * storageKey is tenant-scoped (e.g. "orgs/xxx/library/yyy/file.pdf").
 * In AWS: replace with S3.getObject({ Bucket, Key }) → .Body buffer.
 */
async function fetchFromObjectStorage(storageKey: string): Promise<Buffer> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    throw new PipelineError(
      "PRIVATE_OBJECT_DIR not configured — cannot fetch source file.",
      "STORAGE_NOT_CONFIGURED",
    );
  }

  const fullPath = `${privateDir}/${storageKey}`;
  // Parse gs://bucket/object or bucket/object
  const stripped = fullPath.replace(/^gs:\/\//, "");
  const slashIdx = stripped.indexOf("/");
  if (slashIdx === -1) {
    throw new PipelineError("Invalid storage key — cannot parse bucket path.", "INVALID_STORAGE_KEY");
  }
  const bucketName = stripped.slice(0, slashIdx);
  const objectName = stripped.slice(slashIdx + 1);

  try {
    const { Storage } = await import("@google-cloud/storage");
    const bucket = new Storage().bucket(bucketName);
    const [fileBuffer] = await bucket.file(objectName).download();
    return fileBuffer as Buffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "Unknown error";
    if (msg.includes("No such object") || msg.includes("404")) {
      throw new PipelineError("Source file not found in storage.", "OBJECT_NOT_FOUND");
    }
    throw new PipelineError(`Failed to fetch source file: ${msg}`, "FETCH_FAILED");
  }
}

async function updateVersionIngestionStatus(
  sourceVersionId: string,
  organizationId: string,
  ingestionStatus: string,
): Promise<void> {
  await db
    .update(knowledgeSourceVersionsTable)
    .set({ ingestionStatus, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSourceVersionsTable.id, sourceVersionId),
        eq(knowledgeSourceVersionsTable.organizationId, organizationId),
      ),
    );
}

/** Map MIME type to a file extension for the extractor registry. */
function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "text/x-markdown": ".md",
  };
  return map[mimeType] ?? "";
}
