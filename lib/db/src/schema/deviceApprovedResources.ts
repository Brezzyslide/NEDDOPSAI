/**
 * device_approved_resources table — Sprint 14
 *
 * Folders, files, and browser profiles that a user has explicitly granted
 * the NeedsOps AI+ desktop app permission to access on a specific device.
 *
 * Scoped to device (and therefore org) — paths are device-specific.
 * Path stored encrypted (AES-256 via application-layer encryption).
 *
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";
import { usersTable } from "./users.js";

export const deviceApprovedResourcesTable = pgTable("device_approved_resources", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** folder | file | browser_profile */
  resourceType: text("resource_type").notNull(),

  /**
   * OS path — stored encrypted at rest via app-layer encryption.
   * Example: "/Users/sam/Documents/Policies"
   */
  encryptedPath: text("encrypted_path"),

  /** User-friendly label shown in UI (not encrypted) */
  displayName: text("display_name").notNull(),

  /** read | read_write */
  accessScope: text("access_scope").notNull().default("read"),

  grantedByUserId: text("granted_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),

  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceApprovedResource = typeof deviceApprovedResourcesTable.$inferSelect;
export type InsertDeviceApprovedResource = typeof deviceApprovedResourcesTable.$inferInsert;
