/**
 * specialist_runs — Sprint 9.5
 *
 * Tenant-scoped record for each individual specialist AI execution.
 * One row per specialist run attempt. Idempotency key prevents duplicates.
 *
 * RLS: organisation_id must match app.current_organization_id
 */

import {
  pgTable,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const SPECIALIST_RUN_STATUSES = [
  "created",
  "queued",
  "preparing",
  "running",
  "awaiting_clarification",
  "awaiting_approval",
  "waiting_for_dependency",
  "waiting_for_runtime",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;

export type SpecialistRunStatus = (typeof SPECIALIST_RUN_STATUSES)[number];

export const specialistRunsTable = pgTable(
  "specialist_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    conversationId: text("conversation_id"),
    taskId: text("task_id").notNull(),
    executionPlanId: text("execution_plan_id"),
    executionStepId: text("execution_step_id"),
    capabilityDecisionId: text("capability_decision_id"),
    specialistEligibilityDecisionId: text("specialist_eligibility_decision_id"),
    workforceRoleCode: text("workforce_role_code").notNull(),
    workerProfileCode: text("worker_profile_code").notNull(),
    specialistInstructionVersion: text("specialist_instruction_version").notNull(),
    modelProvider: text("model_provider").notNull().default("internal"),
    modelName: text("model_name").notNull().default("internal"),
    status: text("status").notNull().default("created"),
    priority: integer("priority").notNull().default(5),
    attemptNumber: integer("attempt_number").notNull().default(1),
    maximumAttempts: integer("maximum_attempts").notNull().default(3),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    clarificationRequired: boolean("clarification_required").notNull().default(false),
    approvalRequired: boolean("approval_required").notNull().default(false),
    externalExecutionRequired: boolean("external_execution_required").notNull().default(false),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    resultSummary: text("result_summary"),
    resultData: text("result_data"), // JSON stringified SpecialistRunResult
    lastError: text("last_error"),
    runtimeExecutionId: text("runtime_execution_id"),
    idempotencyKey: text("idempotency_key").notNull(),

    // ── Sprint 10: Version record for full reproducibility ───────────────────
    /** DNA profile version used for this run */
    dnaVersion: text("dna_version").notNull().default("N/A"),
    /** Worker profile version */
    workerProfileVersion: text("worker_profile_version").notNull().default("1.0.0"),
    /** Capability registry version */
    capabilityVersion: text("capability_version").notNull().default("1.0.0"),
    /** Reasoning methodology version from the DNA profile */
    reasoningVersion: text("reasoning_version").notNull().default("N/A"),
    /** Output schema version from the DNA profile */
    outputSchemaVersion: text("output_schema_version").notNull().default("N/A"),
    /** AI model version (e.g. "gpt-4o-2024-08-06") */
    modelVersion: text("model_version").notNull().default("internal"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (t) => [
    uniqueIndex("specialist_runs_idempotency_key_idx").on(t.idempotencyKey),
    index("specialist_runs_org_task_idx").on(t.organizationId, t.taskId),
    index("specialist_runs_org_status_idx").on(t.organizationId, t.status),
    index("specialist_runs_task_role_idx").on(t.taskId, t.workforceRoleCode),
  ],
);
