/**
 * org_company_profile table — Sprint 14 (Business Discovery)
 *
 * Structured company profile assembled from discovery answers.
 * Consumed by AI agents to personalise their work.
 *
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const orgCompanyProfileTable = pgTable("org_company_profile", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Free-text description of what the company does */
  description: text("description"),

  /** JSON array of primary service strings */
  primaryServices: text("primary_services").notNull().default("[]"),

  staffCount: integer("staff_count"),
  clientCount: integer("client_count"),

  crmName: text("crm_name"),
  crmUrl: text("crm_url"),
  emailPlatform: text("email_platform"),
  accountingSystem: text("accounting_system"),
  hrSystem: text("hr_system"),
  projectManagementSystem: text("project_management_system"),

  /** Where the team normally finds company knowledge (google_drive|sharepoint|intranet|other) */
  knowledgeSource: text("knowledge_source"),
  knowledgeUrl: text("knowledge_url"),

  /** JSON: { monday: { open: "09:00", close: "17:00" }, … } */
  businessHours: text("business_hours"),

  /** JSON array: [{ name, address, timezone }] */
  locations: text("locations").notNull().default("[]"),

  /** Schema version — increments on every update */
  version: integer("version").notNull().default(1),

  lastConfirmedAt: timestamp("last_confirmed_at", { withTimezone: true }),
  confirmedByUserId: text("confirmed_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgCompanyProfile = typeof orgCompanyProfileTable.$inferSelect;
export type InsertOrgCompanyProfile = typeof orgCompanyProfileTable.$inferInsert;
