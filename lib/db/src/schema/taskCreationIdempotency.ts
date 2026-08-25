/**
 * task_creation_idempotency_keys
 *
 * Durable creation ledger for canonical task creation requests. This prevents
 * concurrent retries with the same idempotency scope from creating duplicate
 * task rows while still allowing explicit separate work to use a new key.
 */
import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { tasksTable } from "./tasks.js";

export const taskCreationIdempotencyTable = pgTable("task_creation_idempotency_keys", {
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id"),
  workIntentKey: text("work_intent_key"),
  title: text("title").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({
    name: "task_creation_idempotency_keys_pk",
    columns: [table.organizationId, table.scope, table.idempotencyKey],
  }),
  taskIdx: index("idx_task_creation_idempotency_task_id").on(table.taskId),
  conversationIntentIdx: index("idx_task_creation_idempotency_conversation_intent")
    .on(table.organizationId, table.conversationId, table.workIntentKey),
}));

export type TaskCreationIdempotency = typeof taskCreationIdempotencyTable.$inferSelect;
export type InsertTaskCreationIdempotency = typeof taskCreationIdempotencyTable.$inferInsert;
