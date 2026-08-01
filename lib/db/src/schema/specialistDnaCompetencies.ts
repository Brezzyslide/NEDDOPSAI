/**
 * specialist_dna_competencies table — Sprint SRM Hardening (Phase 3)
 *
 * Competencies belonging to a specialist DNA profile version.
 * One row per competency per DNA profile version.
 *
 * No RLS — platform-level table.
 */
import {
  pgTable,
  text,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import { specialistDnaProfilesTable } from "./specialistDnaProfiles.js";

export const specialistDnaCompetenciesTable = pgTable(
  "specialist_dna_competencies",
  {
    /** References specialist_dna_profiles.id */
    dnaProfileId: text("dna_profile_id")
      .notNull()
      .references(() => specialistDnaProfilesTable.id, { onDelete: "cascade" }),

    /** Canonical competency code from the DNA profile, e.g. "STRATEGIC_OPS" */
    competencyCode: text("competency_code").notNull(),

    /** Human-readable competency name */
    name: text("name").notNull(),

    /**
     * Proficiency level.
     * Common values: "authority" | "expert" | "proficient" | "developing"
     */
    level: text("level").notNull(),

    /** Competency description */
    description: text("description").notNull().default(""),

    /**
     * Version string — inherits from the parent DNA profile version
     * when first created; may be bumped independently for minor changes.
     */
    version: text("version").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.dnaProfileId, table.competencyCode] }),
  }),
);

export type SpecialistDnaCompetency   = typeof specialistDnaCompetenciesTable.$inferSelect;
export type InsertSpecialistDnaCompetency = typeof specialistDnaCompetenciesTable.$inferInsert;
