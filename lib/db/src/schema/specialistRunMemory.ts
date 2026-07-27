/**
 * specialist_run_memory — Sprint 9.5
 *
 * Working memory scoped to a single specialist run.
 * Does NOT automatically become organisation memory.
 * Important facts may be proposed through the org-memory approval workflow.
 *
 * RLS: organisation_id must match app.current_organization_id
 */

import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const SPECIALIST_MEMORY_TYPES = [
  "working_fact",
  "intermediate_finding",
  "open_question",
  "evidence_reference",
  "draft_recommendation",
  "dependency_output",
] as const;

export type SpecialistMemoryType = (typeof SPECIALIST_MEMORY_TYPES)[number];

export const specialistRunMemoryTable = pgTable(
  "specialist_run_memory",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull(),
    specialistRunId: text("specialist_run_id").notNull(),
    memoryType: text("memory_type").notNull(),
    content: text("content").notNull(),
    structuredContent: jsonb("structured_content"),
    sourceReference: text("source_reference"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`NOW()`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().default(sql`NOW()`),
  },
  (t) => [
    index("specialist_run_memory_run_idx").on(t.specialistRunId),
    index("specialist_run_memory_org_idx").on(t.organizationId),
    index("specialist_run_memory_type_idx").on(t.specialistRunId, t.memoryType),
  ],
);
