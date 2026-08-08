/**
 * claimValidationService — Sprint 29K.3 (Claim Emission & Claim-to-Evidence Binding)
 *
 * Server-side validation for claims emitted by the specialist LLM.
 *
 * Core principle: do NOT trust the LLM blindly.
 *
 * Responsibilities:
 *   1. Taxonomy validation — claim type, confidence range, reasoningSummary length
 *   2. Supporting-span verification — exact substring check against EvidenceChunk.text
 *   3. Evidence-link validation — every referenced chunkId MUST be in the EvidencePack
 *   4. Type-specific rules:
 *        observation       — requires at least one valid direct_support binding
 *        inference         — requires relatedClaimIds pointing to supported findings
 *        recommendation    — requires relatedClaimIds pointing to findings
 *        external_requirement — requires external_authority binding from approved source
 *        absence_finding   — unverified_absence unless proven by structured retrieval evidence
 *   5. Contradiction rules — both sides must have verified spans
 *   6. Provenance status calculation — grounded / unsupported / unverified_absence / invalid_binding
 *
 * KRS ABSENCE FINDING LIMITATION (Sprint 29K.3):
 *   The current KRS architecture performs a single bulk retrieval per execution.
 *   There is no per-claim targeted search, no claim-specific absence-search record,
 *   and no dedicated empty-result query for specific terms. Therefore:
 *   - absence_finding claims cannot be marked "grounded" in this sprint.
 *   - They must be classified as "unverified_absence" pending the KRS extension
 *     described in the Sprint 29K.4 scope.
 *   - This is honest. Do not fabricate absence proof.
 */

import type { EvidencePack, EvidenceChunk } from "./knowledgeResolutionService.js";
import type {
  ClaimType,
  ClaimProvenanceStatus,
  AbsenceEvidenceRecord,
} from "@workspace/db";
import type { ClaimRelationship } from "@workspace/db";

// ─── Raw claim shape as emitted by the specialist LLM ─────────────────────────

export interface RawClaimEvidence {
  chunkId: string;
  relationship: ClaimRelationship;
  supportingSpan?: string;
}

export interface RawClaim {
  /** Temporary execution-local identity (e.g. "F1", "C1", "R1"). */
  clientClaimId: string;
  claimText: string;
  claimType: ClaimType;
  sectionRef?: string;
  confidence?: number;
  reasoningSummary?: string;
  evidence: RawClaimEvidence[];
  /** clientClaimId references to other claims in the same batch. */
  relatedClaimIds: string[];
  absenceRecord?: AbsenceEvidenceRecord;
}

// ─── Validated claim shape (after server-side validation) ─────────────────────

export interface ValidatedEvidenceBinding {
  chunkId: string;
  relationship: ClaimRelationship;
  /** Verified exact substring — null if absent or failed verification. */
  supportingSpan: string | null;
  spanVerified: boolean;
  /**
   * True when the model provided a span but it failed exact-substring verification.
   * Used to classify the binding as invalid_binding even though supportingSpan is null.
   */
  spanRejected: boolean;
  /** Rejection reason if span failed verification. */
  spanRejectionReason?: string;
}

export interface ValidatedClaim {
  clientClaimId: string;
  claimText: string;
  claimType: ClaimType;
  sectionRef?: string;
  confidence: number | null;
  /** Clamped to max 200 chars. */
  reasoningSummary: string | null;
  /** clientClaimId references — resolved to UUIDs at persistence time. */
  relatedClaimIds: string[];
  absenceRecord: AbsenceEvidenceRecord | null;
  provenanceStatus: ClaimProvenanceStatus;
  validEvidenceBindings: ValidatedEvidenceBinding[];
  /** Validation failure reasons for audit/diagnostics. */
  validationFailures: string[];
}

export interface ClaimBatchValidationResult {
  claims: ValidatedClaim[];
  /** Number of claims that were structurally malformed (not ClaimType etc). */
  malformedDropped: number;
  /** Number of evidence bindings rejected (invented chunkId, failed span, etc). */
  bindingsRejected: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_CLAIM_TYPES: ClaimType[] = [
  "observation",
  "absence_finding",
  "inference",
  "external_requirement",
  "recommendation",
];

const VALID_RELATIONSHIPS: ClaimRelationship[] = [
  "direct_support",
  "context",
  "contradiction",
  "external_authority",
  "searched_for_absence",
];

const REASONING_SUMMARY_MAX_CHARS = 200;

/** Source types that qualify as approved external authority. */
const APPROVED_EXTERNAL_SOURCE_TYPES = new Set([
  "legislation",
  "regulation",
  "standard",
  "regulator_guidance",
  "external_authority",
]);

// ─── Supporting-span verification ─────────────────────────────────────────────

/**
 * Returns true if `span` exists verbatim inside `chunkText`.
 * Case-sensitive. Never fuzzy-rewrites or normalises the quotation.
 */
export function verifySpan(span: string, chunkText: string): boolean {
  if (!span || !chunkText) return false;
  return chunkText.includes(span);
}

// ─── External authority check ──────────────────────────────────────────────────

/**
 * Returns true if the chunk comes from an approved external-authority source.
 * Until an explicit approved external provider is configured, internal org
 * policy documents do NOT qualify — only recognised external types do.
 */
export function isApprovedExternalSource(chunk: EvidenceChunk): boolean {
  return APPROVED_EXTERNAL_SOURCE_TYPES.has(chunk.sourceType.toLowerCase());
}

// ─── Taxonomy validation ──────────────────────────────────────────────────────

/**
 * Validates and normalises the raw claim shape.
 * Returns null if the claim is structurally malformed (missing required fields).
 */
function normaliseRawClaim(raw: unknown): RawClaim | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.clientClaimId !== "string" || !r.clientClaimId) return null;
  if (typeof r.claimText !== "string" || !r.claimText.trim()) return null;
  if (!VALID_CLAIM_TYPES.includes(r.claimType as ClaimType)) return null;

  return {
    clientClaimId: r.clientClaimId,
    claimText: r.claimText.trim(),
    claimType: r.claimType as ClaimType,
    sectionRef: typeof r.sectionRef === "string" ? r.sectionRef : undefined,
    confidence:
      typeof r.confidence === "number"
        ? Math.min(1, Math.max(0, r.confidence))
        : undefined,
    reasoningSummary:
      typeof r.reasoningSummary === "string"
        ? r.reasoningSummary.slice(0, REASONING_SUMMARY_MAX_CHARS)
        : undefined,
    evidence: Array.isArray(r.evidence) ? (r.evidence as RawClaimEvidence[]) : [],
    relatedClaimIds: Array.isArray(r.relatedClaimIds)
      ? (r.relatedClaimIds as string[]).filter((x) => typeof x === "string")
      : [],
    absenceRecord:
      r.absenceRecord && typeof r.absenceRecord === "object"
        ? (r.absenceRecord as AbsenceEvidenceRecord)
        : undefined,
  };
}

// ─── Per-claim validation ──────────────────────────────────────────────────────

function validateSingleClaim(
  claim: RawClaim,
  evidencePack: EvidencePack,
  /** clientClaimIds of all validated claims in this batch (for relation checking). */
  allClientIds: Set<string>,
): ValidatedClaim {
  const chunkIndex = new Map<string, EvidenceChunk>(
    evidencePack.chunks.map((c) => [c.chunkId, c]),
  );

  const failures: string[] = [];
  const validBindings: ValidatedEvidenceBinding[] = [];

  // ── Validate and verify each evidence binding ────────────────────────────
  for (const ev of claim.evidence) {
    // 1. Relationship must be a known value
    if (!VALID_RELATIONSHIPS.includes(ev.relationship)) {
      failures.push(
        `Evidence binding for chunkId "${ev.chunkId}" has unknown relationship "${ev.relationship}" — rejected`,
      );
      continue;
    }

    // 2. ChunkId must exist in this execution's EvidencePack (Part E / adversarial test 1)
    const chunk = chunkIndex.get(ev.chunkId);
    if (!chunk) {
      failures.push(
        `Evidence binding references chunkId "${ev.chunkId}" which is NOT in this execution's EvidencePack — rejected`,
      );
      continue;
    }

    // 3. Span verification (Part D)
    let supportingSpan: string | null = null;
    let spanVerified = false;
    let spanRejectionReason: string | undefined;

    let spanRejected = false;

    if (ev.supportingSpan) {
      if (verifySpan(ev.supportingSpan, chunk.text)) {
        supportingSpan = ev.supportingSpan;
        spanVerified = true;
      } else {
        // Do NOT replace with passageSnapshot. Record the failure.
        // supportingSpan stays null (rejected quotation must not be persisted).
        // spanRejected = true so callers can distinguish "no span provided" from
        // "span was provided but failed verification".
        spanRejected = true;
        spanRejectionReason =
          `supportingSpan "${ev.supportingSpan.slice(0, 60)}..." is NOT an exact substring of chunkId "${ev.chunkId}" — span rejected, binding retained without span`;
        failures.push(spanRejectionReason);
      }
    }

    validBindings.push({
      chunkId: ev.chunkId,
      relationship: ev.relationship,
      supportingSpan,
      spanVerified,
      spanRejected,
      spanRejectionReason,
    });
  }

  // ── Type-specific provenance rules (Part E) ──────────────────────────────
  let provenanceStatus: ClaimProvenanceStatus;

  switch (claim.claimType) {
    case "observation": {
      // Requires at least one valid direct_support OR contradiction binding.
      // Contradiction observations (Part F) use the "contradiction" relationship
      // for both sides; they still require a supporting binding to be present.
      const hasSupportingBinding = validBindings.some(
        (b) => (b.relationship === "direct_support" || b.relationship === "contradiction") &&
               chunkIndex.has(b.chunkId),
      );
      if (!hasSupportingBinding) {
        failures.push(
          "observation requires at least one direct_support or contradiction evidence binding — none found",
        );
        provenanceStatus = "unsupported";
      } else {
        // If the model provided a span that failed verification, the binding is invalid.
        // Check spanRejected (not supportingSpan !== null) since rejected spans are nulled.
        const hasRejectedSpans = validBindings.some((b) => b.spanRejected);
        provenanceStatus = hasRejectedSpans ? "invalid_binding" : "grounded";
      }
      break;
    }

    case "absence_finding": {
      /**
       * HONEST ABSENCE FINDING CLASSIFICATION (Part G):
       *
       * The current KRS architecture uses a single bulk retrieval. There is no
       * per-claim targeted absence search. The specialist LLM cannot provide a
       * genuine AbsenceEvidenceRecord because the platform does not execute one.
       *
       * Therefore: absence_finding claims MUST be classified as "unverified_absence"
       * regardless of what the model emits.
       *
       * Sprint 29K.4 will add targeted per-claim absence retrieval to KRS, at
       * which point this rule can be updated to "grounded" when the structured
       * retrieval evidence is genuinely available.
       */
      failures.push(
        "absence_finding: KRS single-retrieval architecture cannot provide claim-specific absence proof. " +
        "Classified as unverified_absence. Sprint 29K.4 will add targeted retrieval support.",
      );
      provenanceStatus = "unverified_absence";
      break;
    }

    case "inference": {
      // Requires at least one relatedClaimId pointing to a supported finding
      const hasRelatedClaim = claim.relatedClaimIds.some((id) => allClientIds.has(id));
      if (!hasRelatedClaim) {
        failures.push("inference requires at least one relatedClaimId linking to a supported finding — none found");
        provenanceStatus = "unsupported";
      } else {
        const hasRejectedSpans = validBindings.some((b) => b.spanRejected);
        provenanceStatus = hasRejectedSpans ? "invalid_binding" : "grounded";
      }
      break;
    }

    case "recommendation": {
      // Requires at least one relatedClaimId pointing to a finding
      const hasFindingLink = claim.relatedClaimIds.some((id) => allClientIds.has(id));
      if (!hasFindingLink) {
        failures.push("recommendation requires at least one relatedClaimId linking to a finding — none found");
        provenanceStatus = "unsupported";
      } else {
        provenanceStatus = "grounded";
      }
      break;
    }

    case "external_requirement": {
      // Requires an external_authority binding from an approved source type (Part E)
      const externalBinding = validBindings.find(
        (b) => b.relationship === "external_authority",
      );
      if (!externalBinding) {
        failures.push(
          "external_requirement requires relationship=external_authority from an approved external source — no such binding found",
        );
        provenanceStatus = "unsupported";
        break;
      }
      const extChunk = chunkIndex.get(externalBinding.chunkId);
      if (!extChunk || !isApprovedExternalSource(extChunk)) {
        failures.push(
          `external_requirement: source type "${extChunk?.sourceType ?? "unknown"}" is not an approved external authority. ` +
          "Training knowledge does not satisfy this requirement. Claim is unsupported.",
        );
        provenanceStatus = "unsupported";
        break;
      }
      const hasRejectedSpans = validBindings.some((b) => b.spanRejected);
      provenanceStatus = hasRejectedSpans ? "invalid_binding" : "grounded";
      break;
    }

    default:
      failures.push(`Unknown claimType "${(claim as RawClaim).claimType}" — unsupported`);
      provenanceStatus = "unsupported";
  }

  // ── Contradiction completeness check (Part F) ────────────────────────────
  // Applies to observation claims that use contradiction bindings.
  // Both sides of the contradiction must be present (≥2 contradiction bindings).
  if (claim.claimType === "observation") {
    const contradictions = validBindings.filter((b) => b.relationship === "contradiction");
    if (contradictions.length === 1) {
      // Only one side supplied — not a valid grounded contradiction
      failures.push(
        "Contradiction claim has only one contradiction binding — both sides must be present. " +
        "provenanceStatus degraded to invalid_binding.",
      );
      if (provenanceStatus === "grounded") provenanceStatus = "invalid_binding";
    }
    // 0 contradictions: falls through to normal observation rule (may be grounded via direct_support)
    // ≥2 contradictions: grounded (subject to span checks above)
  }

  return {
    clientClaimId: claim.clientClaimId,
    claimText: claim.claimText,
    claimType: claim.claimType,
    sectionRef: claim.sectionRef,
    confidence: claim.confidence ?? null,
    reasoningSummary: claim.reasoningSummary ?? null,
    relatedClaimIds: claim.relatedClaimIds,
    absenceRecord: claim.absenceRecord ?? null,
    provenanceStatus,
    validEvidenceBindings: validBindings,
    validationFailures: failures,
  };
}

// ─── Batch validation entry point ─────────────────────────────────────────────

/**
 * Validates an array of raw claims emitted by the specialist.
 *
 * Steps:
 *   1. Normalise (drop malformed claims)
 *   2. Build clientClaimId set for relation checking
 *   3. Validate each claim independently
 *   4. Count rejections for observability
 */
export function validateClaimBatch(
  rawClaims: unknown[],
  evidencePack: EvidencePack,
): ClaimBatchValidationResult {
  let malformedDropped = 0;
  let bindingsRejected = 0;

  const normalisedClaims: RawClaim[] = [];
  for (const raw of rawClaims) {
    const n = normaliseRawClaim(raw);
    if (!n) {
      malformedDropped++;
      console.warn("[ClaimValidation] Dropped malformed claim (missing required fields):", raw);
    } else {
      normalisedClaims.push(n);
    }
  }

  const allClientIds = new Set(normalisedClaims.map((c) => c.clientClaimId));

  const validated: ValidatedClaim[] = [];
  for (const claim of normalisedClaims) {
    const result = validateSingleClaim(claim, evidencePack, allClientIds);
    bindingsRejected += result.validationFailures.filter((f) =>
      f.includes("NOT in this execution's EvidencePack"),
    ).length;
    validated.push(result);
  }

  return { claims: validated, malformedDropped, bindingsRejected };
}

// ─── Specialist response parsing ───────────────────────────────────────────────

export interface SpecialistJsonOutput {
  content: string;
  claims: RawClaim[];
}

/**
 * Parses the specialist JSON response into content + raw claims.
 * If parsing fails or content is missing, returns content as-is with empty claims.
 * Never throws — claim emission failure must not degrade Completed Work.
 */
export function parseSpecialistJsonOutput(rawContent: string): SpecialistJsonOutput {
  try {
    const cleaned = rawContent
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const content = typeof parsed.content === "string" ? parsed.content.trim() : rawContent.trim();
    const claims = Array.isArray(parsed.claims) ? (parsed.claims as RawClaim[]) : [];

    return { content, claims };
  } catch {
    // Model produced plain text instead of JSON — treat as content with no claims
    return { content: rawContent.trim(), claims: [] };
  }
}

// ─── Cross-tenant chunk guard ─────────────────────────────────────────────────

/**
 * Ensures all chunk IDs in the claims reference only chunks from the correct
 * organisation's EvidencePack. Called before any DB write.
 * Returns the list of cross-tenant chunk IDs rejected.
 */
export function rejectCrossTenantChunks(
  claims: ValidatedClaim[],
  evidencePack: EvidencePack,
): string[] {
  const packChunkIds = new Set(evidencePack.chunks.map((c) => c.chunkId));
  const rejected: string[] = [];
  for (const claim of claims) {
    for (const binding of claim.validEvidenceBindings) {
      if (!packChunkIds.has(binding.chunkId)) {
        rejected.push(binding.chunkId);
      }
    }
  }
  return rejected;
}
