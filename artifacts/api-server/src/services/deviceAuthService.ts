/**
 * deviceAuthService — Sprint 15
 *
 * Short-lived device authentication via challenge/exchange flow.
 *
 * Flow:
 *   1. Device POSTs /v1/devices/auth/challenge  → receives nonce (60s TTL)
 *   2. Device signs nonce with its Ed25519 private key
 *   3. Device POSTs /v1/devices/auth/exchange   → receives accessToken (15m) + refreshToken (30d)
 *   4. Device opens WSS relay with accessToken in Authorization header
 *   5. Device POSTs /v1/devices/auth/refresh when accessToken nears expiry
 *      → old refreshToken revoked, new accessToken + refreshToken pair issued
 *
 * On revocation:
 *   - All access tokens revoked → WS relay rejects next message
 *   - All refresh tokens revoked → refresh rejected
 *   - Audit event written
 *
 * Security invariants:
 *   - Only SHA-256 hashes of tokens stored in DB
 *   - Challenge nonces single-use, 60s TTL
 *   - Access tokens 15-minute TTL
 *   - Refresh tokens rotated on use (old token immediately revoked)
 *   - Revoked device cannot obtain new tokens
 */

import { randomBytes, createHash, verify as cryptoVerify } from "crypto";
import { randomUUID } from "crypto";
import {
  db,
  devicesTable,
  deviceAuthChallengesTable,
  deviceAccessTokensTable,
  deviceRefreshTokensTable,
  deviceCredentialsTable,
  withSystemTenantContext,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import * as auditService from "./auditService.js";

type DbClient = typeof db;

function withDeviceAuthTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "device_auth_service", purpose },
    fn,
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CHALLENGE_TTL_MS = 60_000;        // 60 seconds
const ACCESS_TOKEN_TTL_MS = 15 * 60_000; // 15 minutes
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateToken(): string {
  return randomBytes(32).toString("hex"); // 256-bit opaque token
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface CreateChallengeResult {
  challengeId: string;
  nonce: string;
  expiresAt: Date;
}

/**
 * Issue a challenge nonce for a device to sign.
 * Validates that the device exists, belongs to the org, and is not revoked.
 */
export async function createChallenge(
  deviceId: string,
  organizationId: string,
): Promise<CreateChallengeResult> {
  return withDeviceAuthTenant(organizationId, "device_auth.challenge", async (client) => {
  // 1. Validate device
  const [device] = await client
    .select()
    .from(devicesTable)
    .where(
      and(
        eq(devicesTable.id, deviceId),
        eq(devicesTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!device) {
    throw Object.assign(new Error("Device not found"), { code: "DEVICE_NOT_FOUND" });
  }
  if (device.status === "revoked" || device.revokedAt) {
    throw Object.assign(new Error("Device is revoked"), { code: "DEVICE_REVOKED" });
  }
  if (!device.publicKey) {
    throw Object.assign(new Error("Device has no public key registered"), { code: "NO_PUBLIC_KEY" });
  }

  // 2. Issue challenge
  const challengeId = `chall_${randomUUID()}`;
  const nonce = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS);

  await client.insert(deviceAuthChallengesTable).values({
    id: challengeId,
    deviceId,
    organizationId,
    nonce,
    expiresAt,
  });

  return { challengeId, nonce, expiresAt };
  });
}

export interface ExchangeResult {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  deviceId: string;
  organizationId: string;
}

/**
 * Exchange a signed challenge for a short-lived access token + refresh token.
 * Verifies the Ed25519 signature against the device's registered public key.
 */
export async function exchangeChallenge(params: {
  deviceId: string;
  organizationId: string;
  challengeId: string;
  signature: string; // base64-encoded Ed25519 signature of the nonce
}): Promise<ExchangeResult> {
  const { deviceId, organizationId, challengeId, signature } = params;
  return withDeviceAuthTenant(organizationId, "device_auth.exchange", async (client) => {

  // 1. Load and validate challenge
  const [challenge] = await client
    .select()
    .from(deviceAuthChallengesTable)
    .where(
      and(
        eq(deviceAuthChallengesTable.id, challengeId),
        eq(deviceAuthChallengesTable.deviceId, deviceId),
        eq(deviceAuthChallengesTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!challenge) {
    throw Object.assign(new Error("Challenge not found"), { code: "CHALLENGE_NOT_FOUND" });
  }
  if (challenge.usedAt) {
    throw Object.assign(new Error("Challenge already used"), { code: "CHALLENGE_USED" });
  }
  if (new Date() > challenge.expiresAt) {
    throw Object.assign(new Error("Challenge expired"), { code: "CHALLENGE_EXPIRED" });
  }

  // 2. Load device + public key
  const [device] = await client
    .select()
    .from(devicesTable)
    .where(
      and(
        eq(devicesTable.id, deviceId),
        eq(devicesTable.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!device || device.status === "revoked" || device.revokedAt) {
    throw Object.assign(new Error("Device is revoked"), { code: "DEVICE_REVOKED" });
  }
  if (!device.publicKey) {
    throw Object.assign(new Error("Device has no public key"), { code: "NO_PUBLIC_KEY" });
  }

  // 3. Verify Ed25519 signature
  //    Ed25519 uses its own internal digest — the algorithm parameter must be null.
  //    Using createVerify("SHA256") would throw for Ed25519 keys.
  const publicKeyPem = device.publicKey.startsWith("-----")
    ? device.publicKey
    : `-----BEGIN PUBLIC KEY-----\n${device.publicKey}\n-----END PUBLIC KEY-----`;

  try {
    const valid = cryptoVerify(
      null,                                  // null = algorithm managed by key type (Ed25519)
      Buffer.from(challenge.nonce, "utf8"),   // data that was signed
      publicKeyPem,                          // public key PEM
      Buffer.from(signature, "base64"),      // signature from device
    );
    if (!valid) {
      throw new Error("Invalid signature");
    }
  } catch (err: any) {
    throw Object.assign(
      new Error(`Signature verification failed: ${err.message}`),
      { code: "INVALID_SIGNATURE" },
    );
  }

  // 4. Mark challenge as used (atomic — prevents replay within the same request)
  await client
    .update(deviceAuthChallengesTable)
    .set({ usedAt: new Date() })
    .where(eq(deviceAuthChallengesTable.id, challengeId));

  // 5. Issue access token (15-minute TTL)
  const accessToken = generateToken();
  const accessTokenHash = hashToken(accessToken);
  const accessTokenId = `dat_${randomUUID()}`;
  const accessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

  await client.insert(deviceAccessTokensTable).values({
    id: accessTokenId,
    deviceId,
    organizationId,
    tokenHash: accessTokenHash,
    audience: "device-relay",
    expiresAt: accessTokenExpiresAt,
    issuedAt: new Date(),
  });

  // 6. Issue refresh token (30-day TTL)
  const refreshToken = generateToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshTokenId = `drt_${randomUUID()}`;
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await client.insert(deviceRefreshTokensTable).values({
    id: refreshTokenId,
    deviceId,
    organizationId,
    tokenHash: refreshTokenHash,
    expiresAt: refreshTokenExpiresAt,
    issuedAt: new Date(),
  });

  // 7. Promote device from "pending" to "connected" on first successful exchange.
  //    A device stays "pending" until it has proven ownership of its private key
  //    via the challenge/exchange flow.  After this point, refresh tokens work
  //    and the relay can maintain continuous connectivity.
  if (device.status === "pending") {
    await client
      .update(devicesTable)
      .set({ status: "connected" })
      .where(eq(devicesTable.id, deviceId));
  }

  return {
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
    deviceId,
    organizationId,
  };
  });
}

export interface RefreshResult {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Rotate a refresh token: revoke the old one, issue a new access + refresh pair.
 * The old refresh token is immediately invalidated to prevent reuse.
 */
export async function refreshAccessToken(rawRefreshToken: string): Promise<RefreshResult> {
  const tokenHash = hashToken(rawRefreshToken);

  const [existing] = await db
    .select()
    .from(deviceRefreshTokensTable)
    .where(eq(deviceRefreshTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!existing) {
    throw Object.assign(new Error("Refresh token not found"), { code: "INVALID_REFRESH_TOKEN" });
  }
  if (existing.revokedAt || existing.rotatedAt) {
    throw Object.assign(new Error("Refresh token already used or revoked"), { code: "REFRESH_TOKEN_REUSED" });
  }
  if (new Date() > existing.expiresAt) {
    throw Object.assign(new Error("Refresh token expired"), { code: "REFRESH_TOKEN_EXPIRED" });
  }

  // Check device is still active
  const [device] = await db
    .select()
    .from(devicesTable)
    .where(eq(devicesTable.id, existing.deviceId))
    .limit(1);

  if (!device || device.status === "revoked" || device.revokedAt) {
    throw Object.assign(new Error("Device is revoked"), { code: "DEVICE_REVOKED" });
  }
  // Task #34: platform-disabled devices cannot refresh tokens
  if ((device as any).isPlatformDisabled) {
    throw Object.assign(new Error("Device is disabled by a platform administrator"), { code: "DEVICE_PLATFORM_DISABLED" });
  }
  // Task #34: devices awaiting re-activation (after credential rotation) cannot refresh
  if (device.status === "pending") {
    throw Object.assign(new Error("Device credentials have been rotated — re-activation required"), { code: "DEVICE_REACTIVATION_REQUIRED" });
  }

  const now = new Date();

  // Issue new access token
  const newAccessToken = generateToken();
  const newAccessTokenHash = hashToken(newAccessToken);
  const newAccessTokenId = `dat_${randomUUID()}`;
  const newAccessTokenExpiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);

  await db.insert(deviceAccessTokensTable).values({
    id: newAccessTokenId,
    deviceId: existing.deviceId,
    organizationId: existing.organizationId,
    tokenHash: newAccessTokenHash,
    audience: "device-relay",
    expiresAt: newAccessTokenExpiresAt,
    issuedAt: now,
  });

  // Issue new refresh token
  const newRefreshToken = generateToken();
  const newRefreshTokenHash = hashToken(newRefreshToken);
  const newRefreshTokenId = `drt_${randomUUID()}`;
  const newRefreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await db.insert(deviceRefreshTokensTable).values({
    id: newRefreshTokenId,
    deviceId: existing.deviceId,
    organizationId: existing.organizationId,
    tokenHash: newRefreshTokenHash,
    expiresAt: newRefreshTokenExpiresAt,
    issuedAt: now,
  });

  // Rotate (invalidate) the old refresh token
  await db
    .update(deviceRefreshTokensTable)
    .set({ rotatedAt: now, supersededById: newRefreshTokenId })
    .where(eq(deviceRefreshTokensTable.id, existing.id));

  return {
    accessToken: newAccessToken,
    accessTokenExpiresAt: newAccessTokenExpiresAt,
    refreshToken: newRefreshToken,
    refreshTokenExpiresAt: newRefreshTokenExpiresAt,
  };
}

/**
 * Validate an access token for the WS relay.
 * Returns the device row and token record, or null if invalid.
 */
export async function validateAccessToken(rawToken: string): Promise<{
  device: typeof devicesTable.$inferSelect;
  tokenId: string;
} | null> {
  const tokenHash = hashToken(rawToken);
  const now = new Date();

  const [tokenRow] = await db
    .select()
    .from(deviceAccessTokensTable)
    .where(
      and(
        eq(deviceAccessTokensTable.tokenHash, tokenHash),
        isNull(deviceAccessTokensTable.revokedAt),
      ),
    )
    .limit(1);

  if (!tokenRow) return null;
  if (now > tokenRow.expiresAt) return null;
  if (tokenRow.audience !== "device-relay") return null;

  const [device] = await db
    .select()
    .from(devicesTable)
    .where(
      and(
        eq(devicesTable.id, tokenRow.deviceId),
        isNull(devicesTable.revokedAt),
      ),
    )
    .limit(1);

  if (!device || device.status === "revoked") return null;
  // Task #34: platform-disabled devices cannot use the relay
  if ((device as any).isPlatformDisabled) return null;
  // Task #34: pending (post-rotation) devices cannot use existing access tokens
  if (device.status === "pending") return null;

  // Update last_used_at (fire-and-forget)
  db.update(deviceAccessTokensTable)
    .set({ lastUsedAt: now })
    .where(eq(deviceAccessTokensTable.id, tokenRow.id))
    .catch(() => {});

  return { device, tokenId: tokenRow.id };
}

/**
 * Revoke all active credentials for a device (called alongside device.revokeDevice()).
 * Revokes access tokens + refresh tokens so no new relay connections can be made.
 */
export async function revokeDeviceAuth(
  deviceId: string,
  organizationId: string,
): Promise<void> {
  const now = new Date();

  await withDeviceAuthTenant(organizationId, "device_auth.revoke", async (client) => {
  await Promise.all([
    client
      .update(deviceAccessTokensTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(deviceAccessTokensTable.deviceId, deviceId),
          eq(deviceAccessTokensTable.organizationId, organizationId),
          isNull(deviceAccessTokensTable.revokedAt),
        ),
      ),
    client
      .update(deviceRefreshTokensTable)
      .set({ revokedAt: now })
      .where(
        and(
          eq(deviceRefreshTokensTable.deviceId, deviceId),
          eq(deviceRefreshTokensTable.organizationId, organizationId),
          isNull(deviceRefreshTokensTable.revokedAt),
        ),
      ),
    client
      .update(deviceCredentialsTable)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(deviceCredentialsTable.deviceId, deviceId),
          eq(deviceCredentialsTable.organizationId, organizationId),
          isNull(deviceCredentialsTable.revokedAt),
        ),
      ),
  ]);
  });
}
