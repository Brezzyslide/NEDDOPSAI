/**
 * completed_work_claims — Sprint 29K.3 (Claim Emission & Claim-to-Evidence Binding)
 *
 * Each row represents a structured provenance claim emitted by the specialist
 * during a single task-execution LLM call. Claims are version-scoped: every
 * claim belongs to exactly one completed_work_versions row and must not float
 * at the completedWorkId level without version ownership.
 *
 * provenanceStatus reflects per-claim grounding:
 *   grounded          — all validation rules satisfied
 *   unsupported       — required evidence or parent links absent/invalid
 *   unverified_absence — absence_finding whose retrieval evidence cannot be proven
 *   invalid_binding   — one or more evidence bindings failed span/chunk validation
 */
import { pgTable, text, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations.js";
import { completedWorkTable } from "./completedWork.js";
import { completedWorkVersionsTable } from "./completedWorkVersions.js";

export type ClaimType =
  | "observation"
  | "absence_finding"
  | "inference"
  | "external_requirement"
  | "recommendation";

export type ClaimProvenanceStatus =
  | "grounded"
  | "unsupported"
  | "unverified_absence"
  | "invalid_binding";

export interface AbsenceEvidenceRecord {
  searchTerms: string[];
  sourceScope: string[];
  retrievalFilters: {
    specialistCode: string;
    scopeMode: string;
    minConfidenceThreshold: number;
  };
  sectionsExamined: string[];
  totalCandidatesRetrieved: number;
  passedThresholdCount: number;
  topRelevanceScores: number[];
  matchingRequirementFound: boolean;
  confidenceOfAbsence: number;
}

export const completedWorkClaimsTable = pgTable(
  "completed_work_claims",
  {
    id: text("id").primaryKey(),

    executionId: text("execution_id").notNull(),

    completedWorkId: text("completed_work_id")
      .notNull()
      .references(() => completedWorkTable.id, { onDelete: "cascade" }),

    versionId: text("version_id")
      .notNull()
      .references(() => completedWorkVersionsTable.id, { onDelete: "cascade" }),

    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),

    /** The human-readable claim statement */
    claimText: text("claim_text").notNull(),

    /**
     * Claim taxonomy — one of the 5 canonical types.
     * DB-level check enforced in migration SQL.
     */
    claimType: text("claim_type").notNull(),

    /** Section heading within the Completed Work document (e.g. "Findings") */
    sectionRef: text("section_ref"),

    /** Model confidence 0–1 */
    confidence: real("confidence"),

    /**
     * Brief rationale for the claim (max 200 chars enforced at service layer).
     * Must NOT contain chain-of-thought or source passage text.
     */
    reasoningSummary: text("reasoning_summary"),

    /**
     * Resolved UUIDs of related persisted claims.
     * Populated by claimPersistenceService after clientClaimId → UUID resolution.
     */
    relatedClaimIds: text("related_claim_ids").array().default([]),

    /**
     * Structured absence-search record for absence_finding claims.
     * null for all other claim types.
     */
    absenceRecord: jsonb("absence_record").$type<AbsenceEvidenceRecord>(),

    /**
     * Per-claim provenance grounding result.
     * A row existing does NOT mean the claim is grounded — inspect this field.
     */
    provenanceStatus: text("provenance_status").notNull().default("unsupported"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    cwOrgIdx: index("completed_work_claims_cw_org_idx").on(
      table.completedWorkId,
      table.organizationId,
    ),
    versionOrgIdx: index("completed_work_claims_version_org_idx").on(
      table.versionId,
      table.organizationId,
    ),
    executionIdx: index("completed_work_claims_execution_idx").on(table.executionId),
    claimTypeIdx: index("completed_work_claims_type_idx").on(table.claimType),
  }),
);
