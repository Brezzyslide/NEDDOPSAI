/**
 * completed_work — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * The permanent record of a specialist execution. Every piece of professional
 * work produced by the AI Workforce lands here as a Completed Work item.
 *
 * Completed Work is distinct from the Organisation Library. However, authorised
 * users may promote suitable Completed Work into the Library as an approved
 * example, template, policy, or procedure via the existing approval workflow.
 *
 * Lifecycle: draft → awaiting_approval → approved
 *                  ↘ rejected
 *            approved → archived | superseded
 *            rejected → reopened → (awaiting_approval)
 *
 * Tenant isolation enforced by RLS on organization_id.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const COMPLETED_WORK_STATUSES = [
  "draft",
  "awaiting_approval",
  "approved",
  "rejected",
  "archived",
  "superseded",
  "reopened",
] as const;
export type CompletedWorkStatus = (typeof COMPLETED_WORK_STATUSES)[number];

export const COMPLETED_WORK_OUTPUT_TYPES = [
  "incident_investigation",
  "risk_assessment",
  "behaviour_support_plan",
  "care_plan",
  "meeting_minutes",
  "operational_procedure",
  "policy_draft",
  "executive_brief",
  "investigation_report",
  "performance_review",
  "project_plan",
  "action_plan",
  "customer_response",
  "business_proposal",
  "general_output",
  "custom",
] as const;
export type CompletedWorkOutputType = (typeof COMPLETED_WORK_OUTPUT_TYPES)[number];

export const completedWorkTable = pgTable("completed_work", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** The conversation that generated this work (if any) */
  conversationId: text("conversation_id"),

  /** Blueprint used to govern execution */
  blueprintId: text("blueprint_id"),

  /** Work Package Manifest for this execution */
  manifestId: text("manifest_id"),

  /** Specialist that produced the output */
  primarySpecialist: text("primary_specialist").notNull(),

  /** Human-readable title of the work item */
  title: text("title").notNull(),

  /** Category of output produced */
  outputType: text("output_type").notNull().default("general_output"),

  /** Current lifecycle status */
  status: text("status").notNull().default("draft"),

  /** ID of the current active version in completed_work_versions */
  currentVersionId: text("current_version_id"),

  /**
   * ID of the exact version that was signed off when status moved to "approved".
   * Pinned at the moment of approval and never updated by subsequent revisions or
   * restores. This is the canonical approved artefact — export and viewer resolve
   * to this version when status is "approved".
   */
  approvedVersionId: text("approved_version_id"),

  /** Approval workflow configuration (approver roles, required count, etc.) */
  approvalWorkflow: jsonb("approval_workflow")
    .$type<Record<string, unknown>>()
    .default({}),

  createdByUserId: text("created_by_user_id").notNull(),
  approvedByUserId: text("approved_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),

  /** ID of the superseding work item when this is superseded */
  supersededById: text("superseded_by_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
