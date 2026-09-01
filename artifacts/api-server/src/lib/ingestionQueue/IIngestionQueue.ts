/**
 * Provider-neutral queue interface for the Knowledge Hub ingestion pipeline.
 *
 * Current implementation: DatabaseIngestionQueue (Replit / local dev).
 * Future implementation:  SqsIngestionQueue (AWS production).
 *
 * Switch provider via KNOWLEDGE_QUEUE_PROVIDER env var:
 *   KNOWLEDGE_QUEUE_PROVIDER=database   (default)
 *   KNOWLEDGE_QUEUE_PROVIDER=sqs        (requires AWS credentials)
 */

import type { IngestionJob } from "@workspace/db";

export interface ClaimedJob {
  job:      IngestionJob;
  workerId: string;
  leaseMs:  number;
}

export interface QueueHealth {
  provider:         string;
  queued:           number;
  processing:       number;
  failed:           number;
  deadLettered:     number;
  completedTotal:   number;
  stuck:            number;
  oldestQueuedAt:   Date | null;
  oldestQueuedAgeSeconds: number | null;
  queuedZeroAttempt: number;
  lastClaimedAt:    Date | null;
}

export interface IIngestionQueue {
  /** Enqueue a job. Idempotent: returns existing active job if one exists. */
  enqueue(input: {
    organizationId:    string;
    knowledgeSourceId: string;
    sourceVersionId:   string;
    actorUserId:       string;
    maxAttempts?:      number;
  }): Promise<IngestionJob>;

  /** Atomically claim the next available job. Returns null if queue is empty. */
  claimNext(workerId: string): Promise<IngestionJob | null>;

  /** Extend the lease and record a liveness heartbeat. */
  heartbeat(jobId: string, workerId: string): Promise<void>;

  /** Mark job complete (moves to review_required). */
  complete(input: {
    id:                      string;
    organizationId:          string;
    chunkCount:              number;
    embeddingCount:          number;
    extractionProvider:      string;
    extractionProviderVersion: string;
    embeddingProvider:       string;
    embeddingModel:          string;
    embeddingDimensions:     number;
    chunkingStrategy:        string;
    chunkingStrategyVersion: string;
    promptInjectionFlags:    unknown[];
    requiresHumanReview:     boolean;
    metadata?:               Record<string, unknown>;
  }): Promise<IngestionJob>;

  /** Mark job failed. Applies exponential backoff; dead-letters if max attempts exceeded. */
  fail(
    jobId:           string,
    organizationId:  string,
    errorCode:       string,
    safeErrorMessage: string,
    nonRetryable?:   boolean,
  ): Promise<IngestionJob>;

  /** Request cancellation. Queued jobs → cancelled immediately; active jobs → cancelling. */
  cancel(jobId: string, organizationId: string, actorUserId: string): Promise<IngestionJob>;

  /** Finalize in-flight cancellation (called by worker after cleanup). */
  finaliseCancellation(jobId: string, organizationId: string): Promise<void>;

  /** Sweep abandoned (expired-lease) jobs back to queued or dead-letter them. */
  recoverStuck(): Promise<number>;

  /** Return queue health metrics (no tenant-scoped document content). */
  health(): Promise<QueueHealth>;
}
