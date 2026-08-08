/**
 * executionClassifierService — Sprint 29M
 *
 * Three-lane execution routing gate that sits between CoS classification and
 * the UEE work-product lifecycle.  Prevents trivial conversational requests from
 * entering the full Completed Work / approval / evidence pipeline.
 *
 * Lanes:
 *   TRANSIENT          — stays in Chat; no Completed Work, no approval, no provenance.
 *   PROFESSIONAL_WORK  — UEE, Completed Work, versioning, approval per blueprint rules;
 *                        evidence retrieval is NOT automatically required.
 *   EVIDENCE_BEARING   — full UEE + KRS / EvidencePack, Sprint 29K claims, semantic
 *                        entailment, absence verification, Completed Work, version pinning.
 *
 * Design principles:
 *   - Composes existing signals; does NOT introduce a second classification LLM call.
 *   - Never downgrades task-triggered execution below PROFESSIONAL_WORK (Amendment 2).
 *   - Uses multi-signal scoring, not single-keyword matching (Amendment 1).
 *   - Exposes telemetry fields so performance evidence (Amendment 7) can be measured.
 */

// NOTE: extractDocumentSearchTerms is intentionally NOT called inside the classifier.
// The context builder already computes the search terms (references to existing org documents)
// and passes them in via extractedSearchTerms.  Re-running the extractor on the raw request
// text produces false positives: "draft an onboarding procedure" → "Onboarding Procedure" as
// a search term, making the classifier think a document was referenced when none was.

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionClass = "transient" | "professional_work" | "evidence_bearing";

export type ExecutionTrigger = "conversation" | "task" | "scheduled" | "workflow";

/**
 * Signals fed into the classifier.  All fields come from already-computed results
 * (CoS LLM classification + context builder) — no extra DB or LLM calls.
 */
export interface ExecutionClassifierInput {
  /** Raw user message text. */
  userRequest: string;
  /** CoS-classified conversation mode. */
  conversationMode: string;
  /** Proposed task object from CoS (null when purely conversational). */
  proposedTask: Record<string, unknown> | null;
  /** CoS overall confidence score [0, 1]. */
  confidence: number;
  /** True when CoS recommends immediate specialist dispatch. */
  shouldDispatchSpecialists: boolean;
  /** Document search terms already extracted by conversationContextBuilder. */
  extractedSearchTerms: string[];
  /** Blueprint-derived evidence mode (when a blueprint is already resolved). */
  blueprintEvidenceMode?: "required" | "optional" | "none";
  /** Execution trigger — non-conversation triggers are never TRANSIENT. */
  trigger?: ExecutionTrigger;
}

export interface ExecutionClassification {
  executionClass: ExecutionClass;
  reason: string;
  requiresCompletedWork: boolean;
  requiresEvidence: boolean;
  requiresClaimIntegrity: boolean;
  requiresApproval: boolean;
  /** Telemetry: signals that contributed to the classification decision. */
  signals: {
    conversationMode: string;
    trigger: string;
    hasDocumentReferences: boolean;
    documentTermCount: number;
    hasProposedTask: boolean;
    shouldDispatchSpecialists: boolean;
    blueprintEvidenceMode: string;
    transientOutputScore: number;
    evidenceOutputScore: number;
    transientModeDetected: boolean;
  };
}

// ─── Mode tables ──────────────────────────────────────────────────────────────

/**
 * Conversation modes that are inherently conversational and never produce
 * durable work-product on their own.  A message in one of these modes
 * should stay in Chat unless document references or explicit output signals
 * override the classification.
 */
const TRANSIENT_CONVERSATION_MODES = new Set([
  "general",
  "brainstorming",
  "status_request",
  "task_followup",
  "execution_query",
  "approval_response",
  "cancellation_request",
]);

/**
 * Modes that indicate an explicit intent to create professional work output.
 * These require at minimum PROFESSIONAL_WORK routing.
 */
const WORK_INTENT_MODES = new Set([
  "task_intent",
  "task_confirmation",
  "task_clarification",
]);

// ─── Regex patterns ──────────────────────────────────────────────────────────

/**
 * Output patterns that indicate a lightweight, transient deliverable.
 * Matching one of these is a negative signal against PROFESSIONAL_WORK,
 * but can be overridden by document references or evidence signals.
 */
const TRANSIENT_OUTPUT_PATTERNS: RegExp[] = [
  // Written communication artefacts that stay in Chat.
  // NOTE: bare "response" is intentionally EXCLUDED — it is too ambiguous
  // ("check if our response followed the correct steps" must not match).
  // Keep only contextualised forms: "quick response", "draft a response", etc.
  /\b(email|e-mail|quick\s+email|draft\s+(?:an?\s+)?email|write\s+(?:an?\s+)?email|send\s+(?:an?\s+)?email|message|short\s+message|note|quick\s+note|memo|notification|reminder|reply|quick\s+response|brief\s+response|draft\s+(?:an?\s+)?response|write\s+(?:an?\s+)?response)\b/i,
  // Rewriting / editing tasks — no durable output needed
  /\b(rewrite|rephrase|reword|improve\s+(?:this|my|the)\s+\w+|edit\s+(?:this|my|the)|polish|refine|paraphrase|restructure\s+(?:this|my|the))\b/i,
  // Ideation and brainstorming — results belong in Chat
  /\b(brainstorm|brainstorming|generate\s+ideas|ideas\s+for|suggestions\s+for|alternatives\s+to|options\s+for|list\s+(?:of\s+)?(?:ideas|options|ways|reasons)|think\s+of\s+(?:some|a\s+few))\b/i,
  // Simple explanations and lookups
  /\b(explain|what\s+(?:is|are|does|do)|how\s+(?:does|do|would|can)|tell\s+me\s+(?:about|how|what)|describe\s+(?:what|how))\b/i,
  // Short creative output
  /\b(title|tagline|subject\s+line|caption|bullet\s+points?|quick\s+summary|brief\s+overview|one.line)\b/i,
];

/**
 * Output patterns that indicate serious, evidence-dependent professional output.
 * Matching one of these escalates toward EVIDENCE_BEARING (especially when
 * combined with document references).
 */
const EVIDENCE_OUTPUT_PATTERNS: RegExp[] = [
  // Formal investigation and review artefacts
  /\b(incident\s+(?:report|investigation|review|analysis)|root\s+cause\s+analysis|post.?incident\s+review|PIR)\b/i,
  // Policy and compliance work
  /\b(policy\s+(?:review|gap|audit|analysis|compliance)|compliance\s+(?:review|audit|assessment|gap|check)|regulatory\s+(?:review|compliance|assessment))\b/i,
  // Risk and formal assessment
  /\b(risk\s+(?:assessment|analysis|register|review)|gap\s+analysis|impact\s+assessment|formal\s+(?:assessment|review|report))\b/i,
  // Audits and governance
  /\b(audit\s+(?:report|trail|finding|recommendation)|governance\s+(?:review|assessment)|regulatory\s+(?:finding|breach|non.?compliance))\b/i,
  // Document comparison — includes adjectives between quantifier and document type
  // e.g. "review our leave policy", "check the current procedures"
  /\b(compare\s+(?:our|the|this)\s+\w+|review\s+(?:our|the|this)(?:\s+\w+){0,2}\s+(?:policy|procedure|protocol|standard|framework|guideline)|check\s+(?:our|the|this)(?:\s+\w+){0,1}\s+(?:policy|procedure|protocol))\b/i,
  // Behaviour support, care plans (regulated)
  /\b(behaviour\s+support\s+plan|BSP|care\s+plan|support\s+plan\s+(?:review|update|assessment))\b/i,
];

/**
 * Output patterns that indicate professional durable output (but not necessarily
 * evidence-bearing) — e.g., procedure drafts, plans, proposals.
 */
const PROFESSIONAL_OUTPUT_PATTERNS: RegExp[] = [
  /\b(procedure|SOP|standard\s+operating\s+procedure|operational\s+procedure|work\s+instruction)\b/i,
  /\b(onboarding\s+(?:plan|procedure|guide|checklist|process)|induction\s+plan)\b/i,
  /\b(project\s+plan|implementation\s+plan|action\s+plan|strategic\s+plan|rollout\s+plan|transition\s+plan)\b/i,
  /\b(business\s+proposal|executive\s+brief|briefing\s+(?:document|note|paper)|board\s+(?:paper|report|brief))\b/i,
  /\b(policy\s+draft|draft\s+policy|policy\s+document|performance\s+review|appraisal|probation\s+review)\b/i,
  /\b(meeting\s+minutes|minutes\s+of\s+(?:the\s+)?meeting|decision\s+register|change\s+request)\b/i,
];

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function scorePatterns(text: string, patterns: RegExp[]): number {
  return patterns.reduce((score, p) => score + (p.test(text) ? 1 : 0), 0);
}

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a conversation-triggered request into one of three execution lanes.
 *
 * Rules are applied in priority order:
 *   1. Non-conversation triggers → PROFESSIONAL_WORK minimum (tasks never downgrade).
 *   2. Blueprint mandates EVIDENCE_BEARING → EVIDENCE_BEARING.
 *   3. Purely conversational modes + no escalating signals → TRANSIENT.
 *   4. Document references + work intent mode → EVIDENCE_BEARING.
 *   5. High evidence-output score → EVIDENCE_BEARING.
 *   6. Transient output intent + no document refs + no work-output signals → TRANSIENT.
 *   7. Work intent mode with proposed task or dispatch signal → PROFESSIONAL_WORK.
 *   8. Default for anything with work intent but ambiguous output type → PROFESSIONAL_WORK.
 */
export function classifyExecutionRequest(
  input: ExecutionClassifierInput,
): ExecutionClassification {
  const {
    userRequest,
    conversationMode,
    proposedTask,
    shouldDispatchSpecialists,
    extractedSearchTerms,
    blueprintEvidenceMode,
    trigger = "conversation",
  } = input;

  const hasDocumentReferences = extractedSearchTerms.length > 0;
  const hasProposedTask = proposedTask !== null && proposedTask !== undefined;
  const isConversationTrigger = trigger === "conversation";
  const isTransientMode = TRANSIENT_CONVERSATION_MODES.has(conversationMode);
  const isWorkIntentMode = WORK_INTENT_MODES.has(conversationMode);

  // Use only the pre-computed extractedSearchTerms (from conversationContextBuilder).
  // Do NOT re-run extractDocumentSearchTerms on the raw request text — it would
  // produce false positives ("draft an onboarding procedure" → "Onboarding Procedure").
  const documentTermCount = extractedSearchTerms.length;
  const hasAnyDocRef = documentTermCount > 0;

  const transientScore = scorePatterns(userRequest, TRANSIENT_OUTPUT_PATTERNS);
  const evidenceScore = scorePatterns(userRequest, EVIDENCE_OUTPUT_PATTERNS);
  const professionalScore = scorePatterns(userRequest, PROFESSIONAL_OUTPUT_PATTERNS);

  const signals = {
    conversationMode,
    trigger,
    hasDocumentReferences: hasAnyDocRef,
    documentTermCount,
    hasProposedTask,
    shouldDispatchSpecialists,
    blueprintEvidenceMode: blueprintEvidenceMode ?? "none",
    transientOutputScore: transientScore,
    evidenceOutputScore: evidenceScore,
    transientModeDetected: isTransientMode,
  };

  // ── Rule 1: Non-conversation triggers never downgrade to TRANSIENT ───────────
  if (!isConversationTrigger) {
    // Blueprint-mandated evidence escalation applies here too (Amendment 2)
    if (blueprintEvidenceMode === "required" || evidenceScore >= 1 || hasAnyDocRef) {
      return {
        executionClass: "evidence_bearing",
        reason: `Task-triggered execution with evidence signals (blueprintEvidenceMode=${blueprintEvidenceMode ?? "none"}, evidenceScore=${evidenceScore}, docRefs=${documentTermCount})`,
        requiresCompletedWork: true,
        requiresEvidence: true,
        requiresClaimIntegrity: true,
        requiresApproval: true,
        signals,
      };
    }
    return {
      executionClass: "professional_work",
      reason: `Task-triggered execution routes at minimum PROFESSIONAL_WORK (trigger=${trigger})`,
      requiresCompletedWork: true,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: true,
      signals,
    };
  }

  // ── Rule 2: Blueprint hard-mandates evidence ────────────────────────────────
  if (blueprintEvidenceMode === "required") {
    return {
      executionClass: "evidence_bearing",
      reason: "Blueprint output type mandates evidence-grounded findings (blueprintEvidenceMode=required)",
      requiresCompletedWork: true,
      requiresEvidence: true,
      requiresClaimIntegrity: true,
      requiresApproval: true,
      signals,
    };
  }

  // ── Rule 3a: Brainstorming is always TRANSIENT unless evidence signals present ─
  // In brainstorming mode, professional-sounding keywords describe the *topic*, not
  // the output type ("brainstorm ideas for improving our onboarding process" is Chat,
  // not an onboarding procedure document).
  if (
    conversationMode === "brainstorming" &&
    !hasAnyDocRef &&
    !shouldDispatchSpecialists &&
    evidenceScore === 0
  ) {
    return {
      executionClass: "transient",
      reason: "Brainstorming mode with no document references or evidence signals — output stays in Chat",
      requiresCompletedWork: false,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: false,
      signals,
    };
  }

  // ── Rule 3b: Other conversational modes with no escalating signals → TRANSIENT ─
  // Unlike brainstorming, other transient modes (status_request, task_followup, etc.)
  // can include explicit professional output requests — check professionalScore.
  if (
    isTransientMode &&
    conversationMode !== "brainstorming" &&
    !hasAnyDocRef &&
    !shouldDispatchSpecialists &&
    evidenceScore === 0 &&
    professionalScore === 0
  ) {
    return {
      executionClass: "transient",
      reason: `Conversational mode (${conversationMode}) with no document references, no specialist dispatch, no professional output signals`,
      requiresCompletedWork: false,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: false,
      signals,
    };
  }

  // ── Rule 4: Document references in a work-intent context → EVIDENCE_BEARING ─
  // Even a work-intent mode that explicitly references org documents likely needs
  // the full evidence pipeline to ground its claims.
  if (hasAnyDocRef && isWorkIntentMode && evidenceScore >= 1) {
    return {
      executionClass: "evidence_bearing",
      reason: `Document references (${documentTermCount} terms) combined with evidence-output patterns (score=${evidenceScore}) in ${conversationMode} mode`,
      requiresCompletedWork: true,
      requiresEvidence: true,
      requiresClaimIntegrity: true,
      requiresApproval: true,
      signals,
    };
  }

  // ── Rule 5: Any evidence-output pattern match in work-intent context → EVIDENCE_BEARING ──
  // "Do a gap analysis", "conduct a compliance review", etc. — even a single evidence
  // pattern match is sufficient to escalate in a work-intent context.
  if (evidenceScore >= 1 && isWorkIntentMode) {
    return {
      executionClass: "evidence_bearing",
      reason: `High evidence-output signal score (${evidenceScore}) in ${conversationMode} mode`,
      requiresCompletedWork: true,
      requiresEvidence: true,
      requiresClaimIntegrity: true,
      requiresApproval: true,
      signals,
    };
  }

  // ── Rule 5b: Any evidence score + doc refs (even in transient mode) ─────────
  // "Can you check our leave policy and summarise the key rules?" is task_followup/general
  // but references a named document → escalate.
  if (evidenceScore >= 1 && hasAnyDocRef) {
    return {
      executionClass: "evidence_bearing",
      reason: `Evidence-output pattern (score=${evidenceScore}) combined with document references (${documentTermCount} terms)`,
      requiresCompletedWork: true,
      requiresEvidence: true,
      requiresClaimIntegrity: true,
      requiresApproval: true,
      signals,
    };
  }

  // ── Rule 5c: Transient output in non-work-intent mode beats professional keywords ──
  // "What is a performance review?" — "performance review" fires professionalScore but
  // the question form "what is" wins.  Only applies outside work-intent modes and when
  // there is no proposed task (which would imply deliberate creation intent).
  if (
    transientScore >= 1 &&
    !hasAnyDocRef &&
    evidenceScore === 0 &&
    !shouldDispatchSpecialists &&
    !hasProposedTask &&
    !isWorkIntentMode
  ) {
    return {
      executionClass: "transient",
      reason: `Transient output intent (score=${transientScore}) in non-work-intent mode — professionalScore ignored (${professionalScore}) because the request is explanatory, not creative`,
      requiresCompletedWork: false,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: false,
      signals,
    };
  }

  // ── Rule 6: Transient output intent with no escalating signals → TRANSIENT ──
  // "Write me an email to the team about the office closure next Friday"
  // — transientScore fires, no doc refs, no evidence patterns, work-intent mode.
  // Amendment 8: a "professionally worded" request doesn't escalate unless content signals do.
  if (
    transientScore >= 1 &&
    !hasAnyDocRef &&
    evidenceScore === 0 &&
    professionalScore === 0 &&
    !shouldDispatchSpecialists &&
    !hasProposedTask
  ) {
    return {
      executionClass: "transient",
      reason: `Transient output type detected (score=${transientScore}): request produces a lightweight deliverable that stays in Chat`,
      requiresCompletedWork: false,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: false,
      signals,
    };
  }

  // ── Rule 6b: Transient + no doc refs + no professional output, even with proposedTask ──
  // "Write an email to welcome our new HR manager" → proposedTask may exist but output is Chat.
  if (
    transientScore >= 1 &&
    !hasAnyDocRef &&
    evidenceScore === 0 &&
    professionalScore === 0 &&
    !shouldDispatchSpecialists &&
    // If proposedTask has explicit professional outcome signal, don't downgrade
    !isProfessionalProposedTask(proposedTask)
  ) {
    return {
      executionClass: "transient",
      reason: `Transient output type (score=${transientScore}) with no document references or professional output signals — stays in Chat`,
      requiresCompletedWork: false,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: false,
      signals,
    };
  }

  // ── Rule 7: Work intent mode with dispatch or professional output → PROFESSIONAL_WORK ──
  if (isWorkIntentMode || shouldDispatchSpecialists || professionalScore >= 1) {
    // Escalate to evidence_bearing if doc refs present
    if (hasAnyDocRef) {
      return {
        executionClass: "evidence_bearing",
        reason: `Professional work intent (${conversationMode}) with document references (${documentTermCount} terms) — escalating to evidence_bearing`,
        requiresCompletedWork: true,
        requiresEvidence: true,
        requiresClaimIntegrity: false, // Optional unless blueprintEvidenceMode=required
        requiresApproval: true,
        signals,
      };
    }
    return {
      executionClass: "professional_work",
      reason: `Work intent mode (${conversationMode}) with professional output signals (professionalScore=${professionalScore}, dispatchSpecialists=${shouldDispatchSpecialists})`,
      requiresCompletedWork: true,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: true,
      signals,
    };
  }

  // ── Rule 8: Default for conversational modes with doc refs but no evidence output ──
  // "What does our HR handbook say about annual leave?" (general mode, doc ref, no evidence pattern)
  // → treat as professional_work so the KRS can retrieve the document and inform the response.
  if (hasAnyDocRef) {
    return {
      executionClass: "professional_work",
      reason: `Document references present (${documentTermCount} terms) but no evidence-output signals — routing as PROFESSIONAL_WORK for KRS access`,
      requiresCompletedWork: false, // No durable output needed for a question
      requiresEvidence: true,  // KRS retrieval is still valuable
      requiresClaimIntegrity: false,
      requiresApproval: false,
      signals,
    };
  }

  // ── Rule 9: Catch-all — anything with proposed task but no other signals ────
  if (hasProposedTask) {
    return {
      executionClass: "professional_work",
      reason: `Proposed task exists with no clear transient signals — defaulting to PROFESSIONAL_WORK`,
      requiresCompletedWork: true,
      requiresEvidence: false,
      requiresClaimIntegrity: false,
      requiresApproval: true,
      signals,
    };
  }

  // ── Rule 10: Everything else is TRANSIENT ────────────────────────────────────
  return {
    executionClass: "transient",
    reason: `No work-product signals detected — treating as conversational (mode=${conversationMode})`,
    requiresCompletedWork: false,
    requiresEvidence: false,
    requiresClaimIntegrity: false,
    requiresApproval: false,
    signals,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when the proposedTask's requestedOutcome or title contains
 * professional output signals, preventing a downgrade to TRANSIENT even when
 * transient output patterns fire on the user request text.
 */
function isProfessionalProposedTask(
  proposedTask: Record<string, unknown> | null,
): boolean {
  if (!proposedTask) return false;
  const text = [
    String(proposedTask.title ?? ""),
    String(proposedTask.requestedOutcome ?? ""),
    String(proposedTask.summary ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  return (
    PROFESSIONAL_OUTPUT_PATTERNS.some(p => p.test(text)) ||
    EVIDENCE_OUTPUT_PATTERNS.some(p => p.test(text))
  );
}

/**
 * Convenience guard: returns true when the classification does NOT require
 * the Completed Work / approval / provenance pipeline.
 */
export function isTransientRequest(classification: ExecutionClassification): boolean {
  return classification.executionClass === "transient";
}
