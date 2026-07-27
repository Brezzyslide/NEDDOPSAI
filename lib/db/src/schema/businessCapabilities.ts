/**
 * business_capabilities — Sprint 9.4
 *
 * Platform-managed canonical capability registry.
 * Mirrors the static TypeScript registry in capabilityRegistry.ts but allows
 * platform staff to manage versions, overrides, and new capabilities without
 * a code deployment.
 *
 * The TypeScript static registry is the AUTHORITATIVE allowlist used at
 * runtime. This table is used for:
 *   - Platform Console management and editing
 *   - Audit trail of changes to capability definitions
 *   - Future: dynamic capability loading when hot-deploy is needed
 *
 * RLS: rows are platform-managed (not tenant-scoped).
 * Platform Console: full CRUD for authorised platform staff.
 * Every change is audited via platform_audit_log.
 */
import {
  pgTable,
  text,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

export const capabilityCategoryEnum = pgEnum("capability_category", [
  "compliance",
  "quality",
  "policy",
  "incident",
  "operations",
  "service_delivery",
  "roster",
  "human_resources",
  "staff_compliance",
  "learning",
  "finance",
  "accounting",
  "payroll",
  "invoicing",
  "budgeting",
  "reporting",
  "marketing",
  "communications",
  "documents",
  "research",
  "calendar",
  "administration",
]);

export const capabilityLevelEnum = pgEnum("capability_level_enum", [
  "general_information",
  "professional_analysis",
  "execution",
]);

export const capabilityStatusEnum = pgEnum("capability_status_enum", [
  "active",
  "beta",
  "coming_soon",
  "deprecated",
]);

export const businessCapabilitiesTable = pgTable("business_capabilities", {
  id: text("id").primaryKey(),

  /** Canonical code, e.g. "accounting.bas_preparation" */
  code: text("code").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),

  category: capabilityCategoryEnum("category").notNull(),

  /** Which workforce pack provides this capability. NULL = core (all plans). */
  packCode: text("pack_code"),

  /** Specialist codes eligible to perform this capability */
  eligibleRoles: jsonb("eligible_roles").$type<string[]>().notNull().default([]),

  /** Worker profile codes required (empty = any) */
  requiredWorkerProfiles: jsonb("required_worker_profiles").$type<string[]>().notNull().default([]),

  /** Execution channel codes required for execution level */
  requiredExecutionChannels: jsonb("required_execution_channels").$type<string[]>().notNull().default([]),

  /** Connector category codes required for execution level */
  requiredConnectorCategories: jsonb("required_connector_categories").$type<string[]>().notNull().default([]),

  defaultRiskLevel: text("default_risk_level").notNull().default("medium"),

  defaultApprovalRequired: boolean("default_approval_required").notNull().default(false),

  /** General information may be provided without the owning pack */
  informationAllowed: boolean("information_allowed").notNull().default(true),

  /** Professional analysis requires the owning pack */
  analysisAllowed: boolean("analysis_allowed").notNull().default(true),

  /** Execution requires pack + execution channel + connector + approval */
  executionAllowed: boolean("execution_allowed").notNull().default(false),

  status: capabilityStatusEnum("status").notNull().default("active"),

  version: text("version").notNull().default("1.0"),

  effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});

export type BusinessCapabilityRow = typeof businessCapabilitiesTable.$inferSelect;
export type InsertBusinessCapabilityRow = typeof businessCapabilitiesTable.$inferInsert;
