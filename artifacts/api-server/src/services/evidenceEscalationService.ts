/**
 * Sprint 29N.6 — Part C: Evidence Escalation Policy
 *
 * Translates an EvidenceSufficiencyResult into a typed EvidenceEscalationDecision.
 * This is the policy layer that decides WHETHER escalation to an evidence
 * discovery adapter is warranted, under what scope, and with what constraints.
 *
 * Escalation policy rules:
 *   SUFFICIENT              → no escalation
 *   AUTHORITY_GAP           → no escalation (governance issue, not discovery gap)
 *   UNRESOLVED_REFERENCE    → internal_references_only scope
 *   EXTERNAL_AUTHORITY_REQ  → external_authority_only scope
 *   INSUFFICIENT_COVERAGE   → internal_references_only only when context suggests
 *                             deeper investigation could help
 *   LOW_CONFIDENCE          → internal_references_only when weakness is reach
 *   SOURCE_NOT_AVAILABLE    → internal_references_only (adapter may locate source)
 *
 * Critical: escalation allowed ≠ escalation guaranteed to help. The discovery
 * adapter may return zero candidates, in which case the execution fails honestly.
 */

import type { EvidenceSufficiencyResult } from "./evidenceSufficiencyService.js";

// ─── Escalation decision ──────────────────────────────────────────────────────

/**
 * Controls what scope an evidence discovery adapter is allowed to search.
 *   none                  — adapter must not run
 *   internal_references   — may only follow cross-references within the org library
 *   external_authority    — may only retrieve from Authority Registry sources
 *   internal_and_external — may follow internal references AND retrieve external authority
 */
export type EvidenceDiscoveryScope =
  | "none"
  | "internal_references_only"
  | "external_authority_only"
  | "internal_and_external";

/**
 * The fully resolved escalation decision for one evidence resolution cycle.
 * Produced by buildEscalationDecision() and consumed by discoveryOrchestrator.
 */
export interface EvidenceEscalationDecision {
  /** True when a discovery adapter should be invoked */
  shouldEscalate: boolean;
  /** Human-readable reason for the escalation decision */
  reason: string;
  /** The sufficiency status that triggered this decision */
  escalationStatus: string;

  // ── Discovery scope constraints ──────────────────────────────────────────
  /** What the discovery adapter is allowed to search */
  allowedDiscoveryScope: EvidenceDiscoveryScope;
  /** Natural-language descriptions of what evidence is missing */
  requiredEvidence: string[];
  /** Document titles from unresolved cross-references (Part E input) */
  unresolvedReferences: string[];
  /** External authority types that are required */
  externalAuthorityRequired: string[];

  // ── Execution identity ────────────────────────────────────────────────────
  originalEvidencePackId: string;
  executionId: string;
  tenantId: string;
  organisationId: string;

  // ── Hard limits on the discovery adapter ─────────────────────────────────
  /** Maximum reference hops to follow (default: 2) */
  maxHops: number;
  /** Maximum distinct sources to retrieve (default: 5) */
  maxSources: number;
  /** Maximum passages to return per source (default: 3) */
  maxPassages: number;
  /** Wall-clock timeout for the entire discovery call (ms, default: 15000) */
  timeoutMs: number;
}

// ─── Default discovery limits ─────────────────────────────────────────────────
// Start conservatively per Part G. These may be raised per-org in a future sprint.

const DEFAULT_MAX_HOPS     = 2;
const DEFAULT_MAX_SOURCES  = 5;
const DEFAULT_MAX_PASSAGES = 3;
const DEFAULT_TIMEOUT_MS   = 15_000;

// ─── Policy builder ───────────────────────────────────────────────────────────

/**
 * Converts an EvidenceSufficiencyResult into an EvidenceEscalationDecision.
 *
 * The caller must supply execution identity for audit and tenant-boundary
 * enforcement. The evidence pack ID is the packId from the original V1 pack.
 */
export function buildEscalationDecision(
  sufficiency: EvidenceSufficiencyResult,
  identity: {
    executionId: string;
    organisationId: string;
    evidencePackId?: string;
  },
): EvidenceEscalationDecision {
  const base = {
    escalationStatus:       sufficiency.status,
    originalEvidencePackId: identity.evidencePackId ?? identity.executionId,
    executionId:            identity.executionId,
    tenantId:               identity.organisationId,
    organisationId:         identity.organisationId,
    maxHops:                DEFAULT_MAX_HOPS,
    maxSources:             DEFAULT_MAX_SOURCES,
    maxPassages:            DEFAULT_MAX_PASSAGES,
    timeoutMs:              DEFAULT_TIMEOUT_MS,
  };

  switch (sufficiency.status) {
    // ── No escalation cases ─────────────────────────────────────────────────
    case "SUFFICIENT":
      return {
        ...base,
        shouldEscalate: false,
        reason: "Evidence pack is sufficient — fast path, no discovery needed",
        allowedDiscoveryScope: "none",
        requiredEvidence: [],
        unresolvedReferences: [],
        externalAuthorityRequired: [],
      };

    case "AUTHORITY_GAP":
      // OpenClaw can discover candidates but cannot decide an unvalidated source
      // is authoritative. This is a Library governance issue — return it as such.
      return {
        ...base,
        shouldEscalate: false,
        reason:
          "Authority gap is a Library governance issue: the highest authority document in the " +
          "pack is below the required level. An administrator must upload or grant a higher-" +
          "authority source. OpenClaw cannot promote an unknown source to mandatory authority.",
        allowedDiscoveryScope: "none",
        requiredEvidence: sufficiency.missingAuthorityTypes ?? [],
        unresolvedReferences: [],
        externalAuthorityRequired: [],
      };

    // ── Unresolved cross-references: internal discovery ─────────────────────
    case "UNRESOLVED_REFERENCE": {
      const refs = sufficiency.unresolvedReferences?.map(r => r.referencedTitle) ?? [];
      return {
        ...base,
        shouldEscalate: true,
        reason: `Evidence pack contains ${refs.length} cross-reference(s) to documents not in the pack: ${refs.join("; ")}`,
        allowedDiscoveryScope: "internal_references_only",
        requiredEvidence: refs.map(t => `Document referenced but not retrieved: "${t}"`),
        unresolvedReferences: refs,
        externalAuthorityRequired: [],
      };
    }

    // ── External authority required: external discovery ─────────────────────
    case "EXTERNAL_AUTHORITY_REQUIRED": {
      const types = sufficiency.requiredExternalAuthorityTypes ?? [];
      return {
        ...base,
        shouldEscalate: true,
        reason: `Task requires external authority evidence: ${types.join(", ")}`,
        allowedDiscoveryScope: "external_authority_only",
        requiredEvidence: types.map(t => `External authority required: ${t}`),
        unresolvedReferences: [],
        externalAuthorityRequired: types,
      };
    }

    // ── Insufficient coverage: escalate only when investigation could help ──
    case "INSUFFICIENT_COVERAGE": {
      // Do not automatically escalate for low chunk count — the library may
      // genuinely have sparse coverage and the adapter won't improve that.
      // Only escalate when there are also unresolved references (the adapter
      // may follow those references to find more relevant chunks).
      const refs = sufficiency.unresolvedReferences?.map(r => r.referencedTitle) ?? [];
      const hasFollowableReferences = refs.length > 0;

      if (!hasFollowableReferences) {
        return {
          ...base,
          shouldEscalate: false,
          reason:
            "Insufficient coverage: the organisation library does not contain enough relevant " +
            "chunks. No cross-references were detected that could lead to additional sources. " +
            "Please upload additional relevant documents to the Knowledge Library.",
          allowedDiscoveryScope: "none",
          requiredEvidence: ["Additional policy or procedure documents covering this topic"],
          unresolvedReferences: [],
          externalAuthorityRequired: [],
        };
      }

      return {
        ...base,
        shouldEscalate: true,
        reason: `Low coverage with ${refs.length} cross-reference(s) that may lead to more relevant chunks`,
        allowedDiscoveryScope: "internal_references_only",
        requiredEvidence: refs.map(t => `Cross-referenced document not retrieved: "${t}"`),
        unresolvedReferences: refs,
        externalAuthorityRequired: [],
      };
    }

    // ── Low confidence: escalate when weakness is reach, not authority ──────
    case "LOW_CONFIDENCE": {
      const refs = sufficiency.unresolvedReferences?.map(r => r.referencedTitle) ?? [];
      if (refs.length > 0) {
        return {
          ...base,
          shouldEscalate: true,
          reason: `Low confidence evidence and ${refs.length} cross-reference(s) suggest retrieval gap rather than document absence`,
          allowedDiscoveryScope: "internal_references_only",
          requiredEvidence: refs.map(t => `Referenced document: "${t}"`),
          unresolvedReferences: refs,
          externalAuthorityRequired: [],
        };
      }
      return {
        ...base,
        shouldEscalate: false,
        reason:
          "Low confidence evidence: the retrieved chunks score below the reliability threshold " +
          "and no cross-references were found. Please check whether the relevant documents " +
          "are uploaded and approved in the Knowledge Library.",
        allowedDiscoveryScope: "none",
        requiredEvidence: ["Higher-confidence policy or procedure documents"],
        unresolvedReferences: [],
        externalAuthorityRequired: [],
      };
    }

    // ── Source not available: escalate if adapter could locate it ────────────
    case "SOURCE_NOT_AVAILABLE":
      return {
        ...base,
        shouldEscalate: true,
        reason:
          "No relevant evidence found in the organisation library. " +
          "Discovery adapter may be able to locate the source through cross-references.",
        allowedDiscoveryScope: "internal_references_only",
        requiredEvidence: ["Any relevant policy, procedure, or guidance document for this topic"],
        unresolvedReferences: [],
        externalAuthorityRequired: [],
      };

    // ── Fallback — should not be reached for valid status values ─────────────
    default:
      return {
        ...base,
        shouldEscalate: false,
        reason: `Unrecognised sufficiency status: ${sufficiency.status}`,
        allowedDiscoveryScope: "none",
        requiredEvidence: [],
        unresolvedReferences: [],
        externalAuthorityRequired: [],
      };
  }
}

/**
 * Returns true when the escalation decision indicates discovery should run.
 * Helper for inline checks in the UEE pipeline.
 */
export function shouldRunDiscovery(decision: EvidenceEscalationDecision): boolean {
  return decision.shouldEscalate && decision.allowedDiscoveryScope !== "none";
}
