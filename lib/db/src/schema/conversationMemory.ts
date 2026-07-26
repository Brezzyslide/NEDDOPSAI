/**
 * conversation_memory — Sprint 9.2
 *
 * Rolling summary and structured memory for a single conversation.
 * One record per conversation. Updated incrementally as messages accumulate.
 * Stores pinned decisions, unresolved questions, and the structured summary.
 * Original messages are NEVER modified or deleted.
 */
import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { conversationsTable } from "./conversations.js";

export const conversationMemoryTable = pgTable("conversation_memory", {
  id:                          text("id").primaryKey(),
  organizationId:              text("organization_id").notNull()
                                 .references(() => organizationsTable.id, { onDelete: "cascade" }),
  conversationId:              text("conversation_id").notNull()
                                 .references(() => conversationsTable.id, { onDelete: "cascade" }),
  summary:                     text("summary").notNull().default(""),
  structuredSummary:           jsonb("structured_summary").notNull().default({}),
  summaryVersion:              integer("summary_version").notNull().default(1),
  summarisedThroughMessageId:  text("summarised_through_message_id"),
  summarisedMessageCount:      integer("summarised_message_count").notNull().default(0),
  unresolvedQuestions:         jsonb("unresolved_questions").notNull().default([]),
  pinnedDecisions:             jsonb("pinned_decisions").notNull().default([]),
  assumptions:                 jsonb("assumptions").notNull().default([]),
  participants:                jsonb("participants").notNull().default([]),
  relatedTaskIds:              jsonb("related_task_ids").notNull().default([]),
  lastUpdatedAt:               timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt:                   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:                   timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConversationMemory       = typeof conversationMemoryTable.$inferSelect;
export type InsertConversationMemory = typeof conversationMemoryTable.$inferInsert;
