/**
 * org_positions — Platform Completion Sprint
 *
 * Position/role definitions within the organisational hierarchy.
 * Self-referential reports_to_position_id enables position tree.
 */

import { pgTable, text, integer, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgPositionsTable = pgTable("org_positions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** FK to org_departments */
  departmentId: text("department_id"),

  /** FK to org_teams */
  teamId: text("team_id"),

  /** e.g. "Registered Nurse", "Support Coordinator" */
  title: text("title").notNull(),

  /** Machine-readable code */
  code: text("code").notNull(),

  /** Self-referential FK for position hierarchy */
  reportsToPositionId: text("reports_to_position_id"),

  /**
   * Authority level:
   * 1=staff, 2=team lead, 3=manager, 4=director, 5=executive
   */
  authorityLevel: integer("authority_level").default(1),

  isManager: boolean("is_manager").default(false),

  /** Financial approval limit in cents */
  canApproveUpToAmount: integer("can_approve_up_to_amount"),

  /** active | archived */
  status: text("status").default("active"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgPosition = typeof orgPositionsTable.$inferSelect;
export type InsertOrgPosition = typeof orgPositionsTable.$inferInsert;
