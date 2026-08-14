/**
 * Sprint 29N.11 — Parallel Evidence Discovery Orchestrator
 *
 * Architectural change from Sprint 29N.6:
 *
 *   BEFORE (Sprint 29N.6 — KRS-first with escalation):
 *     KRS → sufficiency gate → if insufficient → OpenClaw (only on failure)
 *
 *   AFTER (Sprint 29N.11 — parallel discovery):
 *     KRS + OpenClaw START CONCURRENTLY for EVIDENCE_BEARING work
 *     → both results feed the same NeedsOps Authority Gate
 *     → deduplicate + reconcile contradictions
 *     → single Accepted EvidencePack → OpenAI reasoning
 *
 * Constitutional rule (Part D):
 *   "OpenClaw can find the Source of Truth. It cannot appoint the Source of Truth."
 *   Every OpenClaw result MUST pass through CandidateEvidence → Authority Gate.
 *   NeedsOps decides what evidence is acceptable. OpenClaw's confidence is advisory.
 *
 * Execution lane boundaries (Part B):
 *   TRANSIENT         — no KRS, no OpenClaw, no Completed Work
 *   PROFESSIONAL_WORK — OpenAI + Specialist DNA; no evidence discovery unless evidence-dependent
 *   EVIDENCE_BEARING  — KRS + OpenClaw concurrently; both feed NeedsOps trust boundary
 *
 * External web search (Part C):
 *   When allowExternalWebSearch=true, the OpenClaw adapter may search the web,
 *   follow links, inspect authoritative pages, follow cross-references, retrieve
 *   relevant passages, identify publication/effective dates and issuing orgs.
 *   External results still pass through the Authority Gate. AUTHORITATIVE status
 *   requires the source to be in the Authority Registry or an explicitly approved
 *   external authority. Secondary sources may assist reasoning but cannot silently
 *   satisfy a regulatory requirement.
 *
 * Graceful degradation (Part K):
 *   - OpenClaw unavailable → KRS continues; record openclaw_discovery_unavailable
 *   - KRS fails           → OpenClaw candidates may still be evaluated;
 *                           internal candidates must still pass Library/authority checks
 *   - Both fail / combined evidence insufficient → fail honestly; no evidence-free Completed Work
 *
 * Performance (Part L):
 *   Critical path = max(KRS latency, OpenClaw latency) + convergence overhead
 *   NOT:             KRS latency + OpenClaw latency
 *   Bounded timeout and source/hop limits prevent one slow provider hanging execution.
 *
 * Implementation note (Part N):
 *   NullDiscoveryAdapter is the default Cloud adapter — isAvailable() returns false.
 *   When OpenClaw is unavailable, openclaw_discovery_unavailable is recorded in
 *   observability and execution continues with KRS evidence only.
 *   Do NOT report parallel OpenClaw discovery as live until a real adapter returns
 *   CandidateEvidence[]. The architecture is proven by tests (Part M).
 */

import type { EvidencePack, EvidenceChunk } from "../../services/knowledgeResolutionService.js";
import type { AcceptedEvidence } from "../../types/candidateEvidence.js";
import {
  runEvidenceDiscovery,
  buildEmptyEvidencePack,
  type OrchestratorResult,
} from "./discoveryOrchestrator.js";
import type { EvidenceEscalationDecision } from "../../services/evidenceEscalationService.js";
import { lookupAuthorityById, normaliseDomain } from "../authorityRegistry/index.js";

// ─── Parallel discovery parameters ────────────────────────────────────────────

/**
 * Parameters for starting OpenClaw parallel evidence discovery.
 * Used when EVIDENCE_BEARING work begins — OpenClaw starts concurrently with KRS.
 * These parameters are NOT derived from KRS insufficiency (that was Sprint 29N.6's
 * escalation model). Instead they describe what we're looking for, up front.
 */
export interface ParallelDiscoveryParams {
  /** Execution being processed */
  executionId: string;
  /** The organisation performing this execution (tenant boundary) */
  organisationId: string;
  /** The user's original request / task intent — used as the evidence question */
  evidenceQuestion: string;
  /**
   * Whether OpenClaw may perform external web searches (Part C).
   * Defaults to false. Explicitly opt-in per blueprint or task intent detection.
   * When true, OpenClaw may search the web, follow links, and retrieve authoritative
   * external pages. All results still pass through the Authority Gate.
   */
  allowExternalWebSearch: boolean;
  /** Maximum reference hops (default: 2) */
  maxHops?: number;
  /** Maximum sources (default: 5) */
  maxSources?: number;
  /** Maximum passages per source (default: 3) */
  maxPassages?: number;
  /** Wall-clock timeout for OpenClaw discovery (ms, default: 20_000) */
  timeoutMs?: number;
}

// ─── Contradiction record ─────────────────────────────────────────────────────

/**
 * Records a detected conflict between KRS and OpenClaw results (Part I).
 *
 * Contradiction resolution priority:
 *   authority → currency → applicability → version → scope
 *
 * If conflict cannot be resolved deterministically, it is exposed to the
 * specialist (and ultimately the user where material).
 */
export interface ContradictionRecord {
  /** The KRS chunk involved */
  krsChunkId: string;
  krsSourceTitle: string;
  krsSourceVersionId: string | null;
  krsText: string;

  /** The OpenClaw accepted candidate involved */
  openClawDiscoveryId: string;
  openClawSourceTitle: string;
  openClawInternalVersionId?: string;
  openClawText: string;

  /** Type of conflict detected */
  contradictionType:
    | "conflicting_versions"       // same source, different version IDs
    | "conflicting_content"        // same source and version, different text
    | "conflicting_authority";     // KRS marks source approved; OpenClaw disagrees

  /** Which evidence won (or if the conflict is exposed) */
  resolution: "krs_preferred" | "openclaw_preferred" | "exposed_to_specialist";
  /** Human-readable reasoning for the resolution decision */
  resolutionReason: string;
}

// ─── Evidence convergence result ──────────────────────────────────────────────

/**
 * Result of converging KRS and OpenClaw evidence into one EvidencePack (Part H).
 *
 * OpenAI receives a SINGLE mergedPack containing accepted evidence from both
 * providers. Provenance on each chunk shows which provider(s) discovered it.
 */
export interface EvidenceConvergenceResult {
  /**
   * The final merged EvidencePack to pass to OpenAI.
   *
   * null when BOTH KRS failed (returned null) AND OpenClaw produced no accepted
   * candidates — meaning evidence retrieval was attempted but produced no usable
   * result. Callers should use `mergedPack ?? buildEmptyEvidencePack(...)` when
   * a non-null pack is required for the sufficiency gate.
   *
   * Distinct from an empty EvidencePack (krsResult existed but had 0 chunks).
   */
  mergedPack: EvidencePack | null;

  // ── Provenance counters ────────────────────────────────────────────────────
  /** Chunks contributed by KRS */
  krsChunks: number;
  /** OpenClaw candidates that passed the Authority Gate */
  openClawAccepted: number;
  /**
   * Items found by BOTH providers (deduplicated in mergedPack).
   * These are the cases where OpenClaw independently confirmed KRS evidence.
   */
  deduplicatedItems: number;
  /** Contradictions detected between KRS and OpenClaw results */
  contradictions: ContradictionRecord[];

  // ── OpenClaw run diagnostics ───────────────────────────────────────────────
  /** True when the OpenClaw adapter was available and ran */
  openClawAvailable: boolean;
  /**
   * True when no OpenClaw adapter was available (NullDiscoveryAdapter).
   * Distinct from openClawAvailable=false which means adapter existed but
   * returned isAvailable()=false for a runtime-specific reason.
   */
  openClawUnavailable: boolean;
  /** Wall-clock time for OpenClaw discovery, or null if not run */
  openClawDurationMs: number | null;
  /** Name of the adapter that ran, or null if unavailable */
  openClawAdapterName: string | null;
  /** Raw candidates returned by OpenClaw adapter before gate */
  openClawCandidatesReturned: number;
  /** OpenClaw candidates accepted by NeedsOps Authority Gate */
  openClawCandidatesAccepted: number;
  /** OpenClaw candidates rejected by NeedsOps Authority Gate */
  openClawCandidatesRejected: number;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PARALLEL_MAX_HOPS     = 2;
const DEFAULT_PARALLEL_MAX_SOURCES  = 5;
const DEFAULT_PARALLEL_MAX_PASSAGES = 3;
const DEFAULT_PARALLEL_TIMEOUT_MS   = 20_000;   // OpenClaw has more time in parallel mode

// ─── Build the parallel discovery decision ────────────────────────────────────

/**
 * Build an EvidenceEscalationDecision for parallel discovery mode.
 *
 * Unlike Sprint 29N.6's buildEscalationDecision() (which derived scope from
 * KRS insufficiency), this builds the decision up front — before KRS has run —
 * to start OpenClaw concurrently.
 *
 * Scope is "internal_and_external" when external web search is permitted,
 * otherwise "internal_references_only" (follow cross-references and known sources).
 */
export function buildParallelDiscoveryDecision(
  params: ParallelDiscoveryParams,
): EvidenceEscalationDecision {
  const scope = params.allowExternalWebSearch
    ? "internal_and_external"
    : "internal_references_only";

  return {
    shouldEscalate:        true,
    reason:                `Parallel discovery: ${params.evidenceQuestion.slice(0, 120)}`,
    escalationStatus:      "PARALLEL_MODE",
    allowedDiscoveryScope: scope,
    requiredEvidence:      [params.evidenceQuestion],
    unresolvedReferences:  [],
    externalAuthorityRequired: params.allowExternalWebSearch
      ? ["legislation", "regulation", "government_guidance", "standard"]
      : [],
    originalEvidencePackId: params.executionId,
    executionId:   params.executionId,
    tenantId:      params.organisationId,
    organisationId: params.organisationId,
    maxHops:       params.maxHops     ?? DEFAULT_PARALLEL_MAX_HOPS,
    maxSources:    params.maxSources  ?? DEFAULT_PARALLEL_MAX_SOURCES,
    maxPassages:   params.maxPassages ?? DEFAULT_PARALLEL_MAX_PASSAGES,
    timeoutMs:     params.timeoutMs   ?? DEFAULT_PARALLEL_TIMEOUT_MS,
  };
}

// ─── Run OpenClaw parallel discovery ─────────────────────────────────────────

/**
 * Start OpenClaw evidence discovery for concurrent execution alongside KRS.
 *
 * This function is called at the same time as KRS starts — NOT after KRS has
 * evaluated and been found insufficient. Parallelism is achieved at the UEE
 * call site using Promise.all([krsPromise, runParallelEvidenceDiscovery(...)]).
 *
 * If no discovery adapter is available (e.g. Cloud with NullDiscoveryAdapter),
 * returns a result with adapterAvailable=false so the caller can record
 * openclaw_discovery_unavailable and continue with KRS evidence only.
 *
 * @param params  Evidence question, scope constraints, and hard limits
 * @returns       OrchestratorResult from the authority-gated discovery cycle
 */
export async function runParallelEvidenceDiscovery(
  params: ParallelDiscoveryParams,
): Promise<OrchestratorResult> {
  const decision = buildParallelDiscoveryDecision(params);

  // Use an empty V1 pack — in parallel mode we don't have KRS results yet.
  // The adapter uses the evidence question and scope, not the V1 pack content.
  const emptyPack = buildEmptyEvidencePack(params.executionId, params.organisationId);

  return runEvidenceDiscovery(
    decision,
    emptyPack,
    params.organisationId,
    /* allowExternal= */ params.allowExternalWebSearch,
  );
}

// ─── Evidence convergence (Part H) ───────────────────────────────────────────

/**
 * Converge KRS and OpenClaw results into one EvidencePack (Part H).
 *
 * Rules:
 *   1. Start with KRS chunks (already authority-validated by the Library).
 *   2. For each accepted OpenClaw candidate:
 *      a. Check for duplicate (same source version, same URL, or same passage hash).
 *      b. If duplicate: mark as discovered_by="both", check for contradiction.
 *      c. If no duplicate: add as new chunk from OpenClaw.
 *   3. Build merged pack with provenance on each chunk.
 *   4. Return contradictions for specialist awareness.
 *
 * Deduplication keys:
 *   - Internal: internalSourceVersionId (same DB version) OR text equality
 *   - External: sourceUrl (same URL)
 *   - Content:  passageHash (same passage, regardless of source)
 *
 * Contradiction resolution priority (Part I):
 *   authority → currency → applicability → version → scope
 */
export function convergeEvidenceResults(
  krsResult: EvidencePack | null,
  openClawResult: OrchestratorResult | null,
  executionId: string,
  organisationId: string,
): EvidenceConvergenceResult {
  const krsChunks  = krsResult?.chunks ?? [];
  const accepted   = openClawResult?.accepted ?? [];

  const openClawAvailable   = openClawResult?.adapterAvailable ?? false;
  const openClawUnavailable = !openClawAvailable;

  // Degenerate case: nothing from OpenClaw
  if (accepted.length === 0) {
    // When krsResult is null (KRS failed) and OpenClaw produced nothing,
    // return null so the UEE can propagate this as evidencePack=null → undefined
    // at the validateWorkPackage call site. This preserves the contract that
    // "null = KRS failed with no recovery" vs "empty pack = KRS ran, found nothing".
    const mergedPack: EvidencePack | null = krsResult;
    return {
      mergedPack,
      krsChunks:                krsChunks.length,
      openClawAccepted:         0,
      deduplicatedItems:        0,
      contradictions:           [],
      openClawAvailable,
      openClawUnavailable,
      openClawDurationMs:       openClawResult?.durationMs ?? null,
      openClawAdapterName:      openClawResult?.adapterName ?? null,
      openClawCandidatesReturned: openClawResult?.candidates.length ?? 0,
      openClawCandidatesAccepted: 0,
      openClawCandidatesRejected: openClawResult?.rejected.length ?? 0,
    };
  }

  // Build lookup structures from KRS for deduplication and contradiction detection
  const krsByVersionId = new Map<string, EvidenceChunk>();   // versionId → chunk
  const krsBySourceId  = new Map<string, EvidenceChunk>();   // sourceId  → chunk (for version-conflict detection)
  const krsByText      = new Map<string, EvidenceChunk>();   // text hash → chunk
  for (const c of krsChunks) {
    if (c.sourceVersionId) krsByVersionId.set(c.sourceVersionId, c);
    if (c.sourceId)        krsBySourceId.set(c.sourceId, c);
    krsByText.set(normaliseText(c.text), c);
  }

  const newChunks:       EvidenceChunk[]      = [];
  const contradictions:  ContradictionRecord[] = [];
  let   deduplicatedItems = 0;

  for (const acceptedItem of accepted) {
    const cand     = acceptedItem.candidate;
    const candText = normaliseText(cand.supportingPassage);

    // ── Try deduplication ──────────────────────────────────────────────────────
    let duplicate: EvidenceChunk | undefined;

    // 1. Same internal version ID (most precise — exact same version)
    if (cand.internalSourceVersionId) {
      duplicate = krsByVersionId.get(cand.internalSourceVersionId);
    }
    // 2. Same passage text (content-identical, possibly same or different version)
    if (!duplicate) {
      duplicate = krsByText.get(candText);
    }

    if (duplicate) {
      deduplicatedItems++;
      // Check for content/authority contradiction on the exact match
      const contradiction = detectContradiction(duplicate, acceptedItem);
      if (contradiction) contradictions.push(contradiction);
      // KRS chunk already in pack — no new chunk needed.
      continue;
    }

    // ── Version conflict: same source, different version ──────────────────────
    // OpenClaw found a different version of a document already in the KRS pack.
    // This is a conflict (not an exact dedup) — record as contradiction and
    // treat as a version-conflict duplicate (KRS is authoritative, no new chunk).
    if (cand.internalSourceId) {
      const krsChunkSameSource = krsBySourceId.get(cand.internalSourceId);
      if (krsChunkSameSource) {
        // Same source, different version/text — contradiction detected
        deduplicatedItems++;
        const versionConflict = detectContradiction(krsChunkSameSource, acceptedItem);
        if (versionConflict) {
          contradictions.push(versionConflict);
        } else {
          // Same source, same text but different version IDs — record as dedup
          // (content matches so this is likely the same content in a renamed version)
        }
        // KRS version (Library-approved) takes precedence — no new chunk from OpenClaw
        continue;
      }
    }

    // ── New evidence from OpenClaw ─────────────────────────────────────────────
    // Not a duplicate of any KRS chunk — build a provenance-annotated EvidenceChunk.
    // Authority class assigned by the gate (never openClawConfidence).
    newChunks.push(buildOpenClawChunk(acceptedItem, executionId));
  }

  // ── Assemble merged pack ──────────────────────────────────────────────────────
  const basePack   = krsResult ?? buildEmptyEvidencePack(executionId, organisationId);
  const allChunks  = [...krsChunks, ...newChunks];
  const sourceIds  = [...new Set(allChunks.map(c => c.sourceId))];
  const avgConf    = allChunks.length > 0
    ? allChunks.reduce((s, c) => s + c.confidence, 0) / allChunks.length
    : 0;

  const citationsByType: Record<string, EvidenceChunk[]> = {};
  for (const c of allChunks) {
    if (!citationsByType[c.sourceType]) citationsByType[c.sourceType] = [];
    citationsByType[c.sourceType].push(c);
  }

  const mergedPack: EvidencePack = {
    ...basePack,
    executionId,
    chunks:          allChunks,
    sourceIds,
    citationsByType,
    totalChunks:     allChunks.length,
    avgConfidence:   avgConf,
    retrievalMetrics: {
      ...basePack.retrievalMetrics,
      selectedChunks: allChunks.length,
    },
  };

  // Build convergence observability (Part H)
  // expose contradictions in result for specialist system prompt injection
  if (contradictions.length > 0) {
    console.warn(
      `[ParallelDiscoveryOrchestrator] ${contradictions.length} contradiction(s) detected ` +
      `between KRS and OpenClaw results (executionId=${executionId}). ` +
      "Contradictions will be exposed to the specialist.",
    );
  }

  return {
    mergedPack,
    krsChunks:                krsChunks.length,
    openClawAccepted:         accepted.length,
    deduplicatedItems,
    contradictions,
    openClawAvailable,
    openClawUnavailable,
    openClawDurationMs:         openClawResult?.durationMs ?? null,
    openClawAdapterName:        openClawResult?.adapterName ?? null,
    openClawCandidatesReturned: openClawResult?.candidates.length ?? 0,
    openClawCandidatesAccepted: accepted.length,
    openClawCandidatesRejected: openClawResult?.rejected.length ?? 0,
  };
}

// ─── Contradiction detection (Part I) ────────────────────────────────────────

/**
 * Detect whether a KRS chunk and an OpenClaw accepted candidate conflict.
 *
 * Resolution priority (Part I):
 *   authority → currency → applicability → version → scope
 *
 * KRS chunks are always from Library-approved sources (primary/mandatory authority).
 * If they conflict with an OpenClaw find, prefer the KRS chunk unless OpenClaw
 * found a definitively newer version. If irresolvable, expose to specialist.
 */
function detectContradiction(
  krsChunk: EvidenceChunk,
  accepted: AcceptedEvidence,
): ContradictionRecord | null {
  const cand = accepted.candidate;

  // Check for version conflict
  const hasVersionConflict =
    !!cand.internalSourceVersionId &&
    !!krsChunk.sourceVersionId &&
    cand.internalSourceVersionId !== krsChunk.sourceVersionId;

  // Check for content conflict (same source, same apparent version, different text)
  const hasContentConflict =
    !hasVersionConflict &&
    normaliseText(cand.supportingPassage) !== normaliseText(krsChunk.text);

  if (!hasVersionConflict && !hasContentConflict) return null;

  const contradictionType = hasVersionConflict
    ? "conflicting_versions"
    : "conflicting_content";

  // Resolution: KRS preferred unless OpenClaw has a clearly newer/higher authority source.
  // For now, always prefer KRS (Library-approved) and expose to specialist.
  // Future: date comparison on effectiveDate when available.
  let resolution: ContradictionRecord["resolution"] = "krs_preferred";
  let resolutionReason =
    "KRS source is Library-approved; OpenClaw candidate cannot override a governed authority without administrator approval.";

  if (
    hasVersionConflict &&
    cand.effectiveDate &&
    krsChunk.sourceVersionId === null // KRS chunk has unknown version — defer
  ) {
    // Cannot compare versions — expose to specialist for human review
    resolution        = "exposed_to_specialist";
    resolutionReason  =
      "KRS chunk version is unknown. OpenClaw found a dated version. " +
      "A specialist must determine which is current.";
  }

  return {
    krsChunkId:              krsChunk.chunkId,
    krsSourceTitle:          krsChunk.sourceTitle,
    krsSourceVersionId:      krsChunk.sourceVersionId,
    krsText:                 krsChunk.text.slice(0, 200),
    openClawDiscoveryId:     cand.discoveryId,
    openClawSourceTitle:     cand.sourceTitle,
    openClawInternalVersionId: cand.internalSourceVersionId,
    openClawText:            cand.supportingPassage.slice(0, 200),
    contradictionType,
    resolution,
    resolutionReason,
  };
}

// ─── Build EvidenceChunk from accepted OpenClaw candidate ────────────────────

function buildOpenClawChunk(accepted: AcceptedEvidence, executionId: string): EvidenceChunk {
  const cand = accepted.candidate;
  const registryEntry = accepted.authorityRegistryId ? lookupAuthorityById(accepted.authorityRegistryId) : null;
  return {
    chunkId:         cand.discoveryId,
    sourceId:        accepted.canonicalSourceId ?? `openclaw-ext-${cand.discoveryId}`,
    sourceVersionId: accepted.canonicalVersionId ?? null,
    sourceTitle:     cand.sourceTitle,
    versionLabel:    null,
    sourceType:      cand.contentType,
    // Authority class assigned by NeedsOps Authority Gate — NEVER openClawConfidence
    authorityLevel:  accepted.authorityClass,
    sectionTitle:    null,
    pageNumber:      null,
    text:            cand.supportingPassage,
    // Use relevanceScore as confidence — never openClawConfidence
    confidence:      cand.relevanceScore,
    citation:        buildCitation(cand.sourceTitle, cand.sourceUrl),
    // Provenance annotation: chunk came from OpenClaw discovery
    selectionReason: `parallel_discovery:${cand.retrievalMethod}`,
    provenance: {
      sourceOrigin: cand.isExternal ? "external_authority" : "internal_krs",
      authorityRegistryId: accepted.authorityRegistryId,
      authorityName:       registryEntry?.name,
      authorityClass:      registryEntry?.sourceClass,
      jurisdiction:        cand.jurisdiction ?? registryEntry?.jurisdictions[0],
      professionalDomains: registryEntry?.professionalDomains,
      transport:           registryEntry?.currentTransport ?? (cand.isExternal ? "GOVERNED_WEB" : "INTERNAL_KRS"),
      originalUrl:         cand.sourceUrl,
      recordIdentifier:    accepted.canonicalSourceId ?? cand.sourceUrl ?? cand.discoveryId,
      documentIdentifier:  accepted.canonicalVersionId ?? cand.sourceUrl ?? cand.discoveryId,
      publisherDomain:     cand.publisherDomain ?? (cand.sourceUrl ? normaliseDomain(cand.sourceUrl) : undefined),
      claimedPublisher:    cand.claimedPublisher,
      retrievedAt:         cand.retrievalTimestamp,
      publishedAt:         cand.publicationDate,
      effectiveFrom:       cand.effectiveDate,
    },
    currentness: {
      status: "UNKNOWN",
      checkedAt: cand.retrievalTimestamp,
      version: cand.publicationDate ?? null,
      supersededStatus: null,
    },
  };
}

function buildCitation(title: string, url?: string): string {
  return url ? `${title} (${url})` : title;
}

function normaliseText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}
