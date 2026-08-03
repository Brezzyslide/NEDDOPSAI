/**
 * knowledge_source_versions — Task #15 (Knowledge Schema, Scopes & Secure Upload)
 *
 * Version lineage for Organisation Library knowledge assets.
 * Each row represents one uploaded file revision of a knowledge source.
 *
 * Rules:
 *   - Only one version per knowledgeSourceId may have isCurrent = true.
 *   - Replacing a version is transactional: the old version's isCurrent is set
 *     to false and its supersededById is set to the new version's id.
 *   - Superseded versions remain queryable for authorised audit access.
 *   - Superseded versions are NEVER served as active knowledge.
 *   - ingestionStatus is a placeholder for Task #16 (document extraction).
 *     When Task #16 runs it will update this column and populate knowledge_chunks.
 *
 * CITATION SUPPORT:
 *   The combination of (knowledgeSourceId, id, versionLabel) provides the
 *   citation key for the future Completed Work module. Retrieval audit events
 *   reference specific version IDs for accurate source attribution.
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { knowledgeSourcesTable } from "./knowledgeSources.js";

export const knowledgeSourceVersionsTable = pgTable("knowledge_source_versions", {
  id: text("id").primaryKey(),

  knowledgeSourceId: text("knowledge_source_id")
    .notNull()
    .references(() => knowledgeSourcesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Human-readable version label e.g. "v1", "v2", "2024-Q3-rev2" */
  versionLabel: text("version_label").notNull(),

  /** SHA-256 hex digest of the stored file for this version */
  checksum: text("checksum"),

  /** Tenant-scoped storage key for this version's file */
  storageKey: text("storage_key"),

  /** Storage provider: gcs | s3 | local | desktop_connector */
  storageProvider: text("storage_provider"),

  /** File size in bytes */
  fileSize: integer("file_size"),

  /** MIME type of this version's file */
  mimeType: text("mime_type"),

  /** Original file name as uploaded */
  originalFileName: text("original_file_name"),

  /**
   * Whether this is the currently active version.
   * Invariant: exactly one version per knowledgeSourceId has isCurrent = true.
   * Enforced transactionally during version replacement.
   */
  isCurrent: boolean("is_current").notNull().default(false),

  /**
   * Version lifecycle status.
   * uploaded | processing | review_required | approved | failed | revoked | superseded | archived
   */
  status: text("status").notNull().default("uploaded"),

  /** Date from which this version is effective */
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),

  /** Date after which this version is no longer effective */
  effectiveTo: timestamp("effective_to", { withTimezone: true }),

  /**
   * ID of the knowledge_source_versions record that superseded this one.
   * Application-level reference — avoids circular FK constraint.
   */
  supersededById: text("superseded_by_id"),

  /** DB user who uploaded this version */
  uploadedByUserId: text("uploaded_by_user_id").notNull(),

  /** DB user who approved this version for active use */
  approvedByUserId: text("approved_by_user_id"),

  /** When version approval was granted */
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  /**
   * Document extraction and chunking status for Task #16.
   * pending | processing | complete | failed
   * Remains "pending" until Task #16 runs the ingestion pipeline.
   */
  ingestionStatus: text("ingestion_status").notNull().default("pending"),

  /**
   * Metadata populated by the Task #16 ingestion pipeline.
   * e.g. { chunkCount: 42, pageCount: 12, extractionModel: "unstructured-v0.7" }
   */
  ingestionMetadata: jsonb("ingestion_metadata").notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type KnowledgeSourceVersion       = typeof knowledgeSourceVersionsTable.$inferSelect;
export type InsertKnowledgeSourceVersion = typeof knowledgeSourceVersionsTable.$inferInsert;
