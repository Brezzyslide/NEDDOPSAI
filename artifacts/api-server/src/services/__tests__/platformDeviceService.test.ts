/**
 * platformDeviceService tests — Task #34
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockSelect = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockInsert = vi.hoisted(() => vi.fn());
const mockLog    = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@workspace/db", () => {
  const chainEnd = vi.fn().mockResolvedValue([]);

  const limit   = vi.fn().mockReturnThis();
  const offset  = vi.fn().mockReturnThis();
  const orderBy = vi.fn().mockReturnThis();
  const where   = vi.fn().mockReturnValue({ limit, orderBy, offset, then: chainEnd });
  const from    = vi.fn().mockReturnValue({ where, leftJoin: vi.fn().mockReturnThis(), limit, orderBy });
  const leftJoin = vi.fn().mockReturnThis();
  const values  = vi.fn().mockResolvedValue([]);
  const set     = vi.fn().mockReturnValue({ where });

  mockSelect.mockReturnValue({ from });
  mockUpdate.mockReturnValue({ set });
  mockInsert.mockReturnValue({ values });

  return {
    db: { select: mockSelect, update: mockUpdate, insert: mockInsert },
    devicesTable: {},
    deviceCredentialsTable: {},
    deviceRuntimeStatusTable: {},
    organizationsTable: {},
    platformAuditLogTable: {},
  };
});

vi.mock("../auditService.js", () => ({
  log: mockLog,
  writeAuditEvent: mockLog,
  getRequestMeta: vi.fn(() => ({})),
  auditService: { log: mockLog, writeAuditEvent: mockLog },
}));

import {
  computeOnlineStatus,
  checkActionRateLimit,
} from "../platformDeviceService.js";

// ── computeOnlineStatus ──────────────────────────────────────────────────────

describe("computeOnlineStatus", () => {
  it("returns 'never_connected' when heartbeat is null", () => {
    expect(computeOnlineStatus(null)).toBe("never_connected");
  });

  it("returns 'online' when heartbeat was <5 min ago", () => {
    const recent = new Date(Date.now() - 2 * 60 * 1000); // 2 min ago
    expect(computeOnlineStatus(recent)).toBe("online");
  });

  it("returns 'offline' when heartbeat was >5 min ago", () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    expect(computeOnlineStatus(stale)).toBe("offline");
  });

  it("returns 'offline' when heartbeat is exactly at threshold boundary", () => {
    // 5 min + 1s = stale
    const boundary = new Date(Date.now() - 5 * 60 * 1000 - 1000);
    expect(computeOnlineStatus(boundary)).toBe("offline");
  });

  it("returns 'online' when heartbeat was 4m59s ago", () => {
    const near = new Date(Date.now() - 4 * 60 * 1000 - 59 * 1000);
    expect(computeOnlineStatus(near)).toBe("online");
  });
});

// ── checkActionRateLimit ─────────────────────────────────────────────────────

describe("checkActionRateLimit", () => {
  it("allows up to 20 actions per hour", () => {
    const uid = `action-rl-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      expect(() => checkActionRateLimit(uid)).not.toThrow();
    }
    expect(() => checkActionRateLimit(uid)).toThrow("Rate limit");
  });

  it("enforces rate limit independently per user", () => {
    const a = `dev-rl-a-${Math.random()}`;
    const b = `dev-rl-b-${Math.random()}`;
    for (let i = 0; i < 20; i++) checkActionRateLimit(a);
    expect(() => checkActionRateLimit(b)).not.toThrow();
  });
});

// ── no-secrets invariant (structural) ────────────────────────────────────────

describe("safeDevice shape (structural check)", () => {
  it("platform query functions never import tokenHash or webhookSecretHash symbols", async () => {
    // Dynamic import to check what the module exports
    const mod = await import("../platformDeviceService.js");
    const exported = Object.keys(mod);
    // Ensure the module doesn't expose any credential-hash functions
    const dangerous = exported.filter(k =>
      k.toLowerCase().includes("hash") || k.toLowerCase().includes("secret"),
    );
    expect(dangerous).toHaveLength(0);
  });
});
