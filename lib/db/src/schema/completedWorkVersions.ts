/**
 * completed_work_versions — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Immutable version snapshots of a Completed Work item. Every meaningful
 * change to the content creates a new version row. The parent completed_work
 * row points to the current active version via currentVersionId.
 */
import { pgTable, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { completedWorkTable } from "./completedWork.js";

export interface ReviewDimension {
  dimension: string;
  score: number; // 0–10
  feedback: string;
  passed: boolean;
}

export const completedWorkVersionsTable = pgTable("completed_work_versions", {
  id: text("id").primaryKey(),

  completedWorkId: text("completed_work_id")
    .notNull()
    .references(() => completedWorkTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Sequential version number starting at 1 */
  versionNumber: integer("version_number").notNull(),

  /** Full markdown content of the work output */
  contentMarkdown: text("content_markdown"),

  /** Weighted overall quality score 0–100 */
  qualityScore: integer("quality_score"),

  /** Per-dimension review results from selfReviewService */
  reviewDimensions: jsonb("review_dimensions")
    .$type<ReviewDimension[]>()
    .default([]),

  /** Summary of what changed vs previous version */
  changeNote: text("change_note"),

  /** Whether this version was produced by automatic self-revision */
  isAutoRevision: text("is_auto_revision").default("false"),

  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  /**
   * Sprint 29K.3 — Durable provenance lifecycle for this version.
   *
   *   not_available_legacy — version created before Sprint 29K provenance support
   *   pending              — provenance persistence in progress (set before fire-and-forget)
   *   complete             — evidence + all claims persisted successfully
   *   partial              — evidence persisted but one or more claim bindings invalid
   *   failed               — evidence persistence itself failed
   *
   * A row with provenanceStatus = "not_available_legacy" is not the same as "failed".
   * Do not retroactively label historical work as failed.
   */
  provenanceStatus: text("provenance_status").notNull().default("not_available_legacy"),
});
