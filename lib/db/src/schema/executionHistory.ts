/**
 * execution_history — Platform Completion Sprint
 *
 * Append-only audit log of every significant execution event.
 * No updated_at — rows are never modified after insert.
 */

import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const executionHistoryTable = pgTable("execution_history", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** Execution graph identifier */
  graphId: text("graph_id").notNull(),

  /** FK to tasks */
  taskId: text("task_id"),

  /** FK to specialist_runs */
  specialistRunId: text("specialist_run_id"),

  /**
   * 'graph_created' | 'node_started' | 'node_completed' | 'node_failed' |
   * 'connector_invoked' | 'intent_dispatched' | 'approval_requested' |
   * 'output_contract_received' | 'consolidation_started' |
   * 'graph_completed' | 'graph_failed'
   */
  eventType: text("event_type").notNull(),

  /**
   * 'system' | 'chief_of_staff' | 'specialist' | 'connector' |
   * 'user' | 'approval_service'
   */
  actorType: text("actor_type").notNull(),

  actorId: text("actor_id"),

  /** Event-specific payload data */
  payload: jsonb("payload").default({}),

  /** Immutable — set at insert time, never updated */
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type ExecutionHistory = typeof executionHistoryTable.$inferSelect;
export type InsertExecutionHistory = typeof executionHistoryTable.$inferInsert;
