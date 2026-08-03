/**
 * RLS Verifier — Sprint 7
 *
 * Verifies that Row Level Security is enabled on all required tables in the
 * platform database. Called at server startup and by the health check route.
 *
 * Security requirement: the server MUST NOT start if any required table is
 * missing its RLS policy. A missing policy means operational customer data
 * could be cross-readable between tenants.
 *
 * Usage:
 *   import { verifyRLS } from "@workspace/org-db";
 *   await verifyRLS({ failFast: true }); // throws on startup if policy missing
 */

import { sql } from "drizzle-orm";
import { db as platformDb } from "@workspace/db";

// ─── Required tables ──────────────────────────────────────────────────────────

/**
 * All tables in the public schema that must have RLS enabled.
 * Update this list whenever a new tenant-scoped table is added.
 */
export const REQUIRED_RLS_TABLES = [
  "tasks",
  "task_specialists",
  "task_execution_plans",
  "approvals",
  "approval_rules",
  "approval_history",
  "memberships",
  "invitations",
  "tenant_subscriptions",
  "tenant_entitlements",
  "tenant_overrides",
  "tenant_settings",
  "tenant_addons",
  "tenant_usage_allowances",
  "tenant_workforce_packs",
  "usage_events",
  "usage_period_summaries",
  "org_audit_log",
  "audit_log",
  // Sprint 8 — Execution Runtime
  "execution_sessions",
  "execution_events",
  // Sprint 9 — Conversational Task Workroom
  "conversations",
  "conversation_messages",
  "conversation_participants",
  "message_attachments",
  "message_reads",
  // Sprint 9.2 — Tenant-Aware Chief of Staff Memory
  "organisation_memory",
  "conversation_memory",
  // Sprint 9.4 — Capability decisions
  "capability_decisions",
  // Sprint 9.5 — Specialist Runtime
  "specialist_runs",
  "specialist_queue",
  "specialist_run_memory",
  "specialist_conflicts",
  // Sprint 9.6 — Pack Commerce access requests (org-scoped)
  "workforce_pack_access_requests",
  // Sprint 14 — NeedsOps AI+ Installer, Device Management, Business Discovery
  "devices",
  "device_credentials",
  "device_activation_tokens",
  "device_runtime_status",
  "onboarding_sessions",
  "org_company_profile",
  "org_connected_systems",
  "device_approved_resources",
  "org_approval_rules_discovery",
  "org_discovery_answers",
  "org_discovery_status",
  "agent_configurations",
  // Sprint 15 — Production Transport, Auth, WS Relay
  "device_auth_challenges",
  "device_access_tokens",
  "device_refresh_tokens",
  "device_ws_sessions",
  "device_task_dispatch",
  // Sprint SRM Hardening — Organisation Specialist Configuration
  "organisation_specialist_configuration",
  // Sprint Knowledge Bridge (Task #14) — Specialist Language Profiles
  "specialist_language_profiles",
  // Task #15 — Knowledge Schema, Scopes & Secure Upload (Organisation Library)
  "knowledge_sources",
  "knowledge_source_scopes",
  "knowledge_source_versions",
  "knowledge_chunks",
  "specialist_training_status",
  "retrieval_audit_events",
  // Task #16 — Document Ingestion & Embedding Pipeline
  "ingestion_jobs",
  // Sprint 21 — Knowledge Curation Jobs
  "knowledge_curation_jobs",
  // Sprint 22 — Work Execution Engine & Completed Work
  "work_blueprints",
  "work_package_manifests",
  "completed_work",
  "completed_work_versions",
  "completed_work_comments",
  "completed_work_assets",
] as const;

export type RequiredRLSTable = typeof REQUIRED_RLS_TABLES[number];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RLSTableStatus {
  tableName: string;
  rlsEnabled: boolean;
  policyCount: number;
  hasTenantIsolationPolicy: boolean;
}

export interface RLSVerificationResult {
  allPoliciesPresent: boolean;
  checkedAt: Date;
  tableStatuses: RLSTableStatus[];
  missingRLS: string[];
  missingPolicies: string[];
}

export class RLSVerificationError extends Error {
  public readonly missingRLS: string[];
  public readonly missingPolicies: string[];

  constructor(result: RLSVerificationResult) {
    const parts: string[] = [];
    if (result.missingRLS.length > 0) {
      parts.push(`RLS not enabled: ${result.missingRLS.join(", ")}`);
    }
    if (result.missingPolicies.length > 0) {
      parts.push(`tenant_isolation policy missing: ${result.missingPolicies.join(", ")}`);
    }
    super(
      `[SECURITY] RLS verification failed at startup. ${parts.join(". ")}. ` +
      "Run lib/db/migrations/sprint7-platform-boundary.sql to restore policies. " +
      "DO NOT start the server with missing RLS policies.",
    );
    this.name = "RLSVerificationError";
    this.missingRLS = result.missingRLS;
    this.missingPolicies = result.missingPolicies;
  }
}

// ─── Core verification ────────────────────────────────────────────────────────

/**
 * Verifies RLS status on all required tables.
 *
 * @param options.failFast - If true, throws RLSVerificationError when any table fails.
 *                           Use at server startup. Default: false.
 */
export async function verifyRLS(options: { failFast?: boolean } = {}): Promise<RLSVerificationResult> {
  const tableList = REQUIRED_RLS_TABLES.join("', '");

  // Query pg_class for RLS status and pg_policies for policy presence
  const rlsResult = await platformDb.execute(sql.raw(`
    SELECT
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      COUNT(p.policyname) AS policy_count,
      BOOL_OR(p.policyname = 'tenant_isolation') AS has_tenant_isolation_policy
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
    WHERE n.nspname = 'public'
      AND c.relname IN ('${tableList}')
      AND c.relkind = 'r'
    GROUP BY c.relname, c.relrowsecurity
  `));

  const foundTables = new Map<string, RLSTableStatus>();
  for (const row of rlsResult.rows as any[]) {
    foundTables.set(row.table_name, {
      tableName: row.table_name,
      rlsEnabled: row.rls_enabled,
      policyCount: Number(row.policy_count),
      hasTenantIsolationPolicy: row.has_tenant_isolation_policy,
    });
  }

  const tableStatuses: RLSTableStatus[] = [];
  const missingRLS: string[] = [];
  const missingPolicies: string[] = [];

  for (const tableName of REQUIRED_RLS_TABLES) {
    const status = foundTables.get(tableName);

    if (!status) {
      // Table not found — treat as missing RLS (table may not exist yet)
      tableStatuses.push({
        tableName,
        rlsEnabled: false,
        policyCount: 0,
        hasTenantIsolationPolicy: false,
      });
      missingRLS.push(tableName);
      continue;
    }

    tableStatuses.push(status);

    if (!status.rlsEnabled) {
      missingRLS.push(tableName);
    } else if (!status.hasTenantIsolationPolicy) {
      missingPolicies.push(tableName);
    }
  }

  const result: RLSVerificationResult = {
    allPoliciesPresent: missingRLS.length === 0 && missingPolicies.length === 0,
    checkedAt: new Date(),
    tableStatuses,
    missingRLS,
    missingPolicies,
  };

  if (!result.allPoliciesPresent && options.failFast) {
    throw new RLSVerificationError(result);
  }

  return result;
}

// ─── Legacy write restriction check ──────────────────────────────────────────

/**
 * Tables that must be READ-ONLY for needsops_app from Sprint 7.1 onward.
 * Write access to these tables is a security boundary violation.
 */
export const LEGACY_WRITE_RESTRICTED_TABLES = [
  "audit_log",
  "org_audit_log",
  "tasks",
  "approvals",
  "approval_history",
  "task_execution_plans",
  "task_specialists",
] as const;

export type LegacyWriteRestrictedTable = typeof LEGACY_WRITE_RESTRICTED_TABLES[number];

export interface LegacyWriteCheckResult {
  allReadOnly: boolean;
  writeableTable: { tableName: string; privileges: string[] }[];
  checkedAt: Date;
}

/**
 * Verifies that needsops_app does NOT have INSERT, UPDATE, or DELETE
 * on any of the legacy write-restricted tables.
 *
 * Called at server startup — if any table is writeable, the server should
 * refuse to start (or emit a critical alert).
 */
export async function verifyLegacyTablesReadOnly(): Promise<LegacyWriteCheckResult> {
  const tableList = LEGACY_WRITE_RESTRICTED_TABLES.join("', '");

  const result = await platformDb.execute(sql.raw(`
    SELECT table_name, array_agg(privilege_type ORDER BY privilege_type) AS privileges
    FROM information_schema.role_table_grants
    WHERE grantee = 'needsops_app'
      AND table_schema = 'public'
      AND table_name IN ('${tableList}')
      AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
    GROUP BY table_name
    ORDER BY table_name
  `));

  const writeableTable = (result.rows as any[]).map(row => ({
    tableName: row.table_name as string,
    privileges: row.privileges as string[],
  }));

  return {
    allReadOnly: writeableTable.length === 0,
    writeableTable,
    checkedAt: new Date(),
  };
}

export class LegacyWriteError extends Error {
  public readonly writeableTables: string[];

  constructor(result: LegacyWriteCheckResult) {
    const tables = result.writeableTable.map(t => `${t.tableName}(${t.privileges.join(",")})`).join(", ");
    super(
      `[SECURITY] Legacy table write restriction violated. needsops_app still has write access to: ${tables}. ` +
      "Run lib/db/migrations/sprint71-write-restrictions.sql to apply REVOKE commands. " +
      "DO NOT start the server with write access on legacy operational tables.",
    );
    this.name = "LegacyWriteError";
    this.writeableTables = result.writeableTable.map(t => t.tableName);
  }
}

/**
 * Verify that the needsops_app role cannot bypass RLS.
 * Returns true if the role is safe; false if it can bypass (security risk).
 */
export async function verifyNeedsOpsAppRoleIsSecure(): Promise<{ secure: boolean; reason?: string }> {
  const result = await platformDb.execute(sql.raw(`
    SELECT rolbypassrls, rolsuper
    FROM pg_roles
    WHERE rolname = 'needsops_app'
    LIMIT 1
  `));

  if (result.rows.length === 0) {
    return { secure: false, reason: "needsops_app role does not exist" };
  }

  const row = result.rows[0] as any;
  if (row.rolbypassrls) {
    return { secure: false, reason: "needsops_app role has rolbypassrls=TRUE — RLS is bypassed" };
  }
  if (row.rolsuper) {
    return { secure: false, reason: "needsops_app role has SUPERUSER — RLS is bypassed" };
  }

  return { secure: true };
}
