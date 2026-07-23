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
  organizationsTable,
  membershipsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  MembershipRequired,
  MembershipSuspended,
  TenantInactive,
  TenantNotFound,
  AuthenticationRequired,
} from "../lib/errors.js";
import { ROLE_PERMISSIONS } from "@workspace/permissions";
import type { TenantContext } from "@workspace/auth";

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

    // Look up existing DB user
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
    const user = req.appUser;

    if (!user) throw new AuthenticationRequired();
    if (!slug) throw new TenantNotFound();

    // 1. Look up org by slug
    const [org] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.slug, slug))
      .limit(1);

    if (!org) throw new TenantNotFound();

    // 2. Check org is accessible
    if (org.status === "closed" || org.status === "suspended") {
      throw new TenantInactive();
    }

    // 3. Verify active membership — use org UUID (never slug) as the boundary
    const [membership] = await db
      .select()
      .from(membershipsTable)
      .where(
        and(
          eq(membershipsTable.organizationId, org.id),
          eq(membershipsTable.userId, user.id),
        ),
      )
      .limit(1);

    if (!membership) throw new MembershipRequired();
    if (membership.status === "suspended") throw new MembershipSuspended();
    if (membership.status === "revoked") throw new MembershipRequired();
    if (membership.status === "invited") throw new MembershipRequired();

    const tenantContext: TenantContext = {
      userId: user.id,
      externalUserId: user.externalId,
      tenantId: org.id,   // UUID — the real security boundary
      tenantSlug: org.slug,
      membershipId: membership.id,
      role: membership.role as TenantContext["role"],
      permissions: ROLE_PERMISSIONS[membership.role as keyof typeof ROLE_PERMISSIONS] ?? [],
    };

    req.tenantContext = tenantContext;
    next();
  } catch (err) {
    if (err instanceof TenantNotFound) {
      res.status(404).json({ error: { code: err.code, message: err.message } });
      return;
    }
    if (
      err instanceof TenantInactive ||
      err instanceof MembershipRequired ||
      err instanceof MembershipSuspended
    ) {
      res.status(403).json({ error: { code: err.code, message: err.message } });
      return;
    }
    next(err);
  }
}
