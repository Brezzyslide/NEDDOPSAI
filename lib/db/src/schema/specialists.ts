/**
 * specialists table — Sprint 2
 * Each row describes one AI specialist worker.
 */
import { pgTable, pgEnum, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { workforcePacksTable } from "./workforcePacks.js";

export const specialistExecutionStatusEnum = pgEnum("specialist_execution_status", [
  "available",
  "beta",
  "coming_soon",
  "deprecated",
  "dna_pending",  // Sprint 11: catalogue entry exists but DNA not yet approved
  "archived",     // Sprint 11: fully retired, hidden everywhere
]);

export const specialistsTable = pgTable("specialists", {
  id: text("id").primaryKey(),                              // e.g. "chief_of_staff"
  code: text("code").notNull().unique(),                    // machine-readable code
  displayName: text("display_name").notNull(),
  packId: text("pack_id").references(() => workforcePacksTable.id),
  description: text("description"),
  icon: text("icon"),                                       // emoji or icon name
  colour: text("colour"),                                   // hex colour
  requiredPermissions: jsonb("required_permissions").notNull().default([]),
  requiredEntitlements: jsonb("required_entitlements").notNull().default([]),
  approvalRequirements: text("approval_requirements").notNull().default("no_approval"),
  executionStatus: specialistExecutionStatusEnum("execution_status").notNull().default("available"),
  version: text("version").notNull().default("1.0.0"),
  // ── Sprint 11: Workforce catalogue streamlining ──────────────────────────────
  /** ISO timestamp when this role was deprecated */
  deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
  /** Who triggered the deprecation (migration ID or user ID) */
  deprecatedBy: text("deprecated_by"),
  /** Human-readable reason for deprecation */
  deprecationReason: text("deprecation_reason"),
  /** Role code of the replacement employee, if any */
  replacementRoleCode: text("replacement_role_code"),
  /** How this role was retired: merged | renamed | capability_distribution | none */
  replacementType: text("replacement_type").notNull().default("none"),
  /** Department: executive | compliance_governance | operations | finance | people_culture | marketing | shared_professional_services */
  departmentCode: text("department_code"),
  /** Display order within department (lower = first) */
  displayOrder: text("display_order").notNull().default("99"),
  /** Catalogue version this entry was last updated in */
  catalogueVersion: text("catalogue_version").notNull().default("1"),
  /** DNA design status: approved | pending_design | not_applicable */
  dnaStatus: text("dna_status").notNull().default("pending_design"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Specialist = typeof specialistsTable.$inferSelect;
export type InsertSpecialist = typeof specialistsTable.$inferInsert;
