/**
 * deviceService — Sprint 14
 *
 * Manages device registration, credentials, heartbeats, and revocation.
 *
 * Security invariants:
 *   - Credentials (brokerAuthToken, webhookSecret) are generated as 256-bit
 *     CSPRNG values; only SHA-256 hashes are stored
 *   - Device public keys are stored for future JWT device authentication
 *   - Revocation takes effect within the next heartbeat cycle (≤30s)
 *   - All writes are scoped to organization_id
 */

import { randomBytes, createHash, randomUUID } from "crypto";
import {
  db,
  devicesTable,
  deviceCredentialsTable,
  deviceRuntimeStatusTable,
  withSystemTenantContext,
} from "@workspace/db";
import { eq, and, isNull, sql } from "drizzle-orm";
import * as auditService from "./auditService.js";

type AuditEventMeta = Pick<auditService.WriteAuditEventParams, "requestId" | "ipAddress" | "userAgent">;
type DbClient = typeof db;

type DeviceCredentialContext = {
  credential_id: string;
  device_id: string;
  organization_id: string;
  credential_state: string;
  device_state: string;
};

function withDeviceTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "device_service", purpose },
    fn,
  );
}

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RegisterDeviceParams {
  organizationId: string;
  userId: string;
  displayName: string;
  platform: string;
  arch?: string;
  hostname?: string;
  osVersion?: string;
  appVersion?: string;
  publicKey?: string;
}

export interface DeviceCredentials {
  deviceId: string;
  brokerAuthToken: string;    // plaintext — return to caller once, never store
  webhookSecret: string;      // plaintext — return to caller once, never store
  organizationId: string;
}

export interface HeartbeatParams {
  deviceId: string;
  organizationId: string;
  brokerVersion?: string;
  openclawVersion?: string;
  appVersion?: string;
  brokerStatus?: string;
  openclawStatus?: string;
  tunnelStatus?: string;
  browserExtensionInstalled?: boolean;
  browserName?: string;
  tunnelUrl?: string;
}

// ── Helpers (some exported for testing and external use) ──────────────────────

function generateSecret(): string {
  return randomBytes(32).toString("hex"); // 256 bits
}

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** Generate a cryptographically random device token (256-bit hex) */
export async function generateDeviceToken(): Promise<string> {
  const { randomBytes } = await import("crypto");
  return randomBytes(32).toString("hex");
}

/** SHA-256 hash a device token for storage */
export async function hashDeviceToken(token: string): Promise<string> {
  const { createHash } = await import("crypto");
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Build a Bearer token that encodes both deviceId and raw secret.
 * Format: `<deviceId>.<rawSecret>` — the server splits on first dot.
 */
export function buildDeviceToken(deviceId: string, rawSecret: string): string {
  return `${deviceId}.${rawSecret}`;
}

/**
 * Derive a human-readable device name from platform + hostname.
 * Users can rename later.
 */
function defaultDisplayName(platform: string, hostname?: string): string {
  const platformLabel = platform === "macos" ? "Mac" : platform === "windows" ? "PC" : "Device";
  return hostname ? `${hostname} (${platformLabel})` : platformLabel;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Register a new device and issue initial credentials.
 * Called once per device at activation time.
 */
export async function registerDevice(
  params: RegisterDeviceParams,
  auditMeta: AuditEventMeta = {},
): Promise<DeviceCredentials> {
  const deviceId = `dev_${randomUUID()}`;
  const credId = `dcred_${randomUUID()}`;

  const brokerAuthToken = generateSecret();
  const webhookSecret = generateSecret();

  const tokenHash = hashSecret(brokerAuthToken);
  const webhookSecretHash = hashSecret(webhookSecret);

  const displayName =
    params.displayName?.trim() || defaultDisplayName(params.platform, params.hostname);

  await withDeviceTenant(params.organizationId, "device.register", async (client) => {
    await client.insert(devicesTable).values({
      id: deviceId,
      organizationId: params.organizationId,
      userId: params.userId,
      displayName,
      platform: params.platform,
      arch: params.arch ?? null,
      hostname: params.hostname ?? null,
      osVersion: params.osVersion ?? null,
      appVersion: params.appVersion ?? null,
      publicKey: params.publicKey ?? null,
      status: "pending",
      registeredAt: new Date(),
    });

    await client.insert(deviceCredentialsTable).values({
      id: credId,
      deviceId,
      organizationId: params.organizationId,
      tokenHash,
      webhookSecretHash,
      issuedAt: new Date(),
      rotationDueAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    });
  });

  await auditService.writeAuditEvent({
    organizationId: params.organizationId,
    actorUserId: params.userId,
    eventType: "device.registered",
    resourceType: "device",
    resourceId: deviceId,
    metadata: {
      platform: params.platform,
      arch: params.arch,
      hostname: params.hostname,
    },
    ...auditMeta,
  }).catch(() => {});

  return {
    deviceId,
    brokerAuthToken,  // plaintext — caller must store in OS keychain
    webhookSecret,    // plaintext — caller must store in OS keychain
    organizationId: params.organizationId,
  };
}

/**
 * Authenticate a device by its bearer token.
 * Returns the device row or null if credentials are invalid/revoked.
 */
export async function authenticateDevice(
  bearerToken: string,
): Promise<{ device: typeof devicesTable.$inferSelect; credentialId: string } | null> {
  const tokenHash = hashSecret(bearerToken);

  const resolved = await db.execute<DeviceCredentialContext>(sql`
    SELECT *
    FROM public.resolve_device_credential_context(${tokenHash})
    LIMIT 1
  `);
  const cred = resolved.rows[0];

  if (!cred) return null;
  if (cred.credential_state !== "valid") return null;
  if (cred.device_state === "device_revoked" || cred.device_state === "platform_disabled") {
    return null;
  }

  return withDeviceTenant(cred.organization_id, "device.authenticate", async (client) => {
  const [device] = await client
    .select()
    .from(devicesTable)
    .where(
      and(
        eq(devicesTable.id, cred.device_id),
        eq(devicesTable.organizationId, cred.organization_id),
        isNull(devicesTable.revokedAt),
      ),
    )
    .limit(1);

  if (!device) return null;
  if (device.status === "revoked") return null;
  // Task #34: platform-disabled devices are treated the same as revoked for auth purposes
  if ((device as any).isPlatformDisabled) return null;

  // Update last used
  await client
    .update(deviceCredentialsTable)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(deviceCredentialsTable.id, cred.credential_id),
        eq(deviceCredentialsTable.organizationId, cred.organization_id),
      ),
    )
    .catch(() => {});

  return { device, credentialId: cred.credential_id };
  });
}

/**
 * Record a heartbeat from the broker. Updates status and runtime info.
 */
export async function recordHeartbeat(params: HeartbeatParams): Promise<void> {
  await withDeviceTenant(params.organizationId, "device.heartbeat", async (client) => {
  await client
    .update(devicesTable)
    .set({
      status: "connected",
      lastHeartbeatAt: new Date(),
      brokerVersion: params.brokerVersion ?? undefined,
      appVersion: params.appVersion ?? undefined,
      tunnelUrl: params.tunnelUrl ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(devicesTable.id, params.deviceId));

  const runtimeId = `drs_${randomUUID()}`;
  await client
    .insert(deviceRuntimeStatusTable)
    .values({
      id: runtimeId,
      deviceId: params.deviceId,
      organizationId: params.organizationId,
      brokerVersion: params.brokerVersion,
      openclawVersion: params.openclawVersion,
      appVersion: params.appVersion,
      brokerStatus: params.brokerStatus,
      openclawStatus: params.openclawStatus,
      tunnelStatus: params.tunnelStatus,
      browserExtensionInstalled: params.browserExtensionInstalled,
      browserName: params.browserName,
      reportedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: deviceRuntimeStatusTable.deviceId,
      set: {
        brokerVersion: params.brokerVersion,
        openclawVersion: params.openclawVersion,
        appVersion: params.appVersion,
        brokerStatus: params.brokerStatus,
        openclawStatus: params.openclawStatus,
        tunnelStatus: params.tunnelStatus,
        browserExtensionInstalled: params.browserExtensionInstalled,
        browserName: params.browserName,
        reportedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });
}

/**
 * Revoke a device. Credentials become invalid on next broker request.
 */
export async function revokeDevice(
  deviceId: string,
  revokedByUserId: string,
  organizationId: string,
  reason?: string,
): Promise<void> {
  const now = new Date();

  await withDeviceTenant(organizationId, "device.revoke", async (client) => {
  await client
    .update(devicesTable)
    .set({ status: "revoked", revokedAt: now, revokedBy: revokedByUserId, updatedAt: now })
    .where(
      and(
        eq(devicesTable.id, deviceId),
        eq(devicesTable.organizationId, organizationId),
      ),
    );

  await client
    .update(deviceCredentialsTable)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(deviceCredentialsTable.deviceId, deviceId),
        eq(deviceCredentialsTable.organizationId, organizationId),
      ),
    );
  });

  await auditService.writeAuditEvent({
    organizationId,
    actorUserId: revokedByUserId,
    eventType: "device.revoked",
    resourceType: "device",
    resourceId: deviceId,
    metadata: { reason },
  }).catch(() => {});
}

/**
 * List all devices for an org.
 */
export async function listOrgDevices(organizationId: string) {
  return withDeviceTenant(organizationId, "device.list", (client) => client
    .select({
      id: devicesTable.id,
      displayName: devicesTable.displayName,
      platform: devicesTable.platform,
      arch: devicesTable.arch,
      status: devicesTable.status,
      appVersion: devicesTable.appVersion,
      brokerVersion: devicesTable.brokerVersion,
      lastHeartbeatAt: devicesTable.lastHeartbeatAt,
      firstRunCompletedAt: devicesTable.firstRunCompletedAt,
      registeredAt: devicesTable.registeredAt,
    })
    .from(devicesTable)
    .where(
      and(
        eq(devicesTable.organizationId, organizationId),
        isNull(devicesTable.revokedAt),
      ),
    )
    .orderBy(devicesTable.registeredAt));
}

/**
 * Mark first-run complete for a device.
 */
export async function completeFirstRun(deviceId: string, organizationId: string): Promise<void> {
  await withDeviceTenant(organizationId, "device.first_run_complete", async (client) => {
  await client
    .update(devicesTable)
    .set({ firstRunCompletedAt: new Date(), status: "connected", updatedAt: new Date() })
    .where(
      and(
        eq(devicesTable.id, deviceId),
        eq(devicesTable.organizationId, organizationId),
      ),
    );

  await client.execute(
    // @ts-ignore — raw SQL for conditional update
    `UPDATE organizations 
     SET installer_connected_at = NOW() 
     WHERE id = '${organizationId}' 
       AND installer_connected_at IS NULL`
  ).catch(() => {});
  });
}
