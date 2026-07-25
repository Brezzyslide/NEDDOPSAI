/**
 * auditService — Sprint 7
 *
 * Sprint 7: Legacy audit_log dual-write STOPPED. All events now go exclusively
 * to their correct split tables:
 *   • Platform events  → platform_audit_log  (platform staff actions, config changes)
 *   • Org events       → org_audit_log       (user actions, operational activity)
 *
 * The legacy audit_log table is now READ-ONLY (INSERT revoked in sprint7 migration).
 * Existing rows are preserved for the retention period.
 *
 * Security: never log passwords, session tokens, raw auth material, or
 * customer operational content (case note text, AI prompts, connector tokens).
 */

import { randomUUID } from "crypto";
import { db, platformAuditLogTable, orgAuditLogTable } from "@workspace/db";
import type { AuditEventType } from "@workspace/shared";

export interface WriteAuditEventParams {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "agent" | "system" | "webhook" | "platform_staff" | "ai_gateway";
  eventType: AuditEventType;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  isSensitive?: boolean;
  accessPurpose?: string | null;
}

// ─── Routing helpers ──────────────────────────────────────────────────────────

function isPlatformEvent(eventType: string): boolean {
  return eventType.startsWith("platform.");
}

// ─── Core write function ──────────────────────────────────────────────────────

/**
 * Writes an audit event to the appropriate split log table.
 *
 * Sprint 7 routing (legacy audit_log dual-write REMOVED):
 *   platform.*  → platform_audit_log only
 *   org event   → org_audit_log only
 *   no org      → platform_audit_log
 */
export async function writeAuditEvent(params: WriteAuditEventParams): Promise<void> {
  const now = new Date();
  const isPlatform = isPlatformEvent(params.eventType);
  const hasOrg = !!params.organizationId;

  if (isPlatform || !hasOrg) {
    // Platform event → platform_audit_log
    await db.insert(platformAuditLogTable).values({
      id: randomUUID(),
      organizationId: params.organizationId ?? null,
      actorUserId: params.actorUserId ?? null,
      actorType: params.actorType ?? "platform_staff",
      eventType: params.eventType,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      requestId: params.requestId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata ?? {},
      occurredAt: now,
    });
  } else {
    // Org operational event → org_audit_log
    await db.insert(orgAuditLogTable).values({
      id: randomUUID(),
      organizationId: params.organizationId!,
      actorUserId: params.actorUserId ?? null,
      actorType: params.actorType ?? "user",
      eventType: params.eventType,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      requestId: params.requestId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      accessPurpose: params.accessPurpose ?? null,
      isSensitive: params.isSensitive ?? false,
      metadata: params.metadata ?? {},
      occurredAt: now,
    });
  }
}

/**
 * Convenience wrapper for platform routes.
 */
export async function log(params: {
  eventType: AuditEventType;
  actorId?: string | null;
  organizationId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await writeAuditEvent({
    eventType: params.eventType,
    actorUserId: params.actorId ?? null,
    organizationId: params.organizationId ?? null,
    actorType: isPlatformEvent(params.eventType) ? "platform_staff" : "user",
    resourceType: isPlatformEvent(params.eventType) ? "platform" : "organisation",
    metadata: params.metadata ?? {},
  });
}

/**
 * Writes an org operational audit event. Use this for all user-initiated
 * actions within an organisation context.
 */
export async function logOrgEvent(params: {
  eventType: AuditEventType;
  organizationId: string;
  actorUserId?: string | null;
  actorType?: "user" | "agent" | "system" | "ai_gateway";
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  accessPurpose?: string | null;
  isSensitive?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await writeAuditEvent({
    ...params,
    actorType: params.actorType ?? "user",
  });
}

/**
 * Extracts audit metadata from an Express request.
 */
export function getRequestMeta(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}) {
  const xff = req.headers["x-forwarded-for"];
  const ipAddress =
    (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    null;

  const requestId = req.headers["x-request-id"];
  const userAgent = req.headers["user-agent"];

  return {
    ipAddress,
    requestId: Array.isArray(requestId) ? requestId[0] : requestId ?? null,
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent ?? null,
  };
}

export const auditService = { log, logOrgEvent, writeAuditEvent, getRequestMeta };
