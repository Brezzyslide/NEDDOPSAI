/**
 * org_database_registry — Sprint 7 (updated from Sprint 6)
 *
 * Platform Database table. Records the provisioning state and connection
 * details for every organisation's Operational Database (or schema).
 *
 * This is the ONLY approved source of truth for routing operational data
 * access to the correct organisation database/schema. The connection manager
 * reads from this table to resolve org connections.
 *
 * Security:
 *   • Credentials are NEVER stored here. Only the reference key used to
 *     retrieve them from the secrets vault is stored.
 *   • Schema names are derived from stable internal IDs, never from slugs.
 *   • The `schemaName` is a PostgreSQL identifier safe name (org_ prefix + UUID).
 *
 * Current implementation: schema-per-org within the shared PostgreSQL instance.
 * Target (Sprint 7+): separate database per org on a managed PostgreSQL host.
 */
import { pgTable, pgEnum, text, timestamp, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export const orgDbStatusEnum = pgEnum("org_db_status", [
  "provisioning",   // provisioning in progress
  "active",         // healthy and in use
  "suspended",      // suspended (org account suspended)
  "migrating",      // migration in progress
  "maintenance",    // read-only maintenance mode
  "deprovisioning", // offboarding in progress
  "deprovisioned",  // offboarding complete, DB archived
  "failed",         // provisioning or migration failed
]);

export const orgDatabaseRegistryTable = pgTable("org_database_registry", {
  id: text("id").primaryKey(),

  /** One-to-one with organisations. */
  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizationsTable.id, { onDelete: "restrict" }),

  /**
   * Current implementation: PostgreSQL schema name within the shared cluster.
   * Format: org_<uuid_with_underscores>
   * Never derived from slug — uses stable internal org UUID.
   */
  schemaName: text("schema_name").notNull().unique(),

  /**
   * Human-readable database/schema identifier for operations tooling.
   * Never exposed to end users.
   */
  internalLabel: text("internal_label").notNull(),

  /**
   * Target architecture: host:port of the dedicated PostgreSQL instance.
   * Current implementation: same host as platform DB (schema isolation).
   * Null until migrated to dedicated instance.
   */
  dbHost: text("db_host"),
  dbPort: integer("db_port"),
  dbName: text("db_name"),

  /**
   * Reference key for secrets vault lookup.
   * The actual credentials (username, password, TLS certs) are stored in
   * the secrets manager and retrieved using this key.
   * For current shared-DB implementation, uses platform DB connection.
   */
  credentialsRef: text("credentials_ref"),

  /**
   * Current provisioning/operational status.
   */
  status: orgDbStatusEnum("status").notNull().default("provisioning"),

  /**
   * Schema migration version tracking.
   * Records the last successfully applied migration version.
   */
  migrationVersion: text("migration_version"),

  /**
   * Whether the schema has been verified healthy since last provisioning/migration.
   */
  isVerified: boolean("is_verified").notNull().default(false),

  /**
   * Last successful health check timestamp.
   */
  lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),

  /**
   * Last successful backup timestamp.
   */
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),

  /**
   * Storage used by this org's schema/database in bytes.
   * Updated periodically by the monitoring job.
   */
  storageBytes: text("storage_bytes"), // text to avoid int8 overflow issues

  /**
   * Whether the org data has been fully migrated from the shared DB.
   * False = still in shared DB (Sprint 5 state).
   * True = data is in the org DB (Sprint 7+ state).
   */
  isMigrated: boolean("is_migrated").notNull().default(false),

  /**
   * Timestamp when initial data migration to org DB was completed.
   */
  migratedAt: timestamp("migrated_at", { withTimezone: true }),

  /**
   * Who provisioned this org database.
   */
  provisionedBy: text("provisioned_by"),

  // ── Sprint 7 columns ────────────────────────────────────────────────────────

  /**
   * TRUE = separate PostgreSQL database.
   * FALSE = schema within shared cluster (default for dev/small orgs).
   */
  isDedicatedDb: boolean("is_dedicated_db").notNull().default(false),

  /**
   * Identifier for the managed PostgreSQL cluster.
   * NULL = shared platform cluster.
   */
  clusterRef: text("cluster_ref"),

  /**
   * Backup schedule configuration.
   * { schedule: string, retentionDays: number, encryptionEnabled: boolean }
   */
  backupConfig: jsonb("backup_config").notNull().default({}),

  /**
   * Last backup result: not_configured | pending | completed | failed
   */
  backupStatus: text("backup_status").default("not_configured"),

  /**
   * When the next scheduled backup should run.
   */
  nextBackupAt: timestamp("next_backup_at", { withTimezone: true }),

  /**
   * Data migration state machine.
   * not_started | inventory | copying | validating | dual_write |
   * reconciling | cutting_over | monitoring | finalised | failed
   */
  migrationState: text("migration_state").default("not_started"),

  /**
   * Human-readable reason if org database is suspended.
   */
  suspensionReason: text("suspension_reason"),

  /**
   * When this org database is scheduled for decommissioning.
   */
  decommissionAt: timestamp("decommission_at", { withTimezone: true }),

  /**
   * Arbitrary operational metadata (provisioning logs, error details, notes).
   */
  metadata: jsonb("metadata").notNull().default({}),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgDatabaseRegistry = typeof orgDatabaseRegistryTable.$inferSelect;
export type InsertOrgDatabaseRegistry = typeof orgDatabaseRegistryTable.$inferInsert;
