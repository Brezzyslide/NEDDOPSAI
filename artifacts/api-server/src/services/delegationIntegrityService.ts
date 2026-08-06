/**
 * Delegation Integrity Service — Sprint 28.4
 *
 * Detects and corrects false action-language claims in Chief of Staff responses.
 *
 * Principle: Conversation language must never claim an action that the platform
 * has not yet performed. Every claim about assignment, coordination, execution,
 * or completion must be backed by a corresponding platform record.
 *
 * This service:
 * 1. Detects prohibited action claims by category (Part 6 of spec)
 * 2. Compares each claim against the current action state (allowedClaims)
 * 3. Rewrites the response to truthful language (Part 5 of spec)
 * 4. Records actionIntegrityViolationDetected for diagnostics (Part 11)
 *
 * Detection is CONSERVATIVE: only flag phrases that are unambiguously false
 * claims about completed/current actions. Capability descriptions ("is
 * responsible for"), conditional statements ("would normally"), and future
 * plans ("Shall I prepare...") are never flagged.
 */

import type { ActionStateLevel, ConversationActionState } from "./conversationActionStateService.js";

// ─── Violation category ────────────────────────────────────────────────────────

export type ViolationCategory =
  | "assignment"      // claiming an assignment occurred that hasn't
  | "coordination"    // claiming active coordination or "proceeding"
  | "execution"       // claiming execution is underway when it isn't
  | "completion"      // claiming work is complete when it isn't
  | "premature_proceed"; // claiming to proceed without confirmation

// ─── Detection patterns ────────────────────────────────────────────────────────

/**
 * Assignment claims — imply past/current assignment that hasn't happened.
 * Only flags agent-subject patterns; not passive-capability descriptions.
 *
 * Flagged:    "I have assigned", "I've delegated", "has been allocated to"
 * Not flagged: "responsible for", "would normally assign", "can allocate"
 */
const ASSIGNMENT_PATTERNS: RegExp[] = [
  // First-person past tense: "I have assigned", "I've delegated", "I've allocated"
  /\b(i'?ve|i have)\s+(assigned|delegated|allocated|dispatched|handed\s+over)\b/i,
  // Passive past tense with object: "has been assigned", "has been delegated"
  /\b(has\s+been|have\s+been)\s+(assigned|delegated|allocated)\b/i,
  // "asked the specialist" — implies specialist was already contacted
  /\basked\s+the\s+(specialist|operations\s+manager|compliance\s+manager)\b/i,
];

/**
 * Coordination claims — imply active ongoing coordination.
 *
 * Flagged:    "I am coordinating", "I'm coordinating", "the team is working on it"
 * Not flagged: "I can coordinate", "I will coordinate once confirmed",
 *              "responsible for coordinating"
 */
const COORDINATION_PATTERNS: RegExp[] = [
  // Present progressive first-person: "I am coordinating", "I'm managing this"
  /\b(i am|i'm)\s+(currently\s+)?(coordinating|managing|handling)\s+(this|the|a)\b/i,
  // "the team is working on it" — implies active work
  /\bthe\s+team\s+is\s+(working|reviewing)\b/i,
];

/**
 * Premature proceed claims — imply the user has already confirmed when they haven't.
 *
 * Flagged:    "I will proceed" (without conditional), "proceeding now",
 *             "I am proceeding", "I'm proceeding"
 * Not flagged: "I can proceed if you confirm", "I will proceed once confirmed"
 */
const PREMATURE_PROCEED_PATTERNS: RegExp[] = [
  // "I will proceed" without an explicit condition following
  /\bi\s+will\s+proceed(?!\s+(once|when|if|after|as\s+soon))/i,
  // "I am proceeding" / "proceeding now" / "I'm proceeding"
  /\b(i\s+am|i'm|now)\s+proceeding\b/i,
];

/**
 * Execution claims — imply the specialist is actively working when they haven't started.
 *
 * Flagged:    "has started the review", "is reviewing now", "work is underway",
 *             "is in progress", "the review is underway"
 * Not flagged: "will start", "is available to start", "can begin"
 */
const EXECUTION_PATTERNS: RegExp[] = [
  // "has started [the|this|a]" — past-tense start claim
  /\bhas\s+started\s+(the|this|a)\b/i,
  // "[is|are] reviewing now" / "[is] working on this now"
  /\b(is|are)\s+(reviewing|working\s+on\s+(this|it))\s+now\b/i,
  // "work is underway" / "the review is underway"
  /\b(work|the\s+review|this|it)\s+is\s+underway\b/i,
  // "[is|are] in progress" as a status claim about this task
  /\b(the\s+(work|review|task|analysis)|it)\s+is\s+in\s+progress\b/i,
  // "is currently reviewing"
  /\bis\s+currently\s+(reviewing|working|processing)\b/i,
];

/**
 * Completion claims — imply work is done when it isn't.
 *
 * Flagged:    "the review is complete", "has been completed", "is finished",
 *             "has been delivered"
 * Not flagged: "will be complete", "can deliver"
 */
const COMPLETION_PATTERNS: RegExp[] = [
  // "[is|has been] completed/finished/delivered"
  /\b(the\s+(work|review|task|analysis|report)|it)\s+(is|has\s+been)\s+(completed|finished|delivered|ready)\b/i,
  // "has been completed" — standalone
  /\bhas\s+been\s+(completed|finished|delivered)\b/i,
];

// ─── Detected violation ────────────────────────────────────────────────────────

export interface DetectedViolation {
  category: ViolationCategory;
  matchedPhrase: string;
}

// ─── Result ────────────────────────────────────────────────────────────────────

export interface DelegationIntegrityResult {
  passed: boolean;
  violations: DetectedViolation[];
  correctedResponse: string;
  actionIntegrityViolationDetected: boolean;
  auditFields: DelegationAuditFields;
}

export interface DelegationAuditFields {
  actionStateLevel: ActionStateLevel;
  violationCategories: ViolationCategory[];
  originalClaimCount: number;
  responseWasCorrected: boolean;
}

// ─── Correction templates ──────────────────────────────────────────────────────

/**
 * Safe replacement for each assignment claim pattern — preserves truthfulness
 * by moving from past-tense claim to capability statement.
 */
const ASSIGNMENT_CORRECTIONS: Array<[RegExp, string]> = [
  [/\b(i'?ve|i have)\s+(assigned|delegated|allocated|dispatched)\b/gi, "I can assign"],
  [/\bhas\s+been\s+assigned\b/gi, "can be assigned"],
  [/\bhas\s+been\s+delegated\b/gi, "can be delegated"],
  [/\bhas\s+been\s+allocated\b/gi, "can be allocated"],
];

const COORDINATION_CORRECTIONS: Array<[RegExp, string]> = [
  [/\b(i am|i'm)\s+(currently\s+)?(coordinating|managing|handling)\b/gi, "I can coordinate"],
  [/\bthe\s+team\s+is\s+(working|reviewing)\b/gi, "the team can work"],
];

const PROCEED_CORRECTIONS: Array<[RegExp, string]> = [
  [/\bi\s+will\s+proceed(?!\s+(once|when|if|after|as\s+soon))/gi, "I can proceed once confirmed"],
  [/\b(i\s+am|i'm|now)\s+proceeding\b/gi, "I can proceed once confirmed"],
];

const EXECUTION_CORRECTIONS: Array<[RegExp, string]> = [
  [/\bhas\s+started\s+(the|this|a)\b/gi, "will start $1"],
  [/\b(is|are)\s+(reviewing|working\s+on\s+(this|it))\s+now\b/gi, "will be $2 once assigned"],
  [/\b(work|the\s+review|this|it)\s+is\s+underway\b/gi, "$1 will be underway once assigned"],
  [/\b(the\s+(work|review|task|analysis)|it)\s+is\s+in\s+progress\b/gi, "$1 will be in progress once assigned"],
  [/\bis\s+currently\s+(reviewing|working|processing)\b/gi, "will be $1 once work begins"],
];

const COMPLETION_CORRECTIONS: Array<[RegExp, string]> = [
  [/\b(the\s+(work|review|task|analysis|report)|it)\s+(is|has\s+been)\s+(completed|finished|delivered|ready)\b/gi,
    "$1 will be $4 when the work is done"],
  [/\bhas\s+been\s+(completed|finished|delivered)\b/gi, "will be $1 when the work is done"],
];

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect action-claim violations in a CoS response string.
 * Returns the raw violations found — caller decides which are relevant given state.
 */
export function detectActionClaims(response: string): DetectedViolation[] {
  const violations: DetectedViolation[] = [];

  function check(patterns: RegExp[], category: ViolationCategory) {
    for (const pattern of patterns) {
      const match = response.match(pattern);
      if (match) {
        violations.push({ category, matchedPhrase: match[0] });
      }
    }
  }

  check(ASSIGNMENT_PATTERNS,       "assignment");
  check(COORDINATION_PATTERNS,     "coordination");
  check(PREMATURE_PROCEED_PATTERNS, "premature_proceed");
  check(EXECUTION_PATTERNS,        "execution");
  check(COMPLETION_PATTERNS,       "completion");

  return violations;
}

// ─── State-aware violation filter ─────────────────────────────────────────────

/**
 * Given raw detected violations, filter to those that are actually violations
 * for the current action state. This prevents false positives (e.g. "has started"
 * is not a violation when state=execution_started).
 */
function filterViolationsForState(
  violations: DetectedViolation[],
  state: ConversationActionState,
): DetectedViolation[] {
  const level = state.level;

  // States that allow claiming execution has started
  const executionStartedStates = new Set<ActionStateLevel>([
    "execution_started",
    "awaiting_clarification",
    "completed",
  ]);

  // States that allow completion claims
  const completedStates = new Set<ActionStateLevel>(["completed"]);

  // States that allow specialist assignment claims
  const assignedStates = new Set<ActionStateLevel>([
    "specialist_assigned",
    "execution_dispatched",
    "execution_started",
    "awaiting_clarification",
    "completed",
  ]);

  // States where "I will proceed" is premature (user has not confirmed)
  const confirmationRequiredStates = new Set<ActionStateLevel>([
    "informational",
    "proposal_ready",
    "proposal_created",
    "awaiting_confirmation",
  ]);

  return violations.filter(v => {
    switch (v.category) {
      case "assignment":
        return !assignedStates.has(level);
      case "coordination":
        // Active coordination claim is always a violation if no task exists
        return level === "informational" || level === "proposal_ready"
            || level === "proposal_created" || level === "awaiting_confirmation";
      case "premature_proceed":
        return confirmationRequiredStates.has(level);
      case "execution":
        return !executionStartedStates.has(level);
      case "completion":
        return !completedStates.has(level);
      default:
        return true;
    }
  });
}

// ─── Correction ───────────────────────────────────────────────────────────────

/**
 * Apply pattern-based corrections to the response.
 * Conservative: only substitutes phrases that directly match detected violations.
 */
function applyPatternCorrections(response: string, violations: DetectedViolation[]): string {
  let corrected = response;
  const categories = new Set(violations.map(v => v.category));

  if (categories.has("assignment")) {
    for (const [pattern, replacement] of ASSIGNMENT_CORRECTIONS) {
      corrected = corrected.replace(pattern, replacement);
    }
  }
  if (categories.has("coordination")) {
    for (const [pattern, replacement] of COORDINATION_CORRECTIONS) {
      corrected = corrected.replace(pattern, replacement);
    }
  }
  if (categories.has("premature_proceed")) {
    for (const [pattern, replacement] of PROCEED_CORRECTIONS) {
      corrected = corrected.replace(pattern, replacement);
    }
  }
  if (categories.has("execution")) {
    for (const [pattern, replacement] of EXECUTION_CORRECTIONS) {
      corrected = corrected.replace(pattern, replacement);
    }
  }
  if (categories.has("completion")) {
    for (const [pattern, replacement] of COMPLETION_CORRECTIONS) {
      corrected = corrected.replace(pattern, replacement);
    }
  }

  return corrected;
}

/**
 * Level-appropriate suffix appended when violations are detected.
 * Tells the user what the actual current state is.
 */
const STATE_SUFFIX: Record<ActionStateLevel, string> = {
  informational:          " Shall I prepare a task proposal?",
  proposal_ready:         " Shall I prepare a task proposal?",
  proposal_created:       " The task proposal is ready — please confirm to proceed.",
  awaiting_confirmation:  " Please confirm the proposal to proceed.",
  task_created:           " The task has been created and is ready for specialist assignment.",
  specialist_assigned:    " The specialist has been assigned and work will begin shortly.",
  execution_dispatched:   " The work has been dispatched and will begin shortly.",
  execution_started:      " Work is currently in progress.",
  awaiting_clarification: " Work is paused pending your clarification.",
  completed:              "",
  failed:                 " Please contact support or retry the task.",
};

// ─── Main check function ───────────────────────────────────────────────────────

/**
 * Check a Chief of Staff customer response for delegation integrity violations.
 *
 * Returns a corrected response and audit fields.
 * When no violations are found, `correctedResponse` equals the original `response`.
 */
export function checkDelegationIntegrity(
  response: string,
  actionState: ConversationActionState,
): DelegationIntegrityResult {
  // 1. Detect all potential action claims
  const rawViolations = detectActionClaims(response);

  // 2. Filter to state-relevant violations
  const violations = filterViolationsForState(rawViolations, actionState);

  const actionIntegrityViolationDetected = violations.length > 0;
  const violationCategories = [...new Set(violations.map(v => v.category))];

  if (!actionIntegrityViolationDetected) {
    return {
      passed: true,
      violations: [],
      correctedResponse: response,
      actionIntegrityViolationDetected: false,
      auditFields: {
        actionStateLevel: actionState.level,
        violationCategories: [],
        originalClaimCount: 0,
        responseWasCorrected: false,
      },
    };
  }

  // 3. Apply corrections
  let correctedResponse = applyPatternCorrections(response, violations);

  // 4. Append state-level suffix if the correction changed the response text
  if (correctedResponse !== response) {
    const suffix = STATE_SUFFIX[actionState.level];
    if (suffix && !correctedResponse.endsWith(suffix.trim())) {
      correctedResponse = correctedResponse.trimEnd() + suffix;
    }
  }

  return {
    passed: false,
    violations,
    correctedResponse,
    actionIntegrityViolationDetected: true,
    auditFields: {
      actionStateLevel: actionState.level,
      violationCategories,
      originalClaimCount: violations.length,
      responseWasCorrected: correctedResponse !== response,
    },
  };
}

// ─── Audit event builder ──────────────────────────────────────────────────────

/**
 * Build a structured audit event payload for delegation integrity events.
 * Designed for consumption by logOrgEvent / any audit sink.
 * NEVER includes raw prompt content.
 */
export function buildDelegationIntegrityAuditEvent(params: {
  organisationId: string;
  conversationId: string;
  taskId?: string;
  proposalId?: string;
  executionId?: string;
  correlationId: string;
  auditFields: DelegationAuditFields;
}): Record<string, unknown> {
  return {
    event:             "delegation_integrity_check",
    organisationId:    params.organisationId,
    conversationId:    params.conversationId,
    taskId:            params.taskId ?? null,
    proposalId:        params.proposalId ?? null,
    executionId:       params.executionId ?? null,
    correlationId:     params.correlationId,
    actionStateLevel:  params.auditFields.actionStateLevel,
    violationCategories: params.auditFields.violationCategories,
    originalClaimCount:  params.auditFields.originalClaimCount,
    responseWasCorrected: params.auditFields.responseWasCorrected,
    actionIntegrityViolation: params.auditFields.originalClaimCount > 0,
  };
}
