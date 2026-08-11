/**
 * blueprint_sections — Production Blueprint Architecture
 *
 * Ordered section definitions for a blueprint.
 *
 * PLATFORM PRIVATE: Section instructions, evidence requirements, validation
 * rules and quality criteria are proprietary NeedsOps IP and must never be
 * returned to tenant roles through the public API.
 *
 * Only the sectionCode and title are safe to expose publicly.
 *
 * These records are platform-managed. Organisation overrides are scoped to
 * the parent blueprint row, not to individual sections.
 *
 * NOTE: Content is not populated here. Professional section content will be
 * added separately from real organisational source documents.
 */
import { pgTable, text, boolean, jsonb, integer, timestamp } from "drizzle-orm/pg-core";
import { workBlueprintsTable } from "./workBlueprints.js";

export const blueprintSectionsTable = pgTable("blueprint_sections", {
  id: text("id").primaryKey(),

  /** Parent blueprint this section belongs to. */
  blueprintId: text("blueprint_id")
    .notNull()
    .references(() => workBlueprintsTable.id, { onDelete: "cascade" }),

  /** Stable machine-readable section identifier e.g. "participant_background" */
  sectionCode: text("section_code").notNull(),

  /** Human-readable section title. Safe to expose publicly. */
  title: text("title").notNull(),

  /**
   * Brief public description of what this section covers.
   * Safe to expose publicly.
   */
  description: text("description"),

  /**
   * PRIVATE — Detailed instructions for the specialist completing this section.
   * Must NOT be returned to tenant roles.
   */
  instructions: text("instructions"),

  /** Whether this section is mandatory in the completed work product. */
  required: boolean("required").notNull().default(true),

  /**
   * PRIVATE — Minimum content expectation (e.g. "at least 3 goals described").
   */
  minimumContentExpectation: text("minimum_content_expectation"),

  /**
   * PRIVATE — Evidence requirements for this section.
   * Array of { type, description, required }.
   */
  evidenceRequirements: jsonb("evidence_requirements"),

  /**
   * PRIVATE — Source types permitted for evidence in this section.
   * e.g. ["participant_record", "clinical_assessment", "incident_report"]
   */
  allowedSourceTypes: jsonb("allowed_source_types"),

  /**
   * PRIVATE — Assumptions explicitly prohibited in this section.
   */
  prohibitedAssumptions: jsonb("prohibited_assumptions"),

  /**
   * PRIVATE — Validation rules applied to this section's content.
   */
  validationRules: jsonb("validation_rules"),

  /**
   * PRIVATE — Quality criteria for this section.
   */
  qualityCriteria: jsonb("quality_criteria"),

  /** Display order (ascending). */
  order: integer("order").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BlueprintSection = typeof blueprintSectionsTable.$inferSelect;
export type NewBlueprintSection = typeof blueprintSectionsTable.$inferInsert;

/** Public-safe fields from a section (never include private spec fields). */
export const SECTION_PUBLIC_FIELDS = ["id", "blueprintId", "sectionCode", "title", "description", "required", "order"] as const;

/** Private spec fields that must never be returned to tenant roles. */
export const SECTION_PRIVATE_FIELDS = [
  "instructions",
  "minimumContentExpectation",
  "evidenceRequirements",
  "allowedSourceTypes",
  "prohibitedAssumptions",
  "validationRules",
  "qualityCriteria",
] as const;
