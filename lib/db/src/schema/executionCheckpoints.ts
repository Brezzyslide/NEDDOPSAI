import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

export const executionCheckpointsTable = pgTable(
  "execution_checkpoints",
  {
    id:                      text("id").primaryKey(),
    organizationId:          text("organization_id").notNull(),
    conversationId:          text("conversation_id").notNull(),
    taskId:                  text("task_id"),
    executionIntentId:       text("execution_intent_id"),
    executionRunId:          text("execution_run_id"),
    specialistCode:          text("specialist_code"),
    blueprintId:             text("blueprint_id"),
    workPackageManifestId:   text("work_package_manifest_id"),
    correlationId:           text("correlation_id").notNull(),
    pausedStage:             text("paused_stage"),
    status:                  text("status").notNull().default("active"),
    checkpointPayload:       jsonb("checkpoint_payload").notNull().default({}),
    validationResult:        jsonb("validation_result"),
    clarificationQuestions:  jsonb("clarification_questions").notNull().default([]),
    clarificationAnswer:     text("clarification_answer"),
    createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt:               timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt:               timestamp("expires_at", { withTimezone: true }),
    resumedAt:               timestamp("resumed_at", { withTimezone: true }),
    completedAt:             timestamp("completed_at", { withTimezone: true }),
    cancelledAt:             timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => ({
    orgIdx:     index("execution_checkpoints_org_idx").on(t.organizationId),
    statusIdx:  index("execution_checkpoints_status_idx").on(t.status),
  }),
);

export type ExecutionCheckpointRow    = typeof executionCheckpointsTable.$inferSelect;
export type InsertExecutionCheckpoint = typeof executionCheckpointsTable.$inferInsert;
