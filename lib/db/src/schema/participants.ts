import { pgTable, text, timestamp, unique, index, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const participantStatusValues = [
  "active",
  "inactive",
  "archived",
] as const;

export const participantsTable = pgTable(
  "participants",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    preferredName: text("preferred_name"),
    externalParticipantId: text("external_participant_id"),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("participants_org_status_idx").on(t.organizationId, t.status),
    index("participants_org_name_idx").on(t.organizationId, t.displayName),
    unique("participants_org_external_unique").on(t.organizationId, t.externalParticipantId),
  ],
);

export type Participant = typeof participantsTable.$inferSelect;
export type InsertParticipant = typeof participantsTable.$inferInsert;
