/**
 * org_connected_systems table — Sprint 14 (Business Discovery)
 *
 * Per-org record of connected business systems (CRM, email, accounting, etc.)
 * Populated during Business Discovery; auto_detected rows are confirmed by users.
 *
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const orgConnectedSystemsTable = pgTable("org_connected_systems", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** crm | email | accounting | hr | storage | project_management | other */
  systemType: text("system_type").notNull(),

  /** Human-readable system name, e.g. "Salesforce" */
  systemName: text("system_name").notNull(),

  systemUrl: text("system_url"),

  /** browser_session | api | file_path */
  accessMethod: text("access_method"),

  autoDetected: boolean("auto_detected").notNull().default(false),

  confirmedByUserId: text("confirmed_by_user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),

  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgConnectedSystem = typeof orgConnectedSystemsTable.$inferSelect;
export type InsertOrgConnectedSystem = typeof orgConnectedSystemsTable.$inferInsert;
