/**
 * Organisation Database Provisioning Service — Sprint 6
 *
 * Provisions a new operational database/schema for an organisation.
 *
 * Current implementation: PostgreSQL schema within the shared cluster.
 * Target (Sprint 7): dedicated PostgreSQL database on managed host.
 *
 * Provisioning is:
 *   • Idempotent — safe to run multiple times; will not duplicate or overwrite
 *   • Retry-safe — each step is checked before execution
 *   • Observable — writes status and progress to org_database_registry
 *   • Auditable — records a platform audit event on completion
 *   • Reversible — schema can be dropped before first customer use
 *   • Protected against duplicate creation (unique constraint on schema_name)
 *
 * Security:
 *   • Schema name is derived from stable org UUID, never from slug
 *   • Format: org_<uuid_with_underscores>  (e.g. org_3b4ffe73_1234_5678_abcd_ef0123456789)
 *   • Credentials stored by reference only; actual secrets in secrets manager
 *
 * Steps:
 *   1. Validate org exists and is eligible
 *   2. Generate schema name from org UUID
 *   3. Check for existing registry entry (idempotency)
 *   4. Insert registry entry (status: provisioning)
 *   5. Create PostgreSQL schema
 *   6. Create required extensions
 *   7. Run operational DB schema migrations (create all org tables)
 *   8. Create initial org settings
 *   9. Run health check
 *  10. Mark registry entry as active + verified
 *  11. Record platform audit event
 */

import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db as platformDb, orgDatabaseRegistryTable, organizationsTable, platformAuditLogTable } from "@workspace/db";
import { getPoolStatus } from "./orgConnectionManager";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProvisionOrgDbInput {
  /** Verified org UUID — never accept from client */
  organizationId: string;
  /** Platform staff user ID performing the provisioning */
  provisionedBy?: string;
}

export interface ProvisionOrgDbResult {
  success:    boolean;
  schemaName: string;
  status:     string;
  steps:      ProvisioningStep[];
  error?:     string;
}

export interface ProvisioningStep {
  step:      string;
  status:    "completed" | "skipped" | "failed";
  message?:  string;
  durationMs: number;
}

// ─── Schema name derivation ────────────────────────────────────────────────────

/**
 * Derives a safe PostgreSQL schema name from an org UUID.
 * Never uses the slug (which can change).
 * Output: "org_3b4ffe73_1234_5678_abcd_ef0123456789"
 */
export function deriveSchemaName(organizationId: string): string {
  const safe = organizationId.replace(/-/g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "");
  return `org_${safe}`;
}

// ─── Main provisioning function ───────────────────────────────────────────────

export async function provisionOrgDb(input: ProvisionOrgDbInput): Promise<ProvisionOrgDbResult> {
  const steps: ProvisioningStep[] = [];
  const schemaName = deriveSchemaName(input.organizationId);

  const step = async (
    name: string,
    fn: () => Promise<{ status: "completed" | "skipped"; message?: string }>,
  ): Promise<void> => {
    const t = Date.now();
    try {
      const result = await fn();
      steps.push({ step: name, status: result.status, message: result.message, durationMs: Date.now() - t });
    } catch (err: any) {
      steps.push({ step: name, status: "failed", message: err?.message ?? "Unknown error", durationMs: Date.now() - t });
      throw err;
    }
  };

  try {
    // ── Step 1: Validate org ──────────────────────────────────────────────────
    await step("validate_org", async () => {
      const [org] = await platformDb
        .select({ id: organizationsTable.id, status: organizationsTable.status })
        .from(organizationsTable)
        .where(eq(organizationsTable.id, input.organizationId))
        .limit(1);

      if (!org) throw new Error(`Organisation ${input.organizationId} not found`);
      if (org.status === "closed") throw new Error(`Organisation is closed — cannot provision DB`);

      return { status: "completed", message: `Org ${input.organizationId} validated (status: ${org.status})` };
    });

    // ── Step 2: Check idempotency ─────────────────────────────────────────────
    let existingEntry: typeof orgDatabaseRegistryTable.$inferSelect | null = null;
    await step("check_existing_registry", async () => {
      const [existing] = await platformDb
        .select()
        .from(orgDatabaseRegistryTable)
        .where(eq(orgDatabaseRegistryTable.organizationId, input.organizationId))
        .limit(1);

      if (existing) {
        existingEntry = existing;
        if (existing.status === "active" && existing.isVerified) {
          return { status: "skipped", message: `Already provisioned and verified (schema: ${existing.schemaName})` };
        }
        return { status: "completed", message: `Re-provisioning from status: ${existing.status}` };
      }

      // Insert new registry entry
      await platformDb.insert(orgDatabaseRegistryTable).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        schemaName,
        internalLabel: `Org DB — ${input.organizationId}`,
        status: "provisioning",
        provisionedBy: input.provisionedBy ?? "system",
        metadata: { provisioningStartedAt: new Date().toISOString() },
      });

      return { status: "completed", message: `Registry entry created (schema: ${schemaName})` };
    });

    // If already active and verified, return early
    if (existingEntry && (existingEntry as any).status === "active" && (existingEntry as any).isVerified) {
      return {
        success: true,
        schemaName: (existingEntry as any).schemaName,
        status: "active",
        steps,
      };
    }

    // ── Step 3: Update status to provisioning ─────────────────────────────────
    await platformDb
      .update(orgDatabaseRegistryTable)
      .set({ status: "provisioning", updatedAt: new Date() })
      .where(eq(orgDatabaseRegistryTable.organizationId, input.organizationId));

    // ── Step 4: Create PostgreSQL schema ──────────────────────────────────────
    await step("create_schema", async () => {
      await platformDb.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`));
      return { status: "completed", message: `Schema "${schemaName}" created` };
    });

    // ── Step 5: Enable required extensions ───────────────────────────────────
    await step("enable_extensions", async () => {
      // pgvector for AI embeddings (Sprint 9) — enable now for future use
      try {
        await platformDb.execute(sql.raw(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`));
      } catch { /* non-fatal — may already exist */ }
      return { status: "completed", message: "Extensions checked" };
    });

    // ── Step 6: Create operational tables ────────────────────────────────────
    await step("create_operational_tables", async () => {
      await createOrgTables(schemaName);
      return { status: "completed", message: "Operational tables created in schema" };
    });

    // ── Step 7: Create initial org settings ──────────────────────────────────
    await step("seed_initial_settings", async () => {
      await seedOrgSettings(schemaName);
      return { status: "completed", message: "Initial org settings seeded" };
    });

    // ── Step 8: Health check ──────────────────────────────────────────────────
    await step("health_check", async () => {
      const result = await platformDb.execute(sql.raw(`
        SELECT COUNT(*) AS table_count
        FROM information_schema.tables
        WHERE table_schema = '${schemaName}'
      `));
      const tableCount = Number((result.rows[0] as any)?.table_count ?? 0);
      if (tableCount < 5) throw new Error(`Expected at least 5 tables, found ${tableCount}`);
      return { status: "completed", message: `${tableCount} tables verified` };
    });

    // ── Step 9: Mark active ───────────────────────────────────────────────────
    await step("mark_active", async () => {
      await platformDb
        .update(orgDatabaseRegistryTable)
        .set({
          status: "active",
          isVerified: true,
          migrationVersion: "sprint6-foundation",
          lastHealthCheckAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            provisioningCompletedAt: new Date().toISOString(),
            stepCount: steps.length,
          },
        })
        .where(eq(orgDatabaseRegistryTable.organizationId, input.organizationId));

      return { status: "completed", message: "Registry marked active and verified" };
    });

    // ── Step 10: Platform audit event ────────────────────────────────────────
    await step("audit_event", async () => {
      // actorUserId has FK to users table — only set when provisionedBy is a
      // real UUID user ID. For API-key / system provisioning, use null and
      // store the label in metadata.
      await platformDb.insert(platformAuditLogTable).values({
        id: randomUUID(),
        organizationId: input.organizationId,
        actorUserId: null,
        actorType: "system",
        eventType: "platform.org_database_provisioned",
        resourceType: "org_database",
        resourceId: schemaName,
        metadata: {
          schemaName,
          stepCount: steps.length,
          provisionedBy: input.provisionedBy ?? "system",
        },
      });
      return { status: "completed" };
    });

    return { success: true, schemaName, status: "active", steps };

  } catch (err: any) {
    // Update registry to failed status
    await platformDb
      .update(orgDatabaseRegistryTable)
      .set({
        status: "failed",
        updatedAt: new Date(),
        metadata: {
          failedAt: new Date().toISOString(),
          error: err?.message ?? "Unknown error",
          steps: steps.map(s => ({ step: s.step, status: s.status })),
        },
      })
      .where(eq(orgDatabaseRegistryTable.organizationId, input.organizationId))
      .catch(() => {}); // non-fatal

    return {
      success: false,
      schemaName,
      status: "failed",
      steps,
      error: err?.message ?? "Provisioning failed",
    };
  }
}

// ─── Deprovision (pre-customer-use only) ──────────────────────────────────────

export async function deprovisionOrgDb(organizationId: string, provisionedBy?: string): Promise<{ success: boolean; message: string }> {
  const [entry] = await platformDb
    .select()
    .from(orgDatabaseRegistryTable)
    .where(eq(orgDatabaseRegistryTable.organizationId, organizationId))
    .limit(1);

  if (!entry) return { success: false, message: "No registry entry found" };
  if (entry.isMigrated) return { success: false, message: "Cannot deprovision: org data has been migrated to this schema. Use the offboarding process." };

  await platformDb.execute(sql.raw(`DROP SCHEMA IF EXISTS "${entry.schemaName}" CASCADE`));

  await platformDb
    .update(orgDatabaseRegistryTable)
    .set({ status: "deprovisioned", updatedAt: new Date() })
    .where(eq(orgDatabaseRegistryTable.organizationId, organizationId));

  await platformDb.insert(platformAuditLogTable).values({
    id: randomUUID(),
    organizationId,
    actorUserId: null,
    actorType: "system",
    eventType: "platform.org_database_deprovisioned",
    resourceType: "org_database",
    resourceId: entry.schemaName,
    metadata: { schemaName: entry.schemaName, reason: "pre-customer deprovision", requestedBy: provisionedBy ?? "system" },
  });

  return { success: true, message: `Schema ${entry.schemaName} dropped` };
}

// ─── Internal: create tables ──────────────────────────────────────────────────

async function createOrgTables(schemaName: string): Promise<void> {
  const s = schemaName;

  // Enums must be created per-schema
  await platformDb.execute(sql.raw(`
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

  await platformDb.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS "${s}".org_settings (
      key         TEXT PRIMARY KEY,
      value       JSONB NOT NULL DEFAULT '{}',
      label       TEXT,
      updated_by  TEXT,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "${s}".org_memberships (
      id                    TEXT PRIMARY KEY,
      platform_user_id      TEXT NOT NULL,
      role                  TEXT NOT NULL DEFAULT 'member',
      status                TEXT NOT NULL DEFAULT 'active',
      permissions           JSONB NOT NULL DEFAULT '{}',
      clinical_access       TEXT NOT NULL DEFAULT 'none',
      can_approve_ai_outputs BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      id           TEXT PRIMARY KEY,
      approval_id  TEXT NOT NULL REFERENCES "${s}".org_approvals(id) ON DELETE CASCADE,
      action       TEXT NOT NULL,
      actor_user_id TEXT,
      notes        TEXT,
      metadata     JSONB NOT NULL DEFAULT '{}',
      occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

async function seedOrgSettings(schemaName: string): Promise<void> {
  await platformDb.execute(sql.raw(`
    INSERT INTO "${schemaName}".org_settings (key, value, label) VALUES
      ('ai_enabled',           'false',                     'AI Features Enabled'),
      ('ai_approval_required', 'true',                      'AI Outputs Require Human Approval'),
      ('data_retention_days',  '2555',                      'Data Retention (days, ~7 years)'),
      ('timezone',             '"Australia/Sydney"',        'Organisation Timezone'),
      ('currency',             '"AUD"',                     'Currency'),
      ('ndis_provider',        'false',                     'NDIS Registered Provider'),
      ('clinical_module',      'false',                     'Clinical Module Enabled')
    ON CONFLICT (key) DO NOTHING;
  `));
}
