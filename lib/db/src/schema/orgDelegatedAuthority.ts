/**
 * org_delegated_authority — Platform Completion Sprint
 *
 * Records temporary or permanent delegation of authority from one user
 * to another, scoped by authority type and optional time window.
 */

import { pgTable, text, integer, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const orgDelegatedAuthorityTable = pgTable("org_delegated_authority", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),

  organizationId: text("organization_id").notNull(),

  /** Person granting authority */
  delegatingUserId: text("delegating_user_id").notNull(),

  /** Person receiving authority */
  delegateUserId: text("delegate_user_id").notNull(),

  /**
   * What they can do:
   * 'financial_approval' | 'task_approval' | 'staff_management' |
   * 'compliance_sign_off' | 'all'
   */
  authorityScope: text("authority_scope").notNull(),

  /** Financial approval limit in cents (if financial scope) */
  maxApprovalAmount: integer("max_approval_amount"),

  delegatedFrom: timestamp("delegated_from", { withTimezone: true }).notNull(),

  /** Null = no expiry */
  delegatedUntil: timestamp("delegated_until", { withTimezone: true }),

  reason: text("reason"),

  /** active | expired | revoked */
  status: text("status").default("active"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`NOW()`),
});

export type OrgDelegatedAuthority = typeof orgDelegatedAuthorityTable.$inferSelect;
export type InsertOrgDelegatedAuthority = typeof orgDelegatedAuthorityTable.$inferInsert;
