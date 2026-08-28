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
import { pgTable, text, timestamp, boolean, jsonb, integer } from "drizzle-orm/pg-core";
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

export const BLUEPRINT_MATURITY_STATES = [
  "placeholder",
  "draft",
  "professional_review",
  "production_ready",
  "superseded",
] as const;
export type BlueprintMaturityState = (typeof BLUEPRINT_MATURITY_STATES)[number];

export const BLUEPRINT_OWNER_TYPES = [
  "platform_owned",
  "organisation_owned",
] as const;
export type BlueprintOwnerType = (typeof BLUEPRINT_OWNER_TYPES)[number];

export const BLUEPRINT_MISSING_EVIDENCE_BEHAVIOURS = [
  "clarification_required",
  "continue_with_flagged_gaps",
  "block_completion",
  "not_applicable_allowed",
] as const;
export type BlueprintMissingEvidenceBehaviour = (typeof BLUEPRINT_MISSING_EVIDENCE_BEHAVIOURS)[number];

export interface BlueprintDeliverableContract {
  primaryDeliverable: string;
  secondaryDeliverables?: string[];
  allowedInternalAnalysis?: string[];
  prohibitedDeliverables?: string[];
  artifactRequired?: boolean;
  primaryFormat?: string;
  secondaryFormats?: string[];
  namingConvention?: string;
  templateRequired?: boolean;
  completionRequirements?: string[];
}

export interface BlueprintEvidenceContract {
  requiredEvidenceCategories?: string[];
  optionalEvidenceCategories?: string[];
  allowedSourceTypes?: string[];
  restrictedSourceTypes?: string[];
  requiredEntityTypes?: string[];
  minimumEvidenceCount?: number;
  freshnessRules?: Record<string, unknown>;
  claimIntegrityRequired?: boolean;
  missingEvidenceBehaviour?: BlueprintMissingEvidenceBehaviour;
}

export interface BlueprintPermittedOrgOverrides {
  templateSubstitution?: boolean;
  outputFormatPreferences?: boolean;
  namingConvention?: boolean;
  approvalWorkflow?: boolean;
}

export const BLUEPRINT_TEMPLATE_VERSION_POLICIES = [
  "pin_at_execution",
  "use_latest",
] as const;
export type BlueprintTemplateVersionPolicy = (typeof BLUEPRINT_TEMPLATE_VERSION_POLICIES)[number];

export const BLUEPRINT_SECTION_ROLES = [
  "internal_method",
  "user_facing",
] as const;
export type BlueprintSectionRole = (typeof BLUEPRINT_SECTION_ROLES)[number];

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

  /** Canonical work-product family, e.g. care_plan */
  blueprintFamily: text("blueprint_family"),

  /** Supported execution modes, e.g. ["create", "review", "revise"] */
  supportedModes: jsonb("supported_modes")
    .$type<string[]>()
    .notNull()
    .default([]),

  /** Professional maturity; distinct from lifecycle publication status */
  maturityState: text("maturity_state")
    .$type<BlueprintMaturityState>()
    .notNull()
    .default("placeholder"),

  /** Platform-owned or organisation-owned */
  ownerType: text("owner_type")
    .$type<BlueprintOwnerType>()
    .notNull()
    .default("platform_owned"),

  /** Tenant-safe purpose summary */
  purpose: text("purpose"),

  /** Primary deliverable code/name */
  primaryDeliverable: text("primary_deliverable"),

  deliverableContract: jsonb("deliverable_contract")
    .$type<BlueprintDeliverableContract | null>(),

  evidenceContract: jsonb("evidence_contract")
    .$type<BlueprintEvidenceContract | null>(),

  permittedOrgOverrides: jsonb("permitted_org_overrides")
    .$type<BlueprintPermittedOrgOverrides>()
    .notNull()
    .default({}),

  defaultTemplateId: text("default_template_id"),
  templateRequired: boolean("template_required").notNull().default(false),
  allowedOrgTemplateOverride: boolean("allowed_org_template_override").notNull().default(false),
  templateVersionPolicy: text("template_version_policy")
    .$type<BlueprintTemplateVersionPolicy>()
    .notNull()
    .default("pin_at_execution"),

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

export const blueprintSectionsTable = pgTable("blueprint_sections", {
  id: text("id").primaryKey(),

  blueprintId: text("blueprint_id")
    .notNull()
    .references(() => workBlueprintsTable.id, { onDelete: "cascade" }),

  sectionCode: text("section_code").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  instructions: text("instructions"),
  sectionRole: text("section_role")
    .$type<BlueprintSectionRole>(),
  required: boolean("required").notNull().default(false),
  minimumContentExpectation: text("minimum_content_expectation"),
  evidenceRequirements: jsonb("evidence_requirements")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  allowedSourceTypes: jsonb("allowed_source_types")
    .$type<string[]>()
    .notNull()
    .default([]),
  prohibitedAssumptions: jsonb("prohibited_assumptions")
    .$type<string[]>()
    .notNull()
    .default([]),
  validationRules: jsonb("validation_rules")
    .$type<Array<{ rule: string; required: boolean; description: string }>>()
    .notNull()
    .default([]),
  qualityCriteria: jsonb("quality_criteria")
    .$type<Array<{ criterion: string; description: string }>>()
    .notNull()
    .default([]),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const WORK_TEMPLATE_TYPES = [
  "docx",
  "pdf",
  "markdown",
  "html",
  "synthetic_test",
] as const;
export type WorkTemplateType = (typeof WORK_TEMPLATE_TYPES)[number];

export const workTemplatesTable = pgTable("work_templates", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  ownerType: text("owner_type")
    .$type<BlueprintOwnerType>()
    .notNull()
    .default("platform_owned"),
  code: text("code").notNull(),
  title: text("title").notNull(),
  version: text("version").notNull().default("1.0.0"),
  status: text("status").notNull().default("draft"),
  maturityState: text("maturity_state")
    .$type<BlueprintMaturityState>()
    .notNull()
    .default("placeholder"),
  templateType: text("template_type")
    .$type<WorkTemplateType>()
    .notNull(),
  sourceFileReference: text("source_file_reference"),
  mimeType: text("mime_type"),
  mergeFieldSchema: jsonb("merge_field_schema")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blueprintIntentMappingsTable = pgTable("blueprint_intent_mappings", {
  id: text("id").primaryKey(),
  canonicalIntent: text("canonical_intent").notNull(),
  blueprintFamily: text("blueprint_family").notNull(),
  blueprintMode: text("blueprint_mode").notNull(),
  blueprintId: text("blueprint_id")
    .notNull()
    .references(() => workBlueprintsTable.id, { onDelete: "cascade" }),
  organizationId: text("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
