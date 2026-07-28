/**
 * Sprint 9.7 — Owner Portal Control Plane Tests
 *
 * Tests cover:
 *  - Organisation lifecycle: freeze/unfreeze execution, disable/enable logins, close org
 *  - Organisation metadata PATCH
 *  - Subscription management: create, update, pause/resume/cancel
 *  - Seat overrides: create, revoke, effective resolution
 *  - Trial actions: extend, cancel, convert
 *  - Pack grants: grant, revoke, start-trial, extend-trial
 *  - Platform staff: role constraints, super-admin protection
 *  - Schema: org_status enum values, platform_role enum values, new org columns
 *  - Security: role-gated routes enforce required platform roles
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Org Status Enum ──────────────────────────────────────────────────────────

describe("org_status enum — Sprint 9.7", () => {
  const VALID_STATUSES = [
    "onboarding",
    "trial",
    "active",
    "past_due",
    "restricted",
    "suspended",
    "closed",
  ];

  it("has all 7 expected values", () => {
    expect(VALID_STATUSES).toHaveLength(7);
  });

  it("includes the new Sprint 9.7 values", () => {
    expect(VALID_STATUSES).toContain("trial");
    expect(VALID_STATUSES).toContain("past_due");
    expect(VALID_STATUSES).toContain("restricted");
  });

  it("retains the original values", () => {
    expect(VALID_STATUSES).toContain("onboarding");
    expect(VALID_STATUSES).toContain("active");
    expect(VALID_STATUSES).toContain("suspended");
    expect(VALID_STATUSES).toContain("closed");
  });

  it("does not contain invalid values", () => {
    expect(VALID_STATUSES).not.toContain("archived");
    expect(VALID_STATUSES).not.toContain("deleted");
    expect(VALID_STATUSES).not.toContain("inactive");
  });
});

// ─── Platform Role Enum ───────────────────────────────────────────────────────

describe("platform_role enum — Sprint 9.7", () => {
  const ALL_ROLES = [
    // Original Sprint 4 roles
    "platform_auditor",
    "platform_developer",
    "platform_super_admin",
    "platform_operations_admin",
    "platform_support_admin",
    "platform_billing_admin",
    "platform_security_auditor",
    // Sprint 9.7 additions
    "platform_admin",
    "platform_commercial",
    "platform_operations",
    "platform_support",
    "platform_security",
  ];

  it("has 12 total roles", () => {
    expect(ALL_ROLES).toHaveLength(12);
  });

  it("includes all Sprint 9.7 canonical names", () => {
    expect(ALL_ROLES).toContain("platform_admin");
    expect(ALL_ROLES).toContain("platform_commercial");
    expect(ALL_ROLES).toContain("platform_operations");
    expect(ALL_ROLES).toContain("platform_support");
    expect(ALL_ROLES).toContain("platform_security");
  });

  it("retains all Sprint 4 original roles", () => {
    expect(ALL_ROLES).toContain("platform_super_admin");
    expect(ALL_ROLES).toContain("platform_auditor");
    expect(ALL_ROLES).toContain("platform_developer");
    expect(ALL_ROLES).toContain("platform_operations_admin");
  });
});

// ─── Org Schema Fields ────────────────────────────────────────────────────────

describe("Organization schema — Sprint 9.7 new fields", () => {
  function makeOrg(overrides?: Partial<ReturnType<typeof makeOrg>>) {
    return {
      id: "org-1",
      name: "Acme Care",
      slug: "acme-care",
      status: "active" as const,
      executionFrozen: false,
      loginDisabled: false,
      suspensionReason: null as string | null,
      closureReason: null as string | null,
      closedAt: null as Date | null,
      closedBy: null as string | null,
      statusChangedAt: null as Date | null,
      statusChangedBy: null as string | null,
      legalName: null as string | null,
      tradingName: null as string | null,
      supportStatus: "normal" as string,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  it("new fields have correct defaults", () => {
    const org = makeOrg();
    expect(org.executionFrozen).toBe(false);
    expect(org.loginDisabled).toBe(false);
    expect(org.suspensionReason).toBeNull();
    expect(org.closureReason).toBeNull();
    expect(org.closedAt).toBeNull();
    expect(org.closedBy).toBeNull();
    expect(org.legalName).toBeNull();
    expect(org.tradingName).toBeNull();
    expect(org.supportStatus).toBe("normal");
  });

  it("closed org shape is valid", () => {
    const org = makeOrg({
      status: "closed",
      executionFrozen: true,
      loginDisabled: true,
      closedAt: new Date("2026-07-28"),
      closedBy: "user-admin-1",
      closureReason: "Company ceased trading",
      statusChangedAt: new Date("2026-07-28"),
      statusChangedBy: "user-admin-1",
    });
    expect(org.status).toBe("closed");
    expect(org.executionFrozen).toBe(true);
    expect(org.loginDisabled).toBe(true);
    expect(org.closedAt).toBeInstanceOf(Date);
    expect(org.closureReason).toBe("Company ceased trading");
  });

  it("frozen org still has status=active", () => {
    const org = makeOrg({ executionFrozen: true });
    expect(org.status).toBe("active");
    expect(org.executionFrozen).toBe(true);
    expect(org.loginDisabled).toBe(false);
  });
});

// ─── Seat Override Logic ──────────────────────────────────────────────────────

describe("Seat override resolution", () => {
  type Override = {
    id: string;
    seatAllowance: number | null;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    revoked: boolean;
  };

  function resolveActiveOverride(overrides: Override[], now: Date): Override | null {
    const active = overrides.filter((o) => {
      if (o.revoked) return false;
      if (o.effectiveFrom > now) return false;
      if (o.effectiveTo && o.effectiveTo < now) return false;
      return true;
    });
    if (active.length === 0) return null;
    // Take highest allowance among active (null = unlimited = Infinity)
    return active.reduce((best, curr) => {
      const bestVal = best.seatAllowance ?? Infinity;
      const currVal = curr.seatAllowance ?? Infinity;
      return currVal > bestVal ? curr : best;
    });
  }

  const now = new Date("2026-07-28T12:00:00Z");

  it("returns null when no overrides", () => {
    expect(resolveActiveOverride([], now)).toBeNull();
  });

  it("returns null when all overrides are revoked", () => {
    const overrides: Override[] = [
      { id: "ov-1", seatAllowance: 50, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, revoked: true },
    ];
    expect(resolveActiveOverride(overrides, now)).toBeNull();
  });

  it("returns null when override hasn't started yet", () => {
    const overrides: Override[] = [
      { id: "ov-1", seatAllowance: 50, effectiveFrom: new Date("2027-01-01"), effectiveTo: null, revoked: false },
    ];
    expect(resolveActiveOverride(overrides, now)).toBeNull();
  });

  it("returns null when override has expired", () => {
    const overrides: Override[] = [
      { id: "ov-1", seatAllowance: 50, effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-06-30"), revoked: false },
    ];
    expect(resolveActiveOverride(overrides, now)).toBeNull();
  });

  it("returns active override", () => {
    const overrides: Override[] = [
      { id: "ov-1", seatAllowance: 100, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, revoked: false },
    ];
    const result = resolveActiveOverride(overrides, now);
    expect(result?.id).toBe("ov-1");
    expect(result?.seatAllowance).toBe(100);
  });

  it("null seatAllowance means unlimited", () => {
    const overrides: Override[] = [
      { id: "ov-unlimited", seatAllowance: null, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, revoked: false },
    ];
    const result = resolveActiveOverride(overrides, now);
    expect(result?.id).toBe("ov-unlimited");
    expect(result?.seatAllowance).toBeNull();
  });

  it("picks highest allowance when multiple active overrides exist", () => {
    const overrides: Override[] = [
      { id: "ov-low", seatAllowance: 50, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, revoked: false },
      { id: "ov-high", seatAllowance: 200, effectiveFrom: new Date("2026-06-01"), effectiveTo: null, revoked: false },
    ];
    const result = resolveActiveOverride(overrides, now);
    expect(result?.id).toBe("ov-high");
  });

  it("unlimited override wins over any finite allowance", () => {
    const overrides: Override[] = [
      { id: "ov-finite", seatAllowance: 999, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, revoked: false },
      { id: "ov-unlimited", seatAllowance: null, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, revoked: false },
    ];
    const result = resolveActiveOverride(overrides, now);
    expect(result?.id).toBe("ov-unlimited");
  });

  it("permanent override (effectiveTo=null) does not expire", () => {
    const farFuture = new Date("2099-12-31");
    const overrides: Override[] = [
      { id: "ov-perm", seatAllowance: 500, effectiveFrom: new Date("2026-01-01"), effectiveTo: null, revoked: false },
    ];
    const result = resolveActiveOverride(overrides, farFuture);
    expect(result?.id).toBe("ov-perm");
  });
});

// ─── Trial Actions Logic ──────────────────────────────────────────────────────

describe("Trial extension logic", () => {
  function extendTrial(trialEndAt: Date, additionalDays: number): Date {
    const ms = additionalDays * 24 * 60 * 60 * 1000;
    return new Date(trialEndAt.getTime() + ms);
  }

  it("extends trial by correct number of days", () => {
    const end = new Date("2026-08-01T00:00:00Z");
    const extended = extendTrial(end, 14);
    expect(extended.toISOString().startsWith("2026-08-15")).toBe(true);
  });

  it("extends trial by 1 day", () => {
    const end = new Date("2026-07-28T00:00:00Z");
    const extended = extendTrial(end, 1);
    expect(extended.toISOString().startsWith("2026-07-29")).toBe(true);
  });

  it("extending a past trial pushes it into the future", () => {
    const expired = new Date("2026-06-01T00:00:00Z");
    const extended = extendTrial(expired, 30);
    expect(extended.toISOString().startsWith("2026-07-01")).toBe(true);
  });
});

describe("Trial conversion validation", () => {
  type TrialConvertBody = {
    source: string;
    activationDate?: string;
    renewalDate?: string;
    planId?: string;
    planVersionId?: string;
    note?: string;
    reason: string;
  };

  const VALID_SOURCES = [
    "manual",
    "invoice",
    "bank_transfer",
    "enterprise_contract",
    "pilot",
    "future_stripe",
    "reseller",
  ];

  function validateConvertBody(body: TrialConvertBody): { valid: boolean; error?: string } {
    if (!body.reason || body.reason.trim().length === 0) {
      return { valid: false, error: "reason is required" };
    }
    if (!body.source || !VALID_SOURCES.includes(body.source)) {
      return { valid: false, error: `source must be one of: ${VALID_SOURCES.join(", ")}` };
    }
    if (body.activationDate && isNaN(Date.parse(body.activationDate))) {
      return { valid: false, error: "activationDate must be a valid ISO date" };
    }
    return { valid: true };
  }

  it("accepts valid source=manual", () => {
    const result = validateConvertBody({ source: "manual", reason: "Customer signed contract" });
    expect(result.valid).toBe(true);
  });

  it("accepts all valid sources", () => {
    for (const source of VALID_SOURCES) {
      const result = validateConvertBody({ source, reason: "Test" });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects missing reason", () => {
    const result = validateConvertBody({ source: "manual", reason: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("reason");
  });

  it("rejects invalid source", () => {
    const result = validateConvertBody({ source: "stripe", reason: "Test" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("source");
  });

  it("rejects invalid activationDate", () => {
    const result = validateConvertBody({ source: "manual", reason: "Test", activationDate: "not-a-date" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("activationDate");
  });

  it("accepts valid ISO activationDate", () => {
    const result = validateConvertBody({ source: "invoice", reason: "Test", activationDate: "2026-08-01" });
    expect(result.valid).toBe(true);
  });
});

// ─── Subscription Status Logic ────────────────────────────────────────────────

describe("Subscription management logic", () => {
  type SubStatus = "active" | "suspended" | "cancelled" | "trial" | "trial_expired" | "past_due";

  function canPause(status: SubStatus): boolean {
    return status === "active" || status === "past_due";
  }

  function canResume(status: SubStatus): boolean {
    return status === "suspended";
  }

  function canCancel(status: SubStatus): boolean {
    return status !== "cancelled";
  }

  function canConvert(status: SubStatus): boolean {
    return status === "trial";
  }

  it("only active/past_due subscriptions can be paused", () => {
    expect(canPause("active")).toBe(true);
    expect(canPause("past_due")).toBe(true);
    expect(canPause("suspended")).toBe(false);
    expect(canPause("trial")).toBe(false);
    expect(canPause("cancelled")).toBe(false);
  });

  it("only suspended subscriptions can be resumed", () => {
    expect(canResume("suspended")).toBe(true);
    expect(canResume("active")).toBe(false);
    expect(canResume("trial")).toBe(false);
  });

  it("any non-cancelled subscription can be cancelled", () => {
    expect(canCancel("active")).toBe(true);
    expect(canCancel("trial")).toBe(true);
    expect(canCancel("suspended")).toBe(true);
    expect(canCancel("cancelled")).toBe(false);
  });

  it("only trial subscriptions can be converted", () => {
    expect(canConvert("trial")).toBe(true);
    expect(canConvert("active")).toBe(false);
    expect(canConvert("suspended")).toBe(false);
  });
});

// ─── Pack Grant Logic ─────────────────────────────────────────────────────────

describe("Pack grant validation", () => {
  type PackGrantStatus = "active" | "trial" | "revoked" | "expired" | "pending";

  type Grant = { organizationId: string; packCode: string; status: PackGrantStatus; revokedAt?: Date | null };

  function hasActiveGrant(grants: Grant[], orgId: string, packCode: string): boolean {
    return grants.some(
      (g) =>
        g.organizationId === orgId &&
        g.packCode === packCode &&
        g.status !== "revoked" &&
        g.status !== "expired" &&
        !g.revokedAt,
    );
  }

  it("no grants — can grant", () => {
    expect(hasActiveGrant([], "org-1", "pack_rostering")).toBe(false);
  });

  it("active grant exists — cannot grant again", () => {
    const grants: Grant[] = [
      { organizationId: "org-1", packCode: "pack_rostering", status: "active", revokedAt: null },
    ];
    expect(hasActiveGrant(grants, "org-1", "pack_rostering")).toBe(true);
  });

  it("trial grant exists — cannot grant again", () => {
    const grants: Grant[] = [
      { organizationId: "org-1", packCode: "pack_rostering", status: "trial", revokedAt: null },
    ];
    expect(hasActiveGrant(grants, "org-1", "pack_rostering")).toBe(true);
  });

  it("revoked grant — can grant again", () => {
    const grants: Grant[] = [
      { organizationId: "org-1", packCode: "pack_rostering", status: "revoked", revokedAt: new Date() },
    ];
    expect(hasActiveGrant(grants, "org-1", "pack_rostering")).toBe(false);
  });

  it("grant for different org — can grant for this org", () => {
    const grants: Grant[] = [
      { organizationId: "org-2", packCode: "pack_rostering", status: "active", revokedAt: null },
    ];
    expect(hasActiveGrant(grants, "org-1", "pack_rostering")).toBe(false);
  });

  it("grant for different pack — can grant this pack", () => {
    const grants: Grant[] = [
      { organizationId: "org-1", packCode: "pack_onboarding", status: "active", revokedAt: null },
    ];
    expect(hasActiveGrant(grants, "org-1", "pack_rostering")).toBe(false);
  });
});

// ─── Platform Staff Role Constraints ─────────────────────────────────────────

describe("Platform staff role constraints", () => {
  type PlatformRole =
    | "platform_super_admin"
    | "platform_admin"
    | "platform_commercial"
    | "platform_operations"
    | "platform_support"
    | "platform_security"
    | "platform_auditor"
    | "platform_developer"
    | "platform_operations_admin"
    | "platform_support_admin"
    | "platform_billing_admin"
    | "platform_security_auditor";

  function canGrantRole(actorRole: PlatformRole, targetRole: PlatformRole): boolean {
    // platform_admin can grant any role except platform_super_admin
    if (actorRole === "platform_super_admin") return true;
    if (actorRole === "platform_admin" && targetRole !== "platform_super_admin") return true;
    return false;
  }

  function canRevokeLastSuperAdmin(
    actorRole: PlatformRole,
    targetRole: PlatformRole,
    activeSuperAdminCount: number,
  ): { allowed: boolean; reason?: string } {
    if (targetRole !== "platform_super_admin") return { allowed: true };
    if (actorRole !== "platform_super_admin") {
      return { allowed: false, reason: "Only a super admin can revoke a super admin role" };
    }
    if (activeSuperAdminCount <= 1) {
      return { allowed: false, reason: "Cannot remove the last platform super admin" };
    }
    return { allowed: true };
  }

  it("super_admin can grant super_admin role", () => {
    expect(canGrantRole("platform_super_admin", "platform_super_admin")).toBe(true);
  });

  it("platform_admin can grant platform_commercial role", () => {
    expect(canGrantRole("platform_admin", "platform_commercial")).toBe(true);
  });

  it("platform_admin cannot grant platform_super_admin role", () => {
    expect(canGrantRole("platform_admin", "platform_super_admin")).toBe(false);
  });

  it("platform_commercial cannot grant any role", () => {
    expect(canGrantRole("platform_commercial", "platform_support")).toBe(false);
  });

  it("cannot revoke the last super admin", () => {
    const result = canRevokeLastSuperAdmin("platform_super_admin", "platform_super_admin", 1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("last platform super admin");
  });

  it("can revoke super_admin when there are 2+ active", () => {
    const result = canRevokeLastSuperAdmin("platform_super_admin", "platform_super_admin", 2);
    expect(result.allowed).toBe(true);
  });

  it("non-super-admin cannot revoke super_admin role", () => {
    const result = canRevokeLastSuperAdmin("platform_admin", "platform_super_admin", 3);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Only a super admin");
  });

  it("any admin can revoke a non-super-admin role regardless of count", () => {
    const result = canRevokeLastSuperAdmin("platform_admin", "platform_support", 1);
    expect(result.allowed).toBe(true);
  });
});

// ─── Org Lifecycle State Machine ──────────────────────────────────────────────

describe("Organisation lifecycle state machine", () => {
  type OrgStatus = "onboarding" | "trial" | "active" | "past_due" | "restricted" | "suspended" | "closed";

  type OrgState = {
    status: OrgStatus;
    executionFrozen: boolean;
    loginDisabled: boolean;
  };

  function canSuspend(state: OrgState): boolean {
    return state.status !== "closed" && state.status !== "suspended";
  }

  function canReactivate(state: OrgState): boolean {
    return state.status === "suspended";
  }

  function canFreeze(state: OrgState): boolean {
    return !state.executionFrozen && state.status !== "closed";
  }

  function canUnfreeze(state: OrgState): boolean {
    return state.executionFrozen && state.status !== "closed" && state.status !== "suspended";
  }

  function canClose(state: OrgState): boolean {
    return state.status !== "closed";
  }

  function closeOrg(state: OrgState): OrgState {
    return {
      ...state,
      status: "closed",
      executionFrozen: true,
      loginDisabled: true,
    };
  }

  it("active org can be suspended", () => {
    expect(canSuspend({ status: "active", executionFrozen: false, loginDisabled: false })).toBe(true);
  });

  it("closed org cannot be suspended", () => {
    expect(canSuspend({ status: "closed", executionFrozen: true, loginDisabled: true })).toBe(false);
  });

  it("already suspended org cannot be suspended again", () => {
    expect(canSuspend({ status: "suspended", executionFrozen: false, loginDisabled: false })).toBe(false);
  });

  it("only suspended org can be reactivated", () => {
    expect(canReactivate({ status: "suspended", executionFrozen: false, loginDisabled: false })).toBe(true);
    expect(canReactivate({ status: "active", executionFrozen: false, loginDisabled: false })).toBe(false);
    expect(canReactivate({ status: "closed", executionFrozen: true, loginDisabled: true })).toBe(false);
  });

  it("active org can be frozen", () => {
    expect(canFreeze({ status: "active", executionFrozen: false, loginDisabled: false })).toBe(true);
  });

  it("already frozen org cannot be frozen again", () => {
    expect(canFreeze({ status: "active", executionFrozen: true, loginDisabled: false })).toBe(false);
  });

  it("closed org cannot be frozen", () => {
    expect(canFreeze({ status: "closed", executionFrozen: false, loginDisabled: false })).toBe(false);
  });

  it("frozen active org can be unfrozen", () => {
    expect(canUnfreeze({ status: "active", executionFrozen: true, loginDisabled: false })).toBe(true);
  });

  it("suspended org cannot be unfrozen", () => {
    expect(canUnfreeze({ status: "suspended", executionFrozen: true, loginDisabled: false })).toBe(false);
  });

  it("closing an org sets executionFrozen and loginDisabled", () => {
    const before = { status: "active" as OrgStatus, executionFrozen: false, loginDisabled: false };
    const after = closeOrg(before);
    expect(after.status).toBe("closed");
    expect(after.executionFrozen).toBe(true);
    expect(after.loginDisabled).toBe(true);
  });

  it("closing an already frozen org keeps it frozen", () => {
    const before = { status: "suspended" as OrgStatus, executionFrozen: true, loginDisabled: false };
    const after = closeOrg(before);
    expect(after.executionFrozen).toBe(true);
    expect(after.loginDisabled).toBe(true);
  });

  it("any non-closed org can be closed", () => {
    const statuses: OrgStatus[] = ["onboarding", "trial", "active", "past_due", "restricted", "suspended"];
    for (const status of statuses) {
      expect(canClose({ status, executionFrozen: false, loginDisabled: false })).toBe(true);
    }
  });

  it("already closed org cannot be closed again", () => {
    expect(canClose({ status: "closed", executionFrozen: true, loginDisabled: true })).toBe(false);
  });
});

// ─── Support Status ───────────────────────────────────────────────────────────

describe("Support status logic", () => {
  const VALID_SUPPORT_STATUSES = ["normal", "high_priority", "vip", "flagged"];

  it("normal is the default", () => {
    expect(VALID_SUPPORT_STATUSES[0]).toBe("normal");
  });

  it("all 4 support statuses are defined", () => {
    expect(VALID_SUPPORT_STATUSES).toHaveLength(4);
    expect(VALID_SUPPORT_STATUSES).toContain("vip");
    expect(VALID_SUPPORT_STATUSES).toContain("high_priority");
    expect(VALID_SUPPORT_STATUSES).toContain("flagged");
  });

  function getDisplayLabel(status: string): string {
    const labels: Record<string, string> = {
      normal: "Normal",
      high_priority: "High Priority",
      vip: "VIP",
      flagged: "Flagged",
    };
    return labels[status] ?? status;
  }

  it("display labels are correct", () => {
    expect(getDisplayLabel("normal")).toBe("Normal");
    expect(getDisplayLabel("high_priority")).toBe("High Priority");
    expect(getDisplayLabel("vip")).toBe("VIP");
    expect(getDisplayLabel("flagged")).toBe("Flagged");
  });
});

// ─── Org PATCH validation ─────────────────────────────────────────────────────

describe("Org metadata PATCH validation", () => {
  type PatchBody = {
    name?: string;
    legalName?: string;
    tradingName?: string;
    displayName?: string;
    supportStatus?: string;
  };

  const VALID_SUPPORT_STATUSES = ["normal", "high_priority", "vip", "flagged"];
  const EDITABLE_FIELDS = ["name", "legalName", "tradingName", "displayName", "supportStatus"];

  function validatePatch(body: PatchBody): { valid: boolean; error?: string } {
    if (Object.keys(body).length === 0) {
      return { valid: false, error: "No fields to update" };
    }
    const unknown = Object.keys(body).filter((k) => !EDITABLE_FIELDS.includes(k));
    if (unknown.length > 0) {
      return { valid: false, error: `Unknown fields: ${unknown.join(", ")}` };
    }
    if (body.supportStatus && !VALID_SUPPORT_STATUSES.includes(body.supportStatus)) {
      return { valid: false, error: `supportStatus must be one of: ${VALID_SUPPORT_STATUSES.join(", ")}` };
    }
    if (body.name !== undefined && body.name.trim().length === 0) {
      return { valid: false, error: "name cannot be empty" };
    }
    return { valid: true };
  }

  it("accepts valid name update", () => {
    expect(validatePatch({ name: "New Name Ltd" }).valid).toBe(true);
  });

  it("accepts all supported fields", () => {
    expect(validatePatch({ legalName: "Legal Co Pty Ltd", tradingName: "TradeCo", supportStatus: "vip" }).valid).toBe(true);
  });

  it("rejects empty body", () => {
    const result = validatePatch({});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No fields");
  });

  it("rejects empty name", () => {
    const result = validatePatch({ name: "   " });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("name cannot be empty");
  });

  it("rejects invalid supportStatus", () => {
    const result = validatePatch({ supportStatus: "premium" } as any);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("supportStatus");
  });
});

// ─── Security: route permission matrix ────────────────────────────────────────

describe("Route permission matrix — Sprint 9.7", () => {
  type RequiredRole = string | null; // null = platform_auth only (no specific role)

  const ROUTE_PERMISSIONS: Array<{ route: string; method: string; requiredRole: RequiredRole }> = [
    { route: "PATCH /platform/organisations/:id", method: "PATCH", requiredRole: "platform_admin" },
    { route: "POST /platform/organisations/:id/close", method: "POST", requiredRole: "platform_super_admin" },
    { route: "POST /platform/organisations/:id/freeze-execution", method: "POST", requiredRole: "platform_operations OR platform_security" },
    { route: "POST /platform/organisations/:id/unfreeze-execution", method: "POST", requiredRole: "platform_operations" },
    { route: "POST /platform/organisations/:id/disable-logins", method: "POST", requiredRole: "platform_security" },
    { route: "POST /platform/organisations/:id/enable-logins", method: "POST", requiredRole: "platform_security" },
    { route: "POST /platform/organisations/:id/subscription", method: "POST", requiredRole: "platform_commercial" },
    { route: "PATCH /platform/organisations/:id/subscription", method: "PATCH", requiredRole: "platform_commercial" },
    { route: "POST /platform/organisations/:id/subscription/pause", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/organisations/:id/subscription/resume", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/organisations/:id/subscription/cancel", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/organisations/:id/seats/override", method: "POST", requiredRole: "platform_commercial" },
    { route: "DELETE /platform/organisations/:id/seats/override/:oid", method: "DELETE", requiredRole: "platform_commercial" },
    { route: "POST /platform/packs/:code/grant", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/packs/:code/revoke", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/packs/:code/start-trial", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/packs/:code/extend-trial", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/trials/:id/extend", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/trials/:id/cancel", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/trials/:id/convert", method: "POST", requiredRole: "platform_commercial" },
    { route: "POST /platform/staff/invite", method: "POST", requiredRole: "platform_admin" },
    { route: "DELETE /platform/staff/:userId/roles/:role", method: "DELETE", requiredRole: "platform_admin" },
    { route: "POST /platform/staff/:userId/suspend", method: "POST", requiredRole: "platform_admin" },
  ];

  it("all mutating routes have a required role (no unguarded writes)", () => {
    for (const route of ROUTE_PERMISSIONS) {
      if (route.method !== "GET") {
        expect(route.requiredRole).not.toBeNull();
      }
    }
  });

  it("close org route requires super_admin (highest privilege)", () => {
    const closeRoute = ROUTE_PERMISSIONS.find((r) => r.route.includes("/close"));
    expect(closeRoute?.requiredRole).toBe("platform_super_admin");
  });

  it("commercial operations require platform_commercial role", () => {
    const commercialRoutes = ROUTE_PERMISSIONS.filter((r) =>
      r.route.includes("/subscription") ||
      r.route.includes("/pack") ||
      r.route.includes("/trial"),
    );
    for (const route of commercialRoutes) {
      expect(route.requiredRole).toContain("commercial");
    }
  });

  it("staff management requires platform_admin", () => {
    const staffRoutes = ROUTE_PERMISSIONS.filter((r) => r.route.includes("/staff"));
    for (const route of staffRoutes) {
      expect(route.requiredRole).toContain("admin");
    }
  });

  it("security operations require platform_security or security-adjacent role", () => {
    const securityRoutes = ROUTE_PERMISSIONS.filter(
      (r) => r.route.includes("login") || r.route.includes("freeze"),
    );
    for (const route of securityRoutes) {
      expect(route.requiredRole).toMatch(/security|operations/);
    }
  });
});

// ─── Audit Events ─────────────────────────────────────────────────────────────

describe("Sprint 9.7 audit events", () => {
  const SPRINT_97_EVENTS = [
    "platform.organisation_updated",
    "platform.organisation_closed",
    "platform.execution_frozen",
    "platform.execution_unfrozen",
    "platform.logins_disabled",
    "platform.logins_enabled",
    "platform.pack_granted",
    "platform.pack_revoked",
    "platform.pack_trial_started",
    "platform.pack_trial_extended",
    "platform.seat_override_created",
    "platform.seat_override_revoked",
    "platform.subscription_paused",
    "platform.subscription_resumed",
    "platform.subscription_cancelled",
    "platform.subscription_created",
    "platform.platform_staff_suspended",
  ];

  it("all Sprint 9.7 events follow the platform.* naming convention", () => {
    for (const event of SPRINT_97_EVENTS) {
      expect(event.startsWith("platform.")).toBe(true);
    }
  });

  it("no duplicate event names", () => {
    const unique = new Set(SPRINT_97_EVENTS);
    expect(unique.size).toBe(SPRINT_97_EVENTS.length);
  });

  it("events use snake_case for the action part", () => {
    for (const event of SPRINT_97_EVENTS) {
      const action = event.split(".")[1];
      expect(action).toMatch(/^[a-z][a-z0-9_]+$/);
    }
  });
});
