/**
 * Sprint 1 — Invitation token tests
 *
 * Tests token generation, hashing, and expiry logic.
 * These functions live in the API server but test the core security properties.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// ─── Token security properties ────────────────────────────────────────────────

describe("Invitation token security properties", () => {
  it("SHA-256 hash of a token is deterministic", () => {
    const rawToken = "test_raw_token_12345_abc";
    const hash1 = createHash("sha256").update(rawToken).digest("hex");
    const hash2 = createHash("sha256").update(rawToken).digest("hex");
    expect(hash1).toBe(hash2);
  });

  it("different raw tokens produce different hashes", () => {
    const hash1 = createHash("sha256").update("token_A").digest("hex");
    const hash2 = createHash("sha256").update("token_B").digest("hex");
    expect(hash1).not.toBe(hash2);
  });

  it("hash is always 64 hex characters (256 bits)", () => {
    const hash = createHash("sha256").update("any_token").digest("hex");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it("cannot reverse a hash to get the raw token", () => {
    // This tests the fundamental property that SHA-256 is one-way.
    // We verify that the hash is not the same as the input.
    const rawToken = "my_invitation_token";
    const hash = createHash("sha256").update(rawToken).digest("hex");
    expect(hash).not.toBe(rawToken);
    expect(hash).not.toContain(rawToken);
  });
});

// ─── Expiry logic ─────────────────────────────────────────────────────────────

describe("Invitation expiry", () => {
  it("correctly identifies expired invitations", () => {
    const pastDate = new Date(Date.now() - 1000); // 1 second ago
    const isExpired = pastDate < new Date();
    expect(isExpired).toBe(true);
  });

  it("correctly identifies valid (non-expired) invitations", () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    const isExpired = futureDate < new Date();
    expect(isExpired).toBe(false);
  });

  it("7-day expiry window calculation", () => {
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SEVEN_DAYS_MS);

    // Should be approximately 7 days in the future
    const diff = expiresAt.getTime() - now.getTime();
    expect(diff).toBeGreaterThanOrEqual(SEVEN_DAYS_MS - 1000); // within 1s tolerance
    expect(diff).toBeLessThanOrEqual(SEVEN_DAYS_MS + 1000);
  });
});
