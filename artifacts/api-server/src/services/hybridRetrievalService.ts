/**
 * hybridRetrievalService — Task #17 (Knowledge Orchestration Engine)
 *
 * Core hybrid retrieval engine over knowledge_chunks.
 * Combines:
 *   - Semantic search  (pgvector cosine similarity)
 *   - Lexical search   (PostgreSQL tsvector / ts_rank)
 *   - Metadata filters (scope, sensitivity, authority, effective dates)
 *
 * Called by each priority-layer provider — the scope filter distinguishes
 * task uploads (P1), entity (P2), specialist (P4), and library (P5).
 *
 * PRIVACY: Never returns raw embedding vectors. Only scores + metadata.
 * TENANT: organisationId is mandatory in every query.
 * FRESHNESS: Sources not yet effective or already expired are excluded.
 * SUPERSEDED: Only isCurrent = true sources are returned.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { SensitivityLevel, AuthorityLevel } from "../lib/knowledge/IKnowledgeProvider.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ChunkScopeMode =
  | "task_upload"        // sourceScope = 'task' AND task_id = taskId
  | "specialist_scoped"  // knowledge_source_scopes.scope_type = 'specialist'
  | "org_library"        // scope_type IN ('organisation','workforce') OR no scopes
  | "entity_scoped"      // scope_type = 'entity' (future — currently empty)
  | "all_library";       // all library sources regardless of scope

export interface ChunkRetrievalParams {
  organisationId: string;
  query: string;
  /** Pre-computed embedding vector for semantic search. null = lexical-only */
  queryEmbedding: number[] | null;
  scopeMode: ChunkScopeMode;
  /** Required for task_upload scope */
  taskId?: string | null;
  /** Required for specialist_scoped scope */
  specialistId?: string;
  /** Sensitivity levels to allow. Defaults to public+internal+confidential */
  allowedSensitivity?: SensitivityLevel[];
  /** Source IDs to skip (already claimed by higher priority layer) */
  excludeSourceIds?: string[];
  /** Maximum rows to return from DB (pre-ranking) */
  limit?: number;
  /** Semantic weight 0-1. Default 0.6 */
  semanticWeight?: number;
  /** Lexical weight 0-1. Default 0.4 */
  lexicalWeight?: number;
}

export interface RawChunk {
  id: string;
  knowledgeSourceId: string;
  sourceVersionId: string;
  chunkIndex: number;
  sectionTitle: string | null;
  pageNumber: number | null;
  headingPath: string | null;
  tokenCount: number | null;
  embeddingModel: string | null;
  contentHash: string | null;
  text: string;
  sourceTitle: string;
  authorityLevel: AuthorityLevel;
  sensitivityClassification: SensitivityLevel;
  sourceScope: string;
  taskId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  isCurrent: boolean;
  semanticScore: number;
  lexicalScore: number;
  baseScore: number;
}

const DEFAULT_ALLOWED_SENSITIVITY: SensitivityLevel[] = ["public", "internal", "confidential"];
const DEFAULT_LIMIT = 30;

// ─── Authority bonus applied to final score ────────────────────────────────────

const AUTHORITY_SCORE_BONUS: Record<string, number> = {
  mandatory:  0.30,
  primary:    0.20,
  supporting: 0.00,
  reference:  -0.05,
};

// ─── Main retrieval function ───────────────────────────────────────────────────

/**
 * Retrieve candidate chunks from the DB using hybrid lexical + semantic search.
 * Returns raw results sorted by baseScore DESC; caller applies priority ordering.
 */
export async function retrieveChunks(params: ChunkRetrievalParams): Promise<RawChunk[]> {
  const {
    organisationId,
    query,
    queryEmbedding,
    scopeMode,
    taskId,
    specialistId,
    allowedSensitivity = DEFAULT_ALLOWED_SENSITIVITY,
    excludeSourceIds = [],
    limit = DEFAULT_LIMIT,
    semanticWeight = 0.6,
    lexicalWeight = 0.4,
  } = params;

  // ── Build sensitivity list for SQL IN clause ──────────────────────────────
  const sensitivityList = allowedSensitivity.map(s => `'${s}'`).join(", ");

  // ── Build exclude list ────────────────────────────────────────────────────
  const excludeClause =
    excludeSourceIds.length > 0
      ? `AND ks.id NOT IN (${excludeSourceIds.map(id => `'${id.replace(/'/g, "''")}'`).join(", ")})`
      : "";

  // ── Build scope WHERE clause ───────────────────────────────────────────────
  const scopeClause = buildScopeClause(scopeMode, taskId ?? null, specialistId ?? null);

  // ── Format query embedding for pgvector ───────────────────────────────────
  const embeddingStr = queryEmbedding
    ? `'[${queryEmbedding.join(",")}]'`
    : null;

  // ── Escape query string for tsvector ─────────────────────────────────────
  const safeQuery = query.replace(/'/g, "''").slice(0, 500);

  // ── Build raw SQL ─────────────────────────────────────────────────────────
  // NOTE: lexical_search_vector is a STORED GENERATED tsvector column exposed
  // as text in Drizzle — we cast it to tsvector explicitly.
  const semanticExpr = embeddingStr
    ? `CASE WHEN kc.embedding IS NOT NULL THEN 1.0 - (kc.embedding <=> ${embeddingStr}::vector) ELSE 0.0 END`
    : `0.0`;

  const lexicalExpr =
    safeQuery.trim().length > 0
      ? `CASE WHEN kc.lexical_search_vector IS NOT NULL
              THEN ts_rank(kc.lexical_search_vector::tsvector,
                           plainto_tsquery('english', '${safeQuery}'))
              ELSE 0.0 END`
      : `0.0`;

  const finalScoreExpr = `(${semanticWeight} * ${semanticExpr}) + (${lexicalWeight} * ${lexicalExpr})`;

  const rawSql = `
    SELECT
      kc.id,
      kc.knowledge_source_id  AS "knowledgeSourceId",
      kc.source_version_id    AS "sourceVersionId",
      kc.chunk_index          AS "chunkIndex",
      kc.section_title        AS "sectionTitle",
      kc.page_number          AS "pageNumber",
      kc.heading_path         AS "headingPath",
      kc.token_count          AS "tokenCount",
      kc.embedding_model      AS "embeddingModel",
      kc.content_hash         AS "contentHash",
      kc.text,
      ks.title                AS "sourceTitle",
      ks.authority_level      AS "authorityLevel",
      ks.sensitivity_classification AS "sensitivityClassification",
      ks.source_scope         AS "sourceScope",
      ks.task_id              AS "taskId",
      ks.effective_from       AS "effectiveFrom",
      ks.effective_to         AS "effectiveTo",
      ks.is_current           AS "isCurrent",
      (${semanticExpr})       AS "semanticScore",
      (${lexicalExpr})        AS "lexicalScore",
      (${finalScoreExpr})     AS "baseScore"
    FROM knowledge_chunks kc
    JOIN knowledge_sources ks ON ks.id = kc.knowledge_source_id
    WHERE kc.organization_id = '${organisationId.replace(/'/g, "''")}'
      AND kc.deleted_at IS NULL
      AND ks.status = 'approved'
      AND ks.is_current = true
      AND (ks.effective_from IS NULL OR ks.effective_from <= NOW())
      AND (ks.effective_to IS NULL OR ks.effective_to >= NOW())
      AND ks.sensitivity_classification IN (${sensitivityList})
      ${excludeClause}
      ${scopeClause}
    ORDER BY "baseScore" DESC
    LIMIT ${limit}
  `;

  try {
    const result = await db.execute(sql.raw(rawSql));
    return (result.rows as RawChunk[]).map(row => ({
      ...row,
      semanticScore: Number(row.semanticScore ?? 0),
      lexicalScore: Number(row.lexicalScore ?? 0),
      baseScore: Number(row.baseScore ?? 0),
      tokenCount: row.tokenCount != null ? Number(row.tokenCount) : null,
    }));
  } catch (err) {
    // Graceful degradation — if pgvector is unavailable, fall back to lexical
    if (embeddingStr && String(err).includes("vector")) {
      return retrieveChunks({ ...params, queryEmbedding: null });
    }
    throw err;
  }
}

// ─── Scope clause builders ─────────────────────────────────────────────────────

function buildScopeClause(
  mode: ChunkScopeMode,
  taskId: string | null,
  specialistId: string | null,
): string {
  switch (mode) {
    case "task_upload": {
      if (!taskId) return "AND 1=0"; // no task = no results
      const safeId = taskId.replace(/'/g, "''");
      return `AND ks.source_scope = 'task' AND ks.task_id = '${safeId}'`;
    }

    case "specialist_scoped": {
      if (!specialistId) return "AND 1=0";
      const safeId = specialistId.replace(/'/g, "''");
      return `AND ks.source_scope = 'library'
              AND EXISTS (
                SELECT 1 FROM knowledge_source_scopes kss
                WHERE kss.knowledge_source_id = ks.id
                  AND kss.scope_type = 'specialist'
                  AND kss.scope_id = '${safeId}'
              )`;
    }

    case "org_library": {
      // Org/workforce-scoped sources, OR sources with no scope assignment
      // (no scope = implicitly org-wide)
      return `AND ks.source_scope = 'library'
              AND (
                EXISTS (
                  SELECT 1 FROM knowledge_source_scopes kss
                  WHERE kss.knowledge_source_id = ks.id
                    AND kss.scope_type IN ('organisation', 'workforce')
                )
                OR NOT EXISTS (
                  SELECT 1 FROM knowledge_source_scopes kss2
                  WHERE kss2.knowledge_source_id = ks.id
                )
              )`;
    }

    case "entity_scoped": {
      // Entity knowledge scope — defined for future use.
      // Currently no entity-scoped sources exist; returns empty.
      return `AND ks.source_scope = 'library'
              AND EXISTS (
                SELECT 1 FROM knowledge_source_scopes kss
                WHERE kss.knowledge_source_id = ks.id
                  AND kss.scope_type = 'entity'
              )`;
    }

    case "all_library": {
      return `AND ks.source_scope = 'library'`;
    }

    default:
      return "";
  }
}

// ─── Freshness bonus ──────────────────────────────────────────────────────────

/**
 * Compute a freshness bonus in [-0.10, +0.05] based on source effective date.
 * Documents < 30 days old: +0.05
 * Documents 30-365 days:   linear decay 0 → -0.05
 * Documents > 365 days:    -0.10
 */
export function computeFreshnessBonus(effectiveFrom: Date | null): number {
  if (!effectiveFrom) return 0;
  const ageMs = Date.now() - effectiveFrom.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < 30) return 0.05;
  if (ageDays < 365) {
    // linear decay from 0 to -0.05 over 30-365 days
    return -0.05 * ((ageDays - 30) / 335);
  }
  return -0.10;
}

// ─── Authority bonus ──────────────────────────────────────────────────────────

export function computeAuthorityBonus(authorityLevel: string): number {
  return AUTHORITY_SCORE_BONUS[authorityLevel] ?? 0;
}
