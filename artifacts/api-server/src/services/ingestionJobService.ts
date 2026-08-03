/**
 * Knowledge Hub — Ingestion Job Service
 *
 * Database-backed job queue for the document ingestion pipeline.
 * Mirrors the DB-first queue pattern used by specialistQueueService.
 *
 * Each ingestion job represents one processing attempt for a knowledge
 * source version. The partial unique index on source_version_id prevents
 * duplicate active jobs for the same version (enforced in DB).
 *
 * For AWS readiness, this same interface maps to SQS + worker ECS tasks:
 *   - enqueueIngestionJob → SQS.sendMessage
 *   - claimNextIngestionJob → SQS.receiveMessage + visibility timeout
 *   - heartbeatIngestionJob → SQS.changeMessageVisibility
 *   - completeIngestionJob → SQS.deleteMessage
 *   - failIngestionJob → SQS.changeMessageVisibility(0) to make visible again
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  ingestionJobsTable,
  INGESTION_JOB_STATUSES,
  INGESTION_JOB_TRANSITIONS,
  type IngestionJob,
  type IngestionJobStatus,
} from "@workspace/db";
import { eq, and, inArray, sql, lte } from "drizzle-orm";
import { logOrgEvent } from "./auditService.js";

// ─── Errors ───────────────────────────────────────────────────────────────────

export class IngestionJobError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "IngestionJobError";
    this.code = code;
    Object.setPrototypeOf(this, IngestionJobError.prototype);
  }
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

export interface EnqueueIngestionJobInput {
  organizationId: string;
  knowledgeSourceId: string;
  sourceVersionId: string;
  actorUserId: string;
  maxAttempts?: number;
}

/**
 * Create a new ingestion job in the "queued" state.
 * Idempotent: if an active job already exists for this version, returns it.
 */
export async function enqueueIngestionJob(
  input: EnqueueIngestionJobInput,
): Promise<IngestionJob> {
  // Check for existing active job
  const existing = await getActiveJobForVersion(
    input.sourceVersionId,
    input.organizationId,
  );
  if (existing) return existing;

  const id = randomUUID();
  const rows = await db
    .insert(ingestionJobsTable)
    .values({
      id,
      organizationId: input.organizationId,
      knowledgeSourceId: input.knowledgeSourceId,
      sourceVersionId: input.sourceVersionId,
      status: "queued",
      maxAttempts: input.maxAttempts ?? 3,
      metadata: {},
      promptInjectionFlags: [],
    })
    .returning();

  const job = rows[0];
  if (!job) throw new IngestionJobError("Failed to create ingestion job.", "CREATE_FAILED");

  logOrgEvent({
    eventType: "ingestion_job.queued",
    organizationId: input.organizationId,
    resourceType: "ingestion_job",
    resourceId: id,
    actorUserId: input.actorUserId,
  }).catch(() => {});

  return job;
}

// ─── Claim ────────────────────────────────────────────────────────────────────

/**
 * Atomically claim the next queued ingestion job for a worker.
 * Uses a PostgreSQL UPDATE ... WHERE id = (SELECT id ... FOR UPDATE SKIP LOCKED)
 * pattern to prevent race conditions between workers.
 *
 * @param workerId  Unique identifier for the claiming worker instance
 * @returns The claimed job, or null if no work is available
 */
export async function claimNextIngestionJob(
  workerId: string,
): Promise<IngestionJob | null> {
  const rows = await db.execute<IngestionJob>(sql`
    UPDATE ingestion_jobs
    SET
      status           = 'fetching',
      claimed_by       = ${workerId},
      claimed_at       = NOW(),
      last_attempt_at  = NOW(),
      attempt_count    = attempt_count + 1,
      started_at       = COALESCE(started_at, NOW()),
      updated_at       = NOW()
    WHERE id = (
      SELECT id
      FROM   ingestion_jobs
      WHERE  status = 'queued'
         OR  (status = 'failed' AND attempt_count < max_attempts)
      ORDER  BY created_at ASC
      LIMIT  1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const row = (rows.rows ?? rows as unknown as IngestionJob[])[0];
  return row ?? null;
}

// ─── Status transitions ───────────────────────────────────────────────────────

/**
 * Transition a job to the next pipeline stage.
 * Validates the transition against INGESTION_JOB_TRANSITIONS.
 */
export async function transitionIngestionJobStatus(
  id: string,
  organizationId: string,
  newStatus: IngestionJobStatus,
  updates: Partial<{
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    chunkCount: number;
    embeddingCount: number;
    extractionProvider: string;
    extractionProviderVersion: string;
    embeddingProvider: string;
    embeddingModel: string;
    embeddingDimensions: number;
    chunkingStrategy: string;
    chunkingStrategyVersion: string;
    promptInjectionFlags: unknown[];
    requiresHumanReview: boolean;
    metadata: Record<string, unknown>;
  }> = {},
): Promise<IngestionJob> {
  const job = await getIngestionJob(id, organizationId);
  if (!job) throw new IngestionJobError("Ingestion job not found.", "NOT_FOUND");

  const current = job.status as IngestionJobStatus;
  const allowed = INGESTION_JOB_TRANSITIONS[current] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new IngestionJobError(
      `Cannot transition ingestion job from "${current}" to "${newStatus}". ` +
        `Allowed from "${current}": ${allowed.join(", ")}`,
      "INVALID_TRANSITION",
    );
  }

  const now = new Date();
  const timestampUpdates: Record<string, unknown> = {};
  if (newStatus === "approved") timestampUpdates.completedAt = now;
  if (newStatus === "cancelled") timestampUpdates.cancelledAt = now;

  const rows = await db
    .update(ingestionJobsTable)
    .set({
      status: newStatus,
      updatedAt: now,
      ...timestampUpdates,
      ...updates,
    } as Partial<typeof ingestionJobsTable.$inferInsert>)
    .where(
      and(
        eq(ingestionJobsTable.id, id),
        eq(ingestionJobsTable.organizationId, organizationId),
      ),
    )
    .returning();

  const updated = rows[0];
  if (!updated) throw new IngestionJobError("Update failed.", "UPDATE_FAILED");
  return updated;
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────

/**
 * Update lastAttemptAt to keep the job alive during long processing.
 * AWS equivalent: SQS.changeMessageVisibility
 */
export async function heartbeatIngestionJob(id: string): Promise<void> {
  await db
    .update(ingestionJobsTable)
    .set({ lastAttemptAt: new Date(), updatedAt: new Date() })
    .where(eq(ingestionJobsTable.id, id));
}

// ─── Complete ─────────────────────────────────────────────────────────────────

export interface CompleteIngestionJobInput {
  id: string;
  organizationId: string;
  chunkCount: number;
  embeddingCount: number;
  extractionProvider: string;
  extractionProviderVersion: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number;
  chunkingStrategy: string;
  chunkingStrategyVersion: string;
  promptInjectionFlags: unknown[];
  requiresHumanReview: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Transition job to "review_required" (pipeline complete, awaiting approval).
 */
export async function completeIngestionJob(
  input: CompleteIngestionJobInput,
): Promise<IngestionJob> {
  const job = await getIngestionJob(input.id, input.organizationId);
  if (!job) throw new IngestionJobError("Ingestion job not found.", "NOT_FOUND");

  const rows = await db
    .update(ingestionJobsTable)
    .set({
      status: "review_required",
      chunkCount: input.chunkCount,
      embeddingCount: input.embeddingCount,
      extractionProvider: input.extractionProvider,
      extractionProviderVersion: input.extractionProviderVersion,
      embeddingProvider: input.embeddingProvider,
      embeddingModel: input.embeddingModel,
      embeddingDimensions: input.embeddingDimensions,
      chunkingStrategy: input.chunkingStrategy,
      chunkingStrategyVersion: input.chunkingStrategyVersion,
      promptInjectionFlags: input.promptInjectionFlags,
      requiresHumanReview: input.requiresHumanReview,
      metadata: input.metadata ?? {},
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ingestionJobsTable.id, input.id),
        eq(ingestionJobsTable.organizationId, input.organizationId),
      ),
    )
    .returning();

  const updated = rows[0];
  if (!updated) throw new IngestionJobError("Complete update failed.", "UPDATE_FAILED");
  return updated;
}

// ─── Fail ─────────────────────────────────────────────────────────────────────

/**
 * Mark job as failed. If maxAttempts not exceeded, it can be re-queued.
 * Never logs errorDetail (may contain sensitive content) — logs only the code.
 */
export async function failIngestionJob(
  id: string,
  organizationId: string,
  errorCode: string,
  safeErrorMessage: string, // must NOT contain document content
): Promise<IngestionJob> {
  const rows = await db
    .update(ingestionJobsTable)
    .set({
      status: "failed",
      lastErrorCode: errorCode.slice(0, 100),
      lastErrorMessage: safeErrorMessage.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ingestionJobsTable.id, id),
        eq(ingestionJobsTable.organizationId, organizationId),
      ),
    )
    .returning();

  const updated = rows[0];
  if (!updated) throw new IngestionJobError("Fail update failed.", "UPDATE_FAILED");
  return updated;
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export async function cancelIngestionJob(
  id: string,
  organizationId: string,
  actorUserId: string,
): Promise<IngestionJob> {
  const job = await getIngestionJob(id, organizationId);
  if (!job) throw new IngestionJobError("Ingestion job not found.", "NOT_FOUND");

  const current = job.status as IngestionJobStatus;
  if (!INGESTION_JOB_TRANSITIONS[current]?.includes("cancelled")) {
    throw new IngestionJobError(
      `Cannot cancel job in status "${current}".`,
      "CANNOT_CANCEL",
    );
  }

  const rows = await db
    .update(ingestionJobsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(ingestionJobsTable.id, id),
        eq(ingestionJobsTable.organizationId, organizationId),
      ),
    )
    .returning();

  const updated = rows[0];
  if (!updated) throw new IngestionJobError("Cancel update failed.", "UPDATE_FAILED");

  logOrgEvent({
    eventType: "ingestion_job.cancelled",
    organizationId,
    resourceType: "ingestion_job",
    resourceId: id,
    actorUserId,
  }).catch(() => {});

  return updated;
}

// ─── Revoke ───────────────────────────────────────────────────────────────────

/**
 * Mark job as revoked when the source is revoked mid-processing.
 * Callable from any active (non-terminal) status.
 */
export async function revokeIngestionJob(
  id: string,
  organizationId: string,
): Promise<void> {
  await db
    .update(ingestionJobsTable)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(ingestionJobsTable.id, id),
        eq(ingestionJobsTable.organizationId, organizationId),
      ),
    );
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getIngestionJob(
  id: string,
  organizationId: string,
): Promise<IngestionJob | null> {
  const rows = await db
    .select()
    .from(ingestionJobsTable)
    .where(
      and(
        eq(ingestionJobsTable.id, id),
        eq(ingestionJobsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveJobForVersion(
  sourceVersionId: string,
  organizationId: string,
): Promise<IngestionJob | null> {
  const terminalStatuses = ["approved", "cancelled"];
  const rows = await db
    .select()
    .from(ingestionJobsTable)
    .where(
      and(
        eq(ingestionJobsTable.sourceVersionId, sourceVersionId),
        eq(ingestionJobsTable.organizationId, organizationId),
        sql`${ingestionJobsTable.status} NOT IN ('approved', 'cancelled')`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listIngestionJobs(
  organizationId: string,
  opts: {
    knowledgeSourceId?: string;
    status?: IngestionJobStatus;
    limit?: number;
    offset?: number;
  } = {},
): Promise<IngestionJob[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const conditions = [eq(ingestionJobsTable.organizationId, organizationId)];
  if (opts.knowledgeSourceId) {
    conditions.push(eq(ingestionJobsTable.knowledgeSourceId, opts.knowledgeSourceId));
  }
  if (opts.status) {
    conditions.push(eq(ingestionJobsTable.status, opts.status));
  }

  return db
    .select()
    .from(ingestionJobsTable)
    .where(and(...conditions))
    .orderBy(ingestionJobsTable.createdAt)
    .limit(limit)
    .offset(offset);
}
