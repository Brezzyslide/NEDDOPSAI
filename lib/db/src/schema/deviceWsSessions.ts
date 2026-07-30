/**
 * device_ws_sessions — Sprint 15
 *
 * Records each WebSocket relay session opened by a device.
 * Provides an audit trail of device connectivity and supports
 * duplicate-connection detection.
 *
 * Security:
 *   - RLS enforced via organization_id
 *   - disconnected_at is set when the WS closes cleanly or times out
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";

export const deviceWsSessionsTable = pgTable("device_ws_sessions", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** 'outbound-wss' | 'cloudflare-dev' */
  transportType: text("transport_type").notNull().default("outbound-wss"),

  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),

  /** Updated by heartbeat messages */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),

  /** Set when the WS closes (cleanly or by timeout) */
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),

  /** Disconnect reason: 'clean' | 'timeout' | 'revoked' | 'duplicate' | 'error' */
  disconnectReason: text("disconnect_reason"),

  /** Desktop app version reported at connection */
  appVersion: text("app_version"),

  /** OS platform: macos | windows */
  osPlatform: text("os_platform"),

  /** Architecture: arm64 | x64 */
  arch: text("arch"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceWsSession = typeof deviceWsSessionsTable.$inferSelect;
export type InsertDeviceWsSession = typeof deviceWsSessionsTable.$inferInsert;
