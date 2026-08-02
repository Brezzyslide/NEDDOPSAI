/**
 * specialist_language_profiles — Sprint Knowledge Bridge (Task #14)
 *
 * Per-organisation, per-specialist structured language and style settings.
 * Stored separately from document knowledge to allow independent updates.
 *
 * Tenant isolation enforced by RLS on organization_id.
 *
 * PLATFORM CONTROL RULES:
 * Language profiles MAY customise: locale, tone, preferred terms, prohibited
 * terms, date/time format, output structure.
 * Language profiles MUST NOT override: prohibited behaviours, compliance rules,
 * approval requirements, or anything in the platform DNA.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const specialistLanguageProfilesTable = pgTable(
  "specialist_language_profiles",
  {
    id: text("id").primaryKey(),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),

    /** Workforce role code, e.g. "chief_of_staff" */
    specialistId: text("specialist_id").notNull(),

    /**
     * BCP 47 locale code, e.g. "en-AU", "en-GB", "en-US".
     * Controls spelling convention defaults.
     */
    locale: text("locale").notNull().default("en"),

    /**
     * Spelling convention: "australian", "british", "american", "canadian".
     * Overrides locale default when set.
     */
    spellingConvention: text("spelling_convention"),

    /**
     * Tone guidance, e.g. "professional", "friendly-professional",
     * "formal", "concise-direct". Must remain within bounds
     * allowed by the specialist's DNA communicationStyle.
     */
    tone: text("tone"),

    /**
     * Formality level: "formal" | "semi-formal" | "conversational".
     */
    formality: text("formality"),

    /**
     * Organisation-preferred terminology.
     * JSON array of { term: string; preferred: string; notes?: string }.
     * Example: [{ term: "ticket", preferred: "incident", notes: "Internal usage" }]
     */
    preferredTerms: jsonb("preferred_terms").notNull().default([]),

    /**
     * Terms the specialist must avoid using.
     * JSON array of { term: string; reason?: string }.
     */
    prohibitedTerms: jsonb("prohibited_terms").notNull().default([]),

    /**
     * Preferred date format description, e.g. "DD/MM/YYYY", "Month D, YYYY".
     */
    dateFormat: text("date_format"),

    /**
     * Preferred time format description, e.g. "12-hour", "24-hour".
     */
    timeFormat: text("time_format"),

    /**
     * Heading style preferences, e.g. "Title Case", "Sentence case".
     */
    headingPreferences: text("heading_preferences"),

    /**
     * Sentence length preference: "concise" | "standard" | "detailed".
     */
    sentenceLengthPreference: text("sentence_length_preference"),

    /**
     * Preferred output structure description, e.g. "Use numbered lists for
     * procedures, bullet points for summaries, bold for key terms."
     */
    outputStructure: text("output_structure"),

    /** ISO timestamp when this profile was last reviewed by the org */
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type SpecialistLanguageProfile       = typeof specialistLanguageProfilesTable.$inferSelect;
export type InsertSpecialistLanguageProfile = typeof specialistLanguageProfilesTable.$inferInsert;
