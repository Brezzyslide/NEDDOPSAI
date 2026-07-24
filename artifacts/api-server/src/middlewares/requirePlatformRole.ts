/**
 * Platform role middleware — Sprint 3
 *
 * Platform roles are stored in the platform_roles table and are completely
 * separate from organisation membership roles.
 *
 * Gate order:
 *  1. Clerk session must be valid (requireAuth must run first)
 *  2. DB platform_roles table must have an active row for this user
 *  3. The row's role must match the required role (or be super_admin)
 *
 * The existing Clerk publicMetadata.platformAdmin flag is kept as an emergency
 * bootstrap gate for the very first platform admin. All production gates use DB.
 */

import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, platformRolesTable, usersTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import type { PlatformRole } from "@workspace/shared";

// Cache (request-scoped) — populated by requirePlatformAuth
declare module "express-serve-static-core" {
  interface Request {
    platformRole?: PlatformRole;
    platformUserId?: string;
  }
}

function forbidden(res: Response, message = "Platform access required."): void {
  res.status(403).json({ error: { code: "PERMISSION_DENIED", message } });
}

/**
 * Verifies the authenticated user has any active platform role.
 * Attaches req.platformRole and req.platformUserId.
 * Must run after requireAuth (needs req.appUser).
 */
export async function requirePlatformAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = req.appUser;
    if (!user) {
      forbidden(res);
      return;
    }

    // Bootstrap: allow Clerk publicMetadata.platformAdmin = true (for first admin)
    const auth = getAuth(req);
    const meta = auth?.sessionClaims?.publicMetadata as Record<string, unknown> | undefined;
    if (meta?.platformAdmin) {
      req.platformUserId = user.id;
      req.platformRole = "platform_super_admin";
      next();
      return;
    }

    // DB check
    const [roleRow] = await db
      .select()
      .from(platformRolesTable)
      .where(
        and(
          eq(platformRolesTable.userId, user.id),
          isNull(platformRolesTable.revokedAt),
        ),
      )
      .limit(1);

    if (!roleRow) {
      forbidden(res, "Platform console access requires a platform role assignment.");
      return;
    }

    req.platformRole = roleRow.role as PlatformRole;
    req.platformUserId = user.id;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Factory: requires a specific platform role (or super_admin can always access).
 * Must run after requirePlatformAuth.
 */
export function requirePlatformRole(role: PlatformRole) {
  const SUPER_ADMIN = "platform_super_admin";
  return function checkPlatformRole(req: Request, res: Response, next: NextFunction): void {
    const userRole = req.platformRole;
    if (!userRole) {
      forbidden(res);
      return;
    }
    if (userRole === SUPER_ADMIN || userRole === role) {
      next();
      return;
    }
    forbidden(res, `This action requires the '${role}' platform role.`);
  };
}

/**
 * Backwards-compatible alias for existing /v1/admin/* routes.
 * Accepts Clerk platformAdmin flag OR any DB platform role.
 */
export { requirePlatformAuth as requirePlatformAdmin };
