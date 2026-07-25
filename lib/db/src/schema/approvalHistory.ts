/**
 * approval_history table — Sprint 2
 * Immutable log of every action taken on an approval.
 *
 * Sprint 5: added organization_id for direct tenant ownership (RLS requirement).
 * Direct FK ensures cross-org join attacks cannot retrieve rows; RLS enforces
 * at the database layer.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { approvalsTable } from "./approvals.js";
import { usersTable } from "./users.js";
import { organizationsTable } from "./organizations.js";

export const approvalHistoryTable = pgTable("approval_history", {
  id: text("id").primaryKey(),
  approvalId: text("approval_id")
    .notNull()
    .references(() => approvalsTable.id, { onDelete: "cascade" }),
  /**
   * Sprint 5: direct org ownership — required for RLS.
   * Nullable only during backfill; constraint enforced via migration after backfill.
   */
  organizationId: text("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),   // "requested"|"approved"|"rejected"|"expired"|"commented"
  actorUserId: text("actor_user_id").references(() => usersTable.id),
  notes: text("notes"),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovalHistory = typeof approvalHistoryTable.$inferSelect;
export type InsertApprovalHistory = typeof approvalHistoryTable.$inferInsert;
