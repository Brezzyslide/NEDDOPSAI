/**
 * tenant_entitlements table — Sprint 3
 * Per-org feature entitlement overrides and explicit grants/denials.
 * Rows here take precedence over plan-level features.
 *
 * Sources: subscription (derived), addon, override, trial, explicit_denial.
 */
import { pgTable, pgEnum, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const entitlementStateEnum = pgEnum("entitlement_state", [
  "granted",
  "denied",
]);

export const entitlementSourceEnum = pgEnum("entitlement_source", [
  "subscription",
  "addon",
  "override",
  "trial",
  "explicit_denial",
]);

export const tenantEntitlementsTable = pgTable("tenant_entitlements", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  featureCode: text("feature_code").notNull(),       // e.g. "execution.browser_session"
  state: entitlementStateEnum("state").notNull(),     // granted or denied
  source: entitlementSourceEnum("source").notNull(),
  /** For overrides: why was this granted/denied? */
  reason: text("reason"),
  /** Who created this entitlement (platform admin user id) */
  grantedBy: text("granted_by"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Is this visible to the customer in their plan page? */
  isCustomerVisible: boolean("is_customer_visible").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantEntitlement = typeof tenantEntitlementsTable.$inferSelect;
export type InsertTenantEntitlement = typeof tenantEntitlementsTable.$inferInsert;
