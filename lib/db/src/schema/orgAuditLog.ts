/**
 * org_audit_log — Sprint 5
 *
 * Organisation-scoped operational audit log.
 * Replaces the org-level portion of the shared audit_log table.
 *
 * Contains: user actions, record access, record CRUD, approvals, task actions,
 * participant access, document access, exports, AI requests, connector actions,
 * permission changes, sensitive information disclosures.
 *
 * NEVER contains: passwords, session tokens, raw auth material, secrets.
 * NEVER exposed to Platform Console in detail — only aggregate counts and security summaries.
 *
 * Security: organizationId is NOT NULL — every row must belong to an org.
 * RLS enforced: only visible when app.current_organization_id matches.
 *
 * In Sprint 7, existing audit_log records with organizationId will be migrated here.
 * In Sprint 8+, AI request audit records will be written here by the AI Privacy Gateway.
 */
import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const orgAuditLogTable = pgTable("org_audit_log", {
  id: text("id").primaryKey(),

  /** Non-null: every operational audit record belongs to exactly one organisation. */
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Null for system/AI/webhook actors. */
  actorUserId: text("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  /** "user" | "agent" | "system" | "webhook" | "ai_gateway" */
  actorType: text("actor_type").notNull().default("user"),

  /**
   * Event type string, e.g. "task.created", "approval.resolved",
   * "member.invited", "participant.accessed", "document.exported".
   */
  eventType: text("event_type").notNull(),

  /** The type of resource affected. */
  resourceType: text("resource_type").notNull(),

  /** The UUID of the affected resource. */
  resourceId: text("resource_id"),

  /** Correlation ID from the X-Request-ID header or job ID. */
  requestId: text("request_id"),

  /** Client IP — stored only for security events and access records. */
  ipAddress: text("ip_address"),

  userAgent: text("user_agent"),

  /**
   * Purpose of access (required for AI gateway events).
   * Supports purpose limitation and regulatory audit evidence.
   */
  accessPurpose: text("access_purpose"),

  /**
   * Whether this event involves sensitive information.
   * Set by the emitting service based on content classification.
   */
  isSensitive: boolean("is_sensitive").notNull().default(false),

  /** Arbitrary event context — never includes secrets or credentials. */
  metadata: jsonb("metadata").notNull().default({}),

  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type OrgAuditLog = typeof orgAuditLogTable.$inferSelect;
export type InsertOrgAuditLog = typeof orgAuditLogTable.$inferInsert;
