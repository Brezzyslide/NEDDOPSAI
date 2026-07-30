/**
 * device_auth_challenges — Sprint 15
 *
 * Short-lived nonces for the device challenge/exchange authentication flow.
 * The device requests a challenge, signs the nonce with its private key,
 * and exchanges the signed nonce for a short-lived access token.
 *
 * Security:
 *   - 60-second TTL; unused challenges are garbage-collected
 *   - Single-use: used_at is set atomically on exchange
 *   - RLS enforced via organization_id
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";

export const deviceAuthChallengesTable = pgTable("device_auth_challenges", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** 32-byte random nonce (hex-encoded) to be signed by the device */
  nonce: text("nonce").notNull(),

  /** Challenge expires 60 seconds after creation */
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

  /** Set when the challenge is successfully exchanged — prevents reuse */
  usedAt: timestamp("used_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceAuthChallenge = typeof deviceAuthChallengesTable.$inferSelect;
export type InsertDeviceAuthChallenge = typeof deviceAuthChallengesTable.$inferInsert;
