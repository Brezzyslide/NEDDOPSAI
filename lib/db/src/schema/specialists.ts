/**
 * specialists table — Sprint 2
 * Each row describes one AI specialist worker.
 */
import { pgTable, pgEnum, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { workforcePacksTable } from "./workforcePacks.js";

export const specialistExecutionStatusEnum = pgEnum("specialist_execution_status", [
  "available",
  "beta",
  "coming_soon",
  "deprecated",
]);

export const specialistsTable = pgTable("specialists", {
  id: text("id").primaryKey(),                              // e.g. "chief_of_staff"
  code: text("code").notNull().unique(),                    // machine-readable code
  displayName: text("display_name").notNull(),
  packId: text("pack_id").references(() => workforcePacksTable.id),
  description: text("description"),
  icon: text("icon"),                                       // emoji or icon name
  colour: text("colour"),                                   // hex colour
  requiredPermissions: jsonb("required_permissions").notNull().default([]),
  requiredEntitlements: jsonb("required_entitlements").notNull().default([]),
  approvalRequirements: text("approval_requirements").notNull().default("no_approval"),
  executionStatus: specialistExecutionStatusEnum("execution_status").notNull().default("available"),
  version: text("version").notNull().default("1.0.0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Specialist = typeof specialistsTable.$inferSelect;
export type InsertSpecialist = typeof specialistsTable.$inferInsert;
