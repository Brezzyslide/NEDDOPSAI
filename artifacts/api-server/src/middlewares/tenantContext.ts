/**
 * Tenant context middleware — Sprint 1 core security layer
 *
 * Security non-negotiables:
 * 1. The tenant UUID (organizationId) is the ONLY authoritative security boundary.
 *    The slug is a UX convenience and is never trusted as the boundary.
 * 2. Every tenant-scoped DB query must include WHERE organization_id = :tenantId
 *    using the resolved UUID, never the slug.
 * 3. A suspended or revoked membership is denied access even if authentication is valid.
 * 4. Inactive (closed/suspended) tenants are denied access.
 *
 * Usage:
 *   router.get("/secret", requireAuth, resolveTenantFromSlug, routeHandler)
 *   router.get("/secret", requireAuth, resolveTenantFromSlug,
 *     requirePermission("audit:read"), routeHandler)
 */

import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  MembershipRequired,
  TenantNotFound,
  AuthenticationRequired,
} from "../lib/errors.js";
import { ROLE_PERMISSIONS } from "@workspace/permissions";
import type { TenantContext } from "@workspace/auth";

type ResolvedAuthTenantContext = {
  user_id: string;
  user_external_id: string;
  user_email: string;
  user_first_name: string | null;
  user_last_name: string | null;
  user_display_name: string | null;
  user_status: "pending_verification" | "active" | "suspended" | "deactivated";
  organization_id: string;
  organization_slug: string;
  organization_status: string;
  membership_id: string;
  membership_role: keyof typeof ROLE_PERMISSIONS;
  membership_status: string;
};

// ─── requireAuth ──────────────────────────────────────────────────────────────

/**
 * Ensures the request has a valid Clerk session and a provisioned DB user.
 * Attaches `req.appUser` for downstream use.
 *
 * JIT provisioning: if the Clerk-authenticated user has no DB record yet,
 * this middleware creates one automatically on first request.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = getAuth(req);
    const externalUserId = auth?.userId;

    if (!externalUserId) {
      throw new AuthenticationRequired();
    }

    (req as any).authExternalUserId = externalUserId;

    if (req.params.slug) {
      next();
      return;
    }

    // Legacy non-tenant/platform route lookup. Slugged tenant routes resolve
    // through resolve_auth_tenant_context() so needsops_app does not need direct
    // table access before app.current_organization_id is set.
    let [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.externalId, externalUserId))
      .limit(1);

    // JIT provisioning: create the DB record on first authenticated request
    if (!user) {
      const { randomUUID } = await import("crypto");
      const email =
        (auth.sessionClaims?.email as string | undefined) ?? `${externalUserId}@unknown.clerk`;
      const firstName = auth.sessionClaims?.given_name as string | undefined;
      const lastName = auth.sessionClaims?.family_name as string | undefined;

      const [created] = await db
        .insert(usersTable)
        .values({
          id: randomUUID(),
          externalId: externalUserId,
          email,
          firstName: firstName ?? null,
          lastName: lastName ?? null,
          status: "active",
        })
        .returning();

      user = created!;
    }

    if (user.status === "suspended" || user.status === "deactivated") {
      res.status(403).json({
        error: { code: "USER_SUSPENDED", message: "Your account has been suspended." },
      });
      return;
    }

    req.appUser = user;
    next();
  } catch (err) {
    if (err instanceof AuthenticationRequired) {
      res.status(401).json({ error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  }
}

// ─── resolveTenantFromSlug ────────────────────────────────────────────────────

/**
 * Resolves the tenant context from the `:slug` route param.
 *
 * Requires `requireAuth` to have run first (needs `req.appUser`).
 * On success, attaches `req.tenantContext` with the resolved UUID, role,
 * and pre-computed permission list.
 *
 * Checks (in order):
 *  1. Org exists
 *  2. Org is active or in onboarding
 *  3. User has an active membership in this org
 */
export async function resolveTenantFromSlug(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const slug = String(req.params.slug);
    const externalUserId =
      ((req as any).authExternalUserId as string | undefined) ?? req.appUser?.externalId;

    if (!externalUserId) throw new AuthenticationRequired();
    if (!slug) throw new TenantNotFound();

    const resolved = await db.execute<ResolvedAuthTenantContext>(sql`
      SELECT *
      FROM public.resolve_auth_tenant_context(${externalUserId}, ${slug})
      LIMIT 1
    `);
    const row = resolved.rows[0];

    if (!row) throw new MembershipRequired();

    const tenantContext: TenantContext = {
      userId: row.user_id,
      externalUserId: row.user_external_id,
      tenantId: row.organization_id,   // UUID — the real security boundary
      tenantSlug: row.organization_slug,
      membershipId: row.membership_id,
      role: row.membership_role as TenantContext["role"],
      permissions: ROLE_PERMISSIONS[row.membership_role] ?? [],
    };

    req.appUser = {
      id: row.user_id,
      externalId: row.user_external_id,
      email: row.user_email,
      firstName: row.user_first_name,
      lastName: row.user_last_name,
      displayName: row.user_display_name,
      status: row.user_status,
    };
    req.tenantContext = tenantContext;
    next();
  } catch (err) {
    if (err instanceof TenantNotFound) {
      res.status(404).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (err instanceof MembershipRequired) {
      res.status(403).json({ error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  }
}
