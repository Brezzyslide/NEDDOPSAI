/**
 * organizations table — Sprint 7.1 update
 *
 * Added: isTestOrganisation, environment
 *
 * is_test_organisation: excludes from billing/analytics/production dashboards.
 * environment: classification ('internal' | 'test' | 'production').
 * Neither field is inferred from name or slug — always set explicitly.
 */
import { pgTable, text, integer, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";

export const orgStatusEnum = pgEnum("org_status", [
  "onboarding",
  "trial",
  "active",
  "past_due",
  "restricted",
  "suspended",
  "closed",
]);

export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "starter",
  "professional",
  "enterprise",
]);

export const organizationsTable = pgTable("organizations", {
  id: text("id").primaryKey(),

  /** Legal or trading name */
  name: text("name").notNull(),

  /** URL-safe display handle (not the security boundary — UUID is) */
  slug: text("slug").notNull().unique(),

  /** Friendly display name (may differ from legal name) */
  displayName: text("display_name"),

  /** Organisation type, e.g. "ndis_provider", "aged_care" */
  type: text("type"),

  industry: text("industry"),
  country: text("country").default("AU"),
  state: text("state"),
  timezone: text("timezone").default("Australia/Sydney"),

  employeeCount: integer("employee_count"),
  participantCount: integer("participant_count"),

  businessPhone: text("business_phone"),
  website: text("website"),
  abn: text("abn"),
  ndisRegistrationNumber: text("ndis_registration_number"),

  primaryContactName: text("primary_contact_name"),
  primaryContactEmail: text("primary_contact_email"),

  /** Preferred data residency region, e.g. "ap-southeast-2" */
  dataRegion: text("data_region").default("ap-southeast-2"),

  status: orgStatusEnum("status").notNull().default("onboarding"),
  subscriptionTier: subscriptionTierEnum("subscription_tier")
    .notNull()
    .default("starter"),

  /**
   * True for test/sandbox organisations.
   * Excluded from billing reports, customer counts, and production analytics.
   * Set explicitly — NEVER inferred from name, slug, or any string matching.
   */
  isTestOrganisation: boolean("is_test_organisation").notNull().default(false),

  /**
   * Environment classification: 'internal' | 'test' | 'production'.
   * Use this field, not name matching, to identify org type.
   */
  environment: text("environment").notNull().default("production"),

  // ── Sprint 9.7 Owner Control Plane ────────────────────────────────────────

  /**
   * When true: all new AI executions and specialist runs are blocked.
   * Existing sessions are allowed to complete unless the org is also suspended.
   * Managed via POST /platform/organisations/:id/freeze-execution and /unfreeze-execution.
   */
  executionFrozen: boolean("execution_frozen").notNull().default(false),

  /** When true: no new logins allowed. Existing sessions remain valid. */
  loginDisabled: boolean("login_disabled").notNull().default(false),

  /** Reason recorded at the time of suspension, for audit and display. */
  suspensionReason: text("suspension_reason"),

  /** Reason recorded at the time of closure. */
  closureReason: text("closure_reason"),

  /** When the org was closed. Null if not closed. */
  closedAt: timestamp("closed_at", { withTimezone: true }),

  /** UserId of the platform staff member who closed the org. */
  closedBy: text("closed_by"),

  /** Last time status changed — populated on every status transition. */
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),

  /** UserId of the platform staff member who last changed status. */
  statusChangedBy: text("status_changed_by"),

  /** Legal name (separate from display name). */
  legalName: text("legal_name"),

  /** Trading name. */
  tradingName: text("trading_name"),

  /** Internal support status: normal | high_priority | vip | flagged */
  supportStatus: text("support_status").notNull().default("normal"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Organization = typeof organizationsTable.$inferSelect;
export type InsertOrganization = typeof organizationsTable.$inferInsert;
