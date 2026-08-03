/**
 * ingestion_jobs — Task #16 + Task #19 (Queue Worker)
 *
 * Knowledge Hub ingestion job queue.
 *
 * Pipeline stages:
 *   queued → fetching → extracting → normalising → chunking → embedding
 *   → review_required → approved
 *
 * Failure / terminal paths:
 *   → failed          (retryable; backoff via next_attempt_at)
 *   → dead_lettered   (exhausted max_attempts — requires admin retry)
 *   → cancelled       (actor-cancelled after cleanup)
 *   → cancelling      (cancel requested while job is in-flight; worker finalises)
 *   → revoked         (source revoked mid-processing)
 *
 * Idempotency: partial unique index on source_version_id prevents duplicate
 * active jobs for the same version (see Task #16 migration).
 *
 * Tenant isolation enforced by RLS on organization_id.
 */

import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations.js";
import { knowledgeSourcesTable } from "./knowledgeSources.js";
import { knowledgeSourceVersionsTable } from "./knowledgeSourceVersions.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const INGESTION_JOB_STATUSES = [
  "queued",
  "fetching",
  "extracting",
  "normalising",
  "chunking",
  "embedding",
  "review_required",
  "approved",
  "failed",
  "dead_lettered",
  "cancelling",
  "cancelled",
  "revoked",
] as const;

export type IngestionJobStatus = typeof INGESTION_JOB_STATUSES[number];

/** Terminal statuses — no further automatic processing */
export const INGESTION_TERMINAL_STATUSES: IngestionJobStatus[] = [
  "approved",
  "dead_lettered",
  "cancelled",
  "revoked",
];

/** Active (non-terminal, non-failed) statuses */
export const INGESTION_ACTIVE_STATUSES: IngestionJobStatus[] = INGESTION_JOB_STATUSES.filter(
  (s) => !INGESTION_TERMINAL_STATUSES.includes(s as IngestionJobStatus) && s !== "failed",
) as IngestionJobStatus[];

/**
 * Non-retryable error codes — job goes straight to dead_lettered.
 * Never retry these: the document itself is the problem.
 */
export const INGESTION_NON_RETRYABLE_CODES = new Set([
  "UNSUPPORTED_FILE_TYPE",
  "CORRUPTED_DOCUMENT",
  "ENCRYPTED_DOCUMENT",
  "MISSING_STORAGE_KEY",
  "INVALID_STORAGE_KEY",
  "SOURCE_REVOKED",
  "SOURCE_NOT_FOUND",
  "VERSION_NOT_FOUND",
  "NO_CHUNKS",
  "SENSITIVITY_BLOCKED",
]);

/**
 * Valid status transitions for the ingestion job state machine.
 */
export const INGESTION_JOB_TRANSITIONS: Record<IngestionJobStatus, IngestionJobStatus[]> = {
  queued:           ["fetching", "cancelled", "cancelling"],
  fetching:         ["extracting", "failed", "cancelling"],
  extracting:       ["normalising", "failed", "cancelling"],
  normalising:      ["chunking",   "failed", "cancelling"],
  chunking:         ["embedding",  "failed", "cancelling"],
  embedding:        ["review_required", "failed", "cancelling"],
  review_required:  ["approved", "failed"],
  approved:         [],
  failed:           ["queued", "dead_lettered"],
  dead_lettered:    [],               // admin must explicitly retry via API
  cancelling:       ["cancelled"],
  cancelled:        [],
  revoked:          [],
};

// ─── Table definition ─────────────────────────────────────────────────────────

export const ingestionJobsTable = pgTable("ingestion_jobs", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  knowledgeSourceId: text("knowledge_source_id")
    .notNull()
    .references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),

  sourceVersionId: text("source_version_id")
    .notNull()
    .references(() => knowledgeSourceVersionsTable.id, { onDelete: "cascade" }),

  /** Current pipeline stage */
  status: text("status").notNull().default("queued"),

  /** Number of processing attempts so far */
  attemptCount: integer("attempt_count").notNull().default(0),

  /** Maximum attempts before permanently failing */
  maxAttempts: integer("max_attempts").notNull().default(3),

  /** Machine-readable code for the last failure */
  lastErrorCode: text("last_error_code"),

  /**
   * Human-readable error summary.
   * MUST NOT include raw document content, participant names, or sensitive data.
   */
  lastErrorMessage: text("last_error_message"),

  // ─── Provider metadata ────────────────────────────────────────────────────

  extractionProvider: text("extraction_provider"),
  extractionProviderVersion: text("extraction_provider_version"),
  embeddingProvider: text("embedding_provider"),
  embeddingModel: text("embedding_model"),
  embeddingDimensions: integer("embedding_dimensions"),
  chunkingStrategy: text("chunking_strategy").default("heading_aware_v1"),
  chunkingStrategyVersion: text("chunking_strategy_version").default("1.0.0"),
  chunkCount: integer("chunk_count"),
  embeddingCount: integer("embedding_count"),

  // ─── Security flags ───────────────────────────────────────────────────────

  promptInjectionFlags: jsonb("prompt_injection_flags")
    .notNull()
    .default(sql`'[]'::jsonb`),

  requiresHumanReview: boolean("requires_human_review").notNull().default(false),

  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),

  // ─── Lease / heartbeat (Task #19) ─────────────────────────────────────────

  /** Worker currently holding the lease */
  claimedBy: text("claimed_by"),
  /** When the worker claimed this job */
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  /** When the current lease expires (worker must heartbeat before this) */
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  /** Last heartbeat from the claiming worker */
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),

  // ─── Retry / backoff (Task #19) ───────────────────────────────────────────

  /** Earliest time this failed job may be retried (exponential backoff) */
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  /** How many times a stuck-job sweeper has recovered this job */
  recoveryCount: integer("recovery_count").notNull().default(0),
  /** When this job was last failed */
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
  /** When this job entered dead_lettered status */
  deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),

  // ─── Timestamps ───────────────────────────────────────────────────────────

  startedAt:     timestamp("started_at",      { withTimezone: true }),
  completedAt:   timestamp("completed_at",    { withTimezone: true }),
  cancelledAt:   timestamp("cancelled_at",    { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IngestionJob       = typeof ingestionJobsTable.$inferSelect;
export type InsertIngestionJob = typeof ingestionJobsTable.$inferInsert;
