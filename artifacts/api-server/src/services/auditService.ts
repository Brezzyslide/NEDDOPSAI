/**
 * auditService — Sprint 7.1
 *
 * Audit event routing:
 *   • Platform events  → public.platform_audit_log
 *   • Org events       → public.write_org_audit_event(...) bounded function
 *
 * Legacy tables (READ-ONLY from Sprint 7.1):
 *   • public.audit_log     — INSERT revoked (sprint71 migration)
 *   • public.org_audit_log — INSERT revoked (sprint71 migration); org events
 *                            must use public.write_org_audit_event(...)
 *
 * Security: never log passwords, session tokens, raw auth material, or
 * customer operational content (case note text, AI prompts, connector tokens).
 */

import { randomUUID } from "crypto";
import { db, withSystemTenantContext, platformAuditLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { AuditEventType } from "@workspace/shared";

type DbClient = typeof db;

async function getPlatformDb(): Promise<DbClient> {
  const { platformDb } = await import("@workspace/db/platform");
  return platformDb as unknown as DbClient;
}

function withAuditTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "audit_service", purpose },
    fn,
  );
}

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
  platformClient?: DbClient;
}

// ─── Routing helpers ──────────────────────────────────────────────────────────

function isPlatformEvent(eventType: string): boolean {
  return eventType.startsWith("platform.");
}

async function writeSharedOrgAuditEvent(
  client: DbClient,
  params: WriteAuditEventParams,
): Promise<void> {
  await client.execute(sql`
    SELECT public.write_org_audit_event(
      ${randomUUID()},
      ${params.organizationId},
      ${params.actorUserId ?? null},
      ${params.actorType ?? "user"},
      ${params.eventType},
      ${params.resourceType},
      ${params.resourceId ?? null},
      ${params.requestId ?? null},
      ${params.ipAddress ?? null},
      ${params.userAgent ?? null},
      ${params.accessPurpose ?? null},
      ${params.isSensitive ?? false},
      ${JSON.stringify(params.metadata ?? {})}::jsonb
    )
  `);
}

// ─── Core write function ──────────────────────────────────────────────────────

/**
 * Writes an audit event to the appropriate log table.
 *
 * Routing logic:
 *   platform.* events  → platform_audit_log
 *   org events         → public.write_org_audit_event(...) SECURITY DEFINER function
 *   no org             → platform_audit_log
 */
export async function writeAuditEvent(params: WriteAuditEventParams): Promise<void> {
  const now = new Date();
  const isPlatform = isPlatformEvent(params.eventType);
  const hasOrg = !!params.organizationId;

  if (isPlatform || !hasOrg) {
    // Platform event → platform_audit_log
    const platformClient = params.platformClient ?? await getPlatformDb();
    await platformClient.insert(platformAuditLogTable).values({
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

  // Org operational event. In the current shared-database model, do not route
  // through org_database_registry; use the bounded shared audit writer instead.
  const orgId = params.organizationId!;

  await withAuditTenant(orgId, "audit.org_event", async (client) => {
    await writeSharedOrgAuditEvent(client, { ...params, organizationId: orgId });
  }).catch((err: any) => {
    // Best-effort: audit events must not block operations.
    console.warn(
      `[auditService] Shared org audit write failed for org ${orgId} ` +
      `(event: ${params.eventType}): ${err?.message ?? err}`,
    );
  });
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
