/**
 * auditService — Sprint 1
 *
 * Writes audit events to the audit_log table.
 * Events are append-only and must never be updated or deleted.
 *
 * Security: never log passwords, session tokens, or raw auth material.
 */

import { randomUUID } from "crypto";
import { db, auditLogTable } from "@workspace/db";
import type { AuditEventType } from "@workspace/shared";

export interface WriteAuditEventParams {
  organizationId?: string | null;
  actorUserId?: string | null;
  actorType?: "user" | "agent" | "system" | "webhook";
  eventType: AuditEventType;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeAuditEvent(params: WriteAuditEventParams): Promise<void> {
  await db.insert(auditLogTable).values({
    id: randomUUID(),
    organizationId: params.organizationId ?? null,
    actorUserId: params.actorUserId ?? null,
    actorType: params.actorType ?? "user",
    eventType: params.eventType,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    requestId: params.requestId ?? null,
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
    metadata: params.metadata ?? {},
    occurredAt: new Date(),
  });
}

/**
 * Convenience wrapper used by platform routes.
 * Accepts a flattened shape and delegates to writeAuditEvent.
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
    actorType: "user",
    resourceType: "platform",
    metadata: params.metadata ?? {},
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
export const auditService = { log, writeAuditEvent, getRequestMeta };
