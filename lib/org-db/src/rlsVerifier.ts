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
