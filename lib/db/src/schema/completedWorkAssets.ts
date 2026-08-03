/**
 * completed_work_assets — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Records every knowledge source, memory entry, template, approved example,
 * or task upload that was used to produce a Completed Work item. Enables
 * full source attribution and citation in the audit trail.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { completedWorkTable } from "./completedWork.js";

export const COMPLETED_WORK_ASSET_TYPES = [
  "library_source",
  "memory",
  "template",
  "example",
  "task_upload",
] as const;
export type CompletedWorkAssetType = (typeof COMPLETED_WORK_ASSET_TYPES)[number];

export const COMPLETED_WORK_ASSET_ROLES = [
  "primary",
  "supporting",
  "citation",
  "style",
  "template",
] as const;
export type CompletedWorkAssetRole = (typeof COMPLETED_WORK_ASSET_ROLES)[number];

export const completedWorkAssetsTable = pgTable("completed_work_assets", {
  id: text("id").primaryKey(),

  completedWorkId: text("completed_work_id")
    .notNull()
    .references(() => completedWorkTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /**
   * Category of asset:
   * library_source — an approved Organisation Library document
   * memory         — an approved organisation memory entry
   * template       — the template document used to structure output
   * example        — an approved example that influenced style
   * task_upload    — a conversation-scoped uploaded document
   */
  assetType: text("asset_type").notNull(),

  /** ID of the referenced asset (sourceId, memoryId, etc.) */
  assetId: text("asset_id").notNull(),

  /**
   * Role this asset played:
   * primary    — primary source of substance
   * supporting — supplementary context
   * citation   — explicitly cited in the output
   * style      — influenced writing style only
   * template   — the structural template used
   */
  role: text("role").notNull().default("supporting"),

  /** Short citation label e.g. "[Pol-2024-001]" */
  citationRef: text("citation_ref"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
