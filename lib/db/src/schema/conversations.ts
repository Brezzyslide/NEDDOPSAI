/**
 * conversations — Sprint 9
 * A conversation is the persistent collaboration surface for a user + AI workforce.
 * It may be free-form or linked to a formal task.
 */
import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";
import { tasksTable } from "./tasks.js";

export const conversationTypeEnum = pgEnum("conversation_type", [
  "general_workforce",
  "task_workroom",
  "specialist",
  "approval_followup",
  "execution_followup",
]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "active",
  "awaiting_user",
  "awaiting_approval",
  "in_progress",
  "completed",
  "archived",
  "closed",
]);

export const conversationsTable = pgTable("conversations", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id),
  createdByUserId: text("created_by_user_id")
    .references(() => usersTable.id),
  title: text("title"),
  conversationType: conversationTypeEnum("conversation_type")
    .notNull()
    .default("general_workforce"),
  status: conversationStatusEnum("status").notNull().default("active"),
  primaryTaskId: text("primary_task_id")
    .references(() => tasksTable.id),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Conversation = typeof conversationsTable.$inferSelect;
export type InsertConversation = typeof conversationsTable.$inferInsert;
