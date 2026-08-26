/**
 * Operational Database Schema — Sprint 6
 *
 * Defines ALL tables that live inside an organisation's Operational Database
 * (or PostgreSQL schema, for the current shared-cluster implementation).
 *
 * These tables are NEVER created in the Platform Database.
 * They are provisioned per-organisation by orgProvisioningService.ts.
 *
 * Usage:
 *   import { createOrgSchema } from "@workspace/org-db";
 *   const { tasks, approvals, memberships } = createOrgSchema("org_3b4f...");
 *
 * Sprint 6 foundation — tables from the shared DB that will migrate here (Sprint 7):
 *   - memberships (local operational copy)
 *   - tenant_settings → org_settings
 *   - tenant_workforce_packs → org_workforce_packs
 *   - tasks
 *   - approvals
 *   - approval_rules
 *   - approval_history
 *   - task_execution_plans
 *   - task_specialists
 *   - org_audit_log
 *
 * Sprint 8 additions (clinical/NDIS):
 *   - participants, participant_contacts, service_agreements
 *   - case_notes, incidents, care_plans
 *   - medications, restrictive_practices, behaviour_support
 *   - rosters, shifts, timesheets
 *   - documents, forms, assessments
 *   - compliance_records, org_reports
 *
 * Sprint 9 additions (AI):
 *   - ai_conversations, ai_retrieval_history
 *   - embeddings, knowledge_base
 *   - connector_configurations, connector_sync_records
 */

import { pgSchema, pgEnum, text, timestamp, jsonb, boolean, integer, bigint } from "drizzle-orm/pg-core";

// ─── Schema factory ───────────────────────────────────────────────────────────

/**
 * Creates a complete set of Drizzle table definitions scoped to the given
 * PostgreSQL schema name. Call once per org schema and cache the result.
 *
 * @param schemaName - PostgreSQL schema name, e.g. "org_3b4ffe73_1234_5678_abcd_ef0123456789"
 */
export function createOrgSchema(schemaName: string) {
  const schema = pgSchema(schemaName);

  // ── Enums (must be created per schema) ─────────────────────────────────────
  const taskStateEnum      = schema.enum("task_state", ["draft","queued","planning","awaiting_approval","evidence_required","approved","executing","completed","cancelled","failed"]);
  const taskPriorityEnum   = schema.enum("task_priority", ["low","normal","high","urgent"]);
  const approvalTypeEnum   = schema.enum("approval_type", ["no_approval","manager_approval","administrator_approval","owner_approval","dual_approval","compliance_approval","platform_approval"]);
  const membershipRoleEnum = schema.enum("membership_role", ["owner","administrator","manager","member","viewer"]);
  const membershipStatusEnum = schema.enum("membership_status", ["active","invited","suspended","revoked"]);

  // ── Local Memberships ───────────────────────────────────────────────────────
  // Operational detail — local roles, permissions, team assignments.
  // Platform DB retains minimal access link (user_id + org_id + active status).
  const orgMemberships = schema.table("org_memberships", {
    id:             text("id").primaryKey(),
    /** User's platform ID — reference only, FK not enforced cross-schema */
    platformUserId: text("platform_user_id").notNull(),
    role:           membershipRoleEnum("role").notNull().default("member"),
    status:         membershipStatusEnum("status").notNull().default("active"),
    /** Local org-specific permissions as JSON */
    permissions:    jsonb("permissions").notNull().default({}),
    /** Clinical access level — e.g. "full", "restricted", "none" */
    clinicalAccess: text("clinical_access").notNull().default("none"),
    /** Whether this member can approve AI-generated clinical outputs */
    canApproveAiOutputs: boolean("can_approve_ai_outputs").notNull().default(false),
    joinedAt:       timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Organisation Settings ───────────────────────────────────────────────────
  const orgSettings = schema.table("org_settings", {
    key:   text("key").primaryKey(),
    value: jsonb("value").notNull(),
    label: text("label"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Workforce Pack Grants ───────────────────────────────────────────────────
  const orgWorkforcePacks = schema.table("org_workforce_packs", {
    id:            text("id").primaryKey(),
    /** Pack code from global catalogue */
    packCode:      text("pack_code").notNull(),
    grantedBy:     text("granted_by"),
    grantedAt:     timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt:     timestamp("revoked_at", { withTimezone: true }),
    revokedBy:     text("revoked_by"),
    revokeReason:  text("revoke_reason"),
    metadata:      jsonb("metadata").notNull().default({}),
  });

  // ── Tasks ────────────────────────────────────────────────────────────────────
  const orgTasks = schema.table("org_tasks", {
    id:                 text("id").primaryKey(),
    title:              text("title").notNull(),
    description:        text("description"),
    originatingUserId:  text("originating_user_id"),
    originatingModule:  text("originating_module"),
    currentState:       taskStateEnum("current_state").notNull().default("draft"),
    priority:           taskPriorityEnum("priority").notNull().default("normal"),
    approvalState:      text("approval_state").notNull().default("not_required"),
    metadata:           jsonb("metadata").notNull().default({}),
    createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Task Execution Plans ─────────────────────────────────────────────────────
  const orgTaskExecutionPlans = schema.table("org_task_execution_plans", {
    id:       text("id").primaryKey(),
    taskId:   text("task_id").notNull().references(() => orgTasks.id, { onDelete: "cascade" }),
    planData: jsonb("plan_data").notNull().default({}),
    version:  text("version").notNull().default("1"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Task Specialists ─────────────────────────────────────────────────────────
  const orgTaskSpecialists = schema.table("org_task_specialists", {
    id:           text("id").primaryKey(),
    taskId:       text("task_id").notNull().references(() => orgTasks.id, { onDelete: "cascade" }),
    specialistId: text("specialist_id").notNull(),
    role:         text("role").notNull().default("executor"),
    assignedAt:   timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Approvals ────────────────────────────────────────────────────────────────
  const orgApprovals = schema.table("org_approvals", {
    id:           text("id").primaryKey(),
    taskId:       text("task_id").notNull().references(() => orgTasks.id, { onDelete: "cascade" }),
    approvalType: approvalTypeEnum("approval_type").notNull(),
    state:        text("state").notNull().default("pending"),
    requestedAt:  timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt:   timestamp("resolved_at", { withTimezone: true }),
    resolvedBy:   text("resolved_by"),
    notes:        text("notes"),
    expiresAt:    timestamp("expires_at", { withTimezone: true }),
    createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Approval Rules ───────────────────────────────────────────────────────────
  const orgApprovalRules = schema.table("org_approval_rules", {
    id:            text("id").primaryKey(),
    approvalType:  approvalTypeEnum("approval_type").notNull(),
    requiredRoles: jsonb("required_roles").notNull().default([]),
    minApprovers:  integer("min_approvers").notNull().default(1),
    maxDaysToApprove: integer("max_days_to_approve").notNull().default(7),
    isActive:      boolean("is_active").notNull().default(true),
    createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:     timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Approval History ─────────────────────────────────────────────────────────
  const orgApprovalHistory = schema.table("org_approval_history", {
    id:          text("id").primaryKey(),
    approvalId:  text("approval_id").notNull().references(() => orgApprovals.id, { onDelete: "cascade" }),
    action:      text("action").notNull(),
    actorUserId: text("actor_user_id"),
    notes:       text("notes"),
    metadata:    jsonb("metadata").notNull().default({}),
    occurredAt:  timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Organisation Audit Log ───────────────────────────────────────────────────
  // The operational audit log for this org — never exposed to platform console in detail.
  const orgAuditLog = schema.table("org_audit_log", {
    id:            text("id").primaryKey(),
    actorUserId:   text("actor_user_id"),
    actorType:     text("actor_type").notNull().default("user"),
    eventType:     text("event_type").notNull(),
    resourceType:  text("resource_type").notNull(),
    resourceId:    text("resource_id"),
    requestId:     text("request_id"),
    ipAddress:     text("ip_address"),
    userAgent:     text("user_agent"),
    accessPurpose: text("access_purpose"),
    isSensitive:   boolean("is_sensitive").notNull().default(false),
    metadata:      jsonb("metadata").notNull().default({}),
    occurredAt:    timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  });

  // ── Sprint 8 placeholders (defined now, tables created when clinical Sprint lands) ──
  // Participants, case notes, incidents, care plans, medications, rosters,
  // documents, AI data, connectors — all declared here for schema awareness.

  return {
    schema,
    orgMemberships,
    orgSettings,
    orgWorkforcePacks,
    orgTasks,
    orgTaskExecutionPlans,
    orgTaskSpecialists,
    orgApprovals,
    orgApprovalRules,
    orgApprovalHistory,
    orgAuditLog,
  };
}

export type OrgSchemaType = ReturnType<typeof createOrgSchema>;
