/**
 * Sprint 29N.6 — Part D: Candidate Evidence Contract
 *
 * OpenClaw must never write directly into an EvidencePack. Every discovered
 * item first becomes a CandidateEvidence record and must pass through the
 * NeedsOps Authority Gate before it can become AcceptedEvidence and be
 * merged into the EvidencePack.
 *
 * OpenClaw confidence is ADVISORY ONLY — it MUST NOT become the NeedsOps
 * authority score. Authority is determined solely by the Authority Gate.
 */

// ─── Candidate Evidence ───────────────────────────────────────────────────────

/**
 * Raw evidence discovered by an evidence discovery adapter (Cloud or Hybrid).
 * This is the adapter's claim — it has not yet been validated by NeedsOps.
 */
export interface CandidateEvidence {
  // ── Identity ──────────────────────────────────────────────────────────────
  /** Organisation that owns the execution triggering this discovery */
  organisationId: string;
  /** Execution this discovery is associated with */
  executionId: string;
  /** Unique identifier for this discovered item (UUID per candidate) */
  discoveryId: string;

  // ── Classification ────────────────────────────────────────────────────────
  /**
   * Broad source type for routing through the correct acceptance checks.
   * Internal sources go through tenant/approval/version checks.
   * External sources go through Authority Registry checks.
   */
  sourceType:
    | "organisational"          // internal org library document
    | "external_legislation"    // statute, act, or statutory instrument
    | "external_regulation"     // regulatory rule or guidance from a body
    | "external_guidance"       // government or industry guidance document
    | "external_standard"       // ISO, BSI, PCI-DSS, or similar standard
    | "external_case_law"       // court ruling or tribunal decision
    | "unknown_external";       // unclassified — requires governance decision

  /** True when the candidate comes from outside the organisational library */
  isExternal: boolean;

  // ── Internal document references (organisational sources only) ───────────
  /**
   * knowledge_sources.id — populated when the adapter found a reference to
   * an existing knowledge source in the org library.
   */
  internalSourceId?: string;
  /**
   * knowledge_source_versions.id — populated when a specific version can
   * be identified. Required for provenance integrity.
   */
  internalSourceVersionId?: string;
  /**
   * knowledge_chunks.id — populated when the adapter located a specific chunk.
   * May be absent for cross-reference discoveries that named a document but
   * could not resolve it to a specific chunk.
   */
  internalChunkId?: string;

  // ── External source identity ──────────────────────────────────────────────
  /** URL of the external source, required for all external candidates */
  sourceUrl?: string;
  /** Registered domain of the publisher (e.g. "legislation.gov.uk") */
  publisherDomain?: string;
  /** Publisher name claimed by the adapter (e.g. "UK Parliament") */
  claimedPublisher?: string;
  /**
   * Jurisdiction where this authority applies.
   * Examples: "UK", "EU", "England_and_Wales", "Scotland", "US-Federal"
   */
  jurisdiction?: string;

  // ── Content ───────────────────────────────────────────────────────────────
  /** Human-readable title of the source document */
  sourceTitle: string;
  /**
   * Exact verbatim passage supporting the evidence claim.
   * Must be an actual excerpt, not a paraphrase or summary.
   */
  supportingPassage: string;
  /**
   * SHA-256 hex hash of supportingPassage.
   * Used by the Authority Gate for integrity verification.
   */
  passageHash: string;

  // ── Attribution & retrieval metadata ─────────────────────────────────────
  /** ISO-8601 timestamp of when this candidate was discovered */
  retrievalTimestamp: string;
  /**
   * Method used to discover this candidate.
   * Examples: "multi_hop_reference", "external_authority_search",
   *           "semantic_cross_reference", "url_fetch"
   */
  retrievalMethod: string;
  /**
   * Human-readable explanation of why this candidate was discovered.
   * E.g. "Chunk text contained 'see the Escalation Procedure' which was not
   *       present in the Evidence Pack"
   */
  discoveryReason: string;
  /**
   * The exact cross-reference text that triggered discovery of this candidate,
   * if this candidate was found by following a document reference.
   * E.g. "see the HR Disciplinary Procedure"
   */
  unresolvedReferenceContext?: string;

  // ── Authority metadata (claimed by adapter — NOT yet validated) ───────────
  /**
   * Type of external authority claimed by the adapter.
   * Maps to AuthorityRegistry categories. Advisory only until gate validates.
   */
  authorityType?: "legislation" | "regulation" | "government_guidance" | "standard" | "case_law";
  /** ISO-8601 date the document was published, if known */
  publicationDate?: string;
  /** ISO-8601 date from which the document was effective, if known */
  effectiveDate?: string;

  // ── Scores (advisory only) ────────────────────────────────────────────────
  /**
   * The discovery adapter's confidence that this candidate is relevant.
   * ADVISORY ONLY — MUST NOT become a NeedsOps authority score.
   * The Authority Gate determines the actual authority class.
   */
  openClawConfidence: number;
  /**
   * Relevance score to the user's request (0–1).
   * Used for candidate ranking only, not for authority decisions.
   */
  relevanceScore: number;

  // ── Content metadata ──────────────────────────────────────────────────────
  /**
   * Content type of the discovered evidence.
   * Examples: "policy", "legislation", "procedure", "guidance", "standard"
   */
  contentType: string;
  /**
   * Where the adapter found this evidence.
   * For internal: "org_library_reference_follow"
   * For external: URL or source description
   */
  accessLocation: string;
}

// ─── Authority Gate output: Accepted Evidence ─────────────────────────────────

/**
 * A CandidateEvidence item that has passed all NeedsOps Authority Gate checks.
 * Only AcceptedEvidence may be merged into the EvidencePack.
 */
export interface AcceptedEvidence {
  /** The candidate that was validated */
  candidate: CandidateEvidence;
  /** ISO-8601 timestamp of acceptance */
  acceptedAt: string;
  /**
   * Authority class assigned by the Authority Gate — this is the NeedsOps
   * authority score, NOT the adapter's openClawConfidence.
   */
  authorityClass: "mandatory" | "primary" | "supporting" | "reference";
  /**
   * Canonical knowledge_sources.id for internal evidence.
   * Null for external sources not yet in the org library.
   */
  canonicalSourceId?: string;
  /**
   * Canonical knowledge_source_versions.id for internal evidence.
   * Required for durable provenance. Null for external sources.
   */
  canonicalVersionId?: string;
  /**
   * Authority Registry entry ID for external evidence.
   * References the Authority Registry entry that vouches for this source.
   */
  authorityRegistryId?: string;
  /** Optional governance note explaining the acceptance decision */
  governanceNote?: string;
}

// ─── Authority Gate output: Rejected Evidence ─────────────────────────────────

/**
 * All rejection reasons that the Authority Gate can return.
 * Rejected candidates MUST NOT reach OpenAI as trusted evidence.
 */
export type EvidenceRejectionReason =
  | "WRONG_TENANT"                 // document belongs to a different organisation
  | "SOURCE_NOT_APPROVED"          // source exists but status !== 'approved'
  | "SOURCE_SUPERSEDED"            // is_current = false
  | "AUTHORITY_UNKNOWN"            // external source not in Authority Registry
  | "AUTHORITY_REJECTED"           // source is in Registry with status='rejected'
  | "OUTDATED"                     // effective date has passed
  | "ACCESS_DENIED"                // sensitivity classification too high
  | "INTEGRITY_FAILURE"            // passage hash mismatch
  | "SOURCE_NOT_FOUND"             // internalSourceId not in DB
  | "JURISDICTION_MISMATCH"        // authority jurisdiction does not apply
  | "INVALID_URL"                  // external URL is malformed or unreachable
  | "EXTERNAL_EVIDENCE_NOT_PERMITTED" // task/blueprint does not allow external evidence
  | "PASSAGE_HASH_MISMATCH"        // passage text no longer matches original hash
  | "TENANT_BOUNDARY_VIOLATION"    // cross-org reference attempt
  | "UNKNOWN_SOURCE_TYPE"          // sourceType not recognised
  | "CONFIDENCE_BELOW_FLOOR";      // relevanceScore too low to be considered

/** A CandidateEvidence item that failed the NeedsOps Authority Gate */
export interface RejectedEvidence {
  /** The candidate that was rejected */
  candidate: CandidateEvidence;
  /** Machine-readable rejection reason */
  rejectionReason: EvidenceRejectionReason;
  /** Human-readable explanation for audit purposes */
  rejectionDetail: string;
  /** ISO-8601 timestamp of rejection */
  rejectedAt: string;
}

// ─── Discovery adapter result ─────────────────────────────────────────────────

/** Result returned by an IEvidenceDiscoveryAdapter.discover() call */
export interface DiscoveryAdapterResult {
  /** Name of the adapter that produced this result */
  adapterName: string;
  /** All raw candidates returned by the adapter, before gate validation */
  candidates: CandidateEvidence[];
  /** Candidates accepted by the NeedsOps Authority Gate */
  accepted: AcceptedEvidence[];
  /** Candidates rejected by the NeedsOps Authority Gate */
  rejected: RejectedEvidence[];
  /** Wall-clock time for the entire discovery + gate cycle (ms) */
  durationMs: number;
  /** Number of document reference hops followed */
  hopsFollowed: number;
}

// ─── Observability record ─────────────────────────────────────────────────────

/**
 * Durable observability record for one evidence-bearing execution.
 * Logged to audit after every evidence resolution cycle, regardless of
 * outcome. Covers Parts B + O requirements.
 *
 * Sprint 29N.11: extended with parallel-discovery fields (all optional for
 * backwards compatibility with Sprint 29N.6 tests).
 */
export interface EvidenceDiscoveryObservability {
  /** Number of chunks in V1 EvidencePack from KRS */
  initialKrsChunks: number;
  /** Sufficiency Gate result on V1 pack */
  initialSufficiencyStatus: string;
  /** Whether the sufficiency gate recommended escalation */
  initialEscalationRecommended?: boolean;
  /** Whether an evidence discovery adapter was invoked */
  escalationOccurred: boolean;
  /** Name of the adapter invoked (null if no escalation) */
  discoveryAdapterName: string | null;
  /** Discovery adapter wall-clock time in ms (null if no escalation) */
  discoveryDurationMs: number | null;
  /** Number of reference hops followed by the adapter */
  hopsFollowed: number;
  /** Total raw candidates returned by the adapter */
  candidatesReturned: number;
  /** Candidates that passed the Authority Gate */
  candidatesAccepted: number;
  /** Candidates that failed the Authority Gate */
  candidatesRejected: number;
  /** Reasons for rejected candidates */
  rejectionReasons: EvidenceRejectionReason[];
  /** Final EvidencePack chunk count (V1 + accepted candidates) */
  finalEvidenceChunks: number;
  /** Sufficiency Gate result on V2 pack (or V1 if no escalation) */
  finalSufficiencyStatus: string;
  /** True if execution continued to OpenAI; false if blocked */
  executionContinued: boolean;
  /** Why execution was blocked, if executionContinued=false */
  blockReason?: string;

  // ── Sprint 29N.11: Parallel discovery observability ───────────────────────
  /** True when Sprint 29N.11 parallel discovery mode ran (KRS + OpenClaw concurrent) */
  parallelDiscoveryMode?: boolean;
  /**
   * True when no OpenClaw adapter was available in this deployment (NullDiscoveryAdapter).
   * KRS continued normally; record kept for observability.
   * Distinct from openClawAvailable=false which means adapter existed but was unavailable
   * at runtime for a deployment-specific reason.
   */
  openClawDiscoveryUnavailable?: boolean;
  /** True when an OpenClaw adapter was available and ran */
  openClawAvailable?: boolean;
  /** Wall-clock time for OpenClaw parallel discovery run (ms) */
  openClawDurationMs?: number | null;
  /** Adapter name for the OpenClaw run */
  openClawAdapterName?: string | null;
  /** Raw KRS chunks in the initial pack */
  krsChunkCount?: number;
  /** Raw candidates returned by OpenClaw adapter before the Authority Gate */
  openClawCandidatesReturned?: number;
  /** OpenClaw candidates accepted by NeedsOps Authority Gate */
  openClawCandidatesAccepted?: number;
  /** OpenClaw candidates rejected by NeedsOps Authority Gate */
  openClawCandidatesRejected?: number;
  /** Items discovered by BOTH KRS and OpenClaw (deduplicated in merged pack) */
  deduplicatedItems?: number;
  /** Number of contradictions detected between KRS and OpenClaw results */
  contradictionsDetected?: number;
  /** Whether external web search was permitted for this execution */
  allowExternalWebSearch?: boolean;
}
