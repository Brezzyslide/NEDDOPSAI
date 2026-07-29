/**
 * org_departments — Platform Completion Sprint
 *
 * Organisational department structure with optional self-referential
 * parent department for nested hierarchies.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgDepartmentsTable = pgTable("org_departments", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** Display name e.g. "Operations", "Compliance", "Finance" */
  name: text("name").notNull(),

  /** Machine-readable slug e.g. "operations" */
  code: text("code").notNull(),

  description: text("description"),

  /** Self-referential FK for nested departments */
  parentDepartmentId: text("parent_department_id"),

  /** FK to users table — department manager */
  managerUserId: text("manager_user_id"),

  /** active | archived */
  status: text("status").default("active"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgDepartment = typeof orgDepartmentsTable.$inferSelect;
export type InsertOrgDepartment = typeof orgDepartmentsTable.$inferInsert;
