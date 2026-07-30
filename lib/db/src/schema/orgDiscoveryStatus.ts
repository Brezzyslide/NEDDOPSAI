/**
 * org_discovery_status table — Sprint 14 (Business Discovery)
 *
 * Tracks overall Business Discovery progress for an org.
 * Single row per org (unique on organization_id).
 *
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";
import { usersTable } from "./users.js";

export const orgDiscoveryStatusTable = pgTable("org_discovery_status", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Index of the currently active screen (0 = not started) */
  currentScreen: integer("current_screen").notNull().default(0),

  /** JSON array of completed screen indices, e.g. "[1,2,3]" */
  completedScreens: text("completed_screens").notNull().default("[]"),

  /** Total screens in the wizard */
  totalScreens: integer("total_screens").notNull().default(6),

  completedAt: timestamp("completed_at", { withTimezone: true }),

  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),

  updatedByDeviceId: text("updated_by_device_id")
    .references(() => devicesTable.id, { onDelete: "set null" }),

  updatedByUserId: text("updated_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgDiscoveryStatus = typeof orgDiscoveryStatusTable.$inferSelect;
export type InsertOrgDiscoveryStatus = typeof orgDiscoveryStatusTable.$inferInsert;
