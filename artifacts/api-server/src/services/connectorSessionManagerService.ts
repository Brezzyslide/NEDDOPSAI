/**
 * connectorSessionManagerService — Sprint 29E (NeedsOps Connector P6 Foundation)
 *
 * Manages execution-scoped connector sessions.
 *
 * Architecture rule:
 *   The relay (deviceRelayService) remains the source of truth for WebSocket
 *   connection state. This service adds an execution-scoped layer on top:
 *   it maps executionId → connected device → session telemetry.
 *   It never duplicates relay connection state.
 *
 * Responsibilities:
 *   - openSession: validate entitlement + device registration + connector availability
 *   - maintain executionId ↔ connector session mapping (in-memory)
 *   - record per-operation telemetry
 *   - enforce idle timeout (30s without an operation)
 *   - close gracefully on success, failure, or cancellation
 *   - produce InspectorConnectorDiagnostics-compatible telemetry
 */

import { randomUUID } from "crypto";
import { db, devicesTable, deviceRuntimeStatusTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { tenantCanUseConnector } from "./entitlementService.js";
import {
  getConnectedDevicesForOrg,
} from "./deviceRelayService.js";
import { ConnectorCapabilityError } from "../lib/resources/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectorOpLogEntry {
  requestId: string;
  operationType: string;
  resourceId?: string;
  query?: string;
  success: boolean;
  latencyMs: number;
  recordedAt: string;
}

export interface ConnectorSessionTelemetry {
  sessionId: string;
  executionId: string;
  deviceId: string;
  organisationId: string;
  connectorVersion: string | null;
  deviceName: string | null;
  osPlatform: string | null;
  openedAt: string;
  closedAt: string | null;
  durationMs: number | null;
  idleMs: number | null;
  closeReason: string | null;
  operationsExecuted: number;
  evidenceRetrieved: number;
  avgLatencyMs: number | null;
  providerUsed: "connector";
  opLog: ConnectorOpLogEntry[];
}

interface ConnectorSession {
  sessionId: string;
  executionId: string;
  deviceId: string;
  organisationId: string;
  connectorVersion: string | null;
  deviceName: string | null;
  osPlatform: string | null;
  openedAt: Date;
  lastOpAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
  opLog: ConnectorOpLogEntry[];
  idleTimer: ReturnType<typeof setTimeout> | null;
}

// ─── State ────────────────────────────────────────────────────────────────────

/** executionId → active ConnectorSession */
const sessions = new Map<string, ConnectorSession>();

const IDLE_TIMEOUT_MS = 30_000; // 30 seconds of no operation before auto-close

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Open a connector session for the given execution.
 *
 * Validates in order:
 *   1. Tenant entitlement (local_file_connector)
 *   2. Registered, connected device exists for the organisation
 *   3. Device not revoked
 *   4. Worker profile version compatible
 *
 * Throws ConnectorCapabilityError if any validation fails.
 * Throws never for non-critical issues (warns and returns deviceId).
 *
 * Returns the deviceId that was selected for this session.
 */
export async function openConnectorSession(
  executionId: string,
  organisationId: string,
): Promise<{ deviceId: string; sessionId: string }> {
  // Return existing session if already open for this executionId
  const existing = sessions.get(executionId);
  if (existing && !existing.closedAt) {
    return { deviceId: existing.deviceId, sessionId: existing.sessionId };
  }

  // ── Validation 1: Entitlement ─────────────────────────────────────────────
  let entitlementResult: Awaited<ReturnType<typeof tenantCanUseConnector>>;
  try {
    entitlementResult = await tenantCanUseConnector(organisationId, "local_file_connector");
  } catch (err) {
    throw new ConnectorCapabilityError(
      "ENTITLEMENT_CHECK_FAILED",
      "Could not verify connector entitlement. Please try again.",
    );
  }

  if (!entitlementResult.allowed) {
    throw new ConnectorCapabilityError(
      "CONNECTOR_NOT_ENTITLED",
      "Your plan does not include NeedsOps Connector access. Please upgrade to use desktop file retrieval.",
    );
  }

  // ── Validation 2: Connected device ───────────────────────────────────────
  const connectedDevices = getConnectedDevicesForOrg(organisationId);
  if (connectedDevices.length === 0) {
    throw new ConnectorCapabilityError(
      "CONNECTOR_NOT_CONNECTED",
      "No NeedsOps Connector is currently online for your organisation. Please ensure the desktop application is running and connected.",
    );
  }

  // Select the first available connected device
  const deviceId = connectedDevices[0]!;

  // ── Validation 3: Device not revoked ─────────────────────────────────────
  let deviceRow: { status: string; displayName?: string | null; platform?: string | null; appVersion?: string | null } | undefined;
  try {
    const [row] = await db
      .select({
        status:      devicesTable.status,
        displayName: devicesTable.displayName,
        platform:    devicesTable.platform,
        appVersion:  devicesTable.appVersion,
      })
      .from(devicesTable)
      .where(eq(devicesTable.id, deviceId))
      .limit(1);
    deviceRow = row as typeof deviceRow;
  } catch {
    // Non-fatal — continue with limited metadata
  }

  if (deviceRow?.status === "revoked") {
    throw new ConnectorCapabilityError(
      "CONNECTOR_REVOKED",
      "The connected device has been revoked by a platform administrator. Please contact your administrator.",
    );
  }

  // ── Validation 4: Worker profile / connector version ─────────────────────
  // Use the app version from the device row; runtime status is supplementary
  let connectorVersion: string | null = deviceRow?.appVersion ?? null;
  if (!connectorVersion) {
    try {
      const [runtimeRow] = await db
        .select({ appVersion: deviceRuntimeStatusTable.appVersion })
        .from(deviceRuntimeStatusTable)
        .where(eq(deviceRuntimeStatusTable.deviceId, deviceId))
        .limit(1);
      connectorVersion = (runtimeRow as { appVersion?: string | null } | undefined)?.appVersion ?? null;
    } catch {
      // Non-fatal — version metadata is optional
    }
  }

  // ── Create session ────────────────────────────────────────────────────────
  const sessionId = `css_${randomUUID()}`;
  const now = new Date();

  const session: ConnectorSession = {
    sessionId,
    executionId,
    deviceId,
    organisationId,
    connectorVersion,
    deviceName:  deviceRow?.displayName ?? null,
    osPlatform:  deviceRow?.platform ?? null,
    openedAt:    now,
    lastOpAt:    now,
    closedAt:    null,
    closeReason: null,
    opLog:       [],
    idleTimer:   null,
  };

  sessions.set(executionId, session);
  resetIdleTimer(session);

  logger.info(
    { sessionId, executionId, deviceId, organisationId },
    "[connector-session] Session opened",
  );

  return { deviceId, sessionId };
}

/**
 * Record a connector operation in the session log.
 * Resets the idle timer for the session.
 */
export function recordConnectorOperation(
  executionId: string,
  entry: ConnectorOpLogEntry,
): void {
  const session = sessions.get(executionId);
  if (!session || session.closedAt) return;

  session.opLog.push(entry);
  session.lastOpAt = new Date();
  resetIdleTimer(session);
}

/**
 * Close the connector session gracefully.
 * Returns the session telemetry for the execution inspector.
 */
export function closeConnectorSession(
  executionId: string,
  reason: string,
): ConnectorSessionTelemetry | null {
  const session = sessions.get(executionId);
  if (!session) return null;

  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  if (!session.closedAt) {
    session.closedAt = new Date();
    session.closeReason = reason;
  }

  const telemetry = buildTelemetry(session);

  logger.info(
    { sessionId: session.sessionId, executionId, reason, operationsExecuted: session.opLog.length },
    "[connector-session] Session closed",
  );

  // Clean up after a delay to allow late-arriving inspector reads
  setTimeout(() => sessions.delete(executionId), 60_000);

  return telemetry;
}

/**
 * Get telemetry for an open or recently closed session (for the inspector).
 */
export function getConnectorSessionTelemetry(
  executionId: string,
): ConnectorSessionTelemetry | null {
  const session = sessions.get(executionId);
  if (!session) return null;
  return buildTelemetry(session);
}

/**
 * True if a session is open and not yet closed for the given execution.
 */
export function isConnectorSessionOpen(executionId: string): boolean {
  const session = sessions.get(executionId);
  return !!session && !session.closedAt;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function resetIdleTimer(session: ConnectorSession): void {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
  }
  session.idleTimer = setTimeout(() => {
    if (!session.closedAt) {
      closeConnectorSession(session.executionId, "idle_timeout");
    }
  }, IDLE_TIMEOUT_MS);
}

function buildTelemetry(session: ConnectorSession): ConnectorSessionTelemetry {
  const closedAt = session.closedAt;
  const durationMs = closedAt
    ? closedAt.getTime() - session.openedAt.getTime()
    : null;

  const idleMs = session.closedAt && session.closeReason === "idle_timeout"
    ? IDLE_TIMEOUT_MS
    : null;

  const latencies = session.opLog.map(e => e.latencyMs).filter(l => l > 0);
  const avgLatencyMs = latencies.length > 0
    ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length)
    : null;

  const evidenceRetrieved = session.opLog.filter(
    e => e.operationType === "read" && e.success,
  ).length;

  return {
    sessionId:          session.sessionId,
    executionId:        session.executionId,
    deviceId:           session.deviceId,
    organisationId:     session.organisationId,
    connectorVersion:   session.connectorVersion,
    deviceName:         session.deviceName,
    osPlatform:         session.osPlatform,
    openedAt:           session.openedAt.toISOString(),
    closedAt:           closedAt?.toISOString() ?? null,
    durationMs,
    idleMs,
    closeReason:        session.closeReason,
    operationsExecuted: session.opLog.length,
    evidenceRetrieved,
    avgLatencyMs,
    providerUsed:       "connector",
    opLog:              [...session.opLog],
  };
}
