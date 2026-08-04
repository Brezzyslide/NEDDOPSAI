/**
 * organisation_provisioning_jobs
 *
 * Tracks each platform-initiated org provisioning run.
 * Steps are stored as a JSON blob; each key is a step name and the value is:
 *   { status: "pending" | "running" | "completed" | "failed", error?: string }
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const orgProvisioningJobsTable = pgTable("organisation_provisioning_jobs", {
  id: text("id").primaryKey(),

  /**
   * Nullable until create_org step completes.
   * Set to the org id once the organisation row exists.
   */
  organizationId: text("organization_id")
    .references(() => organizationsTable.id),

  /** Platform staff userId who triggered the provisioning */
  initiatedBy: text("initiated_by").notNull(),

  /** overall status: pending | running | completed | failed */
  status: text("status").notNull().default("pending"),

  /**
   * Per-step status map, e.g.:
   * { create_org: { status: "completed" },
   *   provision_packs: { status: "failed", error: "..." } }
   */
  steps: jsonb("steps").notNull().default({}),

  /** Human-readable failure message if status === "failed" */
  errorMessage: text("error_message"),

  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgProvisioningJob = typeof orgProvisioningJobsTable.$inferSelect;
export type InsertOrgProvisioningJob = typeof orgProvisioningJobsTable.$inferInsert;
