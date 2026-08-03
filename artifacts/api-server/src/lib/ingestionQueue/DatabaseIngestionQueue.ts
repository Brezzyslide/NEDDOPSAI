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
 */

import { db } from "@workspace/db";
import {
  ingestionJobsTable,
  INGESTION_JOB_TRANSITIONS,
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
const BASE_BACKOFF_S        = 30;   // 30s → 60s → 120s → … → max 1800s (30 min)
const MAX_BACKOFF_S         = 1800;
const JITTER_MS             = 5_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    // Idempotency: return existing active job for this version
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

    logOrgEvent({
      eventType:      "ingestion_job.queued",
      organizationId: input.organizationId,
      resourceType:   "ingestion_job",
      resourceId:     id,
      actorUserId:    input.actorUserId,
    }).catch(() => {});

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

    const row = (rows.rows ?? rows as unknown as IngestionJob[])[0];
    return row ?? null;
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

    // Single atomic query: either dead_letter or set backoff
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

    const row = (rows.rows ?? rows as unknown as IngestionJob[])[0];
    if (!row) throw new Error("DatabaseIngestionQueue.fail: update returned no rows");

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
    // Queued jobs cancel immediately; in-flight jobs move to 'cancelling'
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

  async recoverStuck(): Promise<number> {
    const processingStatuses: IngestionJobStatus[] = [
      "fetching","extracting","normalising","chunking","embedding","cancelling",
    ];

    // Find expired-lease jobs
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

      await db.execute(sql`
        UPDATE ingestion_jobs
        SET
          status           = ${newStatus},
          claimed_by       = NULL,
          lease_expires_at = NULL,
          heartbeat_at     = NULL,
          recovery_count   = recovery_count + 1,
          dead_lettered_at = ${isExhausted ? sql`NOW()` : sql`NULL`},
          next_attempt_at  = ${!isExhausted ? sql`NOW() + '30 seconds'::interval` : sql`NULL`},
          updated_at       = NOW()
        WHERE id = ${job.id}
          AND lease_expires_at < NOW()
      `);

      logOrgEvent({
        eventType:      isExhausted ? "ingestion_job.dead_lettered" : "ingestion_job.recovered",
        organizationId: job.organizationId,
        resourceType:   "ingestion_job",
        resourceId:     job.id,
        metadata:       { reason: "lease_expired", previousStatus: job.status },
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

    const [oldestRow] = await db.execute<{ oldest: string | null }>(sql`
      SELECT MIN(created_at)::text AS oldest
      FROM   ingestion_jobs
      WHERE  status = 'queued'
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
      completedTotal: counts["review_required"] ?? 0 + (counts["approved"] ?? 0),
      stuck:          parseInt(stuckRow?.cnt ?? "0", 10),
      oldestQueuedAt: oldestRow?.oldest ? new Date(oldestRow.oldest) : null,
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
