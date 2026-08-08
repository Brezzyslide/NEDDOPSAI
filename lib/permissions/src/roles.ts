/**
 * @workspace/permissions — Sprint 1 role hierarchy and permission map
 *
 * Six membership roles in descending authority:
 *   owner > administrator > manager > member > viewer > auditor
 *
 * Note: auditor is a special read-only role for compliance/audit purposes;
 * it sits "beside" the hierarchy rather than strictly below viewer.
 */

import type { MembershipRole } from "@workspace/shared";

// ─── Role hierarchy ───────────────────────────────────────────────────────────

/** Ordered lowest → highest authority. Auditor is separate (read-only compliance role). */
export const ROLE_HIERARCHY: MembershipRole[] = [
  "auditor",
  "viewer",
  "member",
  "manager",
  "administrator",
  "owner",
] as const;

/**
 * Returns true if `userRole` has equal or higher authority than `requiredRole`.
 * Auditor is treated as having the lowest operational authority.
 */
export function roleAtLeast(
  userRole: MembershipRole,
  requiredRole: MembershipRole,
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
  // Users / members
  | "member:read"
  | "member:invite"
  | "member:update_role"
  | "member:suspend"
  | "member:reactivate"
  | "member:remove"
  // Invitations
  | "invitation:read"
  | "invitation:create"
  | "invitation:resend"
  | "invitation:revoke"
  // Workforce packs
  | "workforce:read"
  | "workforce:activate"
  | "workforce:deactivate"
  // AI workers / tasks
  | "worker:read"
  | "worker:assign"
  | "worker:manage"
  | "worker:approve"
  // Audit
  | "audit:read"
  // Security settings
  | "security:manage"
  // Billing (Sprint 2+)
  | "billing:read"
  | "billing:manage"
  // Organisation settings
  | "settings:read"
  | "settings:update"
  // AI Task Execution (Sprint 8)
  | "task:execute"
  // Governance — Sprint 29M.3
  // Separate "resolve work approvals" from "resolve authority/governance approvals"
  // so manager can approve ordinary operational deliverables without gaining
  // access to knowledge authority, Memory governance, or Blueprint publishing.
  | "governance:resolve_work"      // operational work approvals (manager+)
  | "governance:resolve_authority" // knowledge authority / Memory / Blueprint / compliance (administrator+)
  | "memory:govern"                // approve / reject / merge / supersede org memory
  | "knowledge:govern"             // mark authoritative / revoke / supersede knowledge sources
  | "blueprint:govern";            // publish / archive / rollback blueprints

// ─── Role permission map ──────────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<MembershipRole, PermissionAction[]> = {
  owner: [
    "organization:read",
    "organization:update",
    "organization:delete",
    "member:read",
    "member:invite",
    "member:update_role",
    "member:suspend",
    "member:reactivate",
    "member:remove",
    "invitation:read",
    "invitation:create",
    "invitation:resend",
    "invitation:revoke",
    "workforce:read",
    "workforce:activate",
    "workforce:deactivate",
    "worker:read",
    "worker:assign",
    "worker:manage",
    "worker:approve",
    "audit:read",
    "security:manage",
    "billing:read",
    "billing:manage",
    "settings:read",
    "settings:update",
    "task:execute",
    "governance:resolve_work",
    "governance:resolve_authority",
    "memory:govern",
    "knowledge:govern",
    "blueprint:govern",
  ],
  administrator: [
    "organization:read",
    "organization:update",
    "member:read",
    "member:invite",
    "member:update_role",
    "member:suspend",
    "member:reactivate",
    "member:remove",
    "invitation:read",
    "invitation:create",
    "invitation:resend",
    "invitation:revoke",
    "workforce:read",
    "workforce:activate",
    "workforce:deactivate",
    "worker:read",
    "worker:assign",
    "worker:manage",
    "audit:read",
    "security:manage",
    "billing:read",
    "settings:read",
    "settings:update",
    "task:execute",
    "governance:resolve_work",
    "governance:resolve_authority",
    "memory:govern",
    "knowledge:govern",
    "blueprint:govern",
  ],
  manager: [
    "organization:read",
    "member:read",
    "invitation:read",
    "workforce:read",
    "workforce:activate",
    "worker:read",
    "worker:assign",
    "worker:approve",
    "settings:read",
    "task:execute",
    "governance:resolve_work",
  ],
  member: [
    "organization:read",
    "member:read",
    "workforce:read",
    "worker:read",
    "worker:assign",
    "settings:read",
  ],
  viewer: [
    "organization:read",
    "member:read",
    "workforce:read",
    "worker:read",
  ],
  auditor: [
    "organization:read",
    "member:read",
    "audit:read",
    "workforce:read",
    "worker:read",
  ],
};
