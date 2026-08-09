/**
 * Evidence Sufficiency Gate — Sprint 29N.5
 *
 * Determines whether the current EvidencePack contains enough trustworthy
 * evidence to perform a specific piece of professional work.
 *
 * This gate is the future escalation boundary between KRS-first retrieval
 * and OpenClaw investigation. It does NOT invoke OpenClaw — it identifies
 * the conditions under which escalation would be necessary.
 *
 * Architecture position:
 *   UEE → KRS → EvidencePack → evidenceSufficiencyService → SUFFICIENT (proceed)
 *                                                          → INSUFFICIENT_* (escalate or halt)
 *
 * Design principles:
 *   - Sufficiency is not merely chunk count or average confidence.
 *   - Sufficiency is contextual: different tasks require different evidence.
 *   - Governance filters have already been applied by KRS — this gate does NOT
 *     re-evaluate approval status, tenant scope, or sensitivity.
 *   - OpenAI must not determine which documents are authoritative — this gate does.
 */

import type { EvidencePack, EvidenceChunk } from "./knowledgeResolutionService.js";
import type { WorkBlueprint } from "./workBlueprintService.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type EvidenceSufficiencyStatus =
  /** Evidence is adequate for this task */
  | "SUFFICIENT"
  /** Too few chunks or sources to support a professional conclusion */
  | "INSUFFICIENT_COVERAGE"
  /** Retrieved chunks reference an organisational document not in the pack */
  | "UNRESOLVED_REFERENCE"
  /** The task/query requires an external authority (legislation, regulator, etc.)
   *  but no external-authority source is present in the pack */
  | "EXTERNAL_AUTHORITY_REQUIRED"
  /** No evidence found at all — source may not exist in Library */
  | "SOURCE_NOT_AVAILABLE"
  /** Evidence found but average confidence is too low to be reliable */
  | "LOW_CONFIDENCE"
  /** Evidence present but entirely from low-authority sources (reference/supporting)
   *  when mandatory/primary sources are expected for this task type */
  | "AUTHORITY_GAP";

export interface SufficiencyReason {
  code: string;
  detail: string;
}

export interface UnresolvedReference {
  /** The document name/title as it appeared in the retrieved chunk text */
  referencedTitle: string;
  /** The chunk that contained the cross-reference */
  sourceChunkId: string;
  /** Source document containing the reference */
  sourceTitle: string;
}

export interface EvidenceSufficiencyResult {
  /** Overall sufficiency verdict */
  status: EvidenceSufficiencyStatus;
  /** Machine-readable reasons — multiple may be present even when status is SUFFICIENT */
  reasons: SufficiencyReason[];
  /** Document references found in chunk text that are not resolved in the EvidencePack */
  unresolvedReferences: UnresolvedReference[];
  /** External authority types that appear to be required but are not in the pack */
  missingAuthorityTypes: string[];
  /** 0–1 composite coverage score — not a threshold, a diagnostic signal */
  coverageScore: number;
  /** True when the result status indicates OpenClaw escalation would be beneficial */
  isEscalationRecommended: boolean;
}

export interface SufficiencyEvaluationInput {
  /** The user's original request / task intent */
  userRequest: string;
  /** Specialist performing the work */
  specialistCode: string;
  /** The blueprint for this task (may be null for ad-hoc tasks) */
  blueprint: WorkBlueprint | null;
  /** The EvidencePack produced by KRS */
  evidencePack: EvidencePack;
  /**
   * External authority types that this task is known to require.
   * Populated from blueprint or blueprint's evidenceRequirements if available.
   */
  requiredExternalAuthorityTypes?: string[];
  /**
   * Minimum authority level expected for at least one source in the pack.
   * Defaults to "supporting" (any level is acceptable).
   */
  minimumRequiredAuthorityLevel?: "mandatory" | "primary" | "supporting" | "reference";
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

/** Minimum chunks to consider coverage adequate for most task types */
const MIN_CHUNKS_ADEQUATE = 2;

/** Minimum distinct sources to consider coverage adequate */
const MIN_SOURCES_ADEQUATE = 1;

/** Confidence below this level on all chunks → LOW_CONFIDENCE */
const LOW_CONFIDENCE_THRESHOLD = 0.15;

/** Authority weight ranking for gap detection */
const AUTHORITY_RANK: Record<string, number> = {
  mandatory:  4,
  primary:    3,
  supporting: 2,
  reference:  1,
};

// ─── Cross-reference detection ────────────────────────────────────────────────

/**
 * Regex patterns that detect when a chunk contains a cross-reference to another
 * organisational document. Each pattern captures group 1 as the referenced title.
 *
 * Deliberately conservative — only matches patterns where a title-cased noun
 * follows a cross-reference verb, ending at a document-type suffix.
 */
// Note: patterns use the `i` flag (case-insensitive) so they match cross-references
// that appear at the start of a sentence ("See the X Policy") as well as mid-sentence.
const CROSS_REF_PATTERNS: RegExp[] = [
  /\bsee\s+(?:also\s+)?(?:the\s+)?([A-Z][^.]{2,80}?(?:Policy|Procedure|Guideline|Standard|Framework|Act|Regulation|Manual|Code|Protocol|Handbook|Guide))\b/gi,
  /\brefer(?:red)?\s+to\s+(?:the\s+)?([A-Z][^.]{2,80}?(?:Policy|Procedure|Guideline|Standard|Framework|Act|Regulation|Manual|Code|Protocol|Handbook|Guide))\b/gi,
  /\bas\s+(?:defined|described|outlined|set\s+out|detailed|specified)\s+in\s+(?:the\s+)?([A-Z][^.]{2,80}?(?:Policy|Procedure|Guideline|Standard|Framework|Act|Regulation|Manual|Code|Protocol|Handbook|Guide))\b/gi,
  /\bdetailed\s+in\s+(?:the\s+)?([A-Z][^.]{2,80}?(?:Policy|Procedure|Guideline|Standard|Framework|Act|Regulation|Manual|Code|Protocol|Handbook|Guide))\b/gi,
  /\bin\s+accordance\s+with\s+(?:the\s+)?([A-Z][^.]{2,80}?(?:Policy|Procedure|Guideline|Standard|Framework|Act|Regulation|Manual|Code|Protocol|Handbook|Guide))\b/gi,
  /\bcontained\s+in\s+(?:the\s+)?([A-Z][^.]{2,80}?(?:Policy|Procedure|Guideline|Standard|Framework|Act|Regulation|Manual|Code|Protocol|Handbook|Guide))\b/gi,
  /\bsection\s+\d+\s+of\s+(?:the\s+)?([A-Z][^.]{2,80}?(?:Policy|Procedure|Guideline|Standard|Framework|Act|Regulation|Manual|Code|Protocol|Handbook|Guide))\b/gi,
];

/**
 * Scan chunk text for cross-references to other documents.
 * Returns a list of referenced titles found in the text.
 */
function detectCrossReferences(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of CROSS_REF_PATTERNS) {
    // Reset lastIndex for each pattern since we reuse them (g flag shares state)
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const title = match[1]?.trim();
      // Require the captured title to begin with an uppercase letter.
      // The `i` flag lets the verb/preposition match case-insensitively ("See"/"see")
      // but the referenced document title itself must be title-cased.
      if (title && title.length >= 5 && /^[A-Z]/.test(title)) {
        found.add(title);
      }
    }
  }
  return [...found];
}

/**
 * Check whether a referenced document title is already covered by the EvidencePack.
 * Uses normalised substring matching to handle minor title variations.
 */
function isReferenceResolved(
  referencedTitle: string,
  packSourceTitles: string[],
): boolean {
  const normRef = referencedTitle.toLowerCase().replace(/\s+/g, " ").trim();
  return packSourceTitles.some(title => {
    const normTitle = title.toLowerCase().replace(/\s+/g, " ").trim();
    // Bidirectional substring — referenced title contained in source title or vice versa
    return normTitle.includes(normRef) || normRef.includes(normTitle);
  });
}

// ─── External authority detection ────────────────────────────────────────────

/**
 * Keywords and phrases that signal the task requires an external regulatory or
 * legislative authority beyond the organisation's own Library.
 */
const EXTERNAL_AUTHORITY_SIGNALS: ReadonlyArray<{ pattern: RegExp; authorityType: string }> = [
  { pattern: /\b(?:legislation|statutory\s+(?:duty|requirement|obligation)|legal\s+requirement|act\s+of\s+parliament|acts?\s+of\s+parliament)\b/i, authorityType: "legislation" },
  { pattern: /\bregulation[s]?\b/i, authorityType: "regulation" },
  { pattern: /\bregulat(?:ory|or)\s+requirement[s]?\b/i, authorityType: "regulation" },
  { pattern: /\b(?:fca|financial\s+conduct\s+authority)\b/i, authorityType: "regulator" },
  { pattern: /\b(?:ico|information\s+commissioner)\b/i, authorityType: "regulator" },
  { pattern: /\b(?:hse|health\s+and\s+safety\s+executive)\b/i, authorityType: "government_authority" },
  { pattern: /\b(?:ofsted|ofgem|ofcom|ofwat|cqc|care\s+quality\s+commission)\b/i, authorityType: "regulator" },
  { pattern: /\bgdpr\b/i, authorityType: "regulation" },
  { pattern: /\bdata\s+protection\s+act\b/i, authorityType: "legislation" },
  { pattern: /\bemployment\s+rights\s+act\b/i, authorityType: "legislation" },
  { pattern: /\bhealth\s+and\s+safety\s+at\s+work\b/i, authorityType: "legislation" },
  { pattern: /\b(?:iso\s*\d{4,5}|bs\s*\d{4,5}|pci\s*dss|soc\s*2|soc2)\b/i, authorityType: "standard" },
  { pattern: /\bexternal\s+(?:regulatory|statutory)\s+requirement[s]?\b/i, authorityType: "regulation" },
  { pattern: /\bapplicable\s+(?:law|legislation|regulation[s]?)\b/i, authorityType: "legislation" },
  { pattern: /\bsector\s+regulator\b/i, authorityType: "regulator" },
  { pattern: /\bprofessional\s+(?:body|standard|guidance)\b/i, authorityType: "professional_body" },
];

/**
 * Detect whether the request or blueprint signals that external authority
 * evidence is needed.
 */
function detectExternalAuthorityRequirements(
  userRequest: string,
  blueprint: WorkBlueprint | null,
): string[] {
  const textToAnalyse = [
    userRequest,
    blueprint?.title ?? "",
    blueprint?.description ?? "",
    blueprint?.objective ?? "",
  ].join(" ");

  const detected = new Set<string>();
  for (const { pattern, authorityType } of EXTERNAL_AUTHORITY_SIGNALS) {
    if (pattern.test(textToAnalyse)) {
      detected.add(authorityType);
    }
  }
  return [...detected];
}

/**
 * Determine which external source types are actually present in the pack.
 */
function getExternalAuthorityTypesInPack(chunks: EvidenceChunk[]): Set<string> {
  const EXTERNAL_SOURCE_TYPES = new Set([
    "legislation",
    "legislation_reference",
    "regulation",
    "standard",
  ]);
  const found = new Set<string>();
  for (const c of chunks) {
    if (EXTERNAL_SOURCE_TYPES.has(c.sourceType)) {
      found.add(c.sourceType);
    }
  }
  return found;
}

// ─── Coverage score ───────────────────────────────────────────────────────────

/**
 * Compute a composite coverage score 0–1 from multiple signals.
 *
 * This is a diagnostic signal — not the primary gate. Do not use it as the
 * sole threshold for SUFFICIENT/INSUFFICIENT decisions.
 */
function computeCoverageScore(
  pack: EvidencePack,
  unresolvedCount: number,
  missingAuthorityCount: number,
): number {
  if (pack.totalChunks === 0) return 0;

  // Confidence contribution (0–0.50)
  const confidenceScore = Math.min(pack.avgConfidence, 1.0) * 0.5;

  // Volume contribution (0–0.25) — capped at 10 chunks for full score
  const volumeScore = Math.min(pack.totalChunks / 10, 1.0) * 0.25;

  // Source diversity contribution (0–0.15)
  const diversityScore = Math.min(pack.sourceIds.length / 3, 1.0) * 0.15;

  // Penalty for unresolved references (−0.05 per unresolved, max −0.15)
  const refPenalty = Math.min(unresolvedCount * 0.05, 0.15);

  // Penalty for missing external authority (−0.10 per type, max −0.20)
  const authPenalty = Math.min(missingAuthorityCount * 0.10, 0.20);

  return Math.max(0, confidenceScore + volumeScore + diversityScore - refPenalty - authPenalty);
}

// ─── Main evaluation function ─────────────────────────────────────────────────

/**
 * Evaluate whether the EvidencePack is sufficient for the given task.
 *
 * Returns a typed result identifying any gaps and whether OpenClaw escalation
 * would be recommended. Does not invoke OpenClaw — that decision belongs to the
 * caller (UEE) based on this result.
 */
export function evaluateEvidenceSufficiency(
  input: SufficiencyEvaluationInput,
): EvidenceSufficiencyResult {
  const { userRequest, blueprint, evidencePack, requiredExternalAuthorityTypes = [], minimumRequiredAuthorityLevel = "supporting" } = input;

  const reasons: SufficiencyReason[] = [];
  const unresolvedReferences: UnresolvedReference[] = [];
  const missingAuthorityTypes: string[] = [];

  // ── 1. Empty pack ──────────────────────────────────────────────────────────
  if (evidencePack.totalChunks === 0) {
    return {
      status: "SOURCE_NOT_AVAILABLE",
      reasons: [{ code: "NO_CHUNKS", detail: "No evidence chunks were retrieved from the Library." }],
      unresolvedReferences: [],
      missingAuthorityTypes: [],
      coverageScore: 0,
      isEscalationRecommended: true,
    };
  }

  // ── 2. Cross-reference detection ───────────────────────────────────────────
  const packSourceTitles = [
    ...new Set(evidencePack.chunks.map(c => c.sourceTitle)),
  ];

  for (const chunk of evidencePack.chunks) {
    const refs = detectCrossReferences(chunk.text);
    for (const ref of refs) {
      if (!isReferenceResolved(ref, packSourceTitles)) {
        // Deduplicate — only record each unique referenced title once
        if (!unresolvedReferences.some(u => u.referencedTitle === ref)) {
          unresolvedReferences.push({
            referencedTitle: ref,
            sourceChunkId:   chunk.chunkId,
            sourceTitle:     chunk.sourceTitle,
          });
        }
      }
    }
  }

  if (unresolvedReferences.length > 0) {
    reasons.push({
      code: "UNRESOLVED_CROSS_REFERENCES",
      detail: `${unresolvedReferences.length} document reference(s) in retrieved chunks are not in the EvidencePack: ${unresolvedReferences.map(u => u.referencedTitle).join("; ")}`,
    });
  }

  // ── 3. External authority requirement ─────────────────────────────────────
  const signalledAuthorityTypes = detectExternalAuthorityRequirements(userRequest, blueprint);
  const allRequiredExternalTypes = [...new Set([...signalledAuthorityTypes, ...requiredExternalAuthorityTypes])];
  const presentExternalTypes = getExternalAuthorityTypesInPack(evidencePack.chunks);

  for (const required of allRequiredExternalTypes) {
    // Map authority type to source types present in the pack
    const isCovered = (() => {
      if (required === "legislation") return presentExternalTypes.has("legislation") || presentExternalTypes.has("legislation_reference");
      if (required === "regulation") return presentExternalTypes.has("regulation") || presentExternalTypes.has("legislation");
      if (required === "standard") return presentExternalTypes.has("standard");
      return false; // regulator, government_authority, professional_body — Library unlikely to have these
    })();

    if (!isCovered) {
      missingAuthorityTypes.push(required);
    }
  }

  if (missingAuthorityTypes.length > 0) {
    reasons.push({
      code: "EXTERNAL_AUTHORITY_ABSENT",
      detail: `Task requires external authority type(s) [${missingAuthorityTypes.join(", ")}] but none are present in the EvidencePack.`,
    });
  }

  // ── 4. Low confidence ─────────────────────────────────────────────────────
  if (evidencePack.avgConfidence < LOW_CONFIDENCE_THRESHOLD) {
    reasons.push({
      code: "LOW_AVERAGE_CONFIDENCE",
      detail: `Average evidence confidence ${evidencePack.avgConfidence.toFixed(3)} is below threshold ${LOW_CONFIDENCE_THRESHOLD}. Retrieved evidence may not be relevant to this task.`,
    });
  }

  // ── 5. Coverage adequacy ───────────────────────────────────────────────────
  const hasAdequateCoverage =
    evidencePack.totalChunks >= MIN_CHUNKS_ADEQUATE &&
    evidencePack.sourceIds.length >= MIN_SOURCES_ADEQUATE;

  if (!hasAdequateCoverage) {
    reasons.push({
      code: "INSUFFICIENT_CHUNK_COUNT",
      detail: `Only ${evidencePack.totalChunks} chunk(s) from ${evidencePack.sourceIds.length} source(s) retrieved. Minimum: ${MIN_CHUNKS_ADEQUATE} chunks from ${MIN_SOURCES_ADEQUATE} source.`,
    });
  }

  // ── 6. Authority gap ───────────────────────────────────────────────────────
  const requiredAuthorityRank = AUTHORITY_RANK[minimumRequiredAuthorityLevel] ?? 2;
  const highestAuthorityInPack = evidencePack.chunks.reduce(
    (best, c) => Math.max(best, AUTHORITY_RANK[c.authorityLevel] ?? 1),
    0,
  );

  if (highestAuthorityInPack < requiredAuthorityRank) {
    const presentLevel = Object.entries(AUTHORITY_RANK)
      .find(([, rank]) => rank === highestAuthorityInPack)?.[0] ?? "unknown";
    reasons.push({
      code: "AUTHORITY_BELOW_REQUIRED",
      detail: `Highest authority level in pack is "${presentLevel}" but task requires at least "${minimumRequiredAuthorityLevel}".`,
    });
  }

  // ── 7. Determine primary status ────────────────────────────────────────────
  // Priority: SOURCE_NOT_AVAILABLE (handled above) > EXTERNAL_AUTHORITY_REQUIRED >
  //           UNRESOLVED_REFERENCE > LOW_CONFIDENCE > INSUFFICIENT_COVERAGE >
  //           AUTHORITY_GAP > SUFFICIENT

  let status: EvidenceSufficiencyStatus;
  let isEscalationRecommended = false;

  if (missingAuthorityTypes.length > 0) {
    status = "EXTERNAL_AUTHORITY_REQUIRED";
    isEscalationRecommended = true; // OpenClaw can retrieve external regulatory sources
  } else if (unresolvedReferences.length > 0) {
    status = "UNRESOLVED_REFERENCE";
    isEscalationRecommended = true; // OpenClaw can follow cross-references
  } else if (evidencePack.avgConfidence < LOW_CONFIDENCE_THRESHOLD) {
    status = "LOW_CONFIDENCE";
    isEscalationRecommended = true; // OpenClaw may find better-matched sources
  } else if (!hasAdequateCoverage) {
    status = "INSUFFICIENT_COVERAGE";
    isEscalationRecommended = true; // OpenClaw may find sources not in Library
  } else if (highestAuthorityInPack < requiredAuthorityRank) {
    status = "AUTHORITY_GAP";
    isEscalationRecommended = false; // Authority gap is a Library governance issue, not a discovery gap
  } else if (reasons.length > 0) {
    // Has non-blocking reasons (e.g. minor authority note) but is otherwise adequate
    status = "SUFFICIENT";
    isEscalationRecommended = false;
  } else {
    status = "SUFFICIENT";
    isEscalationRecommended = false;
  }

  const coverageScore = computeCoverageScore(
    evidencePack,
    unresolvedReferences.length,
    missingAuthorityTypes.length,
  );

  return {
    status,
    reasons,
    unresolvedReferences,
    missingAuthorityTypes,
    coverageScore,
    isEscalationRecommended,
  };
}

// ─── Exported helpers ─────────────────────────────────────────────────────────

/**
 * Convenience function: returns true when the pack is sufficient without needing
 * OpenClaw escalation. Callers that only need a boolean gate use this.
 */
export function isPackSufficient(
  input: SufficiencyEvaluationInput,
): boolean {
  const result = evaluateEvidenceSufficiency(input);
  return result.status === "SUFFICIENT" || result.status === "AUTHORITY_GAP";
  // AUTHORITY_GAP does not trigger OpenClaw — it is a Library governance issue.
  // Callers should log the gap but proceed with available evidence.
}

/**
 * Detect cross-references in a single chunk of text.
 * Exported for use in tests and diagnostics.
 */
export { detectCrossReferences };
