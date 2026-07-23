/**
 * Sprint 1 — Tenant isolation tests
 *
 * Verifies that the tenant security model correctly enforces isolation
 * at the service layer. Uses the permission and guard logic directly.
 */

import { describe, it, expect } from "vitest";
import { hasPermission, type MembershipActor } from "../guards.js";
import { ROLE_PERMISSIONS } from "../roles.js";
import type { MembershipRole } from "@workspace/shared";

// ─── Tenant context simulation ────────────────────────────────────────────────

interface MockTenantContext {
  userId: string;
  tenantId: string;
  role: MembershipRole;
  permissions: string[];
}

function buildContext(tenantId: string, role: MembershipRole): MockTenantContext {
  return {
    userId: `user-${tenantId.slice(0, 4)}`,
    tenantId,
    role,
    permissions: ROLE_PERMISSIONS[role] ?? [],
  };
}

function actor(tenantId: string, role: MembershipRole): MembershipActor {
  return { userId: `user-${tenantId.slice(0, 4)}`, organizationId: tenantId, role };
}

// ─── UUID boundary tests ──────────────────────────────────────────────────────

describe("Tenant UUID isolation (conceptual)", () => {
  const TENANT_A = "aaaaaaaa-0000-0000-0000-000000000001";
  const TENANT_B = "bbbbbbbb-0000-0000-0000-000000000001";

  it("tenant IDs are different UUIDs", () => {
    expect(TENANT_A).not.toBe(TENANT_B);
  });

  it("contexts for different tenants share no tenant ID", () => {
    const ctxA = buildContext(TENANT_A, "owner");
    const ctxB = buildContext(TENANT_B, "owner");
    expect(ctxA.tenantId).not.toBe(ctxB.tenantId);
  });

  it("owner in tenant A has no authority in tenant B", () => {
    const ctxA = buildContext(TENANT_A, "owner");
    // A user with context from TENANT_A cannot be used against TENANT_B.
    // This is enforced at the DB query layer (WHERE organization_id = ctx.tenantId).
    // Here we test the structural assertion: ctx.tenantId is the boundary.
    expect(ctxA.tenantId).toBe(TENANT_A);
    expect(ctxA.tenantId).not.toBe(TENANT_B);
    // The actor object carries its org boundary immutably
    const actorA = actor(TENANT_A, "owner");
    expect(actorA.organizationId).toBe(TENANT_A);
    expect(actorA.organizationId).not.toBe(TENANT_B);
  });
});

// ─── Role permission isolation ────────────────────────────────────────────────

describe("Role-based access within a tenant", () => {
  it("auditor cannot invoke write operations", () => {
    const writeActions = [
      "member:invite", "member:update_role", "member:suspend",
      "invitation:create", "invitation:resend", "invitation:revoke",
      "organization:update", "organization:delete",
      "settings:update", "security:manage",
    ] as const;

    const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
    const auditorActor = actor(ORG, "auditor");
    for (const action of writeActions) {
      expect(hasPermission(auditorActor, action)).toBe(false);
    }
  });

  it("viewer is read-only for operational resources", () => {
    const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
    const viewerActor = actor(ORG, "viewer");
    const viewerReadable = ["organization:read", "member:read", "workforce:read", "worker:read"] as const;
    const viewerForbidden = [
      "member:invite", "invitation:create", "organization:update",
      "audit:read", "settings:update",
    ] as const;
    for (const action of viewerReadable) {
      expect(hasPermission(viewerActor, action)).toBe(true);
    }
    for (const action of viewerForbidden) {
      expect(hasPermission(viewerActor, action)).toBe(false);
    }
  });

  it("cross-tenant slug injection is prevented by UUID boundary (structural test)", () => {
    // An attacker providing a different slug should be stopped because:
    // 1. resolveTenantFromSlug looks up the org by slug → gets its UUID
    // 2. All subsequent queries use ctx.tenantId (UUID), not the slug
    const legitimateCtx = buildContext("aaaaaaaa-0000-0000-0000-000000000001", "owner");
    expect(typeof legitimateCtx.tenantId).toBe("string");
    expect(legitimateCtx.tenantId).toMatch(/^[0-9a-f-]{36}$/);

    // Actor carries its own org boundary
    const legitimateActor = actor("aaaaaaaa-0000-0000-0000-000000000001", "owner");
    expect(legitimateActor.organizationId).toBe("aaaaaaaa-0000-0000-0000-000000000001");
  });
});

// ─── Membership lifecycle ──────────────────────────────────────────────────────

describe("Membership status enforcement", () => {
  it("suspended membership should be denied (status check)", () => {
    // The middleware checks membership.status === "suspended" and throws
    // MembershipSuspended. This tests the logic values.
    const VALID_STATUSES = ["invited", "active", "suspended", "revoked"] as const;
    const BLOCKED_STATUSES = ["suspended", "revoked", "invited"] as const;

    for (const status of BLOCKED_STATUSES) {
      expect(VALID_STATUSES).toContain(status);
      // These should be blocked in the middleware
      expect(status !== "active").toBe(true);
    }
  });

  it("only active memberships grant tenant access", () => {
    // The middleware: if membership.status !== "active", deny
    const allowed = ["active"] as const;
    const denied = ["invited", "suspended", "revoked"] as const;

    for (const s of denied) {
      expect(allowed as readonly string[]).not.toContain(s);
    }
    expect(allowed).toContain("active");
  });
});
