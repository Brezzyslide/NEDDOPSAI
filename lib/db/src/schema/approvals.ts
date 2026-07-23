/**
 * approvals table — Sprint 2
 * An approval instance tied to a task.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks.js";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";
import { approvalTypeEnum } from "./tasks.js";

export const approvalStateEnum2 = text("approval_state_col"); // helper reference — not used as column directly

export const approvalsTable = pgTable("approvals", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id),
  approvalType: approvalTypeEnum("approval_type").notNull(),
  state: text("state").notNull().default("pending"),       // pending | approved | rejected | expired
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by").references(() => usersTable.id),
  notes: text("notes"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Approval = typeof approvalsTable.$inferSelect;
export type InsertApproval = typeof approvalsTable.$inferInsert;
