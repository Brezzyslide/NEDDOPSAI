/**
 * message_attachments — Sprint 9
 * File or output attachments linked to a conversation message.
 * Treated as untrusted content; never executed.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { conversationMessagesTable } from "./conversationMessages.js";
import { conversationsTable } from "./conversations.js";

export const messageAttachmentsTable = pgTable("message_attachments", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  messageId: text("message_id")
    .notNull()
    .references(() => conversationMessagesTable.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: text("size_bytes"),          // stored as text to avoid bigint complexity
  storageKey: text("storage_key"),        // object-storage key; null until upload confirmed
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MessageAttachment = typeof messageAttachmentsTable.$inferSelect;
export type InsertMessageAttachment = typeof messageAttachmentsTable.$inferInsert;
