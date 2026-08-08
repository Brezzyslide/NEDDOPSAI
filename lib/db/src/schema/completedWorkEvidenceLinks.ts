/**
 * completed_work_evidence_links — Sprint 29K.2 (Durable Evidence Foundation)
 *
 * Per-chunk evidence provenance records. One row per chunk included in the
 * EvidencePack for a given (executionId, versionId) pair.
 *
 * Design: Hybrid model — stores both:
 *   1. References: chunkId, sourceId, sourceVersionId (for live lookup)
 *   2. Snapshots: passageHash, passageSnapshot, sectionTitle, pageNumber
 *      (preserved even after source re-ingestion or soft-deletion)
 *
 * Passage integrity:
 *   passageHash = SHA-256(full chunk.text at execution time)
 *   passageSnapshot = bounded excerpt (≤ MAX_PASSAGE_SNAPSHOT_CHARS) for display
 *
 *   verifyEvidencePassageIntegrity() checks:
 *     MATCH         → live chunk text hashes to passageHash → "verified"
 *     NOT FOUND     → chunk soft-deleted or re-ingested    → "snapshot_only"
 *     HASH MISMATCH → chunk text changed in place          → "changed"
 *
 * Re-ingestion safety:
 *   chunkId is a SOFT REFERENCE (no FK) — re-ingestion creates new chunk UUIDs
 *   and soft-deletes old ones. The stored passageSnapshot remains readable
 *   regardless. Use chunkId only for drift detection.
 *
 * Future compatibility:
 *   Each link has a stable UUID (id) so completed_work_claim_evidence can
 *   reference it by FK without schema changes.
 *
 * Idempotency: UNIQUE (execution_id, version_id, chunk_id) prevents duplicate
 *   links when the persistence callback is retried.
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, integer, real, uniqueIndex } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { completedWorkTable } from "./completedWork.js";
import { completedWorkVersionsTable } from "./completedWorkVersions.js";

/** Maximum characters stored in the passage snapshot (display/audit excerpt) */
export const MAX_PASSAGE_SNAPSHOT_CHARS = 800;

export const completedWorkEvidenceLinksTable = pgTable(
  "completed_work_evidence_links",
  {
    id: text("id").primaryKey(),

    executionId: text("execution_id").notNull(),

    completedWorkId: text("completed_work_id")
      .notNull()
      .references(() => completedWorkTable.id, { onDelete: "cascade" }),

    versionId: text("version_id")
      .notNull()
      .references(() => completedWorkVersionsTable.id, { onDelete: "cascade" }),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),

    // ─── Soft references (not FK-enforced — see header) ───────────────────────

    /**
     * Original chunk UUID at execution time.
     * SOFT REFERENCE — may point to a soft-deleted row after re-ingestion.
     * Use only for drift detection; always fall back to passageSnapshot for display.
     */
    chunkId: text("chunk_id").notNull(),

    /** FK-safe: knowledge_sources rows persist under soft-delete (deletedAt only) */
    sourceId: text("source_id").notNull(),

    /**
     * knowledge_source_versions.id at execution time.
     * Stable: version rows persist under soft-delete.
     * Resolves to: version_label, effective_from, effective_to.
     */
    sourceVersionId: text("source_version_id"),

    // ─── Passage integrity snapshots ──────────────────────────────────────────

    /**
     * SHA-256 hex of the FULL chunk.text at execution time.
     * Used by verifyEvidencePassageIntegrity() to detect re-ingestion drift.
     * This is NOT truncated — it hashes the complete passage.
     */
    passageHash: text("passage_hash").notNull(),

    /**
     * Bounded excerpt of chunk.text (≤ MAX_PASSAGE_SNAPSHOT_CHARS chars).
     * Preserved for UI display even if the live chunk is soft-deleted or re-ingested.
     * snapshot ≠ full text. Use live chunk for full retrieval when available + verified.
     */
    passageSnapshot: text("passage_snapshot").notNull(),

    // ─── Location metadata (denormalized for stability across re-chunking) ────

    /** Section heading within the source document at extraction time */
    sectionTitle: text("section_title"),

    /** Page number in the original document at extraction time */
    pageNumber: integer("page_number"),

    // ─── Retrieval metadata ───────────────────────────────────────────────────

    /** Retrieval relevance score 0–1 (EvidenceChunk.confidence at execution time) */
    relevanceScore: real("relevance_score").notNull(),

    /**
     * Why this chunk was included:
     * "organisation_library" | "specialist_knowledge" | "task_upload"
     */
    selectionReason: text("selection_reason").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Idempotency guard: one link per chunk per execution per version */
    executionVersionChunkUniq: uniqueIndex("cw_evidence_link_exec_ver_chunk_uniq").on(
      t.executionId,
      t.versionId,
      t.chunkId,
    ),
  }),
);
