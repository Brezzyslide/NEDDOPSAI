/**
 * capabilities table — Sprint 2
 * Named actions that a specialist can perform.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const capabilitiesTable = pgTable("capabilities", {
  id: text("id").primaryKey(),          // e.g. "review_policy"
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Capability = typeof capabilitiesTable.$inferSelect;
export type InsertCapability = typeof capabilitiesTable.$inferInsert;
