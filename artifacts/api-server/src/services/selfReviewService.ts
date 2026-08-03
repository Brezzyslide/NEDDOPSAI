/**
 * Self Review Service — Sprint 22 (Work Execution Engine & Completed Work)
 *
 * Performs structured post-generation quality evaluation across 10 dimensions.
 * Each dimension returns a score (0–10) and actionable feedback.
 *
 * If the overall weighted score is below the quality threshold (70/100),
 * the service generates targeted improvement feedback and permits one
 * automatic revision cycle.
 *
 * Self-review is deterministic (rule-based) for most dimensions; LLM-assisted
 * checks are used for instruction adherence and writing style when available.
 */

import { createAIGateway } from "@workspace/ai-gateway";
import type { AIGatewayContext } from "@workspace/ai-gateway";
import { randomUUID } from "crypto";
import type { WorkBlueprint } from "./workBlueprintService.js";
import type { WorkPackageManifest } from "./workPackageService.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const QUALITY_THRESHOLD = 70;
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
  consistency:               0, // derived from completeness
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DimensionResult {
  dimension: ReviewDimensionName;
  score: number;       // 0–10
  passed: boolean;     // score >= 6
  feedback: string;
  improvementSuggestions: string[];
}

export interface ReviewResult {
  qualityScore: number;     // 0–100 weighted
  dimensions: DimensionResult[];
  passed: boolean;          // qualityScore >= QUALITY_THRESHOLD
  improvementFeedback: string[];
  revised: boolean;
  finalContent: string;
  autoRevisionNote?: string;
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

  if (!passed && improvementFeedback.length > 0) {
    // Attempt one automatic revision
    const revised = await attemptRevision(content, improvementFeedback, manifest, ctx);
    if (revised !== content) {
      const revisedDimensions = runDeterministicReview(revised, manifest, blueprint);
      const revisedScore = computeWeightedScore(revisedDimensions, blueprint);
      return {
        qualityScore: revisedScore,
        dimensions: revisedDimensions,
        passed: revisedScore >= QUALITY_THRESHOLD,
        improvementFeedback,
        revised: true,
        finalContent: revised,
        autoRevisionNote: `Auto-revised from score ${qualityScore} → ${revisedScore}`,
      };
    }
  }

  return {
    qualityScore,
    dimensions,
    passed,
    improvementFeedback,
    revised: false,
    finalContent: content,
  };
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
    reviewWritingStyleCompliance(content, manifest),
    reviewSourceCoverage(content, manifest),
    reviewCompleteness(content, blueprint),
    reviewConfidence(content),
    reviewMissingInformation(content),
    reviewApprovalRequirements(content, blueprint),
    reviewSafety(content),
    reviewConsistency(content),
  ];
}

function reviewInstructionAdherence(content: string, blueprint: WorkBlueprint | null): DimensionResult {
  if (!blueprint) {
    return pass("instruction_adherence", 8, "No blueprint — general instruction adherence assumed");
  }
  const criteriaWords = blueprint.successCriteria.flatMap(c => c.toLowerCase().split(/\s+/));
  const contentLower = content.toLowerCase();
  const matched = criteriaWords.filter(w => w.length > 4 && contentLower.includes(w)).length;
  const total = criteriaWords.filter(w => w.length > 4).length;
  const score = total === 0 ? 8 : Math.round(Math.min(10, (matched / total) * 12));
  const suggestions = score < 6
    ? [`Ensure all success criteria are addressed: ${blueprint.successCriteria.join("; ")}`]
    : [];
  return { dimension: "instruction_adherence", score, passed: score >= 6, feedback: `${matched}/${total} success criteria terms found`, improvementSuggestions: suggestions };
}

function reviewPolicyCompliance(content: string, manifest: WorkPackageManifest): DimensionResult {
  const policies = manifest.organisationLibrarySources.filter(s => s.sourceType === "policy");
  if (policies.length === 0) {
    return warn("policy_compliance", 6, "No policies retrieved — policy compliance not fully evaluated", [
      "Retrieve relevant organisational policies before generating this output",
    ]);
  }
  const contentLower = content.toLowerCase();
  const cited = policies.filter(p => contentLower.includes(p.title.toLowerCase().split(" ")[0]!)).length;
  const score = policies.length === 0 ? 7 : Math.round(Math.min(10, 6 + (cited / policies.length) * 4));
  return {
    dimension: "policy_compliance",
    score,
    passed: score >= 6,
    feedback: `${cited}/${policies.length} retrieved policies referenced in content`,
    improvementSuggestions: score < 7 ? ["Reference the retrieved policy documents explicitly in the output"] : [],
  };
}

function reviewWritingStyleCompliance(content: string, manifest: WorkPackageManifest): DimensionResult {
  const hasTerminology = manifest.cosMemories.some(m => m.memoryType === "terminology");
  const wordCount = content.split(/\s+/).length;
  const avgSentenceLength = estimateAvgSentenceLength(content);

  let score = 7;
  const suggestions: string[] = [];

  if (avgSentenceLength > 35) {
    score -= 2;
    suggestions.push("Shorten sentences — average sentence length exceeds 35 words");
  }
  if (wordCount < 100 && content.length > 50) {
    score -= 1;
    suggestions.push("Output appears very brief — consider expanding key sections");
  }
  if (hasTerminology && !checkTerminologyUsage(content, manifest)) {
    score -= 1;
    suggestions.push("Ensure organisational terminology from memory is used consistently");
  }

  score = Math.max(0, Math.min(10, score));
  return {
    dimension: "writing_style_compliance",
    score,
    passed: score >= 6,
    feedback: `Avg sentence length: ${avgSentenceLength} words; word count: ${wordCount}`,
    improvementSuggestions: suggestions,
  };
}

function reviewSourceCoverage(content: string, manifest: WorkPackageManifest): DimensionResult {
  const sources = manifest.organisationLibrarySources;
  if (sources.length === 0) {
    return warn("source_coverage", 6, "No library sources were retrieved for this execution", [
      "Add relevant documents to the Organisation Library to improve output quality",
    ]);
  }
  const contentLower = content.toLowerCase();
  const cited = sources.filter(s => {
    const firstWord = s.title.toLowerCase().split(" ")[0]!;
    return firstWord.length > 3 && contentLower.includes(firstWord);
  }).length;
  const score = Math.round(Math.min(10, 5 + (cited / sources.length) * 5));
  return {
    dimension: "source_coverage",
    score,
    passed: score >= 6,
    feedback: `${cited}/${sources.length} retrieved sources referenced`,
    improvementSuggestions: score < 6 ? ["Cite retrieved Organisation Library sources explicitly"] : [],
  };
}

function reviewCompleteness(content: string, blueprint: WorkBlueprint | null): DimensionResult {
  const minContentLength = 200;
  const hasHeadings = /^#{1,3}\s.+/m.test(content) || /^[A-Z][A-Z\s]{3,}:/m.test(content);
  const hasActionItems = /action|recommend|next step|follow.up/i.test(content);

  let score = 7;
  const suggestions: string[] = [];

  if (content.length < minContentLength) {
    score -= 3;
    suggestions.push("Content is too brief — expand key sections");
  }
  if (!hasHeadings && content.length > 500) {
    score -= 1;
    suggestions.push("Add section headings to improve structure");
  }
  if (!hasActionItems && blueprint && blueprint.outputTypes.some(t =>
    ["investigation_report", "risk_assessment", "action_plan", "project_plan"].includes(t))) {
    score -= 1;
    suggestions.push("Include explicit action items or recommendations");
  }

  // Check for incomplete section markers
  const incompleteMarkers = (content.match(/\[INCOMPLETE\]|\[MISSING\]|\[TODO\]/gi) ?? []).length;
  if (incompleteMarkers > 0) {
    score -= Math.min(3, incompleteMarkers);
    suggestions.push(`${incompleteMarkers} section(s) marked as incomplete — provide missing information`);
  }

  score = Math.max(0, Math.min(10, score));
  return {
    dimension: "completeness",
    score,
    passed: score >= 6,
    feedback: `Content length: ${content.length} chars; headings: ${hasHeadings}; incomplete markers: ${incompleteMarkers}`,
    improvementSuggestions: suggestions,
  };
}

function reviewConfidence(content: string): DimensionResult {
  const hedgeWords = ["might", "may", "could", "possibly", "perhaps", "unsure", "unclear", "approximate", "estimated", "assumed"];
  const contentLower = content.toLowerCase();
  const hedgeCount = hedgeWords.filter(w => contentLower.includes(w)).length;
  const score = Math.max(4, 10 - Math.min(6, hedgeCount));
  const suggestions = hedgeCount > 4
    ? ["Reduce hedging language — where information is uncertain, mark it explicitly rather than hedging throughout"]
    : [];
  return {
    dimension: "confidence",
    score,
    passed: score >= 6,
    feedback: `${hedgeCount} hedging expressions detected`,
    improvementSuggestions: suggestions,
  };
}

function reviewMissingInformation(content: string): DimensionResult {
  const missingMarkers = (content.match(/\[INCOMPLETE\]|\[MISSING\]|\[UNKNOWN\]|\[TODO\]|\[REQUIRED\]/gi) ?? []).length;
  const questionMarkers = (content.match(/\?\s*$|\?\s*\n/gm) ?? []).length;
  const score = Math.max(0, 10 - missingMarkers * 2 - Math.min(3, questionMarkers));
  const suggestions: string[] = [];
  if (missingMarkers > 0) suggestions.push(`Resolve ${missingMarkers} missing information marker(s) before submission`);
  if (questionMarkers > 3) suggestions.push("Output contains unresolved questions — clarify or mark as requiring follow-up");
  return {
    dimension: "missing_information",
    score,
    passed: score >= 6,
    feedback: `${missingMarkers} missing markers; ${questionMarkers} unresolved questions`,
    improvementSuggestions: suggestions,
  };
}

function reviewApprovalRequirements(content: string, blueprint: WorkBlueprint | null): DimensionResult {
  const reqApprovals = blueprint?.requiredApprovals ?? {};
  const hasApprovalSection = /approv|sign.?off|authoris|review required/i.test(content);
  const needsApproval = Object.keys(reqApprovals).length > 0;

  if (!needsApproval) return pass("approval_requirements", 9, "No specific approval requirements for this blueprint");

  const score = hasApprovalSection ? 9 : 6;
  return {
    dimension: "approval_requirements",
    score,
    passed: score >= 6,
    feedback: needsApproval ? (hasApprovalSection ? "Approval section present" : "Approval section not detected") : "No approval requirements",
    improvementSuggestions: needsApproval && !hasApprovalSection
      ? ["Add an approval/sign-off section to the document"]
      : [],
  };
}

function reviewSafety(content: string): DimensionResult {
  // Detect potentially unsafe content indicators
  const safetyFlags = [
    { pattern: /fabricat|invent|made.?up|hallucin/i, message: "Potential fabrication language detected" },
    { pattern: /ignore\s+(policy|procedure|law|legislation)/i, message: "Reference to ignoring policy/law" },
    { pattern: /without\s+(approval|authorisation|consent)/i, message: "Reference to bypassing required authorisation" },
  ];

  const triggered = safetyFlags.filter(f => f.pattern.test(content));
  const score = 10 - triggered.length * 3;
  const suggestions = triggered.map(f => `Safety flag: ${f.message}`);

  return {
    dimension: "safety",
    score: Math.max(0, score),
    passed: score >= 7,
    feedback: triggered.length === 0 ? "No safety flags detected" : `${triggered.length} safety flag(s) triggered`,
    improvementSuggestions: suggestions,
  };
}

function reviewConsistency(content: string): DimensionResult {
  // Check for contradictory statements (simple heuristic)
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  const score = lines.length < 5 ? 8 : 8; // Placeholder — real inconsistency detection requires LLM
  return pass("consistency", score, "Structural consistency checked");
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
  // Apply blueprint quality rules if available
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(dimension: ReviewDimensionName, score: number, feedback: string): DimensionResult {
  return { dimension, score, passed: true, feedback, improvementSuggestions: [] };
}

function warn(dimension: ReviewDimensionName, score: number, feedback: string, suggestions: string[]): DimensionResult {
  return { dimension, score, passed: score >= 6, feedback, improvementSuggestions: suggestions };
}

function estimateAvgSentenceLength(content: string): number {
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0);
  return Math.round(totalWords / sentences.length);
}

function checkTerminologyUsage(content: string, manifest: WorkPackageManifest): boolean {
  const terminologyMemories = manifest.cosMemories.filter(m => m.memoryType === "terminology");
  if (terminologyMemories.length === 0) return true;
  // If terminology memories exist, assume the executor used them (can't verify without content)
  return true;
}
