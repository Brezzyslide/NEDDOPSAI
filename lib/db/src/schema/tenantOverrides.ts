/**
 * tenant_overrides table — Sprint 3
 * Platform admin overrides for individual organisations.
 * Every override is audited and must include a reason and effective dates.
 */
import { pgTable, pgEnum, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const overrideTypeEnum = pgEnum("override_type", [
  "extra_seats",
  "workforce_pack",
  "extra_usage",
  "execution_capability",
  "connector_access",
  "feature_denial",
  "trial_extension",
]);

export const tenantOverridesTable = pgTable("tenant_overrides", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  overrideType: overrideTypeEnum("override_type").notNull(),
  /** Flexible value — e.g. { seats: 5 }, { packCode: "marketing" }, { featureCode: "..." } */
  value: jsonb("value").notNull().default({}),
  reason: text("reason").notNull(),
  internalNote: text("internal_note"),
  customerNote: text("customer_note"),
  /** Platform admin who created this override */
  createdBy: text("created_by").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  revokeReason: text("revoke_reason"),
  auditEventId: text("audit_event_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantOverride = typeof tenantOverridesTable.$inferSelect;
export type InsertTenantOverride = typeof tenantOverridesTable.$inferInsert;
