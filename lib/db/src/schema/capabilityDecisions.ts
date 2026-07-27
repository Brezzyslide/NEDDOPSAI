/**
 * capability_decisions — Sprint 9.4
 *
 * Tenant-scoped record of every capability access decision made by
 * capabilityAccessDecisionService. Provides:
 *   - Auditable trail of why work did or did not proceed
 *   - Linkage from specialist runs back to authorising decision
 *   - Analytics for upgrade demand and blocked capability tracking
 *
 * RLS: rows are tenant-scoped — only visible when app.current_organization_id
 * matches the organization_id column.
 *
 * Retention: no automatic expiry — historical capability decisions must remain
 * traceable (spec §17). Platform may archive after configurable retention period.
 */
import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const capabilityDecisionResultEnum = pgEnum("capability_decision_result", [
  "allowed",
  "partially_allowed",
  "blocked",
  "clarification_required",
]);

export const capabilityDecisionsTable = pgTable("capability_decisions", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),

  /** Nullable — decision may be made outside a conversation context */
  conversationId: text("conversation_id"),

  /** Nullable — decision may be made before a task exists */
  taskId: text("task_id"),

  /** Nullable — links back to the specialist run that was authorised or blocked */
  specialistRunId: text("specialist_run_id"),

  /** The canonical capability code from the registry */
  requestedCapabilityCode: text("requested_capability_code").notNull(),

  /** Level requested */
  requestedLevel: text("requested_level").notNull(),

  /** Decision outcome */
  decision: capabilityDecisionResultEnum("decision").notNull(),

  /** Machine-readable reason code for analytics and upgrade flows */
  reasonCode: text("reason_code").notNull(),

  /** Human-readable source of the decision (which rule triggered it) */
  source: text("source").notNull(),

  /** If blocked: which workforce pack would grant access */
  requiredWorkforcePack: text("required_workforce_pack"),

  /** Structured upgrade options (UpgradeOption[]) */
  upgradeOptions: jsonb("upgrade_options").$type<unknown[]>().notNull().default([]),

  /** When the decision was made */
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),

  /**
   * Optional expiry — decisions for time-limited trial access may expire.
   * Null = decision is permanent (most cases).
   */
  expiresAt: timestamp("expires_at", { withTimezone: true }),

  /** Links all decisions made in a single request chain */
  correlationId: text("correlation_id").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CapabilityDecisionRow = typeof capabilityDecisionsTable.$inferSelect;
export type InsertCapabilityDecisionRow = typeof capabilityDecisionsTable.$inferInsert;
