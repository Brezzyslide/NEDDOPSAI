/**
 * execution_actions — Sprint 29F.1 (Connector Hardening)
 *
 * Persists the full lifecycle of every ExecutionAction from proposal through
 * final outcome. One row per action; status transitions are recorded as column
 * updates. A lifecycle history is implicitly visible in audit events; this table
 * is the authoritative state record.
 *
 * Design decisions:
 *   • Not a replacement for execution_intents — that table tracks OpenClaw-style
 *     browser/navigation/API intents; this table tracks typed connector write
 *     actions (files, Word, Excel, email draft) from the Unified Execution Engine.
 *   • idempotency_key is stored here so the server-side dedup store can be
 *     reconstructed from the DB on cold start.
 *   • parameters_summary stores only a summary (no raw file content, no prompts,
 *     no credentials) — the full parameters live in the in-flight relay message.
 *   • RLS: organisation_id must match app.current_organization_id (tenant isolation).
 *
 * Required status values (Part 2 brief):
 *   proposed → awaiting_approval → approved → executing → completed
 *                                            ↳ rejected
 *                                            ↳ failed
 *                                            ↳ cancelled
 */

import {
  pgTable,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const EXECUTION_ACTION_STATUSES = [
  "proposed",
  "awaiting_approval",
  "approved",
  "rejected",
  "executing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type ExecutionActionStatus = (typeof EXECUTION_ACTION_STATUSES)[number];

export const executionActionsTable = pgTable(
  "execution_actions",
  {
    // ── Identity ──────────────────────────────────────────────────────────────
    id:               text("id").primaryKey(),
    executionId:      text("execution_id").notNull(),
    organisationId:   text("organisation_id").notNull(),
    conversationId:   text("conversation_id"),
    taskId:           text("task_id"),

    // ── Specialist ───────────────────────────────────────────────────────────
    specialistCode:   text("specialist_code").notNull(),

    // ── Action description ───────────────────────────────────────────────────
    actionType:       text("action_type").notNull(),
    target:           text("target"),
    /** JSON summary of action parameters — never includes raw file content or secrets */
    parametersSummary: jsonb("parameters_summary"),
    riskLevel:        text("risk_level").notNull().default("medium"),
    approvalRequired: boolean("approval_required").notNull().default(true),

    // ── Principals ──────────────────────────────────────────────────────────
    requestedBy:      text("requested_by"),
    approvedBy:       text("approved_by"),
    rejectedBy:       text("rejected_by"),

    // ── Connector / session ──────────────────────────────────────────────────
    connectorDeviceId: text("connector_device_id"),
    sessionId:         text("session_id"),
    idempotencyKey:    text("idempotency_key"),

    // ── Status ───────────────────────────────────────────────────────────────
    status: text("status")
      .notNull()
      .default("proposed"),

    // ── Timestamps ───────────────────────────────────────────────────────────
    proposedAt:          timestamp("proposed_at",           { withTimezone: true }).notNull(),
    approvedAt:          timestamp("approved_at",           { withTimezone: true }),
    rejectedAt:          timestamp("rejected_at",           { withTimezone: true }),
    executionStartedAt:  timestamp("execution_started_at",  { withTimezone: true }),
    completedAt:         timestamp("completed_at",          { withTimezone: true }),
    failedAt:            timestamp("failed_at",             { withTimezone: true }),
    cancelledAt:         timestamp("cancelled_at",          { withTimezone: true }),

    // ── Results ──────────────────────────────────────────────────────────────
    /** JSON summary of the connector result — no raw file content */
    resultSummary:   jsonb("result_summary"),
    /** Structured error from connector or dispatch layer */
    errorDetails:    jsonb("error_details"),

    // ── Correlation ──────────────────────────────────────────────────────────
    correlationId:   text("correlation_id"),

    // ── Record metadata ──────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("execution_actions_execution_id_idx").on(table.executionId),
    index("execution_actions_organisation_id_idx").on(table.organisationId),
    index("execution_actions_status_idx").on(table.status),
    index("execution_actions_idempotency_key_idx").on(table.idempotencyKey),
  ],
);
