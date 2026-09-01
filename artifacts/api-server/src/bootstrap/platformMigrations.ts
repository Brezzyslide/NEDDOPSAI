import { createHash } from "crypto";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

export interface PlatformMigration {
  id: string;
  file: string;
  transactional: boolean;
  notes?: string;
}

export interface PlatformMigrationRecord {
  migrationId: string;
  checksum: string;
}

export interface MigrationDbClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface MigrationLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface RunPlatformMigrationsOptions {
  migrationsDir?: string;
  migrations?: readonly PlatformMigration[];
  sourceVersion?: string | null;
  logger?: MigrationLogger;
}

export interface RunPlatformMigrationsResult {
  applied: string[];
  skipped: string[];
  ledgerCount: number;
}

const noopLogger: MigrationLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export const PLATFORM_MIGRATION_LEDGER_TABLE = "platform_schema_migrations";
export const PLATFORM_MIGRATION_LOCK_ID = 3_503_001;

export const PLATFORM_MIGRATIONS: readonly PlatformMigration[] = [
  { id: "sprint5-rls", file: "sprint5-rls.sql", transactional: true },
  { id: "sprint7-platform-boundary", file: "sprint7-platform-boundary.sql", transactional: true },
  { id: "sprint71-write-restrictions", file: "sprint71-write-restrictions.sql", transactional: true },
  { id: "sprint10-workforce-intelligence", file: "sprint10-workforce-intelligence.sql", transactional: true },
  {
    id: "sprint11-workforce-catalogue-streamlining",
    file: "sprint11-workforce-catalogue-streamlining.sql",
    transactional: false,
    notes: "Contains explicit COMMIT/BEGIN boundaries around enum value additions.",
  },
  { id: "sprint14-installer-device-discovery", file: "sprint14-installer-device-discovery.sql", transactional: true },
  { id: "sprint15-ws-relay-auth", file: "sprint15-ws-relay-auth.sql", transactional: true },
  { id: "sprint-srm-hardening", file: "sprint-srm-hardening.sql", transactional: true },
  { id: "sprint-knowledge-bridge", file: "sprint-knowledge-bridge.sql", transactional: true },
  { id: "task15-knowledge-schema", file: "task15-knowledge-schema.sql", transactional: true },
  { id: "task16-ingestion", file: "task16-ingestion.sql", transactional: true },
  { id: "task17-retrieval-audit-expand", file: "task17-retrieval-audit-expand.sql", transactional: true },
  { id: "task19-worker-queue", file: "task19-worker-queue.sql", transactional: true },
  { id: "sprint21-knowledge-curation", file: "sprint21-knowledge-curation.sql", transactional: true },
  { id: "sprint22-work-execution", file: "sprint22-work-execution.sql", transactional: true },
  { id: "sprint25-hardening", file: "sprint25-hardening.sql", transactional: true },
  { id: "sprint272-checkpoint-persist", file: "sprint272-checkpoint-persist.sql", transactional: true },
  { id: "sprint28-blueprint-studio", file: "sprint28-blueprint-studio.sql", transactional: true },
  { id: "sprint29f1-execution-actions", file: "sprint29f1-execution-actions.sql", transactional: true },
  { id: "sprint29f2-execution-actions-additions", file: "sprint29f2-execution-actions-additions.sql", transactional: true },
  { id: "sprint30-production-blueprint-foundation", file: "sprint30-production-blueprint-foundation.sql", transactional: true },
  { id: "sprint31-canonical-workforce-dna", file: "sprint31-canonical-workforce-dna.sql", transactional: true },
  { id: "task36-notification-reads", file: "task36-notification-reads.sql", transactional: true },
  { id: "task40-specialist-catalogue", file: "task40-specialist-catalogue.sql", transactional: true },
  { id: "sprint92-memory-tables", file: "sprint92-memory-tables.sql", transactional: true },
  { id: "sprint94-capabilities", file: "sprint94-capabilities.sql", transactional: true },
  { id: "sprint95-specialist-runtime", file: "sprint95-specialist-runtime.sql", transactional: true },
  { id: "sprint96-pack-commerce", file: "sprint96-pack-commerce.sql", transactional: true },
  {
    id: "sprint96-dynamic-pricing",
    file: "sprint96-dynamic-pricing.sql",
    transactional: false,
    notes: "Contains enum value additions and seeded commercial updates.",
  },
  { id: "sprint97-owner-control-plane", file: "sprint97-owner-control-plane.sql", transactional: true },
  { id: "0033-organisation-provisioning-jobs", file: "0033_organisation_provisioning_jobs.sql", transactional: true },
  { id: "0034-devices-platform-disable", file: "0034_devices_platform_disable.sql", transactional: true },
  {
    id: "0035-runtime-conversation-evidence-rls",
    file: "0035_runtime_conversation_evidence_rls.sql",
    transactional: false,
    notes: "Adds tenant_isolation policies for runtime, conversation, capability and completed-work evidence tables after fresh-bootstrap RLS validation exposed missing policies.",
  },
  {
    id: "0036-work-package-manifest-observability",
    file: "0036_work_package_manifest_observability.sql",
    transactional: true,
    notes: "Adds nullable runtime observability JSONB columns expected by work_package_manifests insert/update paths.",
  },
  {
    id: "0037-work-artifact-output-metadata",
    file: "0037_work_artifact_output_metadata.sql",
    transactional: true,
    notes: "Adds nullable generated-artifact metadata fields for Completed Work DOCX/PDF runtime proofs.",
  },
  {
    id: "0038-completed-work-approved-version-pin",
    file: "0038_completed_work_approved_version_pin.sql",
    transactional: true,
    notes: "Adds nullable completed_work.approved_version_id expected by approval/export/version pinning paths.",
  },
  {
    id: "0039-completed-work-version-provenance-status",
    file: "0039_completed_work_version_provenance_status.sql",
    transactional: true,
    notes: "Adds completed_work_versions.provenance_status expected by claim persistence and Completed Work provenance lifecycle paths.",
  },
  {
    id: "0040-task-creation-idempotency",
    file: "0040_task_creation_idempotency.sql",
    transactional: true,
    notes: "Adds durable task creation idempotency ledger and backfills canonical task mappings from existing creation metadata.",
  },
  {
    id: "0041-task-evidence-required-state",
    file: "0041_task_evidence_required_state.sql",
    transactional: false,
    notes: "Adds first-class task_state evidence_required so evidence gaps are not shown as approval-required or executing.",
  },
  {
    id: "0042-blueprint-section-template-content",
    file: "0042_blueprint_section_template_content.sql",
    transactional: true,
    notes: "Adds blueprint section role and deterministic template content fields for authored care plan templates.",
  },
  {
    id: "0043-blueprint-content-hash-provenance",
    file: "0043_blueprint_content_hash_provenance.sql",
    transactional: true,
    notes: "Adds Blueprint content hash and Completed Work Blueprint provenance pinning columns.",
  },
  {
    id: "0044-care-plan-behaviour-strategy-measurement",
    file: "0044_care_plan_behaviour_strategy_measurement.sql",
    transactional: true,
    notes: "Adds append-only care plan Behavioural Management strategy classification and APO confirmation measurement records.",
  },
] as const;

export function defaultMigrationsDir(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../../../../lib/db/migrations");
}

export function migrationChecksum(sqlText: string): string {
  return createHash("sha256").update(sqlText, "utf8").digest("hex");
}

export function loadMigrationSql(migration: PlatformMigration, migrationsDir = defaultMigrationsDir()): string {
  return readFileSync(resolve(migrationsDir, migration.file), "utf8");
}

export async function ensurePlatformMigrationLedger(client: MigrationDbClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${PLATFORM_MIGRATION_LEDGER_TABLE} (
      migration_id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER NOT NULL,
      source_version TEXT,
      transactional BOOLEAN NOT NULL,
      notes TEXT
    )
  `);
}

export async function readPlatformMigrationLedger(client: MigrationDbClient): Promise<Map<string, PlatformMigrationRecord>> {
  const result = await client.query<PlatformMigrationRecord>(`
    SELECT migration_id AS "migrationId", checksum
    FROM ${PLATFORM_MIGRATION_LEDGER_TABLE}
    ORDER BY applied_at ASC, migration_id ASC
  `);
  return new Map(result.rows.map((row) => [row.migrationId, row]));
}

export async function withPlatformMigrationLock<T>(
  client: MigrationDbClient,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("SELECT pg_advisory_lock($1)", [PLATFORM_MIGRATION_LOCK_ID]);
  try {
    return await fn();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [PLATFORM_MIGRATION_LOCK_ID]);
  }
}

async function recordMigration(
  client: MigrationDbClient,
  migration: PlatformMigration,
  checksum: string,
  durationMs: number,
  sourceVersion: string | null,
  transactional: boolean,
): Promise<void> {
  await client.query(
    `
      INSERT INTO ${PLATFORM_MIGRATION_LEDGER_TABLE}
        (migration_id, checksum, duration_ms, source_version, transactional, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [migration.id, checksum, durationMs, sourceVersion, transactional, migration.notes ?? null],
  );
}

export function containsTransactionControl(sqlText: string): boolean {
  return /(^|\n)\s*(BEGIN|COMMIT|ROLLBACK)\s*;/i.test(sqlText);
}

async function applyOneMigration(
  client: MigrationDbClient,
  migration: PlatformMigration,
  sqlText: string,
  checksum: string,
  sourceVersion: string | null,
): Promise<void> {
  const startedAt = Date.now();
  const transactional = migration.transactional && !containsTransactionControl(sqlText);

  if (transactional) {
    await client.query("BEGIN");
    try {
      await client.query(sqlText);
      await recordMigration(client, migration, checksum, Date.now() - startedAt, sourceVersion, transactional);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }
    return;
  }

  await client.query(sqlText);
  await recordMigration(client, migration, checksum, Date.now() - startedAt, sourceVersion, transactional);
}

export async function runPlatformMigrations(
  client: MigrationDbClient,
  options: RunPlatformMigrationsOptions = {},
): Promise<RunPlatformMigrationsResult> {
  const logger = options.logger ?? noopLogger;
  const migrationsDir = options.migrationsDir ?? defaultMigrationsDir();
  const migrations = options.migrations ?? PLATFORM_MIGRATIONS;

  return withPlatformMigrationLock(client, async () => {
    await ensurePlatformMigrationLedger(client);
    const ledger = await readPlatformMigrationLedger(client);
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const migration of migrations) {
      const sqlText = loadMigrationSql(migration, migrationsDir);
      const checksum = migrationChecksum(sqlText);
      const existing = ledger.get(migration.id);

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(
            `Platform migration checksum mismatch for ${migration.id}. ` +
            "Create a new migration instead of editing an applied migration.",
          );
        }
        skipped.push(migration.id);
        logger.info("Platform migration already applied", { migrationId: migration.id });
        continue;
      }

      logger.info("Applying platform migration", {
        migrationId: migration.id,
        transactional: migration.transactional && !containsTransactionControl(sqlText),
      });
      await applyOneMigration(client, migration, sqlText, checksum, options.sourceVersion ?? null);
      applied.push(migration.id);
    }

    const currentLedger = await readPlatformMigrationLedger(client);
    return { applied, skipped, ledgerCount: currentLedger.size };
  });
}
