/**
 * agent_configurations table — Sprint 14 (Business Discovery)
 *
 * Per-specialist configuration seeded from Business Discovery answers.
 * Consumed at runtime to personalise agent behaviour.
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

export const agentConfigurationsTable = pgTable("agent_configurations", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** Specialist code, e.g. "chief_of_staff", "operations_manager" */
  specialistCode: text("specialist_code").notNull(),

  /** First-week goals provided during Business Discovery */
  firstWeekGoals: text("first_week_goals"),

  /** Full configuration JSON consumed by the agent runtime */
  configurationJson: text("configuration_json").notNull().default("{}"),

  /** True when this row was seeded from discovery answers */
  seededFromDiscovery: boolean("seeded_from_discovery").notNull().default(false),

  /** Schema version — increments on each update */
  version: integer("version").notNull().default(1),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentConfiguration = typeof agentConfigurationsTable.$inferSelect;
export type InsertAgentConfiguration = typeof agentConfigurationsTable.$inferInsert;
