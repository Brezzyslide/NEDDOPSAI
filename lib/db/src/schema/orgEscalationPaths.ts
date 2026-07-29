/**
 * org_escalation_paths — Platform Completion Sprint
 *
 * Defines step-by-step escalation paths triggered by specific conditions
 * (e.g. overdue tasks, unapproved items, SLA breaches).
 */

import { pgTable, text, integer, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgEscalationPathsTable = pgTable("org_escalation_paths", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** Human-readable name e.g. "Overdue Approval Escalation" */
  name: text("name").notNull(),

  /**
   * What triggers this path:
   * 'overdue_task' | 'approval_timeout' | 'sla_breach' | 'incident' | 'manual'
   */
  triggerType: text("trigger_type").notNull(),

  /** Ordered step number (1, 2, 3…) */
  stepOrder: integer("step_order").notNull().default(1),

  /** Role to escalate to (role code) */
  escalateToRole: text("escalate_to_role"),

  /** Specific user to escalate to */
  escalateToUserId: text("escalate_to_user_id"),

  /** 'in_app' | 'email' | 'sms' | 'both' */
  notificationMethod: text("notification_method").notNull().default("in_app"),

  /** Hours before escalating to next step (null = no auto-escalation) */
  timeLimitHours: integer("time_limit_hours"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgEscalationPath = typeof orgEscalationPathsTable.$inferSelect;
export type InsertOrgEscalationPath = typeof orgEscalationPathsTable.$inferInsert;
