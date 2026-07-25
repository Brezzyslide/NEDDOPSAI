/**
 * auditService — Sprint 7.1
 *
 * Audit event routing:
 *   • Platform events  → public.platform_audit_log
 *   • Org events       → org-schema org_audit_log (via withOrgContext)
 *                        Falls back to public.org_audit_log when org not provisioned
 *
 * Legacy tables (READ-ONLY from Sprint 7.1):
 *   • public.audit_log     — INSERT revoked (sprint71 migration)
 *   • public.org_audit_log — INSERT revoked (sprint71 migration); org events
 *                            now route to org schema
 *
 * Security: never log passwords, session tokens, raw auth material, or
 * customer operational content (case note text, AI prompts, connector tokens).
 */

import { randomUUID } from "crypto";
import { db, platformAuditLogTable, orgAuditLogTable } from "@workspace/db";
import { withOrgContext, OrgConnectionError } from "@workspace/org-db";
import { sql } from "drizzle-orm";
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

function escSql(v: string | null | undefined): string {
  if (v === null || v === undefined) return "NULL";
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ─── Core write function ──────────────────────────────────────────────────────

/**
 * Writes an audit event to the appropriate log table.
 *
 * Routing logic (Sprint 7.1):
 *   platform.* events  → platform_audit_log
 *   org events         → org-schema org_audit_log (via withOrgContext)
 *                        fallback to public.org_audit_log if org not provisioned
 *   no org             → platform_audit_log
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
    return;
  }

  // Org operational event — try org schema first, fallback to public.org_audit_log
  const orgId = params.organizationId!;

  try {
    await withOrgContext(
      { tenantId: orgId, userId: params.actorUserId ?? "system", purpose: "audit_write" },
      async (conn) => {
        await conn.db.execute(sql.raw(`
          INSERT INTO "${conn.schemaName}".org_audit_log
            (id, actor_user_id, actor_type, event_type, resource_type,
             resource_id, request_id, ip_address, user_agent,
             access_purpose, is_sensitive, metadata, occurred_at)
          VALUES (
            '${randomUUID()}',
            ${escSql(params.actorUserId)},
            ${escSql(params.actorType ?? "user")},
            ${escSql(params.eventType)},
            ${escSql(params.resourceType)},
            ${escSql(params.resourceId)},
            ${escSql(params.requestId)},
            ${escSql(params.ipAddress)},
            ${escSql(params.userAgent)},
            ${escSql(params.accessPurpose)},
            ${params.isSensitive ? "TRUE" : "FALSE"},
            '${JSON.stringify(params.metadata ?? {}).replace(/'/g, "''")}',
            NOW()
          )
        `));
      },
    );
  } catch (err: any) {
    if (err instanceof OrgConnectionError) {
      // Org not yet provisioned — best-effort fallback to public.org_audit_log.
      // The legacy table has FK constraints; if the insert fails (e.g. actor_user_id
      // not in users table), swallow and warn — audit events must not block operations.
      await db.insert(orgAuditLogTable).values({
        id: randomUUID(),
        organizationId: orgId,
        actorUserId: null, // null avoids FK violation on users.id in legacy table
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
      }).catch((fallbackErr: any) => {
        // Best-effort: legacy fallback also failed — log warning, do not throw.
        console.warn(
          `[auditService] Legacy org_audit_log fallback failed for org ${orgId} ` +
          `(event: ${params.eventType}): ${fallbackErr?.message ?? fallbackErr}`,
        );
      });
    } else {
      throw err;
    }
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
