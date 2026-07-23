/**
 * audit_log table — Sprint 1
 *
 * Implements the lib/audit schema stub. Append-only — records are never
 * updated or deleted. Retention policies are enforced by archival.
 *
 * Security: never store passwords, session tokens, or raw auth secrets.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const auditLogTable = pgTable("audit_log", {
  id: text("id").primaryKey(),

  /** Null for platform-level events (e.g. user registration before joining any org) */
  organizationId: text("organization_id").references(
    () => organizationsTable.id,
    { onDelete: "set null" },
  ),

  /** Null for system/webhook actors */
  actorUserId: text("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  /** "user" | "agent" | "system" | "webhook" */
  actorType: text("actor_type").notNull().default("user"),

  /**
   * Event type string, e.g. "user.registered", "org.created",
   * "invitation.accepted", "membership.role_changed"
   */
  eventType: text("event_type").notNull(),

  /** The type of resource affected, e.g. "organization", "user", "invitation" */
  resourceType: text("resource_type").notNull(),

  /** The UUID of the affected resource */
  resourceId: text("resource_id"),

  /** Correlation ID from the X-Request-ID header */
  requestId: text("request_id"),

  /** Client IP address (from X-Forwarded-For, never stored raw for high-risk events) */
  ipAddress: text("ip_address"),

  userAgent: text("user_agent"),

  /** Arbitrary event context (before/after state, diff, etc.) — never includes secrets */
  metadata: jsonb("metadata").notNull().default({}),

  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
export type InsertAuditLog = typeof auditLogTable.$inferInsert;
