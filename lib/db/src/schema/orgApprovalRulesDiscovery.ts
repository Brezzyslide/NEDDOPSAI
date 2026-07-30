/**
 * org_approval_rules_discovery table — Sprint 14 (Business Discovery)
 *
 * Captures the human approval hierarchy discovered during Business Discovery.
 * Distinct from the operational approval_rules table (which governs AI task
 * execution). This table records who approves what in the customer's business.
 *
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const orgApprovalRulesDiscoveryTable = pgTable("org_approval_rules_discovery", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** purchase | leave | contract | email_external | custom */
  actionType: text("action_type").notNull(),

  /** Free-text name of the approver, e.g. "Sarah Johnson" */
  approverName: text("approver_name"),

  approverEmail: text("approver_email"),

  /** Role description, e.g. "Finance Manager" */
  approverRole: text("approver_role"),

  /** For purchases: approval required above this amount in cents */
  thresholdAmountCents: integer("threshold_amount_cents"),

  requiresReason: boolean("requires_reason").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OrgApprovalRuleDiscovery = typeof orgApprovalRulesDiscoveryTable.$inferSelect;
export type InsertOrgApprovalRuleDiscovery = typeof orgApprovalRulesDiscoveryTable.$inferInsert;
