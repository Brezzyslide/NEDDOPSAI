/**
 * absenceVerificationService — Sprint 29K.4 (Claim Integrity Hardening)
 *
 * Targeted absence verification for absence_finding claims.
 *
 * Sprint 29K.3 constraint: the single bulk retrieval at execution start cannot
 * prove absence — "nothing was retrieved" ≠ "the requirement is absent."
 *
 * Sprint 29K.4 solution: for each absence_finding claim, perform targeted
 * follow-up retrieval using a concept-expanded search term family specific
 * to that claim.
 *
 * Design constraints:
 *   - Only runs for absence_finding claims, not ordinary positive claims.
 *   - Query count is bounded (MAX_QUERIES_PER_CLAIM).
 *   - Retrieval failure → unverified_absence, never verified_absence.
 *   - Incomplete source ingestion → unverified_absence, never verified_absence.
 *   - Finding ANY relevant passage → contradicted_absence.
 *   - confidenceOfAbsence derived only from measurable signals — null if underiable.
 *   - Scope overreach (org-wide claim from single-doc search) → unverified_absence.
 *   - Cross-tenant chunks rejected before any outcome is recorded.
 *
 * Search term generation:
 *   Deterministic synonym/concept expansion using a bounded rule set.
 *   No LLM. No external service. Results are reproducible.
 *
 * Persistence:
 *   Updated AbsenceEvidenceRecord is written back to the ValidatedClaim.
 *   claimPersistenceService.persistClaims() then stores it in the
 *   completed_work_claims.absence_record JSONB column.
 */

import { retrieveChunks } from "./hybridRetrievalService.js";
import { detectScopeOverreach } from "./semanticSupportValidator.js";
import type { EvidencePack, EvidenceChunk } from "./knowledgeResolutionService.js";
import type { ValidatedClaim } from "./claimValidationService.js";
import type { AbsenceEvidenceRecord, AbsenceCandidateRecord } from "@workspace/db";
import { classifyAbsenceCandidate } from "./absenceCandidateClassifier.js";
import { db } from "@workspace/db";
import {
  knowledgeSourceVersionsTable,
} from "@workspace/db";
import { and, inArray, eq } from "drizzle-orm";

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Maximum number of queries per absence claim. */
const MAX_QUERIES_PER_CLAIM = 8;

/** Minimum score for a chunk to be considered a relevant match. */
const ABSENCE_MATCH_THRESHOLD = 0.35;

/** Ingestion statuses that indicate the source is fully indexed and searchable. */
const FULLY_INGESTED_STATUSES = new Set([
  "complete",
  "completed",
  "fully_ingested",
  "processed",
  "published",
]);

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SourceCoverageItem {
  sourceId: string;
  sourceVersionId: string;
  sourceTitle: string;
  fullyIngested: boolean;
  searchable: boolean;
}

export interface AbsenceVerificationInput {
  claim: ValidatedClaim;
  organisationId: string;
  specialistCode: string | null;
  evidencePack: EvidencePack;
}

export interface AbsenceVerificationResult {
  updatedAbsenceRecord: AbsenceEvidenceRecord;
  verificationStatus: "verified_absence" | "unverified_absence" | "contradicted_absence";
}

// ─── Search term expansion ─────────────────────────────────────────────────────

/**
 * Generate a bounded concept-search family from an absence claim.
 *
 * Rules:
 * 1. Extract the core missing element from the claim text.
 * 2. Expand using a deterministic synonym/concept map.
 * 3. Limit to MAX_QUERIES_PER_CLAIM terms.
 *
 * Concept pairs are hand-coded from compliance/policy domain knowledge.
 * No LLM, no external API.
 */
export function generateAbsenceSearchTerms(claimText: string): string[] {
  const text = claimText.toLowerCase();
  const terms: string[] = [];

  // Always include the claim text itself as the primary query
  terms.push(claimText);

  // Concept expansion rules (domain: compliance, policy, HR, NDIS, risk)
  const CONCEPT_EXPANSIONS: Array<{ triggers: string[]; expansions: string[] }> = [
    {
      triggers: ["escalation timeframe", "escalation time limit", "escalation deadline"],
      expansions: [
        "escalation timeframe",
        "escalation time limit",
        "escalation deadline",
        "escalation period",
        "referral timeframe",
        "management escalation",
        "escalation procedure",
        "high severity escalation",
      ],
    },
    {
      triggers: ["escalation", "escalat"],
      expansions: [
        "escalation timeframe",
        "escalation procedure",
        "escalation responsibility",
        "escalation decision",
        "referral process",
        "management review timeline",
      ],
    },
    {
      triggers: ["appeal", "review mechanism", "review process"],
      expansions: [
        "appeal process",
        "review mechanism",
        "complaint review",
        "appeals procedure",
        "external review",
        "independent review",
        "right of review",
        "internal review",
      ],
    },
    {
      triggers: ["responsible", "responsibility", "decision-maker", "decision maker", "accountability"],
      expansions: [
        "responsible officer",
        "accountability",
        "decision-maker",
        "ownership",
        "assigned responsibility",
        "who is responsible",
        "role responsibility",
      ],
    },
    {
      triggers: ["acknowledgement", "acknowledge"],
      expansions: [
        "acknowledgement timeframe",
        "response timeframe",
        "acknowledge complaint",
        "initial response",
        "receipt confirmation",
      ],
    },
    {
      triggers: ["resolution", "resolve", "closure"],
      expansions: [
        "resolution timeframe",
        "closure deadline",
        "resolution period",
        "complaint resolution",
        "complaint closure",
      ],
    },
    {
      triggers: ["policy", "procedure", "process"],
      expansions: [
        "policy requirement",
        "procedural requirement",
        "documented process",
        "process definition",
      ],
    },
    {
      triggers: ["timeframe", "time limit", "deadline", "period"],
      expansions: [
        "business days",
        "working days",
        "calendar days",
        "response time",
        "time limit",
        "within",
        "no later than",
      ],
    },
  ];

  // Apply concept expansions
  for (const rule of CONCEPT_EXPANSIONS) {
    const matched = rule.triggers.some((trigger) => text.includes(trigger));
    if (matched) {
      for (const expansion of rule.expansions) {
        if (!terms.includes(expansion)) {
          terms.push(expansion);
        }
      }
    }
  }

  // Deduplicate and bound
  const deduplicated = [...new Set(terms)];
  return deduplicated.slice(0, MAX_QUERIES_PER_CLAIM);
}

// ─── Source coverage check ────────────────────────────────────────────────────

/**
 * Checks ingestion status for source versions in the EvidencePack.
 * A source is "fully ingested" only when its ingestionStatus is in FULLY_INGESTED_STATUSES.
 * A source with status "pending" or unknown is not searchable for absence verification.
 */
export async function checkSourceCoverage(
  evidencePack: EvidencePack,
  organisationId: string,
): Promise<SourceCoverageItem[]> {
  const uniqueVersionIds = [
    ...new Set(
      evidencePack.chunks
        .filter((c) => c.sourceVersionId !== null)
        .map((c) => c.sourceVersionId as string),
    ),
  ];

  if (uniqueVersionIds.length === 0) return [];

  let rows: Array<{ id: string; ingestionStatus: string }> = [];
  try {
    rows = await db
      .select({
        id: knowledgeSourceVersionsTable.id,
        ingestionStatus: knowledgeSourceVersionsTable.ingestionStatus,
      })
      .from(knowledgeSourceVersionsTable)
      .where(
        and(
          inArray(knowledgeSourceVersionsTable.id, uniqueVersionIds),
          eq(knowledgeSourceVersionsTable.organizationId, organisationId),
        ),
      );
  } catch {
    // DB failure → treat all as not fully ingested (conservative)
    return uniqueVersionIds.map((vid) => {
      const chunk = evidencePack.chunks.find((c) => c.sourceVersionId === vid);
      return {
        sourceId: chunk?.sourceId ?? "unknown",
        sourceVersionId: vid,
        sourceTitle: chunk?.sourceTitle ?? "unknown",
        fullyIngested: false,
        searchable: false,
      };
    });
  }

  const statusMap = new Map(rows.map((r) => [r.id, r.ingestionStatus]));

  // Build coverage items grouped by sourceVersionId (using first chunk found)
  const seen = new Set<string>();
  const coverage: SourceCoverageItem[] = [];

  for (const chunk of evidencePack.chunks) {
    if (!chunk.sourceVersionId || seen.has(chunk.sourceVersionId)) continue;
    seen.add(chunk.sourceVersionId);

    const status = statusMap.get(chunk.sourceVersionId) ?? "pending";
    const fullyIngested = FULLY_INGESTED_STATUSES.has(status.toLowerCase());

    coverage.push({
      sourceId: chunk.sourceId,
      sourceVersionId: chunk.sourceVersionId,
      sourceTitle: chunk.sourceTitle,
      fullyIngested,
      searchable: fullyIngested,
    });
  }

  return coverage;
}

// ─── Confidence calculation ────────────────────────────────────────────────────

/**
 * Computes a transparent confidence-of-absence score from measurable signals.
 *
 * Returns null when confidence cannot be defensibly derived:
 * - Any source is not fully ingested
 * - retrieval failure occurred
 * - contradictory evidence was found
 *
 * Score components:
 *   +0.30  all sources fully ingested
 *   +0.20  ≥3 query variants executed
 *   +0.20  ≥5 query variants executed
 *   +0.20  all candidates below threshold (no close matches)
 *   +0.10  top relevance score below 0.20 (very low similarity)
 *
 * Hard ceiling: 1.0. Only reaches 1.0 if all signals are strong.
 * This is NOT a model confidence score. It is derived from retrieval signals only.
 */
export function calculateConfidenceOfAbsence(params: {
  allSourcesFullyIngested: boolean;
  queriesExecuted: number;
  totalCandidates: number;
  passedThresholdCount: number;
  topRelevanceScore: number;
  hadRetrievalFailure: boolean;
  contradictoryEvidenceFound: boolean;
}): number | null {
  const {
    allSourcesFullyIngested,
    queriesExecuted,
    totalCandidates,
    passedThresholdCount,
    topRelevanceScore,
    hadRetrievalFailure,
    contradictoryEvidenceFound,
  } = params;

  // Hard blockers — cannot defensibly derive confidence
  if (!allSourcesFullyIngested || hadRetrievalFailure || contradictoryEvidenceFound) {
    return null;
  }

  let score = 0;

  // Source coverage signal
  score += 0.30; // All sources fully ingested

  // Query breadth signal
  if (queriesExecuted >= 3) score += 0.20;
  if (queriesExecuted >= 5) score += 0.20;

  // Result signal — no candidates passed threshold
  if (passedThresholdCount === 0) score += 0.20;

  // Relevance signal — top score is very low
  if (totalCandidates === 0 || topRelevanceScore < 0.20) score += 0.10;

  return Math.min(1.0, parseFloat(score.toFixed(2)));
}

// ─── Scope label builder ──────────────────────────────────────────────────────

function buildScopeLabel(coverage: SourceCoverageItem[]): string {
  if (coverage.length === 0) return "no documents in evidence scope";
  const titles = coverage.map((c) => c.sourceTitle).filter(Boolean);
  if (titles.length === 1) return `document scope: "${titles[0]}"`;
  if (titles.length <= 3) return `document scope: ${titles.map((t) => `"${t}"`).join(", ")}`;
  return `document scope: ${titles.length} documents including "${titles[0]}"`;
}

// ─── Main: targeted absence verification ──────────────────────────────────────

/**
 * Performs targeted absence verification for a single absence_finding claim.
 *
 * Process:
 * 1. Generate concept-expanded search term family
 * 2. Check source coverage (ingestion status)
 * 3. Execute bounded queries against the org library
 * 4. Detect contradictory evidence (any result above threshold)
 * 5. Validate scope (organisation-wide claims cannot be proven from one document)
 * 6. Calculate confidence
 * 7. Return extended AbsenceEvidenceRecord
 */
export async function performTargetedAbsenceSearch(
  input: AbsenceVerificationInput,
): Promise<AbsenceVerificationResult> {
  const { claim, organisationId, specialistCode, evidencePack } = input;

  const searchTerms = generateAbsenceSearchTerms(claim.claimText);
  const sourceCoverage = await checkSourceCoverage(evidencePack, organisationId);

  const sourceScope = [...new Set(evidencePack.chunks.map((c) => c.sourceId))];
  const sourceVersionScope = [
    ...new Set(
      evidencePack.chunks
        .filter((c) => c.sourceVersionId !== null)
        .map((c) => c.sourceVersionId as string),
    ),
  ];
  const scopeLabel = buildScopeLabel(sourceCoverage);
  const allSourcesFullyIngested = sourceCoverage.length > 0 && sourceCoverage.every((s) => s.fullyIngested);

  // Scope overreach check — before running queries
  const scopeRisk = detectScopeOverreach(claim.claimText, sourceScope.length);
  if (scopeRisk.risk === "scope_overreach") {
    const record: AbsenceEvidenceRecord = {
      searchTerms,
      sourceScope,
      sourceVersionScope,
      scopeLabel,
      retrievalFilters: {
        specialistCode: specialistCode ?? null,
        scopeMode: "org_library",
        retrievalMethod: "lexical",
        minConfidenceThreshold: ABSENCE_MATCH_THRESHOLD,
      },
      sourceCoverage,
      sectionsExamined: [],
      totalCandidatesRetrieved: 0,
      passedThresholdCount: 0,
      topRelevanceScores: [],
      matchingRequirementFound: false,
      contradictoryEvidenceLinkIds: [],
      confidenceOfAbsence: null,
      verificationStatus: "unverified_absence",
      scopeOverreachDetected: true,
      scopeOverreachReason: scopeRisk.signals[0] ?? "Scope overreach detected",
    };
    return { updatedAbsenceRecord: record, verificationStatus: "unverified_absence" };
  }

  // If no sources are fully ingested, skip queries — cannot prove absence
  if (!allSourcesFullyIngested && sourceCoverage.length > 0) {
    const record: AbsenceEvidenceRecord = {
      searchTerms,
      sourceScope,
      sourceVersionScope,
      scopeLabel,
      retrievalFilters: {
        specialistCode: specialistCode ?? null,
        scopeMode: "org_library",
        retrievalMethod: "lexical",
        minConfidenceThreshold: ABSENCE_MATCH_THRESHOLD,
      },
      sourceCoverage,
      sectionsExamined: [],
      totalCandidatesRetrieved: 0,
      passedThresholdCount: 0,
      topRelevanceScores: [],
      matchingRequirementFound: false,
      contradictoryEvidenceLinkIds: [],
      confidenceOfAbsence: null,
      verificationStatus: "unverified_absence",
    };
    return { updatedAbsenceRecord: record, verificationStatus: "unverified_absence" };
  }

  // Execute bounded queries
  let totalCandidates = 0;
  let passedThreshold = 0;
  const topScores: number[] = [];
  const sectionsExamined: string[] = [];
  const contradictoryChunkIds: string[] = [];
  const allCandidateRecords: AbsenceCandidateRecord[] = []; // Sprint 29K.4.1
  const evidencePackChunkIds = new Set(evidencePack.chunks.map((c) => c.chunkId));
  let hadRetrievalFailure = false;
  let queriesExecuted = 0;

  for (const term of searchTerms) {
    if (queriesExecuted >= MAX_QUERIES_PER_CLAIM) break;

    let results: Awaited<ReturnType<typeof retrieveChunks>> = [];
    try {
      results = await retrieveChunks({
        organisationId,
        query: term,
        queryEmbedding: null,
        scopeMode: "org_library",
        limit: 10,
        specialistId: specialistCode ?? undefined,
      });
      queriesExecuted++;
    } catch {
      hadRetrievalFailure = true;
      continue;
    }

    totalCandidates += results.length;

    for (const r of results) {
      topScores.push(r.baseScore);

      if (r.baseScore >= ABSENCE_MATCH_THRESHOLD) {
        passedThreshold++;

        // Sprint 29K.4.1: RETRIEVAL RELEVANCE ≠ REQUIREMENT PRESENT.
        // Classify the candidate to determine whether it actually establishes
        // the specific missing element — not just that it's topic-relevant.
        const candidateResult = classifyAbsenceCandidate(claim.claimText, r.text ?? "");

        const candidateRecord: AbsenceCandidateRecord = {
          chunkId:                  r.id,
          relevanceScore:           r.baseScore,
          candidateClassification:  candidateResult.classification,
          matchedElement:           candidateResult.matchedElement,
          reasonCodes:              candidateResult.reasonCodes,
        };
        allCandidateRecords.push(candidateRecord);

        // Only REQUIREMENT_PRESENT triggers contradicted_absence.
        // requirement_absent_or_pending, context_only, ambiguous → NOT contradicted_absence.
        if (candidateResult.classification === "requirement_present") {
          contradictoryChunkIds.push(r.id);
        }

        if (r.sectionTitle && !sectionsExamined.includes(r.sectionTitle)) {
          sectionsExamined.push(r.sectionTitle);
        }
      }
    }
  }

  // Determine outcome
  const contradictoryEvidenceFound = contradictoryChunkIds.length > 0;
  const topN = topScores.sort((a, b) => b - a).slice(0, 5);

  let verificationStatus: "verified_absence" | "unverified_absence" | "contradicted_absence";
  if (contradictoryEvidenceFound) {
    verificationStatus = "contradicted_absence";
  } else if (hadRetrievalFailure || !allSourcesFullyIngested) {
    verificationStatus = "unverified_absence";
  } else {
    verificationStatus = "verified_absence";
  }

  const confidenceOfAbsence = calculateConfidenceOfAbsence({
    allSourcesFullyIngested,
    queriesExecuted,
    totalCandidates,
    passedThresholdCount: passedThreshold,
    topRelevanceScore: topN[0] ?? 0,
    hadRetrievalFailure,
    contradictoryEvidenceFound,
  });

  const record: AbsenceEvidenceRecord = {
    searchTerms: searchTerms.slice(0, queriesExecuted + 1), // only what was actually used
    sourceScope,
    sourceVersionScope,
    scopeLabel,
    retrievalFilters: {
      specialistCode: specialistCode ?? null,
      scopeMode: "org_library",
      retrievalMethod: "lexical",
      minConfidenceThreshold: ABSENCE_MATCH_THRESHOLD,
    },
    sourceCoverage,
    sectionsExamined,
    totalCandidatesRetrieved: totalCandidates,
    passedThresholdCount: passedThreshold,
    topRelevanceScores: topN,
    matchingRequirementFound: contradictoryEvidenceFound,
    candidates: allCandidateRecords,               // Sprint 29K.4.1
    contradictoryEvidenceLinkIds: [...new Set(contradictoryChunkIds)],
    confidenceOfAbsence,
    verificationStatus,
  };

  return { updatedAbsenceRecord: record, verificationStatus };
}

// ─── Batch entry point ────────────────────────────────────────────────────────

/**
 * Runs targeted absence verification for all absence_finding claims in a batch.
 *
 * Returns a new array of ValidatedClaims with absenceRecord and provenanceStatus
 * updated in-place.
 *
 * Failures are fail-soft: a single claim's failure does not block other claims.
 * A failed claim remains "unverified_absence".
 */
export async function performAbsenceVerificationBatch(params: {
  claims: ValidatedClaim[];
  organisationId: string;
  specialistCode: string | null;
  evidencePack: EvidencePack;
}): Promise<void> {
  const { claims, organisationId, specialistCode, evidencePack } = params;

  const absenceClaims = claims.filter((c) => c.claimType === "absence_finding");

  await Promise.allSettled(
    absenceClaims.map(async (claim) => {
      try {
        const result = await performTargetedAbsenceSearch({
          claim,
          organisationId,
          specialistCode,
          evidencePack,
        });
        // Mutate in-place (claims array is already post-validation)
        claim.absenceRecord = result.updatedAbsenceRecord;
        claim.provenanceStatus = result.verificationStatus;
      } catch {
        // Fail-soft: leave as unverified_absence
        claim.validationFailures.push(
          "Targeted absence verification failed — status remains unverified_absence",
        );
      }
    }),
  );
}
