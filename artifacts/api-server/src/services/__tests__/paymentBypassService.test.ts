/**
 * Tests: paymentBypassService — Sprint 14
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  organizationsTable: {},
  plansTable: {},
  tenantSubscriptionsTable: {},
}));

vi.mock("@workspace/org-db", () => ({ withOrgContext: vi.fn() }));
vi.mock("../../services/auditService.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../../services/packProvisioningService.js", () => ({
  provisionPacksForOrg: vi.fn().mockResolvedValue({ provisioned: [] }),
}));

describe("isPaymentBypassEnabled", () => {
  it("returns false when ENABLE_PAYMENT_BYPASS is not set", async () => {
    const originalEnv = process.env.ENABLE_PAYMENT_BYPASS;
    delete process.env.ENABLE_PAYMENT_BYPASS;

    const { isPaymentBypassEnabled } = await import("../paymentBypassService.js");
    expect(isPaymentBypassEnabled()).toBe(false);

    process.env.ENABLE_PAYMENT_BYPASS = originalEnv;
  });

  it("returns true when ENABLE_PAYMENT_BYPASS=true", async () => {
    process.env.ENABLE_PAYMENT_BYPASS = "true";

    // Re-import to pick up env change
    vi.resetModules();
    const { isPaymentBypassEnabled } = await import("../paymentBypassService.js");
    expect(isPaymentBypassEnabled()).toBe(true);

    delete process.env.ENABLE_PAYMENT_BYPASS;
  });
});

describe("activatePaymentBypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENABLE_PAYMENT_BYPASS = "true";
  });

  it("throws PAYMENT_BYPASS_DISABLED when flag is off", async () => {
    delete process.env.ENABLE_PAYMENT_BYPASS;
    vi.resetModules();
    const { activatePaymentBypass } = await import("../paymentBypassService.js");

    await expect(
      activatePaymentBypass({
        orgId: "org-123",
        orgSlug: "test-org",
        planCode: "foundation",
        billingCycle: "monthly",
        actorUserId: "user-abc",
      }),
    ).rejects.toMatchObject({ code: "PAYMENT_BYPASS_DISABLED" });
  });

  it("throws ORG_NOT_FOUND when org doesn't exist in DB", async () => {
    process.env.ENABLE_PAYMENT_BYPASS = "true";
    mockDb.limit.mockResolvedValueOnce([]); // org lookup → empty
    mockDb.limit.mockResolvedValueOnce([]); // plan lookup → empty

    vi.resetModules();
    const { activatePaymentBypass } = await import("../paymentBypassService.js");

    await expect(
      activatePaymentBypass({
        orgId: "org-not-found",
        orgSlug: "ghost-org",
        planCode: "foundation",
        billingCycle: "monthly",
        actorUserId: "user-abc",
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND/) });
  });
});
