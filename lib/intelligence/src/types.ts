/**
 * @workspace/intelligence — Rule engine types
 *
 * Business intelligence is kept strictly separate from AI agents.
 * Rule engines encode deterministic, auditable domain knowledge —
 * SCHADS Award rates, NDIS Pricing Arrangements, compliance thresholds,
 * risk matrices, and quality indicators.
 *
 * Agents call into intelligence for facts; they do not embed rules themselves.
 * This separation means rules can be updated, versioned, and audited
 * independently of the agent implementations.
 */

import type { Industry } from "@workspace/shared";

// ─── Rule engine identity ─────────────────────────────────────────────────────

export type RuleEngineId =
  | "schads-award"         // Social, Community, Home Care & Disability Services Award
  | "ndis-pricing"         // NDIS Pricing Arrangements & Price Limits
  | "ndis-compliance"      // NDIS Practice Standards & Quality Indicators
  | "risk"                 // Risk assessment matrix
  | "quality";             // Quality management framework

export interface RuleEngineMetadata {
  id: RuleEngineId;
  /** Human-readable name */
  name: string;
  /** The industry this engine applies to */
  industry: Industry;
  /** Semantic version of the rule set, e.g. "2025.1.0" */
  version: string;
  /** ISO date this version came into effect */
  effectiveFrom: string;
  /** ISO date this version expires, or null if current */
  effectiveTo: string | null;
  /** Official source document or URL this engine is based on */
  sourceReference: string;
}

// ─── Rule evaluation ──────────────────────────────────────────────────────────

export type RuleSeverity = "info" | "warning" | "error" | "critical";

export interface RuleViolation {
  /** The rule that was violated, e.g. "SCHADS-3.1.2" */
  ruleId: string;
  /** Human-readable description */
  description: string;
  severity: RuleSeverity;
  /** The field or value that triggered the violation */
  field?: string;
  /** The actual value found */
  actual?: unknown;
  /** The expected or allowed value/range */
  expected?: string;
  /** Optional link to remediation guidance */
  remediationUrl?: string;
}

export interface RuleEvaluationResult {
  /** True if no errors or critical violations were found */
  passed: boolean;
  violations: RuleViolation[];
  /** Aggregate severity — highest severity across all violations */
  severity: RuleSeverity | "none";
  /** ISO timestamp of this evaluation */
  evaluatedAt: string;
  /** The rule engine version used */
  engineVersion: string;
}

// ─── Rule engine interface ────────────────────────────────────────────────────

/**
 * All rule engines implement this interface.
 * Evaluation is always synchronous and deterministic — no LLM calls inside engines.
 */
export interface RuleEngine<TInput = unknown, TContext = Record<string, unknown>> {
  readonly metadata: RuleEngineMetadata;
  /**
   * Evaluate input against this engine's rules and return the result.
   * Must be pure: same input + context always produces the same result.
   */
  evaluate(input: TInput, context?: TContext): RuleEvaluationResult;
}

// ─── SCHADS Award types ───────────────────────────────────────────────────────

export type SCHADSClassification =
  | "home-care-employee"
  | "disability-services-employee"
  | "community-services-employee"
  | "social-and-community-services-employee";

export type SCHADSPayLevel =
  | "level-1" | "level-2" | "level-3" | "level-4"
  | "level-5" | "level-6" | "level-7" | "level-8";

export type SCHADSPayPoint = 1 | 2 | 3 | 4 | 5 | 6;

export interface SCHADSPayRateQuery {
  classification: SCHADSClassification;
  level: SCHADSPayLevel;
  payPoint: SCHADSPayPoint;
  /** ISO date for which the rate should be calculated */
  asOf: string;
}

export interface SCHADSPayRate {
  classification: SCHADSClassification;
  level: SCHADSPayLevel;
  payPoint: SCHADSPayPoint;
  /** Annual salary in AUD cents */
  annualSalaryCents: number;
  /** Hourly rate in AUD cents */
  hourlyRateCents: number;
  /** Casual loading rate as a decimal (e.g. 0.25 for 25%) */
  casualLoadingRate: number;
  effectiveFrom: string;
}

// ─── NDIS Pricing types ───────────────────────────────────────────────────────

export type NDISSupportCategory =
  | "daily-activities"         // 01 — Assistance with Daily Life
  | "transport"                // 02 — Transport
  | "consumables"              // 03 — Consumables
  | "social-participation"     // 04 — Assistance with Social Participation
  | "assistive-technology"     // 05 — Assistive Technology
  | "home-modifications"       // 06 — Home Modifications
  | "support-coordination"     // 07 — Support Coordination
  | "improved-living"          // 08 — Improved Living Arrangements
  | "employment"               // 09 — Finding and Keeping a Job
  | "life-choices"             // 10 — Improved Life Choices
  | "health-wellbeing"         // 11 — Improved Health and Wellbeing
  | "learning"                 // 12 — Improved Learning
  | "daily-activities-high"    // 15 — Daily Activities (High Intensity)
  | "specialist-disability";   // 16 — Specialist Disability Accommodation

export type NDISRegistrationGroup =
  | "assistance-with-daily-life"
  | "assistance-with-social-participation"
  | "assistive-products"
  | "community-nursing-care"
  | "daily-activities"
  | "household-tasks"
  | "participation-in-community"
  | "support-coordination"
  | "therapeutic-supports";

export interface NDISPriceLimitQuery {
  supportItemNumber: string;       // e.g. "01_002_0107_1_1"
  state: "ACT" | "NSW" | "NT" | "QLD" | "SA" | "TAS" | "VIC" | "WA" | "Remote" | "VeryRemote";
  /** ISO date for which the limit applies */
  asOf: string;
}

export interface NDISPriceLimit {
  supportItemNumber: string;
  supportItemName: string;
  supportCategory: NDISSupportCategory;
  registrationGroup: NDISRegistrationGroup;
  /** Price limit in AUD cents */
  priceLimitCents: number;
  unit: "hour" | "day" | "each" | "year" | "month";
  isManagedOnly: boolean;
  effectiveFrom: string;
}

// ─── Compliance check types ───────────────────────────────────────────────────

export type NDISPracticeStandard =
  | "rights-and-responsibility"
  | "governance-and-operational-management"
  | "provision-of-supports"
  | "support-provision-environment"
  | "high-intensity-daily-personal-activities"
  | "specialist-behaviour-support"
  | "implementing-behaviour-support-plans"
  | "early-childhood-supports";

export interface ComplianceCheckInput {
  standard: NDISPracticeStandard;
  /** Key-value evidence map for this check */
  evidence: Record<string, unknown>;
}

// ─── Risk assessment types ────────────────────────────────────────────────────

export type RiskLikelihood = 1 | 2 | 3 | 4 | 5; // 1=Rare, 5=Almost Certain
export type RiskConsequence = 1 | 2 | 3 | 4 | 5; // 1=Insignificant, 5=Catastrophic
export type RiskRating = "low" | "medium" | "high" | "extreme";

export interface RiskAssessmentInput {
  likelihood: RiskLikelihood;
  consequence: RiskConsequence;
  /** Existing controls in place */
  controls?: string[];
}

export interface RiskAssessmentResult {
  rating: RiskRating;
  /** Raw score (likelihood × consequence) */
  score: number;
  /** Recommended actions based on rating */
  recommendedActions: string[];
}

// ─── Quality indicator types ──────────────────────────────────────────────────

export type QualityIndicatorDomain =
  | "person-centred"
  | "workforce"
  | "provider-governance"
  | "feedback-and-complaints"
  | "incidents-and-accidents"
  | "health-and-safety";

export interface QualityIndicator {
  id: string;
  domain: QualityIndicatorDomain;
  name: string;
  description: string;
  /** How this indicator is measured */
  measurementMethod: string;
  /** Target threshold for satisfactory performance */
  threshold?: string;
}
