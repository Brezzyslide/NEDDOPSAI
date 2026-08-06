/**
 * Tests: deviceService — Sprint 14
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
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  devicesTable: {},
  deviceCredentialsTable: {},
  deviceRuntimeStatusTable: {},
}));

vi.mock("@workspace/org-db", () => ({ withOrgContext: vi.fn() }));
vi.mock("../../services/auditService.js", () => ({ writeAuditEvent: vi.fn() }));

import {
  generateDeviceToken,
  hashDeviceToken,
  buildDeviceToken,
} from "../deviceService.js";

// ── Unit: generateDeviceToken ─────────────────────────────────────────────────

describe("generateDeviceToken", () => {
  it("generates a non-empty string", async () => {
    const token = await generateDeviceToken();
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("generates unique tokens on each call", async () => {
    const [a, b] = await Promise.all([generateDeviceToken(), generateDeviceToken()]);
    expect(a).not.toBe(b);
  });
});

// ── Unit: hashDeviceToken ─────────────────────────────────────────────────────

describe("hashDeviceToken", () => {
  it("produces a 64-char hex string", async () => {
    const hash = await hashDeviceToken("some-random-token-value");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("is deterministic", async () => {
    const a = await hashDeviceToken("deterministic-token");
    const b = await hashDeviceToken("deterministic-token");
    expect(a).toBe(b);
  });

  it("different tokens produce different hashes", async () => {
    const a = await hashDeviceToken("token-a");
    const b = await hashDeviceToken("token-b");
    expect(a).not.toBe(b);
  });
});

// ── Unit: buildDeviceToken (Bearer header format) ─────────────────────────────

describe("buildDeviceToken", () => {
  it("returns a string containing the device ID", () => {
    const token = buildDeviceToken("device-uuid-123", "raw-secret");
    expect(token).toContain("device-uuid-123");
  });

  it("returns a string containing the raw secret", () => {
    const token = buildDeviceToken("device-uuid-123", "raw-secret");
    expect(token).toContain("raw-secret");
  });
});

// ── Integration stubs: register, authenticate ─────────────────────────────────

describe("registerDevice (mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when organisation not found", async () => {
    mockDb.limit.mockResolvedValueOnce([]); // org lookup → empty

    const { registerDevice } = await import("../deviceService.js");
    await expect(
      registerDevice({
        orgId: "org-not-found",
        platform: "macos",
        arch: "arm64",
        displayName: "Test Mac",
        appVersion: "0.1.0",
      }),
    ).rejects.toThrow();
  });
});

describe("authenticateDevice (mocked)", () => {
  it("returns null for unknown device", async () => {
    mockDb.limit.mockResolvedValueOnce([]); // device lookup → empty

    const { authenticateDevice } = await import("../deviceService.js");
    const result = await authenticateDevice("device-uuid-123", "raw-secret");
    expect(result).toBeNull();
  });
});
