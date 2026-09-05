/**
 * Tests: activationCodeService — Sprint 14
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ───────────────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
  withSystemTenantContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => fn({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  })),
  deviceActivationTokensTable: {},
}));

vi.mock("@workspace/org-db", () => ({ withOrgContext: vi.fn() }));
vi.mock("../../services/auditService.js", () => ({ writeAuditEvent: vi.fn() }));

import { formatCode, hashCode, isExpired, isLocked } from "../activationCodeService.js";

// ── Unit: formatCode ──────────────────────────────────────────────────────────

describe("formatCode", () => {
  it("groups 16 chars into XXXX-XXXX-XXXX-XXXX", () => {
    expect(formatCode("ABCD1234EFGH5678")).toBe("ABCD-1234-EFGH-5678");
  });

  it("pads short codes with spaces", () => {
    const formatted = formatCode("ABCD");
    expect(formatted).toContain("ABCD");
  });
});

// ── Unit: hashCode ────────────────────────────────────────────────────────────

describe("hashCode", () => {
  it("produces a 64-char hex SHA-256 hash", async () => {
    const hash = await hashCode("ABCD-1234-EFGH-5678");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("is deterministic", async () => {
    const a = await hashCode("MY-CODE-1234-5678");
    const b = await hashCode("MY-CODE-1234-5678");
    expect(a).toBe(b);
  });

  it("strips dashes before hashing (normalises format)", async () => {
    const withDashes = await hashCode("ABCD-1234-EFGH-5678");
    const withoutDashes = await hashCode("ABCD1234EFGH5678");
    expect(withDashes).toBe(withoutDashes);
  });
});

// ── Unit: isExpired ───────────────────────────────────────────────────────────

describe("isExpired", () => {
  it("returns true when expiresAt is in the past", () => {
    const past = new Date(Date.now() - 1000);
    expect(isExpired(past)).toBe(true);
  });

  it("returns false when expiresAt is in the future", () => {
    const future = new Date(Date.now() + 60_000);
    expect(isExpired(future)).toBe(false);
  });
});

// ── Unit: isLocked ────────────────────────────────────────────────────────────

describe("isLocked", () => {
  it("returns true when failedAttempts >= 5", () => {
    expect(isLocked(5)).toBe(true);
    expect(isLocked(6)).toBe(true);
  });

  it("returns false when failedAttempts < 5", () => {
    expect(isLocked(0)).toBe(false);
    expect(isLocked(4)).toBe(false);
  });
});
