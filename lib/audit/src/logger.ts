/**
 * @workspace/audit — Audit event helpers
 *
 * Sprint 0: helper to construct AuditEvent objects.
 * Sprint 1: `writeAuditEvent` will persist to the audit_log table.
 */

import type { AuditActor, AuditAction, AuditEvent } from "./types.js";

let _idCounter = 0;

/** Simple ID generator — Sprint 1: replace with crypto.randomUUID() in Node runtime */
function generateId(): string {
  return `audit-${Date.now()}-${++_idCounter}`;
}

export function createAuditEvent(params: {
  organizationId: string;
  actor: AuditActor;
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  diff?: AuditEvent["diff"];
  metadata?: Record<string, unknown>;
}): AuditEvent {
  return {
    id: generateId(),
    organizationId: params.organizationId,
    actor: params.actor,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    diff: params.diff,
    metadata: params.metadata ?? {},
    occurredAt: new Date().toISOString(),
  };
}

/**
 * Sprint 0 stub — no-op to avoid node/dom type dependencies at lib level.
 *
 * Sprint 1: replace with a real DB writer:
 *
 * ```typescript
 * import { db } from "@workspace/db";
 * import { auditLogTable } from "@workspace/audit";
 *
 * export async function writeAuditEvent(event: AuditEvent): Promise<void> {
 *   await db.insert(auditLogTable).values({
 *     id: event.id,
 *     organizationId: event.organizationId,
 *     actor: event.actor,
 *     action: event.action,
 *     resourceType: event.resourceType,
 *     resourceId: event.resourceId,
 *     diff: event.diff ?? null,
 *     metadata: event.metadata,
 *   });
 * }
 * ```
 */
export async function writeAuditEvent(_event: AuditEvent): Promise<void> {
  // TODO Sprint 1: persist to audit_log table via @workspace/db
  // Stub: intentionally silent so lib/audit has zero runtime dependencies
}
