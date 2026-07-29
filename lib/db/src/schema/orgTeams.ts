/**
 * org_teams — Platform Completion Sprint
 *
 * Teams within an organisation, optionally nested under a department.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgTeamsTable = pgTable("org_teams", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** FK to org_departments */
  departmentId: text("department_id"),

  name: text("name").notNull(),

  /** Machine-readable slug */
  code: text("code").notNull(),

  description: text("description"),

  /** FK to users table — team lead */
  teamLeadUserId: text("team_lead_user_id"),

  /** active | archived */
  status: text("status").default("active"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgTeam = typeof orgTeamsTable.$inferSelect;
export type InsertOrgTeam = typeof orgTeamsTable.$inferInsert;
