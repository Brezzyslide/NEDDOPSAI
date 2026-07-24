/**
 * usage_dimensions table — Sprint 3
 * Registry of all usage dimensions that can be metered.
 */
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const usageDimensionsTable = pgTable("usage_dimensions", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),   // e.g. "ai_tasks"
  name: text("name").notNull(),
  unit: text("unit").notNull(),            // e.g. "tasks"
  description: text("description"),
  /** If true, this dimension is counted per billing period (monthly).
   *  If false, it's a point-in-time gauge (e.g. active_users, storage_bytes) */
  isPeriodicCounter: boolean("is_periodic_counter").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UsageDimension = typeof usageDimensionsTable.$inferSelect;
export type InsertUsageDimension = typeof usageDimensionsTable.$inferInsert;
