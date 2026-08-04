/**
 * blueprint_versions — Sprint 28 (Blueprint Studio)
 *
 * Immutable snapshots of work blueprints at time of publication.
 * Every "publish" action creates a new version record.
 * Never overwrite an existing version — only create new ones.
 *
 * Blueprint lifecycle:
 *   draft → review → published → superseded → archived
 *
 * Built-in blueprints: no versioning required (static, read-only).
 * Org-custom blueprints: full version lifecycle.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { workBlueprintsTable } from "./workBlueprints.js";

export type BlueprintStatus = "draft" | "review" | "published" | "superseded" | "archived";

export const BLUEPRINT_STATUSES = [
  "draft",
  "review",
  "published",
  "superseded",
  "archived",
] as const;

export const blueprintVersionsTable = pgTable("blueprint_versions", {
  id: text("id").primaryKey(),

  /** The blueprint this version belongs to */
  blueprintId: text("blueprint_id")
    .notNull()
    .references(() => workBlueprintsTable.id, { onDelete: "cascade" }),

  /** Tenant owner — same as the blueprint's organizationId */
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Semver label at time of this snapshot e.g. "1.0.0", "2.1.0" */
  versionLabel: text("version_label").notNull(),

  /** Lifecycle status of this version */
  status: text("status").notNull().default("draft"),

  /**
   * Full blueprint data snapshot (all fields) at time of publication.
   * Immutable after creation.
   */
  snapshot: jsonb("snapshot")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

  /** Optional release notes / change summary */
  notes: text("notes"),

  /** User who triggered this version (publish / rollback / clone) */
  createdBy: text("created_by").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
