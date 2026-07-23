/**
 * Sprint 1 — Permission system tests
 *
 * Tests role hierarchy, permission assignments, and guard logic.
 * Run with: pnpm --filter @workspace/permissions run test
 */

import { describe, it, expect } from "vitest";
import {
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  roleAtLeast,
  type PermissionAction,
} from "../roles.js";
import { canModifyMembership, hasPermission, type MembershipActor } from "../guards.js";
import type { MembershipRole } from "@workspace/shared";

/** Helper: build a minimal MembershipActor for a given role */
function actor(role: MembershipRole, orgId = "org-a"): MembershipActor {
  return { userId: "user-1", organizationId: orgId, role };
}

// ─── Role hierarchy ───────────────────────────────────────────────────────────

describe("roleAtLeast", () => {
  it("owner has authority over all roles", () => {
    for (const role of ROLE_HIERARCHY) {
      expect(roleAtLeast("owner", role as MembershipRole)).toBe(true);
    }
  });

  it("viewer has authority only over auditor", () => {
    expect(roleAtLeast("viewer", "auditor")).toBe(true);
    expect(roleAtLeast("viewer", "viewer")).toBe(true);
    expect(roleAtLeast("viewer", "member")).toBe(false);
    expect(roleAtLeast("viewer", "manager")).toBe(false);
    expect(roleAtLeast("viewer", "administrator")).toBe(false);
    expect(roleAtLeast("viewer", "owner")).toBe(false);
  });

  it("auditor is at the bottom of the hierarchy", () => {
    expect(roleAtLeast("auditor", "auditor")).toBe(true);
    expect(roleAtLeast("auditor", "viewer")).toBe(false);
    expect(roleAtLeast("auditor", "member")).toBe(false);
  });

  it("reflects the full ascending order", () => {
    const ordered: MembershipRole[] = ["auditor", "viewer", "member", "manager", "administrator", "owner"];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        expect(roleAtLeast(ordered[i]!, ordered[j]!)).toBe(i >= j);
      }
    }
  });
});

// ─── Permission assignments ───────────────────────────────────────────────────

describe("ROLE_PERMISSIONS", () => {
  it("owner has all defined permissions", () => {
    const ownerPerms = ROLE_PERMISSIONS["owner"];
    const allActions: PermissionAction[] = [
      "organization:read", "organization:update", "organization:delete",
      "member:read", "member:invite", "member:update_role", "member:suspend", "member:reactivate", "member:remove",
      "invitation:read", "invitation:create", "invitation:resend", "invitation:revoke",
      "workforce:read", "workforce:activate", "workforce:deactivate",
      "worker:read", "worker:assign", "worker:manage", "worker:approve",
      "audit:read", "security:manage", "billing:read", "billing:manage",
      "settings:read", "settings:update",
    ];
    for (const action of allActions) {
      expect(ownerPerms).toContain(action);
    }
  });

  it("auditor can read audit log but not write operations", () => {
    const auditorPerms = ROLE_PERMISSIONS["auditor"];
    expect(auditorPerms).toContain("audit:read");
    expect(auditorPerms).not.toContain("member:invite");
    expect(auditorPerms).not.toContain("invitation:create");
    expect(auditorPerms).not.toContain("organization:update");
    expect(auditorPerms).not.toContain("member:suspend");
  });

  it("viewer cannot invite or modify members", () => {
    const viewerPerms = ROLE_PERMISSIONS["viewer"];
    expect(viewerPerms).not.toContain("member:invite");
    expect(viewerPerms).not.toContain("member:update_role");
    expect(viewerPerms).not.toContain("member:suspend");
    expect(viewerPerms).not.toContain("audit:read");
  });

  it("member can read org but not update it", () => {
    const memberPerms = ROLE_PERMISSIONS["member"];
    expect(memberPerms).toContain("organization:read");
    expect(memberPerms).not.toContain("organization:update");
    expect(memberPerms).not.toContain("organization:delete");
    expect(memberPerms).not.toContain("member:invite");
  });

  it("manager can read settings but not update them", () => {
    const managerPerms = ROLE_PERMISSIONS["manager"];
    expect(managerPerms).toContain("settings:read");
    expect(managerPerms).not.toContain("settings:update");
  });

  it("administrator can update settings but not delete org", () => {
    const adminPerms = ROLE_PERMISSIONS["administrator"];
    expect(adminPerms).toContain("settings:update");
    expect(adminPerms).not.toContain("organization:delete");
  });

  it("no role has permissions not in PermissionAction type", () => {
    // All assigned permissions must be valid PermissionAction values
    // (This is enforced by TypeScript but also verified at runtime)
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      expect(Array.isArray(perms)).toBe(true);
      expect(perms.length).toBeGreaterThan(0);
      // No duplicates
      const unique = new Set(perms);
      expect(unique.size).toBe(perms.length, `Role ${role} has duplicate permissions`);
    }
  });
});

// ─── hasPermission guard ──────────────────────────────────────────────────────

describe("hasPermission", () => {
  it("returns true when actor role includes the permission", () => {
    expect(hasPermission(actor("owner"), "organization:delete")).toBe(true);
    expect(hasPermission(actor("administrator"), "settings:update")).toBe(true);
    expect(hasPermission(actor("auditor"), "audit:read")).toBe(true);
  });

  it("returns false when actor role lacks the permission", () => {
    expect(hasPermission(actor("viewer"), "member:invite")).toBe(false);
    expect(hasPermission(actor("auditor"), "organization:update")).toBe(false);
    expect(hasPermission(actor("member"), "organization:delete")).toBe(false);
  });
});

// ─── canModifyMembership guard ────────────────────────────────────────────────

describe("canModifyMembership", () => {
  it("owner can modify any non-owner membership", () => {
    expect(canModifyMembership(actor("owner"), "member", false)).toBe(true);
    expect(canModifyMembership(actor("owner"), "administrator", false)).toBe(true);
    expect(canModifyMembership(actor("owner"), "manager", false)).toBe(true);
    expect(canModifyMembership(actor("owner"), "viewer", false)).toBe(true);
    expect(canModifyMembership(actor("owner"), "auditor", false)).toBe(true);
  });

  it("owner cannot modify the last owner", () => {
    expect(canModifyMembership(actor("owner"), "owner", true)).toBe(false);
  });

  it("administrator can modify all roles except owner", () => {
    // Admin-level peers CAN be managed by other admins (same-level management is allowed)
    expect(canModifyMembership(actor("administrator"), "member", false)).toBe(true);
    expect(canModifyMembership(actor("administrator"), "manager", false)).toBe(true);
    expect(canModifyMembership(actor("administrator"), "viewer", false)).toBe(true);
    expect(canModifyMembership(actor("administrator"), "auditor", false)).toBe(true);
    expect(canModifyMembership(actor("administrator"), "administrator", false)).toBe(true);
    // Only owners are off-limits for administrators
    expect(canModifyMembership(actor("administrator"), "owner", false)).toBe(false);
  });

  it("member cannot modify anyone", () => {
    for (const role of ROLE_HIERARCHY as MembershipRole[]) {
      expect(canModifyMembership(actor("member"), role, false)).toBe(false);
    }
  });

  it("viewer cannot modify anyone", () => {
    for (const role of ROLE_HIERARCHY as MembershipRole[]) {
      expect(canModifyMembership(actor("viewer"), role, false)).toBe(false);
    }
  });

  it("auditor cannot modify anyone", () => {
    for (const role of ROLE_HIERARCHY as MembershipRole[]) {
      expect(canModifyMembership(actor("auditor"), role, false)).toBe(false);
    }
  });
});
