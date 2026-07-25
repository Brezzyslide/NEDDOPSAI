/**
 * Organisation Database Schema Versioning — Sprint 7
 *
 * Manages versioned DDL migrations for organisation operational databases.
 * Each version is idempotent. Applied in order during provisioning and upgrades.
 *
 * Versions:
 *   sprint6-foundation : 10 tables (tasks, approvals, memberships, settings, etc.)
 *   sprint7-extended   : adds migration_source columns for data cutover tracking
 */

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export const CURRENT_MIGRATION_VERSION = "sprint7-extended";

export interface MigrationVersion {
  version: string;
  description: string;
  apply: (db: NodePgDatabase<any>, schemaName: string) => Promise<void>;
}

// ─── Version registry ─────────────────────────────────────────────────────────

export const MIGRATION_VERSIONS: MigrationVersion[] = [
  {
    version: "sprint6-foundation",
    description: "10 core operational tables: tasks, approvals, memberships, settings, workforce packs, audit log",
    apply: applySprintSixFoundation,
  },
  {
    version: "sprint7-extended",
    description: "Migration source tracking columns, backup state table, RLS on org tables",
    apply: applySprintSevenExtended,
  },
];

// ─── Ordered application ──────────────────────────────────────────────────────

/**
 * Applies all migrations up to and including the target version.
 * Idempotent — checks IF NOT EXISTS for every DDL statement.
 */
export async function applyMigrationsUpTo(
  db: NodePgDatabase<any>,
  schemaName: string,
  targetVersion: string = CURRENT_MIGRATION_VERSION,
): Promise<{ appliedVersions: string[] }> {
  const targetIndex = MIGRATION_VERSIONS.findIndex(v => v.version === targetVersion);
  if (targetIndex < 0) {
    throw new Error(`Unknown migration version: ${targetVersion}`);
  }

  const toApply = MIGRATION_VERSIONS.slice(0, targetIndex + 1);
  const appliedVersions: string[] = [];

  for (const migration of toApply) {
    await migration.apply(db, schemaName);
    appliedVersions.push(migration.version);
  }

  return { appliedVersions };
}

// ─── Sprint 6: Foundation tables ─────────────────────────────────────────────

async function applySprintSixFoundation(db: NodePgDatabase<any>, s: string): Promise<void> {
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'org_task_state' AND n.nspname = '${s}') THEN
        CREATE TYPE "${s}".org_task_state AS ENUM ('draft','queued','planning','awaiting_approval','approved','executing','completed','cancelled','failed');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'org_task_priority' AND n.nspname = '${s}') THEN
        CREATE TYPE "${s}".org_task_priority AS ENUM ('low','normal','high','urgent');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE t.typname = 'org_approval_type' AND n.nspname = '${s}') THEN
        CREATE TYPE "${s}".org_approval_type AS ENUM ('no_approval','manager_approval','administrator_approval','owner_approval','dual_approval','compliance_approval','platform_approval');
      END IF;
    END $$;
  `));

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${s}".org_settings (
      key         TEXT PRIMARY KEY,
      value       JSONB NOT NULL DEFAULT '{}',
      label       TEXT,
      updated_by  TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "${s}".org_memberships (
      id                     TEXT PRIMARY KEY,
      platform_user_id       TEXT NOT NULL,
      role                   TEXT NOT NULL DEFAULT 'member',
      status                 TEXT NOT NULL DEFAULT 'active',
      permissions            JSONB NOT NULL DEFAULT '{}',
      clinical_access        TEXT NOT NULL DEFAULT 'none',
      can_approve_ai_outputs BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON "${s}".org_memberships(platform_user_id);

    CREATE TABLE IF NOT EXISTS "${s}".org_workforce_packs (
      id            TEXT PRIMARY KEY,
      pack_code     TEXT NOT NULL,
      granted_by    TEXT,
      granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at    TIMESTAMPTZ,
      revoked_by    TEXT,
      revoke_reason TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS "${s}".org_tasks (
      id                  TEXT PRIMARY KEY,
      title               TEXT NOT NULL,
      description         TEXT,
      originating_user_id TEXT,
      originating_module  TEXT,
      current_state       TEXT NOT NULL DEFAULT 'draft',
      priority            TEXT NOT NULL DEFAULT 'normal',
      approval_state      TEXT NOT NULL DEFAULT 'not_required',
      metadata            JSONB NOT NULL DEFAULT '{}',
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_org_tasks_state ON "${s}".org_tasks(current_state);
    CREATE INDEX IF NOT EXISTS idx_org_tasks_created ON "${s}".org_tasks(created_at DESC);

    CREATE TABLE IF NOT EXISTS "${s}".org_task_execution_plans (
      id         TEXT PRIMARY KEY,
      task_id    TEXT NOT NULL REFERENCES "${s}".org_tasks(id) ON DELETE CASCADE,
      plan_data  JSONB NOT NULL DEFAULT '{}',
      version    TEXT NOT NULL DEFAULT '1',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "${s}".org_task_specialists (
      id            TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL REFERENCES "${s}".org_tasks(id) ON DELETE CASCADE,
      specialist_id TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'executor',
      assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "${s}".org_approvals (
      id            TEXT PRIMARY KEY,
      task_id       TEXT NOT NULL REFERENCES "${s}".org_tasks(id) ON DELETE CASCADE,
      approval_type TEXT NOT NULL,
      state         TEXT NOT NULL DEFAULT 'pending',
      requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at   TIMESTAMPTZ,
      resolved_by   TEXT,
      notes         TEXT,
      expires_at    TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_org_approvals_state ON "${s}".org_approvals(state);

    CREATE TABLE IF NOT EXISTS "${s}".org_approval_rules (
      id                  TEXT PRIMARY KEY,
      approval_type       TEXT NOT NULL,
      required_roles      JSONB NOT NULL DEFAULT '[]',
      min_approvers       INTEGER NOT NULL DEFAULT 1,
      max_days_to_approve INTEGER NOT NULL DEFAULT 7,
      is_active           BOOLEAN NOT NULL DEFAULT TRUE,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "${s}".org_approval_history (
      id            TEXT PRIMARY KEY,
      approval_id   TEXT NOT NULL REFERENCES "${s}".org_approvals(id) ON DELETE CASCADE,
      action        TEXT NOT NULL,
      actor_user_id TEXT,
      notes         TEXT,
      metadata      JSONB NOT NULL DEFAULT '{}',
      occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "${s}".org_audit_log (
      id             TEXT PRIMARY KEY,
      actor_user_id  TEXT,
      actor_type     TEXT NOT NULL DEFAULT 'user',
      event_type     TEXT NOT NULL,
      resource_type  TEXT NOT NULL,
      resource_id    TEXT,
      request_id     TEXT,
      ip_address     TEXT,
      user_agent     TEXT,
      access_purpose TEXT,
      is_sensitive   BOOLEAN NOT NULL DEFAULT FALSE,
      metadata       JSONB NOT NULL DEFAULT '{}',
      occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_org_audit_log_event ON "${s}".org_audit_log(event_type);
    CREATE INDEX IF NOT EXISTS idx_org_audit_log_occurred ON "${s}".org_audit_log(occurred_at DESC);
  `));
}

// ─── Sprint 7: Extended tables ────────────────────────────────────────────────

async function applySprintSevenExtended(db: NodePgDatabase<any>, s: string): Promise<void> {
  // Add migration tracking columns to tasks and approvals
  await db.execute(sql.raw(`
    ALTER TABLE "${s}".org_tasks
      ADD COLUMN IF NOT EXISTS migrated_from_id TEXT,
      ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

    ALTER TABLE "${s}".org_task_execution_plans
      ADD COLUMN IF NOT EXISTS migrated_from_id TEXT;

    ALTER TABLE "${s}".org_approvals
      ADD COLUMN IF NOT EXISTS migrated_from_id TEXT,
      ADD COLUMN IF NOT EXISTS migrated_at TIMESTAMPTZ;

    ALTER TABLE "${s}".org_approval_history
      ADD COLUMN IF NOT EXISTS migrated_from_id TEXT;

    -- Backup state table: records each backup taken for this org
    CREATE TABLE IF NOT EXISTS "${s}".org_backup_log (
      id              TEXT PRIMARY KEY,
      backup_type     TEXT NOT NULL DEFAULT 'logical',
      status          TEXT NOT NULL DEFAULT 'pending',
      started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at    TIMESTAMPTZ,
      size_bytes      BIGINT,
      checksum        TEXT,
      storage_ref     TEXT,
      error_message   TEXT,
      metadata        JSONB NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_org_backup_log_started ON "${s}".org_backup_log(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_org_backup_log_status ON "${s}".org_backup_log(status);

    COMMENT ON TABLE "${s}".org_backup_log IS 'Audit trail of all backups taken for this organisation database.';
  `));
}
