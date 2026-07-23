/**
 * tasks table — Sprint 2
 * Platform-wide task entity. Execution is simulated.
 */
import { pgTable, pgEnum, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const taskStateEnum = pgEnum("task_state", [
  "draft",
  "queued",
  "planning",
  "awaiting_approval",
  "approved",
  "executing",
  "completed",
  "cancelled",
  "failed",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "normal",
  "high",
  "urgent",
]);

export const approvalTypeEnum = pgEnum("approval_type", [
  "no_approval",
  "manager_approval",
  "administrator_approval",
  "owner_approval",
  "dual_approval",
  "compliance_approval",
  "platform_approval",
]);

export const tasksTable = pgTable("tasks", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  originatingUserId: text("originating_user_id").references(() => usersTable.id),
  originatingModule: text("originating_module"),         // e.g. "dashboard", "task_centre"
  currentState: taskStateEnum("current_state").notNull().default("draft"),
  priority: taskPriorityEnum("priority").notNull().default("normal"),
  approvalState: text("approval_state").notNull().default("not_required"), // mirrors approval_type
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Task = typeof tasksTable.$inferSelect;
export type InsertTask = typeof tasksTable.$inferInsert;
