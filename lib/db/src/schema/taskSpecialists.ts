/**
 * task_specialists — Sprint 2
 * Which specialists are assigned to a task.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks.js";
import { specialistsTable } from "./specialists.js";

export const taskSpecialistsTable = pgTable("task_specialists", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  specialistId: text("specialist_id")
    .notNull()
    .references(() => specialistsTable.id),
  role: text("role").notNull().default("executor"),       // "lead" | "executor" | "reviewer"
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskSpecialist = typeof taskSpecialistsTable.$inferSelect;
export type InsertTaskSpecialist = typeof taskSpecialistsTable.$inferInsert;
