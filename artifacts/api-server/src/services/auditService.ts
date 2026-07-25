/**
 * auditService — Sprint 1 (split in Sprint 5)
 *
 * Sprint 5: Routes events to the appropriate audit log table:
 *   • Platform events  → platform_audit_log  (platform staff actions, config changes)
 *   • Org events       → org_audit_log       (user actions, record access, operational activity)
 *   • Both             → audit_log           (backward-compat until Sprint 7 migration)
 *
 * Routing rule: event types starting with "platform." are platform events.
 * Events with an organizationId and a non-platform event type are org events.
 *
 * Security: never log passwords, session tokens, raw auth material, or
 * customer operational content (case note text, AI prompts, connector tokens).
 */

import { randomUUID } from "crypto";
import { db, auditLogTable, platformAuditLogTable, orgAuditLogTable } from "@workspace/db";
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
  /** Whether the event involves sensitive information (access purpose, AI retrieval) */
  isSensitive?: boolean;
  /** Access purpose label for AI gateway and audited access events */
  accessPurpose?: string | null;
}

// ─── Routing helpers ──────────────────────────────────────────────────────────

function isPlatformEvent(eventType: string): boolean {
  return eventType.startsWith("platform.");
}

// ─── Core write function ──────────────────────────────────────────────────────

/**
 * Writes an audit event to the appropriate log table(s).
 *
 * Sprint 5 routing:
 *   platform.*  → platform_audit_log + audit_log (compat)
 *   org event   → org_audit_log + audit_log (compat)
 *   no org      → platform_audit_log + audit_log (compat)
 *
 * Sprint 7 will stop writing to audit_log and migrate existing records.
 */
export async function writeAuditEvent(params: WriteAuditEventParams): Promise<void> {
  const id = randomUUID();
  const now = new Date();
  const isPlatform = isPlatformEvent(params.eventType);
  const hasOrg = !!params.organizationId;

  // ── 1. Write to legacy shared table (backward compat until Sprint 7) ────────
  await db.insert(auditLogTable).values({
    id,
    organizationId: params.organizationId ?? null,
    actorUserId: params.actorUserId ?? null,
    actorType: (params.actorType === "platform_staff" || params.actorType === "ai_gateway")
      ? "system"
      : (params.actorType ?? "user"),
    eventType: params.eventType,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    requestId: params.requestId ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    metadata: params.metadata ?? {},
    occurredAt: now,
  }).catch(() => {}); // Non-fatal: new split tables are the source of truth

  // ── 2. Write to split tables ─────────────────────────────────────────────────

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
 * Convenience wrapper used by platform routes.
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

/**
 * Namespace object — imported as `{ auditService }` by platform routes.
 */
export const auditService = { log, logOrgEvent, writeAuditEvent, getRequestMeta };
