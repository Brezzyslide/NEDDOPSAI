/**
 * workforce_packs table — unchanged from Sprint 0
 */
import { pgTable, text, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const packTierEnum = pgEnum("pack_tier", [
  "starter",
  "professional",
  "enterprise",
]);

export const packStatusEnum = pgEnum("pack_status", [
  "available",
  "coming_soon",
]);

export const workforcePacksTable = pgTable("workforce_packs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  industry: text("industry").notNull(),
  workers: jsonb("workers").notNull().default([]),
  tier: packTierEnum("tier").notNull().default("starter"),
  status: packStatusEnum("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkforcePack = typeof workforcePacksTable.$inferSelect;
export type InsertWorkforcePack = typeof workforcePacksTable.$inferInsert;
