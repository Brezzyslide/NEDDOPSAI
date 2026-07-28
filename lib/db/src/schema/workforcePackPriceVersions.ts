/**
 * workforce_pack_price_versions — Sprint 9.6 Dynamic Pricing
 * Versioned pricing for workforce packs. One record per price version per pack.
 * Only one version can be `is_current = true` per pack per currency at a time.
 * Active prices carry status = 'active' and is_current = true.
 */
import { pgTable, pgEnum, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { workforcePacksTable } from "./workforcePacks.js";

export const priceVersionStatusEnum = pgEnum("price_version_status", [
  "draft",
  "scheduled",
  "active",
  "superseded",
  "archived",
]);

export const workforcePackPriceVersionsTable = pgTable("workforce_pack_price_versions", {
  id:                 text("id").primaryKey(),
  workforcePackId:    text("workforce_pack_id").notNull().references(() => workforcePacksTable.id, { onDelete: "cascade" }),
  versionNumber:      integer("version_number").notNull().default(1),
  monthlyPriceCents:  integer("monthly_price_cents"),          // nullable = unset
  annualPriceCents:   integer("annual_price_cents"),           // nullable = unset
  currency:           text("currency").notNull().default("AUD"),
  status:             priceVersionStatusEnum("status").notNull().default("draft"),
  effectiveFrom:      timestamp("effective_from", { withTimezone: true }),
  effectiveTo:        timestamp("effective_to", { withTimezone: true }),
  isCurrent:          boolean("is_current").notNull().default(false),
  notes:              text("notes"),
  createdBy:          text("created_by").notNull(),
  approvedBy:         text("approved_by"),
  publishedAt:        timestamp("published_at", { withTimezone: true }),
  archivedAt:         timestamp("archived_at", { withTimezone: true }),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkforcePackPriceVersion = typeof workforcePackPriceVersionsTable.$inferSelect;
export type InsertWorkforcePackPriceVersion = typeof workforcePackPriceVersionsTable.$inferInsert;
