/**
 * tenant_subscriptions table — Sprint 3
 * One subscription record per organisation — the authoritative source for
 * what plan and version the org is on.
 *
 * Sprint 3: manually managed (no Stripe). Sprint 4+: Stripe-driven.
 */
import { pgTable, pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { plansTable } from "./plans.js";
import { planVersionsTable } from "./planVersions.js";

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "suspended",
  "cancelled",
  "trial",
  "trial_expired",
  "past_due",
]);

export const tenantSubscriptionsTable = pgTable("tenant_subscriptions", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  planId: text("plan_id")
    .notNull()
    .references(() => plansTable.id, { onDelete: "restrict" }),
  planVersionId: text("plan_version_id")
    .notNull()
    .references(() => planVersionsTable.id, { onDelete: "restrict" }),
  status: subscriptionStatusEnum("status").notNull().default("trial"),
  /** Billing period — set by Stripe in Sprint 4+, manually set now for dev */
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  trialStartAt: timestamp("trial_start_at", { withTimezone: true }),
  trialEndAt: timestamp("trial_end_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  /** Internal note from platform admin e.g. "Manual dev subscription" */
  internalNote: text("internal_note"),
  /** Platform admin who last changed this subscription */
  changedBy: text("changed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantSubscription = typeof tenantSubscriptionsTable.$inferSelect;
export type InsertTenantSubscription = typeof tenantSubscriptionsTable.$inferInsert;
