/**
 * devices table — Sprint 14 (NeedsOps AI+ Installer)
 *
 * One row per registered device. Each device belongs to one org and is owned
 * by one user. Multiple devices per org are supported.
 *
 * Security:
 *   - RLS enforced via organization_id (tenant_isolation policy)
 *   - Revocation sets revoked_at + status = 'revoked'; credentials rejected immediately
 *   - No plaintext secrets stored here; see device_credentials for hashes
 */
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const deviceStatusEnum = pgEnum("device_status", [
  "pending",      // activation code redeemed but first-run not complete
  "connected",    // active, heartbeating
  "disconnected", // heartbeat missed > 90s
  "revoked",      // admin-revoked; cannot reconnect
]);

export const devicesTable = pgTable("devices", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** The user who registered this device */
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  /** Human-readable name, e.g. "Samantha's MacBook Pro" */
  displayName: text("display_name").notNull(),

  /** macos | windows | linux */
  platform: text("platform").notNull(),

  /** arm64 | x64 */
  arch: text("arch"),

  /** OS hostname at registration time */
  hostname: text("hostname"),

  /** OS version string, e.g. "14.5" */
  osVersion: text("os_version"),

  /** NeedsOps AI+ desktop app version */
  appVersion: text("app_version"),

  /** Runtime Broker version */
  brokerVersion: text("broker_version"),

  /** Public key registered at enrolment (PEM, base64) — used for JWT device auth */
  publicKey: text("public_key"),

  /** Current device status */
  status: deviceStatusEnum("status").notNull().default("pending"),

  /** Current Cloudflare Tunnel URL or relay endpoint (rotates on restart) */
  tunnelUrl: text("tunnel_url"),

  /** Set when the desktop app successfully completes first-run */
  firstRunCompletedAt: timestamp("first_run_completed_at", { withTimezone: true }),

  /** Last heartbeat received */
  lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),

  registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),

  // ── Task #34 — Platform disable (reversible; separate from permanent revoke) ──
  /** When true, device is temporarily blocked by a platform owner. */
  isPlatformDisabled: boolean("is_platform_disabled").notNull().default(false),
  platformDisabledAt: timestamp("platform_disabled_at", { withTimezone: true }),
  platformDisabledBy: text("platform_disabled_by"),
  platformDisabledReason: text("platform_disabled_reason"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Device = typeof devicesTable.$inferSelect;
export type InsertDevice = typeof devicesTable.$inferInsert;
