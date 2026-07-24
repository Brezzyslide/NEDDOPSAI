/**
 * feature_flags table — Sprint 4
 * Platform-controlled feature flags. Toggle capabilities across the platform
 * without deploying code. Never exposed to customer organisations.
 */
import { pgTable, text, boolean, jsonb, timestamp } from "drizzle-orm/pg-core";

export const featureFlagsTable = pgTable("feature_flags", {
  key: text("key").primaryKey(),            // e.g. "maintenance_mode", "new_onboarding"
  label: text("label").notNull(),           // Human-readable label
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  /** Optional context — e.g. { allowedOrgIds: [...] } for partial rollouts */
  context: jsonb("context").default({}),
  /** Who last changed this flag */
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FeatureFlag = typeof featureFlagsTable.$inferSelect;
export type InsertFeatureFlag = typeof featureFlagsTable.$inferInsert;
