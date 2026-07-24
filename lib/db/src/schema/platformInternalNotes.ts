/**
 * platform_internal_notes table — Sprint 3
 * Support notes added by platform staff on organisations.
 * Internal notes are NEVER visible to customer users.
 */
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const platformInternalNotesTable = pgTable("platform_internal_notes", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "set null" }),
  isInternal: boolean("is_internal").notNull().default(true),
  /** Has this note flagged the org for review? */
  isFlagged: boolean("is_flagged").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformInternalNote = typeof platformInternalNotesTable.$inferSelect;
export type InsertPlatformInternalNote = typeof platformInternalNotesTable.$inferInsert;
