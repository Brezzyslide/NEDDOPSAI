/**
 * plan_versions table — Sprint 3
 *
 * Immutable versioned snapshots of a plan's configuration.
 * Once a version is activated, it MUST NOT be edited in place.
 * A new version must be created and activated instead.
 * Historical versions are preserved for audit and legacy subscription resolution.
 */
import { pgTable, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";
import { plansTable } from "./plans.js";

export const planVersionsTable = pgTable("plan_versions", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull().references(() => plansTable.id, { onDelete: "restrict" }),
  versionNumber: integer("version_number").notNull(),       // monotonically increasing per plan
  label: text("label"),                                      // e.g. "v1 — July 2026"
  isActive: boolean("is_active").notNull().default(false),  // only one active per plan
  isLegacy: boolean("is_legacy").notNull().default(false),  // retired but still has subscribers
  /** Seat allowance for this version */
  includedSeats: integer("included_seats").notNull().default(3),
  /** null = configurable (Enterprise) */
  maxSeats: integer("max_seats"),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdBy: text("created_by"),                            // platform admin user id
  notes: text("notes"),                                     // internal notes
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlanVersion = typeof planVersionsTable.$inferSelect;
export type InsertPlanVersion = typeof planVersionsTable.$inferInsert;
