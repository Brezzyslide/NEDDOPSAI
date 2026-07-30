/**
 * device_credentials table — Sprint 14
 *
 * Stores hashed credentials for each device. NEVER stores plaintext tokens.
 * The brokerAuthToken is issued at activation and used by the broker for all
 * API calls. Hashed before storage.
 *
 * Security:
 *   - Only SHA-256 hashes stored (token never retrievable from DB)
 *   - Revocation sets revoked_at; broker 401s on next request
 *   - Short rotation cycle recommended (default 90 days)
 *   - RLS enforced via organization_id
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { devicesTable } from "./devices.js";

export const deviceCredentialsTable = pgTable("device_credentials", {
  id: text("id").primaryKey(),

  deviceId: text("device_id")
    .notNull()
    .references(() => devicesTable.id, { onDelete: "cascade" }),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** SHA-256 hash of the brokerAuthToken (bearer token for device→API calls) */
  tokenHash: text("token_hash").notNull(),

  /** SHA-256 hash of the webhookSecret (HMAC key for signed webhook payloads) */
  webhookSecretHash: text("webhook_secret_hash").notNull(),

  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),

  /** null = no explicit expiry; rotation_due_at handles rotation */
  expiresAt: timestamp("expires_at", { withTimezone: true }),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  /** Scheduled credential rotation date (default: issued_at + 90 days) */
  rotationDueAt: timestamp("rotation_due_at", { withTimezone: true }),

  /** Updated on each heartbeat to track last use without full table scan */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeviceCredential = typeof deviceCredentialsTable.$inferSelect;
export type InsertDeviceCredential = typeof deviceCredentialsTable.$inferInsert;
