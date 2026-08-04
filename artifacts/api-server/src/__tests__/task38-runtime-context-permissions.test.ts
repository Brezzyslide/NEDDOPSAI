/**
 * task38-runtime-context-permissions.test.ts — Task #38
 *
 * Tests for runtime context permissions enforcement in runtimeContextService:
 *   - Cross-tenant denial when requestingUserId is not a member of the org
 *   - Specialist denial when org's subscription does not include the pack
 *   - Sensitivity clearance gates (pack → clearance level mapping)
 *   - Entitlement denial (canBrowse/canExecuteConnectors)
 *   - Allowed access (all entitlements granted)
 *   - Partial entitlement (some packs granted, some not)
 *   - Runtime counts (activeGraphCount / pendingIntentCount) from real DB rows
 *   - Resource permissions built from available resources
 *   - Sensitivity gate helpers: isSensitivityPermitted, filterBySensitivity
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB mock (vi.hoisted — must run before any import) ───────────────────────

const mockDb = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db:                         mockDb,
  organizationsTable:         { id: {}, slug: {}, status: {}, executionFrozen: {}, displayName: {}, name: {}, type: {}, industry: {}, country: {}, state: {}, timezone: {}, ndisRegistrationNumber: {}, subscriptionTier: {} },
  organisationMemoryTable:    { organizationId: {}, status: {}, memoryType: {}, title: {}, content: {}, approvedAt: {} },
  executionIntentsTable:      { organizationId: {}, status: {} },
  membershipsTable:           { organizationId: {}, userId: {}, status: {}, id: {} },
  usersTable:                 { id: {}, externalId: {} },
}));

// ─── Dependency mocks ─────────────────────────────────────────────────────────

const mockListResources = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockBuildDescriptor = vi.hoisted(() => vi.fn().mockReturnValue({
  resourceId: "res-1", displayName: "Test Resource",
  resourceType: "document_store", connectorType: "file_connector",
  availableOperations: ["read"],
}));
vi.mock("../services/organisationResourceRegistryService.js", () => ({
  listResources:   mockListResources,
  buildDescriptor: mockBuildDescriptor,
}));

const mockGetConfiguration     = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockGetDefaultConfig     = vi.hoisted(() => vi.fn().mockReturnValue(null));
vi.mock("../services/organisationConfigurationService.js", () => ({
  getConfiguration:        mockGetConfiguration,
  getDefaultConfiguration: mockGetDefaultConfig,
}));

const mockGetOrgStructureSummary = vi.hoisted(() => vi.fn().mockResolvedValue({
  departmentCount: 0, teamCount: 0, positionCount: 0,
  reportingLineCount: 0, activeDelegationCount: 0,
}));
const mockGetEscalationPaths = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock("../services/organisationStructureService.js", () => ({
  getOrgStructureSummary: mockGetOrgStructureSummary,
  getEscalationPaths:     mockGetEscalationPaths,
}));

const mockGetCurrentSpecialists = vi.hoisted(() => vi.fn().mockReturnValue([
  { code: "chief_of_staff",      packCode: "core",       displayName: "Chief of Staff",      executionStatus: "available" },
  { code: "compliance_officer",  packCode: "compliance", displayName: "Compliance Officer",  executionStatus: "available" },
  { code: "hr_officer",          packCode: "hr",         displayName: "HR Officer",          executionStatus: "available" },
  { code: "finance_officer",     packCode: "finance",    displayName: "Finance Officer",     executionStatus: "available" },
  { code: "operations_manager",  packCode: "operations", displayName: "Operations Manager",  executionStatus: "available" },
]));
vi.mock("../lib/workforceRegistry.js", () => ({
  getCurrentSpecialists: mockGetCurrentSpecialists,
}));

const mockTenantHasWorkforcePack = vi.hoisted(() => vi.fn());
const mockTenantCanUseFeature    = vi.hoisted(() => vi.fn());
vi.mock("../services/entitlementService.js", () => ({
  tenantHasWorkforcePack: mockTenantHasWorkforcePack,
  tenantCanUseFeature:    mockTenantCanUseFeature,
}));

const mockLogOrgEvent = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

// Import after all mocks
const {
  assembleRuntimeContext,
  isSensitivityPermitted,
  filterBySensitivity,
} = await import("../services/runtimeContextService.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID   = "org-abc-001";
const USER_ID  = "user-abc-001";

function makeOrg(overrides: Record<string, unknown> = {}) {
  return {
    id: ORG_ID,
    name: "Test Org",
    slug: "test-org",
    displayName: "Test Organisation",
    type: "business",
    industry: "technology",
    country: "AU",
    state: "NSW",
    timezone: "Australia/Sydney",
    subscriptionTier: "professional",
    status: "active",
    executionFrozen: false,
    ndisRegistrationNumber: null,
    ...overrides,
  };
}

function makeMembership() {
  return { id: "mem-001", organizationId: ORG_ID, userId: USER_ID, status: "active" };
}

function grantedPack(source = "subscription") {
  return { allowed: true as const, source, effectiveUntil: null, reason: undefined };
}
function deniedPack(reason = "Pack not included") {
  return { allowed: false as const, source: undefined, effectiveUntil: undefined, reason };
}
function grantedFeature() { return { allowed: true as const, source: "subscription", effectiveUntil: null }; }
function deniedFeature(reason = "Feature not included") {
  return { allowed: false as const, source: undefined, effectiveUntil: undefined, reason };
}

// ─── Chain helpers ────────────────────────────────────────────────────────────

function makeSelectChain(result: unknown[]) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {
    from:    vi.fn(),
    where:   vi.fn(),
    limit:   vi.fn().mockResolvedValue(result),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  // For count queries that don't call .limit()
  chain.then = ((cb: (v: unknown[]) => unknown) => Promise.resolve(cb(result))) as unknown as typeof chain.then;
  return chain;
}

/** Sets up a full happy-path sequence of DB select calls for assembleRuntimeContext */
function setupHappyPathDb(
  org = makeOrg(),
  membership: unknown = makeMembership(),
  memoryRows: unknown[] = [],
  activeCount = 3,
  pendingCount = 1,
) {
  // 0. Cross-tenant membership check (only if requestingUserId provided)
  mockDb.select.mockReturnValueOnce(makeSelectChain(membership ? [membership] : []));
  // 1. Org identity
  mockDb.select.mockReturnValueOnce(makeSelectChain([org]));
  // 3. Memory
  mockDb.select.mockReturnValueOnce(makeSelectChain(memoryRows));
  // 9. Runtime counts — active
  mockDb.select.mockReturnValueOnce(makeSelectChain([{ n: activeCount }]));
  // 9. Runtime counts — pending
  mockDb.select.mockReturnValueOnce(makeSelectChain([{ n: pendingCount }]));
}

/** Sets up without membership check (no requestingUserId) */
function setupDbNoMembershipCheck(
  org = makeOrg(),
  memoryRows: unknown[] = [],
  activeCount = 0,
  pendingCount = 0,
) {
  mockDb.select.mockReturnValueOnce(makeSelectChain([org]));          // org
  mockDb.select.mockReturnValueOnce(makeSelectChain(memoryRows));     // memory
  mockDb.select.mockReturnValueOnce(makeSelectChain([{ n: activeCount }]));   // active count
  mockDb.select.mockReturnValueOnce(makeSelectChain([{ n: pendingCount }]));  // pending count
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLogOrgEvent.mockResolvedValue(undefined);
});

// ─── Cross-tenant guard tests ─────────────────────────────────────────────────

describe("Cross-tenant guard", () => {
  it("throws CROSS_TENANT_ACCESS when requesting user is not a member of the org", async () => {
    // Membership query returns empty (user not a member)
    mockDb.select.mockReturnValueOnce(makeSelectChain([]));

    await expect(
      assembleRuntimeContext(ORG_ID, "chief_of_staff", { requestingUserId: "rogue-user" }),
    ).rejects.toMatchObject({ code: "CROSS_TENANT_ACCESS" });
  });

  it("throws CROSS_TENANT_ACCESS when membership status is not active (e.g. suspended)", async () => {
    // The query filters status='active' so a suspended membership returns empty
    mockDb.select.mockReturnValueOnce(makeSelectChain([]));

    await expect(
      assembleRuntimeContext(ORG_ID, "chief_of_staff", { requestingUserId: USER_ID }),
    ).rejects.toMatchObject({ code: "CROSS_TENANT_ACCESS" });
  });

  it("proceeds normally when requesting user is an active member", async () => {
    setupHappyPathDb();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff", { requestingUserId: USER_ID });
    expect(ctx.organisationId).toBe(ORG_ID);
    expect(ctx.permissions.packGranted).toBe(true);
  });

  it("skips membership check when requestingUserId is not provided", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");
    expect(ctx.organisationId).toBe(ORG_ID);
    // No extra select call for membership
    const membershipCalls = mockDb.select.mock.calls.length;
    // 1 (org) + 1 (memory) + 2 (counts) = 4 total selects; no extra membership select
    expect(membershipCalls).toBe(4);
  });
});

// ─── Specialist pack denial ───────────────────────────────────────────────────

describe("Specialist pack denial", () => {
  it("returns packGranted=false and empty capabilityCodes when pack is not included", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(deniedPack("Pack not in subscription"));
    mockTenantCanUseFeature.mockResolvedValue(deniedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "compliance_officer");

    expect(ctx.permissions.packGranted).toBe(false);
    expect(ctx.permissions.capabilityCodes).not.toContain("workforce_pack.compliance");
  });

  it("returns packGranted=false for an unrecognised specialist role code", async () => {
    setupDbNoMembershipCheck();
    // No pack lookup should occur — specialist not in registry
    mockTenantCanUseFeature.mockResolvedValue(deniedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "unknown_specialist_xyz");

    expect(ctx.permissions.packGranted).toBe(false);
    expect(ctx.permissions.capabilityCodes).toHaveLength(0);
    // tenantHasWorkforcePack should NOT be called for unrecognised code
    expect(mockTenantHasWorkforcePack).not.toHaveBeenCalled();
  });

  it("returns sensitivityClearance=public when pack is denied", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(deniedPack());
    mockTenantCanUseFeature.mockResolvedValue(deniedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "compliance_officer");

    expect(ctx.permissions.sensitivityClearance).toBe("public");
  });

  it("deny-by-default: resourcePermissions is empty when no resources are accessible", async () => {
    setupDbNoMembershipCheck();
    mockListResources.mockResolvedValueOnce([]);
    mockTenantHasWorkforcePack.mockResolvedValue(deniedPack());
    mockTenantCanUseFeature.mockResolvedValue(deniedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.permissions.resourcePermissions).toEqual({});
  });
});

// ─── Sensitivity clearance tests ──────────────────────────────────────────────

describe("Sensitivity clearance by pack", () => {
  const cases: Array<[string, string, string]> = [
    ["compliance_officer", "compliance", "confidential"],
    ["hr_officer",         "hr",         "confidential"],
    ["finance_officer",    "finance",    "confidential"],
    ["chief_of_staff",     "core",       "internal"],
    ["operations_manager", "operations", "internal"],
  ];

  it.each(cases)(
    "%s (pack=%s) → sensitivityClearance=%s",
    async (roleCode, _packCode, expectedClearance) => {
      setupDbNoMembershipCheck();
      mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
      mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

      const ctx = await assembleRuntimeContext(ORG_ID, roleCode);

      expect(ctx.permissions.sensitivityClearance).toBe(expectedClearance);
    },
  );
});

// ─── Feature entitlement (canBrowse / canExecuteConnectors) ──────────────────

describe("Feature entitlements", () => {
  it("canBrowse=true when browser_session feature is granted", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature
      .mockResolvedValueOnce(grantedFeature())  // browser_session
      .mockResolvedValueOnce(deniedFeature());  // api_connectors

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.permissions.canBrowse).toBe(true);
    expect(ctx.permissions.canExecuteConnectors).toBe(false);
  });

  it("canExecuteConnectors=true when api_connectors feature is granted", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature
      .mockResolvedValueOnce(deniedFeature())  // browser_session
      .mockResolvedValueOnce(grantedFeature()); // api_connectors

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.permissions.canBrowse).toBe(false);
    expect(ctx.permissions.canExecuteConnectors).toBe(true);
  });

  it("both denied when subscription does not include execution features", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(deniedFeature("Not in plan"));

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.permissions.canBrowse).toBe(false);
    expect(ctx.permissions.canExecuteConnectors).toBe(false);
  });

  it("capability codes include granted execution channels", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature
      .mockResolvedValueOnce(grantedFeature())  // browser_session
      .mockResolvedValueOnce(grantedFeature()); // api_connectors

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.permissions.capabilityCodes).toContain("execution.browser_session");
    expect(ctx.permissions.capabilityCodes).toContain("execution.api_connectors");
    expect(ctx.permissions.capabilityCodes).toContain("workforce_pack.core");
  });
});

// ─── Allowed access (full grant) ─────────────────────────────────────────────

describe("Allowed access — all grants", () => {
  it("returns fully populated permissions for an entitled specialist", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "compliance_officer");

    expect(ctx.permissions.packGranted).toBe(true);
    expect(ctx.permissions.capabilityCodes).toContain("workforce_pack.compliance");
    expect(ctx.permissions.canBrowse).toBe(true);
    expect(ctx.permissions.canExecuteConnectors).toBe(true);
    expect(ctx.permissions.sensitivityClearance).toBe("confidential");
  });

  it("resource permissions are built from available resources", async () => {
    setupDbNoMembershipCheck();
    mockListResources.mockResolvedValueOnce([
      {
        id: "res-1", connectorType: "file_connector",
        permittedEmployees: ["chief_of_staff"], readPermissions: [],
      },
    ]);
    mockBuildDescriptor.mockReturnValueOnce({
      resourceId: "res-1", displayName: "SharePoint", resourceType: "document_store",
      connectorType: "file_connector", availableOperations: ["read", "search"],
    });
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.permissions.resourcePermissions["res-1"]).toEqual(["read", "search"]);
  });
});

// ─── Partial entitlement ──────────────────────────────────────────────────────

describe("Partial entitlement", () => {
  it("pack granted but browse denied — canBrowse remains false", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature
      .mockResolvedValueOnce(deniedFeature("Browser not in plan"))
      .mockResolvedValueOnce(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.permissions.packGranted).toBe(true);
    expect(ctx.permissions.canBrowse).toBe(false);
    expect(ctx.permissions.canExecuteConnectors).toBe(true);
    // pack capability is still included
    expect(ctx.permissions.capabilityCodes).toContain("workforce_pack.core");
    expect(ctx.permissions.capabilityCodes).not.toContain("execution.browser_session");
  });
});

// ─── Runtime counts ───────────────────────────────────────────────────────────

describe("Runtime counts from execution_intents", () => {
  it("activeGraphCount reflects approved+dispatched intents", async () => {
    setupDbNoMembershipCheck(makeOrg(), [], 7, 2);
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.runtimeState.activeGraphCount).toBe(7);
  });

  it("pendingIntentCount reflects pending_approval intents", async () => {
    setupDbNoMembershipCheck(makeOrg(), [], 0, 4);
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.runtimeState.pendingIntentCount).toBe(4);
  });

  it("falls back to zero counts when the count query fails", async () => {
    // Org select ok, memory ok, count query throws
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([makeOrg()]))     // org
      .mockReturnValueOnce(makeSelectChain([]))              // memory
      .mockReturnValueOnce({                                 // active count — throws
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockRejectedValue(new Error("DB error")),
      })
      .mockReturnValueOnce({                                 // pending count — throws
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockRejectedValue(new Error("DB error")),
      });
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.runtimeState.activeGraphCount).toBe(0);
    expect(ctx.runtimeState.pendingIntentCount).toBe(0);
  });

  it("reflects executionFrozen from org record", async () => {
    setupDbNoMembershipCheck(makeOrg({ executionFrozen: true }));
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    const ctx = await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    expect(ctx.runtimeState.executionFrozen).toBe(true);
  });
});

// ─── Audit events ─────────────────────────────────────────────────────────────

describe("Audit permission decisions", () => {
  it("fires an audit event for each context assembly", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    // Allow the fire-and-forget promise to settle
    await Promise.resolve();
    expect(mockLogOrgEvent).toHaveBeenCalledOnce();
    expect(mockLogOrgEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        actorType:      "system",
        resourceType:   "runtime_context",
        metadata:       expect.objectContaining({
          specialistCode: "chief_of_staff",
          packGranted:    true,
        }),
      }),
    );
  });

  it("fires specialist.run_blocked audit when pack is denied", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(deniedPack("Not subscribed"));
    mockTenantCanUseFeature.mockResolvedValue(deniedFeature());

    await assembleRuntimeContext(ORG_ID, "compliance_officer");

    await Promise.resolve();
    const call = mockLogOrgEvent.mock.calls[0]?.[0];
    expect(call?.eventType).toBe("specialist.run_blocked");
    expect(call?.metadata?.packGranted).toBe(false);
    expect(call?.metadata?.packDeniedReason).toBe("Not subscribed");
  });

  it("fires specialist.run_queued audit when pack is granted", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());

    await assembleRuntimeContext(ORG_ID, "chief_of_staff");

    await Promise.resolve();
    const call = mockLogOrgEvent.mock.calls[0]?.[0];
    expect(call?.eventType).toBe("specialist.run_queued");
  });

  it("context assembly is not blocked when audit write fails", async () => {
    setupDbNoMembershipCheck();
    mockTenantHasWorkforcePack.mockResolvedValue(grantedPack());
    mockTenantCanUseFeature.mockResolvedValue(grantedFeature());
    mockLogOrgEvent.mockRejectedValue(new Error("Audit write failed"));

    // Should not throw despite audit failure
    await expect(assembleRuntimeContext(ORG_ID, "chief_of_staff")).resolves.toBeDefined();
  });
});

// ─── Sensitivity gate helpers ─────────────────────────────────────────────────

describe("isSensitivityPermitted", () => {
  it("public clearance permits only public sources", () => {
    expect(isSensitivityPermitted("public",       "public")).toBe(true);
    expect(isSensitivityPermitted("internal",     "public")).toBe(false);
    expect(isSensitivityPermitted("confidential", "public")).toBe(false);
    expect(isSensitivityPermitted("restricted",   "public")).toBe(false);
  });

  it("internal clearance permits public and internal sources", () => {
    expect(isSensitivityPermitted("public",       "internal")).toBe(true);
    expect(isSensitivityPermitted("internal",     "internal")).toBe(true);
    expect(isSensitivityPermitted("confidential", "internal")).toBe(false);
    expect(isSensitivityPermitted("restricted",   "internal")).toBe(false);
  });

  it("confidential clearance permits up to confidential sources", () => {
    expect(isSensitivityPermitted("public",       "confidential")).toBe(true);
    expect(isSensitivityPermitted("internal",     "confidential")).toBe(true);
    expect(isSensitivityPermitted("confidential", "confidential")).toBe(true);
    expect(isSensitivityPermitted("restricted",   "confidential")).toBe(false);
  });

  it("restricted clearance permits all levels", () => {
    expect(isSensitivityPermitted("public",       "restricted")).toBe(true);
    expect(isSensitivityPermitted("internal",     "restricted")).toBe(true);
    expect(isSensitivityPermitted("confidential", "restricted")).toBe(true);
    expect(isSensitivityPermitted("restricted",   "restricted")).toBe(true);
  });

  it("unknown source or clearance level is denied", () => {
    expect(isSensitivityPermitted("secret",   "internal")).toBe(false);
    expect(isSensitivityPermitted("internal", "top_secret")).toBe(false);
    expect(isSensitivityPermitted("",         "internal")).toBe(false);
  });
});

describe("filterBySensitivity", () => {
  const sources = [
    { id: "s1", sensitivityClassification: "public",       title: "Public Doc" },
    { id: "s2", sensitivityClassification: "internal",     title: "Internal Doc" },
    { id: "s3", sensitivityClassification: "confidential", title: "Confidential Doc" },
    { id: "s4", sensitivityClassification: "restricted",   title: "Restricted Doc" },
  ];

  it("returns only public sources for public clearance", () => {
    const result = filterBySensitivity(sources, "public");
    expect(result.map(s => s.id)).toEqual(["s1"]);
  });

  it("returns public + internal for internal clearance", () => {
    const result = filterBySensitivity(sources, "internal");
    expect(result.map(s => s.id)).toEqual(["s1", "s2"]);
  });

  it("returns up to confidential for confidential clearance", () => {
    const result = filterBySensitivity(sources, "confidential");
    expect(result.map(s => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("returns all sources for restricted clearance", () => {
    const result = filterBySensitivity(sources, "restricted");
    expect(result.map(s => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("returns empty for unknown clearance level", () => {
    const result = filterBySensitivity(sources, "god_mode");
    expect(result).toHaveLength(0);
  });
});
