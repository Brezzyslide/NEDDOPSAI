import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import type { PermissionAction } from "@workspace/permissions";

/**
 * Factory that returns a middleware enforcing a specific permission action.
 * Must run AFTER `resolveTenantFromSlug` (needs `req.tenantContext`).
 *
 * Usage:
 *   router.delete("/:id", requireAuth, resolveTenantFromSlug,
 *     requirePermission("member:remove"), handler)
 */
export function requirePermission(action: PermissionAction) {
  return function checkPermission(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const ctx = req.tenantContext;
    if (!ctx) {
      res.status(401).json({
        error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required." },
      });
      return;
    }

    if (!(ctx.permissions as string[]).includes(action)) {
      res.status(403).json({
        error: {
          code: "PERMISSION_DENIED",
          message: `Your role '${ctx.role}' does not have the '${action}' permission.`,
        },
      });
      return;
    }

    next();
  };
}

/**
 * Requires the authenticated user to have the `platformAdmin: true` flag
 * in their Clerk publicMetadata. Only for /v1/admin/* routes.
 */
export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  const meta = auth?.sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
  if (!meta?.platformAdmin) {
    res.status(403).json({
      error: { code: "PERMISSION_DENIED", message: "Platform admin access required." },
    });
    return;
  }
  next();
}
