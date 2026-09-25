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
 * Error handling (Sprint 28.6):
 *   - Errors are written to the DB independently of queue.fail() so they survive
 *     lease-expiry dead-lettering (where recoverStuck() previously lost the message).
 *   - Every dead-lettered or failed job MUST have a last_error_code.
 *   - Errors are classified: transient (retry) | permanent (dead-letter now) | unknown.
 *
 * AWS readiness:
 *   - Designed to run inside any worker process or ECS task
 *   - Replace queue calls with SQS adapter (IIngestionQueue interface)
 */

import { randomUUID } from "crypto";
import { db, withSystemTenantContext } from "@workspace/db";
import {
  knowledgeChunksTable,
  knowledgeSourceVersionsTable,
  knowledgeSourcesTable,
  ingestionJobsTable,
} from "@workspace/db";
import { eq, and, sql, isNull, ne } from "drizzle-orm";
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
import { deriveCanonicalTitle, deriveSearchAliases } from "./documentIdentityService.js";

// ─── Error classification ─────────────────────────────────────────────────────

export type IngestionErrorCategory = "transient" | "permanent" | "unknown";

/** Codes that are inherently permanent — the document itself is the problem. */
const PERMANENT_CODES = new Set([
  "UNSUPPORTED_FILE_TYPE", "CORRUPTED_DOCUMENT", "CORRUPTED_FILE",
  "ENCRYPTED_DOCUMENT", "EMPTY_DOCUMENT", "OVERSIZED_CONTENT",
  "NO_CHUNKS", "SENSITIVITY_BLOCKED", "MISSING_STORAGE_KEY",
  "INVALID_STORAGE_KEY", "SOURCE_REVOKED", "SOURCE_NOT_FOUND", "VERSION_NOT_FOUND",
  "OBJECT_NOT_FOUND", "STORAGE_NOT_CONFIGURED", "STORAGE_MISCONFIGURED",
  "JOB_NOT_FOUND", "EXTRACTION_FAILED_PERMANENT",
]);

/** Codes that are transient — infrastructure/network, worth retrying. */
const TRANSIENT_CODES = new Set([
  "FETCH_FAILED_TRANSIENT", "EMBEDDING_TIMEOUT", "EMBEDDING_UNAVAILABLE",
  "STORAGE_TIMEOUT", "DB_TIMEOUT",
]);

export function classifyIngestionError(code: string, err?: unknown): IngestionErrorCategory {
  if (PERMANENT_CODES.has(code)) return "permanent";
  if (TRANSIENT_CODES.has(code)) return "transient";
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (
    msg.includes("timeout") || msg.includes("econnrefused") ||
    msg.includes("econnreset") || msg.includes("etimedout") ||
    msg.includes("network error") || msg.includes("socket hang up")
  ) return "transient";
  return "unknown";
}

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

type DbClient = typeof db;

function withIngestionPipelineTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "ingestion_pipeline_service", purpose },
    fn,
  );
}

/**
 * Legacy single-call entry: claim + run. Kept for backward compatibility.
 */
export async function processNextIngestionJob(): Promise<boolean> {
  const queue = getIngestionQueue();
  const job   = await queue.claimNext(`legacy-${randomUUID()}`);
  if (!job) return false;
  await runPipeline(job.id, job.organizationId, job.knowledgeSourceId, job.sourceVersionId, "legacy");
  return true;
}

// ─── Cancellation check ───────────────────────────────────────────────────────

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

  // Track the current stage for diagnostics — updated at each transition.
  let currentStage = "validating";

  try {
    // ── Stage 1: validate job & source ─────────────────────────────────────
    await checkCancellation(jobId, organizationId);

    const job = await getIngestionJob(jobId, organizationId);
    if (!job) throw new PipelineError("Job not found after claim.", "JOB_NOT_FOUND", true);

    const [sourceRows, versionRows] = await withIngestionPipelineTenant(
      organizationId,
      "ingestion_pipeline.load_source_version",
      (client) => Promise.all([
        client.select().from(knowledgeSourcesTable)
          .where(and(eq(knowledgeSourcesTable.id, knowledgeSourceId), eq(knowledgeSourcesTable.organizationId, organizationId)))
          .limit(1),
        client.select().from(knowledgeSourceVersionsTable)
          .where(and(eq(knowledgeSourceVersionsTable.id, sourceVersionId), eq(knowledgeSourceVersionsTable.organizationId, organizationId)))
          .limit(1),
      ]),
    );

    const source  = sourceRows[0];
    const version = versionRows[0];

    if (!source)  throw new PipelineError("Source not found.",  "SOURCE_NOT_FOUND",  true);
    if (!version) throw new PipelineError("Version not found.", "VERSION_NOT_FOUND", true);

    if (source.status === "revoked" || source.revokedAt) {
      throw new PipelineError("Source was revoked before processing.", "SOURCE_REVOKED", true);
    }

    // ── Stage 2: fetch from object storage ─────────────────────────────────
    currentStage = "fetching";
    await checkCancellation(jobId, organizationId);
    const jobStateRows = await withIngestionPipelineTenant(
      organizationId,
      "ingestion_pipeline.read_job_state",
      (client) => client
        .select({ status: ingestionJobsTable.status })
        .from(ingestionJobsTable)
        .where(and(eq(ingestionJobsTable.id, jobId), eq(ingestionJobsTable.organizationId, organizationId)))
        .limit(1),
    );
    if (jobStateRows[0]?.status === "queued") {
      await _transition(jobId, organizationId, "fetching");
    }
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "processing");

    const storageKey = version.storageKey;
    if (!storageKey) throw new PipelineError("Version has no storage key.", "MISSING_STORAGE_KEY", true);

    const buffer = await fetchFromObjectStorage(storageKey);

    // ── Stage 3: extract text ───────────────────────────────────────────────
    currentStage = "extracting";
    await checkCancellation(jobId, organizationId);
    await _transition(jobId, organizationId, "extracting");

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
    currentStage = "normalising";
    await checkCancellation(jobId, organizationId);
    const normalised = normaliseDocument(extraction);

    // ── Stage 5: chunk ──────────────────────────────────────────────────────
    currentStage = "chunking";
    await checkCancellation(jobId, organizationId);
    await _transition(jobId, organizationId, "chunking");
    const chunks = chunkDocument(normalised, extraction, DEFAULT_CHUNK_OPTIONS);

    if (chunks.length === 0) {
      throw new PipelineError("Chunking produced zero chunks — document may be empty.", "NO_CHUNKS", true);
    }

    // ── Stage 5.5: derive canonical document identity ───────────────────────
    // Extracts a human-readable canonical title from content headings and stores
    // it on knowledge_sources for multi-signal presence lookup.
    // Only writes when canonical_title is not already set — re-runs are idempotent.
    {
      const canonicalTitle = deriveCanonicalTitle({
        explicitTitle:    source.title ?? undefined,
        originalFileName: source.originalFileName ?? undefined,
        chunks: chunks.slice(0, 5).map(c => ({
          sectionTitle: c.sectionTitle ?? null,
          text:         c.text,
          chunkIndex:   c.chunkIndex,
        })),
      });
      const aliases = deriveSearchAliases({
        canonicalTitle,
        originalFileName: source.originalFileName ?? undefined,
        sourceType:       source.sourceType,
      });
      if (canonicalTitle) {
        await withIngestionPipelineTenant(
          organizationId,
          "ingestion_pipeline.update_source_identity",
          (client) => client
            .update(knowledgeSourcesTable)
            .set({
              canonicalTitle,
              searchAliases: aliases.length > 0 ? aliases : [],
              updatedAt:     new Date(),
            })
            .where(
              and(
                eq(knowledgeSourcesTable.id,             knowledgeSourceId),
                eq(knowledgeSourcesTable.organizationId, organizationId),
                isNull(knowledgeSourcesTable.canonicalTitle),
              ),
            ),
        );
      }
    }

    // ── Stage 6: injection scan ─────────────────────────────────────────────
    currentStage = "scanning";
    await checkCancellation(jobId, organizationId);
    const injectionResult = scanForInjection(chunks.map((c) => ({ text: c.text })));

    // ── Stage 7: generate embeddings ────────────────────────────────────────
    currentStage = "embedding";
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
    } catch (embErr) {
      // Log the embedding error so it's visible in worker output.
      // Chunks are still persisted without embeddings — vector search won't
      // work until embeddings are generated, but the pipeline completes.
      const errMsg = embErr instanceof Error ? embErr.message : String(embErr);
      console.error(
        `[ingestion-pipeline] Embedding failed for job ${jobId}` +
          ` (${chunks.length} chunks): ${errMsg}`,
      );
      embeddingBatch = chunks.map(() => []);
    }

    // ── Stage 8: persist chunks ─────────────────────────────────────────────
    currentStage = "persisting";
    await checkCancellation(jobId, organizationId);

    await withIngestionPipelineTenant(
      organizationId,
      "ingestion_pipeline.soft_delete_prior_chunks",
      (client) => client
        .update(knowledgeChunksTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(knowledgeChunksTable.sourceVersionId, sourceVersionId),
            eq(knowledgeChunksTable.organizationId,  organizationId),
          ),
        ),
    );

    const BATCH_SIZE = 100;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      await checkCancellation(jobId, organizationId);
      const batch = chunks.slice(i, i + BATCH_SIZE);
      await withIngestionPipelineTenant(organizationId, "ingestion_pipeline.insert_chunks", (client) =>
        client.insert(knowledgeChunksTable).values(
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
        ),
      );
    }

    // ── Stage 9: update version ingestion status ────────────────────────────
    currentStage = "completing";
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
        failedStage:         null,
        errorCategory:       null,
      },
    });

    // ── Stage 11: update source status ─────────────────────────────────────
    // Auto-approve completed ingestion by default so evidence is retrievable.
    // The only automatic holdback is a substantial same-type overlap with an
    // already approved source; then human review must decide which document governs.
    const requiresHumanReview = injectionResult.requiresHumanReview || extraction.isScanned;
    let finalSourceStatus: "review_required" | "approved" = "review_required";
    let autoApprovalConflict: AutoApprovalConflict | null = null;

    try {
      autoApprovalConflict = await detectAutoApprovalConflict({
        organizationId,
        knowledgeSourceId,
        sourceVersionId,
      });
      finalSourceStatus = autoApprovalConflict ? "review_required" : "approved";
    } catch {
      // Conflict-detection failure must never accidentally approve a source.
      finalSourceStatus = "review_required";
    }

    await withIngestionPipelineTenant(
      organizationId,
      "ingestion_pipeline.update_source_status",
      async (client) => {
        const statusMetadataPatch = finalSourceStatus === "approved"
          ? {
              autoApproval: {
                status: "approved",
                reason: "No substantial same-type overlap with an existing approved source was detected.",
                approvedAt: new Date().toISOString(),
                requiresHumanReview,
              },
            }
          : autoApprovalConflict
            ? {
                autoApproval: {
                  status: "conflict_review_required",
                  requiresHumanReview: true,
                  conflict: autoApprovalConflict,
                  message: autoApprovalConflict.message,
                },
              }
            : {
                autoApproval: {
                  status: "review_required",
                  requiresHumanReview,
                  message: "Auto-approval was not applied because conflict detection could not be completed safely.",
                },
              };

        await client
          .update(knowledgeSourcesTable)
          .set({
            status: finalSourceStatus,
            approvedByUserId: finalSourceStatus === "approved" ? "system" : null,
            approvedAt: finalSourceStatus === "approved" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(knowledgeSourcesTable.id,             knowledgeSourceId),
              eq(knowledgeSourcesTable.organizationId, organizationId),
            ),
          );

        await client
          .update(knowledgeSourceVersionsTable)
          .set({
            status: finalSourceStatus,
            approvedByUserId: finalSourceStatus === "approved" ? "system" : null,
            approvedAt: finalSourceStatus === "approved" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(knowledgeSourceVersionsTable.id,             sourceVersionId),
              eq(knowledgeSourceVersionsTable.organizationId, organizationId),
              eq(knowledgeSourceVersionsTable.isCurrent,      true),
            ),
          );

        await client
          .update(ingestionJobsTable)
          .set({
            status: finalSourceStatus,
            completedAt: finalSourceStatus === "approved" ? new Date() : null,
            requiresHumanReview: finalSourceStatus === "review_required",
            metadata: sql`COALESCE(${ingestionJobsTable.metadata}, '{}'::jsonb) || ${JSON.stringify(statusMetadataPatch)}::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(ingestionJobsTable.id,             jobId),
              eq(ingestionJobsTable.organizationId, organizationId),
            ),
          );
      },
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
    // ── Cancellation — clean up partial chunks ──────────────────────────────
    if (err instanceof CancellationError) {
      await withIngestionPipelineTenant(
        organizationId,
        "ingestion_pipeline.cancel_cleanup_chunks",
        (client) => client
          .update(knowledgeChunksTable)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(knowledgeChunksTable.sourceVersionId, sourceVersionId),
              eq(knowledgeChunksTable.organizationId,  organizationId),
            ),
          ),
      ).catch(() => {});

      await queue.finaliseCancellation(jobId, organizationId).catch(() => {});
      await updateVersionIngestionStatus(sourceVersionId, organizationId, "failed").catch(() => {});
      logOrgEvent({
        eventType: "knowledge_hub.ingestion_cancelled",
        organizationId, resourceType: "knowledge_source", resourceId: knowledgeSourceId,
      }).catch(() => {});
      return;
    }

    // ── Pipeline error — persist diagnostics FIRST, independently ──────────
    const code          = err instanceof PipelineError ? err.code : "PIPELINE_ERROR";
    const safeMsg       = err instanceof Error ? err.message.slice(0, 400) : "Unknown error";
    const nonRetryable  = err instanceof PipelineError ? err.nonRetryable : false;
    const errorCategory = classifyIngestionError(code, err);

    // Write error info directly to DB before calling queue.fail().
    // This is the authoritative diagnostic write: it runs even if queue.fail()
    // subsequently throws or if the sweeper already moved the job.
    // nonRetryable OR permanent → dead_letter immediately; else → failed for backoff.
    const shouldDeadLetter = nonRetryable || errorCategory === "permanent";
    await _persistErrorDiagnostics(jobId, organizationId, {
      errorCode: code,
      errorMessage: safeMsg,
      failedStage: currentStage,
      errorCategory,
      shouldDeadLetter,
    }).catch(() => {});

    // Update version status
    await updateVersionIngestionStatus(sourceVersionId, organizationId, "failed").catch(() => {});

    // Delegate backoff / dead-letter logic to queue
    await queue.fail(jobId, organizationId, code, safeMsg, shouldDeadLetter).catch(() => {});

    // Check final job status for worker metrics signal
    const finalJob = await getIngestionJob(jobId, organizationId).catch(() => null);
    const deadLettered = finalJob?.status === "dead_lettered";

    const failedErr: any = new Error(safeMsg);
    failedErr.code = code;
    failedErr.errorCategory = errorCategory;
    failedErr.failedStage = currentStage;
    if (deadLettered) failedErr.deadLettered = true;
    throw failedErr;
  }
}

// ─── Diagnostic persistence ───────────────────────────────────────────────────

/**
 * Write error diagnostics directly to the ingestion_jobs row.
 * Runs independently of queue.fail() so errors survive lease-expiry dead-lettering.
 * This write must never block or throw in the caller — always called with .catch(() => {}).
 */
async function _persistErrorDiagnostics(
  jobId:          string,
  organizationId: string,
  diag: {
    errorCode:       string;
    errorMessage:    string;
    failedStage:     string;
    errorCategory:   IngestionErrorCategory;
    shouldDeadLetter: boolean;
  },
): Promise<void> {
  // Direct SQL update so it always reaches the DB even if queue.fail() is about
  // to fail or the row is in an unexpected state. No status change here — that
  // is left to queue.fail() / recoverStuck().
  await withIngestionPipelineTenant(organizationId, "ingestion_pipeline.persist_error_diagnostics", (client) =>
    client.execute(sql`
    UPDATE ingestion_jobs
    SET
      last_error_code    = LEFT(${diag.errorCode.slice(0, 100)}, 100),
      last_error_message = LEFT(${diag.errorMessage.slice(0, 500)}, 500),
      last_failed_at     = NOW(),
      metadata           = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
        failedStage:   diag.failedStage,
        errorCategory: diag.errorCategory,
      })}::jsonb,
      updated_at         = NOW()
    WHERE id              = ${jobId}
      AND organization_id = ${organizationId}
  `),
  );
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

interface AutoApprovalConflict {
  status: "conflict_review_required";
  conflictType: "same_checksum" | "same_canonical_title" | "substantial_chunk_overlap";
  message: string;
  newSource: {
    id: string;
    title: string;
    sourceType: string;
    documentCategory: string | null;
    date: string;
  };
  existingApprovedSource: {
    id: string;
    title: string;
    sourceType: string;
    documentCategory: string | null;
    date: string;
  };
  overlap: {
    matchingChunkHashes: number;
    newChunkCount: number;
    existingChunkCount: number;
    ratioOfNewDocument: number;
  };
}

const SUBSTANTIAL_OVERLAP_MIN_RATIO = 0.35;
const SUBSTANTIAL_OVERLAP_MIN_CHUNKS = 3;

function sourceDisplayDate(row: {
  effectiveFrom: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
}): string {
  const date = row.effectiveFrom ?? row.approvedAt ?? row.createdAt;
  return date.toISOString().slice(0, 10);
}

function normaliseTitle(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildConflictMessage(conflict: Omit<AutoApprovalConflict, "message">): string {
  return [
    "DOCUMENT CONFLICT REQUIRES REVIEW.",
    `"${conflict.newSource.title}" (${conflict.newSource.date}) substantially overlaps approved document ` +
      `"${conflict.existingApprovedSource.title}" (${conflict.existingApprovedSource.date}).`,
    "Neither document should be treated as the governing source until a user chooses which document governs.",
  ].join(" ");
}

async function detectAutoApprovalConflict(input: {
  organizationId: string;
  knowledgeSourceId: string;
  sourceVersionId: string;
}): Promise<AutoApprovalConflict | null> {
  return withIngestionPipelineTenant(
    input.organizationId,
    "ingestion_pipeline.auto_approval_conflict_check",
    async (client) => {
      const sourceRows = await client
        .select({
          id:               knowledgeSourcesTable.id,
          title:            knowledgeSourcesTable.title,
          sourceType:       knowledgeSourcesTable.sourceType,
          documentCategory: knowledgeSourcesTable.documentCategory,
          canonicalTitle:   knowledgeSourcesTable.canonicalTitle,
          checksum:         knowledgeSourcesTable.checksum,
          effectiveFrom:    knowledgeSourcesTable.effectiveFrom,
          approvedAt:       knowledgeSourcesTable.approvedAt,
          createdAt:        knowledgeSourcesTable.createdAt,
        })
        .from(knowledgeSourcesTable)
        .where(and(
          eq(knowledgeSourcesTable.id,             input.knowledgeSourceId),
          eq(knowledgeSourcesTable.organizationId, input.organizationId),
        ))
        .limit(1);

      const source = sourceRows[0];
      if (!source) return null;

      const conflictRows = await client.execute<{
        id: string;
        title: string;
        source_type: string;
        document_category: string | null;
        canonical_title: string | null;
        checksum: string | null;
        effective_from: Date | null;
        approved_at: Date | null;
        created_at: Date;
        matching_chunk_hashes: string | number;
        new_chunk_count: string | number;
        existing_chunk_count: string | number;
      }>(sql`
        WITH new_hashes AS (
          SELECT DISTINCT content_hash
          FROM ${knowledgeChunksTable}
          WHERE organization_id = ${input.organizationId}
            AND knowledge_source_id = ${input.knowledgeSourceId}
            AND source_version_id = ${input.sourceVersionId}
            AND deleted_at IS NULL
            AND content_hash IS NOT NULL
        ),
        new_count AS (
          SELECT COUNT(*)::int AS count FROM new_hashes
        ),
        existing_counts AS (
          SELECT
            ks.id,
            COUNT(DISTINCT kc.content_hash)::int AS existing_chunk_count,
            COUNT(DISTINCT kc.content_hash) FILTER (WHERE nh.content_hash IS NOT NULL)::int AS matching_chunk_hashes
          FROM ${knowledgeSourcesTable} ks
          LEFT JOIN ${knowledgeChunksTable} kc
            ON kc.knowledge_source_id = ks.id
           AND kc.organization_id = ks.organization_id
           AND kc.deleted_at IS NULL
           AND kc.content_hash IS NOT NULL
          LEFT JOIN new_hashes nh ON nh.content_hash = kc.content_hash
          WHERE ks.organization_id = ${input.organizationId}
            AND ks.id <> ${input.knowledgeSourceId}
            AND ks.status = 'approved'
            AND ks.deleted_at IS NULL
            AND ks.source_type = ${source.sourceType}
            AND COALESCE(ks.document_category, '') = COALESCE(${source.documentCategory}, '')
          GROUP BY ks.id
        )
        SELECT
          ks.id,
          ks.title,
          ks.source_type,
          ks.document_category,
          ks.canonical_title,
          ks.checksum,
          ks.effective_from,
          ks.approved_at,
          ks.created_at,
          ec.matching_chunk_hashes,
          nc.count AS new_chunk_count,
          ec.existing_chunk_count
        FROM ${knowledgeSourcesTable} ks
        JOIN existing_counts ec ON ec.id = ks.id
        CROSS JOIN new_count nc
        WHERE
          (
            ${source.checksum ?? null} IS NOT NULL
            AND ks.checksum = ${source.checksum ?? null}
          )
          OR (
            ${normaliseTitle(source.canonicalTitle ?? source.title)}
              <> ''
            AND lower(regexp_replace(regexp_replace(COALESCE(ks.canonical_title, ks.title), '\\.[a-z0-9]{2,5}$', '', 'i'), '[_-]+', ' ', 'g'))
              = ${normaliseTitle(source.canonicalTitle ?? source.title)}
          )
          OR (
            nc.count >= ${SUBSTANTIAL_OVERLAP_MIN_CHUNKS}
            AND ec.matching_chunk_hashes >= ${SUBSTANTIAL_OVERLAP_MIN_CHUNKS}
            AND (ec.matching_chunk_hashes::float / NULLIF(nc.count, 0)) >= ${SUBSTANTIAL_OVERLAP_MIN_RATIO}
          )
        ORDER BY
          CASE
            WHEN ${source.checksum ?? null} IS NOT NULL AND ks.checksum = ${source.checksum ?? null} THEN 0
            WHEN lower(regexp_replace(regexp_replace(COALESCE(ks.canonical_title, ks.title), '\\.[a-z0-9]{2,5}$', '', 'i'), '[_-]+', ' ', 'g'))
              = ${normaliseTitle(source.canonicalTitle ?? source.title)} THEN 1
            ELSE 2
          END,
          ec.matching_chunk_hashes DESC
        LIMIT 1
      `);

      const rows = Array.isArray((conflictRows as any).rows)
        ? (conflictRows as any).rows
        : conflictRows as any[];
      const existing = rows[0];
      if (!existing) return null;

      const matchingChunkHashes = Number(existing.matching_chunk_hashes ?? 0);
      const newChunkCount = Number(existing.new_chunk_count ?? 0);
      const existingChunkCount = Number(existing.existing_chunk_count ?? 0);
      const ratioOfNewDocument = newChunkCount > 0 ? matchingChunkHashes / newChunkCount : 0;
      const conflictType: AutoApprovalConflict["conflictType"] =
        source.checksum && existing.checksum === source.checksum
          ? "same_checksum"
          : normaliseTitle(existing.canonical_title ?? existing.title) === normaliseTitle(source.canonicalTitle ?? source.title)
            ? "same_canonical_title"
            : "substantial_chunk_overlap";

      const conflictWithoutMessage: Omit<AutoApprovalConflict, "message"> = {
        status: "conflict_review_required",
        conflictType,
        newSource: {
          id: source.id,
          title: source.title,
          sourceType: source.sourceType,
          documentCategory: source.documentCategory,
          date: sourceDisplayDate(source),
        },
        existingApprovedSource: {
          id: existing.id,
          title: existing.title,
          sourceType: existing.source_type,
          documentCategory: existing.document_category,
          date: sourceDisplayDate({
            effectiveFrom: existing.effective_from,
            approvedAt: existing.approved_at,
            createdAt: existing.created_at,
          }),
        },
        overlap: {
          matchingChunkHashes,
          newChunkCount,
          existingChunkCount,
          ratioOfNewDocument,
        },
      };

      return {
        ...conflictWithoutMessage,
        message: buildConflictMessage(conflictWithoutMessage),
      };
    },
  );
}

async function fetchFromObjectStorage(storageKey: string): Promise<Buffer> {
  const provider = (process.env.KNOWLEDGE_STORAGE_PROVIDER ?? "").toLowerCase();

  if (provider === "local") {
    return fetchFromLocalObjectStorage(storageKey);
  }

  if (provider === "s3" || process.env.KNOWLEDGE_S3_BUCKET || process.env.APP_STORAGE_BUCKET) {
    return fetchFromS3ObjectStorage(storageKey);
  }

  return fetchFromReplitObjectStorage(storageKey);
}

async function fetchFromLocalObjectStorage(storageKey: string): Promise<Buffer> {
  const root = process.env.KNOWLEDGE_LOCAL_STORAGE_ROOT;
  if (!root) {
    throw new PipelineError(
      "KNOWLEDGE_LOCAL_STORAGE_ROOT not configured — cannot fetch local source file.",
      "STORAGE_NOT_CONFIGURED",
      true,
    );
  }

  const { readFile } = await import("fs/promises");
  const path = await import("path");
  const rootPath = path.resolve(root);
  const targetPath = path.resolve(rootPath, storageKey);

  if (path.isAbsolute(storageKey) || !targetPath.startsWith(`${rootPath}${path.sep}`)) {
    throw new PipelineError(
      "Storage key is not valid for local knowledge storage.",
      "INVALID_STORAGE_KEY",
      true,
    );
  }

  try {
    return await readFile(targetPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new PipelineError(
        `Source file not found in local storage (key: ${storageKey.slice(0, 60)}).`,
        "OBJECT_NOT_FOUND",
        true,
      );
    }

    const msg = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
    throw new PipelineError(`Failed to fetch local source file: ${msg}`, "FETCH_FAILED", false);
  }
}

async function fetchFromS3ObjectStorage(storageKey: string): Promise<Buffer> {
  const bucketName = process.env.KNOWLEDGE_S3_BUCKET ?? process.env.APP_STORAGE_BUCKET;
  if (!bucketName) {
    throw new PipelineError(
      "KNOWLEDGE_S3_BUCKET or APP_STORAGE_BUCKET not configured — cannot fetch source file.",
      "STORAGE_NOT_CONFIGURED",
      true,
    );
  }

  const prefix = (process.env.KNOWLEDGE_S3_PREFIX ?? "knowledge").replace(/^\/+|\/+$/g, "");
  const objectKey = prefix ? `${prefix}/${storageKey}` : storageKey;

  try {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({ region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION });
    const result = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: objectKey }));
    return await streamToBuffer(result.Body);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";
    const name = err instanceof Error ? err.name : "";

    if (name === "NoSuchKey" || name === "NotFound" || msg.includes("NoSuchKey") || msg.includes("404")) {
      throw new PipelineError(
        `Source file not found in S3 storage (key: ${storageKey.slice(0, 60)}).`,
        "OBJECT_NOT_FOUND",
        true,
      );
    }

    if (
      msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") || msg.includes("socket hang up") ||
      msg.includes("network") || msg.includes("timeout")
    ) {
      throw new PipelineError(
        `S3 storage fetch failed (transient network error): ${msg}`,
        "FETCH_FAILED_TRANSIENT",
        false,
      );
    }

    throw new PipelineError(`Failed to fetch S3 source file: ${msg}`, "FETCH_FAILED", false);
  }
}

/**
 * Fetch a document buffer from Replit Object Storage using the sidecar-authenticated
 * GCS client. Parses PRIVATE_OBJECT_DIR (format: /{bucketId}/{prefix}) to construct
 * the correct bucket name and object path.
 */
async function fetchFromReplitObjectStorage(storageKey: string): Promise<Buffer> {
  const privateDir = process.env.PRIVATE_OBJECT_DIR;
  if (!privateDir) {
    throw new PipelineError(
      "PRIVATE_OBJECT_DIR not configured — cannot fetch source file.",
      "STORAGE_NOT_CONFIGURED",
      true,
    );
  }

  // PRIVATE_OBJECT_DIR format: /{bucketId}/{prefix}  e.g. /replit-objstore-xxx/.private
  // Strip leading slash, split: parts[0] = bucketId, parts[1..] = prefix segments.
  const parts = privateDir.replace(/^\//, "").split("/").filter(Boolean);
  if (parts.length < 1 || !parts[0]) {
    throw new PipelineError(
      "PRIVATE_OBJECT_DIR has unexpected format — cannot parse bucket ID.",
      "STORAGE_MISCONFIGURED",
      true,
    );
  }

  const bucketId   = parts[0];
  const prefix     = parts.slice(1).join("/"); // e.g. ".private"
  const objectName = prefix ? `${prefix}/${storageKey}` : storageKey;

  try {
    // Use the sidecar-authenticated client — the only client that works in Replit.
    const { objectStorageClient } = await import("../lib/objectStorage.js");
    const bucket = objectStorageClient.bucket(bucketId);

    // Wrap the download with a hard 30-second timeout so that GCS auth failures
    // or transient network stalls fail fast with a retryable error rather than
    // occupying the job lease for the full 120s until recoverStuck() fires.
    const downloadWithTimeout = new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("GCS download timeout after 30s (STORAGE_TIMEOUT)")),
        30_000,
      );
      bucket.file(objectName).download()
        .then(([buf]) => { clearTimeout(timer); resolve(buf as Buffer); })
        .catch((e)  => { clearTimeout(timer); reject(e); });
    });

    return await downloadWithTimeout;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : "Unknown error";

    if (msg.includes("No such object") || msg.includes("404") || msg.includes("Not Found")) {
      throw new PipelineError(
        `Source file not found in storage (key: ${storageKey.slice(0, 60)}).`,
        "OBJECT_NOT_FOUND",
        true,
      );
    }
    if (
      msg.includes("ECONNREFUSED") || msg.includes("ECONNRESET") ||
      msg.includes("ETIMEDOUT") || msg.includes("socket hang up") ||
      msg.includes("network") || msg.includes("timeout")
    ) {
      throw new PipelineError(
        `Storage fetch failed (transient network error): ${msg}`,
        "FETCH_FAILED_TRANSIENT",
        false, // retryable
      );
    }
    throw new PipelineError(
      `Failed to fetch source file: ${msg}`,
      "FETCH_FAILED",
      false,
    );
  }
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;

  if (typeof body === "object" && body !== null && "transformToByteArray" in body) {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function updateVersionIngestionStatus(
  sourceVersionId: string,
  organizationId:  string,
  ingestionStatus: string,
): Promise<void> {
  await withIngestionPipelineTenant(
    organizationId,
    "ingestion_pipeline.update_version_ingestion_status",
    (client) => client
      .update(knowledgeSourceVersionsTable)
      .set({ ingestionStatus, updatedAt: new Date() })
      .where(
        and(
          eq(knowledgeSourceVersionsTable.id,             sourceVersionId),
          eq(knowledgeSourceVersionsTable.organizationId, organizationId),
        ),
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
