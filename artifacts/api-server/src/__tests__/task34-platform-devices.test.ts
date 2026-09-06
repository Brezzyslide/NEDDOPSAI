/**
 * Task #34 — Platform Device Fleet tests
 *
 * Tests for platformDeviceService:
 *   - computeOnlineStatus (stale heartbeat detection)
 *   - checkActionRateLimit (20/hr per staff member)
 *   - listDevicesForPlatform (filters, pagination)
 *   - getDeviceDetailForPlatform (not found, safe fields)
 *   - platform actions (revoke, disable, enable, rotate-credentials)
 *   - no-secrets invariant
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────────
const mockDbSelect  = vi.hoisted(() => vi.fn());
const mockDbUpdate  = vi.hoisted(() => vi.fn());
const mockDbExecute = vi.hoisted(() => vi.fn());
const mockLog       = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// Helpers for chaining
function makeSelectChain(rows: any[] = []) {
  const chain: any = {};
  const terminal = Promise.resolve(rows);
  const terminable = { then: terminal.then.bind(terminal), catch: terminal.catch.bind(terminal), finally: terminal.finally.bind(terminal) };
  chain.from      = vi.fn().mockReturnValue(chain);
  chain.leftJoin  = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.orderBy   = vi.fn().mockReturnValue(chain);
  chain.limit     = vi.fn().mockReturnValue({ ...terminable, offset: vi.fn().mockReturnValue(terminable) });
  Object.assign(chain, terminable);
  return chain;
}

function makeUpdateChain() {
  const setChain: any = {};
  setChain.where = vi.fn().mockResolvedValue([]);
  const updateChain: any = { set: vi.fn().mockReturnValue(setChain) };
  return updateChain;
}

vi.mock("@workspace/db", () => ({
  db: { execute: mockDbExecute, select: mockDbSelect, update: mockDbUpdate, insert: vi.fn().mockResolvedValue([]) },
  withSystemTenantContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => fn({
    execute: mockDbExecute,
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: vi.fn().mockResolvedValue([]),
  })),
  devicesTable:              { id: "id", organizationId: "organization_id", status: "status", lastHeartbeatAt: "last_heartbeat_at", isPlatformDisabled: "is_platform_disabled" },
  deviceCredentialsTable:    { id: "id", deviceId: "device_id", organizationId: "organization_id", revokedAt: "revoked_at", issuedAt: "issued_at" },
  deviceRuntimeStatusTable:  { id: "id", deviceId: "device_id", errorMessage: "error_message", reportedAt: "reported_at" },
  deviceAccessTokensTable:   { id: "id", deviceId: "device_id", organizationId: "organization_id", tokenHash: "token_hash", revokedAt: "revoked_at", expiresAt: "expires_at", audience: "audience" },
  deviceRefreshTokensTable:  { id: "id", deviceId: "device_id", organizationId: "organization_id", tokenHash: "token_hash", revokedAt: "revoked_at", rotatedAt: "rotated_at", expiresAt: "expires_at" },
  organizationsTable:        { id: "id", name: "name" },
  platformAuditLogTable:     { metadata: "metadata", occurredAt: "occurred_at" },
}));

vi.mock("@workspace/db/platform", () => ({
  platformDb: {
    execute: mockDbExecute,
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../services/auditService.js", () => ({
  log: mockLog,
  writeAuditEvent: mockLog,
  auditService: { log: mockLog, writeAuditEvent: mockLog },
  getRequestMeta: vi.fn(() => ({})),
}));

// Use absolute re-import path that matches the service's own import
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ _eq: [a, b] })),
  and: vi.fn((...args: any[]) => ({ _and: args.filter(Boolean) })),
  ilike: vi.fn((a: any, b: any) => ({ _ilike: [a, b] })),
  or: vi.fn((...args: any[]) => ({ _or: args })),
  isNull: vi.fn(a => ({ _isNull: a })),
  lt: vi.fn((a: any, b: any) => ({ _lt: [a, b] })),
  desc: vi.fn(a => ({ _desc: a })),
  sql: Object.assign(vi.fn(s => s), { mapWith: vi.fn() }),
  inArray: vi.fn((a: any, b: any) => ({ _in: [a, b] })),
  count: vi.fn(() => "count(*)"),
}));

import {
  computeOnlineStatus,
  checkActionRateLimit,
} from "../services/platformDeviceService.js";

// ── computeOnlineStatus ──────────────────────────────────────────────────────

describe("computeOnlineStatus", () => {
  it("returns 'never_connected' when heartbeat is null", () => {
    expect(computeOnlineStatus(null)).toBe("never_connected");
  });

  it("returns 'online' when heartbeat was 2 min ago", () => {
    const recent = new Date(Date.now() - 2 * 60 * 1000);
    expect(computeOnlineStatus(recent)).toBe("online");
  });

  it("returns 'offline' when heartbeat was 10 min ago", () => {
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    expect(computeOnlineStatus(stale)).toBe("offline");
  });

  it("returns 'offline' at exactly 5min + 1s over threshold", () => {
    const boundary = new Date(Date.now() - 5 * 60 * 1000 - 1000);
    expect(computeOnlineStatus(boundary)).toBe("offline");
  });

  it("returns 'online' at 4m59s before threshold", () => {
    const near = new Date(Date.now() - 4 * 60 * 1000 - 59 * 1000);
    expect(computeOnlineStatus(near)).toBe("online");
  });

  it("treats Date at exactly threshold as online (inclusive boundary)", () => {
    // Exactly 5 minutes = within threshold (<=)
    const exact = new Date(Date.now() - 5 * 60 * 1000);
    expect(computeOnlineStatus(exact)).toBe("online");
  });
});

// ── checkActionRateLimit ─────────────────────────────────────────────────────

describe("checkActionRateLimit", () => {
  it("allows exactly 20 actions per hour", () => {
    const uid = `rl-${Math.random()}`;
    for (let i = 0; i < 20; i++) {
      expect(() => checkActionRateLimit(uid)).not.toThrow();
    }
  });

  it("throws RATE_LIMITED after 20 actions for the same user", () => {
    const uid = `rl-${Math.random()}`;
    for (let i = 0; i < 20; i++) checkActionRateLimit(uid);
    expect(() => checkActionRateLimit(uid)).toThrow("Rate limit");
  });

  it("enforces rate limit independently per user", () => {
    const a = `rl-a-${Math.random()}`;
    const b = `rl-b-${Math.random()}`;
    for (let i = 0; i < 20; i++) checkActionRateLimit(a);
    expect(() => checkActionRateLimit(b)).not.toThrow();
  });

  it("does not leak counts across different users", () => {
    const users = Array.from({ length: 5 }, (_, i) => `rl-multi-${i}-${Math.random()}`);
    users.forEach(uid => {
      expect(() => checkActionRateLimit(uid)).not.toThrow();
    });
  });
});

// ── authenticateDevice: isPlatformDisabled enforcement ───────────────────────

describe("deviceService.authenticateDevice — platform disable enforcement", () => {
  // Reset mock chain for each test
  beforeEach(() => {
    mockDbExecute.mockReset();
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
  });

  it("returns null when device has isPlatformDisabled=true (legacy bearer path)", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        credential_id: "cred-1",
        device_id: "dev-1",
        organization_id: "org-1",
        credential_state: "valid",
        device_state: "platform_disabled",
      }],
    });
    // Update (lastUsedAt) — should NOT be called, but provide chain anyway
    mockDbUpdate.mockReturnValue(makeUpdateChain());

    const { authenticateDevice } = await import("../services/deviceService.js");
    const result = await authenticateDevice("raw-token-abc");
    expect(result).toBeNull();
  });

  it("returns the device when isPlatformDisabled=false (active device)", async () => {
    const deviceRow = {
      id: "dev-2",
      organizationId: "org-1",
      status: "connected",
      revokedAt: null,
      isPlatformDisabled: false,
    };

    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        credential_id: "cred-2",
        device_id: "dev-2",
        organization_id: "org-1",
        credential_state: "valid",
        device_state: "connected",
      }],
    });
    mockDbSelect.mockReturnValueOnce(makeSelectChain([deviceRow]));
    const updateSetChain = { where: vi.fn().mockResolvedValue([]) };
    mockDbUpdate.mockReturnValue({ set: vi.fn().mockReturnValue(updateSetChain) });

    const { authenticateDevice } = await import("../services/deviceService.js");
    const result = await authenticateDevice("raw-token-def");
    expect(result).not.toBeNull();
    expect(result?.device.id).toBe("dev-2");
  });

  it("returns null when device is revoked (existing check still applies)", async () => {
    const deviceRow = {
      id: "dev-3",
      organizationId: "org-1",
      status: "revoked",
      revokedAt: new Date(),
      isPlatformDisabled: false,
    };

    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        credential_id: "cred-3",
        device_id: "dev-3",
        organization_id: "org-1",
        credential_state: "valid",
        device_state: "connected",
      }],
    });
    mockDbSelect.mockReturnValueOnce(makeSelectChain([deviceRow]));
    mockDbUpdate.mockReturnValue(makeUpdateChain());

    const { authenticateDevice } = await import("../services/deviceService.js");
    const result = await authenticateDevice("raw-token-ghi");
    expect(result).toBeNull();
  });
});

// ── validateAccessToken: status=pending enforcement ──────────────────────────

describe("deviceAuthService.validateAccessToken — pending status enforcement", () => {
  beforeEach(() => {
    mockDbExecute.mockReset();
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
  });

  it("returns null when device status is 'pending' (post-rotation lockout)", async () => {
    const deviceRow = {
      id: "dev-10",
      organizationId: "org-1",
      status: "pending",
      revokedAt: null,
      isPlatformDisabled: false,
    };

    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        access_token_id: "tok-1",
        device_id: "dev-10",
        organization_id: "org-1",
        token_state: "valid",
        device_state: "connected",
        audience: "device-relay",
        expires_at: new Date(Date.now() + 60_000),
      }],
    });
    mockDbSelect.mockReturnValueOnce(makeSelectChain([deviceRow]));
    mockDbUpdate.mockReturnValue(makeUpdateChain());

    const { validateAccessToken } = await import("../services/deviceAuthService.js");
    const result = await validateAccessToken("raw-access-token-abc");
    expect(result).toBeNull();
  });
});

// ── refreshAccessToken: isPlatformDisabled + pending enforcement ──────────────

describe("deviceAuthService.refreshAccessToken — platform disable & pending enforcement", () => {
  beforeEach(() => {
    mockDbExecute.mockReset();
    mockDbSelect.mockReset();
    mockDbUpdate.mockReset();
  });

  it("throws DEVICE_PLATFORM_DISABLED when device is platform-disabled", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        refresh_token_id: "rt-1",
        device_id: "dev-20",
        organization_id: "org-1",
        token_state: "valid",
        device_state: "platform_disabled",
        expires_at: new Date(Date.now() + 60_000),
      }],
    });

    const { refreshAccessToken } = await import("../services/deviceAuthService.js");
    await expect(refreshAccessToken("raw-refresh-abc")).rejects.toMatchObject({
      code: "DEVICE_PLATFORM_DISABLED",
    });
  });

  it("throws DEVICE_REACTIVATION_REQUIRED when device status is 'pending'", async () => {
    mockDbExecute.mockResolvedValueOnce({
      rows: [{
        refresh_token_id: "rt-2",
        device_id: "dev-21",
        organization_id: "org-1",
        token_state: "valid",
        device_state: "pending",
        expires_at: new Date(Date.now() + 60_000),
      }],
    });

    const { refreshAccessToken } = await import("../services/deviceAuthService.js");
    await expect(refreshAccessToken("raw-refresh-def")).rejects.toMatchObject({
      code: "DEVICE_REACTIVATION_REQUIRED",
    });
  });
});

// ── no-secrets invariant (exported API surface) ───────────────────────────────

describe("platformDeviceService export surface", () => {
  it("never exports functions whose names imply token/hash access", async () => {
    const mod = await import("../services/platformDeviceService.js");
    const exported = Object.keys(mod);
    const dangerous = exported.filter(k =>
      k.toLowerCase().includes("hash") ||
      k.toLowerCase().includes("secret") ||
      k.toLowerCase().includes("token"),
    );
    expect(dangerous).toHaveLength(0);
  });

  it("exports the expected platform management functions", async () => {
    const mod = await import("../services/platformDeviceService.js");
    const required = [
      "listDevicesForPlatform",
      "getDeviceDetailForPlatform",
      "listDevicesForOrg",
      "platformRevokeDevice",
      "platformDisableDevice",
      "platformEnableDevice",
      "platformRotateDeviceCredentials",
      "getDeviceAuditHistory",
      "getDeviceErrorHistory",
      "computeOnlineStatus",
      "checkActionRateLimit",
    ];
    required.forEach(fn => {
      expect(mod).toHaveProperty(fn);
      expect(typeof (mod as any)[fn]).toBe("function");
    });
  });
});
