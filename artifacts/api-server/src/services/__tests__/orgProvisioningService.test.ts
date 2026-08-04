/**
 * orgProvisioningService tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockInsert   = vi.hoisted(() => vi.fn());
const mockUpdate   = vi.hoisted(() => vi.fn());
const mockSelect   = vi.hoisted(() => vi.fn());
const mockCreateOrg = vi.hoisted(() => vi.fn());
const mockProvisionPacks = vi.hoisted(() => vi.fn());
const mockCreateInvitation = vi.hoisted(() => vi.fn());

vi.mock("@workspace/db", () => {
  const set  = vi.fn().mockReturnThis();
  const where = vi.fn().mockResolvedValue([]);
  const values = vi.fn().mockResolvedValue([]);
  const from  = vi.fn().mockReturnThis();
  const limit  = vi.fn().mockReturnThis();
  const orderBy = vi.fn().mockReturnThis();

  mockInsert.mockReturnValue({ values });
  mockUpdate.mockReturnValue({ set });
  set.mockReturnValue({ where });
  mockSelect.mockReturnValue({ from });
  from.mockReturnValue({ where });

  return {
    db: { insert: mockInsert, update: mockUpdate, select: mockSelect },
    orgProvisioningJobsTable: { id: "id", organizationId: "organization_id" },
    organizationsTable: {},
  };
});

vi.mock("../orgService.js", () => ({ createOrg: mockCreateOrg }));
vi.mock("../packProvisioningService.js", () => ({ provisionPacksForNewOrg: mockProvisionPacks }));
vi.mock("../invitationService.js", () => ({ createInvitation: mockCreateInvitation }));

import {
  provisionOrganisation,
  checkRateLimit,
  getProvisioningJob,
} from "../orgProvisioningService.js";

describe("checkRateLimit", () => {
  it("allows up to 10 calls per hour", () => {
    const userId = `rate-test-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(() => checkRateLimit(userId)).not.toThrow();
    }
    expect(() => checkRateLimit(userId)).toThrow("Rate limit");
  });

  it("does not interfere between different users", () => {
    const a = `user-a-${Math.random()}`;
    const b = `user-b-${Math.random()}`;
    for (let i = 0; i < 10; i++) checkRateLimit(a);
    expect(() => checkRateLimit(b)).not.toThrow();
  });
});

describe("checkRateLimit — single enforcement boundary", () => {
  it("allows exactly 10 calls then blocks on the 11th", () => {
    const uid = `rl-boundary-${Math.random()}`;
    for (let i = 0; i < 10; i++) {
      expect(() => checkRateLimit(uid)).not.toThrow();
    }
    expect(() => checkRateLimit(uid)).toThrow("Rate limit");
  });
});

describe("provisionOrganisation", () => {
  const BASE_PARAMS = { name: "Test Org" };
  const INITIATOR = "staff_user_1";
  const ORG_ID = "org_123";

  beforeEach(() => {
    vi.clearAllMocks();

    // db.insert(...).values() resolves
    const values = vi.fn().mockResolvedValue([]);
    mockInsert.mockReturnValue({ values });

    // db.update(...).set(...).where() resolves
    const where = vi.fn().mockResolvedValue([]);
    const set   = vi.fn().mockReturnValue({ where });
    mockUpdate.mockReturnValue({ set });

    // db.select().from().where().limit().orderBy()
    const limit   = vi.fn().mockResolvedValue([]);
    const orderBy = vi.fn().mockResolvedValue([]);
    const where2  = vi.fn().mockReturnValue({ limit, orderBy });
    const from    = vi.fn().mockReturnValue({ where: where2 });
    mockSelect.mockReturnValue({ from });

    mockCreateOrg.mockResolvedValue({ org: { id: ORG_ID, name: "Test Org" }, membership: {} });
    mockProvisionPacks.mockResolvedValue({ granted: [], requested: [], rejected: [] });
    mockCreateInvitation.mockResolvedValue({ invitation: { id: "inv_1" }, previewUrl: null, emailDelivery: "sent" });
  });

  it("returns jobId and orgId on full success (no invitation)", async () => {
    // Fresh user to avoid rate limit
    const uid = `prov-success-${Math.random()}`;
    const result = await provisionOrganisation(BASE_PARAMS, uid);
    expect(result.orgId).toBe(ORG_ID);
    expect(result.jobId).toMatch(/^pj_/);
    expect(result.error).toBeUndefined();
  });

  it("calls createInvitation when initialAdminEmail is provided", async () => {
    const uid = `prov-invite-${Math.random()}`;
    await provisionOrganisation(
      { ...BASE_PARAMS, initialAdminEmail: "admin@example.com" },
      uid,
    );
    expect(mockCreateInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ email: "admin@example.com", role: "administrator" }),
    );
  });

  it("returns error but still has orgId when pack provisioning fails", async () => {
    mockProvisionPacks.mockRejectedValueOnce(new Error("pack error"));
    const uid = `prov-packfail-${Math.random()}`;
    const result = await provisionOrganisation(BASE_PARAMS, uid);
    expect(result.orgId).toBe(ORG_ID);
    expect(result.error).toMatch(/pack error/i);
  });

  it("returns orgId=null when org creation fails", async () => {
    mockCreateOrg.mockRejectedValueOnce(new Error("db error"));
    const uid = `prov-orgfail-${Math.random()}`;
    const result = await provisionOrganisation(BASE_PARAMS, uid);
    expect(result.orgId).toBeNull();
    expect(result.error).toMatch(/db error/i);
  });

  it("invitation failure is non-fatal (returns completed)", async () => {
    mockCreateInvitation.mockRejectedValueOnce(new Error("smtp down"));
    const uid = `prov-invfail-${Math.random()}`;
    const result = await provisionOrganisation(
      { ...BASE_PARAMS, initialAdminEmail: "x@example.com" },
      uid,
    );
    // org + packs succeeded so we still get orgId
    expect(result.orgId).toBe(ORG_ID);
  });
});
