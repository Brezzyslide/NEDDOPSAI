import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orgStatusEnum = pgEnum("org_status", [
  "active",
  "suspended",
  "trial",
  "inactive",
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "starter",
  "professional",
  "enterprise",
]);

export const organizationsTable = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industry: text("industry"),
  status: orgStatusEnum("status").notNull().default("trial"),
  subscriptionTier: subscriptionTierEnum("subscription_tier")
    .notNull()
    .default("starter"),
  userCount: integer("user_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertOrganizationSchema = createInsertSchema(organizationsTable)
  .omit({ createdAt: true, updatedAt: true })
  .extend({
    id: z.string().min(1),
    name: z.string().min(2),
    slug: z.string().min(2),
  });

export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;
export type Organization = typeof organizationsTable.$inferSelect;
