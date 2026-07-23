/**
 * @workspace/permissions — Permission guards (Sprint 1)
 */

import { ROLE_PERMISSIONS, roleAtLeast } from "./roles.js";
import type { PermissionAction } from "./roles.js";
import type { MembershipRole } from "@workspace/shared";

// ─── Minimal actor interface (no express dependency) ─────────────────────────

export interface MembershipActor {
  userId: string;
  organizationId: string;
  role: MembershipRole;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

export function hasPermission(
  actor: MembershipActor,
  action: PermissionAction,
): boolean {
  const allowed = ROLE_PERMISSIONS[actor.role] ?? [];
  return allowed.includes(action);
}

export function hasRole(
  actor: MembershipActor,
  minimumRole: MembershipRole,
): boolean {
  return roleAtLeast(actor.role, minimumRole);
}

export function assertPermission(
  actor: MembershipActor,
  action: PermissionAction,
): void {
  if (!hasPermission(actor, action)) {
    throw new Error(
      `Permission denied: role '${actor.role}' cannot perform '${action}'`,
    );
  }
}

export function belongsToOrg(
  actor: MembershipActor,
  organizationId: string,
): boolean {
  return actor.organizationId === organizationId;
}

export function assertTenantAccess(
  actor: MembershipActor,
  organizationId: string,
): void {
  if (!belongsToOrg(actor, organizationId)) {
    throw new Error(
      `Tenant access denied: actor belongs to '${actor.organizationId}', not '${organizationId}'`,
    );
  }
}

/**
 * An administrator cannot remove or demote the final owner.
 * An owner cannot remove themselves if they are the only owner.
 */
export function canModifyMembership(
  actor: MembershipActor,
  targetRole: MembershipRole,
  isLastOwner: boolean,
): boolean {
  // No one can remove the last owner
  if (isLastOwner && targetRole === "owner") return false;
  // Administrators cannot demote/remove owners
  if (actor.role === "administrator" && targetRole === "owner") return false;
  // Must have at least administrator to modify memberships
  return roleAtLeast(actor.role, "administrator");
}
