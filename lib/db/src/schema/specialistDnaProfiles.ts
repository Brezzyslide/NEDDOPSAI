/**
 * specialist_dna_profiles table — Sprint SRM Hardening (Phase 3)
 *
 * Central versioned store for NeedsOps specialist DNA profiles.
 * Replaces the static in-process registry as the production source of truth.
 *
 * Design rules:
 * - Base DNA is platform-controlled — no tenant can modify mission, prohibited
 *   behaviours, escalation rules, or safety constraints.
 * - Only ONE active published version per specialist_id at any time.
 * - Published versions are immutable — retirement requires creating a new version.
 * - status: draft → published → retired
 *
 * No RLS — this is a platform-level table, not tenant data.
 * Access is controlled by API layer permission checks.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export const specialistDnaProfilesTable = pgTable("specialist_dna_profiles", {
  id: text("id").primaryKey(),

  /** Workforce role code, e.g. "chief_of_staff" */
  specialistId: text("specialist_id").notNull(),

  /** Semver version string, e.g. "2.0.0" */
  version: text("version").notNull(),

  /**
   * Publication status.
   *   draft     — under development, not usable for execution
   *   published — active canonical version; only one per specialistId
   *   retired   — superseded; preserved for audit
   */
  status: text("status").notNull().default("draft"),

  /** One-sentence mission statement */
  mission: text("mission").notNull(),

  /** JSON array of string objectives */
  objectives: jsonb("objectives").notNull().default([]),

  /** JSON array of string responsibilities (what the specialist is authorised to do) */
  responsibilities: jsonb("responsibilities").notNull().default([]),

  /** JSON array of string operating principles */
  operatingPrinciples: jsonb("operating_principles").notNull().default([]),

  /**
   * JSON object: { tone: string; detailLevel: string; language: string }
   * language = how the specialist labels itself in conversation
   */
  communicationStyle: jsonb("communication_style").notNull().default({}),

  /** JSON array of escalation rule strings */
  escalationRules: jsonb("escalation_rules").notNull().default([]),

  /** JSON array of prohibited behaviour strings */
  prohibitedBehaviours: jsonb("prohibited_behaviours").notNull().default([]),

  /**
   * JSON object: { allowedScopes: string[]; prohibitedScopes: string[] }
   */
  memoryPolicy: jsonb("memory_policy").notNull().default({}),

  /** Human-readable description of this version's changes */
  changeDescription: text("change_description"),

  /** Platform admin user ID who published this version */
  publishedBy: text("published_by"),

  createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retiredAt:   timestamp("retired_at",   { withTimezone: true }),
});

export type SpecialistDnaProfile   = typeof specialistDnaProfilesTable.$inferSelect;
export type InsertSpecialistDnaProfile = typeof specialistDnaProfilesTable.$inferInsert;
