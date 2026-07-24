/**
 * platform_settings table — Sprint 4
 * Key-value store for global platform configuration.
 * Examples: default_trial_days, default_currency, maintenance_message, branding.
 */
import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const platformSettingsTable = pgTable("platform_settings", {
  key: text("key").primaryKey(),          // e.g. "default_trial_days"
  value: jsonb("value").notNull(),        // Typed value — string, number, boolean, or object
  label: text("label").notNull(),
  description: text("description"),
  /** Who last changed this setting */
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformSetting = typeof platformSettingsTable.$inferSelect;
export type InsertPlatformSetting = typeof platformSettingsTable.$inferInsert;
