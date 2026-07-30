/**
 * device_access_tokens — Sprint 15
 *
 * Short-lived opaque access tokens issued after a successful challenge exchange.
 * Used to authenticate WebSocket relay connections and device API calls.
 *
 * Security:
 *   - 15-minute TTL
 *   - Only SHA-256 hash stored — plaintext never retrievable from DB
 *   - Audience restricts token to a single purpose ('device-relay')
 *   - Revocation closes the associated WebSocket within one heartbeat cycle
 *   - RLS enforced via organization_id
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";

export const deviceAccessTokensTable = pgTable("device_access_tokens", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** SHA-256 hash of the opaque access token */
  tokenHash: text("token_hash").notNull(),

  /** Restricts the token to a specific purpose */
  audience: text("audience").notNull().default("device-relay"),

  /** 15 minutes from issuance */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  /** Updated on each WS message to track active sessions without a full scan */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceAccessToken = typeof deviceAccessTokensTable.$inferSelect;
export type InsertDeviceAccessToken = typeof deviceAccessTokensTable.$inferInsert;
