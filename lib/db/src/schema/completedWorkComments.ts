/**
 * completed_work_comments — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Review comments attached to a Completed Work item. Used during the
 * approval process and for ongoing editorial feedback.
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { completedWorkTable } from "./completedWork.js";

export const completedWorkCommentsTable = pgTable("completed_work_comments", {
  id: text("id").primaryKey(),

  completedWorkId: text("completed_work_id")
    .notNull()
    .references(() => completedWorkTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Markdown-formatted comment content */
  content: text("content").notNull(),

  authorUserId: text("author_user_id").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
