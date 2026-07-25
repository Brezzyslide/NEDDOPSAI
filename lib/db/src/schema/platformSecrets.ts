/**
 * platform_secrets — Sprint 7
 *
 * Encrypted secret storage for the Platform Database.
 *
 * Secrets are stored AES-256-GCM encrypted using the master key derived from
 * the SESSION_SECRET environment variable. In production this backing store
 * would be replaced by AWS Secrets Manager, HashiCorp Vault, or equivalent.
 *
 * Security guarantees:
 *   • Plaintext never stored — only encrypted blobs
 *   • secret_ref is the lookup key (stored in org_database_registry.credentials_ref)
 *   • version increments on every rotation
 *   • Revoked secrets cannot be retrieved
 *   • No plaintext appears in logs, audit events, or exception traces
 *   • Table is not exposed via any application API
 */
import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const platformSecretsTable = pgTable("platform_secrets", {
  id: text("id").primaryKey(),

  /**
   * Stable lookup key stored in org_database_registry.credentials_ref.
   * Format: "org:<orgId>:db:v<n>" for org DB credentials.
   * Never derived from slug — always from stable internal IDs.
   */
  secretRef: text("secret_ref").notNull().unique(),

  /**
   * AES-256-GCM encrypted JSON blob.
   * Format: base64(iv + authTag + ciphertext)
   * Never expose this field in logs, API responses, or audit events.
   */
  encryptedValue: text("encrypted_value").notNull(),

  /**
   * Increments on each rotation. Allows callers to detect staleness.
   */
  version: integer("version").notNull().default(1),

  /**
   * True after revokeSecret() — retrieveSecret() will throw for revoked secrets.
   */
  isRevoked: boolean("is_revoked").notNull().default(false),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),

  /**
   * Last time the secret was successfully validated (e.g. DB connection test).
   */
  lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),

  /**
   * Optional expiry. retrieveSecret() will refuse to return expired secrets.
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),

  /**
   * Non-sensitive metadata (rotation schedule, description, owning service).
   * Must never contain plaintext credential values.
   */
  metadata: jsonb("metadata").notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformSecret = typeof platformSecretsTable.$inferSelect;
export type InsertPlatformSecret = typeof platformSecretsTable.$inferInsert;
