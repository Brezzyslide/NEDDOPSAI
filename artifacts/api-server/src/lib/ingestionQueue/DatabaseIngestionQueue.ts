/**
 * Database-backed ingestion queue — Replit / local development provider.
 *
 * Uses the ingestion_jobs table with atomic UPDATE...WHERE...FOR UPDATE SKIP LOCKED
 * for concurrent-safe job claiming. Maps directly to IIngestionQueue.
 *
 * AWS SQS equivalent mappings (for future migration):
 *   enqueue        → SQS.sendMessage
 *   claimNext      → SQS.receiveMessage + visibility timeout
 *   heartbeat      → SQS.changeMessageVisibility
 *   complete       → SQS.deleteMessage
 *   fail           → SQS.changeMessageVisibility(0) or DLQ send
 *   recoverStuck   → handled by SQS visibility timeout expiry
 *
 * Sprint 28.6 fix: recoverStuck() now writes last_error_code='LEASE_EXPIRED' when
 * dead-lettering jobs due to lease expiry. Previously those fields were left NULL,
 * making it impossible to diagnose why a job had failed.
 */

import { db } from "@workspace/db";
import {
  ingestionJobsTable,
  INGESTION_NON_RETRYABLE_CODES,
  type IngestionJob,
  type IngestionJobStatus,
} from "@workspace/db";
import { eq, and, sql, lt, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { IIngestionQueue, QueueHealth } from "./IIngestionQueue.js";
import { logOrgEvent } from "../../services/auditService.js";

// ─── Config defaults ──────────────────────────────────────────────────────────

const DEFAULT_LEASE_MS      = parseInt(process.env.KNOWLEDGE_WORKER_LEASE_MS      ?? "120000", 10);
const BASE_BACKOFF_S        = 30;
const MAX_BACKOFF_S         = 1800;
const JITTER_MS             = 5_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sprint 28.6 fix: db.execute returns raw PostgreSQL snake_case column names.
 * The IngestionJob type uses camelCase (as Drizzle maps them). This normalizer
 * converts the raw row so callers can safely access job.organizationId etc.
 *
 * Without this, job.organizationId is undefined → runPipeline passes undefined
 * to getIngestionJob → no rows → JOB_NOT_FOUND on every claim attempt.
 */
function normalizeRawIngestionJob(raw: Record<string, unknown>): IngestionJob {
  const toDate = (v: unknown): Date | null =>
    v == null ? null : (v instanceof Date ? v : new Date(v as string));

  return {
    id:                         (raw.id as string),
    organizationId:             (raw.organization_id ?? raw.organizationId) as string,
    knowledgeSourceId:          (raw.knowledge_source_id ?? raw.knowledgeSourceId) as string,
    sourceVersionId:            (raw.source_version_id ?? raw.sourceVersionId) as string,
    status:                     (raw.status as IngestionJob["status"]),
    attemptCount:               (raw.attempt_count ?? raw.attemptCount ?? 0) as number,
    maxAttempts:                (raw.max_attempts ?? raw.maxAttempts ?? 3) as number,
    lastErrorCode:              (raw.last_error_code ?? raw.lastErrorCode ?? null) as string | null,
    lastErrorMessage:           (raw.last_error_message ?? raw.lastErrorMessage ?? null) as string | null,
    extractionProvider:         (raw.extraction_provider ?? raw.extractionProvider ?? null) as string | null,
    extractionProviderVersion:  (raw.extraction_provider_version ?? raw.extractionProviderVersion ?? null) as string | null,
    embeddingProvider:          (raw.embedding_provider ?? raw.embeddingProvider ?? null) as string | null,
    embeddingModel:             (raw.embedding_model ?? raw.embeddingModel ?? null) as string | null,
    embeddingDimensions:        (raw.embedding_dimensions ?? raw.embeddingDimensions ?? null) as number | null,
    chunkingStrategy:           (raw.chunking_strategy ?? raw.chunkingStrategy ?? null) as string | null,
    chunkingStrategyVersion:    (raw.chunking_strategy_version ?? raw.chunkingStrategyVersion ?? null) as string | null,
    chunkCount:                 (raw.chunk_count ?? raw.chunkCount ?? null) as number | null,
    embeddingCount:             (raw.embedding_count ?? raw.embeddingCount ?? null) as number | null,
    promptInjectionFlags:       (raw.prompt_injection_flags ?? raw.promptInjectionFlags ?? []) as unknown[],
    requiresHumanReview:        Boolean(raw.requires_human_review ?? raw.requiresHumanReview),
    claimedBy:                  (raw.claimed_by ?? raw.claimedBy ?? null) as string | null,
    claimedAt:                  toDate(raw.claimed_at ?? raw.claimedAt),
    leaseExpiresAt:             toDate(raw.lease_expires_at ?? raw.leaseExpiresAt),
    heartbeatAt:                toDate(raw.heartbeat_at ?? raw.heartbeatAt),
    nextAttemptAt:              toDate(raw.next_attempt_at ?? raw.nextAttemptAt),
    recoveryCount:              (raw.recovery_count ?? raw.recoveryCount ?? 0) as number,
    lastFailedAt:               toDate(raw.last_failed_at ?? raw.lastFailedAt),
    deadLetteredAt:             toDate(raw.dead_lettered_at ?? raw.deadLetteredAt),
    startedAt:                  toDate(raw.started_at ?? raw.startedAt),
    completedAt:                toDate(raw.completed_at ?? raw.completedAt),
    cancelledAt:                toDate(raw.cancelled_at ?? raw.cancelledAt),
    lastAttemptAt:              toDate(raw.last_attempt_at ?? raw.lastAttemptAt),
    createdAt:                  toDate(raw.created_at ?? raw.createdAt)!,
    updatedAt:                  toDate(raw.updated_at ?? raw.updatedAt)!,
    metadata:                   (raw.metadata ?? null) as Record<string, unknown> | null,
  } as IngestionJob;
}

function backoffSeconds(attemptCount: number): number {
  const base = BASE_BACKOFF_S * Math.pow(2, Math.max(0, attemptCount - 1));
  const capped = Math.min(base, MAX_BACKOFF_S);
  const jitter = Math.floor(Math.random() * JITTER_MS / 1000);
  return capped + jitter;
}

// ─── DatabaseIngestionQueue ───────────────────────────────────────────────────

export class DatabaseIngestionQueue implements IIngestionQueue {

  // ── enqueue ────────────────────────────────────────────────────────────────

  async enqueue(input: Parameters<IIngestionQueue["enqueue"]>[0]): Promise<IngestionJob> {
    const existing = await this._getActiveJobForVersion(
      input.sourceVersionId,
      input.organizationId,
    );
    if (existing) return existing;

    const id = randomUUID();
    const rows = await db
      .insert(ingestionJobsTable)
      .values({
        id,
        organizationId:    input.organizationId,
        knowledgeSourceId: input.knowledgeSourceId,
        sourceVersionId:   input.sourceVersionId,
        status:            "queued",
        maxAttempts:       input.maxAttempts ?? 3,
        metadata:          {},
        promptInjectionFlags: [],
      })
      .returning();

    const job = rows[0];
    if (!job) throw new Error("DatabaseIngestionQueue.enqueue: insert returned no rows");

    await logOrgEvent({
      eventType:      "ingestion_job.queued",
      organizationId: input.organizationId,
      resourceType:   "ingestion_job",
      resourceId:     id,
      actorUserId:    input.actorUserId,
    });

    return job;
  }

  // ── claimNext ──────────────────────────────────────────────────────────────

  async claimNext(workerId: string): Promise<IngestionJob | null> {
    const leaseMs = DEFAULT_LEASE_MS;
    const leaseInterval = `${Math.ceil(leaseMs / 1000)} seconds`;

    const rows = await db.execute<IngestionJob>(sql`
      UPDATE ingestion_jobs
      SET
        status            = 'fetching',
        claimed_by        = ${workerId},
        claimed_at        = NOW(),
        heartbeat_at      = NOW(),
        lease_expires_at  = NOW() + ${leaseInterval}::interval,
        last_attempt_at   = NOW(),
        attempt_count     = attempt_count + 1,
        started_at        = COALESCE(started_at, NOW()),
        next_attempt_at   = NULL,
        updated_at        = NOW()
      WHERE id = (
        SELECT id
        FROM   ingestion_jobs
        WHERE  status = 'queued'
           OR  (
               status = 'failed'
               AND attempt_count < max_attempts
               AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
           )
        ORDER BY created_at ASC
        LIMIT  1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);

    // Sprint 28.6 fix: db.execute returns snake_case keys; normalize to camelCase
    // so callers can safely access job.organizationId, job.knowledgeSourceId, etc.
    const rawRow = (rows.rows ?? rows as unknown as Record<string, unknown>[])[0];
    return rawRow ? normalizeRawIngestionJob(rawRow) : null;
  }

  // ── heartbeat ──────────────────────────────────────────────────────────────

  async heartbeat(jobId: string, workerId: string): Promise<void> {
    const leaseMs = DEFAULT_LEASE_MS;
    const leaseInterval = `${Math.ceil(leaseMs / 1000)} seconds`;

    await db.execute(sql`
      UPDATE ingestion_jobs
      SET
        heartbeat_at     = NOW(),
        lease_expires_at = NOW() + ${leaseInterval}::interval,
        last_attempt_at  = NOW(),
        updated_at       = NOW()
      WHERE id = ${jobId}
        AND claimed_by = ${workerId}
    `);
  }

  // ── complete ───────────────────────────────────────────────────────────────

  async complete(input: Parameters<IIngestionQueue["complete"]>[0]): Promise<IngestionJob> {
    const rows = await db
      .update(ingestionJobsTable)
      .set({
        status:                   "review_required",
        chunkCount:               input.chunkCount,
        embeddingCount:           input.embeddingCount,
        extractionProvider:       input.extractionProvider,
        extractionProviderVersion: input.extractionProviderVersion,
        embeddingProvider:        input.embeddingProvider,
        embeddingModel:           input.embeddingModel,
        embeddingDimensions:      input.embeddingDimensions,
        chunkingStrategy:         input.chunkingStrategy,
        chunkingStrategyVersion:  input.chunkingStrategyVersion,
        promptInjectionFlags:     input.promptInjectionFlags,
        requiresHumanReview:      input.requiresHumanReview,
        metadata:                 input.metadata ?? {},
        claimedBy:                null,
        leaseExpiresAt:           null,
        updatedAt:                new Date(),
      })
      .where(
        and(
          eq(ingestionJobsTable.id,             input.id),
          eq(ingestionJobsTable.organizationId, input.organizationId),
        ),
      )
      .returning();

    const row = rows[0];
    if (!row) throw new Error("DatabaseIngestionQueue.complete: update returned no rows");
    return row;
  }

  // ── fail ───────────────────────────────────────────────────────────────────

  async fail(
    jobId:            string,
    organizationId:   string,
    errorCode:        string,
    safeErrorMessage: string,
    nonRetryable      = false,
  ): Promise<IngestionJob> {
    const isNonRetryable = nonRetryable || INGESTION_NON_RETRYABLE_CODES.has(errorCode);

    const rows = await db.execute<IngestionJob>(sql`
      UPDATE ingestion_jobs
      SET
        status           = CASE
                             WHEN ${isNonRetryable} OR attempt_count >= max_attempts
                               THEN 'dead_lettered'
                             ELSE 'failed'
                           END,
        last_error_code    = LEFT(${errorCode}, 100),
        last_error_message = LEFT(${safeErrorMessage}, 500),
        last_failed_at     = NOW(),
        dead_lettered_at   = CASE
                               WHEN ${isNonRetryable} OR attempt_count >= max_attempts
                                 THEN NOW()
                               ELSE NULL
                             END,
        next_attempt_at    = CASE
                               WHEN ${isNonRetryable} OR attempt_count >= max_attempts
                                 THEN NULL
                               ELSE NOW() + (
                                 LEAST(
                                   ${BASE_BACKOFF_S} * POWER(2, GREATEST(attempt_count - 1, 0))::bigint,
                                   ${MAX_BACKOFF_S}
                                 )::text || ' seconds'
                               )::interval
                             END,
        claimed_by         = NULL,
        lease_expires_at   = NULL,
        updated_at         = NOW()
      WHERE id             = ${jobId}
        AND organization_id = ${organizationId}
      RETURNING *
    `);

    // Sprint 28.6 fix: db.execute returns snake_case keys; normalize to camelCase
    const rawRow2 = (rows.rows ?? rows as unknown as Record<string, unknown>[])[0];
    if (!rawRow2) throw new Error("DatabaseIngestionQueue.fail: update returned no rows");
    const row = normalizeRawIngestionJob(rawRow2);

    if ((row as any).status === "dead_lettered") {
      logOrgEvent({
        eventType:      "ingestion_job.dead_lettered",
        organizationId,
        resourceType:   "ingestion_job",
        resourceId:     jobId,
        metadata:       { errorCode: errorCode.slice(0, 100), nonRetryable: isNonRetryable },
      }).catch(() => {});
    }

    return row as IngestionJob;
  }

  // ── cancel ─────────────────────────────────────────────────────────────────

  async cancel(jobId: string, organizationId: string, actorUserId: string): Promise<IngestionJob> {
    const rows = await db.execute<IngestionJob>(sql`
      UPDATE ingestion_jobs
      SET
        status       = CASE
                         WHEN status = 'queued' THEN 'cancelled'
                         ELSE 'cancelling'
                       END,
        cancelled_at = CASE WHEN status = 'queued' THEN NOW() ELSE NULL END,
        updated_at   = NOW()
      WHERE id              = ${jobId}
        AND organization_id = ${organizationId}
        AND status NOT IN ('approved', 'cancelled', 'cancelling', 'revoked', 'dead_lettered')
      RETURNING *
    `);

    const row = (rows.rows ?? rows as unknown as IngestionJob[])[0];
    if (!row) throw new Error("Job not found or cannot be cancelled");

    logOrgEvent({
      eventType:      "ingestion_job.cancelled",
      organizationId,
      resourceType:   "ingestion_job",
      resourceId:     jobId,
      actorUserId,
    }).catch(() => {});

    return row as IngestionJob;
  }

  // ── finaliseCancellation ───────────────────────────────────────────────────

  async finaliseCancellation(jobId: string, organizationId: string): Promise<void> {
    await db
      .update(ingestionJobsTable)
      .set({
        status:          "cancelled",
        cancelledAt:     new Date(),
        claimedBy:       null,
        leaseExpiresAt:  null,
        updatedAt:       new Date(),
      })
      .where(
        and(
          eq(ingestionJobsTable.id,             jobId),
          eq(ingestionJobsTable.organizationId, organizationId),
          eq(ingestionJobsTable.status,         "cancelling"),
        ),
      );
  }

  // ── recoverStuck ───────────────────────────────────────────────────────────

  /**
   * Sprint 28.6: When dead-lettering via lease expiry, now writes
   * last_error_code = 'LEASE_EXPIRED' so the field is never left NULL.
   */
  async recoverStuck(): Promise<number> {
    const processingStatuses: IngestionJobStatus[] = [
      "fetching","extracting","normalising","chunking","embedding","cancelling",
    ];

    const stuck = await db
      .select({
        id:             ingestionJobsTable.id,
        organizationId: ingestionJobsTable.organizationId,
        attemptCount:   ingestionJobsTable.attemptCount,
        maxAttempts:    ingestionJobsTable.maxAttempts,
        status:         ingestionJobsTable.status,
        lastErrorCode:  ingestionJobsTable.lastErrorCode,
      })
      .from(ingestionJobsTable)
      .where(
        and(
          inArray(ingestionJobsTable.status, processingStatuses as string[] as any),
          lt(ingestionJobsTable.leaseExpiresAt, new Date()),
        ),
      )
      .limit(50);

    if (stuck.length === 0) return 0;

    let recovered = 0;
    for (const job of stuck) {
      const isExhausted = job.attemptCount >= job.maxAttempts;
      const newStatus   = isExhausted ? "dead_lettered" : "queued";

      // Sprint 28.6: write error info when dead-lettering so last_error_code is never NULL.
      // For retryable jobs keep any existing error code; we're just re-queuing.
      const leaseExpiredCode    = "LEASE_EXPIRED";
      const leaseExpiredMessage = `Job lease expired during stage '${job.status}' after ${job.attemptCount} attempt(s). Worker likely crashed or hung.`;

      await db.execute(sql`
        UPDATE ingestion_jobs
        SET
          status             = ${newStatus},
          claimed_by         = NULL,
          lease_expires_at   = NULL,
          heartbeat_at       = NULL,
          recovery_count     = recovery_count + 1,
          dead_lettered_at   = ${isExhausted ? sql`NOW()` : sql`NULL`},
          next_attempt_at    = ${!isExhausted ? sql`NOW() + '30 seconds'::interval` : sql`NULL`},
          -- Always write error info on dead-letter; keep existing code for retries
          last_error_code    = CASE
                                 WHEN ${isExhausted}
                                   THEN COALESCE(last_error_code, ${leaseExpiredCode})
                                 ELSE last_error_code
                               END,
          last_error_message = CASE
                                 WHEN ${isExhausted} AND last_error_message IS NULL
                                   THEN ${leaseExpiredMessage}
                                 ELSE last_error_message
                               END,
          last_failed_at     = CASE
                                 WHEN ${isExhausted} AND last_failed_at IS NULL
                                   THEN NOW()
                                 ELSE last_failed_at
                               END,
          metadata           = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({
            recoveredFromLease: true,
            stageAtRecovery: job.status,
          })}::jsonb,
          updated_at         = NOW()
        WHERE id = ${job.id}
          AND lease_expires_at < NOW()
      `);

      logOrgEvent({
        eventType:      isExhausted ? "ingestion_job.dead_lettered" : "ingestion_job.recovered",
        organizationId: job.organizationId,
        resourceType:   "ingestion_job",
        resourceId:     job.id,
        metadata:       {
          reason:         "lease_expired",
          previousStatus: job.status,
          errorCode:      isExhausted ? (job.lastErrorCode ?? leaseExpiredCode) : undefined,
        },
      }).catch(() => {});

      recovered++;
    }

    return recovered;
  }

  // ── health ─────────────────────────────────────────────────────────────────

  async health(): Promise<QueueHealth> {
    const rows = await db.execute<{ status: string; cnt: string }>(sql`
      SELECT status, COUNT(*)::int AS cnt
      FROM   ingestion_jobs
      GROUP  BY status
    `);

    const counts: Record<string, number> = {};
    for (const r of (rows.rows ?? rows as any)) {
      counts[r.status] = parseInt(r.cnt, 10);
    }

    const processingStatuses = ["fetching","extracting","normalising","chunking","embedding","cancelling"];
    const processing = processingStatuses.reduce((s, k) => s + (counts[k] ?? 0), 0);

    const [oldestRow] = await db.execute<{ oldest: string | null; age_seconds: string | null }>(sql`
      SELECT
        MIN(created_at)::text AS oldest,
        EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))::int::text AS age_seconds
      FROM   ingestion_jobs
      WHERE  status = 'queued'
    `).then(r => (r.rows ?? r as any));

    const [zeroAttemptRow] = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::int AS cnt
      FROM   ingestion_jobs
      WHERE  status = 'queued'
        AND  attempt_count = 0
    `).then(r => (r.rows ?? r as any));

    const [lastClaimRow] = await db.execute<{ last_claimed_at: string | null }>(sql`
      SELECT MAX(claimed_at)::text AS last_claimed_at
      FROM   ingestion_jobs
      WHERE  claimed_at IS NOT NULL
    `).then(r => (r.rows ?? r as any));

    const [stuckRow] = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*)::int AS cnt
      FROM   ingestion_jobs
      WHERE  status IN ('fetching','extracting','normalising','chunking','embedding','cancelling')
        AND  lease_expires_at < NOW()
    `).then(r => (r.rows ?? r as any));

    return {
      provider:       "database",
      queued:         counts["queued"]         ?? 0,
      processing,
      failed:         counts["failed"]          ?? 0,
      deadLettered:   counts["dead_lettered"]   ?? 0,
      completedTotal: (counts["review_required"] ?? 0) + (counts["approved"] ?? 0),
      stuck:          parseInt(stuckRow?.cnt ?? "0", 10),
      oldestQueuedAt: oldestRow?.oldest ? new Date(oldestRow.oldest) : null,
      oldestQueuedAgeSeconds: oldestRow?.age_seconds ? parseInt(oldestRow.age_seconds, 10) : null,
      queuedZeroAttempt: parseInt(zeroAttemptRow?.cnt ?? "0", 10),
      lastClaimedAt: lastClaimRow?.last_claimed_at ? new Date(lastClaimRow.last_claimed_at) : null,
    };
  }

  // ── private helpers ────────────────────────────────────────────────────────

  private async _getActiveJobForVersion(
    sourceVersionId: string,
    organizationId:  string,
  ): Promise<IngestionJob | null> {
    const rows = await db
      .select()
      .from(ingestionJobsTable)
      .where(
        and(
          eq(ingestionJobsTable.sourceVersionId, sourceVersionId),
          eq(ingestionJobsTable.organizationId,  organizationId),
          sql`${ingestionJobsTable.status} NOT IN (
            'approved','cancelled','revoked','dead_lettered'
          )`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
