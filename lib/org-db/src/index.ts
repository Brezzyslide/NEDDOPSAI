/**
 * @workspace/org-db — Sprint 7
 *
 * Organisation Operational Database library.
 *
 * Exports:
 *   Connection management:
 *     - withOrgContext()         — Primary org data access gateway (Sprint 7: per-org routing)
 *     - checkOrgDbHealth()       — Health check for an org's database
 *     - drainAllPools()          — Graceful shutdown (wired to SIGTERM)
 *     - drainOrgPool()           — Drain one org's connection pool (credential rotation)
 *     - getPoolStatus()          — Connection pool metrics
 *     - startPoolReaper()        — Start idle pool eviction (call at server startup)
 *     - OrgConnectionError       — Typed error for routing failures
 *
 *   Provisioning:
 *     - provisionOrgDb()         — 14-step idempotent provisioning (Sprint 7)
 *     - deprovisionOrgDb()       — Remove an org database (pre-migration only)
 *     - deriveSchemaName()       — Org UUID → PostgreSQL schema name
 *     - deriveDatabaseName()     — Org UUID → PostgreSQL database name
 *
 *   Migration:
 *     - migrateOrgData()         — Migrate shared table data → org database
 *
 *   Backup and restore:
 *     - createOrgBackup()        — Logical backup of org operational schema
 *     - restoreOrgBackup()       — Restore from encrypted backup payload
 *     - getOrgBackupStatus()     — Backup status (safe for console display)
 *
 *   Schema versioning:
 *     - applyMigrationsUpTo()    — Apply versioned DDL migrations
 *     - CURRENT_MIGRATION_VERSION
 *
 *   RLS verification:
 *     - verifyRLS()              — Check all required tables have RLS enabled
 *     - verifyNeedsOpsAppRoleIsSecure() — Verify role cannot bypass RLS
 *     - RLSVerificationError     — Thrown at startup if RLS is missing
 *     - REQUIRED_RLS_TABLES
 *
 *   Schema definitions:
 *     - createOrgSchema()        — Drizzle schema factory for org tables
 */

export { createOrgSchema, type OrgSchemaType } from "./schema";

export {
  withOrgContext,
  checkOrgDbHealth,
  drainAllPools,
  drainOrgPool,
  getPoolStatus,
  startPoolReaper,
  OrgConnectionError,
  type OrgConnection,
  type OrgConnectionContext,
  type OrgDbHealth,
} from "./orgConnectionManager";

export {
  provisionOrgDb,
  deprovisionOrgDb,
  deriveSchemaName,
  deriveDatabaseName,
  type ProvisionOrgDbInput,
  type ProvisionOrgDbResult,
  type ProvisioningStep,
} from "./orgProvisioningService";

export {
  migrateOrgData,
  type MigrationInput,
  type MigrationReport,
  type MigrationInventory,
} from "./orgMigrationService";

export {
  createOrgBackup,
  restoreOrgBackup,
  getOrgBackupStatus,
  BackupError,
  type BackupResult,
  type RestoreResult,
  type BackupStatus,
} from "./orgBackupService";

export {
  applyMigrationsUpTo,
  CURRENT_MIGRATION_VERSION,
  MIGRATION_VERSIONS,
  type MigrationVersion,
} from "./orgSchemaVersions";

export {
  verifyRLS,
  verifyNeedsOpsAppRoleIsSecure,
  verifyLegacyTablesReadOnly,
  RLSVerificationError,
  LegacyWriteError,
  REQUIRED_RLS_TABLES,
  LEGACY_WRITE_RESTRICTED_TABLES,
  type RLSVerificationResult,
  type RLSTableStatus,
  type LegacyWriteCheckResult,
  type LegacyWriteRestrictedTable,
} from "./rlsVerifier";

export {
  checkLocalMembership,
  withOrgMemberContext,
  OrgMembershipError,
  type LocalMembership,
  type OrgMemberContext,
} from "./orgMembershipGuard";

export {
  type BackupStorageProvider,
  FilesystemBackupProvider,
  ObjectStorageBackupProvider,
  BackupStorageError,
  getDefaultBackupStorageProvider,
  setDefaultBackupStorageProvider,
} from "./backupStorage";

export {
  startBackupScheduler,
  stopBackupScheduler,
  processDueBackups,
  type BackupSchedulerOptions,
  type SchedulerRun,
} from "./backupScheduler";
