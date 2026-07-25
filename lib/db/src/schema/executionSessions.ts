/**
 * Execution Sessions — Sprint 8
 *
 * Tracks a single runtime execution session: from submission to the OpenClaw
 * Runtime Broker through to completion, failure, or cancellation.
 *
 * One session is created per approved task that is submitted to a runtime.
 * The session persists the execution package, tracks status transitions, and
 * links to all runtime events received for that execution.
 *
 * RLS: tenant_isolation policy on organization_id.
 */

import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { tasksTable } from "./tasks.js";

export const executionSessionsTable = pgTable("execution_sessions", {
  id: text("id").primaryKey(),

  /** Foreign key to the task this session executes */
  taskId: text("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),

  /** Organisation UUID — RLS tenant boundary */
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Name of the runtime that will execute this session. Default: 'openclaw' */
  runtimeName: text("runtime_name").notNull().default("openclaw"),

  /**
   * The runtime's own identifier for this execution.
   * Null until the broker accepts the package and returns its ID.
   */
  runtimeExecutionId: text("runtime_execution_id"),

  /**
   * Current status of the execution session.
   *
   * Lifecycle:
   *   pending → submitted → accepted → running → completed
   *                                             → failed
   *                                             → cancelled
   *                                             → paused → running
   *                        → awaiting_approval → running
   *             → rejected (broker refused)
   *   pending → expired (TTL exceeded before submission)
   */
  currentStatus: text("current_status").notNull().default("pending"),

  /** The execution package sent (or to be sent) to the runtime. */
  executionPackage: jsonb("execution_package").notNull().default({}),

  /** ISO timestamp when the package was POSTed to the broker. */
  submittedAt: timestamp("submitted_at", { withTimezone: true }),

  /** ISO timestamp when the runtime reported execution started. */
  startedAt: timestamp("started_at", { withTimezone: true }),

  /** ISO timestamp when the session reached a terminal state. */
  completedAt: timestamp("completed_at", { withTimezone: true }),

  /** Error message for failed sessions. */
  errorMessage: text("error_message"),

  /** Arbitrary runtime-specific metadata. */
  metadata: jsonb("metadata").notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExecutionSession = typeof executionSessionsTable.$inferSelect;
export type InsertExecutionSession = typeof executionSessionsTable.$inferInsert;
