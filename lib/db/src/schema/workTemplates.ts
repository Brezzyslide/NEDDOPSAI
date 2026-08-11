/**
 * work_templates — Production Blueprint Foundation
 *
 * Represents document templates (DOCX, PDF, etc.) that professional work
 * products are rendered against. Separate from blueprints so that:
 *   - A blueprint defines HOW work is executed
 *   - A template defines the OUTPUT FORMAT of the resulting artifact
 *
 * Templates may be:
 *   - Platform-owned (default, immutable, provided by NeedsOps)
 *   - Organisation-owned (substitutable by orgs where permitted)
 *
 * Blueprints reference templates via defaultTemplateId.
 * Orgs may substitute their own template when blueprint.permittedOrgOverrides
 * includes "template" and an org-owned template exists for the same code.
 */

import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const workTemplatesTable = pgTable("work_templates", {
  id: text("id").primaryKey(),

  /**
   * NULL for platform-owned templates (available to all orgs).
   * Set for org-owned templates (private to that org).
   */
  organizationId: text("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /**
   * platform_owned — NeedsOps proprietary; orgs cannot edit.
   * organisation_owned — created by the org; fully editable by their admins.
   */
  ownerType: text("owner_type").notNull().default("platform_owned"),

  /**
   * Stable machine-readable code matching the related blueprint family/code.
   * e.g. "care_plan", "incident_investigation"
   */
  code: text("code").notNull(),

  /** Human-readable name */
  title: text("title").notNull(),

  /** Semantic version */
  version: text("version").notNull().default("1.0.0"),

  /**
   * Lifecycle status.
   * draft → review → published → superseded | archived
   */
  status: text("status").notNull().default("draft"),

  /**
   * Readiness state — distinct from publication status.
   * placeholder | draft | professional_review | production_ready | superseded
   */
  maturityState: text("maturity_state").notNull().default("placeholder"),

  /**
   * Template type governs how the template is applied.
   * document — structured document template (DOCX/PDF)
   * markdown — plain markdown scaffold
   * email — email body template
   */
  templateType: text("template_type").notNull().default("document"),

  /**
   * Storage reference for the actual template file.
   * For production DOCX templates: GCS object path.
   * NULL when no physical template exists yet (placeholder state).
   */
  sourceFileReference: text("source_file_reference"),

  /** MIME type of the template file e.g. "application/vnd.openxmlformats-officedocument.wordprocessingml.document" */
  mimeType: text("mime_type"),

  /**
   * Merge-field schema: defines the placeholders in the template and
   * their mapping to execution output fields.
   *
   * Example:
   * {
   *   "fields": [
   *     { "key": "{{participant_name}}", "source": "entityKnowledge.participant.name", "required": true },
   *     { "key": "{{date_created}}", "source": "system.today", "required": true }
   *   ]
   * }
   */
  mergeFieldSchema: jsonb("merge_field_schema")
    .$type<Record<string, unknown>>(),

  /** Whether this template may be substituted by an org-owned template */
  allowOrgSubstitution: boolean("allow_org_substitution").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkTemplate = typeof workTemplatesTable.$inferSelect;
export type NewWorkTemplate = typeof workTemplatesTable.$inferInsert;
