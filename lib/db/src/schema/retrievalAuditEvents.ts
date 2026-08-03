/**
 * retrieval_audit_events — Task #15 (Knowledge Schema, Scopes & Secure Upload)
 *
 * PLACEHOLDER TABLE — Task #17 populates this; Task #15 only defines the schema.
 *
 * Audit trail for runtime knowledge retrieval events.
 * Records which Organisation Library sources and chunks were retrieved
 * for each specialist execution — enabling citation, transparency, and
 * retrieval quality monitoring.
 *
 * CITATION SUPPORT:
 *   sourceIds and chunkIds provide the citation chain from a specialist's
 *   response back to specific Organisation Library documents and their
 *   exact version. The future Completed Work module uses these for attribution.
 *
 * LIVE EVENTS:
 *   Task #17 (Hybrid Retrieval) will begin writing rows here.
 *   Task #15 defines the schema only — no live events are written yet
 *   unless the existing Task #14 audit path can safely reuse it
 *   (it cannot — different semantics).
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const retrievalAuditEventsTable = pgTable("retrieval_audit_events", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Workforce role code of the specialist that triggered retrieval */
  specialistId: text("specialist_id").notNull(),

  /**
   * Execution ID from the execution engine (lib/agent-runtime).
   * NULL for test/ad-hoc retrieval calls.
   */
  executionId: text("execution_id"),

  /**
   * knowledge_sources.id values retrieved in this event.
   * JSON array of text IDs for citation and attribution.
   */
  sourceIds: jsonb("source_ids").notNull().default([]),

  /**
   * knowledge_chunks.id values retrieved in this event.
   * JSON array of text IDs for precise chunk-level citation.
   */
  chunkIds: jsonb("chunk_ids").notNull().default([]),

  /**
   * Retrieval method used by the pipeline.
   * lexical | semantic | hybrid | exact_match
   * NULL until Task #17 populates live events.
   */
  retrievalMethod: text("retrieval_method"),

  /**
   * Retrieval scoring metadata from the pipeline.
   * e.g. { topScore: 0.92, meanScore: 0.81, chunkScores: [...] }
   * NULL until Task #17 populates live events.
   */
  scoreMetadata: jsonb("score_metadata").notNull().default({}),

  /** Total token count of the retrieved context window */
  tokenCount: integer("token_count"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RetrievalAuditEvent       = typeof retrievalAuditEventsTable.$inferSelect;
export type InsertRetrievalAuditEvent = typeof retrievalAuditEventsTable.$inferInsert;
