/**
 * retrieval_audit_events — Task #15 (schema) + Task #17 (implementation)
 *
 * Full audit trail for runtime knowledge retrieval events.
 *
 * Records which Organisation Library sources and chunks were retrieved
 * for each specialist execution — enabling citation, transparency,
 * conflict detection, and retrieval quality monitoring.
 *
 * CITATION SUPPORT:
 *   sourceIds and chunkIds provide the citation chain from a specialist's
 *   response back to specific Organisation Library documents and their
 *   exact version.
 *
 * PRIVACY CONSTRAINT:
 *   NEVER log document contents — only IDs, scores, and metadata.
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations.js";

export const retrievalAuditEventsTable = pgTable("retrieval_audit_events", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Workforce role code of the specialist that triggered retrieval */
  specialistId: text("specialist_id").notNull(),

  /**
   * Execution ID from the execution engine.
   * NULL for test/ad-hoc retrieval calls.
   */
  executionId: text("execution_id"),

  /**
   * Entity the retrieval was scoped to (P2 — Entity Knowledge).
   * e.g. participant ID, client ID, project ID.
   */
  entityId: text("entity_id"),

  /**
   * knowledge_sources.id values retrieved (P5 — Organisation Library).
   * JSON array of text IDs.
   */
  sourceIds: jsonb("source_ids").notNull().default(sql`'[]'::jsonb`),

  /**
   * knowledge_chunks.id values retrieved.
   * JSON array of text IDs for precise chunk-level citation.
   */
  chunkIds: jsonb("chunk_ids").notNull().default(sql`'[]'::jsonb`),

  /**
   * organisation_memory.id values retrieved (P3 — Org Memory).
   * JSON array of text IDs.
   */
  memoryIds: jsonb("memory_ids").notNull().default(sql`'[]'::jsonb`),

  /**
   * Task-scoped source IDs retrieved (P1 — Task Uploads).
   * JSON array of text IDs.
   */
  taskUploadIds: jsonb("task_upload_ids").notNull().default(sql`'[]'::jsonb`),

  /**
   * Retrieval method used: lexical | semantic | hybrid | exact_match
   */
  retrievalMethod: text("retrieval_method"),

  /**
   * Retrieval scoring summary:
   * { topScore, meanScore, semanticScore, lexicalScore, chunkScores: [{id, score}] }
   * Never includes raw text content.
   */
  scoreMetadata: jsonb("score_metadata").notNull().default(sql`'{}'::jsonb`),

  /**
   * Per-chunk ranking details (id, finalScore, semanticScore, lexicalScore,
   * authorityBonus, freshnessBonus, priorityLayer, reasonSelected).
   * Never includes raw text.
   */
  rankingDetails: jsonb("ranking_details").notNull().default(sql`'[]'::jsonb`),

  /**
   * Map of chunkId/memoryId → reason this item was selected.
   * e.g. { "chunk-1": "highest_authority", "mem-1": "pinned_decision" }
   */
  reasonSelected: jsonb("reason_selected").notNull().default(sql`'{}'::jsonb`),

  /**
   * Map of sourceId → reason this source was rejected.
   * e.g. { "src-1": "sensitivity_blocked", "src-2": "superseded" }
   */
  reasonRejected: jsonb("reason_rejected").notNull().default(sql`'{}'::jsonb`),

  /** Number of conflicts detected during retrieval */
  conflictCount: integer("conflict_count").notNull().default(0),

  /** Total token count of the retrieved context window */
  tokenCount: integer("token_count"),

  /** Total retrieval duration in milliseconds */
  retrievalDurationMs: integer("retrieval_duration_ms"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RetrievalAuditEvent       = typeof retrievalAuditEventsTable.$inferSelect;
export type InsertRetrievalAuditEvent = typeof retrievalAuditEventsTable.$inferInsert;
