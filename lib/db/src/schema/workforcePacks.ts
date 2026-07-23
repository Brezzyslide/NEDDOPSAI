import { pgTable, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

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
  description: text("description").notNull(),
  industry: text("industry").notNull(),
  // workers stored as JSONB array: { id, name, role, description, capabilities[] }
  workers: jsonb("workers").notNull().default([]),
  tier: packTierEnum("tier").notNull().default("starter"),
  status: packStatusEnum("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertWorkforcePackSchema = createInsertSchema(workforcePacksTable)
  .omit({ createdAt: true })
  .extend({
    id: z.string().min(1),
    name: z.string().min(2),
    description: z.string().min(1),
    industry: z.string().min(1),
  });

export type InsertWorkforcePack = z.infer<typeof insertWorkforcePackSchema>;
export type WorkforcePack = typeof workforcePacksTable.$inferSelect;
