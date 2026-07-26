/**
 * conversation_participants — Sprint 9
 * Who (user or workforce role) has joined a conversation.
 */
import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { conversationsTable } from "./conversations.js";
import { usersTable } from "./users.js";

export const participantTypeEnum = pgEnum("participant_type", [
  "user",
  "workforce_role",
  "worker_profile",
]);

export const conversationParticipantsTable = pgTable("conversation_participants", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversationsTable.id, { onDelete: "cascade" }),
  participantType: participantTypeEnum("participant_type").notNull(),
  userId: text("user_id")
    .references(() => usersTable.id),
  workforceRoleCode: text("workforce_role_code"),
  workerProfileCode: text("worker_profile_code"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp("left_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConversationParticipant = typeof conversationParticipantsTable.$inferSelect;
export type InsertConversationParticipant = typeof conversationParticipantsTable.$inferInsert;
