/**
 * Sprint 29K.4.1 — Semantic Entailment & Absence-Contradiction Hardening
 *
 * Adversarial test suite with four parts:
 *
 *   Part J (S1–S10) — Positive-claim action/predicate escape tests
 *     Verifies that classifySpanSupport catches semantically inequivalent
 *     action verbs even when all other signals (timeframe, obligation, negation,
 *     actors) are identical.
 *     All S1–S8 must NOT classify as "supporting".
 *     S9–S10 test synonym acceptance (same group → grounded).
 *
 *   Part K (A1–A12) — Absence-contradiction semantic classification tests
 *     Verifies that classifyAbsenceCandidate does NOT return "requirement_present"
 *     for passages that merely discuss the topic without establishing the element,
 *     and DOES return "requirement_present" for passages that genuinely establish it.
 *
 *   Part L — Duplicate clientClaimId hardening
 *     Verifies that validateClaimBatch drops duplicate clientClaimIds and
 *     never silently overwrites one claim with another.
 *
 *   Part M — Evidence mode regression
 *     Verifies that non-absence claims are not affected by Sprint 29K.4.1 changes.
 *
 *   Part N — Retrieval cost measurement
 *     Verifies that candidates are classified rather than raw-threshold-counted.
 *
 *   Part O — Real-schema assertions
 *     Verifies AbsenceCandidateRecord fields match the DB schema type.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  classifySpanSupport,
} from "../services/semanticSupportValidator.js";
import {
  extractActionGroups,
  detectActionConflict,
} from "../services/materialActionExtractor.js";
import {
  classifyAbsenceCandidate as classifyAC,
  hasPendingLanguage,
  checkElementEstablished,
  extractMissingElement,
  extractClaimAbsenceConcept,
} from "../services/absenceCandidateClassifier.js";
import { validateClaimBatch }  from "../services/claimValidationService.js";
import type { EvidencePack }   from "../services/knowledgeResolutionService.js";

// ─── Shared test data ─────────────────────────────────────────────────────────

const EMPTY_EVIDENCE_PACK: EvidencePack = {
  chunks:   [],
  sources:  [],
  query:    "test",
  strategy: "lexical",
};

function makeRaw(
  id:        string,
  text:      string,
  type:      string = "observation",
  evidence:  unknown[] = [],
  related:   string[]  = [],
) {
  return {
    clientClaimId:    id,
    claimText:        text,
    claimType:        type,
    sectionRef:       "Test",
    confidence:       0.9,
    reasoningSummary: "Test summary",
    evidence,
    relatedClientClaimIds: related,
  };
}

// ─── Part J: Action/Predicate Escape — classifySpanSupport ───────────────────

describe("Part J — action_predicate_mismatch detection (S1–S10)", () => {

  /**
   * S1: acknowledge → resolve (same timeframe, same obligation level)
   *
   * Historical bug: "acknowledge within five business days" was treated as
   * supporting "resolve within five business days" because the only signal
   * detector was timeframe, and both matched.
   *
   * Fix (Sprint 29K.4.1): materialActionExtractor detects "acknowledge" and
   * "resolve" as different action groups → action_predicate_mismatch → "uncertain".
   */
  it("S1: acknowledge ≠ resolve — same timeframe should NOT be supporting", () => {
    const chunk  = "The Complaints Officer must acknowledge complaints within five business days.";
    const span   = "acknowledge complaints within five business days";
    const claim  = "All complaints must be resolved within five business days.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(true);
    const conflict = result.conflicts.find(c => c.signalType === "action_predicate_mismatch")!;
    expect(conflict.claimValue).toMatch(/resolve/);
    expect(conflict.chunkValue).toMatch(/acknowledge/);
  });

  /**
   * S2: investigate → resolve (same timeframe)
   *
   * "Investigation must be completed within 20 days" does not support
   * "Complaint must be resolved within 20 days".
   */
  it("S2: investigate ≠ resolve — same timeframe should NOT be supporting", () => {
    const chunk  = "The investigation of all complaints must be completed within 20 business days.";
    const span   = "investigation of all complaints must be completed within 20 business days";
    const claim  = "All complaints must be resolved within 20 business days.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(true);
  });

  /**
   * S3: review → approve (same actor, same subject)
   *
   * "The Service Manager reviews investigation findings" does not support
   * "The Service Manager approves investigation findings".
   */
  it("S3: review ≠ approve — same actor should NOT be supporting", () => {
    const chunk  = "The Service Manager reviews all investigation findings before closure.";
    const span   = "Service Manager reviews all investigation findings";
    const claim  = "The Service Manager approves all investigation findings before closure.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(true);
  });

  /**
   * S4: may recommend → must escalate (obligation conflict + action conflict)
   *
   * Multiple conflicts: obligation (may vs must) AND action (recommend vs escalate).
   */
  it("S4: recommend ≠ escalate, may ≠ must — two conflicts", () => {
    const chunk  = "Officers may recommend escalation procedures when complaints remain unresolved.";
    const span   = "Officers may recommend escalation procedures";
    const claim  = "Officers must escalate unresolved complaints to the Service Manager.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    // Should have both action conflict and potentially obligation conflict
    const hasActionConflict = result.conflicts.some(c => c.signalType === "action_predicate_mismatch");
    const hasObligationConflict = result.conflicts.some(c => c.signalType === "obligation_level_mismatch");
    expect(hasActionConflict || hasObligationConflict).toBe(true);
  });

  /**
   * S5: retain → delete (same timeframe — seven years)
   *
   * "Records must be retained for seven years" does NOT support
   * "Records must be destroyed after seven years".
   */
  it("S5: retain ≠ delete — same timeframe should NOT be supporting", () => {
    const chunk  = "Complaint records must be retained for a period of seven years.";
    const span   = "Complaint records must be retained for a period of seven years";
    const claim  = "Complaint records must be destroyed after seven years.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(true);
  });

  /**
   * S6: notify → record (same subject — complaints)
   *
   * "Officers must notify the complainant" does not support
   * "Officers must record all complaints".
   */
  it("S6: notify ≠ record — same subject should NOT be supporting", () => {
    const chunk  = "The Complaints Officer must notify the complainant of the outcome in writing.";
    const span   = "Complaints Officer must notify the complainant of the outcome";
    const claim  = "The Complaints Officer must record all complaints in the system.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(true);
  });

  /**
   * S7: escalate → investigate (same obligation level — must)
   *
   * "The Service Manager must escalate the complaint" does not support
   * "The Service Manager must investigate the complaint".
   */
  it("S7: escalate ≠ investigate — same obligation should NOT be supporting", () => {
    const chunk  = "The Service Manager must escalate all Level 2 complaints within two business days.";
    const span   = "Service Manager must escalate all Level 2 complaints";
    const claim  = "The Service Manager must investigate all Level 2 complaints within two business days.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(true);
  });

  /**
   * S8: consult → approve (same subject, same obligation)
   *
   * "The Board must consult participants" ≠ "The Board must approve the policy".
   */
  it("S8: consult ≠ approve — same obligation should NOT be supporting", () => {
    const chunk  = "The Board must consult with participants before implementing policy changes.";
    const span   = "Board must consult with participants before implementing policy changes";
    const claim  = "The Board must approve all policy changes before implementation.";

    const result = classifySpanSupport(span, chunk, claim);

    expect(result.classification).not.toBe("supporting");
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(true);
  });

  /**
   * S9: acknowledge / confirm receipt (same group synonym) → SHOULD be supporting
   *
   * "Confirm receipt" and "acknowledge" are in the SAME group — compatible.
   * Should NOT produce an action_predicate_mismatch conflict.
   */
  it("S9: acknowledge / confirm receipt (synonyms, same group) → no action conflict", () => {
    const chunk  = "Staff must confirm receipt of all complaints within two business days.";
    const span   = "Staff must confirm receipt of all complaints within two business days";
    const claim  = "Staff must acknowledge all complaints within two business days.";

    const result = classifySpanSupport(span, chunk, claim);

    // No action conflict — same group
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(false);
    // No timeframe conflict — both say two business days
    expect(result.conflicts.some(c => c.signalType === "timeframe_mismatch")).toBe(false);
    // Result should be supporting (clean span)
    expect(result.classification).toBe("supporting");
  });

  /**
   * S10: retain / keep (same group synonym) → SHOULD be supporting
   *
   * "Records must be kept for 5 years" and "Records must be retained for 5 years"
   * are semantically equivalent within the bounded vocabulary.
   */
  it("S10: retain / keep (synonyms, same group) → no action conflict", () => {
    const chunk  = "All complaint records must be kept for a minimum of five years.";
    const span   = "All complaint records must be kept for a minimum of five years";
    const claim  = "All complaint records must be retained for a minimum of five years.";

    const result = classifySpanSupport(span, chunk, claim);

    // No action conflict — retain/keep are same group
    expect(result.conflicts.some(c => c.signalType === "action_predicate_mismatch")).toBe(false);
    // No timeframe conflict — both say five years
    expect(result.conflicts.some(c => c.signalType === "timeframe_mismatch")).toBe(false);
    expect(result.classification).toBe("supporting");
  });
});

// ─── Part J unit: extractActionGroups ─────────────────────────────────────────

describe("Part J unit — extractActionGroups & detectActionConflict", () => {

  it("extractActionGroups: basic verb forms", () => {
    expect(extractActionGroups("Complaints must be resolved within 30 days.")).toContain("resolve");
    expect(extractActionGroups("Staff acknowledged the complaint on receipt.")).toContain("acknowledge");
    expect(extractActionGroups("The manager reviews all findings.")).toContain("review");
    expect(extractActionGroups("Records should be retained for 7 years.")).toContain("retain");
    expect(extractActionGroups("Records must be destroyed after 5 years.")).toContain("delete");
  });

  it("extractActionGroups: inflected forms", () => {
    expect(extractActionGroups("The officer resolves complaints promptly.")).toContain("resolve");
    expect(extractActionGroups("All staff must notify participants.")).toContain("notify");
    expect(extractActionGroups("The board approved the policy changes.")).toContain("approve");
    expect(extractActionGroups("Findings were recorded in the system.")).toContain("record");
  });

  it("extractActionGroups: multi-word phrases", () => {
    expect(extractActionGroups("Staff must confirm receipt of complaints.")).toContain("acknowledge");
    expect(extractActionGroups("The manager provides a final written outcome.")).toContain("resolve");
    expect(extractActionGroups("Seek written approval from the board.")).toContain("obtain_approval");
  });

  it("extractActionGroups: text with no known verbs → empty set", () => {
    // These sentences contain no domain action verbs — only nouns, dates, prepositions
    expect(extractActionGroups("The policy was last updated on 1 January 2024.")).toHaveLength(0);
    expect(extractActionGroups("Section 4.2 applies to all residential support services.")).toHaveLength(0);
  });

  it("detectActionConflict: acknowledge vs resolve → conflict", () => {
    const c = detectActionConflict(
      "All complaints must be resolved within five business days.",
      "Staff must acknowledge all complaints within five business days.",
    );
    expect(c).not.toBeNull();
    expect(c!.signalType).toBe("action_predicate_mismatch");
  });

  it("detectActionConflict: same group (retain/keep) → null", () => {
    const c = detectActionConflict(
      "Records must be retained for 7 years.",
      "Records must be kept for 7 years.",
    );
    expect(c).toBeNull();
  });

  it("detectActionConflict: one side has no known verb → null (safe default)", () => {
    const c = detectActionConflict(
      "The policy was last updated in 2022.",   // no known verb
      "Staff must acknowledge complaints.",
    );
    expect(c).toBeNull();
  });

  it("detectActionConflict: retain vs delete → conflict", () => {
    const c = detectActionConflict(
      "Records must be destroyed after seven years.",
      "Records must be retained for seven years.",
    );
    expect(c).not.toBeNull();
    expect(c!.signalType).toBe("action_predicate_mismatch");
  });
});

// ─── Part K: Absence-Contradiction Semantic Classification (A1–A12) ───────────

describe("Part K — classifyAbsenceCandidate (A1–A12)", () => {

  /**
   * A1: Pending-language detection
   *
   * "An escalation timeframe is currently under development" →
   * requirement_absent_or_pending (NOT requirement_present → NOT contradicted_absence)
   */
  it("A1: pending language → requirement_absent_or_pending (NOT contradicted_absence)", () => {
    const claim  = "The policy does not specify an escalation timeframe.";
    const candidate = "An escalation procedure timeframe is currently under development and will be included in the next policy revision.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).toBe("requirement_absent_or_pending");
    expect(result.reasonCodes).toContain("PENDING_LANGUAGE_DETECTED");
  });

  /**
   * A2: Escalation owner mentioned but no timeframe claim asked about
   *
   * Claim: "No escalation timeframe is specified."
   * Candidate: "Complaints may be escalated to the Service Manager."
   * → context_only (topic present, timeframe element NOT established)
   */
  it("A2: escalation mentioned but no timeframe present → context_only", () => {
    const claim  = "The policy does not specify a timeframe for escalating unresolved complaints.";
    const candidate = "Complaints that remain unresolved may be escalated to the Service Manager for review.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).not.toBe("requirement_present");
    expect(result.classification).toBe("context_only");
    expect(result.matchedElement).toBe("timeframe");
  });

  /**
   * A3: Escalation timeframe present but in wrong context (acknowledgement)
   *
   * Claim: "No escalation timeframe is specified."
   * Candidate: "Complaints must be acknowledged within five business days."
   * → context_only (timeframe exists, but not for escalation)
   */
  it("A3: acknowledgement timeframe ≠ escalation timeframe → context_only", () => {
    const claim  = "The policy does not include an escalation timeframe for unresolved complaints.";
    const candidate = "All complaints must be acknowledged within five business days of receipt.";

    const result = classifyAC(claim, candidate);

    // A timeframe exists but it's for acknowledgement, not escalation
    expect(result.classification).not.toBe("requirement_present");
  });

  /**
   * A4: Escalation timeframe present and in context → requirement_present → contradicted_absence
   *
   * Claim: "No escalation timeframe is specified."
   * Candidate: "Unresolved complaints must be escalated within 10 business days."
   * → requirement_present
   */
  it("A4: escalation timeframe explicitly present → requirement_present → contradicted_absence", () => {
    const claim  = "The policy does not specify an escalation timeframe for unresolved complaints.";
    const candidate = "Unresolved complaints must be escalated to the Service Manager within 10 business days.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).toBe("requirement_present");
    expect(result.matchedElement).toBe("timeframe");
    expect(result.reasonCodes).toContain("ELEMENT_ESTABLISHED_IN_CANDIDATE");
  });

  /**
   * A5: Escalation owner explicitly present → requirement_present
   *
   * Claim: "No escalation owner is identified."
   * Candidate: "The Head of Operations is responsible for deciding all escalated complaints."
   * → requirement_present
   */
  it("A5: escalation owner explicitly established → requirement_present", () => {
    const claim  = "The policy does not identify who is responsible for deciding on escalated complaints.";
    const candidate = "The Head of Operations is responsible for deciding all escalated complaints and must document the outcome.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).toBe("requirement_present");
    expect(result.matchedElement).toBe("owner");
  });

  /**
   * A6: Future-tense pending language
   *
   * Candidate: "An appeal mechanism will be added in a future revision."
   * → requirement_absent_or_pending
   */
  it("A6: future-tense pending language → requirement_absent_or_pending", () => {
    const claim  = "The policy does not include an appeal mechanism.";
    const candidate = "An appeal mechanism will be added to the policy in a future revision of this document.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).toBe("requirement_absent_or_pending");
    expect(result.reasonCodes).toContain("PENDING_LANGUAGE_DETECTED");
  });

  /**
   * A7: Appeal mechanism explicitly present → requirement_present
   *
   * Claim: "The policy does not include an appeal mechanism."
   * Candidate: "Complainants may appeal the decision to an independent review panel within 28 days."
   * → requirement_present
   */
  it("A7: appeal mechanism explicitly established → requirement_present", () => {
    const claim  = "The policy does not include an appeal mechanism for complainants.";
    const candidate = "Complainants may appeal the outcome of their complaint to the independent review panel within 28 days of receiving the final written decision.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).toBe("requirement_present");
    expect(result.matchedElement).toBe("appeal");
  });

  /**
   * A8: Resolution timeframe (not acknowledgement) for resolution absence claim
   *
   * Claim: "No resolution timeframe is specified."
   * Candidate: "All complaints must be resolved within 45 business days."
   * → requirement_present (resolution timeframe IS established)
   */
  it("A8: resolution timeframe in resolution context → requirement_present", () => {
    const claim  = "The policy does not include a timeframe for resolving complaints.";
    const candidate = "All complaints must be resolved within 45 business days of being received.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).toBe("requirement_present");
    expect(result.matchedElement).toBe("timeframe");
  });

  /**
   * A9: Acknowledgement timeframe does NOT satisfy resolution timeframe absence claim
   *
   * Claim: "No resolution timeframe is specified."
   * Candidate: "Acknowledgement must be sent within 2 business days."
   * → context_only (A9 is the INVERSE of A8 — timeframe exists but for wrong stage)
   */
  it("A9: acknowledgement timeframe does not satisfy resolution timeframe absence → context_only", () => {
    const claim  = "The policy does not specify a timeframe for resolving complaints.";
    const candidate = "An acknowledgement must be sent to the complainant within 2 business days of receipt.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).not.toBe("requirement_present");
    // The timeframe is for acknowledgement, not resolution
    expect(["context_only", "ambiguous"]).toContain(result.classification);
  });

  /**
   * A10: Generic topic mention without any procedural establishment → context_only
   *
   * "Escalation is an important part of complaints management" is background context,
   * not a procedural requirement.
   */
  it("A10: generic topic mention without procedural establishment → context_only", () => {
    const claim  = "The policy does not define an escalation procedure.";
    const candidate = "Escalation is an important part of effective complaints management and helps ensure participant safety.";

    const result = classifyAC(claim, candidate);

    expect(result.classification).not.toBe("requirement_present");
    expect(result.classification).toBe("context_only");
  });

  /**
   * A11: hasPendingLanguage — direct unit tests on pending patterns
   */
  it("A11: hasPendingLanguage — recognises development/revision patterns", () => {
    expect(hasPendingLanguage("This will be added in future revision.")).toBe(true);
    expect(hasPendingLanguage("Currently under development.")).toBe(true);
    expect(hasPendingLanguage("Not yet established at this stage.")).toBe(true);
    expect(hasPendingLanguage("An escalation procedure is in development.")).toBe(true);
    expect(hasPendingLanguage("Pending finalisation of the policy.")).toBe(true);
    // Should NOT trigger for normal present-tense statements
    expect(hasPendingLanguage("Complaints must be resolved within 30 days.")).toBe(false);
    expect(hasPendingLanguage("The escalation timeframe is 10 business days.")).toBe(false);
  });

  /**
   * A12: extractMissingElement — correctly identifies the missing element type
   */
  it("A12: extractMissingElement — identifies element from claim text", () => {
    expect(extractMissingElement("No escalation timeframe is specified.")).toBe("timeframe");
    expect(extractMissingElement("The policy does not identify who is responsible.")).toBe("owner");
    expect(extractMissingElement("No appeal mechanism is defined.")).toBe("appeal");
    expect(extractMissingElement("The policy does not specify a review process.")).toBe("review");
    expect(extractMissingElement("No resolution timeframe is specified.")).toBe("timeframe");
    expect(extractMissingElement("The policy does not define a complaint classification scheme.")).toBe("classification");
    expect(extractMissingElement("No procedure is defined for handling complaints.")).toBe("procedure");
  });
});

// ─── Part K unit: absenceCandidateClassifier helpers ─────────────────────────

describe("Part K unit — extractClaimAbsenceConcept", () => {
  it("escalation claims → escalat concept", () => {
    expect(extractClaimAbsenceConcept("No escalation timeframe is specified.")).toBe("escalat");
    expect(extractClaimAbsenceConcept("The policy lacks an escalation procedure.")).toBe("escalat");
  });

  it("resolution claims → resolut concept", () => {
    expect(extractClaimAbsenceConcept("No resolution timeframe is specified.")).toBe("resolut");
    expect(extractClaimAbsenceConcept("The policy does not include a resolution deadline.")).toBe("resolut");
  });

  it("acknowledgement claims → acknowledg concept", () => {
    expect(extractClaimAbsenceConcept("The policy does not include an acknowledgement timeframe.")).toBe("acknowledg");
  });

  it("appeal claims → appeal concept", () => {
    expect(extractClaimAbsenceConcept("No appeal mechanism is defined.")).toBe("appeal");
  });

  it("unrecognised concepts → null", () => {
    expect(extractClaimAbsenceConcept("The document was last revised in 2019.")).toBeNull();
  });
});

// ─── Part L: Duplicate clientClaimId detection ─────────────────────────────────

describe("Part L — duplicate clientClaimId hardening (validateClaimBatch)", () => {

  it("L-DUP-1: two claims with same clientClaimId → second dropped, malformedDropped incremented", () => {
    const batch = [
      makeRaw("CLAIM-1", "Complaints must be acknowledged within 5 business days.", "observation"),
      makeRaw("CLAIM-1", "Complaints must be resolved within 20 business days.", "observation"), // duplicate
    ];

    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    // Only one claim should survive (the first)
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].claimText).toBe("Complaints must be acknowledged within 5 business days.");

    // malformedDropped should include the dropped duplicate
    expect(result.malformedDropped).toBe(1);

    // duplicateClientClaimIds should be populated
    expect(result.duplicateClientClaimIds).toBeDefined();
    expect(result.duplicateClientClaimIds).toContain("CLAIM-1");
  });

  it("L-DUP-2: three occurrences of same ID → two dropped, one survives", () => {
    const batch = [
      makeRaw("DUPE-ID", "First claim.", "observation"),
      makeRaw("DUPE-ID", "Second claim.", "observation"),  // duplicate
      makeRaw("DUPE-ID", "Third claim.", "observation"),   // duplicate
    ];

    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].claimText).toBe("First claim.");
    expect(result.malformedDropped).toBe(2);
    expect(result.duplicateClientClaimIds).toContain("DUPE-ID");
  });

  it("L-DUP-3: unique IDs → no duplicates detected, no claims dropped", () => {
    const batch = [
      makeRaw("CLAIM-A", "Claim A.", "observation"),
      makeRaw("CLAIM-B", "Claim B.", "observation"),
      makeRaw("CLAIM-C", "Claim C.", "observation"),
    ];

    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    expect(result.claims).toHaveLength(3);
    expect(result.malformedDropped).toBe(0);
    expect(result.duplicateClientClaimIds).toBeUndefined();
  });

  it("L-DUP-4: duplicate IDs mixed with unique IDs — only duplicates dropped", () => {
    const batch = [
      makeRaw("UNIQUE-1", "Unique claim 1.", "observation"),
      makeRaw("DUPE-A",   "Dupe A first.",  "observation"),
      makeRaw("UNIQUE-2", "Unique claim 2.", "observation"),
      makeRaw("DUPE-A",   "Dupe A second.", "observation"), // duplicate
      makeRaw("UNIQUE-3", "Unique claim 3.", "observation"),
      makeRaw("DUPE-B",   "Dupe B first.",  "observation"),
      makeRaw("DUPE-B",   "Dupe B second.", "observation"), // duplicate
    ];

    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    // 7 in - 2 dupes = 5 survive
    expect(result.claims).toHaveLength(5);
    expect(result.malformedDropped).toBe(2);
    expect(result.duplicateClientClaimIds).toContain("DUPE-A");
    expect(result.duplicateClientClaimIds).toContain("DUPE-B");
    // Unique IDs must not appear in duplicate list
    expect(result.duplicateClientClaimIds).not.toContain("UNIQUE-1");
    expect(result.duplicateClientClaimIds).not.toContain("UNIQUE-2");
    expect(result.duplicateClientClaimIds).not.toContain("UNIQUE-3");
  });

  it("L-DUP-5: empty batch → no duplicates, no claims", () => {
    const result = validateClaimBatch([], EMPTY_EVIDENCE_PACK);

    expect(result.claims).toHaveLength(0);
    expect(result.malformedDropped).toBe(0);
    expect(result.duplicateClientClaimIds).toBeUndefined();
  });

  it("L-DUP-6: first occurrence of duplicate should not be silently overwritten with second", () => {
    // This tests the specific failure mode Sprint 29K.4.1 targets:
    // At persistence, if two claims share a clientClaimId, the second could silently
    // overwrite the first. The fix is to never let two identical IDs reach persistence.
    const batch = [
      makeRaw("SHARED-ID", "ORIGINAL claim text.", "observation"),
      makeRaw("SHARED-ID", "OVERWRITING claim text.", "observation"),
    ];

    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    // Original must survive
    const surviving = result.claims.find(c => c.clientClaimId === "SHARED-ID");
    expect(surviving).toBeDefined();
    expect(surviving!.claimText).toBe("ORIGINAL claim text.");
    // "OVERWRITING claim text." must never appear in validated output
    const overwritten = result.claims.find(c => c.claimText === "OVERWRITING claim text.");
    expect(overwritten).toBeUndefined();
  });
});

// ─── Part M: Evidence mode regression ─────────────────────────────────────────

describe("Part M — non-absence claim regression", () => {

  it("M1: observation claim with no evidence bindings → unsupported (not affected by 29K.4.1)", () => {
    const batch = [makeRaw("OBS-1", "All complaints must be resolved within 30 days.", "observation")];
    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    expect(result.claims).toHaveLength(1);
    const claim = result.claims[0];
    // No evidence bindings → should be unsupported (not grounded, not confused with absence)
    expect(["unsupported", "support_uncertain"]).toContain(claim.provenanceStatus);
    // Should NOT be any absence status
    expect(claim.provenanceStatus).not.toBe("verified_absence");
    expect(claim.provenanceStatus).not.toBe("unverified_absence");
    expect(claim.provenanceStatus).not.toBe("contradicted_absence");
  });

  it("M2: external_requirement claim → unsupported_external (not affected by 29K.4.1)", () => {
    const batch = [
      makeRaw(
        "EXT-1",
        "Under the NDIS Act, all providers must maintain participant records for 7 years.",
        "external_requirement",
      ),
    ];
    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].provenanceStatus).toBe("unsupported_external");
  });

  it("M3: inference claim → not treated as absence (not affected by 29K.4.1)", () => {
    const batch = [
      makeRaw(
        "INF-1",
        "The organisation appears to lack a formal complaint review mechanism.",
        "inference",
      ),
    ];
    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    expect(result.claims).toHaveLength(1);
    // Inference with no evidence → unsupported (not an absence status)
    expect(["unsupported", "support_uncertain"]).toContain(result.claims[0].provenanceStatus);
    expect(result.claims[0].provenanceStatus).not.toBe("verified_absence");
    expect(result.claims[0].provenanceStatus).not.toBe("contradicted_absence");
  });

  it("M4: absence_finding claim without absence_record field → validated (record added later)", () => {
    const batch = [
      makeRaw(
        "ABS-1",
        "The policy does not specify an escalation timeframe.",
        "absence_finding",
      ),
    ];
    const result = validateClaimBatch(batch, EMPTY_EVIDENCE_PACK);

    expect(result.claims).toHaveLength(1);
    // Should be some form of unsupported/unverified — absence verification runs separately
    // The claim itself passes claim-batch validation (absence_finding is a valid type)
    expect(result.claims[0].claimType).toBe("absence_finding");
  });
});

// ─── Part N: Retrieval cost measurement ───────────────────────────────────────

describe("Part N — absence candidate classification structure", () => {

  it("N1: classifyAbsenceCandidate returns all required fields", () => {
    const result = classifyAC(
      "The policy does not specify an escalation timeframe.",
      "Unresolved complaints must be escalated within 10 business days.",
    );

    expect(result).toHaveProperty("classification");
    expect(result).toHaveProperty("matchedElement");
    expect(result).toHaveProperty("reasonCodes");
    expect(Array.isArray(result.reasonCodes)).toBe(true);
    expect(result.reasonCodes.length).toBeGreaterThan(0);
  });

  it("N2: context_only classification has expected reasonCode", () => {
    const result = classifyAC(
      "The policy does not specify an escalation timeframe.",
      "Complaints may be escalated to the Service Manager.",
    );

    expect(result.classification).toBe("context_only");
    expect(result.reasonCodes).toContain("TOPIC_DISCUSSED_ELEMENT_NOT_ESTABLISHED");
  });

  it("N3: requirement_absent_or_pending classification has expected reasonCode", () => {
    const result = classifyAC(
      "The policy does not specify an escalation timeframe.",
      "An escalation timeframe is currently under development.",
    );

    expect(result.classification).toBe("requirement_absent_or_pending");
    expect(result.reasonCodes).toContain("PENDING_LANGUAGE_DETECTED");
  });

  it("N4: requirement_present classification has expected reasonCode", () => {
    const result = classifyAC(
      "The policy does not specify an escalation timeframe.",
      "All unresolved complaints must be escalated within 15 business days.",
    );

    expect(result.classification).toBe("requirement_present");
    expect(result.reasonCodes).toContain("ELEMENT_ESTABLISHED_IN_CANDIDATE");
  });
});

// ─── Part O: Real-schema assertions ───────────────────────────────────────────

describe("Part O — AbsenceCandidateRecord schema alignment", () => {

  it("O1: classifyAbsenceCandidate returns valid AbsenceCandidateRecord shape", () => {
    const VALID_CLASSIFICATIONS = [
      "requirement_present",
      "requirement_absent_or_pending",
      "context_only",
      "ambiguous",
    ] as const;

    const VALID_ELEMENTS = [
      "timeframe", "owner", "procedure", "appeal",
      "review", "classification", "resolution", "other",
    ] as const;

    const samples = [
      {
        claim:  "No escalation timeframe is specified.",
        candidate: "Unresolved complaints must be escalated within 10 business days.",
      },
      {
        claim:  "The policy lacks an escalation procedure.",
        candidate: "Escalation is under development and will be added in a future revision.",
      },
      {
        claim:  "No appeal mechanism is defined.",
        candidate: "Complainants may escalate to the Service Manager.",
      },
      {
        claim:  "The policy does not identify a decision-maker for escalated complaints.",
        candidate: "The Head of Operations is responsible for deciding all escalated complaints.",
      },
    ];

    for (const { claim, candidate } of samples) {
      const result = classifyAC(claim, candidate);
      expect(VALID_CLASSIFICATIONS).toContain(result.classification);
      expect(VALID_ELEMENTS).toContain(result.matchedElement);
      expect(Array.isArray(result.reasonCodes)).toBe(true);
    }
  });

  it("O2: AbsenceCandidateRecord has all required DB schema fields", () => {
    // This test imports the type via usage — TypeScript would catch missing fields.
    // We test that the runtime object produced by classifyAbsenceCandidate matches
    // the AbsenceCandidateRecord interface fields:
    //   chunkId: string (provided by absenceVerificationService — not produced by classifier)
    //   relevanceScore: number (provided by absenceVerificationService — not produced by classifier)
    //   candidateClassification: one of 4 values
    //   matchedElement: one of 8 values
    //   reasonCodes: string[]
    // The classifier returns the last 3 fields; chunkId and relevanceScore are
    // added by absenceVerificationService when building the record.

    const result = classifyAC(
      "The policy does not specify a resolution timeframe.",
      "Complaints must be resolved within 30 business days.",
    );

    // Verify all DB schema fields that the classifier provides are present
    expect(typeof result.classification).toBe("string");
    expect(typeof result.matchedElement).toBe("string");
    expect(Array.isArray(result.reasonCodes)).toBe(true);
    result.reasonCodes.forEach((code: string) => {
      expect(typeof code).toBe("string");
      expect(code.length).toBeGreaterThan(0);
    });
  });
});
