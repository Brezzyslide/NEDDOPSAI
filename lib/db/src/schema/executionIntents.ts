/**
 * execution_intents — Sprint 10
 *
 * Prepared execution intents produced by specialists after completing their
 * Work Packages. These intents describe WHAT should happen (open browser,
 * navigate, download, upload, submit) without performing the action.
 *
 * The intents will be consumed by OpenClaw in a future sprint.
 * All judgement stays inside NeedsOps — OpenClaw only handles the mechanics.
 *
 * RLS: organisation_id must match app.current_organization_id
 */

import {
  pgTable,
  text,
  jsonb,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const EXECUTION_INTENT_TYPES = [
  "open_browser",
  "navigate_to_url",
  "download_file",
  "upload_document",
  "submit_form",
  "read_table",
  "generate_report",
  "send_notification",
  "create_record",
  "update_record",
  "read_record",
  "export_data",
  "run_script",
  "api_call",
] as const;

export type ExecutionIntentType = (typeof EXECUTION_INTENT_TYPES)[number];

export const EXECUTION_INTENT_STATUSES = [
  "prepared",
  "pending_approval",
  "approved",
  "dispatched",
  "completed",
  "rejected",
  "cancelled",
] as const;

export type ExecutionIntentStatus = (typeof EXECUTION_INTENT_STATUSES)[number];

export const executionIntentsTable = pgTable(
  "execution_intents",
  {
    id: text("id").primaryKey(),

    /** Tenant owner */
    organizationId: text("organization_id").notNull(),

    /** The specialist run that produced this intent */
    specialistRunId: text("specialist_run_id").notNull(),

    /** The task this intent belongs to */
    taskId: text("task_id").notNull(),

    /** Type of execution action required */
    intentType: text("intent_type").notNull(),

    /**
     * Human-readable description of what this intent will do.
     * Example: "Navigate to the NDIS portal and download the audit report for Q3 2026"
     */
    description: text("description").notNull(),

    /**
     * Execution channel: browser, document, api, terminal, desktop
     * This maps to the OpenClaw execution channel.
     */
    executionChannel: text("execution_channel").notNull(),

    /** Tool category: browser_automation, document_reader, form_submitter, etc. */
    toolCategory: text("tool_category").notNull(),

    /** Optional connector: ndis_portal, document_storage, etc. */
    connectorCategory: text("connector_category"),

    /**
     * Risk level assessed by the specialist.
     * Determines whether human approval is required before dispatching.
     */
    riskLevel: text("risk_level").notNull().default("medium"),

    /** Whether human approval is required before OpenClaw executes this intent */
    approvalRequired: boolean("approval_required").notNull().default(true),

    /** Sequence within the specialist run (lower = earlier) */
    sequenceOrder: integer("sequence_order").notNull().default(1),

    /**
     * Parameters for the intent — specific to the intent type.
     * Example: { url: "https://ndiscommission.gov.au/...", targetFile: "audit_report_q3_2026.pdf" }
     */
    parameters: jsonb("parameters").notNull().default({}),

    /** Current status of this intent */
    status: text("status").notNull().default("prepared"),

    /** Who approved this intent (user ID) */
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    /** Who rejected this intent, if rejected */
    rejectedBy: text("rejected_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    /** When dispatched to OpenClaw */
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),

    /** OpenClaw execution ID once dispatched */
    openClawExecutionId: text("openclaw_execution_id"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
  },
  (t) => [
    index("execution_intents_run_idx").on(t.specialistRunId),
    index("execution_intents_task_idx").on(t.taskId),
    index("execution_intents_org_status_idx").on(t.organizationId, t.status),
    index("execution_intents_pending_approval_idx").on(t.organizationId, t.approvalRequired, t.status),
  ],
);

export type ExecutionIntent = typeof executionIntentsTable.$inferSelect;
export type InsertExecutionIntent = typeof executionIntentsTable.$inferInsert;
