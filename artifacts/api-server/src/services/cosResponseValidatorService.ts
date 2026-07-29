/**
 * Chief of Staff Response Quality Validator — Sprint 13b
 *
 * Validates that CoS responses to broad organisational requests meet the
 * executive ownership and proactive coordination standards defined in the
 * Chief of Staff Employee File.
 *
 * Broad request rule: The Chief of Staff must never answer a broad
 * organisational request using only generic guidance or an open-ended
 * offer of assistance. Every broad response must contain at minimum:
 *   - Initial assessment
 *   - Likely requirements or recommended next step
 *   - Ownership statement (what the CoS will coordinate)
 *   - Targeted clarification (if required)
 */

// ─── Prohibited response patterns ────────────────────────────────────────────

/**
 * Phrases that indicate the CoS has reverted to generic chatbot behaviour.
 * Any response containing these (case-insensitive) fails the quality check.
 */
export const PROHIBITED_PHRASES: readonly string[] = [
  "please let me know how i can help",
  "please let me know how i can specifically help",
  "let me know how i can help",
  "let me know what you want help with",
  "let me know what you'd like help with",
  "let me know what you would like help with",
  "if you have specific areas",
  "if there are specific areas",
  "i can assist with various aspects",
  "i can assist you with various aspects",
  "i'm here to help with various",
  "what specifically would you like help with",
  "what would you like help with",
  "how can i help you today",
  "how can i specifically help you",
  "what can i help you with",
  "please tell me what you need",
  "feel free to let me know",
] as const;

/**
 * Phrases that indicate the CoS is providing an initial assessment.
 */
const INITIAL_ASSESSMENT_SIGNALS: readonly string[] = [
  "to determine",
  "to establish",
  "based on",
  "as a starting point",
  "most organisations",
  "typically",
  "an ndis",
  "disability services",
  "i can coordinate",
  "i will coordinate",
  "i can review",
  "the following",
  "normally",
  "would include",
  "likely require",
  "will need",
  "you will need",
  "your organisation",
  "to work that out",
  "let me assess",
  "my assessment",
  "initial assessment",
  "first step",
] as const;

/**
 * Phrases that indicate a recommended next step (ownership signal).
 */
const NEXT_STEP_SIGNALS: readonly string[] = [
  "i will",
  "i can coordinate",
  "i'll coordinate",
  "the next step",
  "recommend",
  "i recommend",
  "we should",
  "i suggest",
  "i propose",
  "let me",
  "i can prepare",
  "i can review",
  "to confirm",
  "to proceed",
] as const;

/**
 * Phrases that indicate planning responsibility is being transferred to the user.
 */
const PLANNING_TRANSFER_SIGNALS: readonly string[] = [
  "please let me know what areas",
  "please specify",
  "what areas would you like",
  "tell me more about what you need",
  "what type of help are you looking for",
  "what would you like to focus on",
  "what specific",
] as const;

// ─── Result type ──────────────────────────────────────────────────────────────

export interface CoSResponseQualityResult {
  /** Whether the response passed all quality checks */
  passed: boolean;
  /** List of quality issues found (empty if passed) */
  issues: string[];
  /** The response contained an initial assessment */
  hasInitialAssessment: boolean;
  /** The response contained a recommended next step or ownership statement */
  hasRecommendedNextStep: boolean;
  /** The response did not use prohibited generic assistant language */
  notGenericAssistantLanguage: boolean;
  /** The response did not transfer planning responsibility to the user */
  doesNotTransferPlanningToUser: boolean;
  /** The response does not repeat capability statements without substance */
  doesNotRepeatCapabilityStatement: boolean;
  /** Which prohibited phrases were detected (empty if none) */
  detectedProhibitedPhrases: string[];
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Validates a Chief of Staff response for executive quality standards.
 *
 * @param response - The customerResponse string from the CoS LLM output
 * @param isBroadRequest - Whether this was a broad organisational request.
 *   Non-broad requests (direct factual questions, status queries) are exempt
 *   from the initial-assessment and next-step requirements.
 */
export function validateCoSBroadResponse(
  response: string,
  isBroadRequest: boolean,
): CoSResponseQualityResult {
  const lower = response.toLowerCase();
  const issues: string[] = [];

  // ── 1. Prohibited phrase detection ─────────────────────────────────────────
  const detectedProhibitedPhrases = PROHIBITED_PHRASES.filter(phrase =>
    lower.includes(phrase)
  );
  const notGenericAssistantLanguage = detectedProhibitedPhrases.length === 0;
  if (!notGenericAssistantLanguage) {
    issues.push(
      `Response contains prohibited generic assistant language: ${detectedProhibitedPhrases.map(p => `"${p}"`).join(", ")}`
    );
  }

  // ── 2. Planning transfer detection ─────────────────────────────────────────
  const detectedTransfer = PLANNING_TRANSFER_SIGNALS.filter(signal =>
    lower.includes(signal)
  );
  const doesNotTransferPlanningToUser = detectedTransfer.length === 0;
  if (!doesNotTransferPlanningToUser) {
    issues.push(
      `Response transfers planning responsibility to the user: "${detectedTransfer[0]}"`
    );
  }

  // ── 3. Capability repetition detection ─────────────────────────────────────
  // A response that only says what the CoS "can" do without doing anything is a failure
  const capabilityClaimsOnly =
    (lower.match(/\bi can\b/g) ?? []).length >= 3 &&
    !NEXT_STEP_SIGNALS.some(signal => lower.includes(signal)) &&
    !INITIAL_ASSESSMENT_SIGNALS.some(signal => lower.includes(signal));
  const doesNotRepeatCapabilityStatement = !capabilityClaimsOnly;
  if (!doesNotRepeatCapabilityStatement) {
    issues.push(
      "Response repeats capability statements ('I can...') without providing an assessment or next step"
    );
  }

  // ── 4. Initial assessment check (broad requests only) ──────────────────────
  const hasInitialAssessment = isBroadRequest
    ? INITIAL_ASSESSMENT_SIGNALS.some(signal => lower.includes(signal))
    : true; // not required for narrow/direct requests
  if (isBroadRequest && !hasInitialAssessment) {
    issues.push(
      "Broad request response lacks an initial assessment — response must contain at least a useful starting answer"
    );
  }

  // ── 5. Recommended next step / ownership (broad requests only) ─────────────
  const hasRecommendedNextStep = isBroadRequest
    ? NEXT_STEP_SIGNALS.some(signal => lower.includes(signal))
    : true; // not required for narrow/direct requests
  if (isBroadRequest && !hasRecommendedNextStep) {
    issues.push(
      "Broad request response lacks a recommended next step or ownership statement — the Chief of Staff must propose what happens next"
    );
  }

  const passed = issues.length === 0;

  return {
    passed,
    issues,
    hasInitialAssessment,
    hasRecommendedNextStep,
    notGenericAssistantLanguage,
    doesNotTransferPlanningToUser,
    doesNotRepeatCapabilityStatement,
    detectedProhibitedPhrases,
  };
}

// ─── Broad request classifier ─────────────────────────────────────────────────

/**
 * Heuristically classifies whether a user message is a broad organisational
 * request (requiring CoS to lead with assessment) vs a narrow direct question.
 *
 * Broad: "What resources do I need?", "How do I set up NeedsOps?", "What should we do about onboarding?"
 * Narrow: "What is the SCHADS Award?", "Is my incident report submitted?", "Cancel that task."
 */
export function classifyAsBroadRequest(userMessage: string): boolean {
  const lower = userMessage.toLowerCase().trim();

  // Short factual queries are not broad
  if (lower.length < 15) return false;

  const broadSignals = [
    "what resources",
    "what do i need",
    "how do i",
    "where do i start",
    "help me",
    "onboard",
    "set up",
    "get started",
    "what should",
    "how should",
    "what are",
    "what's involved",
    "what is involved",
    "what do we",
    "how do we",
    "where should",
    "can you help",
    "i need help with",
    "i'm not sure",
    "i am not sure",
  ];

  return broadSignals.some(signal => lower.includes(signal));
}
