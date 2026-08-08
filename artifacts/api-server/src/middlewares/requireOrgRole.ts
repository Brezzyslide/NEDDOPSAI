/**
 * requireOrgRole — Canonical organisation role enforcement middleware
 *
 * Sprint 29M.3: Replaces the five scattered inline `requireOwnerOrAdmin`
 * helpers that incorrectly compared against "admin" (not "administrator").
 *
 * Usage:
 *   router.post("/...", requireAuth, resolveTenantFromSlug, requireOrgRole("owner", "administrator"), handler)
 *   router.post("/...", requireAuth, resolveTenantFromSlug, requireOwnerOrAdmin, handler)
 */

import type { Request, Response, NextFunction } from "express";
import type { MembershipRole } from "@workspace/shared";

/**
 * Returns 403 unless the authenticated tenant user holds one of the specified
 * organisation membership roles.  Must be placed after `resolveTenantFromSlug`
 * (which attaches `req.tenantContext`).
 *
 * @param allowedRoles - One or more canonical org roles.  Use "administrator",
 *   not "admin".  Platform role strings such as "platform_admin" are not valid
 *   here — use requirePlatformRole for those.
 */
export function requireOrgRole(...allowedRoles: MembershipRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = (req as any).tenantContext?.role as MembershipRole | undefined;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({
        error: {
          code: "INSUFFICIENT_ROLE",
          message: `This action requires one of the following roles: ${allowedRoles.join(", ")}.`,
          requiredRoles: allowedRoles,
          currentRole: role ?? null,
        },
      });
      return;
    }
    next();
  };
}

// ─── Convenience shorthands ───────────────────────────────────────────────────

/** owner + administrator — the primary "admin" boundary throughout the product.
 *  Previously broken by the "admin" vs "administrator" naming drift. */
export const requireOwnerOrAdmin = requireOrgRole("owner", "administrator");

/** owner + administrator + manager — for operational work approvals. */
export const requireAtLeastManager = requireOrgRole("owner", "administrator", "manager");

/** owner only — for organisation-deletion-level or billing-ownership actions. */
export const requireOwner = requireOrgRole("owner");
