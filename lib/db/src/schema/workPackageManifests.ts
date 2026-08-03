/**
 * work_package_manifests — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * An immutable manifest assembled before every specialist execution. Records
 * every source, memory, and model version used so the output is fully
 * auditable and reproducible.
 *
 * Written once at execution time; never mutated.
 * Linked to the resulting completed_work row via completedWorkId.
 */
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";

export interface ManifestLibrarySource {
  sourceId: string;
  title: string;
  sourceType: string;
  versionLabel?: string;
  authorityLevel?: string;
  storageKey?: string;
}

export interface ManifestMemoryRef {
  memoryId: string;
  memoryType: string;
  title: string;
  approvalStatus?: string;
}

export const workPackageManifestsTable = pgTable("work_package_manifests", {
  id: text("id").primaryKey(),

  organizationId: text("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),

  /** FK to completed_work — set after the work item is created */
  completedWorkId: text("completed_work_id"),

  /** Correlation ID for this execution run */
  executionId: text("execution_id").notNull(),

  /** Blueprint used to govern execution (NULL for ad-hoc work) */
  blueprintId: text("blueprint_id"),
  blueprintVersion: text("blueprint_version"),

  primarySpecialist: text("primary_specialist").notNull(),
  supportingSpecialists: jsonb("supporting_specialists")
    .$type<string[]>()
    .notNull()
    .default([]),

  /** Approved library sources retrieved for this execution */
  organisationLibrarySources: jsonb("organisation_library_sources")
    .$type<ManifestLibrarySource[]>()
    .notNull()
    .default([]),

  /** CoS memory entries included */
  cosMemories: jsonb("cos_memories")
    .$type<ManifestMemoryRef[]>()
    .notNull()
    .default([]),

  /** Specialist-specific memory entries included */
  specialistMemories: jsonb("specialist_memories")
    .$type<ManifestMemoryRef[]>()
    .notNull()
    .default([]),

  /** Structured entity knowledge (participant, client, staff) */
  entityKnowledge: jsonb("entity_knowledge")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),

  /** Conversation-scoped task uploads included */
  taskUploads: jsonb("task_uploads")
    .$type<ManifestLibrarySource[]>()
    .notNull()
    .default([]),

  /** LLM model version used (e.g. "gpt-4o-2024-08-06") */
  modelVersion: text("model_version"),

  /** Internal prompt version for reproducibility */
  promptVersion: text("prompt_version"),

  /** When the manifest was assembled */
  assembledAt: timestamp("assembled_at", { withTimezone: true }).notNull().defaultNow(),

  /** User who initiated the work request */
  requesterId: text("requester_id"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
