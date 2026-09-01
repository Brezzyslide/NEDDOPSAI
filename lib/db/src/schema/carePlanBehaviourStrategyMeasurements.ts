import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { tasksTable } from "./tasks.js";
import { completedWorkTable } from "./completedWork.js";
import { completedWorkVersionsTable } from "./completedWorkVersions.js";

export type CarePlanBehaviourStrategyConfirmationStatus =
  | "model_classified"
  | "apo_confirmed"
  | "apo_corrected"
  | "unconfirmed";

export const carePlanBehaviourStrategyMeasurementsTable = pgTable(
  "care_plan_behaviour_strategy_measurements",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizationsTable.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasksTable.id, { onDelete: "set null" }),
    completedWorkId: text("completed_work_id").references(() => completedWorkTable.id, { onDelete: "cascade" }),
    completedWorkVersionId: text("completed_work_version_id").references(() => completedWorkVersionsTable.id, { onDelete: "set null" }),
    participantId: text("participant_id"),
    strategyFingerprint: text("strategy_fingerprint").notNull(),
    strategyText: text("strategy_text").notNull(),
    bspSourceQuote: text("bsp_source_quote").notNull(),
    modelFolds: jsonb("model_folds").$type<string[]>().notNull().default([]),
    apoFolds: jsonb("apo_folds").$type<string[]>().notNull().default([]),
    confirmationStatus: text("confirmation_status").$type<CarePlanBehaviourStrategyConfirmationStatus>().notNull(),
    actorUserId: text("actor_user_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    correctedAt: timestamp("corrected_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    orgIdx: index("idx_care_plan_behaviour_measurements_org").on(table.organizationId, table.createdAt),
    workIdx: index("idx_care_plan_behaviour_measurements_work").on(table.completedWorkId, table.completedWorkVersionId),
    fingerprintIdx: index("idx_care_plan_behaviour_measurements_fingerprint").on(table.organizationId, table.strategyFingerprint, table.createdAt),
  }),
);
