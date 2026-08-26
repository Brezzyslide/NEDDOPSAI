/**
 * work_package_manifests — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * An immutable manifest assembled before every specialist execution. Records
 * every source, memory, and model version used so the output is fully
 * auditable and reproducible.
 *
 * Written once at execution time; never mutated.
 * Linked to the resulting completed_work row via completedWorkId.
 *
 * Sprint 27.4: Added observability columns (selectionMetadata, validationSnapshot,
 * performanceMetrics, failureInfo) for the Execution Inspector. These are nullable
 * JSONB columns populated asynchronously by the pipeline after each stage completes.
 * They do not affect execution behaviour.
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
  /**
   * Approved memory text, truncated to 800 chars to stay within token budget.
   * Only populated for task_execution contexts. Not present for all callers.
   * Safeguards applied at query time: approved + org-scoped + relevance-filtered.
   */
  content?: string;
}

// ─── Sprint 27.4 observability types ─────────────────────────────────────────

/** How the blueprint was selected for this execution. */
export interface BlueprintSelectionMetadata {
  method: "canonical" | "keyword" | "semantic" | "none";
  confidence: number;
  matchedKeywords: string[];
  fallbackUsed: boolean;
  canonicalIntent?: string;
  blueprintFamily?: string;
  blueprintMode?: string;
  requestedDeliverableType?: string;
  deliverableStandardisation?: "standard_reusable" | "organisation_tailored" | "participant_specific" | "general";
}

/** Snapshot of prerequisite-validation outcome written after Step 3. */
export interface ManifestValidationSnapshot {
  passed: boolean;
  missingItems: string[];
  summary: string;
}

/** Per-stage timing written after execution completes (or fails). */
export interface ManifestPerformanceMetrics {
  blueprintSelectionMs: number | null;
  validationMs: number | null;
  retrievalMs: number | null;
  llmMs: number | null;
  reviewMs: number | null;
  totalMs: number | null;
  evidenceCacheHit: boolean;
}

/** Written when execution pauses for clarification or encounters a hard failure. */
export interface ManifestFailureInfo {
  state: "awaiting_clarification" | "evidence_required" | "failed";
  failedStage?: string;
  rootCause?: string;
  retryAvailable?: boolean;
  clarificationItems?: Array<{ name: string; reason: string }>;
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
  canonicalIntent: text("canonical_intent"),
  blueprintFamily: text("blueprint_family"),
  blueprintMode: text("blueprint_mode"),
  templateId: text("template_id"),
  templateVersion: text("template_version"),
  contractSnapshot: jsonb("contract_snapshot")
    .$type<Record<string, unknown> | null>(),

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

  // ── Sprint 27.4 observability columns (all nullable; never block assembly) ──

  /** How the blueprint was selected (keyword vs semantic, confidence, matched phrase). */
  selectionMetadata: jsonb("selection_metadata")
    .$type<BlueprintSelectionMetadata | null>(),

  /** Snapshot of prerequisite-validation outcome (Step 3 of pipeline). */
  validationSnapshot: jsonb("validation_snapshot")
    .$type<ManifestValidationSnapshot | null>(),

  /** Per-stage timing in milliseconds. Written after execution completes or fails. */
  performanceMetrics: jsonb("performance_metrics")
    .$type<ManifestPerformanceMetrics | null>(),

  /** Written when execution pauses for clarification or encounters a failure. */
  failureInfo: jsonb("failure_info")
    .$type<ManifestFailureInfo | null>(),
});
