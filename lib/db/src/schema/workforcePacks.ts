/**
 * workforce_packs table — Sprint 9.6 Pack Commerce
 * Added: code, pricing, display metadata, publicly_visible flag
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
  priceMonthly:         integer("price_monthly_cents"),
  priceAnnual:          integer("price_annual_cents"),
  currency:             text("currency").notNull().default("AUD"),
  displayOrder:         smallint("display_order").notNull().default(0),
  featured:             boolean("featured").notNull().default(false),
  isPubliclyVisible:    boolean("is_publicly_visible").notNull().default(false),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:            timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkforcePack = typeof workforcePacksTable.$inferSelect;
export type InsertWorkforcePack = typeof workforcePacksTable.$inferInsert;
