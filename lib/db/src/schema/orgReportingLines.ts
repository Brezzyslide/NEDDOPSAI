/**
 * org_reporting_lines — Platform Completion Sprint
 *
 * Tracks who reports to whom, with effective date ranges to support
 * historical changes. Null effective_to = currently active.
 */

import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgReportingLinesTable = pgTable("org_reporting_lines", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** The person reporting */
  userId: text("user_id").notNull(),

  /** The person they report to */
  reportsToUserId: text("reports_to_user_id").notNull(),

  /** FK to org_positions — position of the reporting person */
  positionId: text("position_id"),

  /** FK to org_positions — position of the manager */
  reportsToPositionId: text("reports_to_position_id"),

  /** direct | dotted_line | functional */
  relationshipType: text("relationship_type").default("direct"),

  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),

  /** Null = currently active */
  effectiveTo: timestamp("effective_to", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgReportingLine = typeof orgReportingLinesTable.$inferSelect;
export type InsertOrgReportingLine = typeof orgReportingLinesTable.$inferInsert;
