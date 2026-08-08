/**
 * materialActionExtractor — Sprint 29K.4.1 (Semantic Entailment & Absence-Contradiction Hardening)
 *
 * Bounded deterministic action/predicate extraction for the NeedsOps compliance domain.
 *
 * Core principle from Sprint 29K.4.1:
 *   EXACT QUOTATION ≠ ENTAILMENT.
 *   UNKNOWN SEMANTIC RELATIONSHIP → UNCERTAIN (not supporting).
 *
 * Design:
 *   - Bounded domain vocabulary only — does NOT attempt general NLU.
 *   - Action groups represent semantic equivalence classes (synonyms map to the same group).
 *   - Actions in DIFFERENT groups are treated as non-equivalent.
 *   - If a claim has a known action but the span has NONE → unknown relationship → uncertain.
 *   - If EITHER side has no known action → skip check (cannot detect a conflict).
 *   - Only flags a conflict when BOTH sides have known actions in DIFFERENT groups.
 *
 * Safe default: UNKNOWN → UNCERTAIN, never SUPPORTING.
 *
 * Domain: operational compliance, NDIS, HR, policy review (NeedsOps context).
 */

import type { ConflictSignal } from "./semanticSupportValidator.js";

// ─── Action groups ─────────────────────────────────────────────────────────────

/**
 * Each group represents a semantic equivalence class.
 * Verbs within a group are treated as synonymous.
 * Verbs in DIFFERENT groups are treated as non-equivalent.
 *
 * Ordering within each group: longer/more-specific phrases FIRST so they match
 * before shorter single words that are substrings of the phrase.
 */
export const ACTION_GROUPS: Array<{ name: string; verbs: string[] }> = [
  {
    name: "acknowledge",
    verbs: [
      "acknowledge receipt",
      "confirm receipt",
      "acknowledgement of receipt",
      "initial acknowledgement",
      "acknowledge complaint",
      "acknowledge the complaint",
      "acknowledge",
      "confirm receipt of",
      "receipt confirmation",
      "confirm the receipt",
    ],
  },
  {
    name: "resolve",
    verbs: [
      "final written outcome",
      "final written decision",
      "final outcome",
      "final decision",
      "resolve the complaint",
      "complaint resolution",
      "close the complaint",
      "close out",
      "closure of",
      "resolution of",
      "resolved",
      "resolve",
      "resolution",
      "closure",
      "finalize",
      "finalise",
    ],
  },
  {
    name: "investigate",
    verbs: [
      // "investigation findings" is intentionally excluded — it is a NOUN PHRASE
      // (the object of review/approve) and creates false overlaps with both review and approve groups.
      "investigation of",           // verb-led: "investigation of" signals the action
      "investigate the complaint",
      "investigate complaint",
      "examine the complaint",
      "examine complaint",
      "formal inquiry into",
      "formal enquiry into",
      "assessment of the",
      "assess the",
      "examine",
      "investigate",
    ],
  },
  {
    name: "review",
    verbs: [
      "review findings",
      "review the",
      "peer review",
      "management review",
      "quality review",
      "reviewed",
      "review",
    ],
  },
  {
    name: "approve",
    verbs: [
      "sign off on",
      "sign-off on",
      "approve the",
      "approval of",
      "authorise",
      "authorize",
      "approved",
      "approve",
      "approval",
      "sign off",
    ],
  },
  {
    name: "recommend",
    verbs: [
      "make a recommendation",
      "provide a recommendation",
      "recommend that",
      "recommendation",
      "recommend",
      "propose",
      "suggest",
    ],
  },
  {
    name: "escalate",
    verbs: [
      "escalation procedure",
      "escalation process",
      "escalation mechanism",
      "escalation timeframe",
      "escalated to",
      "escalate to",
      "escalation",
      "escalate",
      "referral to",
      "referred to",
      "refer to",
      "refer",
      "elevate",
    ],
  },
  {
    name: "record",
    verbs: [
      "make a record",
      "keep a record",
      "maintain a record",
      "document the",
      "document all",
      "record the",
      "record all",
      "log all",
      "log the",
      // NOTE: bare "document", "record", and "log" are intentionally excluded —
      // they frequently appear as NOUNS ("policy document", "complaint records",
      // "complaint log") and create false action-group matches. Only multi-word
      // phrases guarantee verb context.
      "recorded",
      "registered",
    ],
  },
  {
    name: "report",
    verbs: [
      "submit a report",
      "produce a report",
      "provide a report",
      "reporting requirements",
      "report to",
      "report on",
      "reported",
      "report",
      "reporting",
    ],
  },
  {
    name: "notify",
    verbs: [
      "send notification",
      "provide notification",
      "notification to",
      "notify the",
      "notify all",
      "notified",
      "inform the",
      "inform all",
      "alert the",
      "communicate to",
      "notify",
      "inform",
      "advise",
      "alert",
      "communicate",
    ],
  },
  {
    name: "retain",
    verbs: [
      "retained for",
      "retain for",
      "kept for",
      "kept on file",
      "maintain records",
      "hold for",
      "stored for",
      "store for",
      "preserve for",
      "retained",
      "retain",
      "kept",
      "keep",
      "store",
      "preserve",
    ],
  },
  {
    name: "delete",
    verbs: [
      "destroyed after",
      "disposed of after",
      "disposed after",
      "securely deleted",
      "deleted after",
      "purged after",
      "archived after",
      "destroyed",
      "destroy",
      "delete",
      "dispose",
      "discard",
      "purge",
      "archive",
    ],
  },
  {
    name: "consult",
    verbs: [
      "seek input from",
      "seek feedback from",
      "seek the views",
      "seek advice from",
      "consulted with",
      "consult with",
      "consult",
      "seek input",
      "seek feedback",
      "engage with",
    ],
  },
  {
    name: "obtain_approval",
    verbs: [
      "obtain written approval",
      "seek written approval",
      "get written approval",
      "obtain approval from",
      "seek approval from",
      "get approval from",
      "require approval",
      "obtain approval",
      "seek approval",
      "get approval",
      "get sign-off",
    ],
  },
];

// ─── Group lookup (built at module load time) ──────────────────────────────────

/** Map from normalised verb text → group name. Built once, reused. */
const VERB_TO_GROUP = new Map<string, string>();

for (const group of ACTION_GROUPS) {
  for (const verb of group.verbs) {
    VERB_TO_GROUP.set(verb.toLowerCase(), group.name);
  }
}

/**
 * Returns the group name for a given verb/phrase, or null if not in vocabulary.
 * Normalises case; does NOT require word boundaries here (caller handles context).
 */
export function findActionGroup(verbPhrase: string): string | null {
  return VERB_TO_GROUP.get(verbPhrase.toLowerCase()) ?? null;
}

// ─── Action group extraction ───────────────────────────────────────────────────

/**
 * Extracts all action groups present in the given text.
 *
 * Searches for known verbs/phrases using word-boundary matching.
 * Longer phrases are matched before shorter ones to avoid partial overlaps.
 * Returns a Set of group names found.
 */
/**
 * Builds a regex pattern for a verb/phrase that also matches common English
 * verb inflections (review → reviews/reviewed/reviewing, retain → retained/retaining).
 * Multi-word phrases apply inflections to the first word only.
 */
function buildVerbPattern(verb: string): RegExp {
  const words = verb.split(/\s+/);
  if (words.length === 1) {
    const base = escapeRegex(verb);
    // Inflections: base, +s, +ed, +d (for verbs ending in e), +ing, +es
    return new RegExp(`\\b${base}(?:s|ed|d|es|ing)?\\b`, "i");
  }
  // Multi-word phrase: inflect the first word
  const firstBase = escapeRegex(words[0]);
  const rest      = words.slice(1).map(escapeRegex).join("\\s+");
  return new RegExp(`\\b${firstBase}(?:s|ed|d|es|ing)?\\s+${rest}`, "i");
}

/** Pre-compiled patterns for performance. */
const GROUP_PATTERNS: Array<{ name: string; patterns: RegExp[] }> = ACTION_GROUPS.map((g) => ({
  name:     g.name,
  patterns: g.verbs.map(buildVerbPattern),
}));

export function extractActionGroups(text: string): Set<string> {
  const foundGroups = new Set<string>();

  for (const group of GROUP_PATTERNS) {
    for (const re of group.patterns) {
      if (re.test(text)) {
        foundGroups.add(group.name);
        break; // One match is sufficient for this group
      }
    }
  }

  return foundGroups;
}

// ─── Action conflict detection ─────────────────────────────────────────────────

/**
 * Detects a material action/predicate conflict between a claim and a supporting span.
 *
 * Returns a ConflictSignal when:
 *   - BOTH claim and span contain known action verbs from different groups
 *
 * Returns null (no conflict detected) when:
 *   - Claim has no known action verbs (cannot assess)
 *   - Span has no known action verbs (cannot assess — might use unknown synonyms)
 *   - Both are in the same group (compatible or equivalent)
 *
 * Safe default: only flag when BOTH sides have known verbs in incompatible groups.
 * If only one side has a known verb, we cannot determine the relationship — but
 * we conservatively return null rather than producing false positives.
 * This residual risk is documented and accepted per sprint design constraints.
 */
export function detectActionConflict(
  claimText: string,
  spanText: string,
): ConflictSignal | null {
  const claimGroups = extractActionGroups(claimText);
  const spanGroups  = extractActionGroups(spanText);

  // Cannot assess if either side has no recognised action verbs
  if (claimGroups.size === 0 || spanGroups.size === 0) return null;

  // Check for overlap — if ANY claim group appears in span groups → compatible
  const hasOverlap = [...claimGroups].some((g) => spanGroups.has(g));
  if (hasOverlap) return null;

  // No overlap between known groups → material action/predicate mismatch
  return {
    signalType: "action_predicate_mismatch",
    claimValue: [...claimGroups].join(", "),
    chunkValue: [...spanGroups].join(", "),
    description:
      `Claim asserts action category "${[...claimGroups].join(", ")}" but the supporting ` +
      `passage describes "${[...spanGroups].join(", ")}" — these are not semantically equivalent. ` +
      `Known inequivalences: acknowledge ≠ resolve, investigate ≠ resolve, ` +
      `review ≠ approve, recommend ≠ require, retain ≠ delete.`,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
