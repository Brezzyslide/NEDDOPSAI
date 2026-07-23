/**
 * @workspace/audit — Audit log types
 *
 * Every significant action in NeedsOps AI+ must be auditable.
 * This module defines the event shape and action catalogue.
 */

// ─── Actor ────────────────────────────────────────────────────────────────────

export type AuditActorType = "user" | "agent" | "system" | "webhook";

export interface AuditActor {
  type: AuditActorType;
  /** UUID of the user or agent (null for system) */
  id: string | null;
  /** Human-readable label for log display */
  label: string;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type AuditAction =
  // Auth
  | "auth.login"
  | "auth.logout"
  | "auth.token_refreshed"
  // Organizations
  | "org.created"
  | "org.updated"
  | "org.deleted"
  | "org.suspended"
  | "org.reactivated"
  // Users
  | "user.invited"
  | "user.joined"
  | "user.role_changed"
  | "user.removed"
  | "user.suspended"
  // Workforce packs
  | "workforce.pack_activated"
  | "workforce.pack_deactivated"
  // AI tasks
  | "agent.task_created"
  | "agent.task_completed"
  | "agent.task_failed"
  | "agent.approval_requested"
  | "agent.approval_granted"
  | "agent.approval_denied"
  // Integrations
  | "integration.connected"
  | "integration.disconnected"
  | "integration.token_refreshed"
  // Billing (Sprint 2+)
  | "billing.subscription_created"
  | "billing.subscription_changed"
  | "billing.subscription_cancelled"
  // Security
  | "security.api_key_created"
  | "security.api_key_revoked";

// ─── Event ────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  /** UUID of this audit record */
  id: string;
  /** The organisation this event belongs to */
  organizationId: string;
  /** Who performed the action */
  actor: AuditActor;
  /** What happened */
  action: AuditAction;
  /** The resource type affected, e.g. "organization", "user", "workforce_pack" */
  resourceType: string;
  /** The resource ID affected */
  resourceId: string | null;
  /** Optional before/after snapshot for change events */
  diff?: {
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  };
  /** Additional context (request ID, IP address, etc.) */
  metadata: Record<string, unknown>;
  /** ISO timestamp */
  occurredAt: string;
}
