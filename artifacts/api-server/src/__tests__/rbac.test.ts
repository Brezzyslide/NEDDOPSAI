/**
 * RBAC Security Test Matrix — Sprint 29M.3
 *
 * 17 tests covering the RED-1 through RED-4 defects plus role boundary
 * regression for all six canonical org roles.
 *
 * Canonical org roles (correct spelling):
 *   owner | administrator | manager | member | viewer | auditor
 *
 * "admin" (short form) must never match — if it does, RED-1 is still broken.
 */

import { describe, it, expect, vi } from "vitest";
import {
  requireOrgRole,
  requireOwnerOrAdmin,
  requireAtLeastManager,
  requireOwner,
} from "../middlewares/requireOrgRole.js";
import { ROLE_PERMISSIONS } from "@workspace/permissions";

// ─── Shared mock factory ──────────────────────────────────────────────────────

type MockRole = string | undefined;

function makeReqRes(role: MockRole) {
  const req: any = { tenantContext: role ? { role } : undefined };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  const next = vi.fn();
  return { req, res, next };
}

function expectGranted(role: MockRole, mw: ReturnType<typeof requireOrgRole>) {
  const { req, res, next } = makeReqRes(role);
  mw(req, res, next);
  expect(next).toHaveBeenCalledOnce();
  expect(res.statusCode).toBe(200);
}

function expectDenied(role: MockRole, mw: ReturnType<typeof requireOrgRole>) {
  const { req, res, next } = makeReqRes(role);
  mw(req, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(403);
  expect((res.body as any)?.error?.code).toBe("INSUFFICIENT_ROLE");
}

// ─── Part A — RED-1 regression: "admin" is NOT a valid org role ───────────────
// The five routes previously compared role !== "admin" which silently blocked
// all "administrator"-role users. These tests assert the canonical fix.

describe("RED-1 regression — 'admin' is NOT a canonical org role", () => {
  it('requireOwnerOrAdmin DENIES "admin" (short form) — confirms the pre-fix bug is gone', () => {
    expectDenied("admin", requireOwnerOrAdmin);
  });

  it('requireOwnerOrAdmin GRANTS "administrator" (canonical spelling)', () => {
    expectGranted("administrator", requireOwnerOrAdmin);
  });

  it('requireOwnerOrAdmin GRANTS "owner"', () => {
    expectGranted("owner", requireOwnerOrAdmin);
  });

  it('requireOwnerOrAdmin DENIES "manager"', () => {
    expectDenied("manager", requireOwnerOrAdmin);
  });

  it('requireOwnerOrAdmin DENIES "member"', () => {
    expectDenied("member", requireOwnerOrAdmin);
  });

  it('requireOwnerOrAdmin DENIES "viewer"', () => {
    expectDenied("viewer", requireOwnerOrAdmin);
  });

  it('requireOwnerOrAdmin DENIES "auditor"', () => {
    expectDenied("auditor", requireOwnerOrAdmin);
  });
});

// ─── Part B — requireAtLeastManager covers operational approval boundary ──────

describe("requireAtLeastManager — operational approval gate", () => {
  it('GRANTS "manager"', () => {
    expectGranted("manager", requireAtLeastManager);
  });

  it('GRANTS "administrator"', () => {
    expectGranted("administrator", requireAtLeastManager);
  });

  it('GRANTS "owner"', () => {
    expectGranted("owner", requireAtLeastManager);
  });

  it('DENIES "member"', () => {
    expectDenied("member", requireAtLeastManager);
  });

  it('DENIES "viewer"', () => {
    expectDenied("viewer", requireAtLeastManager);
  });

  it('DENIES "auditor"', () => {
    expectDenied("auditor", requireAtLeastManager);
  });
});

// ─── Part C — requireOwner is exclusive to owner ──────────────────────────────

describe("requireOwner — owner-only gate", () => {
  it('GRANTS "owner"', () => {
    expectGranted("owner", requireOwner);
  });

  it('DENIES "administrator"', () => {
    expectDenied("administrator", requireOwner);
  });

  it('DENIES "manager"', () => {
    expectDenied("manager", requireOwner);
  });
});

// ─── Part D — missing tenantContext / unauthenticated ─────────────────────────

describe("missing tenantContext (unauthenticated / pre-middleware crash)", () => {
  it("requireOwnerOrAdmin DENIES when tenantContext is undefined (returns 403, not 500)", () => {
    expectDenied(undefined, requireOwnerOrAdmin);
  });

  it("requireAtLeastManager DENIES when tenantContext is undefined", () => {
    expectDenied(undefined, requireAtLeastManager);
  });
});

// ─── Part E — requireOrgRole with arbitrary role set ─────────────────────────

describe("requireOrgRole with arbitrary role sets", () => {
  it("single-role set: grants exact match", () => {
    const mw = requireOrgRole("auditor");
    expectGranted("auditor", mw);
  });

  it("single-role set: denies non-matching role", () => {
    const mw = requireOrgRole("auditor");
    expectDenied("member", mw);
  });

  it("response body includes requiredRoles list", () => {
    const mw = requireOrgRole("owner", "administrator");
    const { req, res, next } = makeReqRes("member");
    mw(req, res, next);
    const body = res.body as any;
    expect(body.error.requiredRoles).toEqual(["owner", "administrator"]);
    expect(body.error.currentRole).toBe("member");
  });
});

// ─── Part F — ROLE_PERMISSIONS new governance actions ────────────────────────

describe("ROLE_PERMISSIONS — governance permission assignments (Sprint 29M.3)", () => {
  it("owner has governance:resolve_authority", () => {
    expect(ROLE_PERMISSIONS.owner).toContain("governance:resolve_authority");
  });

  it("administrator has governance:resolve_authority", () => {
    expect(ROLE_PERMISSIONS.administrator).toContain("governance:resolve_authority");
  });

  it("manager has governance:resolve_work but NOT governance:resolve_authority", () => {
    expect(ROLE_PERMISSIONS.manager).toContain("governance:resolve_work");
    expect(ROLE_PERMISSIONS.manager).not.toContain("governance:resolve_authority");
  });

  it("member has neither governance permission", () => {
    expect(ROLE_PERMISSIONS.member).not.toContain("governance:resolve_work");
    expect(ROLE_PERMISSIONS.member).not.toContain("governance:resolve_authority");
  });

  it("owner has memory:govern", () => {
    expect(ROLE_PERMISSIONS.owner).toContain("memory:govern");
  });

  it("administrator has memory:govern", () => {
    expect(ROLE_PERMISSIONS.administrator).toContain("memory:govern");
  });

  it("manager does NOT have memory:govern", () => {
    expect(ROLE_PERMISSIONS.manager).not.toContain("memory:govern");
  });
});
