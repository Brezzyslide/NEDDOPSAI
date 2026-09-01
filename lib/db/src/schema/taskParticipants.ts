import { pgTable, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { participantsTable } from "./participants.js";
import { tasksTable } from "./tasks.js";

export const taskParticipantRoles = [
  "subject",
  "related",
  "guardian_context",
] as const;

export type TaskParticipantRole = (typeof taskParticipantRoles)[number];

export const taskParticipantsTable = pgTable(
  "task_participants",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasksTable.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participantsTable.id, { onDelete: "restrict" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("task_participants_task_participant_role_unique").on(t.taskId, t.participantId, t.role),
    index("task_participants_org_task_idx").on(t.organizationId, t.taskId),
    index("task_participants_org_participant_idx").on(t.organizationId, t.participantId),
  ],
);

export type TaskParticipant = typeof taskParticipantsTable.$inferSelect;
export type InsertTaskParticipant = typeof taskParticipantsTable.$inferInsert;
