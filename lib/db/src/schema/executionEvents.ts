/**
 * Execution Events — Sprint 8
 *
 * Persists all runtime events received from or generated for an execution session.
 * Events are the immutable audit trail of everything that happened during an
 * execution — from initial submission acknowledgement through to final result.
 *
 * Events arrive from the OpenClaw Runtime Broker via the webhook endpoint and
 * are stored here before being applied to the execution session's status.
 *
 * RLS: tenant_isolation policy on organization_id.
 */

import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { executionSessionsTable } from "./executionSessions.js";

export const executionEventsTable = pgTable("execution_events", {
  id: text("id").primaryKey(),

  /** Foreign key to the execution session this event belongs to */
  executionSessionId: text("execution_session_id")
    .notNull()
    .references(() => executionSessionsTable.id, { onDelete: "cascade" }),

  /** Organisation UUID — RLS tenant boundary */
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /**
   * The event type.
   *
   * Runtime events (from OpenClaw):
   *   runtime.connected, runtime.disconnected, runtime.unavailable
   *   execution.accepted, execution.started, execution.progress,
   *   execution.paused, execution.resumed, execution.awaiting_approval,
   *   execution.completed, execution.failed, execution.cancelled, execution.expired
   *
   * Platform events (from NeedsOps):
   *   execution.submitted, execution.cancel_requested, execution.pause_requested,
   *   execution.resume_requested
   */
  eventType: text("event_type").notNull(),

  /** Source of the event: 'openclaw' (runtime webhook) or 'platform' (NeedsOps) */
  eventSource: text("event_source").notNull().default("openclaw"),

  /** Event-specific payload */
  payload: jsonb("payload").notNull().default({}),

  /**
   * Whether this event has been applied to the execution session's status.
   * Events are stored immediately on receipt; application to session state
   * happens asynchronously and is idempotent.
   */
  isApplied: boolean("is_applied").notNull().default(false),

  /** ISO timestamp from the event source */
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExecutionEvent = typeof executionEventsTable.$inferSelect;
export type InsertExecutionEvent = typeof executionEventsTable.$inferInsert;
