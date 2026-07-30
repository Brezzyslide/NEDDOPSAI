/**
 * org_discovery_answers table — Sprint 14 (Business Discovery)
 *
 * Stores individual answers from the Business Discovery wizard.
 * One row per question per org. Upserted on re-submission.
 *
 * Sources: user_input | auto_detected | imported
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const orgDiscoveryAnswersTable = pgTable("org_discovery_answers", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Screen key, e.g. "company_overview", "work_systems", "approvals" */
  screenKey: text("screen_key").notNull(),

  /** Question key, e.g. "crm_name", "email_platform" */
  questionKey: text("question_key").notNull(),

  /**
   * JSON-serialised answer value.
   * Can be: string, string[], number, { text, confirmed }, etc.
   */
  answerValue: text("answer_value"),

  /** user_input | auto_detected | imported */
  answerSource: text("answer_source").notNull().default("user_input"),

  answeredByUserId: text("answered_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),

  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),

  skipped: boolean("skipped").notNull().default(false),
  skipReason: text("skip_reason"),

  /** Increments on each update — for conflict detection */
  version: integer("version").notNull().default(1),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgDiscoveryAnswer = typeof orgDiscoveryAnswersTable.$inferSelect;
export type InsertOrgDiscoveryAnswer = typeof orgDiscoveryAnswersTable.$inferInsert;
