/**
 * completed_work_evidence_snapshots — Sprint 29K.2 (Durable Evidence Foundation)
 *
 * Execution-level evidence provenance record. One row per (executionId, versionId)
 * pair — capturing retrieval-level metadata for the EvidencePack used to generate
 * a specific Completed Work version.
 *
 * Design: Hybrid model (Sprint 29K.1 recommendation).
 *   - This table stores execution/retrieval metadata.
 *   - completed_work_evidence_links stores the per-chunk passage snapshots + hashes.
 *
 * Ownership: evidence belongs to the exact version generated from it.
 *   - V1 and V2 each get their own snapshot rows.
 *   - Approval (via approvedVersionId) pins which version's evidence is canonical.
 *
 * Idempotency: UNIQUE (execution_id, version_id) ensures re-running persistence
 *   for the same execution/version does not create duplicate rows.
 *
 * Future compatibility: completed_work_claim_evidence references evidence_links
 *   by evidence_link.id without requiring changes to this schema.
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, integer, real, uniqueIndex } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { completedWorkTable } from "./completedWork.js";
import { completedWorkVersionsTable } from "./completedWorkVersions.js";

export const completedWorkEvidenceSnapshotsTable = pgTable(
  "completed_work_evidence_snapshots",
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

    /** Total chunks available in the EvidencePack at execution time */
    totalChunksAvailable: integer("total_chunks_available").notNull().default(0),

    /** Average relevance score across all chunks (0–1) */
    avgRelevanceScore: real("avg_relevance_score"),

    /**
     * Retrieval method used. Current values: "lexical" | "semantic" | "hybrid".
     * NOTE: retrieval_audit_events stores "lexical" even when semantic was attempted
     * but skipped (no embedding provider). This field records the actual method used
     * for this pack, not the attempted method.
     */
    retrievalMethod: text("retrieval_method"),

    /** Wall-clock milliseconds for EvidencePack resolution */
    retrievalMs: integer("retrieval_ms"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Idempotency guard: one snapshot per execution per version */
    executionVersionUniq: uniqueIndex("cw_evidence_snapshot_exec_ver_uniq").on(
      t.executionId,
      t.versionId,
    ),
  }),
);
