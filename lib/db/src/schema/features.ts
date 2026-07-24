/**
 * features table — Sprint 3
 * Registry of all feature codes that can be granted or denied via entitlements.
 * Covers execution capabilities, connectors, workforce packs, and platform features.
 */
import { pgTable, pgEnum, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const featureCategoryEnum = pgEnum("feature_category", [
  "execution_capability",
  "connector",
  "workforce_pack",
  "platform",
]);

export const featuresTable = pgTable("features", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),   // e.g. "execution.browser_session"
  name: text("name").notNull(),
  description: text("description"),
  category: featureCategoryEnum("category").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  /** True if this feature is coming soon and should not be grantable yet */
  isComingSoon: boolean("is_coming_soon").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Feature = typeof featuresTable.$inferSelect;
export type InsertFeature = typeof featuresTable.$inferInsert;
