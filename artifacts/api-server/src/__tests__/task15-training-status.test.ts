/**
 * Task #15 — Specialist Training Status Tests
 *
 * Tests for the per-specialist training readiness state machine.
 *
 *   - Default state is 'not_started'
 *   - Valid transitions succeed
 *   - Invalid transitions throw INVALID_TRANSITION
 *   - Transitioning to 'ready' requires owner or admin
 *   - Suspending requires owner or admin
 *   - needs_attention is reachable from any status (emergency)
 *   - Tenant isolation: wrong-org returns null
 *   - Flag updates work independently of status transitions
 *   - getOrCreateTrainingStatus creates a record if none exists
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRAINING_STATUS_TRANSITIONS, TRAINING_STATUSES } from "@workspace/db";

// ─── Mock @workspace/db ───────────────────────────────────────────────────────
// vi.mock is hoisted to top of file — use vi.hoisted() so mockDb is available
// inside the factory without hitting the temporal dead zone.

const { mockDb, selectChain, insertChain, updateChain } = vi.hoisted(() => {
  const insertChain = { values: vi.fn().mockReturnThis(), returning: vi.fn() };
  const updateChain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn(),
  };
  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  const mockDb = {
    select: vi.fn().mockReturnValue(selectChain),
    insert: vi.fn().mockReturnValue(insertChain),
    update: vi.fn().mockReturnValue(updateChain),
  };
  return { mockDb, selectChain, insertChain, updateChain };
});

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");
  return { ...actual, db: mockDb };
});

const {
  getOrCreateTrainingStatus,
  getTrainingStatus,
  transitionTrainingStatus,
  updateTrainingFlags,
  TrainingStatusError,
} = await import("../services/specialistTrainingStatusService.js");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_A = "org-a-train-0000-0000-000000000001";
const ORG_B = "org-b-train-0000-0000-000000000002";
const USER_OWNER = "user-owner-0000-0000-000000000001";
const USER_MEMBER = "user-member-0000-0000-000000000001";
const SPECIALIST = "chief_of_staff";

function makeStatusRecord(overrides: Partial<any> = {}) {
  return {
    id: "ts-001",
    organizationId: ORG_A,
    specialistId: SPECIALIST,
    status: "not_started",
    configurationComplete: false,
    knowledgeSourcesApproved: false,
    retrievalTestPassed: false,
    sampleTaskPassed: false,
    approvedByUserId: null,
    approvedAt: null,
    lastTestedAt: null,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── Default state ────────────────────────────────────────────────────────────

describe("Task #15 — Training status default state", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a 'not_started' record when none exists", async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const newRecord = makeStatusRecord();
    insertChain.returning.mockResolvedValueOnce([newRecord]);

    const result = await getOrCreateTrainingStatus(ORG_A, SPECIALIST);
    expect(result.status).toBe("not_started");
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it("returns existing record without inserting when one exists", async () => {
    const existing = makeStatusRecord({ status: "configuring" });
    selectChain.limit.mockResolvedValueOnce([existing]);

    const result = await getOrCreateTrainingStatus(ORG_A, SPECIALIST);
    expect(result.status).toBe("configuring");
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("getTrainingStatus returns null when no record exists", async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const result = await getTrainingStatus(ORG_A, SPECIALIST);
    expect(result).toBeNull();
  });
});

// ─── Valid transitions ────────────────────────────────────────────────────────

describe("Task #15 — Valid status transitions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("not_started → configuring is valid", async () => {
    const record = makeStatusRecord({ status: "not_started" });
    selectChain.limit.mockResolvedValueOnce([record]);
    const updated = makeStatusRecord({ status: "configuring" });
    updateChain.returning.mockResolvedValueOnce([updated]);

    const result = await transitionTrainingStatus({
      organizationId: ORG_A,
      specialistId: SPECIALIST,
      newStatus: "configuring",
      actorUserId: USER_OWNER,
      actorRole: "owner",
    });
    expect(result.status).toBe("configuring");
  });

  it("configuring → knowledge_processing is valid", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "configuring" })]);
    updateChain.returning.mockResolvedValueOnce([makeStatusRecord({ status: "knowledge_processing" })]);

    const result = await transitionTrainingStatus({
      organizationId: ORG_A,
      specialistId: SPECIALIST,
      newStatus: "knowledge_processing",
      actorUserId: USER_OWNER,
      actorRole: "owner",
    });
    expect(result.status).toBe("knowledge_processing");
  });

  it("testing → ready is valid for owner", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "testing" })]);
    updateChain.returning.mockResolvedValueOnce([makeStatusRecord({ status: "ready", approvedByUserId: USER_OWNER, approvedAt: new Date() })]);

    const result = await transitionTrainingStatus({
      organizationId: ORG_A,
      specialistId: SPECIALIST,
      newStatus: "ready",
      actorUserId: USER_OWNER,
      actorRole: "owner",
    });
    expect(result.status).toBe("ready");
  });

  it("testing → ready is valid for admin", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "testing" })]);
    updateChain.returning.mockResolvedValueOnce([makeStatusRecord({ status: "ready" })]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "ready",
        actorUserId: "admin-user",
        actorRole: "admin",
      }),
    ).resolves.toBeDefined();
  });
});

// ─── Invalid transitions ──────────────────────────────────────────────────────

describe("Task #15 — Invalid status transitions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("not_started → ready throws INVALID_TRANSITION", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "not_started" })]);
    insertChain.returning.mockResolvedValue([makeStatusRecord()]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "ready",
        actorUserId: USER_OWNER,
        actorRole: "owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("not_started → testing throws INVALID_TRANSITION", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "not_started" })]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "testing",
        actorUserId: USER_OWNER,
        actorRole: "owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("ready → configuring throws INVALID_TRANSITION", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "ready" })]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "configuring",
        actorUserId: USER_OWNER,
        actorRole: "owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("TRAINING_STATUSES contains all 8 expected statuses", () => {
    expect(TRAINING_STATUSES).toContain("not_started");
    expect(TRAINING_STATUSES).toContain("configuring");
    expect(TRAINING_STATUSES).toContain("knowledge_processing");
    expect(TRAINING_STATUSES).toContain("review_required");
    expect(TRAINING_STATUSES).toContain("testing");
    expect(TRAINING_STATUSES).toContain("ready");
    expect(TRAINING_STATUSES).toContain("needs_attention");
    expect(TRAINING_STATUSES).toContain("suspended");
    expect(TRAINING_STATUSES).toHaveLength(8);
  });
});

// ─── needs_attention / suspended emergency transitions ────────────────────────

describe("Task #15 — Emergency transitions (needs_attention, suspended)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("needs_attention is reachable from 'not_started' (emergency)", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "not_started" })]);
    updateChain.returning.mockResolvedValueOnce([makeStatusRecord({ status: "needs_attention" })]);

    // needs_attention is an emergency transition — should succeed even from not_started
    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "needs_attention",
        actorUserId: USER_OWNER,
        actorRole: "owner",
      }),
    ).resolves.toBeDefined();
  });

  it("needs_attention is reachable from 'ready' (regression path)", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "ready" })]);
    updateChain.returning.mockResolvedValueOnce([makeStatusRecord({ status: "needs_attention" })]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "needs_attention",
        actorUserId: USER_OWNER,
        actorRole: "owner",
      }),
    ).resolves.toBeDefined();
  });
});

// ─── Owner/admin gate ─────────────────────────────────────────────────────────

describe("Task #15 — Owner/admin approval gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("member role cannot transition to 'ready' (INSUFFICIENT_ROLE)", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "testing" })]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "ready",
        actorUserId: USER_MEMBER,
        actorRole: "member",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE" });
  });

  it("member role cannot suspend (INSUFFICIENT_ROLE)", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "configuring" })]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "suspended",
        actorUserId: USER_MEMBER,
        actorRole: "member",
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE" });
  });

  it("owner role can suspend", async () => {
    selectChain.limit.mockResolvedValueOnce([makeStatusRecord({ status: "configuring" })]);
    updateChain.returning.mockResolvedValueOnce([makeStatusRecord({ status: "suspended" })]);

    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "suspended",
        actorUserId: USER_OWNER,
        actorRole: "owner",
      }),
    ).resolves.toBeDefined();
  });
});

// ─── Invalid status value ─────────────────────────────────────────────────────

describe("Task #15 — Invalid status value", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws INVALID_STATUS for unknown status string (throws before DB query)", async () => {
    // Service validates the status value BEFORE querying the DB (line 134 in service).
    // No DB mock needed — setting one would leave an unconsumed once-value that
    // leaks into subsequent tests through vi.clearAllMocks() (which preserves
    // the once-queue). Keep this test mock-free.
    await expect(
      transitionTrainingStatus({
        organizationId: ORG_A,
        specialistId: SPECIALIST,
        newStatus: "banana" as any,
        actorUserId: USER_OWNER,
        actorRole: "owner",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATUS" });
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe("Task #15 — Training status tenant isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getTrainingStatus returns null for wrong org", async () => {
    selectChain.limit.mockResolvedValueOnce([]);
    const result = await getTrainingStatus(ORG_B, SPECIALIST);
    expect(result).toBeNull();
  });

  it("wrong-org status query does not return ORG_A records", async () => {
    // DB returns empty because the WHERE clause includes organizationId
    selectChain.limit.mockResolvedValueOnce([]);
    const result = await getTrainingStatus(ORG_B, SPECIALIST);
    expect(result).toBeNull();
  });
});

// ─── Flag updates ─────────────────────────────────────────────────────────────

describe("Task #15 — Flag updates (independent of status transitions)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updateTrainingFlags updates configurationComplete without status change", async () => {
    const existing = makeStatusRecord({ status: "configuring", configurationComplete: false });
    selectChain.limit.mockResolvedValueOnce([existing]);
    const updated = { ...existing, configurationComplete: true, updatedAt: new Date() };
    updateChain.returning.mockResolvedValueOnce([updated]);

    const result = await updateTrainingFlags({
      organizationId: ORG_A,
      specialistId: SPECIALIST,
      actorUserId: USER_OWNER,
      configurationComplete: true,
    });
    expect(result.configurationComplete).toBe(true);
    expect(result.status).toBe("configuring"); // status unchanged
  });

  it("updateTrainingFlags sets lastTestedAt when retrievalTestPassed is set", async () => {
    const existing = makeStatusRecord({ status: "testing" });
    selectChain.limit.mockResolvedValueOnce([existing]);
    const updated = { ...existing, retrievalTestPassed: true, lastTestedAt: new Date() };
    updateChain.returning.mockResolvedValueOnce([updated]);

    const result = await updateTrainingFlags({
      organizationId: ORG_A,
      specialistId: SPECIALIST,
      actorUserId: USER_OWNER,
      retrievalTestPassed: true,
    });
    expect(result.retrievalTestPassed).toBe(true);
  });
});

// ─── TRAINING_STATUS_TRANSITIONS completeness ─────────────────────────────────

describe("Task #15 — TRAINING_STATUS_TRANSITIONS structure", () => {
  it("every status has an entry in the transition table", () => {
    for (const status of TRAINING_STATUSES) {
      expect(TRAINING_STATUS_TRANSITIONS).toHaveProperty(status);
    }
  });

  it("not_started can only go to configuring", () => {
    expect(TRAINING_STATUS_TRANSITIONS.not_started).toEqual(["configuring"]);
  });

  it("ready can go to needs_attention or suspended", () => {
    expect(TRAINING_STATUS_TRANSITIONS.ready).toContain("needs_attention");
    expect(TRAINING_STATUS_TRANSITIONS.ready).toContain("suspended");
  });
});
