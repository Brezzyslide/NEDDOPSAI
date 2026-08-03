/**
 * Knowledge Hub — Ingestion API (internal module name)
 * Customer-facing: "Processing", "Add knowledge", "Organisation Library sources"
 *
 * Routes that power the document ingestion pipeline for the Organisation Library.
 * All write routes enforce: authentication, tenant authorisation, role checks,
 * validation, audit logging, idempotency, and safe error responses.
 *
 * Routes:
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/ingest
 *   GET    /v1/organisations/:slug/knowledge/ingestion/:jobId
 *   GET    /v1/organisations/:slug/knowledge/ingestion
 *   POST   /v1/organisations/:slug/knowledge/ingestion/:jobId/cancel
 *   POST   /v1/organisations/:slug/knowledge/ingestion/:jobId/retry
 *   GET    /v1/organisations/:slug/knowledge/sources/:sourceId/chunks
 *   GET    /v1/organisations/:slug/knowledge/sources/:sourceId/warnings
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/approve-ingestion
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/reject-ingestion
 *   POST   /v1/organisations/:slug/knowledge/sources/:sourceId/re-embed
 *
 * Never expose: storage keys, raw object URLs, raw chunk text in error messages,
 * participant data, RAG/embedding/vector/chunk terminology to end users.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth, resolveTenantFromSlug } from "../../middlewares/tenantContext.js";
import { ApiError }           from "../../lib/errors.js";

/** Inline role gate — replaces the missing requireRole middleware. */
function requireOwnerOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.tenantContext?.role;
  if (role !== "owner" && role !== "admin") {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Owner or admin role required." } });
    return;
  }
  next();
}
import {
  enqueueIngestionJob,
  getIngestionJob,
  listIngestionJobs,
  cancelIngestionJob,
  enqueueIngestionJob as retryIngestionJob,
  type EnqueueIngestionJobInput,
} from "../../services/ingestionJobService.js";
import {
  getKnowledgeSource,
  getCurrentVersion,
} from "../../services/knowledgeSourceService.js";
import { db } from "@workspace/db";
import { knowledgeChunksTable, knowledgeSourcesTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { logOrgEvent } from "../../services/auditService.js";

const router = Router({ mergeParams: true });

// ─── Trigger ingestion ────────────────────────────────────────────────────────

/**
 * POST /v1/organisations/:slug/knowledge/sources/:sourceId/ingest
 *
 * Enqueue an ingestion job for the current version of a source.
 * Idempotent: returns the existing active job if one is already running.
 * Requires: owner or admin (prevents accidental re-ingestion by members).
 */
router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/ingest",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { slug, sourceId } = req.params;
      const orgId = req.tenantContext!.tenantId;
      const userId = req.appUser!.id;

      const source = await getKnowledgeSource(sourceId, orgId);
      if (!source) throw new ApiError("KNOWLEDGE_SOURCE_NOT_FOUND", "Knowledge source not found.", 404);
      if (source.deletedAt) throw new ApiError("DELETED", "Source has been deleted.", 410);
      if (source.status === "revoked") throw new ApiError("REVOKED", "Source is revoked.", 409);

      const version = await getCurrentVersion(sourceId, orgId);
      if (!version) throw new ApiError("NO_VERSION", "Source has no current version.", 409);
      if (version.ingestionStatus === "complete") {
        return res.status(200).json({
          message: "Source is already processed. Use re-embed or reprocess to trigger again.",
          alreadyComplete: true,
        });
      }

      const job = await enqueueIngestionJob({
        organizationId: orgId,
        knowledgeSourceId: sourceId,
        sourceVersionId: version.id,
        actorUserId: userId,
      } as EnqueueIngestionJobInput);

      logOrgEvent({
        eventType: "knowledge_hub.ingestion_triggered",
        organizationId: orgId,
        resourceType: "knowledge_source",
        resourceId: sourceId,
        actorUserId: userId,
        metadata: { jobId: job.id, versionId: version.id },
      }).catch(() => {});

      res.status(202).json({ jobId: job.id, status: job.status });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Get job status ───────────────────────────────────────────────────────────

/**
 * GET /v1/organisations/:slug/knowledge/ingestion/:jobId
 *
 * Retrieve a specific ingestion job and its current status.
 */
router.get(
  "/organisations/:slug/knowledge/ingestion/:jobId",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const orgId = req.tenantContext!.tenantId;

      const job = await getIngestionJob(jobId, orgId);
      if (!job) throw new ApiError("JOB_NOT_FOUND", "Ingestion job not found.", 404);

      res.json(safeJob(job));
    } catch (err) {
      next(err);
    }
  },
);

// ─── List jobs for a source ───────────────────────────────────────────────────

/**
 * GET /v1/organisations/:slug/knowledge/ingestion?sourceId=...&status=...
 */
router.get(
  "/organisations/:slug/knowledge/ingestion",
  requireAuth,
  resolveTenantFromSlug,
  async (req, res, next) => {
    try {
      const orgId = req.tenantContext!.tenantId;
      const { sourceId, status, limit, offset } = req.query as Record<string, string>;

      const jobs = await listIngestionJobs(orgId, {
        knowledgeSourceId: sourceId,
        status: status as any,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      });

      res.json({ jobs: jobs.map(safeJob) });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Cancel job ───────────────────────────────────────────────────────────────

/**
 * POST /v1/organisations/:slug/knowledge/ingestion/:jobId/cancel
 * Requires owner or admin.
 */
router.post(
  "/organisations/:slug/knowledge/ingestion/:jobId/cancel",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const orgId   = req.tenantContext!.tenantId;
      const userId  = req.appUser!.id;

      const job = await cancelIngestionJob(jobId, orgId, userId);
      res.json({ jobId: job.id, status: job.status });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Retry job ────────────────────────────────────────────────────────────────

/**
 * POST /v1/organisations/:slug/knowledge/ingestion/:jobId/retry
 * Re-queues a failed job. Requires owner or admin.
 */
router.post(
  "/organisations/:slug/knowledge/ingestion/:jobId/retry",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const orgId   = req.tenantContext!.tenantId;
      const userId  = req.appUser!.id;

      const existingJob = await getIngestionJob(jobId, orgId);
      if (!existingJob) throw new ApiError("JOB_NOT_FOUND", "Ingestion job not found.", 404);
      if (existingJob.status !== "failed") {
        throw new ApiError("INVALID_STATUS", "Only failed jobs can be retried.", 409);
      }

      // Re-queue by creating a new job for the same version
      const newJob = await retryIngestionJob({
        organizationId: orgId,
        knowledgeSourceId: existingJob.knowledgeSourceId,
        sourceVersionId: existingJob.sourceVersionId,
        actorUserId: userId,
      } as EnqueueIngestionJobInput);

      res.status(202).json({ jobId: newJob.id, status: newJob.status });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Preview chunks ───────────────────────────────────────────────────────────

/**
 * GET /v1/organisations/:slug/knowledge/sources/:sourceId/chunks
 *
 * Preview extracted chunks for a source (owner/admin only).
 * Returns text, section, page, index — never raw embedding vectors.
 */
router.get(
  "/organisations/:slug/knowledge/sources/:sourceId/chunks",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { sourceId } = req.params;
      const orgId = req.tenantContext!.tenantId;
      const limit  = Math.min(parseInt((req.query.limit as string) ?? "20", 10), 100);
      const offset = parseInt((req.query.offset as string) ?? "0", 10);

      const source = await getKnowledgeSource(sourceId, orgId);
      if (!source) throw new ApiError("KNOWLEDGE_SOURCE_NOT_FOUND", "Source not found.", 404);

      const chunks = await db
        .select({
          id:             knowledgeChunksTable.id,
          chunkIndex:     knowledgeChunksTable.chunkIndex,
          sectionTitle:   knowledgeChunksTable.sectionTitle,
          headingPath:    knowledgeChunksTable.headingPath,
          pageNumber:     knowledgeChunksTable.pageNumber,
          text:           knowledgeChunksTable.text,
          tokenCount:     knowledgeChunksTable.tokenCount,
          contentHash:    knowledgeChunksTable.contentHash,
          chunkingStrategy: knowledgeChunksTable.chunkingStrategy,
          hasEmbedding:   knowledgeChunksTable.embeddingModel,
        })
        .from(knowledgeChunksTable)
        .where(
          and(
            eq(knowledgeChunksTable.knowledgeSourceId, sourceId),
            eq(knowledgeChunksTable.organizationId, orgId),
            isNull(knowledgeChunksTable.deletedAt),
          ),
        )
        .orderBy(knowledgeChunksTable.chunkIndex)
        .limit(limit)
        .offset(offset);

      res.json({ chunks, total: chunks.length });
    } catch (err) {
      next(err);
    }
  },
);

// ─── List warnings ────────────────────────────────────────────────────────────

/**
 * GET /v1/organisations/:slug/knowledge/sources/:sourceId/warnings
 *
 * Return injection flags and pipeline warnings for the latest ingestion job.
 */
router.get(
  "/organisations/:slug/knowledge/sources/:sourceId/warnings",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { sourceId } = req.params;
      const orgId = req.tenantContext!.tenantId;

      const source = await getKnowledgeSource(sourceId, orgId);
      if (!source) throw new ApiError("KNOWLEDGE_SOURCE_NOT_FOUND", "Source not found.", 404);

      const jobs = await listIngestionJobs(orgId, { knowledgeSourceId: sourceId, limit: 1 });
      const job = jobs[0];

      res.json({
        sourceId,
        jobId: job?.id ?? null,
        status: job?.status ?? null,
        requiresHumanReview: job?.requiresHumanReview ?? false,
        promptInjectionFlags: job?.promptInjectionFlags ?? [],
        pipelineWarnings: (job?.metadata as any)?.warnings ?? [],
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Approve ingestion (review_required → approved) ──────────────────────────

/**
 * POST /v1/organisations/:slug/knowledge/sources/:sourceId/approve-ingestion
 *
 * Approve the processed source after human review.
 * - Marks the ingestion job as "approved"
 * - Marks the knowledge source as "approved"
 * - Chunks become retrievable in Task #17
 *
 * Flagged sources (requiresHumanReview=true) may still be approved after review.
 * Requires owner or admin.
 */
router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/approve-ingestion",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { sourceId } = req.params;
      const orgId   = req.tenantContext!.tenantId;
      const userId  = req.appUser!.id;

      const source = await getKnowledgeSource(sourceId, orgId);
      if (!source) throw new ApiError("KNOWLEDGE_SOURCE_NOT_FOUND", "Source not found.", 404);

      if (source.status !== "review_required" && source.status !== "processing") {
        throw new ApiError(
          "INVALID_STATUS",
          `Source must be in review_required status to approve ingestion. Current: ${source.status}`,
          409,
        );
      }

      // Find the review_required job
      const jobs = await listIngestionJobs(orgId, {
        knowledgeSourceId: sourceId,
        status: "review_required",
        limit: 1,
      });
      const job = jobs[0];

      if (job) {
        const { transitionIngestionJobStatus } = await import("../../services/ingestionJobService.js");
        await transitionIngestionJobStatus(job.id, orgId, "approved");
      }

      // Approve the source
      await db
        .update(knowledgeSourcesTable)
        .set({
          status: "approved",
          approvedByUserId: userId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(knowledgeSourcesTable.id, sourceId),
            eq(knowledgeSourcesTable.organizationId, orgId),
          ),
        );

      logOrgEvent({
        eventType: "knowledge_hub.ingestion_approved",
        organizationId: orgId,
        resourceType: "knowledge_source",
        resourceId: sourceId,
        actorUserId: userId,
        metadata: { jobId: job?.id },
      }).catch(() => {});

      res.json({ sourceId, status: "approved", jobId: job?.id ?? null });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Reject ingestion ─────────────────────────────────────────────────────────

/**
 * POST /v1/organisations/:slug/knowledge/sources/:sourceId/reject-ingestion
 *
 * Reject the processed source (e.g. injection flags detected, wrong document).
 * Returns source to "uploaded" status; chunks are soft-deleted.
 * Requires owner or admin.
 */
router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/reject-ingestion",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { sourceId } = req.params;
      const orgId   = req.tenantContext!.tenantId;
      const userId  = req.appUser!.id;
      const { reason } = req.body as { reason?: string };

      const source = await getKnowledgeSource(sourceId, orgId);
      if (!source) throw new ApiError("KNOWLEDGE_SOURCE_NOT_FOUND", "Source not found.", 404);

      // Soft-delete chunks
      await db
        .update(knowledgeChunksTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(knowledgeChunksTable.knowledgeSourceId, sourceId),
            eq(knowledgeChunksTable.organizationId, orgId),
            isNull(knowledgeChunksTable.deletedAt),
          ),
        );

      // Reset source to uploaded
      await db
        .update(knowledgeSourcesTable)
        .set({ status: "uploaded", updatedAt: new Date() })
        .where(
          and(
            eq(knowledgeSourcesTable.id, sourceId),
            eq(knowledgeSourcesTable.organizationId, orgId),
          ),
        );

      logOrgEvent({
        eventType: "knowledge_hub.ingestion_rejected",
        organizationId: orgId,
        resourceType: "knowledge_source",
        resourceId: sourceId,
        actorUserId: userId,
        isSensitive: false,
        metadata: { reason: reason?.slice(0, 200) },
      }).catch(() => {});

      res.json({ sourceId, status: "uploaded" });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Request re-embedding ─────────────────────────────────────────────────────

/**
 * POST /v1/organisations/:slug/knowledge/sources/:sourceId/re-embed
 *
 * Re-trigger the embedding stage only (e.g. after embedding provider changes).
 * Soft-deletes existing embeddings and re-queues the source for ingestion.
 * Requires owner or admin.
 */
router.post(
  "/organisations/:slug/knowledge/sources/:sourceId/re-embed",
  requireAuth,
  resolveTenantFromSlug,
  requireOwnerOrAdmin,
  async (req, res, next) => {
    try {
      const { sourceId } = req.params;
      const orgId  = req.tenantContext!.tenantId;
      const userId = req.appUser!.id;

      const source = await getKnowledgeSource(sourceId, orgId);
      if (!source) throw new ApiError("KNOWLEDGE_SOURCE_NOT_FOUND", "Source not found.", 404);
      if (source.deletedAt) throw new ApiError("DELETED", "Source deleted.", 410);
      if (source.status === "revoked") throw new ApiError("REVOKED", "Source revoked.", 409);

      const version = await getCurrentVersion(sourceId, orgId);
      if (!version) throw new ApiError("NO_VERSION", "No current version.", 409);

      const job = await enqueueIngestionJob({
        organizationId: orgId,
        knowledgeSourceId: sourceId,
        sourceVersionId: version.id,
        actorUserId: userId,
      } as EnqueueIngestionJobInput);

      res.status(202).json({ jobId: job.id, status: job.status });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Safe job serialiser (never expose storage keys) ─────────────────────────

function safeJob(job: Record<string, unknown>) {
  return {
    id:                    job.id,
    organizationId:        job.organizationId,
    knowledgeSourceId:     job.knowledgeSourceId,
    sourceVersionId:       job.sourceVersionId,
    status:                job.status,
    attemptCount:          job.attemptCount,
    maxAttempts:           job.maxAttempts,
    lastErrorCode:         job.lastErrorCode,
    lastErrorMessage:      job.lastErrorMessage,
    extractionProvider:    job.extractionProvider,
    extractionProviderVersion: job.extractionProviderVersion,
    embeddingProvider:     job.embeddingProvider,
    embeddingModel:        job.embeddingModel,
    embeddingDimensions:   job.embeddingDimensions,
    chunkingStrategy:      job.chunkingStrategy,
    chunkingStrategyVersion: job.chunkingStrategyVersion,
    chunkCount:            job.chunkCount,
    embeddingCount:        job.embeddingCount,
    requiresHumanReview:   job.requiresHumanReview,
    promptInjectionFlags:  job.promptInjectionFlags,
    startedAt:             job.startedAt,
    completedAt:           job.completedAt,
    cancelledAt:           job.cancelledAt,
    lastAttemptAt:         job.lastAttemptAt,
    createdAt:             job.createdAt,
    updatedAt:             job.updatedAt,
    // Never expose: claimedBy, claimedAt, metadata (may contain internal paths)
  };
}

export default router;
