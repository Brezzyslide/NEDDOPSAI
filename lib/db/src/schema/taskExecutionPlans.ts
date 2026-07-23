/**
 * task_execution_plans — Sprint 2
 * The Chief of Staff's plan for how a task will be executed.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks.js";

export const taskExecutionPlansTable = pgTable("task_execution_plans", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  planData: jsonb("plan_data").notNull().default({}),
  // planData shape: { steps: ExecutionStep[], estimatedDuration: string, requiresApproval: bool, approvalType: ApprovalType }
  version: text("version").notNull().default("1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskExecutionPlan = typeof taskExecutionPlansTable.$inferSelect;
export type InsertTaskExecutionPlan = typeof taskExecutionPlansTable.$inferInsert;
