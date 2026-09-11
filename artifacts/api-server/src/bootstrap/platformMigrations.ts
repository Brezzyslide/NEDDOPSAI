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
  {
    id: "0045-participant-scoping",
    file: "0045_participant_scoping.sql",
    transactional: true,
    notes: "Adds first-class participants and task participant bindings for participant-scoped knowledge retrieval.",
  },
  {
    id: "0046-rls-policy-normalisation",
    file: "0046_rls_policy_normalisation.sql",
    transactional: true,
    notes: "Normalises RLS setting names, closes permissive tenant policies, and adds missing policy coverage before restricted app-role rollout.",
  },
  {
    id: "0047-auth-tenant-resolver",
    file: "0047_auth_tenant_resolver.sql",
    transactional: true,
    notes: "Adds narrow SECURITY DEFINER auth resolver for pre-tenant user, org slug, and membership resolution.",
  },
  {
    id: "0048-pre-context-identity-resolvers",
    file: "0048_pre_context_identity_resolvers.sql",
    transactional: true,
    notes: "Adds narrow SECURITY DEFINER resolvers for device, invitation, and user-self pre-context identity flows.",
  },
  {
    id: "0049-checkpoint-startup-sweep-functions",
    file: "0049_checkpoint_startup_sweep_functions.sql",
    transactional: true,
    notes: "Adds bounded SECURITY DEFINER functions for startup checkpoint expiry and stuck-resume recovery.",
  },
  {
    id: "0050-platform-public-worker-boundaries",
    file: "0050_platform_public_worker_boundaries.sql",
    transactional: true,
    notes: "Adds platform and worker app roles, public catalogue column grants, and worker-only ingestion job claim function.",
  },
  {
    id: "0051-context-identity-column-grants",
    file: "0051_context_identity_column_grants.sql",
    transactional: true,
    notes: "Adds narrow user and organization identity column grants used by tenant context assembly.",
  },
  {
    id: "0052-smoke-column-grants",
    file: "0052_smoke_column_grants.sql",
    transactional: true,
    notes: "Adds narrow message read column grants required by authenticated unread-count smoke paths.",
  },
  {
    id: "0053-worker-role-boundary-reconciliation",
    file: "0053_worker_role_boundary_reconciliation.sql",
    transactional: true,
    notes: "Restores worker membership in needsops_app while keeping the worker role NOINHERIT at rest.",
  },
  {
    id: "0054-legacy-write-restriction-reconciliation",
    file: "0054_legacy_write_restriction_reconciliation.sql",
    transactional: true,
    notes: "Re-applies the Sprint 7.1 needsops_app legacy write revokes through the ordered migration runner.",
  },
  {
    id: "0055-worker-ingestion-recovery-function",
    file: "0055_worker_ingestion_recovery_function.sql",
    transactional: true,
    notes: "Adds worker-only bounded SECURITY DEFINER lease recovery for stuck ingestion jobs.",
  },
  {
    id: "0056-worker-ingestion-lease-reconciliation",
    file: "0056_worker_ingestion_lease_reconciliation.sql",
    transactional: true,
    notes: "Sets leases during bounded worker claims and recovers legacy NULL-lease claimed jobs.",
  },
  {
    id: "0057-shared-org-audit-event-function",
    file: "0057_shared_org_audit_event_function.sql",
    transactional: true,
    notes: "Adds a bounded SECURITY DEFINER function for shared org audit writes without granting legacy table DML.",
  },
] as const;

interface PlatformSecurityCheck {
  name: string;
  query: string;
  values?: unknown[];
  expected: string | boolean;
}

export interface PlatformSecurityVerificationResult {
  passed: boolean;
  failures: string[];
}

const PLATFORM_SECURITY_CHECKS: readonly PlatformSecurityCheck[] = [
  {
    name: "needsops_worker_app is NOINHERIT",
    query: "SELECT COALESCE((SELECT rolinherit FROM pg_roles WHERE rolname = 'needsops_worker_app'), true)::text AS value",
    expected: "false",
  },
  {
    name: "needsops_worker_app is a member of needsops_app",
    query: `
      SELECT EXISTS (
        SELECT 1
        FROM pg_auth_members m
        JOIN pg_roles member ON member.oid = m.member
        JOIN pg_roles role ON role.oid = m.roleid
        WHERE member.rolname = 'needsops_worker_app'
          AND role.rolname = 'needsops_app'
      )::text AS value
    `,
    expected: "true",
  },
  {
    name: "worker can execute claim_next_ingestion_job",
    query: "SELECT has_function_privilege('needsops_worker_app', 'public.claim_next_ingestion_job(text)', 'EXECUTE')::text AS value",
    expected: "true",
  },
  {
    name: "worker can execute recover_stuck_ingestion_jobs",
    query: "SELECT has_function_privilege('needsops_worker_app', 'public.recover_stuck_ingestion_jobs(timestamptz, integer)', 'EXECUTE')::text AS value",
    expected: "true",
  },
  {
    name: "public cannot execute claim_next_ingestion_job",
    query: `
      SELECT (NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE n.nspname = 'public'
          AND p.proname = 'claim_next_ingestion_job'
          AND pg_get_function_identity_arguments(p.oid) = 'p_worker_id text'
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ))::text AS value
    `,
    expected: "true",
  },
  {
    name: "public cannot execute recover_stuck_ingestion_jobs",
    query: `
      SELECT (NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE n.nspname = 'public'
          AND p.proname = 'recover_stuck_ingestion_jobs'
          AND pg_get_function_identity_arguments(p.oid) = 'p_stuck_before timestamp with time zone, p_limit integer'
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ))::text AS value
    `,
    expected: "true",
  },
  {
    name: "needsops_app can read context user identity columns",
    query: `
      SELECT (
        has_column_privilege('needsops_app', 'public.users', 'id', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.users', 'external_id', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.users', 'first_name', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.users', 'last_name', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.users', 'display_name', 'SELECT')
      )::text AS value
    `,
    expected: "true",
  },
  {
    name: "needsops_app cannot read user email by default",
    query: "SELECT has_column_privilege('needsops_app', 'public.users', 'email', 'SELECT')::text AS value",
    expected: "false",
  },
  {
    name: "needsops_app can read context organization identity columns",
    query: `
      SELECT (
        has_column_privilege('needsops_app', 'public.organizations', 'id', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.organizations', 'name', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.organizations', 'display_name', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.organizations', 'slug', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.organizations', 'status', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.organizations', 'execution_frozen', 'SELECT')
      )::text AS value
    `,
    expected: "true",
  },
  {
    name: "needsops_app can read message read columns",
    query: `
      SELECT (
        has_column_privilege('needsops_app', 'public.message_reads', 'id', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.message_reads', 'organization_id', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.message_reads', 'message_id', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.message_reads', 'user_id', 'SELECT') AND
        has_column_privilege('needsops_app', 'public.message_reads', 'read_at', 'SELECT')
      )::text AS value
    `,
    expected: "true",
  },
  {
    name: "needsops_app cannot insert directly into shared org audit log",
    query: "SELECT has_table_privilege('needsops_app', 'public.org_audit_log', 'INSERT')::text AS value",
    expected: "false",
  },
  {
    name: "needsops_app can execute shared org audit writer",
    query: "SELECT has_function_privilege('needsops_app', 'public.write_org_audit_event(text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb)', 'EXECUTE')::text AS value",
    expected: "true",
  },
  {
    name: "worker can execute shared org audit writer",
    query: "SELECT has_function_privilege('needsops_worker_app', 'public.write_org_audit_event(text,text,text,text,text,text,text,text,text,text,text,boolean,jsonb)', 'EXECUTE')::text AS value",
    expected: "true",
  },
  {
    name: "public cannot execute shared org audit writer",
    query: `
      SELECT (NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE n.nspname = 'public'
          AND p.proname = 'write_org_audit_event'
          AND pg_get_function_identity_arguments(p.oid) = 'p_id text, p_organization_id text, p_actor_user_id text, p_actor_type text, p_event_type text, p_resource_type text, p_resource_id text, p_request_id text, p_ip_address text, p_user_agent text, p_access_purpose text, p_is_sensitive boolean, p_metadata jsonb'
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ))::text AS value
    `,
    expected: "true",
  },
];

export async function verifyPlatformSecurityBaseline(
  client: MigrationDbClient,
): Promise<PlatformSecurityVerificationResult> {
  const failures: string[] = [];

  for (const check of PLATFORM_SECURITY_CHECKS) {
    const result = await client.query<{ value: string | boolean }>(check.query, check.values);
    const actual = String(result.rows[0]?.value);
    if (actual !== String(check.expected)) {
      failures.push(`${check.name}: expected ${String(check.expected)}, got ${actual}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

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
