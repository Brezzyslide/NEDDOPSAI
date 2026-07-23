/**
 * organizations table — Sprint 1 update
 *
 * Added: displayName, type, country, state, timezone, employeeCount,
 * participantCount, businessPhone, website, abn, ndisRegistrationNumber,
 * primaryContactName, primaryContactEmail, dataRegion.
 * Updated status enum: onboarding | active | suspended | closed.
 */
import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const orgStatusEnum = pgEnum("org_status", [
  "onboarding",
  "active",
  "suspended",
  "closed",
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "starter",
  "professional",
  "enterprise",
]);

export const organizationsTable = pgTable("organizations", {
  id: text("id").primaryKey(),

  /** Legal or trading name */
  name: text("name").notNull(),

  /** URL-safe display handle (not the security boundary — UUID is) */
  slug: text("slug").notNull().unique(),

  /** Friendly display name (may differ from legal name) */
  displayName: text("display_name"),

  /** Organisation type, e.g. "ndis_provider", "aged_care" */
  type: text("type"),

  industry: text("industry"),
  country: text("country").default("AU"),
  state: text("state"),
  timezone: text("timezone").default("Australia/Sydney"),

  employeeCount: integer("employee_count"),
  participantCount: integer("participant_count"),

  businessPhone: text("business_phone"),
  website: text("website"),
  abn: text("abn"),
  ndisRegistrationNumber: text("ndis_registration_number"),

  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),

  /** Preferred data residency region, e.g. "ap-southeast-2" */
  dataRegion: text("data_region").default("ap-southeast-2"),

  status: orgStatusEnum("status").notNull().default("onboarding"),
  subscriptionTier: subscriptionTierEnum("subscription_tier")
    .notNull()
    .default("starter"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Organization = typeof organizationsTable.$inferSelect;
export type InsertOrganization = typeof organizationsTable.$inferInsert;
