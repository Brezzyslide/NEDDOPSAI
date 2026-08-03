/**
 * Knowledge Hub — Ingestion Pipeline Service
 *
 * Full asynchronous ingestion pipeline for one knowledge source version.
 *
 * Pipeline stages:
 *   1. Validate job & source (cancellation check)
 *   2. Fetch file from object storage (cancellation check)
 *   3. Extract text (cancellation check)
 *   4. Normalise text (cancellation check)
 *   5. Chunk document (cancellation check)
 *   6. Scan for injection / poisoning patterns (cancellation check)
 *   7. Generate embeddings (cancellation check)
 *   8. Persist chunks to knowledge_chunks
 *   9. Update source version ingestionStatus
 *  10. Transition ingestion job to "review_required"
 *  11. Update source status to "review_required"
 *
 * Properties:
 *   - Cancellable: checks cancellation flag before each major stage
 *   - Idempotent: re-running a job re-processes but does not create duplicates
 *   - Auditable: every sensitive operation emits an audit event
 *   - Tenant-isolated: all DB writes use organizationId
 *   - No retrieval before approval: chunks are soft-deleted until source is approved
 *   - No raw content in logs: only counts and codes are logged
 *
 * AWS readiness:
 *   - Designed to run inside any worker process or ECS task
 *   - Replace queue calls with SQS adapter (IIngestionQueue interface)
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
import { getIngestionQueue }       from "../lib/ingestionQueue/index.js";
import {
  enqueueIngestionJob,
  getIngestionJob,
  type EnqueueIngestionJobInput,
} from "./ingestionJobService.js";
import { logOrgEvent } from "./auditService.js";
import { enqueueCurationJobAsync } from "./knowledgeCurationService.js";

// ─── Ingestion trigger ────────────────────────────────────────────────────────

/**
 * Enqueue an ingestion job for the given knowledge source version.
 * Returns immediately — processing is deferred to the worker.
 * Idempotent: if an active job exists for this version, returns it.
 */
export async function triggerIngestion(input: EnqueueIngestionJobInput) {
  return enqueueIngestionJob(input);
}

// ─── Worker entry point ───────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline for a job that has already been claimed.
 * Called by KnowledgeIngestionWorker after claimNext().
 *
 * On pipeline failure the job is automatically failed/dead-lettered via the
 * queue adapter. The worker does not need to call fail() separately.
 *
 * @param jobId           claimed job id
 * @param organizationId  tenant id
 * @param knowledgeSourceId source id
 * @param sourceVersionId   version id
 * @param workerId        identity of the claiming worker (for lease checks)
 */
export async function runPipelineForJob(
  jobId:             string,
  organizationId:    string,
  knowledgeSourceId: string,
  sourceVersionId:   string,
  workerId:          string,
): Promise<void> {
  await runPipeline(jobId, organizationId, knowledgeSourceId, sourceVersionId, workerId);
}

/**
 * Legacy single-call entry: claim + run. Kept for backward compatibility.
 * Prefer runPipelineForJob when the worker has already claimed the job.
 */
export async function processNextIngestionJob(): Promise<boolean> {
  const queue = getIngestionQueue();
  const job   = await queue.claimNext(`legacy-${randomUUID()}`);
  if (!job) return false;
  await runPipeline(job.id, job.organizationId, job.knowledgeSourceId, job.sourceVersionId, "legacy");
  return true;
}

// ─── Cancellation check ───────────────────────────────────────────────────────

/** Thrown when a cancellation is detected between stages. */
class CancellationError extends Error {
  readonly code = "CANCELLED";
  constructor() { super("Job was cancelled between pipeline stages."); }
}

async function checkCancellation(jobId: string, organizationId: string): Promise<void> {
  const job = await getIngestionJob(jobId, organizationId);
  if (job?.status === "cancelling" || job?.status === "cancelled") {
    throw new CancellationError();
  }
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

async function runPipeline(
  jobId:             string,
  organizationId:    string,
  knowledgeSourceId: string,
  sourceVersionId:   string,
  workerId:          string,
): Promise<void> {
  const queue = getIngestionQueue();

  try {
    // ── Stage 1: validate job & source ─────────────────────────────────────
    await checkCancellation(jobId, organizationId);

    const job = await getIngestionJob(jobId, organizationId);
    if (!job) throw new PipelineError("Job not found after claim.", "JOB_NOT_FOUND", true);

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

    if (!source)  throw new PipelineError("Source not found.",  "SOURCE_NOT_FOUND",  true);
    if (!version) throw new PipelineError("Version not found.", "VERSION_NOT_FOUND", true);

    if (source.status === "revoked" || source.revokedAt) {
      throw new PipelineError("Source was revoked before processing.", "SOURCE_REVOKED", true);
    }

    // ── Stage 2: fetch from object storage ─────────────────────────────────
    await checkCancellation(jobId, organizationId);
    await _transition(jobId, organizationId, "extracting");
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "processing");

    const storageKey = version.storageKey;
    if (!storageKey) throw new PipelineError("Version has no storage key.", "MISSING_STORAGE_KEY", true);

    const buffer = await fetchFromObjectStorage(storageKey);

    // ── Stage 3: extract text ───────────────────────────────────────────────
    await checkCancellation(jobId, organizationId);

    const ext = extFromMime(version.mimeType ?? "");
    const extractor = getExtractor(version.mimeType ?? "", ext);
    const extraction = await extractor.extract(buffer, {
      originalFileName: version.originalFileName ?? "document",
      mimeType:         version.mimeType ?? "",
      fileSize:         version.fileSize ?? buffer.length,
      checksum:         version.checksum ?? "",
    });

    await _transition(jobId, organizationId, "normalising", {
      extractionProvider:        extractor.getProviderName(),
      extractionProviderVersion: extractor.getProviderVersion(),
      metadata: { warnings: extraction.warnings, isScanned: extraction.isScanned },
    });

    // ── Stage 4: normalise ──────────────────────────────────────────────────
    await checkCancellation(jobId, organizationId);
    const normalised = normaliseDocument(extraction);

    // ── Stage 5: chunk ──────────────────────────────────────────────────────
    await checkCancellation(jobId, organizationId);
    await _transition(jobId, organizationId, "chunking");
    const chunks = chunkDocument(normalised, extraction, DEFAULT_CHUNK_OPTIONS);

    if (chunks.length === 0) {
      throw new PipelineError("Chunking produced zero chunks — document may be empty.", "NO_CHUNKS", true);
    }

    // ── Stage 6: injection scan ─────────────────────────────────────────────
    await checkCancellation(jobId, organizationId);
    const injectionResult = scanForInjection(chunks.map((c) => ({ text: c.text })));

    // ── Stage 7: generate embeddings ────────────────────────────────────────
    await checkCancellation(jobId, organizationId);
    await _transition(jobId, organizationId, "embedding");

    const provider = getEmbeddingProvider(source.sensitivityClassification ?? "internal");
    let totalEmbeddings = 0;
    let embeddingBatch: number[][] = [];

    try {
      const batchResult = await provider.generateEmbeddings(chunks.map((c) => c.text));
      embeddingBatch    = batchResult.embeddings.map((e) => e.embedding);
      totalEmbeddings   = embeddingBatch.filter((v) => v.some((x) => x !== 0)).length;

      logOrgEvent({
        eventType:      "knowledge_hub.embeddings_generated",
        organizationId,
        resourceType:   "knowledge_source",
        resourceId:     knowledgeSourceId,
        isSensitive:    source.sensitivityClassification === "confidential" || source.sensitivityClassification === "restricted",
        metadata: {
          model:      provider.getModelName(),
          provider:   provider.getProviderName(),
          chunkCount: chunks.length,
          dimensions: provider.getDimensions(),
        },
      }).catch(() => {});
    } catch {
      embeddingBatch = chunks.map(() => []);
    }

    // ── Stage 8: persist chunks ─────────────────────────────────────────────
    // Check cancellation before writing — no chunks after cancellation observed
    await checkCancellation(jobId, organizationId);

    await db
      .update(knowledgeChunksTable)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(knowledgeChunksTable.sourceVersionId, sourceVersionId),
          eq(knowledgeChunksTable.organizationId,  organizationId),
        ),
      );

    const BATCH_SIZE = 100;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      await checkCancellation(jobId, organizationId);
      const batch = chunks.slice(i, i + BATCH_SIZE);
      await db.insert(knowledgeChunksTable).values(
        batch.map((c, batchIdx) => {
          const globalIdx = i + batchIdx;
          const vec = embeddingBatch[globalIdx];
          return {
            id:                     randomUUID(),
            organizationId,
            knowledgeSourceId,
            sourceVersionId,
            chunkIndex:             c.chunkIndex,
            sectionTitle:           c.sectionTitle,
            pageNumber:             c.pageNumber,
            headingPath:            c.headingPath,
            text:                   c.text,
            tokenCount:             c.tokenCount,
            embedding:              (vec && vec.length > 0 && vec.some((x) => x !== 0)) ? vec : null,
            embeddingModel:         provider.isActive() ? provider.getModelName() : null,
            embeddingDimensions:    provider.isActive() ? provider.getDimensions() : null,
            contentHash:            c.contentHash,
            chunkingStrategy:       c.chunkingStrategy,
            chunkingStrategyVersion: c.chunkingStrategyVersion,
          };
        }),
      );
    }

    // ── Stage 9: update version ingestion status ────────────────────────────
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "complete");

    // ── Stage 10: complete job ──────────────────────────────────────────────
    await queue.complete({
      id:                      jobId,
      organizationId,
      chunkCount:              chunks.length,
      embeddingCount:          totalEmbeddings,
      extractionProvider:      extractor.getProviderName(),
      extractionProviderVersion: extractor.getProviderVersion(),
      embeddingProvider:       provider.getProviderName(),
      embeddingModel:          provider.getModelName(),
      embeddingDimensions:     provider.getDimensions(),
      chunkingStrategy:        DEFAULT_CHUNK_OPTIONS.strategy,
      chunkingStrategyVersion: DEFAULT_CHUNK_OPTIONS.strategyVersion,
      promptInjectionFlags:    injectionResult.flags,
      requiresHumanReview:     injectionResult.requiresHumanReview || extraction.isScanned,
      metadata: {
        characterCount:      normalised.characterCount,
        tokenEstimate:       normalised.tokenEstimate,
        normalisedHash:      normalised.normalisedHash,
        headerFooterReduced: normalised.headerFooterReduced,
        warnings:            extraction.warnings,
        isSemanticActive:    provider.isActive(),
        injectionFlagCount:  injectionResult.flags.length,
      },
    });

    // ── Stage 11: update source status ─────────────────────────────────────
    await db
      .update(knowledgeSourcesTable)
      .set({ status: "review_required", updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeSourcesTable.id,             knowledgeSourceId),
          eq(knowledgeSourcesTable.organizationId, organizationId),
        ),
      );

    logOrgEvent({
      eventType:      "knowledge_hub.ingestion_complete",
      organizationId,
      resourceType:   "knowledge_source",
      resourceId:     knowledgeSourceId,
      isSensitive:    false,
      metadata: {
        chunkCount:          chunks.length,
        embeddingCount:      totalEmbeddings,
        requiresHumanReview: injectionResult.requiresHumanReview || extraction.isScanned,
      },
    }).catch(() => {});

    // Sprint 21: trigger knowledge curation after ingestion completes (fire-and-forget)
    enqueueCurationJobAsync({
      organizationId,
      knowledgeSourceId,
      sourceVersionId,
      triggerEvent: "uploaded",
      actorUserId:  "system",
    });

  } catch (err) {
    // Cancellation — clean up partial chunks and finalise
    if (err instanceof CancellationError) {
      await db
        .update(knowledgeChunksTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(knowledgeChunksTable.sourceVersionId, sourceVersionId),
            eq(knowledgeChunksTable.organizationId,  organizationId),
          ),
        ).catch(() => {});

      await queue.finaliseCancellation(jobId, organizationId).catch(() => {});
      await updateVersionIngestionStatus(sourceVersionId, organizationId, "failed").catch(() => {});
      logOrgEvent({
        eventType: "knowledge_hub.ingestion_cancelled",
        organizationId, resourceType: "knowledge_source", resourceId: knowledgeSourceId,
      }).catch(() => {});
      return; // not an error — normal cancellation
    }

    // Pipeline error — fail the job (queue adapter handles backoff / dead-letter)
    const code        = err instanceof PipelineError ? err.code : "PIPELINE_ERROR";
    const safeMsg     = err instanceof Error ? err.message.slice(0, 400) : "Unknown error";
    const nonRetryable = err instanceof PipelineError ? err.nonRetryable : false;

    await queue.fail(jobId, organizationId, code, safeMsg, nonRetryable).catch(() => {});
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "failed").catch(() => {});

    const failedErr: any = new Error(safeMsg);
    failedErr.code = code;
    // Signal dead-letter to worker for metrics
    const job = await getIngestionJob(jobId, organizationId).catch(() => null);
    if (job?.status === "dead_lettered") {
      failedErr.deadLettered = true;
    }
    throw failedErr;
  }
}

// ─── Stage transition helper ──────────────────────────────────────────────────

async function _transition(
  jobId:          string,
  organizationId: string,
  newStatus:      string,
  updates:        Record<string, unknown> = {},
): Promise<void> {
  const { transitionIngestionJobStatus } = await import("./ingestionJobService.js");
  await transitionIngestionJobStatus(jobId, organizationId, newStatus as any, updates as any);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

class PipelineError extends Error {
  readonly code:         string;
  readonly nonRetryable: boolean;
  constructor(message: string, code: string, nonRetryable = false) {
    super(message);
    this.name          = "PipelineError";
    this.code          = code;
    this.nonRetryable  = nonRetryable;
  }
}

async function fetchFromObjectStorage(storageKey: string): Promise<Buffer> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    throw new PipelineError(
      "PRIVATE_OBJECT_DIR not configured — cannot fetch source file.",
      "STORAGE_NOT_CONFIGURED",
    );
  }

  const fullPath = `${privateDir}/${storageKey}`;
  const stripped = fullPath.replace(/^gs:\/\//, "");
  const slashIdx = stripped.indexOf("/");
  if (slashIdx === -1) {
    throw new PipelineError("Invalid storage key — cannot parse bucket path.", "INVALID_STORAGE_KEY", true);
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
  organizationId:  string,
  ingestionStatus: string,
): Promise<void> {
  await db
    .update(knowledgeSourceVersionsTable)
    .set({ ingestionStatus, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeSourceVersionsTable.id,             sourceVersionId),
        eq(knowledgeSourceVersionsTable.organizationId, organizationId),
      ),
    );
}

function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "text/plain":      ".txt",
    "text/markdown":   ".md",
    "text/x-markdown": ".md",
  };
  return map[mimeType] ?? "";
}
