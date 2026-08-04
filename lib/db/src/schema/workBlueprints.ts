/**
 * work_blueprints — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Work Blueprints are the organisational SOPs that define exactly how a
 * specialist executes a piece of professional work. They function like
 * standing operating procedures: objective, required knowledge, validation
 * rules, quality checklist, escalation rules, and success criteria.
 *
 * Built-in blueprints have organizationId = NULL and are visible to all orgs.
 * Org-custom blueprints have organizationId set and are private to that org.
 *
 * Tenant isolation: see RLS note below — NULL org_id rows are accessible to
 * all orgs (built-ins), org rows are tenant-isolated.
 */
import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const WORK_BLUEPRINT_OUTPUT_TYPES = [
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
  "custom",
] as const;
export type WorkBlueprintOutputType = (typeof WORK_BLUEPRINT_OUTPUT_TYPES)[number];

export const workBlueprintsTable = pgTable("work_blueprints", {
  id: text("id").primaryKey(),

  /**
   * NULL for built-in blueprints (visible to all orgs).
   * Set for org-custom blueprints (private to that org).
   */
  organizationId: text("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Stable machine-readable code e.g. "incident_investigation" */
  code: text("code").notNull(),

  /** Human-readable title */
  title: text("title").notNull(),

  /** Semver version of this blueprint definition */
  version: text("version").notNull().default("1.0.0"),

  /** What the specialist must achieve by executing this blueprint */
  objective: text("objective").notNull(),

  /** Specialist code that leads execution */
  primarySpecialist: text("primary_specialist").notNull(),

  /** Additional specialist codes that may be involved */
  supportingSpecialists: jsonb("supporting_specialists")
    .$type<string[]>()
    .notNull()
    .default([]),

  /** Knowledge sourceType values required from the Organisation Library */
  requiredLibraryKnowledge: jsonb("required_library_knowledge")
    .$type<string[]>()
    .notNull()
    .default([]),

  /** Structured entity knowledge requirements (client, staff, etc.) */
  requiredEntityKnowledge: jsonb("required_entity_knowledge")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

  /** Memory types from org memory required for execution */
  requiredMemories: jsonb("required_memories")
    .$type<string[]>()
    .notNull()
    .default([]),

  /** Approval configuration for outputs */
  requiredApprovals: jsonb("required_approvals")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

  /** Validation rules that must pass before execution begins */
  validationRules: jsonb("validation_rules")
    .$type<Array<{ rule: string; required: boolean; description: string }>>()
    .notNull()
    .default([]),

  /** Quality dimensions checked during self-review */
  qualityRules: jsonb("quality_rules")
    .$type<Array<{ dimension: string; weight: number; description: string }>>()
    .notNull()
    .default([]),

  /** Observable success criteria for the completed output */
  successCriteria: jsonb("success_criteria")
    .$type<string[]>()
    .notNull()
    .default([]),

  /** Output type codes this blueprint can produce */
  outputTypes: jsonb("output_types")
    .$type<string[]>()
    .notNull()
    .default([]),

  /** Rules for escalating blocked or failed executions */
  escalationRules: jsonb("escalation_rules")
    .$type<Array<{ trigger: string; action: string }>>()
    .notNull()
    .default([]),

  /** Knowledge types or memory types that must be cited in the output */
  mandatoryCitations: jsonb("mandatory_citations")
    .$type<string[]>()
    .notNull()
    .default([]),

  isBuiltIn: boolean("is_built_in").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),

  /**
   * Blueprint lifecycle status (Sprint 28).
   * Built-ins: "published" (immutable).
   * Org custom: draft → review → published → superseded → archived.
   */
  status: text("status").notNull().default("draft"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
