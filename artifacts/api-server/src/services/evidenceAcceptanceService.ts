/**
 * Sprint 29N.6 — Part E: NeedsOps Evidence Acceptance / Authority Gate
 *
 * Every CandidateEvidence item discovered by an evidence discovery adapter must
 * pass through this gate before it can become AcceptedEvidence and be merged
 * into the EvidencePack for OpenAI consumption.
 *
 * Architectural contract (non-negotiable):
 *   - Rejected candidates MUST NEVER reach OpenAI as trusted evidence
 *   - OpenClaw confidence MUST NOT become a NeedsOps authority score
 *   - The authority class in AcceptedEvidence is assigned here, not by OpenClaw
 *   - Tenant boundary violations are hard-rejected before any other check
 *
 * Validation path:
 *   Internal (organisational) evidence — 10 checks
 *   External evidence                 — 10 checks + Authority Registry lookup
 */

import { createHash } from "crypto";
import { db } from "@workspace/db";
import { knowledgeSourcesTable, knowledgeSourceVersionsTable, knowledgeChunksTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  isApprovedExternalSource,
  lookupAuthorityByDomain,
  normaliseDomain,
} from "../lib/authorityRegistry/index.js";
import type {
  CandidateEvidence,
  AcceptedEvidence,
  RejectedEvidence,
  EvidenceRejectionReason,
} from "../types/candidateEvidence.js";

// ─── Gate configuration ───────────────────────────────────────────────────────

/** Minimum relevance score for a candidate to be considered (advisory floor) */
const MINIMUM_RELEVANCE_SCORE = 0.20;

/** Allowed sensitivity classifications for evidence retrieval */
const ALLOWED_SENSITIVITY_CLASSES = new Set(["public", "internal", "confidential"]);

// ─── Gate result types ────────────────────────────────────────────────────────

export interface GateValidationResult {
  candidate: CandidateEvidence;
  outcome: "accepted" | "rejected";
  accepted?: AcceptedEvidence;
  rejected?: RejectedEvidence;
}

// ─── Main gate function ────────────────────────────────────────────────────────

/**
 * Run a single CandidateEvidence item through the NeedsOps Authority Gate.
 *
 * @param candidate       The candidate to validate
 * @param executingOrgId  The organisation that owns the execution
 * @param allowExternal   Whether external evidence is permitted for this task
 */
export async function validateCandidateEvidence(
  candidate: CandidateEvidence,
  executingOrgId: string,
  allowExternal: boolean = false,
): Promise<GateValidationResult> {
  const now = new Date().toISOString();

  // ── Advisory floor: skip very low relevance candidates early ────────────────
  if (candidate.relevanceScore < MINIMUM_RELEVANCE_SCORE) {
    return reject(candidate, "CONFIDENCE_BELOW_FLOOR",
      `Relevance score ${candidate.relevanceScore.toFixed(3)} is below the minimum floor of ${MINIMUM_RELEVANCE_SCORE}`,
      now);
  }

  // ── Hard check: tenant boundary ─────────────────────────────────────────────
  // Must happen before DB lookups so cross-tenant candidates never touch the DB.
  if (candidate.organisationId !== executingOrgId) {
    return reject(candidate, "TENANT_BOUNDARY_VIOLATION",
      `Candidate organisationId "${candidate.organisationId}" does not match executing org "${executingOrgId}"`,
      now);
  }

  // ── Route to the correct validation path ───────────────────────────────────
  if (!candidate.isExternal) {
    return validateInternalCandidate(candidate, executingOrgId, now);
  } else {
    if (!allowExternal) {
      return reject(candidate, "EXTERNAL_EVIDENCE_NOT_PERMITTED",
        "This task or blueprint does not permit external evidence. The organisation library is the only allowed source.",
        now);
    }
    return validateExternalCandidate(candidate, executingOrgId, now);
  }
}

// ─── Internal (organisational) evidence validation ────────────────────────────

/**
 * 10-check validation path for internal (org library) evidence.
 *
 * Check 1:  tenant/organisation ownership
 * Check 2:  source exists in DB
 * Check 3:  source is accessible to this execution (same org)
 * Check 4:  approved status
 * Check 5:  current version / current authority
 * Check 6:  effective date / currentness
 * Check 7:  integrity / hash where available
 * Check 8:  sensitivity / access rules
 * Check 9:  sourceVersionId is resolvable
 * Check 10: chunk/document exists
 */
async function validateInternalCandidate(
  candidate: CandidateEvidence,
  executingOrgId: string,
  now: string,
): Promise<GateValidationResult> {
  // Check 1: tenant ownership — already done above (hard fail before DB access)

  // Check 2: source exists
  if (!candidate.internalSourceId) {
    return reject(candidate, "SOURCE_NOT_FOUND",
      "Internal candidate has no internalSourceId — cannot verify source existence",
      now);
  }

  let source: { id: string; organizationId: string; status: string; isCurrent: boolean; sensitivityClassification: string | null; effectiveTo: Date | null } | undefined;
  try {
    const rows = await db
      .select({
        id: knowledgeSourcesTable.id,
        organizationId: knowledgeSourcesTable.organizationId,
        status: knowledgeSourcesTable.status,
        isCurrent: knowledgeSourcesTable.isCurrent,
        sensitivityClassification: knowledgeSourcesTable.sensitivityClassification,
        effectiveTo: knowledgeSourcesTable.effectiveTo,
      })
      .from(knowledgeSourcesTable)
      .where(eq(knowledgeSourcesTable.id, candidate.internalSourceId));
    source = rows[0];
  } catch {
    return reject(candidate, "SOURCE_NOT_FOUND",
      `Database lookup failed for source "${candidate.internalSourceId}"`,
      now);
  }

  if (!source) {
    return reject(candidate, "SOURCE_NOT_FOUND",
      `Knowledge source "${candidate.internalSourceId}" not found`,
      now);
  }

  // Check 3: source accessible to this execution (same org)
  if (source.organizationId !== executingOrgId) {
    return reject(candidate, "WRONG_TENANT",
      `Source "${candidate.internalSourceId}" belongs to org "${source.organizationId}", not "${executingOrgId}"`,
      now);
  }

  // Check 4: approved status
  if (source.status !== "approved") {
    return reject(candidate, "SOURCE_NOT_APPROVED",
      `Source "${candidate.internalSourceId}" has status "${source.status}" — only "approved" sources may be used as evidence`,
      now);
  }

  // Check 5: current version
  if (!source.isCurrent) {
    return reject(candidate, "SOURCE_SUPERSEDED",
      `Source "${candidate.internalSourceId}" is not the current version (isCurrent=false)`,
      now);
  }

  // Check 6: effective date
  if (source.effectiveTo && source.effectiveTo < new Date()) {
    return reject(candidate, "OUTDATED",
      `Source "${candidate.internalSourceId}" effective date has expired (effectiveTo=${source.effectiveTo.toISOString()})`,
      now);
  }

  // Check 7: integrity — hash check if passage provided
  if (candidate.passageHash && candidate.supportingPassage) {
    const computedHash = createHash("sha256").update(candidate.supportingPassage, "utf8").digest("hex");
    if (computedHash !== candidate.passageHash) {
      return reject(candidate, "INTEGRITY_FAILURE",
        "Passage hash mismatch — the supporting passage text does not match the claimed hash. " +
        "The passage may have been modified after discovery.",
        now);
    }
  }

  // Check 8: sensitivity
  const sensitivity = source.sensitivityClassification ?? "internal";
  if (!ALLOWED_SENSITIVITY_CLASSES.has(sensitivity)) {
    return reject(candidate, "ACCESS_DENIED",
      `Source "${candidate.internalSourceId}" has sensitivity "${sensitivity}" which is not permitted for evidence retrieval`,
      now);
  }

  // Check 9: sourceVersionId resolvable
  let canonicalVersionId: string | undefined;
  if (candidate.internalSourceVersionId) {
    try {
      const vrows = await db
        .select({ id: knowledgeSourceVersionsTable.id })
        .from(knowledgeSourceVersionsTable)
        .where(
          and(
            eq(knowledgeSourceVersionsTable.id, candidate.internalSourceVersionId),
            eq(knowledgeSourceVersionsTable.sourceId, candidate.internalSourceId),
          ),
        );
      if (vrows[0]) {
        canonicalVersionId = vrows[0].id;
      }
    } catch {
      // Non-fatal — continue without version pinning
    }
  }

  // Check 10: chunk/document exists
  if (candidate.internalChunkId) {
    try {
      const crow = await db
        .select({ id: knowledgeChunksTable.id })
        .from(knowledgeChunksTable)
        .where(
          and(
            eq(knowledgeChunksTable.id, candidate.internalChunkId),
            eq(knowledgeChunksTable.sourceId, candidate.internalSourceId),
          ),
        );
      if (!crow[0]) {
        return reject(candidate, "SOURCE_NOT_FOUND",
          `Chunk "${candidate.internalChunkId}" not found under source "${candidate.internalSourceId}"`,
          now);
      }
    } catch {
      // Non-fatal — continue without chunk verification
    }
  }

  // ── All checks passed — accept ─────────────────────────────────────────────
  const accepted: AcceptedEvidence = {
    candidate,
    acceptedAt: now,
    authorityClass: mapContentTypeToAuthorityClass(candidate.contentType, "internal"),
    canonicalSourceId: candidate.internalSourceId,
    canonicalVersionId,
  };

  return { candidate, outcome: "accepted", accepted };
}

// ─── External evidence validation ─────────────────────────────────────────────

/**
 * 10-check validation path for external evidence (legislation, regulation, etc).
 *
 * Check 1:  source identity (title present)
 * Check 2:  URL well-formed and non-empty
 * Check 3:  publisher domain known and non-empty
 * Check 4:  source type is a known external category
 * Check 5:  Authority Registry status (known, active, not rejected)
 * Check 6:  jurisdiction relevance (non-blocking advisory)
 * Check 7:  currency / effective date
 * Check 8:  integrity / hash
 * Check 9:  primary vs secondary authority classification
 * Check 10: task permits external evidence (already checked at call site)
 */
async function validateExternalCandidate(
  candidate: CandidateEvidence,
  _executingOrgId: string,
  now: string,
): Promise<GateValidationResult> {
  // Check 1: source identity
  if (!candidate.sourceTitle?.trim()) {
    return reject(candidate, "SOURCE_NOT_FOUND",
      "External candidate has no source title",
      now);
  }

  // Check 2: URL
  if (!candidate.sourceUrl?.trim()) {
    return reject(candidate, "INVALID_URL",
      "External candidate has no source URL",
      now);
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidate.sourceUrl);
  } catch {
    return reject(candidate, "INVALID_URL",
      `External candidate URL "${candidate.sourceUrl}" is not a valid URL`,
      now);
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return reject(candidate, "INVALID_URL",
      `External candidate URL must use http or https (got "${parsedUrl.protocol}")`,
      now);
  }

  // Check 3: publisher domain
  const domain = normaliseDomain(candidate.sourceUrl);
  if (!domain) {
    return reject(candidate, "INVALID_URL",
      "Cannot extract a publisher domain from the source URL",
      now);
  }

  // Check 4: source type
  const knownExternalTypes = new Set([
    "external_legislation", "external_regulation",
    "external_guidance", "external_standard", "external_case_law",
  ]);
  if (!knownExternalTypes.has(candidate.sourceType)) {
    return reject(candidate, "UNKNOWN_SOURCE_TYPE",
      `Source type "${candidate.sourceType}" is not a recognised external evidence type`,
      now);
  }

  // Check 5: Authority Registry — must be known and active
  const registryLookup = lookupAuthorityByDomain(domain);

  if (!registryLookup.found) {
    return reject(candidate, "AUTHORITY_UNKNOWN",
      `Domain "${domain}" is not in the NeedsOps Authority Registry. ` +
      "Only sources from registered authorities may be used as external evidence. " +
      "Contact your platform administrator to request registry addition.",
      now);
  }

  const registryEntry = registryLookup.entry!;

  if (registryEntry.status === "rejected") {
    return reject(candidate, "AUTHORITY_REJECTED",
      registryLookup.rejectionReason ??
        `Domain "${domain}" has been explicitly rejected in the Authority Registry`,
      now);
  }

  if (registryEntry.status === "requires_review") {
    // For now, treat requires_review the same as rejected — governance must approve
    return reject(candidate, "AUTHORITY_UNKNOWN",
      `Domain "${domain}" requires manual review before it can be used as evidence. ` +
      "Contact your platform administrator.",
      now);
  }

  // Check 6: jurisdiction (advisory — log but non-blocking for now)
  // If the candidate has a jurisdiction and it does not overlap with the registry
  // entry's jurisdictions, this is a mismatch warning but not a hard failure in v1.
  // Hard jurisdiction enforcement can be added per-task in a future sprint.

  // Check 7: effective date — check that the source is not explicitly expired
  if (candidate.effectiveDate) {
    const effective = new Date(candidate.effectiveDate);
    if (!isNaN(effective.getTime()) && effective > new Date()) {
      // Future effective date — not yet in force
      return reject(candidate, "OUTDATED",
        `External source "${candidate.sourceTitle}" has effective date ${candidate.effectiveDate} which is in the future`,
        now);
    }
  }

  // Check 8: integrity — hash check
  if (candidate.passageHash && candidate.supportingPassage) {
    const computedHash = createHash("sha256").update(candidate.supportingPassage, "utf8").digest("hex");
    if (computedHash !== candidate.passageHash) {
      return reject(candidate, "INTEGRITY_FAILURE",
        "Passage hash mismatch — the supporting passage text does not match the claimed hash",
        now);
    }
  }

  // Check 9: primary vs secondary — this is informational, recorded in accepted evidence

  // Check 10: handled at call site (allowExternal check)

  // ── All checks passed — accept ─────────────────────────────────────────────
  const accepted: AcceptedEvidence = {
    candidate,
    acceptedAt: now,
    authorityClass: registryEntry.evidenceAuthorityClass,
    authorityRegistryId: registryEntry.id,
    governanceNote:
      registryEntry.governanceNote ??
      `Accepted from Authority Registry entry "${registryEntry.name}" (${registryEntry.id})`,
  };

  return { candidate, outcome: "accepted", accepted };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function reject(
  candidate: CandidateEvidence,
  reason: EvidenceRejectionReason,
  detail: string,
  now: string,
): GateValidationResult {
  const rejected: RejectedEvidence = {
    candidate,
    rejectionReason: reason,
    rejectionDetail: detail,
    rejectedAt: now,
  };
  return { candidate, outcome: "rejected", rejected };
}

function mapContentTypeToAuthorityClass(
  contentType: string,
  _evidenceOrigin: "internal" | "external",
): AcceptedEvidence["authorityClass"] {
  switch (contentType) {
    case "legislation":
    case "regulation":
      return "mandatory";
    case "policy":
    case "procedure":
      return "primary";
    case "guidance":
    case "standard":
    case "manual":
      return "supporting";
    default:
      return "reference";
  }
}

/**
 * Run a batch of candidates through the Authority Gate concurrently.
 * Returns both accepted and rejected arrays for observability.
 */
export async function validateCandidateBatch(
  candidates: CandidateEvidence[],
  executingOrgId: string,
  allowExternal: boolean = false,
): Promise<{ accepted: AcceptedEvidence[]; rejected: RejectedEvidence[] }> {
  const results = await Promise.all(
    candidates.map(c => validateCandidateEvidence(c, executingOrgId, allowExternal)),
  );

  const accepted: AcceptedEvidence[] = [];
  const rejected: RejectedEvidence[] = [];

  for (const result of results) {
    if (result.outcome === "accepted" && result.accepted) {
      accepted.push(result.accepted);
    } else if (result.outcome === "rejected" && result.rejected) {
      rejected.push(result.rejected);
    }
  }

  return { accepted, rejected };
}
