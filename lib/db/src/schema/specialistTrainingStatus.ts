/**
 * specialist_training_status — Task #15 (Knowledge Schema, Scopes & Secure Upload)
 *
 * Per-organisation, per-specialist training readiness state machine.
 * Tracks whether a specialist has been configured, has approved knowledge,
 * has passed retrieval testing, and has been cleared for live work.
 *
 * WEB-FIRST: This table works entirely through the web application.
 * Desktop connector access is an additional capability, NOT a dependency.
 * All training actions (upload, approve, test, clear) are available via API.
 *
 * Status machine:
 *   not_started
 *     → configuring        (org begins configuring the specialist)
 *     → knowledge_processing  (sources uploaded, awaiting extraction — Task #16)
 *     → review_required    (extraction complete, needs human review)
 *     → testing            (retrieval test running — Task #17)
 *     → ready              (approved for live work — owner/admin only)
 *     → needs_attention    (regression detected — any status can transition here)
 *     → suspended          (admin override — billing, compliance, etc.)
 *
 * Approval restriction: only org owner or admin may transition to 'ready'.
 *
 * Tenant isolation enforced by RLS on organization_id.
 * Unique constraint: (organizationId, specialistId) — one record per specialist.
 */
import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const specialistTrainingStatusTable = pgTable("specialist_training_status", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Workforce role code e.g. "chief_of_staff", "operations_manager" */
  specialistId: text("specialist_id").notNull(),

  /**
   * Current training readiness status.
   * not_started | configuring | knowledge_processing | review_required |
   * testing | ready | needs_attention | suspended
   */
  status: text("status").notNull().default("not_started"),

  /** Whether specialist configuration (goals, style, contacts) is complete */
  configurationComplete: boolean("configuration_complete").notNull().default(false),

  /** Whether at least one knowledge source is approved and scoped to this specialist */
  knowledgeSourcesApproved: boolean("knowledge_sources_approved").notNull().default(false),

  /**
   * Whether a retrieval test has been run and passed.
   * Populated by Task #17 when hybrid retrieval is active.
   */
  retrievalTestPassed: boolean("retrieval_test_passed").notNull().default(false),

  /**
   * Whether a sample task has been completed successfully.
   * Populated by Task #18 training UI.
   */
  sampleTaskPassed: boolean("sample_task_passed").notNull().default(false),

  /**
   * The owner/admin user who approved this specialist for 'ready' status.
   * NULL until status = 'ready'.
   */
  approvedByUserId: text("approved_by_user_id"),

  /** When the 'ready' approval was granted */
  approvedAt: timestamp("approved_at", { withTimezone: true }),

  /** When this specialist's training readiness was last tested */
  lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),

  /** Reviewer comments, blockers, or notes on the current status */
  notes: text("notes"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SpecialistTrainingStatus       = typeof specialistTrainingStatusTable.$inferSelect;
export type InsertSpecialistTrainingStatus = typeof specialistTrainingStatusTable.$inferInsert;

export const TRAINING_STATUSES = [
  "not_started",
  "configuring",
  "knowledge_processing",
  "review_required",
  "testing",
  "ready",
  "needs_attention",
  "suspended",
] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

/**
 * Valid status transitions.
 * Any status can transition to needs_attention or suspended (admin override).
 */
export const TRAINING_STATUS_TRANSITIONS: Record<TrainingStatus, TrainingStatus[]> = {
  not_started:           ["configuring"],
  configuring:           ["knowledge_processing", "needs_attention", "suspended"],
  knowledge_processing:  ["review_required", "needs_attention", "failed" as never, "suspended"],
  review_required:       ["testing", "configuring", "needs_attention", "suspended"],
  testing:               ["ready", "review_required", "needs_attention", "suspended"],
  ready:                 ["needs_attention", "suspended"],
  needs_attention:       ["configuring", "review_required", "testing", "suspended"],
  suspended:             ["configuring"],
};
