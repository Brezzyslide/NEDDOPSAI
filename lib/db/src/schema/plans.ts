/**
 * plans table — Sprint 3
 * Top-level plan definitions (Foundation, Professional, Business, Enterprise).
 * A plan has one or more versions; only one version is active at a time.
 */
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const plansTable = pgTable("plans", {
  id: text("id").primaryKey(),               // e.g. "plan_foundation"
  code: text("code").notNull().unique(),     // e.g. "foundation"
  name: text("name").notNull(),              // e.g. "Foundation"
  description: text("description"),
  isPublic: boolean("is_public").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  displayOrder: text("display_order").notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Plan = typeof plansTable.$inferSelect;
export type InsertPlan = typeof plansTable.$inferInsert;
