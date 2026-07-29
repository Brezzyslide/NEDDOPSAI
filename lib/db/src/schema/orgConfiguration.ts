/**
 * org_configuration — Platform Completion Sprint
 *
 * Organisation-wide configuration for communication style, terminology,
 * branding, approval thresholds, and AI behaviour preferences.
 * One row per organisation (upsert on organization_id).
 */

import { pgTable, text, integer, boolean, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgConfigurationTable = pgTable("org_configuration", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull().unique(),

  // ── Communication style ────────────────────────────────────────────────────

  /** 'professional' | 'formal' | 'conversational' | 'plain' */
  writingStyle: text("writing_style").notNull().default("professional"),

  /** 'professional' | 'friendly' | 'formal' | 'neutral' */
  tone: text("tone").notNull().default("professional"),

  usePlainEnglish: boolean("use_plain_english").notNull().default(true),

  useAustralianEnglish: boolean("use_australian_english").notNull().default(true),

  /** 'formal' | 'professional' | 'semi_formal' | 'informal' */
  communicationFormality: text("communication_formality").notNull().default("professional"),

  // ── Terminology ────────────────────────────────────────────────────────────

  /** e.g. "Participant" */
  participantTerminology: text("participant_terminology").notNull().default("Participant"),

  /** e.g. "Support Worker" */
  workerTerminology: text("worker_terminology").notNull().default("Support Worker"),

  /** e.g. "NDIS Provider", "Allied Health Practice" */
  organisationTypeLabel: text("organisation_type_label").notNull().default("NDIS Provider"),

  /** Additional custom term mappings stored as JSON object */
  customTerminology: jsonb("custom_terminology").notNull().default(sql`'{}'::jsonb`),

  // ── Formatting ─────────────────────────────────────────────────────────────

  /** e.g. "DD/MM/YYYY" */
  dateFormat: text("date_format").notNull().default("DD/MM/YYYY"),

  /** e.g. "{type}_{participant}_{date}" */
  documentNamingConvention: text("document_naming_convention")
    .notNull()
    .default("{type}_{participant}_{date}"),

  reportHeader: text("report_header"),
  reportFooter: text("report_footer"),

  /** Hex colour e.g. "#1A56DB" */
  brandPrimaryColour: text("brand_primary_colour"),

  // ── Business hours ─────────────────────────────────────────────────────────

  /** HH:MM format e.g. "09:00" */
  businessHoursStart: text("business_hours_start").notNull().default("09:00"),

  /** HH:MM format e.g. "17:00" */
  businessHoursEnd: text("business_hours_end").notNull().default("17:00"),

  // ── Notifications ──────────────────────────────────────────────────────────

  /** 'in_app' | 'email' | 'both' | 'none' */
  notificationPreference: text("notification_preference").notNull().default("both"),

  /** 'in_app' | 'email' */
  preferredCommunicationChannel: text("preferred_communication_channel").notNull().default("email"),

  // ── Approval thresholds (in cents) ────────────────────────────────────────

  /** Amounts below this do not require approval */
  approvalThresholdLow: integer("approval_threshold_low").notNull().default(50000),

  /** Amounts above this require executive approval */
  approvalThresholdHigh: integer("approval_threshold_high").notNull().default(500000),

  escalationContactRole: text("escalation_contact_role"),

  // ── Reporting ─────────────────────────────────────────────────────────────

  /** 'daily' | 'weekly' | 'monthly' | 'never' */
  reportSchedule: text("report_schedule").notNull().default("weekly"),

  /** Whether the organisation has completed initial configuration */
  isConfigured: boolean("is_configured").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgConfiguration = typeof orgConfigurationTable.$inferSelect;
export type InsertOrgConfiguration = typeof orgConfigurationTable.$inferInsert;
