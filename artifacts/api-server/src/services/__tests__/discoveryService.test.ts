/**
 * Tests: discoveryService — Sprint 14
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
  execute: vi.fn().mockResolvedValue(undefined),
};

vi.mock("@workspace/db", () => ({
  db: mockDb,
  orgDiscoveryAnswersTable: {},
  orgDiscoveryStatusTable: {},
  orgConnectedSystemsTable: {},
  agentConfigurationsTable: {},
  organizationsTable: {},
}));

vi.mock("@workspace/org-db", () => ({ withOrgContext: vi.fn() }));
vi.mock("../../services/auditService.js", () => ({ writeAuditEvent: vi.fn() }));

import {
  DISCOVERY_SCREENS,
  computeCompletionPercentage,
} from "../discoveryService.js";

// ── Unit: DISCOVERY_SCREENS list ───────────────────────────────────────────────

describe("DISCOVERY_SCREENS", () => {
  it("contains exactly 6 screens", () => {
    expect(DISCOVERY_SCREENS).toHaveLength(6);
  });

  it("all screens have a key and title", () => {
    for (const screen of DISCOVERY_SCREENS) {
      expect(typeof screen.key).toBe("string");
      expect(screen.key.length).toBeGreaterThan(0);
      expect(typeof screen.title).toBe("string");
    }
  });

  it("keys are unique", () => {
    const keys = DISCOVERY_SCREENS.map(s => s.key);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });
});

// ── Unit: computeCompletionPercentage ─────────────────────────────────────────

describe("computeCompletionPercentage", () => {
  it("returns 0 when no screens answered", () => {
    expect(computeCompletionPercentage(0)).toBe(0);
  });

  it("returns 100 when all screens answered", () => {
    expect(computeCompletionPercentage(DISCOVERY_SCREENS.length)).toBe(100);
  });

  it("returns proportional value for partial completion", () => {
    const result = computeCompletionPercentage(3);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });

  it("never returns > 100", () => {
    expect(computeCompletionPercentage(999)).toBe(100);
  });
});

// ── Integration stubs: getDiscoveryProgress ────────────────────────────────────

describe("getDiscoveryProgress (mocked)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns default structure when no existing status", async () => {
    mockDb.limit.mockResolvedValueOnce([]); // status → empty
    mockDb.limit.mockResolvedValueOnce([]); // answers → empty (via select from)
    // Mock the chained select for answers
    mockDb.from.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]); // for answers query

    const { getDiscoveryProgress } = await import("../discoveryService.js");
    const result = await getDiscoveryProgress("org-123");

    expect(result).toMatchObject({
      screens: expect.any(Array),
      completionPercentage: expect.any(Number),
    });
    expect(result.screens).toHaveLength(DISCOVERY_SCREENS.length);
  });
});
