/**
 * Organisation Library Presence Service (Sprint 28.1 → Sprint 29G.1)
 *
 * Fast, lightweight inspection of the Organisation Library.
 * Determines whether a document exists and whether specialists can currently use it.
 *
 * NOT semantic retrieval.
 * NOT chunk retrieval.
 * NOT KnowledgeResolutionService.
 *
 * Sprint 29G.1 changes:
 *   - Multi-signal resolution: canonical_title + search_aliases + title + original_file_name
 *   - New PresenceState discriminant: found | possible_match | not_found | not_ready
 *   - Approval fix: approved = status === "approved" (dropped approvedByUserId !== null;
 *     aligns with KRS which checks status only — system/auto-approved sources are valid)
 *   - Type-fallback: when direct search returns 0 candidates, return POSSIBLE_MATCH when
 *     org has approved documents of the requested type
 *   - Shared eligibility predicate (isSourceEligible from documentIdentityService)
 *
 * Target: <100ms. Results are cached for 30 seconds per (org, terms) pair.
 */

import { db, knowledgeSourcesTable, knowledgeChunksTable, knowledgeSourceVersionsTable } from "@workspace/db";
import { eq, and, or, isNull, inArray, ilike } from "drizzle-orm";
import {
  isSourceEligible,
  scoreMultiSignal,
  extractTypeWordsFromTerms,
} from "./documentIdentityService.js";

// ─── Public types ─────────────────────────────────────────────────────────────

/** Primary result discriminant — replaces the old boolean flags as the authoritative state. */
export type PresenceState =
  | "found"            // Direct title/canonical/alias match; document is retrievable
  | "possible_match"   // No direct title match; a plausible type-matched candidate exists
  | "not_found"        // No matching or plausible document exists in the library
  | "not_ready";       // Matching document exists but is not yet retrievable (unapproved/unindexed)

export interface LibraryPresenceMatch {
  /** knowledge_sources.id */
  sourceId: string;
  /** Human-readable document title (from knowledge_sources.title) */
  title: string;
  /** Canonical title derived at ingestion time (null if not yet set) */
  canonicalTitle: string | null;
  /** e.g. "policy", "procedure", "care_plan" */
  sourceType: string;
  /** Version label from the source row (null if unversioned) */
  version: string | null;
  /** true when status === "approved" (system or human — see isSourceEligible) */
  approved: boolean;
  /** true when at least one knowledge_chunk row exists for this source */
  indexed: boolean;
  /** true when approved AND indexed AND isCurrent (matches KRS eligibility) */
  retrievable: boolean;
  /** knowledge_sources.status */
  status: string;
  /** ingestion_status from the current knowledge_source_versions row */
  ingestionStatus: string | null;
  /** 0.0–1.0 confidence across all identity signals */
  confidence: number;
  /** Which field produced the best match */
  matchedSignal: string;
  /** true when this candidate came from the type-fallback path (not direct title match) */
  isTypeFallback: boolean;
}

export interface LibraryPresenceSummary {
  /** Primary state — use this for all decision logic */
  state: PresenceState;
  /** Best match was an exact or near-exact title (kept for backward compat) */
  exactMatch: boolean;
  /** Best match was a partial title or keyword match (kept for backward compat) */
  partialMatch: boolean;
  /** At least one match is indexed (has chunks) (kept for backward compat) */
  searchable: boolean;
  /** At least one match is fully retrievable by specialists (kept for backward compat) */
  usable: boolean;
  /** Human-readable explanation of the result state */
  reason: string;
}

export interface LibraryPresenceResult {
  searched: true;
  /** Direct title/canonical/alias matches (may be empty) */
  matches: LibraryPresenceMatch[];
  /** Type-fallback candidates when direct search returned 0 (may be empty) */
  possibleMatches: LibraryPresenceMatch[];
  summary: LibraryPresenceSummary;
}

// ─── Internal constants ───────────────────────────────────────────────────────

const CACHE_TTL_MS   = 30_000;
const MAX_SOURCES    = 20;
const MAX_CHUNKS     = 500;
const MAX_VERSIONS   = 50;
const MAX_MATCHES    = 10;

/** Confidence floor for direct matches — below this, consider type-fallback only */
const MIN_CONFIDENCE = 0.30;

/** Confidence threshold separating FOUND from POSSIBLE_MATCH for direct matches */
const FOUND_THRESHOLD = 0.65;

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

// ─── Document-type synonym map ────────────────────────────────────────────────
//
// Broadens ILIKE title searches across natural name variants.
// "Medication Management Policy" also searches "… Procedure", "… SOP", etc.

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

// ─── Search term expansion ────────────────────────────────────────────────────

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
        expanded.add(lower.replace(word, syn));
      }
    }
  }
  return Array.from(expanded);
}

function generateSubPhrases(terms: string[]): string[] {
  const subPhrases: string[] = [];
  for (const term of terms) {
    const words = term.toLowerCase().trim().split(/\s+/);
    for (let drop = 1; drop <= words.length - 2; drop++) {
      subPhrases.push(words.slice(drop).join(" "));
    }
  }
  return subPhrases;
}

// ─── Result builders ──────────────────────────────────────────────────────────

function emptyResult(state: PresenceState, reason: string): LibraryPresenceResult {
  return {
    searched: true,
    matches: [],
    possibleMatches: [],
    summary: {
      state,
      exactMatch: false, partialMatch: false, searchable: false, usable: false,
      reason,
    },
  };
}

function buildSummary(
  matches: LibraryPresenceMatch[],
  possibleMatches: LibraryPresenceMatch[],
): LibraryPresenceSummary {
  const allCandidates = [...matches, ...possibleMatches];

  if (allCandidates.length === 0) {
    return {
      state: "not_found",
      exactMatch: false, partialMatch: false, searchable: false, usable: false,
      reason: "No matching documents found in the Organisation Library",
    };
  }

  const topDirect   = matches[0];
  const topPossible = possibleMatches[0];

  // Usable = any retrievable candidate exists (direct or possible)
  const usable      = allCandidates.some(m => m.retrievable);
  const searchable  = allCandidates.some(m => m.indexed);

  // State classification
  let state: PresenceState;
  let reason: string;
  let exactMatch  = false;
  let partialMatch = false;

  if (topDirect) {
    exactMatch   = topDirect.confidence >= 0.90;
    partialMatch = !exactMatch && topDirect.confidence >= 0.45;

    if (topDirect.retrievable && topDirect.confidence >= FOUND_THRESHOLD) {
      state = "found";
      reason = exactMatch
        ? `Found "${topDirect.canonicalTitle ?? topDirect.title}" — approved and ready for specialist use`
        : `Found "${topDirect.canonicalTitle ?? topDirect.title}" — partial match, approved and ready`;
    } else if (topDirect.retrievable) {
      // Weak direct match — still usable
      state = "possible_match";
      reason = `Found related document "${topDirect.canonicalTitle ?? topDirect.title}" — approved and ready`;
    } else if (topDirect.indexed && !topDirect.approved) {
      state = "not_ready";
      reason = `Found "${topDirect.canonicalTitle ?? topDirect.title}" — indexed but not yet approved`;
    } else if (topDirect.approved && !topDirect.indexed) {
      state = "not_ready";
      reason = `Found "${topDirect.canonicalTitle ?? topDirect.title}" — approved but ingestion pending`;
    } else if (topDirect.status === "uploaded" || topDirect.status === "processing") {
      state = "not_ready";
      reason = `Found "${topDirect.canonicalTitle ?? topDirect.title}" — pending ingestion (status: ${topDirect.status})`;
    } else {
      state = "not_ready";
      reason = `Found "${topDirect.canonicalTitle ?? topDirect.title}" — not currently usable (status: ${topDirect.status})`;
    }
  } else if (topPossible) {
    // No direct title match; type-fallback found something
    state = "possible_match";
    if (topPossible.retrievable) {
      reason = `Found a plausible document "${topPossible.canonicalTitle ?? topPossible.title}" — no exact title match but document is approved and indexed`;
    } else {
      reason = `Found a plausible document "${topPossible.canonicalTitle ?? topPossible.title}" — no exact title match and document is not currently usable (status: ${topPossible.status})`;
    }
  } else {
    state = "not_found";
    reason = "No matching documents found in the Organisation Library";
  }

  return { state, exactMatch, partialMatch, searchable, usable, reason };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether documents matching the given search terms exist in the
 * Organisation Library and whether specialists can currently use them.
 *
 * Sprint 29G.1: Multi-signal resolution using canonical_title, search_aliases,
 * title, and original_file_name. Falls back to type-matched candidates when
 * direct search finds nothing.
 */
export async function checkOrganisationLibraryPresence(
  organisationId: string,
  searchTerms: string[],
): Promise<LibraryPresenceResult> {
  if (!organisationId || searchTerms.length === 0) {
    return emptyResult("not_found", "No search terms provided");
  }

  // Cache key — stable regardless of term ordering
  const cacheKey = `${organisationId}::${[...searchTerms].sort().join("|")}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  // ── Build expanded ILIKE terms ─────────────────────────────────────────────
  const expandedTerms = expandSearchTerms(searchTerms);
  const subPhrases    = generateSubPhrases(expandedTerms);
  const allIlikeTerms = [...new Set([...expandedTerms, ...subPhrases])];

  // ── Query 1: multi-signal source candidates ────────────────────────────────
  // Search across: title, canonical_title, original_file_name
  // (search_aliases are JSON — checked post-query in TypeScript)
  const ilikeConditions = allIlikeTerms.flatMap(t => [
    ilike(knowledgeSourcesTable.title,         `%${t}%`),
    ilike(knowledgeSourcesTable.canonicalTitle, `%${t}%`),
    ilike(knowledgeSourcesTable.originalFileName, `%${t}%`),
  ]);

  const sources = await db
    .select({
      id:               knowledgeSourcesTable.id,
      title:            knowledgeSourcesTable.title,
      canonicalTitle:   knowledgeSourcesTable.canonicalTitle,
      searchAliases:    knowledgeSourcesTable.searchAliases,
      originalFileName: knowledgeSourcesTable.originalFileName,
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
        eq(knowledgeSourcesTable.sourceScope, "library"),
        or(...ilikeConditions),
      ),
    )
    .limit(MAX_SOURCES);

  // Collect all source IDs for chunk + version queries
  const sourceIds = sources.map(s => s.id);

  // ── Query 2: chunk existence ───────────────────────────────────────────────
  const chunkRows = await (sourceIds.length > 0
    ? db
        .select({ knowledgeSourceId: knowledgeChunksTable.knowledgeSourceId })
        .from(knowledgeChunksTable)
        .where(
          and(
            inArray(knowledgeChunksTable.knowledgeSourceId, sourceIds),
            isNull(knowledgeChunksTable.deletedAt),
          ),
        )
        .limit(MAX_CHUNKS)
    : Promise.resolve([]));

  const indexedSourceIds = new Set<string>(chunkRows.map(r => r.knowledgeSourceId));

  // ── Query 3: ingestion status ──────────────────────────────────────────────
  const versionRows = await (sourceIds.length > 0
    ? db
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
        .limit(MAX_VERSIONS)
    : Promise.resolve([]));

  const ingestionStatusBySourceId = new Map<string, string>(
    versionRows.map(r => [r.knowledgeSourceId, r.ingestionStatus]),
  );

  // ── Score candidates across all identity signals ───────────────────────────
  const directMatches: LibraryPresenceMatch[] = [];

  for (const src of sources) {
    const { confidence, signal } = scoreMultiSignal(
      {
        title:            src.title,
        canonicalTitle:   src.canonicalTitle ?? null,
        searchAliases:    (src.searchAliases as string[] | null) ?? null,
        originalFileName: src.originalFileName ?? null,
        sourceType:       src.sourceType,
      },
      searchTerms,
    );

    if (confidence < MIN_CONFIDENCE) continue;

    // Sprint 29G.1:
    //   approved    = source has been approved (status only — no approvedByUserId requirement)
    //   retrievable = isSourceEligible (approved + isCurrent + not-deleted) AND indexed
    //
    // This separates "has this document been approved?" from "can specialists retrieve it now?"
    // It aligns with KRS (which checks status + isCurrent only, not approvedByUserId) while
    // preserving the `approved` field's original semantic (approval status, not retrieval readiness).
    const approved    = src.status === "approved";
    const indexed     = indexedSourceIds.has(src.id);
    const retrievable = isSourceEligible({ status: src.status, isCurrent: src.isCurrent, deletedAt: src.deletedAt }) && indexed;
    const ingestionStatus = ingestionStatusBySourceId.get(src.id) ?? null;

    directMatches.push({
      sourceId:        src.id,
      title:           src.title,
      canonicalTitle:  src.canonicalTitle ?? null,
      sourceType:      src.sourceType,
      version:         src.versionLabel ?? null,
      approved,
      indexed,
      retrievable,
      status:          src.status,
      ingestionStatus,
      confidence,
      matchedSignal:   signal,
      isTypeFallback:  false,
    });
  }

  // Sort by confidence descending
  directMatches.sort((a, b) => b.confidence - a.confidence);
  const topDirect = directMatches.slice(0, MAX_MATCHES);

  // ── Type-fallback: when no direct matches, check for plausible type-matched sources ──
  let typeFallbackMatches: LibraryPresenceMatch[] = [];

  if (topDirect.length === 0) {
    const typeWords = extractTypeWordsFromTerms(searchTerms);
    if (typeWords.length > 0) {
      // Map type words to source_type values
      const TYPE_MAP: Record<string, string[]> = {
        policy:    ["policy"],
        policies:  ["policy"],
        procedure: ["procedure"],
        procedures:["procedure"],
        sop:       ["procedure", "policy"],
        manual:    ["hr_manual", "operational_manual", "policy", "procedure"],
        manuals:   ["hr_manual", "operational_manual", "policy", "procedure"],
        guideline: ["policy", "procedure"],
        guidelines:["policy", "procedure"],
        standard:  ["policy", "procedure", "compliance_document"],
        standards: ["policy", "procedure", "compliance_document"],
        framework: ["policy", "procedure", "playbook"],
        protocol:  ["policy", "procedure"],
        handbook:  ["hr_manual", "operational_manual"],
        plan:      ["playbook", "policy"],
        plans:     ["playbook", "policy"],
      };

      const matchedTypes = new Set<string>();
      for (const word of typeWords) {
        const types = TYPE_MAP[word] ?? [];
        types.forEach(t => matchedTypes.add(t));
      }

      if (matchedTypes.size > 0) {
        // Fetch approved+current library sources of the matching types
        const fallbackSources = await db
          .select({
            id:               knowledgeSourcesTable.id,
            title:            knowledgeSourcesTable.title,
            canonicalTitle:   knowledgeSourcesTable.canonicalTitle,
            searchAliases:    knowledgeSourcesTable.searchAliases,
            originalFileName: knowledgeSourcesTable.originalFileName,
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
              eq(knowledgeSourcesTable.sourceScope, "library"),
              eq(knowledgeSourcesTable.status, "approved"),
              eq(knowledgeSourcesTable.isCurrent, true),
              inArray(knowledgeSourcesTable.sourceType, [...matchedTypes]),
            ),
          )
          .limit(MAX_SOURCES);

        if (fallbackSources.length > 0) {
          const fallbackIds = fallbackSources.map(s => s.id);

          const [fallbackChunks, fallbackVersions] = await Promise.all([
            db.select({ knowledgeSourceId: knowledgeChunksTable.knowledgeSourceId })
              .from(knowledgeChunksTable)
              .where(and(inArray(knowledgeChunksTable.knowledgeSourceId, fallbackIds), isNull(knowledgeChunksTable.deletedAt)))
              .limit(MAX_CHUNKS),
            db.select({ knowledgeSourceId: knowledgeSourceVersionsTable.knowledgeSourceId, ingestionStatus: knowledgeSourceVersionsTable.ingestionStatus })
              .from(knowledgeSourceVersionsTable)
              .where(and(inArray(knowledgeSourceVersionsTable.knowledgeSourceId, fallbackIds), eq(knowledgeSourceVersionsTable.isCurrent, true)))
              .limit(MAX_VERSIONS),
          ]);

          const fallbackIndexed = new Set(fallbackChunks.map(r => r.knowledgeSourceId));
          const fallbackIngestionStatus = new Map(fallbackVersions.map(r => [r.knowledgeSourceId, r.ingestionStatus]));

          for (const src of fallbackSources) {
            const approved    = src.status === "approved";
            const indexed     = fallbackIndexed.has(src.id);
            const retrievable = isSourceEligible({ status: src.status, isCurrent: src.isCurrent, deletedAt: src.deletedAt }) && indexed;

            typeFallbackMatches.push({
              sourceId:        src.id,
              title:           src.title,
              canonicalTitle:  src.canonicalTitle ?? null,
              sourceType:      src.sourceType,
              version:         src.versionLabel ?? null,
              approved,
              indexed,
              retrievable,
              status:          src.status,
              ingestionStatus: fallbackIngestionStatus.get(src.id) ?? null,
              confidence:      0.20,   // type-match only — below direct FOUND threshold
              matchedSignal:   "type_only",
              isTypeFallback:  true,
            });
          }

          // Prefer retrievable candidates first
          typeFallbackMatches.sort((a, b) => Number(b.retrievable) - Number(a.retrievable));
        }
      }
    }
  }

  const result: LibraryPresenceResult = {
    searched: true,
    matches:         topDirect,
    possibleMatches: typeFallbackMatches.slice(0, MAX_MATCHES),
    summary:         buildSummary(topDirect, typeFallbackMatches),
  };

  setCached(cacheKey, result);
  return result;
}
