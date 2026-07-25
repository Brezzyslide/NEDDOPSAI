/**
 * platform_audit_log — Sprint 5
 *
 * Platform-scoped audit log for Needs Technology staff actions.
 * Replaces the platform-level portion of the shared audit_log table.
 *
 * Contains: org created/suspended, subscription changes, plan changes,
 * entitlement changes, feature flag changes, database provisioned,
 * backup completed, security alerts, platform admin actions,
 * support-access requests, system configuration changes.
 *
 * NEVER contains: customer operational content, participant data,
 * case note text, AI prompt/response content, connector credentials.
 * May reference org IDs for context, but NOT org operational data.
 *
 * In Sprint 7, existing audit_log records without organizationId
 * (or with platform event types) will be migrated here.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const platformAuditLogTable = pgTable("platform_audit_log", {
  id: text("id").primaryKey(),

  /**
   * Nullable: some platform events (e.g. user registration) occur before org
   * context is established. Org-referenced events store the org ID here for
   * correlation, but no operational content.
   */
  organizationId: text("organization_id").references(
    () => organizationsTable.id,
    { onDelete: "set null" },
  ),

  /** Null for system actors. */
  actorUserId: text("actor_user_id").references(() => usersTable.id, {
    onDelete: "set null",
  }),

  /** "platform_staff" | "system" | "webhook" | "scheduled_job" */
  actorType: text("actor_type").notNull().default("platform_staff"),

  /**
   * Event type, e.g. "platform.org_created", "platform.plan_changed",
   * "platform.feature_flag_updated", "platform.support_access_granted".
   */
  eventType: text("event_type").notNull(),

  /** The platform resource type affected. */
  resourceType: text("resource_type").notNull(),

  /** The UUID of the affected platform resource. */
  resourceId: text("resource_id"),

  requestId: text("request_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  /**
   * Platform-level metadata — safe summary only.
   * No customer operational content.
   */
  metadata: jsonb("metadata").notNull().default({}),

  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PlatformAuditLog = typeof platformAuditLogTable.$inferSelect;
export type InsertPlatformAuditLog = typeof platformAuditLogTable.$inferInsert;
