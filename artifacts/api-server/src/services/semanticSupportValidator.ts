/**
 * semanticSupportValidator — Sprint 29K.4 (Claim Integrity Hardening)
 *
 * Server-side DETERMINISTIC semantic-support validation.
 *
 * Answers the question a span-existence check cannot:
 *   "Does this passage actually support this claim?"
 *
 * Architecture:
 *   1. Signal extraction  — numbers/timeframes, obligation level, negation,
 *      actors/roles, causal verbs, uncertainty markers (all regex-based, O(n))
 *   2. Conflict detection — compares claim signals against chunk signals
 *   3. Classification    — produces a SupportClassification and ConflictSignal[]
 *   4. Claim-type risk   — detects inference masquerading as observation
 *
 * Design constraints (Sprint 29K.4):
 *   - No LLM call. No external service.
 *   - Deterministic, reproducible, testable in isolation.
 *   - Uncertainty DOWNGRADES. Deterministic conflict → support_uncertain.
 *   - Clear factual contradiction (timeframe mismatch, negation reversal) → support_uncertain.
 *   - Model-confidence cannot override a detected conflict.
 *
 * What remains model-dependent:
 *   - Implicit semantic entailment gaps not captured by lexical signals
 *     (e.g. "acknowledge" vs "resolve" are distinct verbs but share no number conflict).
 *   - Complex syntactic ambiguity that regex cannot resolve.
 *   These are documented in test comments as RESIDUAL SEMANTIC RISK.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SupportClassification =
  | "supporting"           // No conflicts detected — claim appears supported
  | "uncertain"            // One or more signal conflicts — cannot confirm support
  | "contradictory";       // Clear factual contradiction (timeframe/negation)

export type ClaimTypeRisk =
  | "none"                 // Claim type appears appropriate
  | "inference_pattern"    // Observation claim shows causal or uncertainty language
  | "absence_pattern"      // Observation claim asserts absence (should be absence_finding)
  | "scope_overreach";     // Organisation-wide claim but single-document search scope

export interface ConflictSignal {
  signalType:
    | "timeframe_mismatch"
    | "number_mismatch"
    | "obligation_level_mismatch"
    | "negation_reversal"
    | "actor_mismatch"
    | "causal_language_in_observation"
    | "uncertainty_language_in_observation"
    | "absence_language_in_observation";
  claimValue: string;
  chunkValue: string;
  description: string;
}

export interface SpanSupportResult {
  classification: SupportClassification;
  conflicts: ConflictSignal[];
}

export interface ClaimTypeRiskResult {
  risk: ClaimTypeRisk;
  signals: string[];
}

// ─── Timeframe extraction ──────────────────────────────────────────────────────

const TIMEFRAME_DIGIT_RE =
  /(\d+(?:\.\d+)?)\s*(?:business\s+|working\s+)?(?:day|week|month|hour|year|fortnight)s?/gi;

/** Word-form numbers commonly used in compliance documents. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, twenty: 20,
  thirty: 30, sixty: 60, ninety: 90,
};
const WORD_NUMBERS_PATTERN = Object.keys(WORD_NUMBERS).join("|");
const TIMEFRAME_WORD_RE = new RegExp(
  `\\b(${WORD_NUMBERS_PATTERN})\\s*(?:business\\s+|working\\s+)?(?:day|week|month|hour|year|fortnight)s?`,
  "gi",
);

export function extractTimeframes(text: string): Array<{ quantity: number; unit: string; raw: string }> {
  const results: Array<{ quantity: number; unit: string; raw: string }> = [];
  const normalised = text.toLowerCase();

  // Digit-form timeframes
  const digitRe = new RegExp(TIMEFRAME_DIGIT_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = digitRe.exec(normalised)) !== null) {
    const [raw, qty] = m;
    const unit = raw
      .replace(/\d+(?:\.\d+)?\s*/, "")
      .replace(/business\s+|working\s+/, "")
      .replace(/s$/, "")
      .trim();
    results.push({ quantity: parseFloat(qty), unit, raw: raw.trim() });
  }

  // Word-form timeframes ("five business days", "three weeks")
  const wordRe = new RegExp(TIMEFRAME_WORD_RE.source, "gi");
  while ((m = wordRe.exec(normalised)) !== null) {
    const [raw, word] = m;
    const qty = WORD_NUMBERS[word.toLowerCase()];
    if (qty === undefined) continue;
    const unit = raw
      .replace(new RegExp(`^${word}\\s*`, "i"), "")
      .replace(/business\s+|working\s+/, "")
      .replace(/s$/, "")
      .trim();
    results.push({ quantity: qty, unit, raw: raw.trim() });
  }

  return results;
}

// ─── Number extraction (standalone, non-timeframe) ────────────────────────────

/** Extracts standalone numbers that are NOT part of a timeframe. */
export function extractStandaloneNumbers(text: string): number[] {
  const timeframeMatches = extractTimeframes(text).map((t) => t.quantity);
  const allNumbers: number[] = [];
  const numRe = /\b(\d+(?:\.\d+)?)\s*(?:%|percent)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = numRe.exec(text.toLowerCase())) !== null) {
    const n = parseFloat(m[1]);
    if (!timeframeMatches.includes(n)) allNumbers.push(n);
  }
  return allNumbers;
}

// ─── Obligation level ─────────────────────────────────────────────────────────

export type ObligationLevel = "mandatory" | "permissive" | "none";

const MANDATORY_RE = /\b(must|shall|required to|is required|mandatory|will)\b/i;
const PERMISSIVE_RE = /\b(may|should|can|might|could|optional|encouraged)\b/i;

export function extractObligationLevel(text: string): ObligationLevel {
  if (MANDATORY_RE.test(text)) return "mandatory";
  if (PERMISSIVE_RE.test(text)) return "permissive";
  return "none";
}

// ─── Negation detection ───────────────────────────────────────────────────────

const NEGATION_RE =
  /\b(not|no\b|never|cannot|can't|isn't|aren't|don't|does not|do not|shall not|will not|has not|have not|is not|are not|was not|were not)\b/i;

export function hasNegation(text: string): boolean {
  return NEGATION_RE.test(text);
}

// ─── Actor / role extraction ──────────────────────────────────────────────────

/** Common role-word patterns in professional/NDIS/HR/compliance contexts. */
const ROLE_PATTERN =
  /\b(?:complaints?\s+officer|service\s+manager|team\s+leader|supervisor|director|ceo|board|provider|staff|employee|worker|coordinator|reviewer|manager|officer|officer|team\s+member|responsible\s+party|assigned\s+person|case\s+manager|clinical\s+(?:lead|director)|quality\s+officer)\b/gi;

export function extractActors(text: string): string[] {
  return [...new Set((text.match(ROLE_PATTERN) ?? []).map((r) => r.toLowerCase().trim()))];
}

// ─── Causal language ──────────────────────────────────────────────────────────

const CAUSAL_RE =
  /\b(causes?|leads?\s+to|results?\s+in|therefore|consequently|thus|hence|implies?|because|due\s+to)\b/i;

export function hasCausalLanguage(text: string): boolean {
  return CAUSAL_RE.test(text);
}

// ─── Uncertainty language ─────────────────────────────────────────────────────

const UNCERTAINTY_RE =
  /\b(may\s+(?:lead|result|cause)|could|might|possibly|likely|appear[s]?\s+to|suggest[s]?|indicate[s]?|risk[s]?\s+of|potentially|perhaps)\b/i;

export function hasUncertaintyLanguage(text: string): boolean {
  return UNCERTAINTY_RE.test(text);
}

// ─── Absence language ─────────────────────────────────────────────────────────

const ABSENCE_RE =
  /\b(does\s+not|do\s+not|no\s+.{0,40}defined|no\s+.{0,40}specified|lacks?|missing|absent|not\s+(?:defined|specified|identified|mentioned|addressed|included|provided|established|set))\b/i;

export function hasAbsenceLanguage(text: string): boolean {
  return ABSENCE_RE.test(text);
}

// ─── Scope overreach detection ────────────────────────────────────────────────

const ORG_SCOPE_RE =
  /\b(the\s+organisation|this\s+organisation|our\s+organisation|the\s+company|all\s+services?|across\s+the\s+organisation)\b/i;

export function hasOrganisationScopeClaim(claimText: string): boolean {
  return ORG_SCOPE_RE.test(claimText);
}

// ─── Core: Conflict detection ─────────────────────────────────────────────────

/**
 * Compares a claim's textual signals against the chunk text to detect material conflicts.
 *
 * Returns an ordered list of ConflictSignal items. An empty array means no
 * deterministic conflict was found — does NOT mean the claim is semantically
 * supported (residual risk remains).
 *
 * When `span` is provided, the comparison is restricted to signals extracted
 * from the span rather than the full chunk.
 */
export function detectMaterialConflicts(
  claimText: string,
  chunkText: string,
  span?: string,
): ConflictSignal[] {
  const conflicts: ConflictSignal[] = [];
  const referenceText = span ?? chunkText;

  // ── 1. Timeframe mismatch ─────────────────────────────────────────────────
  const claimTimes = extractTimeframes(claimText);
  const chunkTimes = extractTimeframes(referenceText);

  if (claimTimes.length > 0 && chunkTimes.length > 0) {
    for (const ct of claimTimes) {
      const normUnit = normaliseTimeUnit(ct.unit);
      const matching = chunkTimes.filter((ct2) => normaliseTimeUnit(ct2.unit) === normUnit);
      if (matching.length > 0 && !matching.some((m) => m.quantity === ct.quantity)) {
        conflicts.push({
          signalType: "timeframe_mismatch",
          claimValue: ct.raw,
          chunkValue: matching.map((m) => m.raw).join(", "),
          description: `Claim states "${ct.raw}" but evidence references "${matching.map((m) => m.raw).join(", ")}"`,
        });
      }
    }
  }

  // ── 2. Obligation level mismatch ─────────────────────────────────────────
  const claimObligation = extractObligationLevel(claimText);
  const chunkObligation = extractObligationLevel(referenceText);

  if (
    claimObligation === "mandatory" &&
    chunkObligation === "permissive" &&
    claimObligation !== "none" &&
    chunkObligation !== "none"
  ) {
    conflicts.push({
      signalType: "obligation_level_mismatch",
      claimValue: "mandatory (must/shall/required)",
      chunkValue: "permissive (may/should/can)",
      description: `Claim uses mandatory language but evidence uses permissive language`,
    });
  }

  // ── 3. Negation reversal ──────────────────────────────────────────────────
  const claimNegated = hasNegation(claimText);
  const chunkNegated = hasNegation(referenceText);

  if (claimNegated !== chunkNegated) {
    // Only flag when the claim and evidence have opposite negation on key content words
    const claimKeywords = extractKeyContentWords(claimText);
    const chunkKeywords = extractKeyContentWords(referenceText);
    const sharedKeywords = claimKeywords.filter((w) => chunkKeywords.includes(w));

    if (sharedKeywords.length > 0) {
      conflicts.push({
        signalType: "negation_reversal",
        claimValue: claimNegated ? "negated" : "affirmative",
        chunkValue: chunkNegated ? "negated" : "affirmative",
        description: `Claim ${claimNegated ? "negates" : "asserts"} a proposition that the evidence ${chunkNegated ? "negates" : "asserts"} — possible reversal on: ${sharedKeywords.slice(0, 3).join(", ")}`,
      });
    }
  }

  // ── 4. Actor mismatch ─────────────────────────────────────────────────────
  const claimActors = extractActors(claimText);
  const chunkActors = extractActors(referenceText);

  if (claimActors.length > 0 && chunkActors.length > 0) {
    const claimExclusive = claimActors.filter((a) => !chunkActors.some((b) => actorMatch(a, b)));
    const chunkExclusive = chunkActors.filter((a) => !claimActors.some((b) => actorMatch(a, b)));

    if (claimExclusive.length > 0 && chunkExclusive.length > 0) {
      conflicts.push({
        signalType: "actor_mismatch",
        claimValue: claimExclusive.join(", "),
        chunkValue: chunkExclusive.join(", "),
        description: `Claim assigns responsibility to "${claimExclusive.join(", ")}" but evidence names "${chunkExclusive.join(", ")}"`,
      });
    }
  }

  return conflicts;
}

// ─── Span support classification ──────────────────────────────────────────────

/**
 * Given a verified span and its chunk, classify whether the span actually
 * supports the claim.
 *
 * Pre-condition: `span` has already passed exact-substring verification.
 *
 * Returns `"contradictory"` only when a concrete factual conflict is detected
 * (e.g. timeframe mismatch). Returns `"uncertain"` for weaker conflicts.
 */
export function classifySpanSupport(
  span: string,
  chunkText: string,
  claimText: string,
): SpanSupportResult {
  const conflicts = detectMaterialConflicts(claimText, chunkText, span);

  if (conflicts.length === 0) {
    return { classification: "supporting", conflicts: [] };
  }

  // Timeframe and number mismatches are clear factual conflicts → contradictory
  const hasHardConflict = conflicts.some(
    (c) => c.signalType === "timeframe_mismatch" || c.signalType === "number_mismatch",
  );

  return {
    classification: hasHardConflict ? "contradictory" : "uncertain",
    conflicts,
  };
}

// ─── Claim-type integrity ─────────────────────────────────────────────────────

/**
 * Detect claim-type integrity risks for claims marked as "observation".
 *
 * Server does not correct the claimType stored in the DB — that would alter
 * the specialist's structured output. Instead, the provenanceStatus is
 * downgraded when a risk is detected.
 *
 * What remains model-dependent:
 *   - Subtle inference that uses no detectable causal/uncertainty language.
 *   - Complex conditional logic that a regex cannot parse correctly.
 */
export function detectClaimTypeRisk(
  claimText: string,
  emittedType: string,
): ClaimTypeRiskResult {
  const signals: string[] = [];

  if (emittedType === "observation") {
    // Causal language suggests professional interpretation, not documentary fact
    if (hasCausalLanguage(claimText)) {
      signals.push(`Causal language detected ("causes/leads to/results in") — observation may actually be an inference`);
    }

    // Uncertainty language in an observation claim
    if (hasUncertaintyLanguage(claimText)) {
      signals.push(`Uncertainty language detected ("may/could/might/likely") — observation may actually be an inference`);
    }

    // Absence language in an observation claim
    if (hasAbsenceLanguage(claimText)) {
      signals.push(`Absence language detected ("does not/no X defined") — this should be absence_finding, not observation`);
    }

    if (signals.length === 0) {
      return { risk: "none", signals: [] };
    }

    // Determine risk type — causal/uncertainty takes precedence over absence.
    // Rationale: "Lack of X leads to Y" has "lack" (absence language) as the
    // SUBJECT of a causal claim — the primary risk is inference masquerading as
    // observation, not an absence assertion. Prefer inference_pattern when both
    // signals are detected so the caller applies the more protective downgrade.
    const hasAbsence = signals.some((s) => s.includes("Absence"));
    const hasCausal  = signals.some((s) => s.includes("Causal") || s.includes("Uncertainty"));

    if (hasCausal) return { risk: "inference_pattern", signals };
    if (hasAbsence) return { risk: "absence_pattern", signals };
    return { risk: "inference_pattern", signals };
  }

  // For non-observation types, no integrity risk from this check
  return { risk: "none", signals: [] };
}

// ─── Scope overreach check ────────────────────────────────────────────────────

/**
 * Validates whether a claim's stated scope matches the evidence search scope.
 *
 * Organisation-wide claims can only be grounded if the search scope covers
 * the whole organisation's document library — a single-document search cannot
 * support an organisation-wide absence statement.
 */
export function detectScopeOverreach(
  claimText: string,
  searchedSourceCount: number,
): ClaimTypeRiskResult {
  if (hasOrganisationScopeClaim(claimText) && searchedSourceCount <= 1) {
    return {
      risk: "scope_overreach",
      signals: [
        `Claim uses organisation-wide scope ("the organisation", "across the organisation") ` +
          `but only ${searchedSourceCount} document source(s) were searched — ` +
          `scope of claim exceeds scope of search`,
      ],
    };
  }
  return { risk: "none", signals: [] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normaliseTimeUnit(unit: string): string {
  const u = unit.toLowerCase().replace(/s$/, "");
  if (u === "fortnight") return "week"; // normalise fortnight ≈ 2 weeks (signal only)
  return u;
}

/** Extracts content words (nouns/verbs) for negation comparison. */
function extractKeyContentWords(text: string): string[] {
  const stopwords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "and", "or", "but", "not", "no",
    "that", "this", "it", "its", "i", "you", "we", "they", "them", "their",
    "all", "any", "each", "both", "such", "if", "then", "than", "so", "yet",
  ]);
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopwords.has(w));
}

/** Fuzzy actor match (handles partial overlap like "manager" ≈ "service manager"). */
function actorMatch(a: string, b: string): boolean {
  return a === b || a.includes(b) || b.includes(a);
}
