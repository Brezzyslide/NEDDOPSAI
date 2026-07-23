/**
 * approval_rules table — Sprint 2
 * Configures which approval type applies to which specialist action within an org.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { specialistsTable } from "./specialists.js";
import { approvalTypeEnum } from "./tasks.js";

export const approvalRulesTable = pgTable("approval_rules", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  specialistId: text("specialist_id").references(() => specialistsTable.id),
  capabilityCode: text("capability_code"),               // null = applies to all capabilities
  approvalType: approvalTypeEnum("approval_type").notNull(),
  conditions: jsonb("conditions").notNull().default({}), // future: complex condition expressions
  isActive: text("is_active").notNull().default("true"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovalRule = typeof approvalRulesTable.$inferSelect;
export type InsertApprovalRule = typeof approvalRulesTable.$inferInsert;
