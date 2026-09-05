/**
 * Sprint 15 — Device Authentication Tests
 *
 * Tests the challenge/exchange/refresh/revoke auth flow.
 * All DB operations are mocked.
 *
 * Classification: UNIT (mocked DB)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash, generateKeyPairSync, sign as cryptoSign } from "crypto";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockSelect = vi.fn();

vi.mock("@workspace/db", () => {
  const chainable = (data: unknown) => ({
    from: () => chainable(data),
    where: () => chainable(data),
    limit: () => Promise.resolve(Array.isArray(data) ? data : [data]),
    set: () => chainable(data),
  });

  return {
    db: {
      insert: (table: unknown) => ({
        values: (vals: unknown) => {
          mockInsert(table, vals);
          return Promise.resolve();
        },
      }),
      update: (table: unknown) => ({
        set: (vals: unknown) => ({
          where: () => {
            mockUpdate(table, vals);
            return Promise.resolve();
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: (..._args: unknown[]) => ({
            limit: (n: number) => {
              const result = mockSelect(n);
              return Promise.resolve(Array.isArray(result) ? result : result ? [result] : []);
            },
          }),
        }),
      }),
    },
    withSystemTenantContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) => fn({
      insert: (table: unknown) => ({
        values: (vals: unknown) => {
          mockInsert(table, vals);
          return Promise.resolve();
        },
      }),
      update: (table: unknown) => ({
        set: (vals: unknown) => ({
          where: () => {
            mockUpdate(table, vals);
            return Promise.resolve();
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: (..._args: unknown[]) => ({
            limit: (n: number) => {
              const result = mockSelect(n);
              return Promise.resolve(Array.isArray(result) ? result : result ? [result] : []);
            },
          }),
        }),
      }),
    })),
    devicesTable: { id: "id", organizationId: "org", status: "status", revokedAt: "revokedAt", publicKey: "pk" },
    deviceAuthChallengesTable: { id: "id", deviceId: "deviceId", organizationId: "orgId", expiresAt: "expiresAt", usedAt: "usedAt" },
    deviceAccessTokensTable: { id: "id", deviceId: "deviceId", organizationId: "orgId", tokenHash: "hash", audience: "aud", expiresAt: "exp", revokedAt: "rAt" },
    deviceRefreshTokensTable: { id: "id", deviceId: "deviceId", organizationId: "orgId", tokenHash: "hash", expiresAt: "exp", revokedAt: "rAt", rotatedAt: "rotAt" },
    deviceCredentialsTable: { id: "id", deviceId: "deviceId", organizationId: "orgId", revokedAt: "rAt" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ eq: [a, b] }),
  and: (...args: unknown[]) => ({ and: args }),
  isNull: (a: unknown) => ({ isNull: a }),
}));

// ── Import service after mocks ────────────────────────────────────────────────

import * as deviceAuthService from "../services/deviceAuthService.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateDeviceKeyPair() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function signNonce(nonce: string, privateKeyPem: string): string {
  // Ed25519 manages its own digest — pass null as the algorithm.
  return cryptoSign(null, Buffer.from(nonce, "utf8"), privateKeyPem).toString("base64");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Sprint 15 — Device Authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createChallenge ─────────────────────────────────────────────────────────

  describe("createChallenge()", () => {
    it("returns challengeId, nonce, expiresAt for a valid device", async () => {
      const { publicKey } = generateDeviceKeyPair();
      mockSelect.mockReturnValue({
        id: "dev_1", organizationId: "org_1", status: "connected", revokedAt: null, publicKey,
      });

      const result = await deviceAuthService.createChallenge("dev_1", "org_1");

      expect(result.challengeId).toMatch(/^chall_/);
      expect(result.nonce).toHaveLength(64); // 32-byte hex
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(mockInsert).toHaveBeenCalledOnce();
    });

    it("throws DEVICE_NOT_FOUND when device does not exist", async () => {
      mockSelect.mockReturnValue(null);
      await expect(deviceAuthService.createChallenge("dev_missing", "org_1"))
        .rejects.toMatchObject({ code: "DEVICE_NOT_FOUND" });
    });

    it("throws DEVICE_REVOKED when device is revoked", async () => {
      mockSelect.mockReturnValue({
        id: "dev_1", organizationId: "org_1", status: "revoked", revokedAt: new Date(), publicKey: "pk",
      });
      await expect(deviceAuthService.createChallenge("dev_1", "org_1"))
        .rejects.toMatchObject({ code: "DEVICE_REVOKED" });
    });

    it("throws NO_PUBLIC_KEY when device has no public key", async () => {
      mockSelect.mockReturnValue({
        id: "dev_1", organizationId: "org_1", status: "connected", revokedAt: null, publicKey: null,
      });
      await expect(deviceAuthService.createChallenge("dev_1", "org_1"))
        .rejects.toMatchObject({ code: "NO_PUBLIC_KEY" });
    });
  });

  // ── exchangeChallenge ───────────────────────────────────────────────────────

  describe("exchangeChallenge()", () => {
    it("issues accessToken + refreshToken for a valid signed challenge", async () => {
      const { publicKey, privateKey } = generateDeviceKeyPair();
      const nonce = "a".repeat(64);
      const signature = signNonce(nonce, privateKey);

      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // challenge lookup
          return {
            id: "chall_1",
            deviceId: "dev_1",
            organizationId: "org_1",
            nonce,
            expiresAt: new Date(Date.now() + 60_000),
            usedAt: null,
          };
        }
        // device lookup
        return {
          id: "dev_1",
          organizationId: "org_1",
          status: "connected",
          revokedAt: null,
          publicKey,
        };
      });

      const result = await deviceAuthService.exchangeChallenge({
        deviceId: "dev_1",
        organizationId: "org_1",
        challengeId: "chall_1",
        signature,
      });

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(result.refreshTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
      // Tokens must be different
      expect(result.accessToken).not.toBe(result.refreshToken);
      // Access token expires before refresh token
      expect(result.accessTokenExpiresAt.getTime()).toBeLessThan(result.refreshTokenExpiresAt.getTime());
      // Challenge was marked used
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("throws CHALLENGE_NOT_FOUND for unknown challenge", async () => {
      mockSelect.mockReturnValue(null);
      await expect(
        deviceAuthService.exchangeChallenge({
          deviceId: "dev_1",
          organizationId: "org_1",
          challengeId: "chall_missing",
          signature: "sig",
        }),
      ).rejects.toMatchObject({ code: "CHALLENGE_NOT_FOUND" });
    });

    it("throws CHALLENGE_USED when challenge already used", async () => {
      mockSelect.mockReturnValue({
        id: "chall_1",
        deviceId: "dev_1",
        organizationId: "org_1",
        nonce: "abc",
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      });
      await expect(
        deviceAuthService.exchangeChallenge({
          deviceId: "dev_1",
          organizationId: "org_1",
          challengeId: "chall_1",
          signature: "sig",
        }),
      ).rejects.toMatchObject({ code: "CHALLENGE_USED" });
    });

    it("throws CHALLENGE_EXPIRED when challenge TTL has passed", async () => {
      mockSelect.mockReturnValue({
        id: "chall_1",
        deviceId: "dev_1",
        organizationId: "org_1",
        nonce: "abc",
        expiresAt: new Date(Date.now() - 1000), // expired
        usedAt: null,
      });
      await expect(
        deviceAuthService.exchangeChallenge({
          deviceId: "dev_1",
          organizationId: "org_1",
          challengeId: "chall_1",
          signature: "sig",
        }),
      ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
    });

    it("throws INVALID_SIGNATURE for wrong signature", async () => {
      const { publicKey } = generateDeviceKeyPair();
      const { privateKey: otherPrivateKey } = generateDeviceKeyPair();
      const nonce = "a".repeat(64);
      const wrongSig = signNonce(nonce, otherPrivateKey); // signed with wrong key

      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            id: "chall_1",
            deviceId: "dev_1",
            organizationId: "org_1",
            nonce,
            expiresAt: new Date(Date.now() + 60_000),
            usedAt: null,
          };
        }
        return {
          id: "dev_1",
          organizationId: "org_1",
          status: "connected",
          revokedAt: null,
          publicKey,
        };
      });

      await expect(
        deviceAuthService.exchangeChallenge({
          deviceId: "dev_1",
          organizationId: "org_1",
          challengeId: "chall_1",
          signature: wrongSig,
        }),
      ).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    });
  });

  // ── refreshAccessToken ──────────────────────────────────────────────────────

  describe("refreshAccessToken()", () => {
    it("issues new access + refresh tokens and rotates the old refresh token", async () => {
      const rawToken = "a".repeat(64);
      const tokenHash = sha256(rawToken);

      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            id: "drt_1",
            deviceId: "dev_1",
            organizationId: "org_1",
            tokenHash,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            rotatedAt: null,
          };
        }
        return {
          id: "dev_1",
          organizationId: "org_1",
          status: "connected",
          revokedAt: null,
        };
      });

      const result = await deviceAuthService.refreshAccessToken(rawToken);

      expect(result.accessToken).toBeTruthy();
      expect(result.refreshToken).toBeTruthy();
      expect(result.accessToken).not.toBe(rawToken);
      expect(result.refreshToken).not.toBe(rawToken);
      // Old token marked as rotated
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("throws INVALID_REFRESH_TOKEN for unknown token", async () => {
      mockSelect.mockReturnValue(null);
      await expect(deviceAuthService.refreshAccessToken("bad_token"))
        .rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
    });

    it("throws REFRESH_TOKEN_REUSED when token already rotated", async () => {
      const rawToken = "b".repeat(64);
      const tokenHash = sha256(rawToken);
      mockSelect.mockReturnValue({
        id: "drt_2",
        deviceId: "dev_1",
        organizationId: "org_1",
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        revokedAt: null,
        rotatedAt: new Date(), // already rotated
      });
      await expect(deviceAuthService.refreshAccessToken(rawToken))
        .rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED" });
    });

    it("throws REFRESH_TOKEN_REUSED when token is revoked", async () => {
      const rawToken = "c".repeat(64);
      const tokenHash = sha256(rawToken);
      mockSelect.mockReturnValue({
        id: "drt_3",
        deviceId: "dev_1",
        organizationId: "org_1",
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        revokedAt: new Date(), // revoked
        rotatedAt: null,
      });
      await expect(deviceAuthService.refreshAccessToken(rawToken))
        .rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSED" });
    });

    it("throws REFRESH_TOKEN_EXPIRED when token has expired", async () => {
      const rawToken = "d".repeat(64);
      const tokenHash = sha256(rawToken);
      mockSelect.mockReturnValue({
        id: "drt_4",
        deviceId: "dev_1",
        organizationId: "org_1",
        tokenHash,
        expiresAt: new Date(Date.now() - 1000), // expired
        revokedAt: null,
        rotatedAt: null,
      });
      await expect(deviceAuthService.refreshAccessToken(rawToken))
        .rejects.toMatchObject({ code: "REFRESH_TOKEN_EXPIRED" });
    });

    it("throws DEVICE_REVOKED when device is revoked during refresh", async () => {
      const rawToken = "e".repeat(64);
      const tokenHash = sha256(rawToken);
      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            id: "drt_5",
            deviceId: "dev_revoked",
            organizationId: "org_1",
            tokenHash,
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            revokedAt: null,
            rotatedAt: null,
          };
        }
        return {
          id: "dev_revoked",
          organizationId: "org_1",
          status: "revoked",
          revokedAt: new Date(),
        };
      });
      await expect(deviceAuthService.refreshAccessToken(rawToken))
        .rejects.toMatchObject({ code: "DEVICE_REVOKED" });
    });
  });

  // ── validateAccessToken ─────────────────────────────────────────────────────

  describe("validateAccessToken()", () => {
    it("returns device for valid non-expired token with correct audience", async () => {
      const rawToken = "valid_token";
      const tokenHash = sha256(rawToken);
      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            id: "dat_1",
            deviceId: "dev_1",
            organizationId: "org_1",
            tokenHash,
            audience: "device-relay",
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            revokedAt: null,
          };
        }
        return { id: "dev_1", organizationId: "org_1", status: "connected", revokedAt: null };
      });

      const result = await deviceAuthService.validateAccessToken(rawToken);
      expect(result).not.toBeNull();
      expect(result!.device.id).toBe("dev_1");
    });

    it("returns null for unknown token", async () => {
      mockSelect.mockReturnValue(null);
      const result = await deviceAuthService.validateAccessToken("unknown");
      expect(result).toBeNull();
    });

    it("returns null for expired token", async () => {
      const rawToken = "expired_token";
      const tokenHash = sha256(rawToken);
      mockSelect.mockReturnValue({
        id: "dat_2",
        deviceId: "dev_1",
        organizationId: "org_1",
        tokenHash,
        audience: "device-relay",
        expiresAt: new Date(Date.now() - 1000), // expired
        revokedAt: null,
      });
      const result = await deviceAuthService.validateAccessToken(rawToken);
      expect(result).toBeNull();
    });

    it("returns null for wrong audience", async () => {
      const rawToken = "wrong_aud";
      const tokenHash = sha256(rawToken);
      mockSelect.mockReturnValue({
        id: "dat_3",
        deviceId: "dev_1",
        organizationId: "org_1",
        tokenHash,
        audience: "other-service",
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        revokedAt: null,
      });
      const result = await deviceAuthService.validateAccessToken(rawToken);
      expect(result).toBeNull();
    });
  });

  // ── Security properties ─────────────────────────────────────────────────────

  describe("Security properties", () => {
    it("access token expires before refresh token", async () => {
      const { publicKey, privateKey } = generateDeviceKeyPair();
      const nonce = "n".repeat(64);
      const signature = signNonce(nonce, privateKey);

      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            id: "chall_sec",
            deviceId: "dev_sec",
            organizationId: "org_sec",
            nonce,
            expiresAt: new Date(Date.now() + 60_000),
            usedAt: null,
          };
        }
        return {
          id: "dev_sec",
          organizationId: "org_sec",
          status: "connected",
          revokedAt: null,
          publicKey,
        };
      });

      const result = await deviceAuthService.exchangeChallenge({
        deviceId: "dev_sec",
        organizationId: "org_sec",
        challengeId: "chall_sec",
        signature,
      });

      // Access token < 20 minutes from now
      const accessTtl = result.accessTokenExpiresAt.getTime() - Date.now();
      expect(accessTtl).toBeLessThan(20 * 60_000);

      // Refresh token > 25 days from now
      const refreshTtl = result.refreshTokenExpiresAt.getTime() - Date.now();
      expect(refreshTtl).toBeGreaterThan(25 * 24 * 60 * 60_000);
    });

    it("tokens are cryptographically random (256-bit hex)", async () => {
      const { publicKey, privateKey } = generateDeviceKeyPair();
      const nonce = "r".repeat(64);
      const signature = signNonce(nonce, privateKey);

      let callCount = 0;
      mockSelect.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return {
            id: "chall_rnd",
            deviceId: "dev_rnd",
            organizationId: "org_rnd",
            nonce,
            expiresAt: new Date(Date.now() + 60_000),
            usedAt: null,
          };
        }
        return {
          id: "dev_rnd",
          organizationId: "org_rnd",
          status: "connected",
          revokedAt: null,
          publicKey,
        };
      });

      const r1 = await deviceAuthService.exchangeChallenge({
        deviceId: "dev_rnd",
        organizationId: "org_rnd",
        challengeId: "chall_rnd",
        signature,
      });

      // 64 hex chars = 256 bits
      expect(r1.accessToken).toMatch(/^[0-9a-f]{64}$/);
      expect(r1.refreshToken).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
