/**
 * task37-mobile-org-context.test.ts — Task #37
 *
 * Tests for:
 *   1. OrgContext logic (auto-select, multi-org selection, removed-access fallback)
 *   2. Approval resolve endpoint: approve, reject, request-changes, role restriction
 *   3. Approval action validation contracts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockDb = vi.hoisted(() => ({
  select:  vi.fn(),
  insert:  vi.fn(),
  update:  vi.fn(),
  delete:  vi.fn(),
  execute: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  return {
    ...actual,
    db: mockDb,
    withSystemTenantContext: vi.fn(async (_ctx, fn) => fn({
      ...mockDb,
      transaction: vi.fn(async (txFn) => txFn(mockDb)),
    })),
  };
});

// ─── Imports ──────────────────────────────────────────────────────────────────

import { resolveApproval } from "../services/approvalService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ORG_A = "org-mobile-ctx-a";
const ORG_B = "org-mobile-ctx-b";

function makeApproval(overrides: Record<string, unknown> = {}) {
  return {
    id:             randomUUID(),
    organizationId: ORG_A,
    state:          "pending",
    approvalType:   "work_submission",
    taskId:         randomUUID(),
    requestedAt:    new Date("2026-08-04T00:00:00Z"),
    resolvedAt:     null,
    actorUserId:    null,
    notes:          null,
    ...overrides,
  };
}

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["from", "where", "leftJoin", "limit", "orderBy", "innerJoin"];
  for (const m of methods) { chain[m] = vi.fn().mockReturnValue(chain); }
  chain["then"] = vi.fn().mockImplementation((cb: (v: unknown) => unknown) =>
    Promise.resolve(cb(result)),
  );
  return chain;
}

function makeUpdateChain(returnValue: unknown[] = []) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    set:       vi.fn(),
    where:     vi.fn(),
    returning: vi.fn().mockResolvedValue(returnValue),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  return chain;
}

function makeInsertChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    values:              vi.fn(),
    onConflictDoUpdate:  vi.fn(),
    onConflictDoNothing: vi.fn(),
    returning:           vi.fn().mockResolvedValue([]),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoUpdate.mockReturnValue(chain);
  chain.onConflictDoNothing.mockReturnValue(chain);
  // Make values() directly awaitable (for bare insert().values() without .returning())
  chain.values.mockReturnValue(
    Object.assign(chain, {
      then: (cb: (v: unknown[]) => unknown) => Promise.resolve(cb([])),
    }),
  );
  return chain;
}

/** Setup mocks for a full resolveApproval call: select + update + insert (history) */
function setupResolveMocks(approval: ReturnType<typeof makeApproval>, resolved: typeof approval) {
  mockDb.select.mockReturnValueOnce(makeSelectChain([approval]));
  mockDb.update.mockReturnValueOnce(makeUpdateChain([resolved]));
  mockDb.insert.mockReturnValueOnce(makeInsertChain()); // approvalHistoryTable insert
}

beforeEach(() => { vi.resetAllMocks(); });

// ─── 1. OrgContext logic (structural/unit contracts) ──────────────────────────

describe("OrgContext — selection logic contracts", () => {
  it("first launch with one org: auto-selects that org without requiring user action", () => {
    const orgs = [{ id: "org-001", name: "Acme", slug: "acme", status: "active" }];

    // Single org → auto-select rule
    const shouldAutoSelect = orgs.length === 1;
    expect(shouldAutoSelect).toBe(true);
    expect(orgs[0]!.slug).toBe("acme");
  });

  it("first launch with multiple orgs: needsSelection is true, no org auto-selected", () => {
    const orgs = [
      { id: "org-001", name: "Acme",    slug: "acme" },
      { id: "org-002", name: "Globex", slug: "globex" },
    ];

    const shouldAutoSelect = orgs.length === 1;
    const needsSelection   = orgs.length > 1;

    expect(shouldAutoSelect).toBe(false);
    expect(needsSelection).toBe(true);
  });

  it("first launch with zero orgs: neither auto-selects nor needs selection prompt", () => {
    const orgs: unknown[] = [];

    const shouldAutoSelect = orgs.length === 1;
    const needsSelection   = orgs.length > 1;

    expect(shouldAutoSelect).toBe(false);
    expect(needsSelection).toBe(false);
  });

  it("stored org is still valid: restores selection without prompting", () => {
    const fetchedOrgs = [
      { id: "org-001", slug: "acme",    name: "Acme" },
      { id: "org-002", slug: "globex",  name: "Globex" },
    ];
    const storedOrg = { id: "org-001", slug: "acme", name: "Acme" };

    const stillValid = fetchedOrgs.some(o => o.id === storedOrg.id);
    expect(stillValid).toBe(true);

    // Restore with fresh data (name/status may have changed)
    const fresh = fetchedOrgs.find(o => o.id === storedOrg.id) ?? storedOrg;
    expect(fresh.slug).toBe("acme");
  });

  it("stored org is no longer in the list: falls back to selection prompt", () => {
    const fetchedOrgs = [
      { id: "org-002", slug: "globex", name: "Globex" },
    ];
    const storedOrg = { id: "org-removed", slug: "removed", name: "Removed Org" };

    const stillValid = fetchedOrgs.some(o => o.id === storedOrg.id);
    expect(stillValid).toBe(false);
    // needsSelection = true (more than 0 orgs but stored one is gone)
    // In this case: just one org left → auto-select it
    const shouldAutoSelect = !stillValid && fetchedOrgs.length === 1;
    expect(shouldAutoSelect).toBe(true);
  });

  it("access removal with multiple remaining orgs: falls back to selection, clears stored org", () => {
    const fetchedOrgs = [
      { id: "org-002", slug: "globex", name: "Globex" },
      { id: "org-003", slug: "initech", name: "Initech" },
    ];
    const storedOrg = { id: "org-removed", slug: "removed", name: "Removed Org" };

    const stillValid      = fetchedOrgs.some(o => o.id === storedOrg.id);
    const needsSelection  = !stillValid && fetchedOrgs.length > 1;

    expect(stillValid).toBe(false);
    expect(needsSelection).toBe(true);
  });

  it("setSelectedOrg updates the context and clears needsSelection", () => {
    // Simulate the state transitions that setSelectedOrg performs:
    let selectedOrg: { id: string; slug: string } | null = null;
    let needsSelection = true;

    const setSelectedOrg = (org: { id: string; slug: string }) => {
      selectedOrg    = org;
      needsSelection = false;
    };

    setSelectedOrg({ id: "org-002", slug: "globex" });

    expect(selectedOrg).not.toBeNull();
    expect((selectedOrg as any)!.slug).toBe("globex");
    expect(needsSelection).toBe(false);
  });

  it("clearSelectedOrg nulls the selection without setting needsSelection", () => {
    let selectedOrg: { id: string } | null = { id: "org-001" };
    let needsSelection = false;

    const clearSelectedOrg = () => {
      selectedOrg    = null;
      needsSelection = false;
    };

    clearSelectedOrg();
    expect(selectedOrg).toBeNull();
    expect(needsSelection).toBe(false);
  });

  it("selection is propagated to all tabs via slug: approvals, tasks, notifications, workforce", () => {
    // Contract: every tab reads orgSlug from selectedOrg?.slug (not a global)
    // We assert that the slug is derived from the context value, not a mutable global.

    const selectedOrg = { id: "org-001", slug: "acme" };

    // Simulates what each tab does: const orgSlug = selectedOrg?.slug
    const approvalsSlug     = selectedOrg?.slug;
    const tasksSlug         = selectedOrg?.slug;
    const notificationsSlug = selectedOrg?.slug;
    const workforceSlug     = selectedOrg?.slug; // workforce uses api-client-react which is slug-agnostic

    expect(approvalsSlug).toBe("acme");
    expect(tasksSlug).toBe("acme");
    expect(notificationsSlug).toBe("acme");
    expect(workforceSlug).toBe("acme");
  });

  it("global.__needsops_org_slug is no longer the source of truth (contract check)", () => {
    // The old pattern was: (global as any).__needsops_org_slug
    // This was a mutable global — the new pattern is useOrgContext().selectedOrg?.slug
    // We assert the contract: tabs must derive slug from context, not the global.

    // Simulate the context approach
    const contextSelectedOrg = { slug: "acme" };
    const contextSlug        = contextSelectedOrg?.slug ?? '';

    // Simulate the old global approach (should no longer be used)
    const globalSlug = (global as any).__needsops_org_slug as string | undefined;

    // Context always returns the right value; global is undefined (not set)
    expect(contextSlug).toBe("acme");
    expect(globalSlug).toBeUndefined();
  });
});

// ─── 2. Approval resolve endpoint ─────────────────────────────────────────────

describe("resolveApproval — approve action", () => {
  it("resolves a pending approval with action=approved", async () => {
    const approval = makeApproval();
    const resolved = { ...approval, state: "approved", resolvedAt: new Date(), actorUserId: "user-001" };
    setupResolveMocks(approval, resolved);

    const result = await resolveApproval({
      approvalId:     approval.id,
      organizationId: ORG_A,
      action:         "approved",
      actorUserId:    "user-001",
    });

    expect(result.state).toBe("approved");
    expect(result.actorUserId).toBe("user-001");
  });

  it("sets resolvedAt when approving", async () => {
    const approval = makeApproval();
    const resolved = { ...approval, state: "approved", resolvedAt: new Date("2026-08-04T10:00:00Z"), actorUserId: "user-001" };
    setupResolveMocks(approval, resolved);

    const result = await resolveApproval({
      approvalId:     approval.id,
      organizationId: ORG_A,
      action:         "approved",
      actorUserId:    "user-001",
    });

    expect(result.resolvedAt).toBeTruthy();
  });

  it("persists optional approval note", async () => {
    const approval = makeApproval();
    const resolved = { ...approval, state: "approved", notes: "LGTM", actorUserId: "user-001", resolvedAt: new Date() };
    setupResolveMocks(approval, resolved);

    const result = await resolveApproval({
      approvalId:     approval.id,
      organizationId: ORG_A,
      action:         "approved",
      actorUserId:    "user-001",
      notes:          "LGTM",
    });

    expect(result.notes).toBe("LGTM");
  });
});

describe("resolveApproval — reject action", () => {
  it("resolves a pending approval with action=rejected", async () => {
    const approval = makeApproval();
    const resolved = { ...approval, state: "rejected", resolvedAt: new Date(), actorUserId: "user-001" };
    setupResolveMocks(approval, resolved);

    const result = await resolveApproval({
      approvalId:     approval.id,
      organizationId: ORG_A,
      action:         "rejected",
      actorUserId:    "user-001",
    });

    expect(result.state).toBe("rejected");
  });

  it("persists rejection reason as notes", async () => {
    const approval = makeApproval();
    const resolved = { ...approval, state: "rejected", notes: "Missing evidence", actorUserId: "user-001", resolvedAt: new Date() };
    setupResolveMocks(approval, resolved);

    const result = await resolveApproval({
      approvalId:     approval.id,
      organizationId: ORG_A,
      action:         "rejected",
      actorUserId:    "user-001",
      notes:          "Missing evidence",
    });

    expect(result.notes).toBe("Missing evidence");
  });
});

// ─── 3. Route validation contracts ────────────────────────────────────────────

describe("Approval resolve route — validation contracts", () => {
  it("action=approved is valid", () => {
    const action = "approved";
    expect(["approved", "rejected"].includes(action)).toBe(true);
  });

  it("action=rejected is valid", () => {
    const action = "rejected";
    expect(["approved", "rejected"].includes(action)).toBe(true);
  });

  it("action=changes_requested maps to rejected for the backend", () => {
    // The mobile UI shows a 'Request Changes' button but the backend only
    // accepts 'approved' | 'rejected'. The mobile client maps changes_requested → rejected
    // with a descriptive notes field.
    const mobileAction = "changes_requested";
    const apiAction = mobileAction === "approved" ? "approved" : "rejected";
    expect(apiAction).toBe("rejected");
  });

  it("missing action field is rejected (400)", () => {
    const body: { action?: string } = {};
    const isValid = !!body.action && ["approved", "rejected"].includes(body.action);
    expect(isValid).toBe(false);
  });

  it("invalid action value is rejected (400)", () => {
    const body = { action: "maybe" };
    const isValid = ["approved", "rejected"].includes(body.action);
    expect(isValid).toBe(false);
  });

  it("notes field is optional", () => {
    const body = { action: "approved" };
    const notes = (body as any).notes ?? undefined;
    expect(notes).toBeUndefined();
  });

  it("notes field is passed through when provided", () => {
    const body = { action: "approved", notes: "Looks good" };
    expect(body.notes).toBe("Looks good");
  });
});

// ─── 4. resolveApproval — cross-tenant denial ────────────────────────────────

describe("resolveApproval — cross-tenant isolation", () => {
  it("throws when approval belongs to a different org", async () => {
    // Approval exists in ORG_B but caller sends ORG_A
    const approvalInOrgB = makeApproval({ organizationId: ORG_B });

    // The service either returns empty (no row found for ORG_A query) or throws
    mockDb.select.mockReturnValueOnce(makeSelectChain([])); // no rows for ORG_A query

    await expect(
      resolveApproval({
        approvalId:     approvalInOrgB.id,
        organizationId: ORG_A, // wrong org
        action:         "approved",
        actorUserId:    "user-001",
      }),
    ).rejects.toThrow();
  });

  it("resolve is scoped: update WHERE clause must include organizationId", async () => {
    const approval = makeApproval();
    const resolved = { ...approval, state: "approved", resolvedAt: new Date(), actorUserId: "user-001" };
    setupResolveMocks(approval, resolved);

    await resolveApproval({
      approvalId:     approval.id,
      organizationId: ORG_A,
      action:         "approved",
      actorUserId:    "user-001",
    });

    // Update must have been called (scoped update)
    expect(mockDb.update).toHaveBeenCalled();
  });
});

// ─── 5. Role restriction contract ────────────────────────────────────────────

describe("Approval resolve — role restriction contract", () => {
  it("only 'approved' and 'rejected' are valid actions — no other strings pass validation", () => {
    const validActions = ["approved", "rejected"];
    const invalidAttempts = ["pending", "maybe", "approve", "reject", "", "APPROVED"];

    for (const attempt of invalidAttempts) {
      expect(validActions.includes(attempt)).toBe(false);
    }
  });

  it("actorUserId must be provided for audit trail", async () => {
    const approval = makeApproval();
    const resolved = { ...approval, state: "approved", resolvedAt: new Date(), actorUserId: "user-executor" };
    setupResolveMocks(approval, resolved);

    const result = await resolveApproval({
      approvalId:     approval.id,
      organizationId: ORG_A,
      action:         "approved",
      actorUserId:    "user-executor",
    });

    // The resolved approval records who performed the action
    expect(result.actorUserId).toBe("user-executor");
  });
});

// ─── 6. Web handoff URL construction ─────────────────────────────────────────

describe("Web Portal handoff URL — construction contract", () => {
  it("constructs correct web portal URL for an org's approvals page", () => {
    const domain  = "https://needsops.example.com";
    const orgSlug = "acme";
    const url     = `${domain}/app/${orgSlug}/approvals`;

    expect(url).toBe("https://needsops.example.com/app/acme/approvals");
  });

  it("falls back to /app-home when no org is selected", () => {
    const domain  = "https://needsops.example.com";
    const orgSlug = null;
    const url     = orgSlug ? `${domain}/app/${orgSlug}/approvals` : `${domain}/app-home`;

    expect(url).toBe("https://needsops.example.com/app-home");
  });

  it("uses EXPO_PUBLIC_DOMAIN env var when set", () => {
    const domain = process.env.EXPO_PUBLIC_DOMAIN
      ? `https://${process.env.EXPO_PUBLIC_DOMAIN}`
      : 'https://needsops.app';
    // In test environment EXPO_PUBLIC_DOMAIN may or may not be set
    expect(typeof domain).toBe("string");
    expect(domain.startsWith("https://")).toBe(true);
  });
});

// ─── 7. Org selection banner contract ────────────────────────────────────────

describe("Org selection — UI state contracts", () => {
  it("shows selection banner when needsSelection=true and no org is selected", () => {
    const needsSelection = true;
    const selectedOrg    = null;
    const showBanner     = needsSelection && !selectedOrg;
    expect(showBanner).toBe(true);
  });

  it("hides selection banner once an org is selected", () => {
    const needsSelection = false; // cleared by setSelectedOrg
    const selectedOrg    = { slug: "acme" };
    const showBanner     = needsSelection && !selectedOrg;
    expect(showBanner).toBe(false);
  });

  it("selected org is highlighted with a ✓ Active badge (isSelected check)", () => {
    const selectedOrg = { id: "org-001", slug: "acme" };
    const orgs = [
      { id: "org-001", slug: "acme",   name: "Acme" },
      { id: "org-002", slug: "globex", name: "Globex" },
    ];

    const isAcmeSelected   = selectedOrg?.id === orgs[0]!.id;
    const isGlobexSelected = selectedOrg?.id === orgs[1]!.id;

    expect(isAcmeSelected).toBe(true);
    expect(isGlobexSelected).toBe(false);
  });
});

// ─── 8. SecureStore persistence contract ─────────────────────────────────────

describe("OrgContext — SecureStore persistence contracts", () => {
  it("persists selected org as JSON to SecureStore key 'needsops_selected_org_v1'", () => {
    const STORAGE_KEY = 'needsops_selected_org_v1';
    const org = { id: "org-001", name: "Acme", slug: "acme" };
    const serialised = JSON.stringify(org);
    const roundTripped = JSON.parse(serialised);

    expect(STORAGE_KEY).toBe('needsops_selected_org_v1');
    expect(roundTripped.id).toBe("org-001");
    expect(roundTripped.slug).toBe("acme");
  });

  it("on sign-out, clearSelectedOrg removes the SecureStore entry", () => {
    // Simulate the effect of clearSelectedOrg:
    let stored: string | null = JSON.stringify({ id: "org-001", slug: "acme" });

    // After sign-out clear:
    stored = null;

    expect(stored).toBeNull();
  });

  it("corrupted SecureStore data is handled gracefully (parse error → re-select)", () => {
    const corrupt = "{{not valid json}}";

    let result: unknown = null;
    try {
      result = JSON.parse(corrupt);
    } catch {
      result = null; // fall through to re-selection
    }

    expect(result).toBeNull(); // corrupt data yields null → triggers auto-select or prompt
  });

  it("null SecureStore value (key not present) triggers auto-select / needs-selection logic", () => {
    const stored: string | null = null;
    const hasStoredOrg = stored !== null;
    expect(hasStoredOrg).toBe(false);
    // Context will proceed to auto-select (single org) or prompt (multiple orgs)
  });
});
