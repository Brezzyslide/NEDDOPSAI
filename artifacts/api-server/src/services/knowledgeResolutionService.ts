/**
 * Knowledge Resolution Service — Sprint 27.3
 *
 * The single authoritative service responsible for transforming a Work Package
 * Manifest into a rich Evidence Pack before specialist execution.
 *
 * Flow:
 *   Work Package Manifest
 *     ↓
 *   KnowledgeResolutionService.resolveEvidence()
 *     ↓  (calls hybridRetrievalService for each evidence category)
 *   Evidence Ranking & Deduplication
 *     ↓
 *   EvidencePack  ← replaces metadata-only manifest in specialist prompt
 *     ↓
 *   Specialist receives actual policy text, not just document titles
 *
 * Design constraints:
 *   - Never retrieves entire documents (chunk-limited per query)
 *   - Retrieves only relevant evidence (scored by hybrid lexical + semantic)
 *   - Respects organisation boundaries (tenant-isolated)
 *   - Respects approval status (approved + isCurrent only)
 *   - In-process cache per executionId prevents duplicate retrieval
 *   - All chunk text is treated as authoritative — never inverted or discarded
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import { knowledgeChunksTable, knowledgeSourcesTable, knowledgeSourceVersionsTable, retrievalAuditEventsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";

import { retrieveChunks, type RawChunk } from "./hybridRetrievalService.js";
import type { WorkPackageManifest } from "./workPackageService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";
import { OpenAIEmbeddingProvider } from "../lib/embeddings/openaiEmbeddingProvider.js";
import { EmbeddingError } from "../lib/embeddings/embeddingInterface.js";

// ─── Query embedding generator ────────────────────────────────────────────────

/**
 * Generate a query embedding for hybrid retrieval.
 *
 * Fails soft: returns null when OpenAI is unavailable or embedding fails.
 * KRS then falls back to lexical-only retrieval (hybridRetrievalService.ts:199-201).
 * Retrieval is never aborted due to an embedding failure.
 */
const _embeddingProvider = new OpenAIEmbeddingProvider();

async function generateQueryEmbedding(query: string): Promise<number[] | null> {
  if (!_embeddingProvider.isActive()) return null;
  try {
    const result = await _embeddingProvider.generateEmbedding(query.slice(0, 8000));
    return result.embedding;
  } catch (err) {
    if (err instanceof EmbeddingError && err.code === "PROVIDER_NOT_CONFIGURED") {
      return null; // graceful — OPENAI_API_KEY not set
    }
    // Log but never abort retrieval
    console.warn("[KRS] Query embedding failed — falling back to lexical-only retrieval:", {
      code:    err instanceof EmbeddingError ? err.code : "UNKNOWN",
      message: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return null;
  }
}

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface EvidenceChunk {
  /** Unique chunk ID for audit and citation tracking */
  chunkId: string;
  /** Parent knowledge source ID */
  sourceId: string;
  /**
   * knowledge_source_versions.id at retrieval time.
   * Required for durable evidence provenance (Sprint 29K.2).
   * May be null for task-upload chunks whose version is not separately tracked.
   */
  sourceVersionId: string | null;
  /** Human-readable source title */
  sourceTitle: string;
  /** Version label at time of retrieval (e.g. "v3") */
  versionLabel: string | null;
  /** Drizzle sourceType: "policy" | "legislation" | "procedure" | etc. */
  sourceType: string;
  /** Authority level of the source: "mandatory" | "primary" | "supporting" | "reference" */
  authorityLevel: string;
  /** Section heading within the document (null if not parsed) */
  sectionTitle: string | null;
  /** Page number within the original document (null if not applicable) */
  pageNumber: number | null;
  /** Extracted text content of this chunk */
  text: string;
  /** Retrieval confidence score 0–1 */
  confidence: number;
  /** Human-readable citation string for the specialist to use */
  citation: string;
  /** Why this chunk was selected (selection category) */
  selectionReason: string;
}

export interface EvidencePackMetrics {
  /** Number of distinct retrieval queries executed */
  queryCount: number;
  /** Total candidate chunks returned before filtering */
  totalCandidates: number;
  /** Final selected chunks after deduplication + ranking */
  selectedChunks: number;
  /** Whether a cache hit served this pack */
  cacheHit: boolean;
  /** Wall-clock milliseconds for the full resolution */
  retrievalMs: number;
  /** Whether a query embedding was generated and used for semantic retrieval */
  embeddingUsed: boolean;
  /** Wall-clock milliseconds spent generating the query embedding (0 if not used) */
  embeddingMs: number;
}

export interface EvidencePack {
  /** Matches the manifest executionId for correlation */
  executionId: string;
  organisationId: string;
  resolvedAt: Date;
  /** All resolved evidence chunks, ordered by confidence DESC */
  chunks: EvidenceChunk[];
  /** Deduplicated source IDs contributing to this pack */
  sourceIds: string[];
  /** Chunks grouped by sourceType for structured prompt generation */
  citationsByType: Record<string, EvidenceChunk[]>;
  totalChunks: number;
  avgConfidence: number;
  retrievalMetrics: EvidencePackMetrics;
}

export interface KnowledgeResolutionInput {
  organisationId: string;
  specialistCode: string;
  blueprint: WorkBlueprint | null;
  workPackage: WorkPackageManifest;
  userRequest: string;
}

// ─── In-process execution cache ───────────────────────────────────────────────

const _packCache = new Map<string, EvidencePack>();

/** Maximum chunks per evidence category to keep prompt size bounded */
const MAX_LIBRARY_CHUNKS  = 20;
const MAX_UPLOAD_CHUNKS   = 10;
const MIN_CONFIDENCE      = 0.05; // discard near-zero relevance chunks

// ─── Source-type display labels ───────────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<string, string> = {
  policy:               "Organisation Policy",
  legislation:          "Legislation",
  legislation_reference:"Legislation Reference",
  procedure:            "Organisation Procedure",
  standards:            "Standards & Guidelines",
  template:             "Organisation Template",
  reference:            "Reference Material",
  risk_assessment:      "Risk Assessment",
  framework:            "Framework",
  guideline:            "Guideline",
  form:                 "Form",
  other:                "Other Document",
};

function sourceTypeLabel(t: string): string {
  return SOURCE_TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Citation builder ─────────────────────────────────────────────────────────

function buildCitation(chunk: RawChunk, versionLabel: string | null): string {
  const parts: string[] = [chunk.sourceTitle];
  if (versionLabel) parts.push(versionLabel);
  if (chunk.sectionTitle) parts.push(chunk.sectionTitle);
  if (chunk.pageNumber) parts.push(`p.${chunk.pageNumber}`);
  return parts.join(", ");
}

// ─── Raw chunk → EvidenceChunk mapper ────────────────────────────────────────

function mapRawChunk(
  chunk: RawChunk,
  versionLabel: string | null,
  selectionReason: string,
): EvidenceChunk {
  const confidence = Math.max(0, Math.min(1, chunk.baseScore));
  return {
    chunkId:         chunk.id,
    sourceId:        chunk.knowledgeSourceId,
    sourceVersionId: chunk.sourceVersionId ?? null,
    sourceTitle:     chunk.sourceTitle,
    versionLabel,
    sourceType:      chunk.sourceScope === "task" ? "task_upload" : "library",
    authorityLevel:  chunk.authorityLevel,
    sectionTitle:    chunk.sectionTitle,
    pageNumber:      chunk.pageNumber,
    text:            chunk.text,
    confidence,
    citation:        buildCitation(chunk, versionLabel),
    selectionReason,
  };
}

// ─── Task-upload chunk retrieval ──────────────────────────────────────────────
// hybridRetrievalService task_upload scope requires a taskId which is not
// always available in the pipeline context. We query by source IDs directly.

interface TaskUploadChunkRow {
  id: string;
  knowledgeSourceId: string;
  sourceVersionId: string;
  chunkIndex: number;
  sectionTitle: string | null;
  pageNumber: number | null;
  text: string;
  tokenCount: number | null;
}

async function retrieveTaskUploadChunks(
  organisationId: string,
  sourceIds: string[],
  limit: number,
): Promise<TaskUploadChunkRow[]> {
  if (sourceIds.length === 0) return [];

  return db
    .select({
      id:               knowledgeChunksTable.id,
      knowledgeSourceId: knowledgeChunksTable.knowledgeSourceId,
      sourceVersionId:  knowledgeChunksTable.sourceVersionId,
      chunkIndex:       knowledgeChunksTable.chunkIndex,
      sectionTitle:     knowledgeChunksTable.sectionTitle,
      pageNumber:       knowledgeChunksTable.pageNumber,
      text:             knowledgeChunksTable.text,
      tokenCount:       knowledgeChunksTable.tokenCount,
    })
    .from(knowledgeChunksTable)
    .where(
      and(
        eq(knowledgeChunksTable.organizationId, organisationId),
        inArray(knowledgeChunksTable.knowledgeSourceId, sourceIds),
      )
    )
    .orderBy(knowledgeChunksTable.chunkIndex)
    .limit(limit);
}

// ─── Version label lookup ─────────────────────────────────────────────────────

async function getVersionLabels(
  sourceVersionIds: string[],
  organisationId: string,
): Promise<Map<string, string>> {
  if (sourceVersionIds.length === 0) return new Map();

  const rows = await db
    .select({
      id:           knowledgeSourceVersionsTable.id,
      versionLabel: knowledgeSourceVersionsTable.versionLabel,
    })
    .from(knowledgeSourceVersionsTable)
    .where(
      and(
        inArray(knowledgeSourceVersionsTable.id, sourceVersionIds),
        eq(knowledgeSourceVersionsTable.organizationId, organisationId),
      )
    )
    .limit(500); // safety cap; batch of version IDs is always bounded by MAX_LIBRARY_CHUNKS

  return new Map(rows.map(r => [r.id, r.versionLabel]));
}

// ─── Source type enrichment ───────────────────────────────────────────────────

async function getSourceTypes(
  sourceIds: string[],
  organisationId: string,
): Promise<Map<string, string>> {
  if (sourceIds.length === 0) return new Map();

  const rows = await db
    .select({
      id:         knowledgeSourcesTable.id,
      sourceType: knowledgeSourcesTable.sourceType,
    })
    .from(knowledgeSourcesTable)
    .where(
      and(
        inArray(knowledgeSourcesTable.id, sourceIds),
        eq(knowledgeSourcesTable.organizationId, organisationId),
      )
    )
    .limit(200); // safety cap; source IDs are always bounded by MAX_LIBRARY_CHUNKS

  return new Map(rows.map(r => [r.id, r.sourceType]));
}

// ─── Pack builder ─────────────────────────────────────────────────────────────

function buildPack(
  executionId: string,
  organisationId: string,
  chunks: EvidenceChunk[],
  metrics: EvidencePackMetrics,
): EvidencePack {
  const byType: Record<string, EvidenceChunk[]> = {};
  for (const c of chunks) {
    const key = c.sourceType;
    if (!byType[key]) byType[key] = [];
    byType[key].push(c);
  }

  const sourceIds = [...new Set(chunks.map(c => c.sourceId))];
  const avgConfidence = chunks.length > 0
    ? chunks.reduce((s, c) => s + c.confidence, 0) / chunks.length
    : 0;

  return {
    executionId,
    organisationId,
    resolvedAt: new Date(),
    chunks,
    sourceIds,
    citationsByType: byType,
    totalChunks: chunks.length,
    avgConfidence,
    retrievalMetrics: metrics,
  };
}

// ─── Main resolution function ─────────────────────────────────────────────────

/**
 * Resolve knowledge evidence for specialist execution.
 *
 * Returns an EvidencePack containing relevant chunk text, citations,
 * source metadata, and confidence scores.
 *
 * Results are cached per executionId to avoid duplicate retrieval when
 * the pipeline is called multiple times for the same manifest.
 */
export async function resolveEvidence(
  input: KnowledgeResolutionInput,
): Promise<EvidencePack> {
  const { organisationId, workPackage, userRequest } = input;
  const executionId = workPackage.executionId;

  // ── Cache check ────────────────────────────────────────────────────────────
  const cached = _packCache.get(executionId);
  if (cached) {
    return { ...cached, retrievalMetrics: { ...cached.retrievalMetrics, cacheHit: true } };
  }

  const startMs = Date.now();
  let queryCount = 0;
  let totalCandidates = 0;
  const seenChunkIds = new Set<string>();
  const allEvidenceChunks: EvidenceChunk[] = [];

  // ── Generate query embedding for hybrid retrieval ──────────────────────────
  // Generated once and reused for all retrieval calls in this execution.
  // Fails soft: null = lexical-only fallback; retrieval is never aborted.
  const embeddingStartMs = Date.now();
  const queryEmbedding = await generateQueryEmbedding(userRequest);
  const embeddingMs = Date.now() - embeddingStartMs;

  // ── Step 1: Organisation Library evidence via hybrid retrieval ─────────────
  // hybridRetrievalService filters: status=approved, isCurrent=true, scope=org_library
  //
  // NOTE: We always run the org-library query for every task execution.
  // The previous conditional gate (`organisationLibrarySources.length > 0 ||
  // requiredLibraryKnowledge.length`) silently skipped library evidence when a
  // blueprint with an empty requiredLibraryKnowledge[] was selected, even when
  // the user's request explicitly named a policy that existed in the library.
  // The hybrid retrieval already applies its own approved/current/org-library
  // filters, so running it unconditionally is safe — it returns nothing when
  // no relevant documents exist.
  {
    queryCount++;
    const libraryRaw = await retrieveChunks({
      organisationId,
      query:          userRequest,
      queryEmbedding,
      scopeMode:      "org_library",
      limit:          MAX_LIBRARY_CHUNKS,
    });
    totalCandidates += libraryRaw.length;

    // Collect version labels in one batch
    const versionIds = [...new Set(libraryRaw.map(c => c.sourceVersionId))];
    const versionLabels = await getVersionLabels(versionIds, organisationId);

    for (const raw of libraryRaw) {
      if (raw.baseScore < MIN_CONFIDENCE) continue;
      if (seenChunkIds.has(raw.id)) continue;
      seenChunkIds.add(raw.id);

      // Determine authority-weighted sourceType for grouping
      const vLabel = versionLabels.get(raw.sourceVersionId) ?? null;
      const chunk = mapRawChunk(raw, vLabel, "organisation_library");

      // Re-map sourceType from the source's actual type (hybridRetrievalService
      // returns sourceScope, not sourceType; we need the actual type for grouping)
      // We'll enrich below after the source type lookup.
      allEvidenceChunks.push(chunk);
    }

    // Enrich sourceType using a single batch query
    if (allEvidenceChunks.length > 0) {
      const librarySourceIds = [...new Set(allEvidenceChunks.map(c => c.sourceId))];
      const typeMap = await getSourceTypes(librarySourceIds, organisationId);
      for (const c of allEvidenceChunks) {
        const st = typeMap.get(c.sourceId);
        if (st) c.sourceType = st;
      }
    }
  }

  // ── Step 2: Specialist-scoped knowledge ────────────────────────────────────
  if (input.specialistCode && workPackage.specialistMemories.length > 0) {
    queryCount++;
    const specialistRaw = await retrieveChunks({
      organisationId,
      query:          userRequest,
      queryEmbedding,
      scopeMode:      "specialist_scoped",
      specialistId:   input.specialistCode,
      limit:          10,
      excludeSourceIds: allEvidenceChunks.map(c => c.sourceId),
    });
    totalCandidates += specialistRaw.length;

    const versionIds = [...new Set(specialistRaw.map(c => c.sourceVersionId))];
    const versionLabels = await getVersionLabels(versionIds, organisationId);

    for (const raw of specialistRaw) {
      if (raw.baseScore < MIN_CONFIDENCE) continue;
      if (seenChunkIds.has(raw.id)) continue;
      seenChunkIds.add(raw.id);
      const vLabel = versionLabels.get(raw.sourceVersionId) ?? null;
      allEvidenceChunks.push(mapRawChunk(raw, vLabel, "specialist_knowledge"));
    }
  }

  // ── Step 3: Task upload chunks (direct query by source ID) ─────────────────
  if (workPackage.taskUploads.length > 0) {
    queryCount++;
    const uploadSourceIds = workPackage.taskUploads.map(u => u.sourceId);
    const uploadRows = await retrieveTaskUploadChunks(organisationId, uploadSourceIds, MAX_UPLOAD_CHUNKS);
    totalCandidates += uploadRows.length;

    // Get source titles from the manifest (already resolved)
    const titleMap = new Map(workPackage.taskUploads.map(u => [u.sourceId, u.title]));

    // Get version labels for upload chunks
    const uploadVersionIds = [...new Set(uploadRows.map(r => r.sourceVersionId))];
    const versionLabels = await getVersionLabels(uploadVersionIds, organisationId);

    for (const row of uploadRows) {
      if (seenChunkIds.has(row.id)) continue;
      seenChunkIds.add(row.id);
      const vLabel = versionLabels.get(row.sourceVersionId) ?? null;
      const citation = [
        titleMap.get(row.knowledgeSourceId) ?? "Task Upload",
        vLabel,
        row.sectionTitle,
        row.pageNumber ? `p.${row.pageNumber}` : null,
      ].filter(Boolean).join(", ");

      allEvidenceChunks.push({
        chunkId:         row.id,
        sourceId:        row.knowledgeSourceId,
        sourceVersionId: row.sourceVersionId ?? null,
        sourceTitle:     titleMap.get(row.knowledgeSourceId) ?? "Task Upload",
        versionLabel:    vLabel,
        sourceType:      "task_upload",
        authorityLevel:  "reference",
        sectionTitle:    row.sectionTitle,
        pageNumber:      row.pageNumber,
        text:            row.text,
        confidence:      0.8, // task uploads are always directly relevant
        citation,
        selectionReason: "task_upload",
      });
    }
  }

  // ── Step 4: Sort all chunks — authority > confidence, then by type priority ──
  const TYPE_PRIORITY: Record<string, number> = {
    legislation: 0,
    legislation_reference: 1,
    policy: 2,
    procedure: 3,
    standards: 4,
    template: 5,
    task_upload: 6,
    reference: 7,
  };

  allEvidenceChunks.sort((a, b) => {
    const typePriority = (TYPE_PRIORITY[a.sourceType] ?? 8) - (TYPE_PRIORITY[b.sourceType] ?? 8);
    if (typePriority !== 0) return typePriority;
    return b.confidence - a.confidence;
  });

  const metrics: EvidencePackMetrics = {
    queryCount,
    totalCandidates,
    selectedChunks: allEvidenceChunks.length,
    cacheHit: false,
    retrievalMs: Date.now() - startMs,
    embeddingUsed: queryEmbedding !== null,
    embeddingMs,
  };

  const pack = buildPack(executionId, organisationId, allEvidenceChunks, metrics);
  _packCache.set(executionId, pack);

  // Sprint 29I (D2): Write retrieval audit row for this physical retrieval.
  // Cache hits return above — this code is reached only once per executionId.
  // Fire-and-forget: audit failure must NEVER abort specialist execution.
  writeKrsRetrievalAudit(pack, input.specialistCode).catch(err => {
    const meta: Record<string, unknown> = {
      source:              "writeKrsRetrievalAudit",
      executionId:         pack.executionId,
      specialistCode:      input.specialistCode,
      chunkCount:          pack.totalChunks,
    };
    if (err instanceof Error) {
      meta.errorMessage = err.message;
      meta.pgCode       = (err as any).code;
      meta.pgDetail     = (err as any).detail;
      meta.pgConstraint = (err as any).constraint;
    }
    console.warn("[KRS] writeKrsRetrievalAudit failed (non-blocking):", meta);
  });

  return pack;
}

// ─── KRS Retrieval Audit ─────────────────────────────────────────────────────

/**
 * Sprint 29I (D2): Write one retrieval_audit_events row for a physical KRS retrieval.
 *
 * Called immediately after an EvidencePack is built and cached. NOT called on
 * cache hits — the cache path returns before reaching this code, so one audit
 * row exists per physical retrieval and zero duplicate rows exist per cache hit.
 *
 * Does not persist raw chunk text, private prompts, or sensitive user data.
 * Only identifiers, scores, and structural metadata are recorded.
 */
async function writeKrsRetrievalAudit(
  pack: EvidencePack,
  specialistCode: string,
): Promise<void> {
  const id        = randomUUID();
  const chunkIds  = pack.chunks.map(c => c.chunkId).filter(Boolean);
  const scores    = pack.chunks.map(c => c.confidence);
  const topScore  = scores.length > 0 ? Math.max(...scores)                                 : 0;
  const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length  : 0;

  await db.insert(retrievalAuditEventsTable).values({
    id,
    organizationId:      pack.organisationId,
    specialistId:        specialistCode,
    executionId:         pack.executionId,
    entityId:            undefined,
    sourceIds:           pack.sourceIds            as unknown as any,
    chunkIds:            chunkIds                  as unknown as any,
    memoryIds:           []                        as unknown as any,
    taskUploadIds:       []                        as unknown as any,
    retrievalMethod:     pack.retrievalMetrics.embeddingUsed ? "hybrid" : "lexical",
    scoreMetadata:       { topScore, meanScore }   as unknown as any,
    rankingDetails:      []                        as unknown as any,
    reasonSelected:      {}                        as unknown as any,
    reasonRejected:      {}                        as unknown as any,
    conflictCount:       0,
    tokenCount:          0, // EvidenceChunk interface does not expose tokenCount
    retrievalDurationMs: pack.retrievalMetrics.retrievalMs,
  });
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Invalidate the cached evidence pack for a specific execution.
 * Called when knowledge sources are updated mid-execution (rare).
 */
export function invalidateEvidenceCache(executionId: string): void {
  _packCache.delete(executionId);
}

/**
 * Clear the entire evidence cache.
 * Used in tests and during graceful shutdown.
 */
export function clearEvidenceCache(): void {
  _packCache.clear();
}

// ─── Prompt section builder ───────────────────────────────────────────────────

/**
 * Convert an EvidencePack into a formatted prompt section ready for specialist
 * consumption. Groups chunks by source type and formats citations.
 *
 * Produces:
 *   === AUTHORITATIVE EVIDENCE ===
 *   --- Organisation Policy ---
 *   [Policy Name, v2, Section 4]
 *   <chunk text>
 *   ...
 */
export function buildEvidenceSection(pack: EvidencePack): string {
  if (pack.totalChunks === 0) return "";

  const sections: string[] = [];

  // Build in type-priority order
  const orderedTypes = Object.keys(pack.citationsByType).sort((a, b) => {
    const TYPE_PRIORITY: Record<string, number> = {
      legislation: 0,
      legislation_reference: 1,
      policy: 2,
      procedure: 3,
      standards: 4,
      template: 5,
      task_upload: 6,
    };
    return (TYPE_PRIORITY[a] ?? 8) - (TYPE_PRIORITY[b] ?? 8);
  });

  for (const sourceType of orderedTypes) {
    const chunks = pack.citationsByType[sourceType];
    if (!chunks || chunks.length === 0) continue;

    const label = sourceTypeLabel(sourceType);
    const chunkBlocks = chunks.map(c => {
      const locParts = [c.sectionTitle, c.pageNumber != null ? `p.${c.pageNumber}` : null].filter(Boolean);
      const locLine = locParts.length > 0 ? ` (${locParts.join(", ")})` : "";
      return `[${c.citation}]${locLine}\n${c.text}`;
    });

    sections.push(`--- ${label} ---\n${chunkBlocks.join("\n\n")}`);
  }

  return `=== AUTHORITATIVE EVIDENCE ===\n${sections.join("\n\n")}`;
}

/**
 * Resolve evidence for conversation-triggered specialist execution.
 *
 * Sprint 29C: gives conversation executions the same evidence model as task
 * executions. Both paths now receive an EvidencePack before the AI call.
 *
 * Uses `conversationId` as the cache key so repeated calls for the same
 * conversation turn do not incur duplicate retrieval cost.
 *
 * This function is the conversation-path entry point to the same underlying
 * retrieval infrastructure used by `resolveEvidence`. It does NOT duplicate
 * retrieval logic — it shares `retrieveChunks`, `getVersionLabels`,
 * `getSourceTypes`, `mapRawChunk`, and `buildPack`.
 */
export async function resolveConversationEvidence(input: {
  organisationId: string;
  specialistCode: string;
  query: string;
  /** Used as cache key — unique per conversation turn */
  conversationId?: string;
}): Promise<EvidencePack> {
  const { organisationId, specialistCode, query } = input;
  const cacheKey = `conv:${input.conversationId ?? "unknown"}:${specialistCode}`;

  const cached = _packCache.get(cacheKey);
  if (cached) {
    return { ...cached, retrievalMetrics: { ...cached.retrievalMetrics, cacheHit: true } };
  }

  const startMs = Date.now();
  let queryCount = 0;
  let totalCandidates = 0;
  const seenChunkIds = new Set<string>();
  const allEvidenceChunks: EvidenceChunk[] = [];

  // ── Generate query embedding (shared across all retrieval calls) ───────────
  const convEmbeddingStartMs = Date.now();
  const convQueryEmbedding = await generateQueryEmbedding(query);
  const convEmbeddingMs = Date.now() - convEmbeddingStartMs;

  // ── Step 1: Organisation Library — full library search using the conversation query ─
  // Unlike task execution, conversation evidence always attempts library retrieval
  // (no gate condition needed — the query drives relevance scoring).
  queryCount++;
  const libraryRaw = await retrieveChunks({
    organisationId,
    query,
    queryEmbedding: convQueryEmbedding,
    scopeMode: "org_library",
    limit: MAX_LIBRARY_CHUNKS,
  });
  totalCandidates += libraryRaw.length;

  const libVersionIds = [...new Set(libraryRaw.map(c => c.sourceVersionId))];
  const libVersionLabels = await getVersionLabels(libVersionIds, organisationId);

  for (const raw of libraryRaw) {
    if (raw.baseScore < MIN_CONFIDENCE) continue;
    if (seenChunkIds.has(raw.id)) continue;
    seenChunkIds.add(raw.id);
    allEvidenceChunks.push(mapRawChunk(raw, libVersionLabels.get(raw.sourceVersionId) ?? null, "organisation_library"));
  }

  // Enrich sourceType in a single batch query
  if (allEvidenceChunks.length > 0) {
    const sourceIds = [...new Set(allEvidenceChunks.map(c => c.sourceId))];
    const typeMap = await getSourceTypes(sourceIds, organisationId);
    for (const c of allEvidenceChunks) {
      const st = typeMap.get(c.sourceId);
      if (st) c.sourceType = st;
    }
  }

  // ── Step 2: Specialist-scoped knowledge ────────────────────────────────────
  if (specialistCode) {
    queryCount++;
    const specialistRaw = await retrieveChunks({
      organisationId,
      query,
      queryEmbedding: convQueryEmbedding,
      scopeMode: "specialist_scoped",
      specialistId: specialistCode,
      limit: 10,
      excludeSourceIds: allEvidenceChunks.map(c => c.sourceId),
    });
    totalCandidates += specialistRaw.length;

    const spVersionIds = [...new Set(specialistRaw.map(c => c.sourceVersionId))];
    const spVersionLabels = await getVersionLabels(spVersionIds, organisationId);

    for (const raw of specialistRaw) {
      if (raw.baseScore < MIN_CONFIDENCE) continue;
      if (seenChunkIds.has(raw.id)) continue;
      seenChunkIds.add(raw.id);
      allEvidenceChunks.push(mapRawChunk(raw, spVersionLabels.get(raw.sourceVersionId) ?? null, "specialist_knowledge"));
    }
  }

  const retrievalMs = Date.now() - startMs;
  const sorted = allEvidenceChunks.sort((a, b) => b.confidence - a.confidence);

  const pack = buildPack(cacheKey, organisationId, sorted, {
    queryCount,
    totalCandidates,
    selectedChunks: sorted.length,
    cacheHit: false,
    retrievalMs,
    embeddingUsed: convQueryEmbedding !== null,
    embeddingMs: convEmbeddingMs,
  });

  _packCache.set(cacheKey, pack);
  return pack;
}

/**
 * Build a citations summary for storage in completed work evidence provenance.
 */
export function buildCitationSummary(pack: EvidencePack): Record<string, unknown>[] {
  return pack.chunks.map(c => ({
    chunkId:       c.chunkId,
    sourceId:      c.sourceId,
    sourceTitle:   c.sourceTitle,
    versionLabel:  c.versionLabel,
    sourceType:    c.sourceType,
    authorityLevel: c.authorityLevel,
    citation:      c.citation,
    confidence:    c.confidence,
  }));
}
