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
  boolean,
} from "drizzle-orm/pg-core";

export const specialistDnaProfilesTable = pgTable("specialist_dna_profiles", {
  id: text("id").primaryKey(),

  /** Workforce role code, e.g. "chief_of_staff" */
  specialistId: text("specialist_id").notNull(),

  /** Semver version string, e.g. "2.0.0" */
  version: text("version").notNull(),

  /**
   * Publication status.
   *   draft               — under development, not usable for execution
   *   professional_review — awaiting professional review
   *   approved            — approved, but not live
   *   published           — active canonical version; only one per specialistId
   *   retired             — withdrawn or replaced by a newer published version;
   *                         preserved for audit and linked by supersedes/previousVersion
   */
  status: text("status").notNull().default("draft"),

  /** Stable canonical DNA ID. Defaults to specialistId for platform DNA. */
  dnaId: text("dna_id"),

  /** SHA-256 hash of the immutable canonical DNA version. */
  versionHash: text("version_hash"),

  /** platform | organisation */
  ownerType: text("owner_type").notNull().default("platform"),

  /** public_descriptor | tenant_admin_descriptor | platform_private */
  visibilityTier: text("visibility_tier").notNull().default("platform_private"),

  /** Whether this DNA requires professional review before publication. */
  professionalReviewRequired: boolean("professional_review_required").notNull().default(false),

  /** Platform admin/professional approver ID, where applicable. */
  approvedBy: text("approved_by"),

  /** Human-readable reason for this version/change. */
  changeReason: text("change_reason"),

  /** When this version becomes effective. */
  effectiveFrom: timestamp("effective_from", { withTimezone: true }),

  /** Previous DNA version, if any. */
  previousVersion: text("previous_version"),

  /** DNA version superseded by this version, if any. */
  supersedes: text("supersedes"),

  /** Migration notes and historical compatibility notes. */
  migrationNotes: jsonb("migration_notes").notNull().default([]),

  /** Full canonical WorkforceDNA profile. Platform-private. */
  canonicalProfile: jsonb("canonical_profile"),

  /** Runtime projection rules used for this DNA version. */
  runtimeProjection: jsonb("runtime_projection"),

  /** True once this version is published and should be treated as immutable. */
  immutablePublishedSnapshot: boolean("immutable_published_snapshot").notNull().default(false),

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

  createdAt:   timestamp("created_at",   { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retiredAt:   timestamp("retired_at",   { withTimezone: true }),
});

export type SpecialistDnaProfile   = typeof specialistDnaProfilesTable.$inferSelect;
export type InsertSpecialistDnaProfile = typeof specialistDnaProfilesTable.$inferInsert;
