/**
 * worker_profiles table — Sprint 2 Architecture Correction
 *
 * A Worker Profile defines what a future OpenClaw runtime may access and do
 * when executing on behalf of a Workforce Role (AI Specialist).
 *
 * These are metadata records only — no live permissions or credentials exist yet.
 * The schema is ready for the future OpenClaw execution layer.
 *
 * Conceptual chain:
 *   Chief of Staff → Workforce Role → Worker Profile → Future OpenClaw Runtime
 */
import { pgTable, pgEnum, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const workerProfileStatusEnum = pgEnum("worker_profile_status", [
  "active",
  "beta",
  "coming_soon",
  "deprecated",
]);

export const workerProfileRiskLevelEnum = pgEnum("worker_profile_risk_level", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const workerProfilesTable = pgTable("worker_profiles", {
  id: text("id").primaryKey(),                          // e.g. "wp_compliance_officer"
  code: text("code").notNull().unique(),                // e.g. "compliance_officer_profile"
  displayName: text("display_name").notNull(),
  description: text("description"),

  // Execution surfaces (jsonb arrays of string enum values)
  allowedExecutionChannels: jsonb("allowed_execution_channels").notNull().default([]),
  allowedToolCategories: jsonb("allowed_tool_categories").notNull().default([]),
  allowedConnectorCategories: jsonb("allowed_connector_categories").notNull().default([]),

  // Future expansion fields — empty arrays until live
  allowedBrowserDomains: jsonb("allowed_browser_domains").notNull().default([]),
  allowedLocalPathCategories: jsonb("allowed_local_path_categories").notNull().default([]),
  allowedApplicationCategories: jsonb("allowed_application_categories").notNull().default([]),

  // Boundary enforcement (intentional, not yet enforced by OpenClaw)
  prohibitedActions: jsonb("prohibited_actions").notNull().default([]),
  approvalRequiredActions: jsonb("approval_required_actions").notNull().default([]),

  riskLevel: workerProfileRiskLevelEnum("risk_level").notNull().default("low"),
  status: workerProfileStatusEnum("status").notNull().default("active"),
  version: text("version").notNull().default("1.0.0"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkerProfileRow = typeof workerProfilesTable.$inferSelect;
export type InsertWorkerProfileRow = typeof workerProfilesTable.$inferInsert;
