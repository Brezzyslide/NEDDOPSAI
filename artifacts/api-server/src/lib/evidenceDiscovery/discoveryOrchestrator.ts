/**
 * Sprint 29N.6 — Part G / Part H: Evidence Discovery Orchestrator
 *
 * Orchestrates the full escalation cycle:
 *
 *   EvidencePack V1
 *   → EvidenceEscalationDecision
 *   → IEvidenceDiscoveryAdapter.discover()
 *   → CandidateEvidence[]
 *   → NeedsOps Authority Gate (validateCandidateBatch)
 *   → AcceptedEvidence[]
 *   → EvidencePack V2 (V1 + accepted candidates converted to EvidenceChunks)
 *
 * The orchestrator enforces:
 *   - Adapter availability check before invocation
 *   - Timeout wrapper around the adapter call
 *   - Scope enforcement (internal_references / external_authority / both)
 *   - Max hops / max sources / max passages from EscalationDecision
 *   - Tenant boundary passed to the authority gate
 *   - Fire-and-forget does not silence failures — they are captured in result
 *
 * CRITICAL: The orchestrator does NOT make professional judgements about evidence.
 * It locates, retrieves, validates, and merges. OpenAI performs the reasoning.
 *
 * Part L: The adapter is pluggable. Swap the adapter below to use
 * CloudOpenClawDiscoveryAdapter or HybridOpenClawDiscoveryAdapter when available.
 */

import { randomUUID } from "crypto";
import type { EvidenceEscalationDecision } from "../../services/evidenceEscalationService.js";
import type {
  CandidateEvidence,
  AcceptedEvidence,
  RejectedEvidence,
  DiscoveryAdapterResult,
  EvidenceRejectionReason,
} from "../../types/candidateEvidence.js";
import type { IEvidenceDiscoveryAdapter } from "./IEvidenceDiscoveryAdapter.js";
import { nullDiscoveryAdapter } from "./NullDiscoveryAdapter.js";
import { cloudOpenClawDiscoveryAdapter } from "./CloudOpenClawDiscoveryAdapter.js";
import { validateCandidateBatch } from "../../services/evidenceAcceptanceService.js";
import type { EvidencePack, EvidenceChunk } from "../../services/knowledgeResolutionService.js";

// ─── Adapter registry ─────────────────────────────────────────────────────────
// Sprint 29O.1: CloudOpenClawDiscoveryAdapter is registered before the null
// adapter. The orchestrator picks the first whose isAvailable() returns true.
//   - CloudOpenClawDiscoveryAdapter.isAvailable() → true when OPENCLAW_RUNTIME_URL
//     is set AND the last health check to the Mac broker succeeded.
//   - NullDiscoveryAdapter.isAvailable() → always false (safe fallback).
//
// When no adapter is available the orchestrator returns an empty result and
// execution continues with KRS evidence only (graceful degradation).

function getRegisteredAdapters(): IEvidenceDiscoveryAdapter[] {
  return [
    cloudOpenClawDiscoveryAdapter, // Sprint 29O.1: real Mac broker
    nullDiscoveryAdapter,          // safe fallback when broker unreachable
  ];
}

// ─── Orchestrator result ──────────────────────────────────────────────────────

/**
 * Full result from one discovery orchestration cycle.
 * Passed back to the UEE for EvidencePack V2 assembly and observability.
 */
export interface OrchestratorResult extends DiscoveryAdapterResult {
  /** True if any discovery adapter was available and ran */
  adapterAvailable: boolean;
  /** Whether the adapter's candidates were all filtered by the gate */
  allCandidatesRejected: boolean;
  /** Whether this result produced enough accepted evidence for V2 */
  producedUsableEvidence: boolean;
}

// ─── Main orchestrator function ───────────────────────────────────────────────

/**
 * Run the full evidence discovery cycle for one escalation decision.
 *
 * @param escalation      What to discover and under what constraints
 * @param v1Pack          The V1 EvidencePack that was insufficient
 * @param executingOrgId  The executing organisation (for Authority Gate)
 * @param allowExternal   Whether external evidence is permitted for this task
 */
export async function runEvidenceDiscovery(
  escalation: EvidenceEscalationDecision,
  v1Pack: EvidencePack,
  executingOrgId: string,
  allowExternal: boolean = false,
): Promise<OrchestratorResult> {
  const start = Date.now();

  // ── Select the discovery adapter ─────────────────────────────────────────────
  const adapter = selectAdapter(escalation.allowedDiscoveryScope, getRegisteredAdapters());

  if (!adapter || !adapter.isAvailable()) {
    console.info(
      "[DiscoveryOrchestrator] No available adapter for scope " +
      `"${escalation.allowedDiscoveryScope}" (executionId=${escalation.executionId}). ` +
      "Adapter: " + (adapter ? `${adapter.adapterName} (unavailable)` : "none registered") + ". " +
      "Returning empty discovery result.",
    );

    const unavailableResult: OrchestratorResult = {
      adapterName: adapter?.adapterName ?? "none",
      candidates: [],
      accepted: [],
      rejected: [],
      durationMs: Date.now() - start,
      hopsFollowed: 0,
      adapterAvailable: false,
      allCandidatesRejected: false,
      producedUsableEvidence: false,
    };

    return unavailableResult;
  }

  // ── Invoke adapter with timeout ───────────────────────────────────────────────
  let adapterResult;
  try {
    adapterResult = await withTimeout(
      adapter.discover({
        escalation,
        currentEvidencePack: v1Pack,
        timeoutMs: escalation.timeoutMs,
      }),
      escalation.timeoutMs,
      `Evidence discovery adapter "${adapter.adapterName}" timed out after ${escalation.timeoutMs}ms`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[DiscoveryOrchestrator] Adapter "${adapter.adapterName}" threw: ${message} ` +
      `(executionId=${escalation.executionId})`,
    );
    return {
      adapterName: adapter.adapterName,
      candidates: [],
      accepted: [],
      rejected: [],
      durationMs: Date.now() - start,
      hopsFollowed: 0,
      adapterAvailable: true,
      allCandidatesRejected: false,
      producedUsableEvidence: false,
    };
  }

  // ── Enforce hard limits on returned candidates ────────────────────────────────
  const limitedCandidates = enforceLimits(
    adapterResult.candidates,
    escalation,
  );

  // ── Run all candidates through the NeedsOps Authority Gate ───────────────────
  const { accepted, rejected } = await validateCandidateBatch(
    limitedCandidates,
    executingOrgId,
    allowExternal,
  );

  const producedUsableEvidence = accepted.length > 0;
  const allCandidatesRejected =
    limitedCandidates.length > 0 && accepted.length === 0;

  if (allCandidatesRejected) {
    console.info(
      `[DiscoveryOrchestrator] All ${limitedCandidates.length} candidate(s) from ` +
      `"${adapter.adapterName}" were rejected by the Authority Gate ` +
      `(executionId=${escalation.executionId})`,
    );
  }

  return {
    adapterName:              adapter.adapterName,
    candidates:               limitedCandidates,
    accepted,
    rejected,
    durationMs:               Date.now() - start,
    hopsFollowed:             adapterResult.hopsFollowed,
    adapterAvailable:         true,
    allCandidatesRejected,
    producedUsableEvidence,
  };
}

// ─── EvidencePack V2 assembly ─────────────────────────────────────────────────

/**
 * Merge accepted candidates into the V1 EvidencePack to produce V2.
 *
 * Accepted candidates are converted to EvidenceChunks using the authority class
 * assigned by the gate — NOT the adapter's openClawConfidence.
 *
 * This preserves the existing provenance chain (Sprint 29J/K) because the
 * resulting EvidenceChunks carry the same fields as KRS-produced chunks.
 * Claim emission and semantic entailment checks work identically on both.
 */
export function mergeAcceptedIntoEvidencePack(
  v1Pack: EvidencePack,
  accepted: AcceptedEvidence[],
  executionId: string,
): EvidencePack {
  const newChunks: EvidenceChunk[] = accepted.map(a => ({
    chunkId:         a.candidate.discoveryId,
    sourceId:        a.canonicalSourceId ?? `ext-${a.candidate.discoveryId}`,
    sourceVersionId: a.canonicalVersionId ?? null,
    sourceTitle:     a.candidate.sourceTitle,
    versionLabel:    null,
    sourceType:      a.candidate.contentType,
    authorityLevel:  a.authorityClass,
    sectionTitle:    null,
    pageNumber:      null,
    text:            a.candidate.supportingPassage,
    // Use relevanceScore as confidence — never openClawConfidence
    confidence:      a.candidate.relevanceScore,
    citation:        `${a.candidate.sourceTitle}${a.candidate.sourceUrl ? ` (${a.candidate.sourceUrl})` : ""}`,
    selectionReason: `discovery:${a.candidate.retrievalMethod}`,
  }));

  const allChunks = [...v1Pack.chunks, ...newChunks];

  // Recompute aggregate fields
  const sourceIds = [...new Set(allChunks.map(c => c.sourceId))];
  const avgConfidence =
    allChunks.length > 0
      ? allChunks.reduce((s, c) => s + c.confidence, 0) / allChunks.length
      : 0;

  const citationsByType: Record<string, EvidenceChunk[]> = {};
  for (const c of allChunks) {
    if (!citationsByType[c.sourceType]) citationsByType[c.sourceType] = [];
    citationsByType[c.sourceType].push(c);
  }

  return {
    ...v1Pack,
    executionId,
    chunks:      allChunks,
    sourceIds,
    citationsByType,
    totalChunks: allChunks.length,
    avgConfidence,
    retrievalMetrics: {
      ...v1Pack.retrievalMetrics,
      selectedChunks: allChunks.length,
    },
  };
}

/**
 * Build an empty EvidencePack for the case where KRS returned null.
 * Used to pass a valid pack to the sufficiency gate and discovery adapter.
 */
export function buildEmptyEvidencePack(executionId: string, organisationId: string = ""): EvidencePack {
  return {
    executionId,
    organisationId,
    resolvedAt:      new Date(),
    chunks:          [],
    sourceIds:       [],
    citationsByType: {},
    totalChunks:     0,
    avgConfidence:   0,
    retrievalMetrics: {
      queryCount:      0,
      totalCandidates: 0,
      selectedChunks:  0,
      cacheHit:        false,
      retrievalMs:     0,
      embeddingUsed:   false,
      embeddingMs:     0,
    },
  };
}

/**
 * Build a user-facing failure message from a sufficiency result and optional
 * discovery result (for richer context when discovery ran but failed).
 */
export function buildInsufficientEvidenceMessage(
  sufficiency: { status: string; unresolvedReferences?: Array<{ referencedTitle: string }> },
  discoveryResult: OrchestratorResult | null,
): string {
  const status = sufficiency.status;

  if (discoveryResult && !discoveryResult.adapterAvailable) {
    const refs = sufficiency.unresolvedReferences?.map(r => r.referencedTitle) ?? [];
    return (
      `This task requires evidence that could not be retrieved from the organisation library. ` +
      (refs.length > 0
        ? `The following referenced documents were not found: ${refs.map(r => `"${r}"`).join(", ")}. `
        : "") +
      "Extended evidence discovery is not available in this environment. " +
      "Please upload the relevant documents to the Knowledge Library and re-run this task."
    );
  }

  if (discoveryResult?.allCandidatesRejected) {
    return (
      `This task requires evidence that could not be verified as authoritative. ` +
      `${discoveryResult.candidatesReturned} source(s) were discovered but all were rejected ` +
      `by the evidence authority gate (rejection reasons: ` +
      `${discoveryResult.rejected.map(r => r.rejectionReason).join(", ")}). ` +
      "Please contact your administrator if you believe this is incorrect."
    );
  }

  switch (status) {
    case "SOURCE_NOT_AVAILABLE":
      return (
        "This task requires knowledge library evidence to proceed, but no relevant documents " +
        "were found. Please upload the relevant policy or procedure documents and re-run this task."
      );
    case "INSUFFICIENT_COVERAGE":
      return (
        "The retrieved evidence does not provide sufficient coverage for this task. " +
        "Please ensure the relevant documents are approved and indexed in the Knowledge Library."
      );
    case "UNRESOLVED_REFERENCE": {
      const refs = sufficiency.unresolvedReferences?.map(r => r.referencedTitle) ?? [];
      return (
        `The following documents are referenced by the retrieved evidence but are not in the ` +
        `Knowledge Library: ${refs.map(r => `"${r}"`).join(", ")}. ` +
        "Please upload these documents to the Knowledge Library and re-run this task."
      );
    }
    case "EXTERNAL_AUTHORITY_REQUIRED":
      return (
        "This task requires external regulatory or legislative evidence that could not be " +
        "retrieved. Please contact your administrator to configure external evidence discovery."
      );
    case "LOW_CONFIDENCE":
      return (
        "The retrieved evidence scored below the minimum confidence threshold. " +
        "Please check that the relevant documents are approved and contain sufficient content."
      );
    default:
      return (
        `Evidence retrieval was insufficient (status: ${status}). ` +
        "Please review your Knowledge Library and re-run this task."
      );
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function selectAdapter(
  scope: EvidenceEscalationDecision["allowedDiscoveryScope"],
  adapters: IEvidenceDiscoveryAdapter[],
): IEvidenceDiscoveryAdapter | null {
  if (scope === "none") return null;
  // Select the first available adapter (CloudOpenClawDiscoveryAdapter when broker is reachable).
  // When nothing is available fall back to nullDiscoveryAdapter — it returns
  // isAvailable()=false, and the orchestrator returns an empty result so execution
  // continues with KRS evidence only.
  return adapters.find(a => a.isAvailable()) ?? nullDiscoveryAdapter;
}

function enforceLimits(
  candidates: CandidateEvidence[],
  escalation: EvidenceEscalationDecision,
): CandidateEvidence[] {
  // Enforce maxSources × maxPassages = hard cap on candidates
  const maxCandidates = escalation.maxSources * escalation.maxPassages;

  // Sort by relevanceScore DESC before truncating so we keep the best ones
  const sorted = [...candidates].sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Also enforce scope: discard external candidates when scope is internal-only
  const scopeFiltered = sorted.filter(c => {
    if (escalation.allowedDiscoveryScope === "internal_references_only" && c.isExternal) {
      return false;
    }
    if (escalation.allowedDiscoveryScope === "external_authority_only" && !c.isExternal) {
      return false;
    }
    return true;
  });

  return scopeFiltered.slice(0, maxCandidates);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}
