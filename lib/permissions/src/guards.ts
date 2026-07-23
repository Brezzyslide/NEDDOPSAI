/**
 * @workspace/permissions — Permission guards
 *
 * Utility functions for checking permissions. Sprint 1+ will integrate
 * these with the auth middleware to enforce access control in API routes.
 */

import type { AuthUser } from "@workspace/auth";
import { ROLE_PERMISSIONS, roleAtLeast } from "./roles.js";
import type { PermissionAction } from "./roles.js";
import type { UserRole } from "@workspace/shared";

/**
 * Returns true if the user has the given permission based on their role.
 */
export function hasPermission(
  user: AuthUser,
  action: PermissionAction,
): boolean {
  const allowed = ROLE_PERMISSIONS[user.role] ?? [];
  return allowed.includes(action);
}

/**
 * Returns true if the user's role meets the minimum required role.
 */
export function hasRole(user: AuthUser, minimumRole: UserRole): boolean {
  return roleAtLeast(user.role, minimumRole);
}

/**
 * Throws a permission error if the user does not have the required action.
 * Sprint 1: replace throw with an HTTP 403 response via Express middleware.
 */
export function assertPermission(
  user: AuthUser,
  action: PermissionAction,
): void {
  if (!hasPermission(user, action)) {
    throw new Error(
      `Permission denied: user role '${user.role}' cannot perform '${action}'`,
    );
  }
}

/**
 * Returns true if the user belongs to the given organisation.
 * This is the core tenant isolation check — every data-access guard must call this.
 */
export function belongsToOrg(user: AuthUser, organizationId: string): boolean {
  return user.organizationId === organizationId;
}

/**
 * Throws if the user does not belong to the given organisation.
 * Sprint 1: integrate into requireTenantAccess middleware.
 */
export function assertTenantAccess(
  user: AuthUser,
  organizationId: string,
): void {
  if (!belongsToOrg(user, organizationId)) {
    throw new Error(
      `Tenant access denied: user belongs to org '${user.organizationId}', not '${organizationId}'`,
    );
  }
}
