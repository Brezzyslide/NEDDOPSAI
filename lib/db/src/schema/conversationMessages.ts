/**
 * conversation_messages — Sprint 9
 * Every message in a conversation — user, AI, system, runtime events.
 */
import { pgTable, pgEnum, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";
import { conversationsTable } from "./conversations.js";
import { tasksTable } from "./tasks.js";

export const messageSenderTypeEnum = pgEnum("message_sender_type", [
  "user",
  "chief_of_staff",
  "workforce_role",
  "runtime",
  "system",
]);

export const messageTypeEnum = pgEnum("message_type", [
  "text",
  "question",
  "clarification_request",
  "task_proposal",
  "task_created",
  "plan_proposal",
  "plan_revision",
  "delegation",
  "progress",
  "status_change",
  "approval_request",
  "approval_decision",
  "execution_update",
  "warning",
  "error",
  "output",
  "result",
  "follow_up",
  "system_notice",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "delivered",
  "read",
  "failed",
]);

export const conversationMessagesTable = pgTable("conversation_messages", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  taskId: text("task_id")
    .references(() => tasksTable.id),
  senderType: messageSenderTypeEnum("sender_type").notNull(),
  senderUserId: text("sender_user_id")
    .references(() => usersTable.id),
  workforceRoleCode: text("workforce_role_code"),   // e.g. "compliance_officer"
  workerProfileCode: text("worker_profile_code"),   // e.g. "prof_compliance_01"
  messageType: messageTypeEnum("message_type").notNull().default("text"),
  content: text("content").notNull(),
  structuredContent: jsonb("structured_content"),   // typed payload — see conversationIntelligenceService
  parentMessageId: text("parent_message_id"),       // for threaded replies
  correlationId: text("correlation_id"),            // links runtime events → messages
  status: messageStatusEnum("status").notNull().default("delivered"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConversationMessage = typeof conversationMessagesTable.$inferSelect;
export type InsertConversationMessage = typeof conversationMessagesTable.$inferInsert;
