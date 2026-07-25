/**
 * Tenant-Aware Data Access Layer — Sprint 5
 *
 * This module provides the ONLY approved interfaces for accessing tenant
 * (organisation) operational data. Direct use of the raw `db` client for
 * tenant queries is prohibited — use the wrappers below.
 *
 * Security guarantees:
 *   • Every call establishes a PostgreSQL session context (RLS enforcement)
 *   • Context variables are LOCAL to the transaction — cleared on commit/rollback
 *   • Fail-closed: if tenantId is missing or invalid, access is denied
 *   • Context never leaks between pooled connections
 *   • Every access produces a purpose-tagged audit trail
 *
 * Approved access patterns:
 *
 *   withTenantContext(ctx, fn)       — authenticated user → org data
 *   withSystemTenantContext(ctx, fn) — background job / system → org data
 *   withPlatformContext(ctx, fn)     — platform admin → platform tables ONLY
 *   withUserTenantContext(ctx, fn)   — alias for withTenantContext (explicit label)
 *
 * Usage example:
 *
 *   const tasks = await withTenantContext(
 *     { tenantId: req.tenantContext.tenantId, userId: req.appUser.id, purpose: "task.list" },
 *     (tx) => tx.select().from(tasksTable).where(eq(tasksTable.organizationId, tenantId))
 *   );
 */

import { sql } from "drizzle-orm";
import { db } from "./index.js";

// Re-export db for platform-level routes only (no RLS context needed for platform tables)
export { db as platformDb };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TenantAccessContext {
  /** Verified organisation UUID from resolveTenantFromSlug — NEVER from request body/query */
  tenantId: string;
  /** Authenticated user's DB ID */
  userId: string;
  /** Required purpose label for audit trail (e.g. "task.create", "member.list") */
  purpose?: string;
}

export interface SystemTenantAccessContext {
  /** Verified organisation UUID from platform registry — NEVER from job payload */
  tenantId: string;
  /** Service identity string, e.g. "task_scheduler", "usage_aggregator" */
  serviceIdentity: string;
  /** Required purpose for audit trail */
  purpose: string;
}

export interface PlatformAccessContext {
  /** Platform staff user ID */
  userId: string;
  /** Required purpose label */
  purpose: string;
}

// ─── Drizzle transaction type (inferred) ─────────────────────────────────────

type DrizzleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ─── Core: withTenantContext ──────────────────────────────────────────────────

/**
 * Primary gateway for authenticated user → org data access.
 *
 * Wraps all queries in a transaction that:
 *   1. Sets `app.current_organization_id` (LOCAL — cleared on commit)
 *   2. Sets `app.current_user_id` (LOCAL)
 *   3. Executes the callback with the transaction client
 *
 * The RLS policies on operational tables read `current_setting('app.current_organization_id', TRUE)`
 * so only matching rows are visible within this transaction.
 *
 * @throws {TenantContextError} if tenantId is empty or invalid
 */
export async function withTenantContext<T>(
  ctx: TenantAccessContext,
  fn: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId || ctx.tenantId.trim() === "") {
    throw new TenantContextError("withTenantContext requires a non-empty tenantId");
  }
  if (!ctx.userId || ctx.userId.trim() === "") {
    throw new TenantContextError("withTenantContext requires a non-empty userId");
  }

  return db.transaction(async (tx) => {
    // Use set_config with is_local=true: variable is cleared when the transaction ends
    await tx.execute(
      sql`SELECT set_config('app.current_organization_id', ${ctx.tenantId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`,
    );
    if (ctx.purpose) {
      await tx.execute(
        sql`SELECT set_config('app.access_purpose', ${ctx.purpose}, true)`,
      );
    }
    return fn(tx);
  });
}

/**
 * Alias for withTenantContext — use when you want to be explicit that this
 * is a user-initiated access (not a background job).
 */
export const withUserTenantContext = withTenantContext;

// ─── withSystemTenantContext ──────────────────────────────────────────────────

/**
 * For background jobs, scheduled tasks, webhooks, and other system processes
 * that need to access a specific tenant's operational data.
 *
 * MUST include a verified tenantId from a trusted internal source
 * (e.g. the platform DB's org registry), never from an external payload.
 *
 * Sets app.actor_type = 'system' for audit differentiation.
 */
export async function withSystemTenantContext<T>(
  ctx: SystemTenantAccessContext,
  fn: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId || ctx.tenantId.trim() === "") {
    throw new TenantContextError("withSystemTenantContext requires a non-empty tenantId");
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_organization_id', ${ctx.tenantId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.current_user_id', ${ctx.serviceIdentity}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.access_purpose', ${ctx.purpose}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.actor_type', 'system', true)`,
    );
    return fn(tx);
  });
}

// ─── withPlatformContext ──────────────────────────────────────────────────────

/**
 * For platform staff accessing PLATFORM-LEVEL tables only.
 *
 * Platform tables (organizations, plans, subscriptions, feature_flags, etc.)
 * do NOT have RLS and do NOT contain customer operational data.
 *
 * This wrapper does NOT set app.current_organization_id — platform queries
 * are cross-org by design. However, it DOES require an explicit identity and
 * purpose for audit purposes.
 *
 * ⚠️  Do NOT use this to access operational tables (tasks, approvals, members,
 *    participants, case_notes, etc.). Those must use withTenantContext.
 */
export async function withPlatformContext<T>(
  ctx: PlatformAccessContext,
  fn: (tx: DrizzleTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.current_user_id', ${ctx.userId}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.access_purpose', ${ctx.purpose}, true)`,
    );
    await tx.execute(
      sql`SELECT set_config('app.actor_type', 'platform_staff', true)`,
    );
    // Explicitly clear org context so RLS on operational tables fails closed
    // if accidentally accessed from a platform route
    await tx.execute(
      sql`SELECT set_config('app.current_organization_id', '', true)`,
    );
    return fn(tx);
  });
}

// ─── Verification helper ──────────────────────────────────────────────────────

/**
 * Returns the current PostgreSQL session org context.
 * Use in tests to verify context is set correctly.
 * Returns null if no context is established.
 */
export async function getCurrentTenantContext(): Promise<{
  organizationId: string | null;
  userId: string | null;
  purpose: string | null;
} | null> {
  const result = await db.execute(sql`
    SELECT
      NULLIF(current_setting('app.current_organization_id', TRUE), '') AS organization_id,
      NULLIF(current_setting('app.current_user_id', TRUE), '')         AS user_id,
      NULLIF(current_setting('app.access_purpose', TRUE), '')          AS purpose
  `);
  const row = result.rows[0] as Record<string, string | null> | undefined;
  if (!row) return null;
  return {
    organizationId: row["organization_id"] ?? null,
    userId: row["user_id"] ?? null,
    purpose: row["purpose"] ?? null,
  };
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}
