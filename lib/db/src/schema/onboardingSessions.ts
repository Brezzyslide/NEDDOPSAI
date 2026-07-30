/**
 * onboarding_sessions table — Sprint 14
 *
 * Tracks wizard progress so users can resume where they left off.
 * One row per org (unique on organization_id).
 *
 * RLS enforced via organization_id.
 */
import {
  pgTable,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { usersTable } from "./users.js";

export const onboardingSessionsTable = pgTable("onboarding_sessions", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .unique()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  userId: text("user_id")
    .references(() => usersTable.id, { onDelete: "set null" }),

  /** Current wizard step (1–6) */
  currentStep: integer("current_step").notNull().default(1),

  /** Serialized array of completed step numbers */
  completedSteps: text("completed_steps").notNull().default("[]"),

  /** Selected pack codes (serialized JSON array) */
  selectedPackCodes: text("selected_pack_codes").notNull().default("[]"),

  /** Selected plan code */
  selectedPlanCode: text("selected_plan_code"),

  /** Billing cycle: monthly | annual */
  billingCycle: text("billing_cycle").default("monthly"),

  completedAt: timestamp("completed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OnboardingSession = typeof onboardingSessionsTable.$inferSelect;
export type InsertOnboardingSession = typeof onboardingSessionsTable.$inferInsert;
