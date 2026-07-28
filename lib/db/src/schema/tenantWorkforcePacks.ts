/**
 * tenant_workforce_packs table — Sprint 9.6 Dynamic Pricing
 * Extended with: status, priceVersionId, trial dates, activatedAt,
 * requestedBy, approvedBy; source enum extended with new access sources.
 */
import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const packGrantSourceEnum = pgEnum("pack_grant_source", [
  "subscription",
  "addon",
  "override",
  "trial",
  "onboarding_trial",
  "manual_grant",
  "individual_purchase",
  "enterprise_contract",
  "tenant_override",
  "core_auto",         // Core Pack granted automatically on org creation
]);

export const tenantPackStatusEnum = pgEnum("tenant_pack_status", [
  "active",
  "trial",
  "requested",
  "pending_payment",
  "pending_approval",
  "expired",
  "cancelled",
  "revoked",
]);

export const tenantWorkforcePacksTable = pgTable("tenant_workforce_packs", {
  id:             text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  packCode:       text("pack_code").notNull(),
  source:         packGrantSourceEnum("source").notNull(),
  grantedBy:      text("granted_by"),
  reason:         text("reason"),
  grantedAt:      timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt:      timestamp("expires_at", { withTimezone: true }),
  revokedAt:      timestamp("revoked_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // ── Sprint 9.6 additions ──────────────────────────────────────────────────
  /** Current access state for this pack assignment. */
  status:         tenantPackStatusEnum("tenant_pack_status").notNull().default("active"),
  /** Price version this grant is locked to (null = not yet assigned / free). */
  priceVersionId: text("price_version_id"),
  /** When a trial started (null if not a trial). */
  trialStartedAt: timestamp("trial_started_at", { withTimezone: true }),
  /** When a trial ends (null if not a trial). */
  trialEndsAt:    timestamp("trial_ends_at", { withTimezone: true }),
  /** When this grant became fully active (post-trial or immediate). */
  activatedAt:    timestamp("activated_at", { withTimezone: true }),
  /** User id who requested this pack (onboarding or plan page). */
  requestedBy:    text("requested_by"),
  /** Platform staff user id who approved this grant. */
  approvedBy:     text("approved_by"),
});

export type TenantWorkforcePack = typeof tenantWorkforcePacksTable.$inferSelect;
export type InsertTenantWorkforcePack = typeof tenantWorkforcePacksTable.$inferInsert;
