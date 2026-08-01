/**
 * organisation_specialist_configuration table — Sprint SRM Hardening (Phase 3+5)
 *
 * Per-organisation customisation layer for specialist behaviour.
 * Applied on top of the canonical platform DNA profile at manifest compile time.
 *
 * Tenant isolation enforced by RLS on organization_id.
 *
 * PLATFORM CONTROL RULES:
 * Tenant configuration MUST NOT override:
 *   - prohibited_behaviours
 *   - hard compliance boundaries
 *   - escalation_rules
 *   - workerProfile permissions
 *   - approval requirements
 *   - entitlement rules
 *
 * Tenant configuration MAY customise:
 *   - goals
 *   - tone (within allowed bounds)
 *   - organisation context (business type, services, hours, timezone)
 *   - escalation contacts (person names only — no credentials)
 *   - approved knowledge sources (names — not credentials)
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const organisationSpecialistConfigTable = pgTable(
  "organisation_specialist_configuration",
  {
    id: text("id").primaryKey(),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),

    /** Workforce role code, e.g. "chief_of_staff" */
    specialistId: text("specialist_id").notNull(),

    /**
     * First-week goals provided during Business Discovery.
     * JSON array of string goal descriptions.
     */
    goals: jsonb("goals").notNull().default([]),

    /**
     * Preferred tone override (if blank, DNA default is used).
     * Platform validates this is within allowedTones for the specialist.
     */
    preferredStyle: text("preferred_style"),

    /**
     * Named escalation contacts — person names and roles only.
     * JSON array of { name: string; role: string } objects.
     * Never include email, phone, tokens, or credentials.
     */
    escalationContacts: jsonb("escalation_contacts").notNull().default([]),

    /**
     * Additional organisation context for this specialist.
     * JSON object: { businessType, services, operatingHours, timezone, systems }
     * Never include credentials, file paths, or cross-tenant data.
     */
    additionalContext: jsonb("additional_context").notNull().default({}),

    /**
     * How this configuration was created.
     * Values: "business_discovery" | "manual" | "api" | "migration"
     */
    source: text("source").notNull().default("manual"),

    /** ISO timestamp when this configuration was last confirmed by the org */
    lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type OrganisationSpecialistConfig   = typeof organisationSpecialistConfigTable.$inferSelect;
export type InsertOrganisationSpecialistConfig = typeof organisationSpecialistConfigTable.$inferInsert;
