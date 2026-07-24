/**
 * tenant_workforce_packs table — Sprint 3
 * Which workforce packs an organisation has active, and why.
 * Derived from: subscription plan + addons + platform overrides.
 */
import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const packGrantSourceEnum = pgEnum("pack_grant_source", [
  "subscription",
  "addon",
  "override",
  "trial",
]);

export const tenantWorkforcePacksTable = pgTable("tenant_workforce_packs", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  packCode: text("pack_code").notNull(),               // e.g. "compliance"
  source: packGrantSourceEnum("source").notNull(),
  grantedBy: text("granted_by"),                       // platform admin user id if override
  reason: text("reason"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantWorkforcePack = typeof tenantWorkforcePacksTable.$inferSelect;
export type InsertTenantWorkforcePack = typeof tenantWorkforcePacksTable.$inferInsert;
