/**
 * execution_graph_nodes — Platform Completion Sprint
 *
 * Tracks the execution graph for a specialist run chain.
 * Each node represents a discrete unit of work within a graph.
 * graph_id groups all nodes belonging to one execution graph (usually = task_id).
 */

import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const executionGraphNodesTable = pgTable("execution_graph_nodes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** Groups all nodes for one execution graph — usually equals task_id */
  graphId: text("graph_id").notNull(),

  /** FK to tasks */
  taskId: text("task_id"),

  /** FK to specialist_runs */
  specialistRunId: text("specialist_run_id"),

  /**
   * 'intent' | 'specialist_run' | 'connector_call' |
   * 'approval_gate' | 'consolidation'
   */
  nodeType: text("node_type").notNull(),

  /**
   * pending | active | completed | failed | skipped | waiting
   */
  status: text("status").default("pending"),

  /** Array of node IDs this node depends on */
  dependsOnNodeIds: jsonb("depends_on_node_ids").default([]),

  resultSummary: text("result_summary"),

  errorMessage: text("error_message"),

  startedAt: timestamp("started_at", { withTimezone: true }),

  completedAt: timestamp("completed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type ExecutionGraphNode = typeof executionGraphNodesTable.$inferSelect;
export type InsertExecutionGraphNode = typeof executionGraphNodesTable.$inferInsert;
