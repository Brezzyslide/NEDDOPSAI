/**
 * ingestion_jobs — Task #16 (Document Ingestion & Embedding Pipeline)
 *
 * Knowledge Hub ingestion job queue.
 *
 * Each row represents one processing attempt for a knowledge source version.
 * The pipeline transitions through these statuses:
 *
 *   queued → fetching → extracting → normalising → chunking → embedding
 *   → review_required → approved
 *
 * Terminal failure / cancellation paths:
 *   → failed      (after max_attempts exceeded or unrecoverable error)
 *   → cancelled   (actor-cancelled before completion)
 *   → revoked     (source was revoked mid-processing)
 *
 * Idempotency: a partial unique index on source_version_id prevents duplicate
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
  "cancelled",
  "revoked",
] as const;

export type IngestionJobStatus = typeof INGESTION_JOB_STATUSES[number];

/** Terminal statuses — job cannot be retried once in these states */
export const INGESTION_TERMINAL_STATUSES: IngestionJobStatus[] = [
  "approved",
  "cancelled",
  "revoked",
];

/** Active (non-terminal) statuses */
export const INGESTION_ACTIVE_STATUSES: IngestionJobStatus[] = INGESTION_JOB_STATUSES.filter(
  (s) => !INGESTION_TERMINAL_STATUSES.includes(s as IngestionJobStatus) && s !== "failed",
) as IngestionJobStatus[];

/**
 * Valid transitions for the ingestion job state machine.
 * 'failed' is reachable from any non-terminal, non-failed status.
 * 'revoked' is reachable from any active status.
 */
export const INGESTION_JOB_TRANSITIONS: Record<IngestionJobStatus, IngestionJobStatus[]> = {
  queued:           ["fetching", "cancelled"],
  fetching:         ["extracting", "failed"],
  extracting:       ["normalising", "failed"],
  normalising:      ["chunking", "failed"],
  chunking:         ["embedding", "failed"],
  embedding:        ["review_required", "failed"],
  review_required:  ["approved", "failed"],
  approved:         [],
  failed:           ["queued"],   // can be re-queued via retry
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

  /** Machine-readable code for the last failure (e.g. EXTRACTION_FAILED) */
  lastErrorCode: text("last_error_code"),

  /**
   * Human-readable error summary — MUST NOT include raw document content,
   * participant names, or sensitive identifying information.
   */
  lastErrorMessage: text("last_error_message"),

  // ─── Provider metadata ────────────────────────────────────────────────────

  /** e.g. "pdf-parse", "mammoth", "text-native" */
  extractionProvider: text("extraction_provider"),
  extractionProviderVersion: text("extraction_provider_version"),

  /** e.g. "openai", "null" */
  embeddingProvider: text("embedding_provider"),
  /** e.g. "text-embedding-3-small" */
  embeddingModel: text("embedding_model"),
  /** e.g. 1536 */
  embeddingDimensions: integer("embedding_dimensions"),

  /** e.g. "heading_aware_v1" */
  chunkingStrategy: text("chunking_strategy").default("heading_aware_v1"),
  /** e.g. "1.0.0" */
  chunkingStrategyVersion: text("chunking_strategy_version").default("1.0.0"),

  /** Total chunks persisted */
  chunkCount: integer("chunk_count"),
  /** Total chunks that received embeddings */
  embeddingCount: integer("embedding_count"),

  // ─── Security flags ───────────────────────────────────────────────────────

  /**
   * Array of InjectionFlag objects detected during ingestion.
   * Format: Array<{ patternId: string; matchedText: string; severity: string; chunkIndex: number }>
   * Reviewed by an authorised user before approval.
   */
  promptInjectionFlags: jsonb("prompt_injection_flags")
    .notNull()
    .default(sql`'[]'::jsonb`),

  /**
   * True when the pipeline detected issues requiring human review
   * (injection flags, scanned PDF, unsupported structure, etc.).
   * A job with requiresHumanReview=true CANNOT auto-approve.
   */
  requiresHumanReview: boolean("requires_human_review").notNull().default(false),

  /** Arbitrary pipeline metadata — extraction warnings, diagnostics */
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),

  // ─── Timestamps ───────────────────────────────────────────────────────────

  startedAt:     timestamp("started_at",      { withTimezone: true }),
  completedAt:   timestamp("completed_at",    { withTimezone: true }),
  cancelledAt:   timestamp("cancelled_at",    { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  claimedAt:     timestamp("claimed_at",      { withTimezone: true }),

  /** Worker instance ID that has claimed this job */
  claimedBy: text("claimed_by"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type IngestionJob       = typeof ingestionJobsTable.$inferSelect;
export type InsertIngestionJob = typeof ingestionJobsTable.$inferInsert;
