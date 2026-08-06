/**
 * Tests: discoveryService — Sprint 14
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────
// vi.mock() is hoisted above all code by vitest; mockDb must be inside
// vi.hoisted() so it is available when the factory runs.
const mockDb = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  execute: vi.fn().mockResolvedValue(undefined),
}));

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
    // Query 1 (status): .where() must return the chain so .limit(1) can be called.
    // Query 2 (answers): .where() is the terminal call — resolve directly to [].
    // The service has NO .limit() on the answers query, so the second limit queue is not needed.
    mockDb.limit.mockResolvedValueOnce([]); // status query → .limit(1) resolves to []
    mockDb.where
      .mockReturnValueOnce(mockDb) // 1st call (status query): continue chain to .limit()
      .mockResolvedValueOnce([]); // 2nd call (answers query): resolve directly to []

    const { getDiscoveryProgress } = await import("../discoveryService.js");
    const result = await getDiscoveryProgress("org-123");

    expect(result).toMatchObject({
      screens: expect.any(Array),
      completionPercentage: expect.any(Number),
    });
    expect(result.screens).toHaveLength(DISCOVERY_SCREENS.length);
  });
});
