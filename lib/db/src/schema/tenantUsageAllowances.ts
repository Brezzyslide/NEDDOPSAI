/**
 * tenant_usage_allowances table — Sprint 3
 * Per-org usage allowance overrides set by platform admins.
 * These override the plan version's default allowances for the org.
 */
import { pgTable, text, bigint, real, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const tenantUsageAllowancesTable = pgTable("tenant_usage_allowances", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  dimensionCode: text("dimension_code").notNull(),
  /** null = unlimited. bigint supports byte counts up to ~9.2 exabytes. */
  hardLimit: bigint("hard_limit", { mode: "number" }),
  softLimitPct: real("soft_limit_pct").default(80.0),
  source: text("source").notNull().default("override"),  // override, addon
  reason: text("reason"),
  grantedBy: text("granted_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantUsageAllowance = typeof tenantUsageAllowancesTable.$inferSelect;
export type InsertTenantUsageAllowance = typeof tenantUsageAllowancesTable.$inferInsert;
