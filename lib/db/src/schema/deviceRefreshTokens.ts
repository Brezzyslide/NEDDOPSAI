/**
 * device_refresh_tokens — Sprint 15
 *
 * Long-lived refresh tokens stored in the device's OS secure storage.
 * Used to obtain new access tokens without repeating the challenge/exchange flow.
 * Rotated on every use (old token revoked, new token issued).
 *
 * Security:
 *   - 30-day TTL
 *   - Single-use rotation: token is revoked and replaced on each refresh
 *   - superseded_by_id creates an audit trail of token lineage
 *   - Only SHA-256 hash stored
 *   - RLS enforced via organization_id
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";

export const deviceRefreshTokensTable = pgTable("device_refresh_tokens", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** SHA-256 hash of the opaque refresh token */
  tokenHash: text("token_hash").notNull(),

  /** 30 days from issuance */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  /** Set when this token is rotated and replaced */
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),

  /** ID of the replacement token issued when this one was rotated */
  supersededById: text("superseded_by_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceRefreshToken = typeof deviceRefreshTokensTable.$inferSelect;
export type InsertDeviceRefreshToken = typeof deviceRefreshTokensTable.$inferInsert;
