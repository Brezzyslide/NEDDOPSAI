/**
 * message_reads — Sprint 9
 * Tracks which users have read which messages (for unread counts / badges).
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { conversationMessagesTable } from "./conversationMessages.js";
import { usersTable } from "./users.js";

export const messageReadsTable = pgTable("message_reads", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id),
  messageId: text("message_id")
    .notNull()
    .references(() => conversationMessagesTable.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MessageRead = typeof messageReadsTable.$inferSelect;
export type InsertMessageRead = typeof messageReadsTable.$inferInsert;
