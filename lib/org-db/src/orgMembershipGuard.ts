/**
 * Organisation Membership Guard — Sprint 7.1
 *
 * Enforces local membership inside the Operational Database before any
 * operational request is executed. This is the second layer of access
 * control (after the platform DB membership check).
 *
 * Access flow:
 *   1. Authenticate user (platform auth middleware)
 *   2. Resolve org from platform session (withOrgContext registry lookup)
 *   3. withOrgContext() — verifies org is active in registry, sets RLS context
 *   4. checkLocalMembership() — verifies user has an active org_memberships row
 *   5. Verify local role/permission
 *   6. Execute operational request
 *
 * Security guarantees:
 *   • Missing membership → fails closed (no access)
 *   • Suspended membership → fails closed
 *   • Removed membership → fails closed
 *   • Cross-org membership cannot be reused (platform_user_id must match)
 *   • Organisation suspension is already caught by withOrgContext() status check
 *   • Owner/admin status does NOT bypass this check
 *   • No client-supplied input (body, slug, URL) can control routing
 */

import { sql } from "drizzle-orm";
import { withOrgContext, type OrgConnectionContext, type OrgConnection, OrgConnectionError } from "./orgConnectionManager";

// ─── Error type ───────────────────────────────────────────────────────────────

export class OrgMembershipError extends Error {
  public readonly code:
    | "MISSING_MEMBERSHIP"
    | "SUSPENDED_MEMBERSHIP"
    | "REMOVED_MEMBERSHIP"
    | "ORG_NOT_PROVISIONED";

  constructor(
    message: string,
    code: OrgMembershipError["code"],
  ) {
    super(message);
    this.name = "OrgMembershipError";
    this.code = code;
  }
}

// ─── Core guard ───────────────────────────────────────────────────────────────

export interface LocalMembership {
  id: string;
  platformUserId: string;
  role: string;
  status: string;
  permissions: Record<string, unknown>;
  clinicalAccess: string;
  canApproveAiOutputs: boolean;
}

/**
 * Checks that the authenticated user has an active local membership record
 * in the org schema's org_memberships table.
 *
 * Must be called within a withOrgContext() callback (conn is required).
 *
 * @throws OrgMembershipError if membership is missing, suspended, or removed
 */
export async function checkLocalMembership(
  conn: OrgConnection,
  platformUserId: string,
): Promise<LocalMembership> {
  const result = await conn.db.execute(
    sql.raw(`
      SELECT id, platform_user_id, role, status, permissions,
             clinical_access, can_approve_ai_outputs
      FROM "${conn.schemaName}".org_memberships
      WHERE platform_user_id = '${platformUserId.replace(/'/g, "''")}'
      LIMIT 1
    `),
  );

  const row = result.rows[0] as Record<string, unknown> | undefined;

  if (!row) {
    throw new OrgMembershipError(
      `User ${platformUserId} does not have a local membership in this organisation. ` +
      "They must be explicitly added to the organisation before accessing operational data.",
      "MISSING_MEMBERSHIP",
    );
  }

  const status = row["status"] as string;

  if (status === "suspended") {
    throw new OrgMembershipError(
      `User ${platformUserId} local membership is suspended in this organisation.`,
      "SUSPENDED_MEMBERSHIP",
    );
  }

  if (status === "revoked") {
    throw new OrgMembershipError(
      `User ${platformUserId} local membership has been revoked in this organisation.`,
      "REMOVED_MEMBERSHIP",
    );
  }

  if (status !== "active") {
    throw new OrgMembershipError(
      `User ${platformUserId} local membership status is "${status}" — only active members can access operational data.`,
      "SUSPENDED_MEMBERSHIP",
    );
  }

  return {
    id: row["id"] as string,
    platformUserId: row["platform_user_id"] as string,
    role: row["role"] as string,
    status,
    permissions: (row["permissions"] as Record<string, unknown>) ?? {},
    clinicalAccess: row["clinical_access"] as string,
    canApproveAiOutputs: Boolean(row["can_approve_ai_outputs"]),
  };
}

// ─── Higher-order context ─────────────────────────────────────────────────────

export interface OrgMemberContext {
  /** The org connection (use for all DB operations within the callback) */
  conn: OrgConnection;
  /** The verified local membership record */
  membership: LocalMembership;
  /** Convenience: the authenticated user's org-local role */
  role: string;
}

/**
 * withOrgMemberContext — the enforced access path for all operational routes.
 *
 * Combines withOrgContext() + checkLocalMembership() in a single call.
 * The callback only executes when:
 *   1. The org is active in the platform DB registry
 *   2. The user has an active local membership in the org schema
 *
 * Usage:
 *   const result = await withOrgMemberContext(
 *     { tenantId, userId, purpose: "task_read" },
 *     async ({ conn, membership }) => {
 *       // safe to read org_tasks here
 *     }
 *   );
 *
 * @throws OrgConnectionError — org not provisioned, suspended, or routing failure
 * @throws OrgMembershipError — membership missing, suspended, or removed
 */
export async function withOrgMemberContext<T>(
  ctx: OrgConnectionContext,
  fn: (context: OrgMemberContext) => Promise<T>,
): Promise<T> {
  return withOrgContext(ctx, async (conn) => {
    const membership = await checkLocalMembership(conn, ctx.userId);
    return fn({ conn, membership, role: membership.role });
  });
}
