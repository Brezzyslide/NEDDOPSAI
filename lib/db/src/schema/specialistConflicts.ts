/**
 * specialist_conflicts — Sprint 9.5
 *
 * Records when specialists produce conflicting findings or recommendations.
 * The Chief of Staff must not silently choose one side — conflicts are surfaced
 * in the Task Workroom for human resolution when required.
 *
 * RLS: organisation_id must match app.current_organization_id
 */

import {
  pgTable,
  text,
  jsonb,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const specialistConflictsTable = pgTable(
  "specialist_conflicts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    taskId: text("task_id").notNull(),
    specialistRunIds: jsonb("specialist_run_ids").notNull().$type<string[]>(),
    conflictingPositions: jsonb("conflicting_positions").notNull().$type<Array<{
      specialistRunId: string;
      position: string;
      confidence: number;
    }>>(),
    evidenceReferences: jsonb("evidence_references").$type<string[]>(),
    risk: text("risk").notNull().default("medium"),
    chiefOfStaffRecommendation: text("chief_of_staff_recommendation"),
    resolutionRequired: boolean("resolution_required").notNull().default(true),
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (t) => [
    index("specialist_conflicts_task_idx").on(t.taskId),
    index("specialist_conflicts_org_idx").on(t.organizationId),
    index("specialist_conflicts_unresolved_idx").on(t.organizationId, t.resolutionRequired),
  ],
);
