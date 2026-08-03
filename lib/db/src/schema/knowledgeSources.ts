/**
 * knowledge_sources — Task #15 (Knowledge Schema, Scopes & Secure Upload)
 *
 * Central organisational knowledge repository — the "Organisation Library".
 *
 * This is NOT just document storage. It is the knowledge foundation from which
 * specialists learn. Sources include policies, procedures, playbooks, style
 * guides, care plans, BSPs, legislation, compliance docs, HR manuals, templates,
 * approved examples, and any other organisational knowledge asset.
 *
 * SOURCE SCOPE:
 *   library  — belongs to the Organisation Library; available for specialist
 *              training and retrieval across tasks.
 *   task     — uploaded within a specific task/chat; task-scoped and private
 *              to that task. Never used for specialist training unless the user
 *              explicitly selects "Save to Organisation Library".
 *
 * MULTI-SOURCE ARCHITECTURE:
 *   storageProvider distinguishes local uploads, GCS, S3, connected cloud
 *   storage, desktop connector, and future SaaS integrations. Nothing in this
 *   schema prevents adding new source types.
 *
 * FUTURE COMPLETED WORK MODULE:
 *   taskId links task-scoped uploads to their originating task. The Completed
 *   Work module (future sprint) will reference knowledge_sources for citations
 *   and source attribution on completed outputs.
 *
 * Tenant isolation enforced by RLS on organization_id.
 *
 * Lifecycle: uploaded → processing → review_required → approved
 *                     → (revoked | superseded | archived | failed)
 * Only 'approved' sources in scope 'library' are eligible for specialist
 * context injection (Task #17).
 */
import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const knowledgeSourcesTable = pgTable("knowledge_sources", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  // ─── Scope ────────────────────────────────────────────────────────────────

  /**
   * Whether this source belongs to the Organisation Library or is scoped to
   * a specific task.
   *
   * library — Organisation Library; eligible for specialist training and
   *           retrieval. Requires explicit user action to promote a task-
   *           scoped upload here.
   * task    — Scoped to a single task/chat session. NEVER automatically
   *           promoted to library. User must choose "Save to Organisation
   *           Library" to change scope.
   */
  sourceScope: text("source_scope").notNull().default("library"),

  /**
   * For task-scoped sources: the task ID this upload belongs to.
   * NULL for library sources.
   * Provides the FK hook for the future Completed Work module.
   */
  taskId: text("task_id"),

  // ─── Identity ─────────────────────────────────────────────────────────────

  /** Human-readable title of this knowledge asset */
  title: text("title").notNull(),

  /** Optional description or summary of what this source covers */
  description: text("description"),

  /**
   * Semantic category of the knowledge asset.
   * policy | procedure | playbook | style_guide | approved_example |
   * template | legislation_reference | manual_note | connected_document |
   * care_plan | behaviour_support_plan | risk_assessment | compliance_document |
   * hr_manual | onboarding_guide | meeting_pack | operational_manual |
   * contract | participant_document | finance_procedure
   */
  sourceType: text("source_type").notNull(),

  // ─── File metadata ────────────────────────────────────────────────────────

  /** Original file name as provided by the uploader */
  originalFileName: text("original_file_name"),

  /** MIME type e.g. application/pdf, text/plain */
  mimeType: text("mime_type"),

  /**
   * Storage provider for this asset.
   * gcs | s3 | local | desktop_connector | connected_cloud | saas_integration
   * Extensible — do not hard-code assumptions about provider in retrieval code.
   */
  storageProvider: text("storage_provider"),

  /**
   * Tenant-scoped storage path / key.
   * Library sources: orgs/{orgId}/library/{sourceId}/{safeFileName}
   * Task sources:    orgs/{orgId}/tasks/{taskId}/{sourceId}/{safeFileName}
   * Never a public URL — always accessed via signed URL.
   */
  storageKey: text("storage_key"),

  /**
   * External identifier when source was connected from a third-party system
   * (e.g. Google Drive file ID, SharePoint item ID).
   */
  externalSourceId: text("external_source_id"),

  /** SHA-256 hex digest of the file content — used for dedup and integrity */
  checksum: text("checksum"),

  /** File size in bytes */
  fileSize: integer("file_size"),

  // ─── Language & governance ────────────────────────────────────────────────

  /** BCP 47 language code e.g. "en", "en-AU" */
  language: text("language").notNull().default("en"),

  /**
   * Processing and approval lifecycle status.
   * uploaded | processing | review_required | approved | failed |
   * revoked | superseded | archived
   */
  status: text("status").notNull().default("uploaded"),

  /**
   * How binding this source is for specialist responses.
   * mandatory | authoritative | supporting | example_only | reference_only
   */
  authorityLevel: text("authority_level").notNull().default("supporting"),

  /**
   * Data sensitivity classification.
   * public | internal | confidential | restricted
   */
  sensitivityClassification: text("sensitivity_classification").notNull().default("internal"),

  // ─── Effective dates ──────────────────────────────────────────────────────

  /** Date from which this source is effective */
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),

  /** Date after which this source is no longer effective */
  effectiveTo: timestamp("effective_to", { withTimezone: true }),

  // ─── Versioning ───────────────────────────────────────────────────────────

  /** Human-readable version label e.g. "v2.1", "2024-Q3" */
  versionLabel: text("version_label"),

  /**
   * Whether this is the current active version of the logical knowledge asset.
   * Version replacement is transactional — old record flips to false when new
   * version is promoted.
   */
  isCurrent: boolean("is_current").notNull().default(true),

  /**
   * Points to the knowledge_sources.id that superseded this one.
   * Application-level reference to avoid circular FK.
   * Superseded records remain queryable for authorised audit access.
   */
  supersededBySourceId: text("superseded_by_source_id"),

  // ─── Approval & audit ─────────────────────────────────────────────────────

  /** DB user ID of the person who uploaded this source */
  uploadedByUserId: text("uploaded_by_user_id").notNull(),

  /** DB user ID of the person who approved this source for specialist use */
  approvedByUserId: text("approved_by_user_id"),

  /** When approval was granted */
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  /** When this source was revoked (soft revoke — record retained for audit) */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  // ─── Timestamps ───────────────────────────────────────────────────────────

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),

  /** Soft delete — retained for version history and citation audit trails */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type KnowledgeSource       = typeof knowledgeSourcesTable.$inferSelect;
export type InsertKnowledgeSource = typeof knowledgeSourcesTable.$inferInsert;

// ─── Enum constants (authoritative lists — used in service validation) ────────

export const KNOWLEDGE_SOURCE_TYPES = [
  "policy",
  "procedure",
  "playbook",
  "style_guide",
  "approved_example",
  "template",
  "legislation_reference",
  "manual_note",
  "connected_document",
  "care_plan",
  "behaviour_support_plan",
  "risk_assessment",
  "compliance_document",
  "hr_manual",
  "onboarding_guide",
  "meeting_pack",
  "operational_manual",
  "contract",
  "participant_document",
  "finance_procedure",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_SOURCE_STATUSES = [
  "uploaded",
  "processing",
  "review_required",
  "approved",
  "failed",
  "revoked",
  "superseded",
  "archived",
] as const;
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number];

export const KNOWLEDGE_AUTHORITY_LEVELS = [
  "mandatory",
  "authoritative",
  "supporting",
  "example_only",
  "reference_only",
] as const;
export type KnowledgeAuthorityLevel = (typeof KNOWLEDGE_AUTHORITY_LEVELS)[number];

export const KNOWLEDGE_SENSITIVITY_LEVELS = [
  "public",
  "internal",
  "confidential",
  "restricted",
] as const;
export type KnowledgeSensitivityLevel = (typeof KNOWLEDGE_SENSITIVITY_LEVELS)[number];

export const KNOWLEDGE_SOURCE_SCOPES = ["library", "task"] as const;
export type KnowledgeSourceScope = (typeof KNOWLEDGE_SOURCE_SCOPES)[number];

export const KNOWLEDGE_STORAGE_PROVIDERS = [
  "gcs",
  "s3",
  "local",
  "desktop_connector",
  "connected_cloud",
  "saas_integration",
] as const;
export type KnowledgeStorageProvider = (typeof KNOWLEDGE_STORAGE_PROVIDERS)[number];
