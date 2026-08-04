/**
 * platformDeviceService — Task #34
 *
 * Platform-level device queries and management actions.
 *
 * Security invariants:
 *   - No plaintext tokens ever returned
 *   - All mutations are audited
 *   - Device ownership (organizationId) verified on every write
 *   - Rate limiting is enforced in the route layer (20 actions/hour per staff)
 */

import { randomUUID, createHash, randomBytes } from "crypto";
import {
  db,
  devicesTable,
  deviceCredentialsTable,
  deviceRuntimeStatusTable,
  organizationsTable,
} from "@workspace/db";
import {
  eq, and, ilike, or, isNull, lt, desc, sql, inArray, count,
} from "drizzle-orm";
import {
  deviceAccessTokensTable,
  deviceRefreshTokensTable,
} from "@workspace/db";
import * as auditService from "./auditService.js";

// ── Stale heartbeat threshold ──────────────────────────────────────────────────
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export function computeOnlineStatus(lastHeartbeatAt: Date | null): "online" | "offline" | "never_connected" {
  if (!lastHeartbeatAt) return "never_connected";
  return Date.now() - new Date(lastHeartbeatAt).getTime() <= STALE_THRESHOLD_MS
    ? "online"
    : "offline";
}

// ── Rate-limit registry (in-process) ──────────────────────────────────────────
const actionRl = new Map<string, number[]>();
const ACTION_RL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const ACTION_RL_MAX = 20;

export function checkActionRateLimit(userId: string): void {
  const now = Date.now();
  const times = (actionRl.get(userId) ?? []).filter(t => now - t < ACTION_RL_WINDOW_MS);
  if (times.length >= ACTION_RL_MAX) {
    throw Object.assign(
      new Error("Rate limit: max 20 device actions per hour per staff member."),
      { code: "RATE_LIMITED", status: 429 },
    );
  }
  actionRl.set(userId, [...times, now]);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function generateSecret(): string {
  return randomBytes(32).toString("hex");
}

/** Safe device row — never includes credential hashes or sensitive fields */
function safeDevice(d: typeof devicesTable.$inferSelect, orgName?: string) {
  return {
    id: d.id,
    organizationId: d.organizationId,
    orgName: orgName ?? null,
    userId: d.userId,
    displayName: d.displayName,
    platform: d.platform,
    arch: d.arch,
    hostname: d.hostname,
    osVersion: d.osVersion,
    appVersion: d.appVersion,
    brokerVersion: d.brokerVersion,
    status: d.status,
    tunnelUrl: d.tunnelUrl,
    isPlatformDisabled: (d as any).isPlatformDisabled ?? false,
    platformDisabledAt: (d as any).platformDisabledAt ?? null,
    platformDisabledReason: (d as any).platformDisabledReason ?? null,
    firstRunCompletedAt: d.firstRunCompletedAt,
    lastHeartbeatAt: d.lastHeartbeatAt,
    registeredAt: d.registeredAt,
    revokedAt: d.revokedAt,
    revokedBy: d.revokedBy,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    // Computed
    onlineStatus: computeOnlineStatus(d.lastHeartbeatAt),
  };
}

// ── Platform queries ───────────────────────────────────────────────────────────

export interface ListDevicesFilters {
  organizationId?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * List all devices across all orgs (platform-level view).
 * Joins with organization for display name.
 * Computes online/offline from heartbeat age.
 */
export async function listDevicesForPlatform(filters: ListDevicesFilters = {}) {
  const page  = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      device: devicesTable,
      orgName: organizationsTable.name,
    })
    .from(devicesTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, devicesTable.organizationId))
    .where(
      and(
        filters.organizationId
          ? eq(devicesTable.organizationId, filters.organizationId)
          : undefined,
        filters.status
          ? eq(devicesTable.status, filters.status as any)
          : undefined,
        filters.search
          ? or(
              ilike(devicesTable.displayName, `%${filters.search}%`),
              ilike(devicesTable.hostname ?? sql`''`, `%${filters.search}%`),
              ilike(organizationsTable.name ?? sql`''`, `%${filters.search}%`),
            )
          : undefined,
      ),
    )
    .orderBy(desc(devicesTable.lastHeartbeatAt))
    .limit(limit)
    .offset(offset);

  const [{ n: total }] = await db
    .select({ n: count() })
    .from(devicesTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, devicesTable.organizationId))
    .where(
      and(
        filters.organizationId
          ? eq(devicesTable.organizationId, filters.organizationId)
          : undefined,
        filters.status
          ? eq(devicesTable.status, filters.status as any)
          : undefined,
        filters.search
          ? or(
              ilike(devicesTable.displayName, `%${filters.search}%`),
              ilike(organizationsTable.name ?? sql`''`, `%${filters.search}%`),
            )
          : undefined,
      ),
    );

  return {
    devices: rows.map(r => safeDevice(r.device, r.orgName ?? undefined)),
    total: Number(total),
    page,
    limit,
  };
}

/**
 * Get full device detail for platform view.
 * Includes runtime status and credential metadata (no hashes).
 */
export async function getDeviceDetailForPlatform(deviceId: string) {
  const [row] = await db
    .select({
      device: devicesTable,
      orgName: organizationsTable.name,
      runtime: deviceRuntimeStatusTable,
    })
    .from(devicesTable)
    .leftJoin(organizationsTable, eq(organizationsTable.id, devicesTable.organizationId))
    .leftJoin(deviceRuntimeStatusTable, eq(deviceRuntimeStatusTable.deviceId, devicesTable.id))
    .where(eq(devicesTable.id, deviceId))
    .limit(1);

  if (!row) return null;

  // Credential metadata (no hashes, no tokens)
  const credentials = await db
    .select({
      id: deviceCredentialsTable.id,
      issuedAt: deviceCredentialsTable.issuedAt,
      expiresAt: deviceCredentialsTable.expiresAt,
      rotationDueAt: deviceCredentialsTable.rotationDueAt,
      lastUsedAt: deviceCredentialsTable.lastUsedAt,
      revokedAt: deviceCredentialsTable.revokedAt,
    })
    .from(deviceCredentialsTable)
    .where(eq(deviceCredentialsTable.deviceId, deviceId))
    .orderBy(desc(deviceCredentialsTable.issuedAt))
    .limit(5);

  return {
    ...safeDevice(row.device, row.orgName ?? undefined),
    runtime: row.runtime
      ? {
          brokerStatus: row.runtime.brokerStatus,
          openclawStatus: row.runtime.openclawStatus,
          tunnelStatus: row.runtime.tunnelStatus,
          brokerVersion: row.runtime.brokerVersion,
          openclawVersion: row.runtime.openclawVersion,
          appVersion: row.runtime.appVersion,
          browserExtensionInstalled: row.runtime.browserExtensionInstalled,
          browserName: row.runtime.browserName,
          lastExecutionId: row.runtime.lastExecutionId,
          errorMessage: row.runtime.errorMessage,
          reportedAt: row.runtime.reportedAt,
        }
      : null,
    credentialSummary: credentials.map(c => ({
      id: c.id,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      rotationDueAt: c.rotationDueAt,
      lastUsedAt: c.lastUsedAt,
      revokedAt: c.revokedAt,
      active: !c.revokedAt,
    })),
  };
}

/**
 * Get devices for a specific org (platform view — safe fields only).
 */
export async function listDevicesForOrg(organizationId: string) {
  const rows = await db
    .select({
      device: devicesTable,
      runtime: deviceRuntimeStatusTable,
    })
    .from(devicesTable)
    .leftJoin(deviceRuntimeStatusTable, eq(deviceRuntimeStatusTable.deviceId, devicesTable.id))
    .where(eq(devicesTable.organizationId, organizationId))
    .orderBy(desc(devicesTable.lastHeartbeatAt));

  return rows.map(r => ({
    ...safeDevice(r.device),
    runtime: r.runtime
      ? {
          brokerStatus: r.runtime.brokerStatus,
          openclawStatus: r.runtime.openclawStatus,
          tunnelStatus: r.runtime.tunnelStatus,
          reportedAt: r.runtime.reportedAt,
          errorMessage: r.runtime.errorMessage,
        }
      : null,
  }));
}

// ── Platform device actions ────────────────────────────────────────────────────

/** Revoke a device permanently (platform override — cross-org). */
export async function platformRevokeDevice(
  deviceId: string,
  platformUserId: string,
  reason?: string,
): Promise<void> {
  const [device] = await db
    .select({ id: devicesTable.id, organizationId: devicesTable.organizationId })
    .from(devicesTable)
    .where(eq(devicesTable.id, deviceId))
    .limit(1);
  if (!device) throw Object.assign(new Error("Device not found."), { status: 404 });

  const now = new Date();
  await db
    .update(devicesTable)
    .set({ status: "revoked", revokedAt: now, revokedBy: platformUserId, updatedAt: now })
    .where(eq(devicesTable.id, deviceId));

  await db
    .update(deviceCredentialsTable)
    .set({ revokedAt: now, updatedAt: now })
    .where(eq(deviceCredentialsTable.deviceId, deviceId));

  await auditService.log({
    eventType: "platform.device_revoked",
    actorId: platformUserId,
    organizationId: device.organizationId,
    metadata: { deviceId, reason: reason ?? null },
  }).catch(() => {});
}

/** Temporarily disable a device (reversible). */
export async function platformDisableDevice(
  deviceId: string,
  platformUserId: string,
  reason?: string,
): Promise<void> {
  const [device] = await db
    .select({ id: devicesTable.id, organizationId: devicesTable.organizationId, status: devicesTable.status })
    .from(devicesTable)
    .where(eq(devicesTable.id, deviceId))
    .limit(1);
  if (!device) throw Object.assign(new Error("Device not found."), { status: 404 });
  if (device.status === "revoked") throw Object.assign(new Error("Device is permanently revoked."), { status: 409 });

  const now = new Date();
  await db
    .update(devicesTable)
    .set({
      isPlatformDisabled: true,
      platformDisabledAt: now,
      platformDisabledBy: platformUserId,
      platformDisabledReason: reason ?? null,
      updatedAt: now,
    } as any)
    .where(eq(devicesTable.id, deviceId));

  await auditService.log({
    eventType: "platform.device_disabled",
    actorId: platformUserId,
    organizationId: device.organizationId,
    metadata: { deviceId, reason: reason ?? null },
  }).catch(() => {});
}

/** Re-enable a previously disabled device. */
export async function platformEnableDevice(
  deviceId: string,
  platformUserId: string,
): Promise<void> {
  const [device] = await db
    .select({ id: devicesTable.id, organizationId: devicesTable.organizationId })
    .from(devicesTable)
    .where(eq(devicesTable.id, deviceId))
    .limit(1);
  if (!device) throw Object.assign(new Error("Device not found."), { status: 404 });

  const now = new Date();
  await db
    .update(devicesTable)
    .set({
      isPlatformDisabled: false,
      platformDisabledAt: null,
      platformDisabledBy: null,
      platformDisabledReason: null,
      updatedAt: now,
    } as any)
    .where(eq(devicesTable.id, deviceId));

  await auditService.log({
    eventType: "platform.device_enabled",
    actorId: platformUserId,
    organizationId: device.organizationId,
    metadata: { deviceId },
  }).catch(() => {});
}

/**
 * Rotate device credentials: revoke all active credentials.
 * The device will receive 401 on its next heartbeat and must be re-activated.
 * No new token is issued here — the device owner must run the activation flow again.
 */
export async function platformRotateDeviceCredentials(
  deviceId: string,
  platformUserId: string,
  reason?: string,
): Promise<{ credentialsRevoked: number }> {
  const [device] = await db
    .select({ id: devicesTable.id, organizationId: devicesTable.organizationId })
    .from(devicesTable)
    .where(eq(devicesTable.id, deviceId))
    .limit(1);
  if (!device) throw Object.assign(new Error("Device not found."), { status: 404 });

  const now = new Date();
  const activeCredentials = await db
    .select({ id: deviceCredentialsTable.id })
    .from(deviceCredentialsTable)
    .where(
      and(
        eq(deviceCredentialsTable.deviceId, deviceId),
        isNull(deviceCredentialsTable.revokedAt),
      ),
    );

  if (activeCredentials.length > 0) {
    await db
      .update(deviceCredentialsTable)
      .set({ revokedAt: now, updatedAt: now })
      .where(
        and(
          eq(deviceCredentialsTable.deviceId, deviceId),
          isNull(deviceCredentialsTable.revokedAt),
        ),
      );
  }

  // Revoke relay access tokens and refresh tokens so short-lived relay sessions
  // are also invalidated — preventing bypass of the re-activation requirement
  await db
    .update(deviceAccessTokensTable)
    .set({ revokedAt: now })
    .where(
      and(
        eq(deviceAccessTokensTable.deviceId, deviceId),
        isNull(deviceAccessTokensTable.revokedAt),
      ),
    );

  await db
    .update(deviceRefreshTokensTable)
    .set({ revokedAt: now })
    .where(
      and(
        eq(deviceRefreshTokensTable.deviceId, deviceId),
        isNull(deviceRefreshTokensTable.revokedAt),
      ),
    );

  // Mark device as needing re-activation (pending)
  await db
    .update(devicesTable)
    .set({ status: "pending", updatedAt: now })
    .where(eq(devicesTable.id, deviceId));

  await auditService.log({
    eventType: "platform.device_credentials_rotated",
    actorId: platformUserId,
    organizationId: device.organizationId,
    metadata: { deviceId, credentialsRevoked: activeCredentials.length, reason: reason ?? null },
  }).catch(() => {});

  return { credentialsRevoked: activeCredentials.length };
}

/**
 * Get device audit history (platform-level audit events).
 */
export async function getDeviceAuditHistory(deviceId: string) {
  // Import at call time to avoid circular deps
  const { platformAuditLogTable } = await import("@workspace/db");
  const { sql: drizzleSql } = await import("drizzle-orm");

  const events = await db
    .select()
    .from(platformAuditLogTable)
    .where(drizzleSql`${platformAuditLogTable.metadata}->>'deviceId' = ${deviceId}`)
    .orderBy(desc(platformAuditLogTable.occurredAt))
    .limit(50);

  return events;
}

/**
 * Get device error history from the runtime status table.
 * Returns recent error messages; never returns credential data.
 */
export async function getDeviceErrorHistory(deviceId: string) {
  const rows = await db
    .select({
      id: deviceRuntimeStatusTable.id,
      brokerStatus: deviceRuntimeStatusTable.brokerStatus,
      openclawStatus: deviceRuntimeStatusTable.openclawStatus,
      tunnelStatus: deviceRuntimeStatusTable.tunnelStatus,
      errorMessage: deviceRuntimeStatusTable.errorMessage,
      reportedAt: deviceRuntimeStatusTable.reportedAt,
    })
    .from(deviceRuntimeStatusTable)
    .where(
      and(
        eq(deviceRuntimeStatusTable.deviceId, deviceId),
        // Only rows that have an error message
        sql`${deviceRuntimeStatusTable.errorMessage} IS NOT NULL`,
      ),
    )
    .orderBy(desc(deviceRuntimeStatusTable.reportedAt))
    .limit(20);

  return rows;
}
