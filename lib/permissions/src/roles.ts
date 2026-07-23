/**
 * @workspace/permissions — Role hierarchy and permission map
 *
 * NeedsOps AI+ uses a simple four-level role hierarchy within each organisation.
 * Roles are additive — higher roles inherit all permissions from lower roles.
 */

import type { UserRole } from "@workspace/shared";

// ─── Role hierarchy (higher index = more permissions) ────────────────────────

export const ROLE_HIERARCHY: UserRole[] = [
  "viewer",
  "member",
  "admin",
  "owner",
] as const;

/**
 * Returns true if `userRole` has equal or higher authority than `requiredRole`.
 */
export function roleAtLeast(
  userRole: UserRole,
  requiredRole: UserRole,
): boolean {
  return (
    ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(requiredRole)
  );
}

// ─── Permission actions ───────────────────────────────────────────────────────

export type PermissionAction =
  // Organizations
  | "organization:read"
  | "organization:update"
  | "organization:delete"
  // Users
  | "user:read"
  | "user:invite"
  | "user:update"
  | "user:remove"
  // Workforce packs
  | "workforce:read"
  | "workforce:activate"
  | "workforce:deactivate"
  // AI workers / tasks
  | "worker:read"
  | "worker:assign"
  | "worker:manage"
  // Audit logs
  | "audit:read"
  // Billing (Sprint 2+)
  | "billing:read"
  | "billing:manage";

// ─── Permission map ───────────────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<UserRole, PermissionAction[]> = {
  viewer: [
    "organization:read",
    "user:read",
    "workforce:read",
    "worker:read",
  ],
  member: [
    "organization:read",
    "user:read",
    "workforce:read",
    "workforce:activate",
    "worker:read",
    "worker:assign",
  ],
  admin: [
    "organization:read",
    "organization:update",
    "user:read",
    "user:invite",
    "user:update",
    "user:remove",
    "workforce:read",
    "workforce:activate",
    "workforce:deactivate",
    "worker:read",
    "worker:assign",
    "worker:manage",
    "audit:read",
    "billing:read",
  ],
  owner: [
    "organization:read",
    "organization:update",
    "organization:delete",
    "user:read",
    "user:invite",
    "user:update",
    "user:remove",
    "workforce:read",
    "workforce:activate",
    "workforce:deactivate",
    "worker:read",
    "worker:assign",
    "worker:manage",
    "audit:read",
    "billing:read",
    "billing:manage",
  ],
};
