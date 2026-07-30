/**
 * device_activation_tokens table — Sprint 14
 *
 * Short-lived single-use codes displayed on the web portal after checkout.
 * The user enters the code in the NeedsOps AI+ desktop app to register the device.
 *
 * Security:
 *   - Only SHA-256 hash stored; plaintext never leaves the API response
 *   - Expire after 15 minutes
 *   - Single-use: used_at is set atomically on first redemption
 *   - Locked after 5 failed attempts
 *   - Bound to an organization; cannot be used by a different org
 *   - RLS enforced via organization_id
 */
import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";
import { devicesTable } from "./devices.js";

export const deviceActivationTokensTable = pgTable("device_activation_tokens", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  /** SHA-256(hex) of the displayed code — never store plaintext */
  codeHash: text("code_hash").notNull(),

  /** Code expires at this time (created_at + 15 minutes) */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  /** Set when the code is successfully redeemed; prevents reuse */
  usedAt: timestamp("used_at", { withTimezone: true }),

  /** The device that was registered via this code */
  usedByDeviceId: text("used_by_device_id")
    .references(() => devicesTable.id, { onDelete: "set null" }),

  /** Failed redemption attempts (locked after 5) */
  attemptCount: integer("attempt_count").notNull().default(0),

  /** Set when admin explicitly revokes this code before use */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceActivationToken = typeof deviceActivationTokensTable.$inferSelect;
export type InsertDeviceActivationToken = typeof deviceActivationTokensTable.$inferInsert;
