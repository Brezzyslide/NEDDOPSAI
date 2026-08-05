/**
 * Organisation Library Presence Service (Sprint 28.1)
 *
 * Fast, lightweight inspection of the Organisation Library.
 * Determines whether a document exists and whether specialists can currently use it.
 *
 * NOT semantic retrieval.
 * NOT chunk retrieval.
 * NOT KnowledgeResolutionService.
 *
 * It only answers:
 *   • Does the document exist?
 *   • Can specialists currently use it?
 *
 * Target: <100ms. Results are cached for 30 seconds per (org, terms) pair.
 */

import { db, knowledgeSourcesTable, knowledgeChunksTable, knowledgeSourceVersionsTable } from "@workspace/db";
import { eq, and, or, isNull, inArray, ilike } from "drizzle-orm";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LibraryPresenceMatch {
  /** knowledge_sources.id */
  sourceId: string;
  /** Human-readable document title */
  title: string;
  /** e.g. "policy", "procedure", "care_plan" */
  sourceType: string;
  /** Version label from the source row (null if unversioned) */
  version: string | null;
  /** true when status === "approved" and approvedByUserId is set */
  approved: boolean;
  /** true when at least one knowledge_chunk row exists for this source */
  indexed: boolean;
  /** true when approved AND indexed AND isCurrent */
  retrievable: boolean;
  /** knowledge_sources.status — uploaded | processing | review_required | approved | failed | revoked | superseded | archived */
  status: string;
  /** ingestion_status from the current knowledge_source_versions row — pending | processing | complete | failed | null */
  ingestionStatus: string | null;
  /** 0.0–1.0 title-match confidence */
  confidence: number;
}

export interface LibraryPresenceSummary {
  /** Best match was an exact or near-exact title */
  exactMatch: boolean;
  /** Best match was a partial title or keyword match */
  partialMatch: boolean;
  /** At least one match is indexed (has chunks) */
  searchable: boolean;
  /** At least one match is fully retrievable by specialists */
  usable: boolean;
  /** Human-readable explanation of the result state */
  reason: string;
}

export interface LibraryPresenceResult {
  searched: true;
  matches: LibraryPresenceMatch[];
  summary: LibraryPresenceSummary;
}

// ─── Internal constants ───────────────────────────────────────────────────────

/** Cache TTL in milliseconds */
const CACHE_TTL_MS = 30_000;

/** Maximum candidate sources to fetch from DB */
const MAX_SOURCES = 20;

/** Sample ceiling for chunk-existence check (we only care whether any chunks exist) */
const MAX_CHUNKS = 500;

/** Maximum version rows to fetch */
const MAX_VERSIONS = 50;

/** Maximum matches returned to callers */
const MAX_MATCHES = 10;

/** Confidence floor — results below this are discarded as noise */
const MIN_CONFIDENCE = 0.30;

// ─── Document-type synonym map ────────────────────────────────────────────────
//
// Broadens ILIKE title searches across natural name variants:
//   "Medication Management Policy" also searches "… Procedure", "… SOP", etc.

const TYPE_SYNONYMS: Record<string, string[]> = {
  policy:    ["procedure", "sop", "standard", "guideline", "protocol", "manual"],
  procedure: ["policy", "sop", "standard", "protocol", "process"],
  sop:       ["policy", "procedure", "standard", "protocol"],
  guideline: ["policy", "procedure", "standard"],
  standard:  ["policy", "procedure", "guideline", "framework"],
  protocol:  ["policy", "procedure", "standard", "sop"],
  manual:    ["policy", "procedure", "handbook", "guide"],
  framework: ["policy", "standard", "guideline"],
  handbook:  ["manual", "guide", "policy"],
};

// ─── In-process TTL cache ─────────────────────────────────────────────────────

const presenceCache = new Map<string, { result: LibraryPresenceResult; expiresAt: number }>();

function getCached(key: string): LibraryPresenceResult | null {
  const entry = presenceCache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.result;
  return null;
}

function setCached(key: string, result: LibraryPresenceResult): void {
  presenceCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Exported for tests — clears all cached entries */
export function _clearPresenceCache(): void {
  presenceCache.clear();
}

// ─── Search term expansion ────────────────────────────────────────────────────

/**
 * Expand the caller's search terms by substituting document-type synonyms.
 *
 * "Medication Management Policy" → also yields:
 *   "medication management procedure", "medication management sop", etc.
 *
 * This broadens the ILIKE queries without requiring semantic search.
 */
function expandSearchTerms(terms: string[]): string[] {
  const expanded = new Set<string>();
  for (const term of terms) {
    const lower = term.toLowerCase().trim();
    expanded.add(lower);
    const words = lower.split(/\s+/);
    for (const word of words) {
      const synonyms = TYPE_SYNONYMS[word];
      if (!synonyms) continue;
      for (const syn of synonyms) {
        // Replace just the type word with its synonym, keeping the rest of the phrase
        expanded.add(lower.replace(word, syn));
      }
    }
  }
  return Array.from(expanded);
}

// ─── Confidence scoring ───────────────────────────────────────────────────────

/**
 * Score how closely a source title matches any of the original search terms.
 *
 * Scoring bands:
 *   1.00  exact full-title match
 *   0.90  full search phrase is contained in the title
 *   0.85  all search words found in the title (any order)
 *   0.65  ≥60% of search words found in the title
 *   0.45  ≥30% of search words found in the title
 *   0.00  below threshold (caller discards)
 *
 * "Meaningful words" are tokens longer than 2 characters; short words like
 * "of", "in", "the" are excluded from word-overlap scoring.
 */
function scoreMatch(sourceTitle: string, originalTerms: string[]): number {
  const titleLower = sourceTitle.toLowerCase().trim();
  let best = 0;

  for (const term of originalTerms) {
    const termLower = term.toLowerCase().trim();

    // 1. Exact full-title match
    if (titleLower === termLower) return 1.0;

    // 2. Full search phrase contained in the title
    if (titleLower.includes(termLower)) {
      best = Math.max(best, 0.90);
      continue;
    }

    // 3. Word-overlap — only meaningful tokens (length > 2)
    const termWords = termLower.split(/\s+/).filter(w => w.length > 2);
    if (termWords.length === 0) continue;

    const titleTokens = new Set(
      titleLower.split(/[\s\-_/,.()+[\]]+/).filter(w => w.length > 0),
    );

    const matchedCount = termWords.filter(
      w => titleTokens.has(w) || titleLower.includes(w),
    ).length;

    const ratio = matchedCount / termWords.length;

    if      (ratio >= 1.0) best = Math.max(best, 0.85);
    else if (ratio >= 0.6) best = Math.max(best, 0.65);
    else if (ratio >= 0.3) best = Math.max(best, 0.45);
  }

  return best;
}

// ─── Result builders ──────────────────────────────────────────────────────────

function emptyResult(reason: string): LibraryPresenceResult {
  return {
    searched: true,
    matches: [],
    summary: { exactMatch: false, partialMatch: false, searchable: false, usable: false, reason },
  };
}

function buildSummary(matches: LibraryPresenceMatch[]): LibraryPresenceSummary {
  if (matches.length === 0) {
    return {
      exactMatch: false, partialMatch: false, searchable: false, usable: false,
      reason: "No matching documents found in the Organisation Library",
    };
  }

  const top        = matches[0];
  const exactMatch  = top.confidence >= 0.90;
  const partialMatch = !exactMatch && top.confidence >= 0.45;
  const searchable   = matches.some(m => m.indexed);
  const usable       = matches.some(m => m.retrievable);

  let reason: string;
  if (usable) {
    reason = exactMatch
      ? `Found "${top.title}" — approved and ready for specialist use`
      : `Found partial match "${top.title}" — approved and ready for specialist use`;
  } else if (searchable) {
    reason = `Found "${top.title}" — indexed but not yet approved`;
  } else if (matches.some(m => m.approved)) {
    reason = `Found "${top.title}" — approved but not yet indexed (ingestion pending)`;
  } else if (matches.some(m => m.status === "uploaded" || m.status === "processing")) {
    reason = `Found "${top.title}" — pending ingestion, not yet usable by specialists`;
  } else if (matches.some(m => m.status === "superseded")) {
    reason = `Found "${top.title}" — superseded; no current approved version available`;
  } else if (matches.some(m => m.status === "archived")) {
    reason = `Found "${top.title}" — archived and not available for use`;
  } else {
    reason = `Found "${top.title}" — not currently usable (status: ${top.status})`;
  }

  return { exactMatch, partialMatch, searchable, usable, reason };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether documents matching the given search terms exist in the
 * Organisation Library and whether specialists can currently use them.
 *
 * Three DB queries are performed (sources → chunk existence → version status).
 * Results are cached for 30 seconds per (organisationId, searchTerms) pair.
 *
 * @param organisationId  Tenant organisation ID.
 * @param searchTerms     Title fragments, document names, or keywords.
 *                        e.g. ["Medication Management Policy"]
 *                        e.g. ["Medication Policy", "Medication SOP"]
 */
export async function checkOrganisationLibraryPresence(
  organisationId: string,
  searchTerms: string[],
): Promise<LibraryPresenceResult> {
  // Guard: both arguments required
  if (!organisationId || searchTerms.length === 0) {
    return emptyResult("No search terms provided");
  }

  // Cache lookup — key is stable regardless of term ordering
  const cacheKey = `${organisationId}::${[...searchTerms].sort().join("|")}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // ── Query 1: candidate sources by ILIKE title match ───────────────────────
  const expandedTerms = expandSearchTerms(searchTerms);
  const ilikeConditions = expandedTerms.map(t =>
    ilike(knowledgeSourcesTable.title, `%${t}%`),
  );

  const sources = await db
    .select({
      id:               knowledgeSourcesTable.id,
      title:            knowledgeSourcesTable.title,
      sourceType:       knowledgeSourcesTable.sourceType,
      versionLabel:     knowledgeSourcesTable.versionLabel,
      status:           knowledgeSourcesTable.status,
      approvedByUserId: knowledgeSourcesTable.approvedByUserId,
      isCurrent:        knowledgeSourcesTable.isCurrent,
      deletedAt:        knowledgeSourcesTable.deletedAt,
    })
    .from(knowledgeSourcesTable)
    .where(
      and(
        eq(knowledgeSourcesTable.organizationId, organisationId),
        isNull(knowledgeSourcesTable.deletedAt),
        or(...ilikeConditions),
      ),
    )
    .limit(MAX_SOURCES);

  if (sources.length === 0) {
    const result = emptyResult("No matching documents found in the Organisation Library");
    setCached(cacheKey, result);
    return result;
  }

  const sourceIds = sources.map(s => s.id);

  // ── Query 2: chunk-existence check (determines "indexed") ─────────────────
  // Fetch a sample of chunk rows — we only need to know which source IDs
  // have at least one live chunk, not the chunk content.
  const chunkRows = await db
    .select({ knowledgeSourceId: knowledgeChunksTable.knowledgeSourceId })
    .from(knowledgeChunksTable)
    .where(
      and(
        inArray(knowledgeChunksTable.knowledgeSourceId, sourceIds),
        isNull(knowledgeChunksTable.deletedAt),
      ),
    )
    .limit(MAX_CHUNKS);

  const indexedSourceIds = new Set<string>(chunkRows.map(r => r.knowledgeSourceId));

  // ── Query 3: ingestion status from the current source version ─────────────
  const versionRows = await db
    .select({
      knowledgeSourceId: knowledgeSourceVersionsTable.knowledgeSourceId,
      ingestionStatus:   knowledgeSourceVersionsTable.ingestionStatus,
    })
    .from(knowledgeSourceVersionsTable)
    .where(
      and(
        inArray(knowledgeSourceVersionsTable.knowledgeSourceId, sourceIds),
        eq(knowledgeSourceVersionsTable.isCurrent, true),
      ),
    )
    .limit(MAX_VERSIONS);

  const ingestionStatusBySourceId = new Map<string, string>(
    versionRows.map(r => [r.knowledgeSourceId, r.ingestionStatus]),
  );

  // ── Score, filter, rank ───────────────────────────────────────────────────
  const matches: LibraryPresenceMatch[] = [];

  for (const src of sources) {
    const confidence = scoreMatch(src.title, searchTerms);
    if (confidence < MIN_CONFIDENCE) continue;

    const approved    = src.status === "approved" && src.approvedByUserId !== null;
    const indexed     = indexedSourceIds.has(src.id);
    // retrievable: must be approved, indexed, and the current active version
    const retrievable = approved && indexed && src.isCurrent === true;
    const ingestionStatus = ingestionStatusBySourceId.get(src.id) ?? null;

    matches.push({
      sourceId:        src.id,
      title:           src.title,
      sourceType:      src.sourceType,
      version:         src.versionLabel ?? null,
      approved,
      indexed,
      retrievable,
      status:          src.status,
      ingestionStatus,
      confidence,
    });
  }

  // Sort descending by confidence, cap at MAX_MATCHES
  matches.sort((a, b) => b.confidence - a.confidence);
  const topMatches = matches.slice(0, MAX_MATCHES);

  const result: LibraryPresenceResult = {
    searched: true,
    matches:  topMatches,
    summary:  buildSummary(topMatches),
  };

  setCached(cacheKey, result);
  return result;
}
