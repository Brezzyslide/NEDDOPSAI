/**
 * absenceCandidateClassifier — Sprint 29K.4.1 (Semantic Entailment & Absence-Contradiction Hardening)
 *
 * Classifies an absence-search candidate passage against the specific missing element
 * of an absence_finding claim.
 *
 * Core principle:
 *   RETRIEVAL RELEVANCE ≠ REQUIREMENT PRESENT.
 *
 * A retrieved passage that discusses an escalation concept does NOT prove an
 * escalation TIMEFRAME exists unless it explicitly establishes that specific element.
 *
 * The four-way classification:
 *
 *   REQUIREMENT_PRESENT
 *     The passage positively establishes the specific missing element claimed absent.
 *     For "no escalation timeframe": passage must contain a concrete timeframe (number
 *     + time unit) in context of escalation.
 *     → contradicted_absence
 *
 *   REQUIREMENT_ABSENT_OR_PENDING
 *     The passage discusses the concept but explicitly confirms it is missing, pending,
 *     or under development ("under development", "will be added", "future revision").
 *     → supports the absence claim — NOT contradicted_absence
 *
 *   CONTEXT_ONLY
 *     The passage discusses the same topic but does not establish whether the specific
 *     missing element exists.
 *     e.g. "Complaints may be escalated to the Service Manager" for "no escalation timeframe"
 *     → topic present but element not established — NOT contradicted_absence
 *
 *   AMBIGUOUS
 *     The passage cannot be safely classified.
 *     → NOT contradicted_absence (conservative default)
 *
 * Design constraints:
 *   - No LLM. Pure deterministic regex-based.
 *   - Bounded domain vocabulary.
 *   - Conservative: when in doubt → CONTEXT_ONLY or AMBIGUOUS (not REQUIREMENT_PRESENT).
 *   - Only REQUIREMENT_PRESENT → contradicted_absence.
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

export type MissingElement =
  | "timeframe"
  | "owner"
  | "procedure"
  | "appeal"
  | "review"
  | "classification"
  | "resolution"
  | "other";

export type AbsenceCandidateClassification =
  | "requirement_present"
  | "requirement_absent_or_pending"
  | "context_only"
  | "ambiguous";

export interface AbsenceCandidateResult {
  classification: AbsenceCandidateClassification;
  matchedElement: MissingElement;
  reasonCodes: string[];
}

// ─── Pending / absent language detection ──────────────────────────────────────

const PENDING_PATTERNS: string[] = [
  "under development",
  "being developed",
  "currently being developed",
  "will be added",
  "will be developed",
  "will be established",
  "will be introduced",
  "will be addressed",
  "will be considered",
  "will be included",
  "pending",
  "not yet defined",
  "not yet established",
  "not yet developed",
  "not yet available",
  "yet to be defined",
  "yet to be developed",
  "yet to be established",
  "future policy",
  "future revision",
  "future review",
  "future version",
  "forthcoming",
  "in development",
  "currently in development",
  "currently under review",
  "to be developed",
  "to be established",
  "to be defined",
  "currently being reviewed",
  "being reviewed",
  "being established",
  "being finalised",
  "being finalized",
  "is planned",
  "are planned",
  "will be created",
  "will be updated",
  "will be revised",
];

export function hasPendingLanguage(text: string): boolean {
  const t = text.toLowerCase();
  return PENDING_PATTERNS.some((p) => t.includes(p));
}

// ─── Missing element extraction ───────────────────────────────────────────────

/**
 * Extracts what specific element the absence claim says is missing.
 *
 * Priority order: more specific patterns first.
 */
export function extractMissingElement(claimText: string): MissingElement {
  const t = claimText.toLowerCase();

  // Timeframe variants (most common in complaints policies)
  if (
    /\b(?:timeframe|time\s*limit|deadline|within\b|response\s+time|time\s+frame)\b/.test(t) ||
    /\b(?:days?|weeks?|hours?|months?)\b/.test(t)
  ) {
    return "timeframe";
  }

  // Owner / responsibility
  if (/\b(?:owner|responsible|responsibility|decision.?mak|accountability|who\s+(?:is|should|must)|assigned\s+to)\b/.test(t)) {
    return "owner";
  }

  // Classification / categorisation — checked BEFORE appeal/review/procedure
  // because the claim text often also contains "policy" (which would match procedure).
  // Use stem patterns (no trailing \b) to catch "classification", "categorisation", etc.
  if (/\b(?:classif|categor|severity|priorit)/.test(t)) {
    return "classification";
  }

  // Appeal mechanism
  if (/\bappeal\b/.test(t)) {
    return "appeal";
  }

  // Review mechanism
  if (/\breview\b/.test(t)) {
    return "review";
  }

  // Resolution (after timeframe — "resolution timeframe" is caught above)
  if (/\b(?:resolut|resolve|closure|close)\b/.test(t)) {
    return "resolution";
  }

  // Procedure / process / mechanism
  if (/\b(?:procedure|process|mechanism|protocol|policy|guideline|framework)\b/.test(t)) {
    return "procedure";
  }

  return "other";
}

// ─── Concept synonym maps ──────────────────────────────────────────────────────

/**
 * Concept synonyms for element-in-context checking.
 * Maps from an abstract concept code → list of text patterns to search for.
 */
const CONCEPT_SYNONYMS: Record<string, string[]> = {
  escalat: ["escalat", "refer", "referral", "elevat"],
  resolut: [
    "resolut", "resolve", "closure", "close out", "final outcome",
    "final written outcome", "final written decision", "final decision",
    "outcome", "completed",
  ],
  acknowledg: ["acknowledg", "confirm receipt", "receipt", "initial response"],
  appeal:     ["appeal"],
  investigat: ["investigat", "inquiry", "enquiry", "examination"],
  review:     ["review"],
  complaint:  ["complaint", "complain", "grievan"],
  incident:   ["incident"],
};

/**
 * Extracts the primary topic concept from an absence claim.
 *
 * Returns a concept code that can be looked up in CONCEPT_SYNONYMS.
 * Order: most specific first.
 */
export function extractClaimAbsenceConcept(claimText: string): string | null {
  const t = claimText.toLowerCase();

  if (/\bescalat/.test(t)) return "escalat";
  if (/\bappeal\b/.test(t))  return "appeal";
  if (/\binvestigat/.test(t)) return "investigat";
  // Use stem /\bresolv/ to catch resolve/resolving/resolved/resolution
  if (/\bresolv/.test(t) || /\bresolut/.test(t) || /\bclosur/.test(t)) return "resolut";
  if (/\backnowledg/.test(t)) return "acknowledg";
  if (/\breview\b/.test(t))  return "review";
  if (/\bgrievan/.test(t))   return "grievan";
  if (/\bincident\b/.test(t)) return "incident";
  if (/\bcomplaint\b/.test(t)) return "complaint";

  return null;
}

function getConceptSynonyms(concept: string): string[] {
  return CONCEPT_SYNONYMS[concept] ?? [concept];
}

// ─── Element establishment checks ─────────────────────────────────────────────

/**
 * Checks whether a candidate passage establishes the specific missing element
 * in the context of the absence claim's topic concept.
 *
 * This is the gate between CONTEXT_ONLY and REQUIREMENT_PRESENT.
 *
 * Conservative: returns false when in doubt.
 */
export function checkElementEstablished(
  element: MissingElement,
  claimText: string,
  candidateText: string,
): boolean {
  const concept = extractClaimAbsenceConcept(claimText);
  const synonyms = concept ? getConceptSynonyms(concept) : [];
  const t = candidateText.toLowerCase();

  switch (element) {
    case "timeframe": {
      // Must contain a specific time quantity (number + time unit).
      // Matches both digit forms ("5 business days") and word forms ("five business days").
      const TIME_UNIT    = "(?:business\\s+|working\\s+)?(?:day|week|month|hour|year)s?";
      const DIGIT_NUM    = `\\b\\d+\\s*${TIME_UNIT}`;
      const WORD_NUMS    = "one|two|three|four|five|six|seven|eight|nine|ten|" +
                           "eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|sixty|ninety";
      const WORD_NUM     = `\\b(?:${WORD_NUMS})\\s+${TIME_UNIT}`;
      const TIMEFRAME_RE = new RegExp(`(?:${DIGIT_NUM}|${WORD_NUM})`, "i");
      const TIMEFRAME_GLOBAL = new RegExp(`(?:${DIGIT_NUM}|${WORD_NUM})`, "gi");

      const hasTimeNum = TIMEFRAME_RE.test(candidateText);
      if (!hasTimeNum) return false;

      // The timeframe must be in context of the CLAIM'S specific concept
      // (not just any timeframe — A9 is about resolution, not acknowledgement)
      if (synonyms.length === 0) {
        // No concept to check against — conservatively allow the timeframe signal
        return true;
      }

      // Find timeframe occurrences and check concept is nearby
      let m: RegExpExecArray | null;
      while ((m = TIMEFRAME_GLOBAL.exec(t)) !== null) {
        const windowStart = Math.max(0, m.index - 130);
        const windowEnd   = Math.min(t.length, m.index + m[0].length + 130);
        const window      = t.slice(windowStart, windowEnd);
        if (synonyms.some((syn) => window.includes(syn))) return true;
      }
      return false;
    }

    case "owner": {
      // Must name a specific role/person AND attribute responsibility to them
      // AND the responsibility must be in context of the claim concept
      const ROLE_RE =
        /\b(?:complaints?\s+officer|service\s+manager|head\s+of\s+(?:operations|services?|department|team|complaints?)|director|supervisor|ceo|board|team\s+leader|responsible\s+officer|case\s+manager|clinical\s+(?:lead|director)|quality\s+officer|operations?\s+manager|program\s+manager)\b/i;
      const RESPONSIBILITY_RE =
        /\b(?:is\s+responsible|decides?|must|shall|will\s+(?:decide|handle|manage|lead)|has\s+authority|oversees?|manages?|leads?|is\s+assigned|is\s+designated|is\s+the\s+\w+\s+for|takes?\s+responsibility|accountable)\b/i;

      if (!ROLE_RE.test(candidateText) || !RESPONSIBILITY_RE.test(candidateText)) {
        return false;
      }

      // Role must be in context of the relevant concept
      if (synonyms.length === 0) return true;
      return synonyms.some((syn) => t.includes(syn));
    }

    case "procedure": {
      // Must contain a mandatory procedural rule about the topic concept
      if (synonyms.length === 0) {
        // Generic: any mandatory rule
        return /\b(?:must|shall|required\s+to|is\s+required)\b/i.test(candidateText);
      }
      // Mandatory rule in context of the specific concept
      return synonyms.some(
        (syn) =>
          new RegExp(
            `\\b(?:must|shall|required\\s+to|is\\s+required)\\b.{0,120}${escapeRegex(syn)}`,
            "i",
          ).test(t) ||
          new RegExp(
            `${escapeRegex(syn)}.{0,120}\\b(?:must|shall|required\\s+to|is\\s+required)\\b`,
            "i",
          ).test(t),
      );
    }

    case "appeal": {
      // Must establish a right or mechanism to appeal — not just mention appeals
      return (
        /\b(?:may|can|has\s+the\s+right\s+to|entitled\s+to|is\s+able\s+to|is\s+entitled)\b.{0,80}\bappeal\b/i.test(
          candidateText,
        ) ||
        /\bappeal\b.{0,100}\b(?:panel|board|review\s+panel|within|mechanism|process|right|available|accepted|submitted|heard)\b/i.test(
          candidateText,
        ) ||
        /\b(?:complainant|person|individual|applicant).{0,80}\b(?:may|can|has\s+the\s+right)\b.{0,80}\bappeal\b/i.test(
          candidateText,
        )
      );
    }

    case "review": {
      // Must establish a review process as a mandatory/defined step
      return /\b(?:must|shall|will|required\s+to)\b.{0,80}\brevie\w+\b/i.test(candidateText) ||
             /\brevie\w+\b.{0,80}\b(?:must|shall|will|required|mandatory|formal)\b/i.test(candidateText);
    }

    case "resolution": {
      // Must establish a resolution deadline specifically — digit OR word-form number.
      const TIME_UNIT = "(?:business\\s+|working\\s+)?(?:day|week|month|hour|year)s?";
      const WORD_NUMS = "one|two|three|four|five|six|seven|eight|nine|ten|" +
                        "eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|sixty|ninety";
      const hasTimeNum = new RegExp(
        `(?:\\b\\d+\\s*${TIME_UNIT}|\\b(?:${WORD_NUMS})\\s+${TIME_UNIT})`,
        "i",
      ).test(candidateText);
      const resolutionSynonyms = getConceptSynonyms("resolut");
      return hasTimeNum && resolutionSynonyms.some((syn) => t.includes(syn));
    }

    case "classification": {
      // Must establish classification/categorisation rules
      return /\b(?:must|shall|required|will)\b.{0,80}\b(?:classif|categor|tier|priorit|level)\b/i.test(
        candidateText,
      );
    }

    default: {
      // "other" — general mandatory requirement
      return /\b(?:must|shall|required\s+to|is\s+required)\b/i.test(candidateText);
    }
  }
}

// ─── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classifies an absence-search candidate passage against the specific missing
 * element of an absence_finding claim.
 *
 * SAFE CONTRACT:
 *   - Only REQUIREMENT_PRESENT triggers contradicted_absence.
 *   - REQUIREMENT_ABSENT_OR_PENDING, CONTEXT_ONLY, AMBIGUOUS do NOT.
 *   - When in doubt → CONTEXT_ONLY (never REQUIREMENT_PRESENT).
 */
export function classifyAbsenceCandidate(
  claimText: string,
  candidateText: string,
): AbsenceCandidateResult {
  // Step 1: Check for explicit pending/absent language first
  if (hasPendingLanguage(candidateText)) {
    return {
      classification:  "requirement_absent_or_pending",
      matchedElement:  extractMissingElement(claimText),
      reasonCodes:     ["PENDING_LANGUAGE_DETECTED"],
    };
  }

  // Step 2: Extract the specific missing element
  const element = extractMissingElement(claimText);

  // Step 3: Check if the passage establishes the specific element
  //         with contextual awareness (which concept the element relates to)
  const establishes = checkElementEstablished(element, claimText, candidateText);

  if (establishes) {
    return {
      classification: "requirement_present",
      matchedElement: element,
      reasonCodes:    ["ELEMENT_ESTABLISHED_IN_CANDIDATE"],
    };
  }

  // Step 4: Context-only — topic discussed but element not established
  return {
    classification: "context_only",
    matchedElement: element,
    reasonCodes:    ["TOPIC_DISCUSSED_ELEMENT_NOT_ESTABLISHED"],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
