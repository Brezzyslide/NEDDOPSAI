/**
 * task_execution_plans — Sprint 2
 * The Chief of Staff's plan for how a task will be executed.
 *
 * Sprint 5: added organization_id for direct tenant ownership (RLS requirement).
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks.js";
import { organizationsTable } from "./organizations.js";

export const taskExecutionPlansTable = pgTable("task_execution_plans", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  /**
   * Sprint 5: direct org ownership — required for RLS.
   * Nullable only during backfill; constraint enforced via migration after backfill.
   */
  organizationId: text("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  planData: jsonb("plan_data").notNull().default({}),
  version: text("version").notNull().default("1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskExecutionPlan = typeof taskExecutionPlansTable.$inferSelect;
export type InsertTaskExecutionPlan = typeof taskExecutionPlansTable.$inferInsert;
