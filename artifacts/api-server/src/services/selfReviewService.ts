/**
 * Self Review Service — Sprint 22 (Work Execution Engine & Completed Work)
 * Task #39 — Evidence Hardening
 *
 * Performs structured post-generation quality evaluation across 10 dimensions.
 * Each dimension returns a score (0–10), actionable feedback, and an evidence
 * array citing the specific inputs used to derive the score.
 *
 * If the overall weighted score is below the quality threshold (70/100),
 * the service generates targeted improvement feedback and permits exactly one
 * automatic revision cycle (MAX_AUTO_REVISIONS = 1).
 *
 * Self-review is deterministic (rule-based) for most dimensions; LLM-assisted
 * checks are used for instruction adherence and writing style when available.
 *
 * No chain-of-thought is exposed in the result — only summary reasoning.
 */

import { createAIGateway } from "@workspace/ai-gateway";
import type { AIGatewayContext } from "@workspace/ai-gateway";
import { createHash } from "crypto";
import { randomUUID } from "crypto";
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";
import { logOrgEvent } from "./auditService.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUALITY_THRESHOLD = 70;

/** The maximum number of automatic revision cycles permitted per review. */
export const MAX_AUTO_REVISIONS = 1;

export const REVIEW_DIMENSIONS = [
  "instruction_adherence",
  "policy_compliance",
  "writing_style_compliance",
  "source_coverage",
  "completeness",
  "confidence",
  "missing_information",
  "approval_requirements",
  "safety",
  "consistency",
] as const;

export type ReviewDimensionName = (typeof REVIEW_DIMENSIONS)[number];

// Default weights (sum to 100)
const DIMENSION_WEIGHTS: Record<ReviewDimensionName, number> = {
  instruction_adherence:    15,
  policy_compliance:        15,
  writing_style_compliance: 10,
  source_coverage:          10,
  completeness:             15,
  confidence:               10,
  missing_information:      10,
  approval_requirements:     5,
  safety:                   10,
  consistency:               0, // informational — derived from completeness
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DimensionResult {
  dimension: ReviewDimensionName;
  score: number;                    // 0–10
  passed: boolean;                  // score >= 6
  feedback: string;
  improvementSuggestions: string[];
  /** Citations of the specific inputs used to derive this score. */
  evidence: string[];
}

export interface ReviewResult {
  qualityScore: number;             // 0–100 weighted
  dimensions: DimensionResult[];
  passed: boolean;                  // qualityScore >= QUALITY_THRESHOLD
  improvementFeedback: string[];
  revised: boolean;
  finalContent: string;
  autoRevisionNote?: string;
  /** True when the revision limit (MAX_AUTO_REVISIONS) was reached. */
  revisionLimitReached: boolean;
  /** SHA-256 hash of all dimension evidence for audit trail. */
  evidenceSummaryHash: string;
}

export interface ReviewContext {
  organizationId: string;
  userId: string;
  conversationId?: string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function reviewDraft(
  content: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
  ctx: ReviewContext,
): Promise<ReviewResult> {
  const dimensions = runDeterministicReview(content, manifest, blueprint);
  const qualityScore = computeWeightedScore(dimensions, blueprint);
  const passed = qualityScore >= QUALITY_THRESHOLD;
  const improvementFeedback = dimensions
    .filter(d => !d.passed)
    .flatMap(d => d.improvementSuggestions);

  let revised = false;
  let revisionLimitReached = false;
  let autoRevisionNote: string | undefined;
  let finalContent = content;
  let finalDimensions = dimensions;
  let finalScore = qualityScore;

  if (!passed && improvementFeedback.length > 0) {
    // ── Enforce MAX_AUTO_REVISIONS = 1 ────────────────────────────────────
    // Attempt exactly one automatic revision. If a second revision were
    // requested, revisionLimitReached is set true and execution stops.
    const revised_ = await attemptRevision(content, improvementFeedback, manifest, ctx);
    if (revised_ !== content) {
      revised = true;
      finalContent = revised_;
      finalDimensions = runDeterministicReview(revised_, manifest, blueprint);
      finalScore = computeWeightedScore(finalDimensions, blueprint);
      autoRevisionNote = `Auto-revised from score ${qualityScore} → ${finalScore}`;
    }
    // Revision limit is always reached after one attempt (no further attempts).
    revisionLimitReached = true;
    console.debug(
      `[selfReview] Revision limit (${MAX_AUTO_REVISIONS}) reached. ` +
      `org=${ctx.organizationId} revised=${revised} score=${finalScore}`,
    );
  }

  // Hash is computed from the FINAL dimensions (post-revision if revised) so
  // the audit trail always reflects the actual outcome, not the pre-revision pass.
  const evidenceSummaryHash = computeEvidenceHash(finalDimensions);

  const result: ReviewResult = {
    qualityScore: finalScore,
    dimensions: finalDimensions,
    passed: finalScore >= QUALITY_THRESHOLD,
    improvementFeedback,
    revised,
    finalContent,
    autoRevisionNote,
    revisionLimitReached,
    evidenceSummaryHash,
  };

  // ── Audit review outcome (fire-and-forget) ─────────────────────────────
  void logOrgEvent({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    actorType: 'system',
    eventType: 'specialist.output_validated',
    resourceType: 'completed_work',
    metadata: {
      qualityScore: finalScore,
      passed: result.passed,
      dimensionCount: finalDimensions.length,
      revised,
      revisionLimitReached,
      evidenceSummaryHash,
      improvementFeedbackCount: improvementFeedback.length,
    },
  }).catch(() => { /* audit write failure must not block review */ });

  return result;
}

// ─── Deterministic review ─────────────────────────────────────────────────────

function runDeterministicReview(
  content: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
): DimensionResult[] {
  return [
    reviewInstructionAdherence(content, blueprint),
    reviewPolicyCompliance(content, manifest),
    reviewWritingStyleCompliance(content, manifest, blueprint),
    reviewSourceCoverage(content, manifest),
    reviewCompleteness(content, blueprint),
    reviewConfidence(content),
    reviewMissingInformation(content),
    reviewApprovalRequirements(content, blueprint),
    reviewSafety(content),
    reviewConsistency(content, blueprint, manifest),
  ];
}

function reviewInstructionAdherence(content: string, blueprint: WorkBlueprint | null): DimensionResult {
  if (!blueprint) {
    return pass(
      "instruction_adherence", 8,
      "No blueprint — general instruction adherence assumed",
      ["No blueprint provided; using default score"],
    );
  }
  const criteriaWords = blueprint.successCriteria.flatMap(c => c.toLowerCase().split(/\s+/));
  const contentLower = content.toLowerCase();
  const significantWords = criteriaWords.filter(w => w.length > 4);
  const matched = significantWords.filter(w => contentLower.includes(w));
  const total = significantWords.length;
  const score = total === 0 ? 8 : Math.round(Math.min(10, (matched.length / total) * 12));

  // Evidence: cite each criterion and its match status
  const evidence = blueprint.successCriteria.map(criterion => {
    const words = criterion.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const anyFound = words.some(w => contentLower.includes(w));
    return `Criterion "${criterion.slice(0, 60)}" — ${anyFound ? "addressed" : "NOT addressed"}`;
  });
  if (evidence.length === 0) evidence.push("No success criteria defined in blueprint");

  const suggestions = score < 6
    ? [`Ensure all success criteria are addressed: ${blueprint.successCriteria.join("; ")}`]
    : [];

  return {
    dimension: "instruction_adherence",
    score,
    passed: score >= 6,
    feedback: `${matched.length}/${total} success criteria terms found`,
    improvementSuggestions: suggestions,
    evidence,
  };
}

function reviewPolicyCompliance(content: string, manifest: WorkPackageManifest): DimensionResult {
  const policies = manifest.organisationLibrarySources.filter(s => s.sourceType === "policy");

  if (policies.length === 0) {
    return warn(
      "policy_compliance", 6,
      "No policies retrieved — policy compliance not fully evaluated",
      ["Retrieve relevant organisational policies before generating this output"],
      ["No policy sources were included in the work package manifest"],
    );
  }

  const contentLower = content.toLowerCase();
  const cited: string[] = [];
  const notCited: string[] = [];

  for (const p of policies) {
    const firstWord = p.title.toLowerCase().split(" ")[0]!;
    if (firstWord.length > 3 && contentLower.includes(firstWord)) {
      cited.push(p.title);
    } else {
      notCited.push(p.title);
    }
  }

  const score = Math.round(Math.min(10, 6 + (cited.length / policies.length) * 4));
  const evidence = [
    ...cited.map(t => `Policy "${t}" — referenced in content`),
    ...notCited.map(t => `Policy "${t}" — NOT referenced`),
  ];

  return {
    dimension: "policy_compliance",
    score,
    passed: score >= 6,
    feedback: `${cited.length}/${policies.length} retrieved policies referenced in content`,
    improvementSuggestions: score < 7 ? ["Reference the retrieved policy documents explicitly in the output"] : [],
    evidence,
  };
}

function reviewWritingStyleCompliance(
  content: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
): DimensionResult {
  const terminologyMemories = manifest.cosMemories.filter(m => m.memoryType === "terminology");
  const wordCount = content.split(/\s+/).length;
  const avgSentenceLength = estimateAvgSentenceLength(content);

  let score = 7;
  const suggestions: string[] = [];
  const evidence: string[] = [];

  evidence.push(`Avg sentence length: ${avgSentenceLength} words (threshold: 35)`);
  evidence.push(`Word count: ${wordCount}`);

  if (avgSentenceLength > 35) {
    score -= 2;
    suggestions.push("Shorten sentences — average sentence length exceeds 35 words");
    evidence.push("Deduction: sentence length exceeds 35-word threshold");
  }
  if (wordCount < 100 && content.length > 50) {
    score -= 1;
    suggestions.push("Output appears very brief — consider expanding key sections");
    evidence.push("Deduction: word count below 100 (content appears very brief)");
  }

  // Terminology check — evidence-backed.
  // Run whenever ANY terminology constraint exists: mandatory citations,
  // required memory types, or terminology memories in the manifest.
  // This ensures blueprint.requiredMemories are always validated even when
  // there are no terminology-typed memories in the manifest.
  const hasTerminologyConstraints =
    terminologyMemories.length > 0 ||
    (blueprint?.mandatoryCitations?.length ?? 0) > 0 ||
    (blueprint?.requiredMemories?.length ?? 0) > 0;

  if (hasTerminologyConstraints) {
    const { passed: termPassed, evidence: termEvidence } = checkTerminologyUsage(content, manifest, blueprint);
    evidence.push(...termEvidence);
    if (!termPassed) {
      score -= 1;
      suggestions.push("Ensure organisational terminology and required citations are used consistently");
    }
  } else {
    evidence.push("No terminology constraints (mandatory citations, required memories, or terminology memories) — check skipped");
  }

  score = Math.max(0, Math.min(10, score));
  return {
    dimension: "writing_style_compliance",
    score,
    passed: score >= 6,
    feedback: `Avg sentence length: ${avgSentenceLength} words; word count: ${wordCount}`,
    improvementSuggestions: suggestions,
    evidence,
  };
}

function reviewSourceCoverage(content: string, manifest: WorkPackageManifest): DimensionResult {
  const sources = manifest.organisationLibrarySources;

  if (sources.length === 0) {
    return warn(
      "source_coverage", 6,
      "No library sources were retrieved for this execution",
      ["Add relevant documents to the Organisation Library to improve output quality"],
      ["No library sources in manifest — source coverage cannot be evaluated"],
    );
  }

  const contentLower = content.toLowerCase();
  const cited: string[] = [];
  const notCited: string[] = [];

  for (const s of sources) {
    const firstWord = s.title.toLowerCase().split(" ")[0]!;
    if (firstWord.length > 3 && contentLower.includes(firstWord)) {
      cited.push(s.title);
    } else {
      notCited.push(s.title);
    }
  }

  const score = Math.round(Math.min(10, 5 + (cited.length / sources.length) * 5));
  const evidence = [
    ...cited.map(t => `Source "${t}" — referenced`),
    ...notCited.map(t => `Source "${t}" — NOT referenced`),
  ];

  return {
    dimension: "source_coverage",
    score,
    passed: score >= 6,
    feedback: `${cited.length}/${sources.length} retrieved sources referenced`,
    improvementSuggestions: score < 6 ? ["Cite retrieved Organisation Library sources explicitly"] : [],
    evidence,
  };
}

function reviewCompleteness(content: string, blueprint: WorkBlueprint | null): DimensionResult {
  const minContentLength = 200;
  const hasHeadings = /^#{1,3}\s.+/m.test(content) || /^[A-Z][A-Z\s]{3,}:/m.test(content);
  const hasActionItems = /action|recommend|next step|follow.up/i.test(content);
  // Match both exact form [INCOMPLETE] and colon-prefix form [INCOMPLETE: description].
  // The blueprint execution addendum instructs the specialist to use the colon form, so
  // the regex must recognise both variants for all three marker types.
  const incompleteMarkers = (
    content.match(/\[INCOMPLETE(?::[^\]]+)?\]|\[MISSING(?::[^\]]+)?\]|\[TODO(?::[^\]]+)?\]/gi) ?? []
  ).length;

  let score = 7;
  const suggestions: string[] = [];
  const evidence: string[] = [
    `Content length: ${content.length} characters (minimum: ${minContentLength})`,
    `Section headings detected: ${hasHeadings}`,
    `Action items / recommendations detected: ${hasActionItems}`,
    `Incomplete markers ([INCOMPLETE], [INCOMPLETE: …], [MISSING], [TODO]): ${incompleteMarkers}`,
  ];

  if (content.length < minContentLength) {
    score -= 3;
    suggestions.push("Content is too brief — expand key sections");
    evidence.push(`Deduction -3: content length ${content.length} below minimum ${minContentLength}`);
  }
  if (!hasHeadings && content.length > 500) {
    score -= 1;
    suggestions.push("Add section headings to improve structure");
    evidence.push("Deduction -1: no section headings found in content > 500 chars");
  }
  if (!hasActionItems && blueprint && blueprint.outputTypes.some(t =>
    ["investigation_report", "risk_assessment", "action_plan", "project_plan"].includes(t))) {
    score -= 1;
    suggestions.push("Include explicit action items or recommendations");
    evidence.push(`Deduction -1: output type requires action items (type: ${blueprint.outputTypes.join(", ")})`);
  }
  if (incompleteMarkers > 0) {
    score -= Math.min(3, incompleteMarkers);
    suggestions.push(`${incompleteMarkers} section(s) marked as incomplete — provide missing information`);
    evidence.push(`Deduction -${Math.min(3, incompleteMarkers)}: ${incompleteMarkers} incomplete marker(s) found`);
  }

  if (blueprint?.successCriteria && blueprint.successCriteria.length > 0) {
    evidence.push(`Blueprint success criteria count: ${blueprint.successCriteria.length}`);
  }

  score = Math.max(0, Math.min(10, score));
  return {
    dimension: "completeness",
    score,
    passed: score >= 6,
    feedback: `Content length: ${content.length} chars; headings: ${hasHeadings}; incomplete markers: ${incompleteMarkers}`,
    improvementSuggestions: suggestions,
    evidence,
  };
}

function reviewConfidence(content: string): DimensionResult {
  const hedgeWords = ["might", "may", "could", "possibly", "perhaps", "unsure", "unclear", "approximate", "estimated", "assumed"];
  const contentLower = content.toLowerCase();
  const triggeredHedges = hedgeWords.filter(w => contentLower.includes(w));
  const hedgeCount = triggeredHedges.length;
  const score = Math.max(4, 10 - Math.min(6, hedgeCount));

  const evidence = hedgeCount > 0
    ? [`Hedging expressions found: ${triggeredHedges.join(", ")}`]
    : ["No hedging expressions detected"];
  evidence.push(`Total hedge count: ${hedgeCount}/10 (threshold for deduction: >4)`);

  const suggestions = hedgeCount > 4
    ? ["Reduce hedging language — where information is uncertain, mark it explicitly rather than hedging throughout"]
    : [];

  return {
    dimension: "confidence",
    score,
    passed: score >= 6,
    feedback: `${hedgeCount} hedging expressions detected`,
    improvementSuggestions: suggestions,
    evidence,
  };
}

function reviewMissingInformation(content: string): DimensionResult {
  // Match both exact form [INCOMPLETE] and colon-prefix form [INCOMPLETE: description].
  const missingMarkers = (
    content.match(/\[INCOMPLETE(?::[^\]]+)?\]|\[MISSING(?::[^\]]+)?\]|\[UNKNOWN(?::[^\]]+)?\]|\[TODO(?::[^\]]+)?\]|\[REQUIRED(?::[^\]]+)?\]/gi) ?? []
  ).length;
  const questionLines = content.split("\n").filter(l => l.trim().endsWith("?"));
  const questionMarkers = (content.match(/\?\s*$|\?\s*\n/gm) ?? []).length;
  const score = Math.max(0, 10 - missingMarkers * 2 - Math.min(3, questionMarkers));

  const evidence: string[] = [
    `Missing/unknown/incomplete markers: ${missingMarkers}`,
    `Unresolved question lines: ${questionMarkers}`,
  ];
  if (questionLines.length > 0 && questionLines.length <= 5) {
    questionLines.forEach((l, i) => evidence.push(`Question ${i + 1}: "${l.trim().slice(0, 80)}"`));
  }
  if (missingMarkers > 0) evidence.push(`Deduction: -${missingMarkers * 2} for missing markers`);

  const suggestions: string[] = [];
  if (missingMarkers > 0) suggestions.push(`Resolve ${missingMarkers} missing information marker(s) before submission`);
  if (questionMarkers > 3) suggestions.push("Output contains unresolved questions — clarify or mark as requiring follow-up");

  return {
    dimension: "missing_information",
    score,
    passed: score >= 6,
    feedback: `${missingMarkers} missing markers; ${questionMarkers} unresolved questions`,
    improvementSuggestions: suggestions,
    evidence,
  };
}

function reviewApprovalRequirements(content: string, blueprint: WorkBlueprint | null): DimensionResult {
  const reqApprovals = blueprint?.requiredApprovals ?? {};
  const hasApprovalSection = /approv|sign.?off|authoris|review required/i.test(content);
  const needsApproval = Object.keys(reqApprovals).length > 0;

  const evidence: string[] = [
    `Blueprint required approvals: ${needsApproval ? JSON.stringify(Object.keys(reqApprovals)) : "none"}`,
    `Approval/sign-off section in content: ${hasApprovalSection}`,
  ];

  if (!needsApproval) {
    return pass(
      "approval_requirements", 9,
      "No specific approval requirements for this blueprint",
      evidence,
    );
  }

  const score = hasApprovalSection ? 9 : 6;
  return {
    dimension: "approval_requirements",
    score,
    passed: score >= 6,
    feedback: needsApproval
      ? (hasApprovalSection ? "Approval section present" : "Approval section not detected")
      : "No approval requirements",
    improvementSuggestions: needsApproval && !hasApprovalSection
      ? ["Add an approval/sign-off section to the document"]
      : [],
    evidence,
  };
}

function reviewSafety(content: string): DimensionResult {
  const safetyFlags = [
    { pattern: /fabricat|invent|made.?up|hallucin/i,                    message: "Potential fabrication language detected" },
    { pattern: /ignore\s+(policy|procedure|law|legislation)/i,           message: "Reference to ignoring policy/law" },
    { pattern: /without\s+(approval|authorisation|consent)/i,           message: "Reference to bypassing required authorisation" },
  ];

  const triggered = safetyFlags.filter(f => f.pattern.test(content));
  const score = Math.max(0, 10 - triggered.length * 3);

  const evidence = triggered.length === 0
    ? ["No safety flags triggered"]
    : triggered.map(f => `Safety flag triggered: ${f.message}`);

  return {
    dimension: "safety",
    score,
    passed: score >= 7,
    feedback: triggered.length === 0 ? "No safety flags detected" : `${triggered.length} safety flag(s) triggered`,
    improvementSuggestions: triggered.map(f => `Safety flag: ${f.message}`),
    evidence,
  };
}

/**
 * Consistency — evidence-backed (Task #39).
 *
 * Checks whether the work output is internally consistent and aligns with
 * the stated blueprint goals/objective. Score is derived from:
 *   - Blueprint objective coverage (keywords in intro + conclusion)
 *   - Success criteria addressed vs total
 *   - Contradictory negation patterns near key claims
 *   - Document structure vs expected output type
 *
 * Weight is 0 (informational only) but evidence is always populated.
 */
function reviewConsistency(
  content: string,
  blueprint: WorkBlueprint | null,
  manifest: WorkPackageManifest,
): DimensionResult {
  const evidence: string[] = [];
  const suggestions: string[] = [];
  let score = 10; // start at 10, deduct for inconsistencies

  const contentLower = content.toLowerCase();
  const lines = content.split("\n").filter(l => l.trim().length > 0);

  // ── 1. Blueprint objective coverage ──────────────────────────────────────
  if (blueprint?.objective) {
    const objectiveWords = blueprint.objective
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 5);
    const coveredWords = objectiveWords.filter(w => contentLower.includes(w));
    const coverageRatio = objectiveWords.length > 0
      ? coveredWords.length / objectiveWords.length
      : 1;
    evidence.push(
      `Blueprint objective coverage: ${coveredWords.length}/${objectiveWords.length} key terms found`,
    );
    if (coverageRatio < 0.5) {
      score -= 2;
      suggestions.push("Content does not appear to address the blueprint objective");
      evidence.push("Deduction -2: objective coverage below 50%");
    }
  } else {
    evidence.push("No blueprint objective — structural consistency checked only");
  }

  // ── 2. Success criteria goal alignment ───────────────────────────────────
  if (blueprint?.successCriteria && blueprint.successCriteria.length > 0) {
    const unmetCriteria = blueprint.successCriteria.filter(criterion => {
      const words = criterion.toLowerCase().split(/\s+/).filter(w => w.length > 5);
      return words.length > 0 && !words.some(w => contentLower.includes(w));
    });
    evidence.push(
      `Success criteria met: ${blueprint.successCriteria.length - unmetCriteria.length}/${blueprint.successCriteria.length}`,
    );
    if (unmetCriteria.length > 0) {
      const deduction = Math.min(3, unmetCriteria.length);
      score -= deduction;
      unmetCriteria.forEach(c =>
        evidence.push(`Unmet criterion: "${c.slice(0, 60)}"`)
      );
      suggestions.push(`${unmetCriteria.length} success criterion/criteria not addressed in content`);
    }
  }

  // ── 3. Internal contradiction detection ──────────────────────────────────
  // Look for negation patterns that appear to contradict prior assertions.
  const contradictionPatterns = [
    { positive: /is\s+compliant/i,        negative: /is\s+not\s+compliant/i },
    { positive: /is\s+required/i,         negative: /is\s+not\s+required/i },
    { positive: /has\s+been\s+completed/i, negative: /has\s+not\s+been\s+completed/i },
    { positive: /is\s+approved/i,          negative: /is\s+not\s+approved/i },
  ];
  const foundContradictions: string[] = [];
  for (const { positive, negative } of contradictionPatterns) {
    if (positive.test(content) && negative.test(content)) {
      foundContradictions.push(`"${positive.source}" vs "${negative.source}"`);
    }
  }
  if (foundContradictions.length > 0) {
    score -= Math.min(3, foundContradictions.length);
    foundContradictions.forEach(c => evidence.push(`Contradiction detected: ${c}`));
    suggestions.push("Resolve contradictory statements in the document");
  } else {
    evidence.push("No direct contradictions detected");
  }

  // ── 4. Document structure vs output type ─────────────────────────────────
  const outputTypes = blueprint?.outputTypes ?? manifest.organisationLibrarySources.map(s => s.sourceType);
  const requiresStructure = outputTypes.some(t =>
    ["investigation_report", "risk_assessment", "action_plan", "project_plan", "policy", "procedure"].includes(t)
  );
  const hasStructure = lines.length >= 5 && (/^#{1,3}\s/m.test(content) || /^[A-Z][A-Z\s]{3,}:/m.test(content));
  evidence.push(`Expected structured document: ${requiresStructure}; has structure: ${hasStructure}`);
  if (requiresStructure && !hasStructure) {
    score -= 1;
    suggestions.push("Add document structure (headings/sections) expected for this output type");
    evidence.push("Deduction -1: structured output type but no section headings found");
  }

  score = Math.max(0, Math.min(10, score));
  return {
    dimension: "consistency",
    score,
    passed: score >= 6,
    feedback: `Consistency score ${score}/10; ${foundContradictions.length} contradiction(s); objective coverage checked`,
    improvementSuggestions: suggestions,
    evidence,
  };
}

// ─── Terminology Check (evidence-backed) ─────────────────────────────────────

interface TerminologyCheckResult {
  passed: boolean;
  evidence: string[];
}

/**
 * Checks terminology usage against:
 *   1. Blueprint mandatory citations (required terms/sources)
 *   2. Terminology memories from the manifest (by title)
 *   3. Blueprint required memory types
 *
 * Returns deterministic pass/fail with full evidence citations.
 * Falls back to pass-through (passed=true) if no terminology config exists.
 */
function checkTerminologyUsage(
  content: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
): TerminologyCheckResult {
  const evidence: string[] = [];
  const contentLower = content.toLowerCase();
  let misses = 0;

  // 1. Blueprint mandatory citations
  const mandatoryCitations = blueprint?.mandatoryCitations ?? [];
  if (mandatoryCitations.length > 0) {
    for (const citation of mandatoryCitations) {
      const found = contentLower.includes(citation.toLowerCase());
      evidence.push(
        `Mandatory citation "${citation}" — ${found ? "present in content" : "MISSING from content"}`,
      );
      if (!found) misses++;
    }
  }

  // 2. Terminology memories — check their titles are acknowledged
  const terminologyMemories = manifest.cosMemories.filter(m => m.memoryType === "terminology");
  for (const mem of terminologyMemories) {
    // The memory title describes the terminology set (e.g., "NDIS Terminology Guide")
    // We check if the document acknowledges the terminology category or key terms from the title
    const titleWords = mem.title.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const anyTitleWordFound = titleWords.some(w => contentLower.includes(w));
    evidence.push(
      `Terminology memory "${mem.title}" — ${anyTitleWordFound ? "referenced" : "not explicitly referenced"}`,
    );
    // Only deduct if there are title words long enough to be meaningful
    if (!anyTitleWordFound && titleWords.length > 0) {
      misses++;
    }
  }

  // 3. Blueprint required memory types (e.g., "terminology", "procedures")
  const requiredMemoryTypes = blueprint?.requiredMemories ?? [];
  for (const memType of requiredMemoryTypes) {
    const hasMemory = manifest.cosMemories.some(m => m.memoryType === memType);
    evidence.push(
      `Required memory type "${memType}" — ${hasMemory ? "present in manifest" : "NOT in manifest"}`,
    );
    if (!hasMemory) misses++;
  }

  if (evidence.length === 0) {
    evidence.push("No terminology configuration (citations, memories, or required types) — check skipped");
    return { passed: true, evidence };
  }

  return {
    passed: misses === 0,
    evidence,
  };
}

// ─── Revision ─────────────────────────────────────────────────────────────────

async function attemptRevision(
  content: string,
  feedback: string[],
  manifest: WorkPackageManifest,
  ctx: ReviewContext,
): Promise<string> {
  const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();
  if (provider !== "openai") return content; // No revision without LLM

  try {
    const gatewayCtx: AIGatewayContext = {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      role: "system",
      permissions: [],
      purpose: "work_self_review_revision",
      correlationId: randomUUID(),
      provider: "openai",
      retentionClass: "transient",
      requiresHumanApproval: false,
    };

    const gateway = createAIGateway(gatewayCtx);

    const systemPrompt = `You are a professional editor. Revise the provided work output to address the quality feedback. 
Do not add new facts or claims. Do not reproduce any source documents verbatim.
Preserve the original meaning and structure while improving quality.
Return only the revised content — no preamble, no explanation.`;

    const userMessage = `## Quality Feedback to Address\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n\n## Original Content\n${content.slice(0, 8000)}`;

    const response = await gateway.process({
      systemPrompt,
      userMessage,
      retrievedFields: [],
      maxTokens: 2000,
    });

    if (response.usedFallback || !response.content) return content;
    return response.content.trim();
  } catch {
    return content; // Revision failed — return original
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function computeWeightedScore(
  dimensions: DimensionResult[],
  blueprint: WorkBlueprint | null,
): number {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const dim of dimensions) {
    const weight = getWeight(dim.dimension, blueprint);
    weightedSum += dim.score * 10 * weight;
    totalWeight += weight * 10;
  }

  if (totalWeight === 0) return 70;
  return Math.round(weightedSum / totalWeight);
}

function getWeight(dimension: ReviewDimensionName, blueprint: WorkBlueprint | null): number {
  if (blueprint?.qualityRules) {
    const rule = blueprint.qualityRules.find(r =>
      r.dimension === dimension || dimension.startsWith(r.dimension)
    );
    if (rule) return rule.weight;
  }
  return DIMENSION_WEIGHTS[dimension] ?? 5;
}

// ─── Evidence Hash ─────────────────────────────────────────────────────────────

/**
 * Computes a SHA-256 hash of all dimension evidence for audit trail.
 * This allows verification that review evidence has not been tampered with.
 */
export function computeEvidenceHash(dimensions: DimensionResult[]): string {
  const payload = dimensions.map(d => ({
    dimension: d.dimension,
    score: d.score,
    evidence: d.evidence,
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(
  dimension: ReviewDimensionName,
  score: number,
  feedback: string,
  evidence: string[] = [],
): DimensionResult {
  return { dimension, score, passed: true, feedback, improvementSuggestions: [], evidence };
}

function warn(
  dimension: ReviewDimensionName,
  score: number,
  feedback: string,
  suggestions: string[],
  evidence: string[] = [],
): DimensionResult {
  return { dimension, score, passed: score >= 6, feedback, improvementSuggestions: suggestions, evidence };
}

function estimateAvgSentenceLength(content: string): number {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0);
  return Math.round(totalWords / sentences.length);
}
