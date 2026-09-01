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
import type { EvidencePack } from "./knowledgeResolutionService.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUALITY_THRESHOLD = 70;

/** The maximum number of automatic revision cycles permitted per review. */
export const MAX_AUTO_REVISIONS = 1;
const REVISION_MAX_TOKENS = 6000;
const MIN_REVISION_LENGTH_RATIO = 0.85;

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
  "evidence_citation_grounding", // Sprint 29F.1 Part 4
] as const;

export type ReviewDimensionName = (typeof REVIEW_DIMENSIONS)[number];

// ─── Plan-language detection (Sprint 29H Part C) ─────────────────────────────

/**
 * Output types that require COMPLETED analysis — not a plan for how to do analysis.
 * When a blueprint specifies one of these types, plan-to-do language is invalid
 * and triggers a completeness deduction.
 */
const COMPLETED_ANALYSIS_OUTPUT_TYPES = new Set([
  "investigation_report",
  "gap_analysis",
  "compliance_review",
  "analysis",
  "review",
  "incident_review",
  "policy_review",
  "operational_procedure",   // must be the procedure itself, not a plan to write it
]);

/**
 * Phrases that indicate the specialist is describing a plan to do the work,
 * rather than having already performed it. Each matched pattern triggers a deduction
 * when the blueprint output type requires completed analysis.
 *
 * Acceptable AFTER completed findings: "Step 4: Conduct stakeholder review [following
 * the above findings]" — but NOT as the primary deliverable.
 */
const PLAN_LANGUAGE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bconduct\s+a\s+(thorough\s+)?review\b/i,                  label: '"Conduct a review" — work must be performed, not planned' },
  { pattern: /\bcarry\s+out\s+a\s+review\b/i,                            label: '"Carry out a review" — work must be performed, not planned' },
  { pattern: /\bperform\s+a\s+(full\s+)?review\b/i,                      label: '"Perform a review" — review must already be done in output' },
  { pattern: /\bidentif(y|ies)\s+(all\s+)?(operational\s+)?gaps\b/i,     label: '"Identify gaps" — gaps must already be identified in output' },
  { pattern: /\bdevelops?\s+(targeted\s+)?strategies\b/i,                label: '"Develop strategies" — strategies must be present in output' },
  { pattern: /\bengages?\s+stakeholders\s+(to\s+gather|for\s+feedback)\b/i, label: '"Engage stakeholders" — engagement plan is not a completed review' },
  { pattern: /\bconduct\s+stakeholder\s+consultation\b/i,                label: '"Conduct stakeholder consultation" — plan-to-do phrase' },
  { pattern: /\bconduct\s+a\s+gap\s+analysis\b/i,                       label: '"Conduct a gap analysis" — analysis must already be in output' },
  { pattern: /\bconduct\s+a\s+(comprehensive\s+)?assessment\b/i,         label: '"Conduct an assessment" — assessment must already be in output' },
];

/**
 * Detects plan-to-do language when the output type requires completed analysis.
 * Returns whether the check applies and which patterns were detected.
 */
function detectPlanLanguage(
  content: string,
  blueprint: WorkBlueprint | null,
): { requiresCompletedAnalysis: boolean; detectedPatterns: string[] } {
  const requiresCompletedAnalysis =
    blueprint?.outputTypes != null &&
    blueprint.outputTypes.some(t => COMPLETED_ANALYSIS_OUTPUT_TYPES.has(t));

  if (!requiresCompletedAnalysis) {
    return { requiresCompletedAnalysis: false, detectedPatterns: [] };
  }

  const detectedPatterns = PLAN_LANGUAGE_PATTERNS
    .filter(({ pattern }) => pattern.test(content))
    .map(({ label }) => label);

  return { requiresCompletedAnalysis, detectedPatterns };
}

// Default weights (sum to 100)
const DIMENSION_WEIGHTS: Record<ReviewDimensionName, number> = {
  instruction_adherence:       15,
  policy_compliance:           15,
  writing_style_compliance:    10,
  source_coverage:              5, // reduced 10→5; 5 moved to evidence_citation_grounding
  completeness:                15,
  confidence:                  10,
  missing_information:         10,
  approval_requirements:        5,
  safety:                      10,
  consistency:                  0, // informational — derived from completeness
  evidence_citation_grounding:  5, // Sprint 29F.1 Part 4 — citation grounding
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

export interface ReviewRequirementPlanItem {
  requirementId: string;
  requirement: string;
  origin?: string;
  targetDeliverableLocation?: string;
  expectedUserFacingRepresentation?: string;
  adequacyCriteria?: string[];
  substantiveValidationMode?: string;
}

export interface ReviewFailedRequirement {
  requirementId: string;
  requirement: string;
  reason: string;
  requiredDeliverableRepresentation?: string;
  targetDeliverableLocation?: string | null;
  adequacyCriteria?: string[];
  substantiveResult?: string | null;
}

export interface ReviewContext {
  organizationId: string;
  userId: string;
  conversationId?: string;
  /**
   * Sprint 29F.1 Part 4 — EvidencePack for citation grounding verification.
   * When provided, the evidence_citation_grounding dimension checks that cited
   * sources exist in the pack, connector-derived evidence is clearly identified
   * by provenance, and claims with weak evidence are marked uncertain.
   */
  evidencePack?: EvidencePack | null;
  /** When true, score the draft but do not ask the LLM to rewrite it. */
  disableAutoRevision?: boolean;
  /** Requirement plan used to judge whether the deliverable is complete. */
  requirementPlan?: ReviewRequirementPlanItem[];
  /** Specific failed requirements from completion gates, if review follows a failed gate. */
  failedRequirements?: ReviewFailedRequirement[];
  /** User-facing deliverable contract; included in revision context for professional work. */
  deliverableContract?: unknown;
  /**
   * Execution outcomes are scored separately from document text. Criteria such
   * as "DOCX artifact generated" are not document-content requirements and
   * must not be failed merely because those words do not appear in the draft.
   */
  executionOutcome?: ReviewExecutionOutcome;
}

export interface ReviewExecutionOutcome {
  artifactGenerated?: boolean;
  approvalSubmitted?: boolean;
  unresolvedGapsSurfaced?: boolean;
  completedWorkCreated?: boolean;
}

interface ReviewModeContext {
  isStandardReusableTemplate: boolean;
  deliverableStandardisation: string | null;
  requestedDeliverableType: string | null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function reviewDraft(
  content: string,
  manifest: WorkPackageManifest,
  blueprint: WorkBlueprint | null,
  ctx: ReviewContext,
): Promise<ReviewResult> {
  const dimensions = runDeterministicReview(content, manifest, blueprint, ctx);
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

  if (!ctx.disableAutoRevision && !passed && improvementFeedback.length > 0) {
    // ── Enforce MAX_AUTO_REVISIONS = 1 ────────────────────────────────────
    // Attempt exactly one automatic revision. If a second revision were
    // requested, revisionLimitReached is set true and execution stops.
    const revisionAttempt = await attemptRevision(content, improvementFeedback, manifest, ctx);
    const revised_ = revisionAttempt.content;
    if (revisionAttempt.discardReason) {
      autoRevisionNote = revisionAttempt.discardReason;
    }
    if (!revisionAttempt.discardReason && revised_ !== content) {
      const candidateDimensions = runDeterministicReview(revised_, manifest, blueprint, ctx);
      const candidateScore = computeWeightedScore(candidateDimensions, blueprint);
      if (candidateScore >= qualityScore) {
        revised = true;
        finalContent = revised_;
        finalDimensions = candidateDimensions;
        finalScore = candidateScore;
        autoRevisionNote = `Auto-revised from score ${qualityScore} → ${candidateScore}`;
      } else {
        autoRevisionNote = `Auto-revision rejected because score would fall from ${qualityScore} → ${candidateScore}; retained prior draft.`;
      }
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
  ctx: Pick<ReviewContext, "evidencePack" | "requirementPlan" | "failedRequirements" | "executionOutcome"> = {},
): DimensionResult[] {
  const mode = getReviewModeContext(manifest);
  return [
    reviewInstructionAdherence(content, blueprint, ctx, mode),
    reviewPolicyCompliance(content, manifest, mode),
    reviewWritingStyleCompliance(content, manifest, blueprint, mode),
    reviewSourceCoverage(content, manifest, mode),
    reviewCompleteness(content, blueprint, ctx, mode),
    reviewConfidence(content),
    reviewMissingInformation(content),
    reviewApprovalRequirements(content, blueprint),
    reviewSafety(content),
    reviewConsistency(content, blueprint, manifest, ctx, mode),
    reviewEvidenceCitationGrounding(content, manifest, ctx.evidencePack, mode), // Sprint 29F.1 Part 4
  ];
}

function getReviewModeContext(manifest: WorkPackageManifest): ReviewModeContext {
  const selectionMetadata = manifest.selectionMetadata as Record<string, unknown> | null | undefined;
  const deliverableStandardisation = stringOrNull(selectionMetadata?.deliverableStandardisation);
  const requestedDeliverableType = stringOrNull(selectionMetadata?.requestedDeliverableType);
  const isStandardReusableTemplate =
    deliverableStandardisation === "standard_reusable" ||
    /^STANDARD_REUSABLE_/.test(requestedDeliverableType ?? "");

  return { isStandardReusableTemplate, deliverableStandardisation, requestedDeliverableType };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

type ExecutionCriterionKey = keyof ReviewExecutionOutcome;

interface ClassifiedCriterion {
  criterion: string;
  kind: "document" | "execution";
  executionKey?: ExecutionCriterionKey;
}

function classifySuccessCriterion(criterion: string): ClassifiedCriterion {
  const lower = criterion.toLowerCase();
  const patterns: Array<{ key: ExecutionCriterionKey; pattern: RegExp }> = [
    {
      key: "artifactGenerated",
      pattern: /\b(?:docx|pdf|artifact|export|file|download|document)\b.*\b(?:generated|created|produced|rendered|available|downloaded)\b|\b(?:generated|created|produced|rendered|downloaded)\b.*\b(?:docx|pdf|artifact|export|file|document)\b/i,
    },
    {
      key: "approvalSubmitted",
      pattern: /\b(?:approval|review|sign[ -]?off)\b.*\b(?:submitted|requested|created|queued|pending|awaiting)\b|\b(?:submitted|requested|created|queued)\b.*\b(?:approval|review|sign[ -]?off)\b/i,
    },
    {
      key: "unresolvedGapsSurfaced",
      pattern: /\b(?:unresolved\s+)?(?:gaps?|blockers?|missing\s+(?:information|evidence|items?))\b.*\b(?:surfaced|identified|reported|flagged|raised|recorded)\b|\b(?:surfaced|identified|reported|flagged|raised|recorded)\b.*\b(?:unresolved\s+)?(?:gaps?|blockers?|missing\s+(?:information|evidence|items?))\b/i,
    },
    {
      key: "completedWorkCreated",
      pattern: /\bcompleted\s+work\b.*\b(?:created|saved|recorded|persisted)\b|\b(?:created|saved|recorded|persisted)\b.*\bcompleted\s+work\b/i,
    },
  ];
  const match = patterns.find(({ pattern }) => pattern.test(lower));
  return match
    ? { criterion, kind: "execution", executionKey: match.key }
    : { criterion, kind: "document" };
}

function evaluateDocumentCriterion(contentLower: string, criterion: string): boolean {
  const words = criterion.toLowerCase().split(/\s+/).filter(w => w.length > 4);
  if (words.length === 0) return true;
  return words.some(w => contentLower.includes(w));
}

function evaluateExecutionCriterion(
  classified: ClassifiedCriterion,
  executionOutcome?: ReviewExecutionOutcome,
): boolean | null {
  if (classified.kind !== "execution" || !classified.executionKey) return null;
  const value = executionOutcome?.[classified.executionKey];
  return typeof value === "boolean" ? value : null;
}

function reviewInstructionAdherence(
  content: string,
  blueprint: WorkBlueprint | null,
  ctx: Pick<ReviewContext, "requirementPlan" | "failedRequirements" | "executionOutcome"> = {},
  mode: ReviewModeContext,
): DimensionResult {
  if (!blueprint) {
    return pass(
      "instruction_adherence", 8,
      "No blueprint — general instruction adherence assumed",
      ["No blueprint provided; using default score"],
    );
  }
  const contentLower = content.toLowerCase();
  const criteria = blueprint.successCriteria.map(classifySuccessCriterion);
  let addressed = 0;
  let scored = 0;
  const evidence: string[] = [];

  for (const classified of criteria) {
    if (classified.kind === "execution") {
      const result = evaluateExecutionCriterion(classified, ctx.executionOutcome);
      if (result === null) {
        evidence.push(`Criterion "${classified.criterion.slice(0, 60)}" — execution-state criterion, not scored against document text`);
        continue;
      }
      scored++;
      if (result) addressed++;
      evidence.push(`Criterion "${classified.criterion.slice(0, 60)}" — ${result ? "execution outcome satisfied" : "execution outcome NOT satisfied"}`);
      continue;
    }

    scored++;
    const found = evaluateDocumentCriterion(contentLower, classified.criterion);
    if (found) addressed++;
    evidence.push(`Criterion "${classified.criterion.slice(0, 60)}" — ${found ? "addressed in document" : "NOT addressed in document"}`);
  }
  if (evidence.length === 0) evidence.push("No success criteria defined in blueprint");

  let score = scored === 0 ? 8 : Math.round(Math.min(10, (addressed / scored) * 10));
  if (mode.isStandardReusableTemplate && ctx.requirementPlan?.length && (ctx.failedRequirements ?? []).length === 0) {
    score = Math.max(score, 9);
    evidence.push("Template mode: requirement coverage satisfied; participant-specific depth is not required");
  }

  const suggestions = score < 6
    ? [`Ensure all success criteria are addressed: ${blueprint.successCriteria.join("; ")}`]
    : [];

  return {
    dimension: "instruction_adherence",
    score,
    passed: score >= 6,
    feedback: `${addressed}/${scored} scored success criteria satisfied`,
    improvementSuggestions: suggestions,
    evidence,
  };
}

function reviewPolicyCompliance(
  content: string,
  manifest: WorkPackageManifest,
  mode: ReviewModeContext,
): DimensionResult {
  const policies = manifest.organisationLibrarySources.filter(s => s.sourceType === "policy");

  if (policies.length === 0) {
    if (mode.isStandardReusableTemplate) {
      return pass(
        "policy_compliance", 8,
        "Template mode — no participant-specific policy evidence required for a reusable structure",
        ["Template mode: no policy sources were supplied; scored against reusable template requirements, not participant-specific policy application"],
      );
    }
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
  mode: ReviewModeContext,
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
    const { passed: termPassed, evidence: termEvidence } = checkTerminologyUsage(content, manifest, blueprint, mode);
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

function reviewSourceCoverage(
  content: string,
  manifest: WorkPackageManifest,
  mode: ReviewModeContext,
): DimensionResult {
  const sources = manifest.organisationLibrarySources;

  if (sources.length === 0) {
    if (mode.isStandardReusableTemplate) {
      return pass(
        "source_coverage", 8,
        "Template mode — no participant-specific sources required",
        ["Template mode: no library sources were supplied; source coverage does not apply to a standard reusable template without participant facts"],
      );
    }
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

function reviewCompleteness(
  content: string,
  blueprint: WorkBlueprint | null,
  ctx: Pick<ReviewContext, "requirementPlan" | "failedRequirements"> = {},
  mode: ReviewModeContext,
): DimensionResult {
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

  if (ctx.requirementPlan?.length) {
    const failedRequirements = ctx.failedRequirements ?? [];
    evidence.push(`Requirement plan supplied: ${ctx.requirementPlan.length} requirement(s)`);
    evidence.push(`Specific failed requirements supplied: ${failedRequirements.length}`);
    if (failedRequirements.length > 0) {
      const deduction = Math.min(4, Math.ceil(failedRequirements.length / 2));
      score -= deduction;
      suggestions.push(
        `Address failed requirements explicitly: ${failedRequirements
          .map((requirement) => `${requirement.requirementId} (${requirement.reason})`)
          .join("; ")}`,
      );
      evidence.push(`Deduction -${deduction}: completion gate reported unsatisfied requirements`);
    } else if (mode.isStandardReusableTemplate) {
      score = Math.max(score, 9);
      evidence.push("Template mode: all supplied template requirements satisfied");
    }
  } else {
    evidence.push("Requirement plan not supplied to self-review context");
  }

  // ── Plan-language detection (Sprint 29H Part C) ───────────────────────────
  // For output types that require completed analysis, detect "plan-to-do" phrases.
  // These phrases indicate the specialist described how to do the work rather than
  // having performed it — e.g. "Conduct a review" instead of presenting findings.
  const { requiresCompletedAnalysis, detectedPatterns } = detectPlanLanguage(content, blueprint);
  if (requiresCompletedAnalysis) {
    if (detectedPatterns.length > 0) {
      const deduction = Math.min(4, detectedPatterns.length);
      score -= deduction;
      detectedPatterns.forEach(p => evidence.push(`Plan-language detected: ${p}`));
      suggestions.push(
        `Output contains ${detectedPatterns.length} plan-to-do phrase(s). ` +
        `The specialist must perform the analysis and present findings — not instruct another person to do it.`,
      );
      evidence.push(`Deduction -${deduction}: plan-to-do language in completed-analysis output type`);
    } else {
      evidence.push("Plan-language check: no plan-to-do phrases detected ✓");
    }
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
  const triggered = detectSafetyViolations(content);
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

function detectSafetyViolations(content: string): Array<{ message: string; snippet: string }> {
  const flags = [
    { pattern: /\b(?:fabricat\w*|invent\w*|made[ -]?up|hallucin\w*)\b/gi, message: "Instruction to fabricate or invent content" },
    { pattern: /\bignore\s+(?:policy|procedure|law|legislation)\b/gi, message: "Instruction to ignore policy/law" },
    { pattern: /\bwithout\s+(?:approval|authorisation|authorization|consent)\b/gi, message: "Instruction to bypass required authorisation" },
  ];
  const violations: Array<{ message: string; snippet: string }> = [];

  for (const flag of flags) {
    for (const match of content.matchAll(flag.pattern)) {
      const index = match.index ?? 0;
      if (isProhibitedSafetyReference(content, index)) continue;
      violations.push({ message: flag.message, snippet: extractSnippet(content, index) });
      break;
    }
  }

  return violations;
}

function isProhibitedSafetyReference(content: string, matchIndex: number): boolean {
  const sentenceStart = Math.max(
    content.lastIndexOf(".", matchIndex),
    content.lastIndexOf("!", matchIndex),
    content.lastIndexOf("?", matchIndex),
    content.lastIndexOf("\n", matchIndex),
  ) + 1;
  const prefix = content.slice(sentenceStart, matchIndex).toLowerCase();
  const localPrefix = prefix.slice(-90);
  return /\b(?:do\s+not|don't|must\s+not|must\s+never|never|may\s+not|should\s+not|cannot|can't|avoid|no)\b/.test(localPrefix);
}

function extractSnippet(content: string, index: number): string {
  return content.slice(Math.max(0, index - 40), Math.min(content.length, index + 80)).replace(/\s+/g, " ").trim();
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
  ctx: Pick<ReviewContext, "executionOutcome"> = {},
  mode: ReviewModeContext,
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
    const classifiedCriteria = blueprint.successCriteria.map(classifySuccessCriterion);
    const documentCriteria = classifiedCriteria.filter(c => c.kind === "document");
    const unmetCriteria = documentCriteria.filter(criterion => !evaluateDocumentCriterion(contentLower, criterion.criterion));
    const executionCriteria = classifiedCriteria.filter(c => c.kind === "execution");
    evidence.push(
      `Document success criteria met: ${documentCriteria.length - unmetCriteria.length}/${documentCriteria.length}`,
    );
    if (executionCriteria.length > 0) {
      const executionSatisfied = executionCriteria.filter(c => evaluateExecutionCriterion(c, ctx.executionOutcome) === true).length;
      const executionKnown = executionCriteria.filter(c => evaluateExecutionCriterion(c, ctx.executionOutcome) !== null).length;
      evidence.push(`Execution success criteria satisfied: ${executionSatisfied}/${executionKnown} known; ${executionCriteria.length - executionKnown} not scored against document text`);
    }
    if (unmetCriteria.length > 0) {
      const deduction = Math.min(3, unmetCriteria.length);
      score -= deduction;
      unmetCriteria.forEach(c =>
        evidence.push(`Unmet document criterion: "${c.criterion.slice(0, 60)}"`)
      );
      suggestions.push(`${unmetCriteria.length} success criterion/criteria not addressed in content`);
    }
    if (mode.isStandardReusableTemplate && documentCriteria.length === 0 && executionCriteria.length > 0) {
      evidence.push("Template mode: execution criteria separated from document consistency scoring");
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

// ─── Evidence Citation Grounding — Sprint 29F.1 Part 4 ───────────────────────

/**
 * Verifies that the specialist output is grounded in the retrieved EvidencePack.
 *
 * Checks:
 *   1. Manifest sources exist in the EvidencePack (retrieval verification)
 *   2. Connector-derived evidence is identified by provenance in the output
 *   3. File/document citations are not invented (no citations when pack is empty)
 *   4. Claims with weak evidence are marked with [UNCERTAIN]/[WEAK_EVIDENCE] markers
 *
 * Does NOT require verbatim quotation — semantic coverage is sufficient.
 * Returns structured evidence for the Execution Inspector.
 */
function reviewEvidenceCitationGrounding(
  content: string,
  manifest: WorkPackageManifest,
  evidencePack?: EvidencePack | null,
  mode?: ReviewModeContext,
): DimensionResult {
  // No evidence pack provided — skip with informational warning
  if (!evidencePack) {
    if (mode?.isStandardReusableTemplate) {
      return pass(
        "evidence_citation_grounding", 8,
        "Template mode — citation grounding not required without participant-specific evidence",
        ["Template mode: no EvidencePack supplied; participant-specific citations are not expected in a reusable template"],
      );
    }
    return warn(
      "evidence_citation_grounding", 6,
      "No EvidencePack provided to self-review — citation grounding skipped",
      ["Pass EvidencePack to reviewDraft to enable citation grounding verification"],
      ["EvidencePack not available; citation grounding dimension cannot be evaluated"],
    );
  }

  const evidence: string[] = [];
  const suggestions: string[] = [];
  let score = 8;

  const chunks = evidencePack.chunks ?? [];
  const sourceIds = evidencePack.sourceIds ?? [];

  // ── 1. Connector-derived evidence provenance ──────────────────────────────
  // Identify connector sources by checking citationsByType or chunk selectionReason
  const connectorChunks = chunks.filter(c =>
    (c.selectionReason ?? "").toLowerCase().includes("connector") ||
    (c.sourceType ?? "").toLowerCase().includes("connector") ||
    (c.citation ?? "").toLowerCase().includes("device"),
  );
  evidence.push(`EvidencePack: ${chunks.length} chunks from ${sourceIds.length} sources`);
  if (connectorChunks.length > 0) {
    const connectorTitles = [...new Set(connectorChunks.map(c => c.sourceTitle ?? c.sourceId))];
    evidence.push(`Connector-derived sources: ${connectorTitles.join(", ")}`);
    // Check content acknowledges connector origin
    const hasConnectorProvenance = /(?:connector|connected device|local file|desktop)\b/i.test(content);
    if (!hasConnectorProvenance) {
      score -= 1;
      suggestions.push("Connector-derived evidence should be attributed to the connected device in the output");
      evidence.push("Deduction -1: connector evidence present but no device/connector provenance marker found in output");
    } else {
      evidence.push("Connector provenance correctly referenced in output");
    }
  }

  // ── 2. Manifest source verification against EvidencePack ─────────────────
  const manifestSources = manifest.organisationLibrarySources ?? [];
  const evidenceSourceIdSet = new Set(sourceIds);
  const manifestSourceIds = manifestSources.map(s => s.sourceId);
  const missing = manifestSourceIds.filter(id => !evidenceSourceIdSet.has(id));
  const matched = manifestSourceIds.filter(id => evidenceSourceIdSet.has(id));

  if (manifestSourceIds.length > 0) {
    evidence.push(`Manifest sources verified in EvidencePack: ${matched.length}/${manifestSourceIds.length}`);
    if (missing.length > 0) {
      score -= 2;
      suggestions.push(`${missing.length} source(s) in manifest not found in EvidencePack — verify retrieval completed`);
      evidence.push(`Deduction -2: ${missing.length} manifest source(s) absent from EvidencePack`);
    }
  } else {
    evidence.push("No Organisation Library sources in manifest — library verification skipped");
  }

  // ── 3. Invented reference detection ──────────────────────────────────────
  // Heuristic: document/file citations in content when EvidencePack is empty
  const hasDocCitation = /(?:per|see|refer to|as per|according to)\s+[A-Z][A-Za-z\s]{2,40}\.(docx?|pdf|xlsx?)/i.test(content);
  if (hasDocCitation && chunks.length === 0) {
    score -= 1;
    suggestions.push("Output cites specific documents but no evidence was retrieved — verify all file references are grounded in retrieved content");
    evidence.push("Deduction -1: specific file citations found but EvidencePack is empty — potential invented reference");
  }

  // ── 4. Weak evidence markers — GOOD PRACTICE ─────────────────────────────
  const uncertainMarkers = (content.match(
    /\[UNCERTAIN(?::[^\]]+)?\]|\[WEAK_EVIDENCE(?::[^\]]+)?\]|\[UNVERIFIED(?::[^\]]+)?\]/gi,
  ) ?? []);
  if (uncertainMarkers.length > 0) {
    // Correctly marked uncertain claims — reward good practice
    evidence.push(`Uncertain/weak-evidence markers found: ${uncertainMarkers.length} (correctly self-flagged)`);
  } else if (!mode?.isStandardReusableTemplate && chunks.length === 0 && content.length > 300) {
    // No evidence retrieved and no uncertainty markers — flag
    score -= 1;
    suggestions.push("No evidence was retrieved — mark any uncertain claims with [UNCERTAIN] or [WEAK_EVIDENCE]");
    evidence.push("Deduction -1: no evidence retrieved and no uncertainty markers used — uncertain claims should be flagged");
  }

  score = Math.max(0, Math.min(10, score));
  return {
    dimension: "evidence_citation_grounding",
    score,
    passed: score >= 6,
    feedback: `EvidencePack: ${chunks.length} chunks, ${sourceIds.length} sources; manifest match: ${matched.length}/${manifestSourceIds.length}; connector: ${connectorChunks.length} chunk(s)`,
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
  mode: ReviewModeContext,
): TerminologyCheckResult {
  const evidence: string[] = [];
  const contentLower = content.toLowerCase();
  let misses = 0;

  // 1. Blueprint mandatory citations
  const mandatoryCitations = blueprint?.mandatoryCitations ?? [];
  if (mandatoryCitations.length > 0 && !mode.isStandardReusableTemplate) {
    for (const citation of mandatoryCitations) {
      const found = contentLower.includes(citation.toLowerCase());
      evidence.push(
        `Mandatory citation "${citation}" — ${found ? "present in content" : "MISSING from content"}`,
      );
      if (!found) misses++;
    }
  } else if (mandatoryCitations.length > 0 && mode.isStandardReusableTemplate) {
    evidence.push("Template mode: mandatory participant-specific citations skipped");
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
    if (mode.isStandardReusableTemplate && ["operating_preference", "participant_context", "current_support_requirements"].includes(memType)) {
      evidence.push(`Template mode: required memory type "${memType}" not required for reusable template text`);
      continue;
    }
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

interface RevisionAttemptResult {
  content: string;
  discardReason?: string;
}

async function attemptRevision(
  content: string,
  feedback: string[],
  manifest: WorkPackageManifest,
  ctx: ReviewContext,
): Promise<RevisionAttemptResult> {
  const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();
  if (provider !== "openai") return { content }; // No revision without LLM

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
Use the requirement plan, failed requirements and deliverable contract as the review standard.
Every listed failed requirement must be repaired in the revised deliverable where possible from the supplied content and evidence context.
Return only the revised content — no preamble, no explanation.`;

    const userMessage = [
      `## Quality Feedback to Address\n${feedback.map((f, i) => `${i + 1}. ${f}`).join("\n")}`,
      `## Requirement Plan\n${ctx.requirementPlan?.length ? JSON.stringify(ctx.requirementPlan, null, 2) : "No requirement plan supplied."}`,
      `## Specific Failed Requirements\n${ctx.failedRequirements?.length ? JSON.stringify(ctx.failedRequirements, null, 2) : "No specific failed requirements supplied."}`,
      `## Deliverable Contract\n${ctx.deliverableContract ? JSON.stringify(ctx.deliverableContract, null, 2) : "No deliverable contract supplied."}`,
      `## Full Deliverable Under Review\n${content}`,
    ].join("\n\n");

    const response = await gateway.process({
      systemPrompt,
      userMessage,
      retrievedFields: [],
      maxTokens: REVISION_MAX_TOKENS,
      outputMode: "text", // Self-review revision produces prose — never JSON
    });

    if (response.usedFallback || !response.content) return { content };
    const revised = response.content.trim();
    const finishReason = String(response.finishReason ?? "").toLowerCase();
    if (finishReason === "length") {
      return {
        content,
        discardReason: "Auto-revision discarded because the model hit the output length limit; retained prior draft.",
      };
    }
    if (isMateriallyShorterRevision(content, revised)) {
      return {
        content,
        discardReason: `Auto-revision discarded because it retained less than ${Math.round(MIN_REVISION_LENGTH_RATIO * 100)}% of the original length; retained prior draft.`,
      };
    }
    return { content: revised };
  } catch {
    return { content }; // Revision failed — return original
  }
}

function isMateriallyShorterRevision(original: string, revised: string): boolean {
  if (original.trim().length < 1000) return false;
  return revised.length < original.length * MIN_REVISION_LENGTH_RATIO;
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
    // dim.score is 0–10. Multiply by 10 to convert to 0–100 range per dimension,
    // then divide by sum of weights (not sum of weights×10) to produce a 0–100 result.
    // Sprint 29H Part D: previous formula had `totalWeight += weight * 10` which
    // cancelled the ×10 and produced a 0–10 result, making QUALITY_THRESHOLD=70 unreachable.
    weightedSum += dim.score * 10 * weight;
    totalWeight += weight;   // FIX: was `weight * 10`; result is now 0–100 scale
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
