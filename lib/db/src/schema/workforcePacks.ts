/**
 * workforce_packs table — Sprint 9.6 Dynamic Pricing
 * Added: onboarding config, is_free, pricing_status, fallback_display_text.
 * price_monthly_cents / price_annual_cents retained for backward-compat but
 * DEPRECATED — pricing source of truth is workforce_pack_price_versions.
 */
import { pgTable, text, integer, boolean, smallint, jsonb, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const packTierEnum = pgEnum("pack_tier", [
  "starter",
  "professional",
  "enterprise",
]);

export const packStatusEnum = pgEnum("pack_status", [
  "draft",
  "available",
  "coming_soon",
  "archived",
]);

/** Controls what is displayed publicly when no active price version exists. */
export const packPricingStatusEnum = pgEnum("pack_pricing_status", [
  "not_configured",   // no price set yet — show fallback text
  "free",             // explicitly free — show "Free"
  "contact_sales",    // ask owner to set text — show "Contact NeedsOps"
  "coming_soon",      // price coming — show "Pricing coming soon"
]);

export const workforcePacksTable = pgTable("workforce_packs", {
  id:                   text("id").primaryKey(),
  code:                 text("code").notNull().unique(),
  name:                 text("name").notNull(),
  description:          text("description"),
  marketingTagline:     text("marketing_tagline"),
  industry:             text("industry").notNull(),
  iconEmoji:            text("icon_emoji"),
  colorHex:             text("color_hex"),
  workers:              jsonb("workers").notNull().default([]),
  tier:                 packTierEnum("tier").notNull().default("starter"),
  status:               packStatusEnum("status").notNull().default("draft"),

  // DEPRECATED — use workforce_pack_price_versions instead.
  // Retained for backward-compat; nulled for all non-free packs by migration.
  priceMonthly:         integer("price_monthly_cents"),
  priceAnnual:          integer("price_annual_cents"),
  currency:             text("currency").notNull().default("AUD"),

  displayOrder:         smallint("display_order").notNull().default(0),
  featured:             boolean("featured").notNull().default(false),
  isPubliclyVisible:    boolean("is_publicly_visible").notNull().default(false),

  // ── Dynamic Pricing (Sprint 9.6) ─────────────────────────────────────────
  /** True only for Core Pack and any explicitly zero-price packs. */
  isFree:               boolean("is_free").notNull().default(false),
  /** Controls fallback display when no active price version is present. */
  pricingStatus:        packPricingStatusEnum("pricing_status").notNull().default("not_configured"),
  /** Text shown publicly when pricingStatus = contact_sales | not_configured. */
  fallbackDisplayText:  text("fallback_display_text"),

  // ── Onboarding / trial configuration (owner-controlled) ──────────────────
  /** Auto-grant this pack (status=active) immediately on org creation. */
  autoGrantOnSignup:    boolean("auto_grant_on_signup").notNull().default(false),
  /** Whether new orgs can start a trial of this pack during onboarding. */
  trialEligible:        boolean("trial_eligible").notNull().default(false),
  /** Default trial length in days. Null = not triallable. */
  trialLengthDays:      integer("trial_length_days"),
  /** Pack requires platform staff approval before activation. */
  requiresManualApproval: boolean("requires_manual_approval").notNull().default(false),
  /** Pack requires payment before activation (for future Stripe). */
  requiresPayment:      boolean("requires_payment").notNull().default(false),
  /** Pack is visible in the onboarding picker. */
  publiclySelectable:   boolean("publicly_selectable").notNull().default(true),
  /**
   * Default selection mode shown in onboarding:
   *   included | trial | requested | pending_payment | pending_approval
   */
  selectionMode:        text("selection_mode").notNull().default("trial"),

  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkforcePack = typeof workforcePacksTable.$inferSelect;
export type InsertWorkforcePack = typeof workforcePacksTable.$inferInsert;
