/**
 * tenant_settings table — Sprint 1
 *
 * One row per organisation. Created automatically when an org is created.
 */
import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const tenantSettingsTable = pgTable("tenant_settings", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" })
    .unique(),

  timezone: text("timezone").default("Australia/Sydney"),
  locale: text("locale").default("en-AU"),
  dateFormat: text("date_format").default("DD/MM/YYYY"),
  timeFormat: text("time_format").default("HH:mm"),
  defaultCurrency: text("default_currency").default("AUD"),

  /** Industry vertical for this tenant (may differ from parent org's industry) */
  industry: text("industry"),

  /** Preferred data residency region */
  dataRegion: text("data_region").default("ap-southeast-2"),

  /** Email address for security notifications */
  securityNotificationEmail: text("security_notification_email"),

  /**
   * Organisation branding placeholder.
   * Sprint 3+: full branding config (logo URL, primary colour, etc.)
   */
  brandingConfig: text("branding_config"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type TenantSettings = typeof tenantSettingsTable.$inferSelect;
export type InsertTenantSettings = typeof tenantSettingsTable.$inferInsert;
