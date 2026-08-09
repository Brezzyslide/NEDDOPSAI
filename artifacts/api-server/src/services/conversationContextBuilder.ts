/**
 * Conversation Context Builder — Sprint 28.5
 *
 * Single authoritative builder for the ConversationContext that the Chief of
 * Staff LLM service consumes. All context components are assembled here in two
 * parallelised rounds before any provider branch runs. No specialist assembles
 * context itself — this is the sole authority.
 *
 * Round 1 (parallel):
 *   buildMessageContext         — task state, approval, plan, proposal flag
 *   buildChiefOfStaffContext    — organisation memory + conversation history
 *   getConversationWorkforceContext — workforce availability
 *   resolveConversationActionState  — current execution / proposal action state
 *
 * Round 2 (conditional):
 *   checkOrganisationLibraryPresence — only when named document terms detected
 *
 * Design constraints:
 *   - Never throws; degraded components are captured in runtime.failedComponents
 *   - Library presence load failure is flagged so the CoS can tell users
 *     "Library could not be checked" rather than silently skipping
 *   - extractDocumentSearchTerms is the single source of truth for named-doc
 *     detection; both builder and LLM service re-export it from this module
 *
 * Note: `extractDocumentSearchTerms` is also re-exported from chiefOfStaffLLMService.ts
 * to preserve the Sprint 28.2 public API surface.
 */

import { buildChiefOfStaffContext, type ChiefOfStaffContextPackage } from "./contextSelectionService.js";
import { buildMessageContext } from "./conversationService.js";
import {
  getConversationWorkforceContext,
  type ConversationWorkforceContext,
} from "./conversationWorkforceContextService.js";
import {
  resolveConversationActionState,
  type ConversationActionState,
} from "./conversationActionStateService.js";
import {
  checkOrganisationLibraryPresence,
  type LibraryPresenceResult,
} from "./organisationLibraryPresenceService.js";
import type { MessageContext } from "./conversationIntelligenceService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildContextInput {
  organisationId: string;
  conversationId: string;
  userId: string;
  currentMessage: string;
  taskId?: string;
  executionId?: string;
}

/**
 * The fully-assembled context that CoS classifyMessageLLM operates on.
 *
 * Both the layered (Sprint 9.2) and legacy prompt builders read exclusively
 * from this object — no service queries the DB inside the builder functions.
 */
export interface ConversationContext {
  /** Basic org identifier + raw profile record (name, status, slug, settings) */
  organisation: {
    id: string;
    profile: Record<string, unknown>;
  };
  /**
   * Full ChiefOfStaffContextPackage from contextSelectionService.
   * Null when the memory load fails — legacy prompt path is used instead.
   */
  memory: ChiefOfStaffContextPackage | null;
  /** Organisation library document presence result (null when not searched) */
  libraryPresence: LibraryPresenceResult | null;
  /** Available AI workforce for this organisation (null on load failure) */
  workforce: ConversationWorkforceContext | null;
  /** Current conversation action state (null on load failure) */
  actionState: ConversationActionState | null;
  /**
   * Conversation metadata + the current user message.
   * Extends MessageContext so it is drop-compatible with legacy classifiers.
   */
  conversation: MessageContext & { latestMessage: string };
  /** Build performance and degradation metadata */
  runtime: {
    isDegraded: boolean;
    buildDurationMs: number;
    failedComponents: string[];
    componentTimings: Record<string, number>;
    /** Named document terms extracted from the current message */
    extractedSearchTerms: string[];
    /** True when library presence was attempted but failed */
    libraryPresenceLoadFailed?: boolean;
  };
  metadata: {
    organisationId: string;
    /** Schema version — bump when ConversationContext shape changes */
    version: "1.0.0";
    taskId?: string;
    executionId?: string;
  };
}

// ─── Named-document term extractor ───────────────────────────────────────────

/**
 * Extract named document phrases from a user message.
 *
 * Scans backwards from each recognised document-type suffix keyword to collect
 * the specific document name that precedes it. Case-insensitive; output is
 * always Title-Case normalised.
 *
 * Examples:
 *   "Review our Medication Management Policy"  → ["Medication Management Policy"]
 *   "Review our incident reporting procedure"  → ["Incident Reporting Procedure"]
 *   "Check the participant's risk assessment"  → ["Risk Assessment"]
 *   "Retrieve the Medication Administration SOP" → ["Medication Administration SOP"]
 *   "Update our policies"                       → []  (no specific name)
 *   "Help me improve our HR processes"          → []  (processes not a suffix)
 *
 * Rules:
 *   1. Suffix keyword detected case-insensitively (policy, procedure, SOP, etc.)
 *   2. Words are collected backwards until a generic stop word, possessive ('s), or
 *      sentence boundary is reached — these act as natural name delimiters.
 *   3. At least one specific (non-generic) word must precede the suffix.
 *   4. Output is Title-Case normalised; all-caps acronyms (SOP, NDIS) are preserved.
 *   5. Results are deduplicated and capped at 5.
 */
export function extractDocumentSearchTerms(text: string): string[] {
  const SUFFIX_SET = new Set([
    "policy", "policies", "procedure", "procedures", "plan", "plans",
    "protocol", "protocols", "standard", "standards", "framework", "frameworks",
    "guide", "guidelines", "guideline", "manual", "handbook",
    "act", "award", "agreement", "code", "charter",
    "assessment", "assessments", "sop", "sops",
  ]);

  // Generic stop words — these do NOT form part of a specific document name.
  // Includes possessive pronouns, articles, determiners, and common subject/object pronouns.
  const GENERIC = new Set([
    // articles, determiners
    "our", "a", "an", "the", "some", "any", "this", "that", "these",
    "those", "your", "my", "its", "their", "all", "each", "every",
    "no", "new", "old", "other", "same", "various",
    // subject / object pronouns (cannot start a document name)
    "i", "me", "we", "us", "you", "he", "him", "she", "her", "it",
    "they", "them", "who", "which",
    // common verbs that appear before suffix words but are NOT doc-name starters
    "and", "help", "please", "let", "can", "will", "need",
    // temporal / contextual adjectives — describe a document's state, NOT its name
    // e.g. "Review our current Incident Management Policy" → "Incident Management Policy"
    // e.g. "Prepare a practical Incident Management Plan" → "Incident Management Plan"
    "current", "existing", "latest", "recent", "updated", "proposed",
    "practical", "applicable", "relevant", "key", "approved", "actual",
    "available", "effective", "required", "specific", "particular",
  ]);

  // Small connector words that can appear in the middle of a doc name but not at the start
  const CONNECTORS = new Set(["of", "for", "in", "on", "at", "to", "and"]);

  function titleCaseWord(word: string, isFirst: boolean): string {
    // Preserve all-caps acronyms (SOP, NDIS, SCHADS…)
    if (/^[A-Z]{2,}$/.test(word)) return word;
    const lower = word.toLowerCase();
    if (!isFirst && CONNECTORS.has(lower)) return lower;
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }

  const rawWords = text.split(/\s+/);
  const results: string[] = [];

  for (let i = 0; i < rawWords.length; i++) {
    // Strip trailing punctuation for suffix matching
    const clean = rawWords[i].replace(/[^a-zA-Z]/g, "");
    if (!clean) continue;

    if (!SUFFIX_SET.has(clean.toLowerCase())) continue;

    // Scan backwards to collect the document name words
    const nameWords: string[] = [clean];
    let j = i - 1;

    while (j >= 0) {
      const prev = rawWords[j];
      // Stop at words containing apostrophes (possessives / contractions like "participant's")
      if (prev.includes("'") || prev.includes("\u2019")) break;

      const prevClean = prev.replace(/[^a-zA-Z]/g, "");
      if (!prevClean) { j--; continue; }

      const prevLower = prevClean.toLowerCase();

      // Stop at generic stop words — they delimit the sentence from the doc name
      if (GENERIC.has(prevLower)) break;

      nameWords.unshift(prevClean);
      j--;
    }

    // Must have at least one specific word before the suffix
    const prefixWords = nameWords.slice(0, -1);
    if (prefixWords.length === 0) continue;
    if (prefixWords.every(w => GENERIC.has(w.toLowerCase()))) continue;

    // Normalise to Title Case
    const normalised = nameWords.map((w, idx) => titleCaseWord(w, idx === 0)).join(" ");
    results.push(normalised);
  }

  return [...new Set(results)].slice(0, 5);
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Assemble the authoritative ConversationContext for CoS LLM classification.
 *
 * Never throws — degraded components are captured in runtime.failedComponents.
 */
export async function buildConversationContext(
  input: BuildContextInput,
): Promise<ConversationContext> {
  const startMs = Date.now();
  const failedComponents: string[] = [];
  const componentTimings: Record<string, number> = {};

  const { organisationId, conversationId, userId, currentMessage, taskId, executionId } = input;

  // ── Round 1a: Parallel assembly (components independent of each other) ────────
  // buildChiefOfStaffContext and getConversationWorkforceContext are fully
  // independent of buildMessageContext output and run concurrently.
  // resolveConversationActionState MUST receive actual recentMessages to detect
  // proposals (task_proposal / plan_proposal message types) — it runs after
  // buildMessageContext resolves (Round 1b).
  const [msgResult, memResult, workforceResult] = await Promise.allSettled([
    measureComponent(componentTimings, "messageContext", () =>
      buildMessageContext(organisationId, conversationId, taskId),
    ),
    measureComponent(componentTimings, "memory", () =>
      buildChiefOfStaffContext({
        organizationId: organisationId,
        conversationId,
        userId,
        taskId,
        currentMessage,
      }),
    ),
    measureComponent(componentTimings, "workforce", () =>
      getConversationWorkforceContext(organisationId),
    ),
  ]);

  const msgCtx: MessageContext | null = msgResult.status === "fulfilled" ? msgResult.value : null;
  const memory: ChiefOfStaffContextPackage | null = memResult.status === "fulfilled" ? memResult.value : null;
  const workforce: ConversationWorkforceContext | null = workforceResult.status === "fulfilled" ? workforceResult.value : null;

  if (msgResult.status === "rejected")       failedComponents.push("messageContext");
  if (memResult.status === "rejected")       failedComponents.push("memory");
  if (workforceResult.status === "rejected") failedComponents.push("workforce");

  // ── Round 1b: Action state (needs recentMessages from buildMessageContext) ────
  // Sprint 28.5: action state resolver uses recentMessages to detect proposal and
  // plan_proposal message types. Passing an empty array would miss those signals.
  const recentMessagesForActionState =
    (msgCtx?.recentMessages as Array<{ messageType: string; content: string }> | undefined) ?? [];

  let actionState: ConversationActionState | null = null;
  try {
    actionState = await measureComponent(componentTimings, "actionState", () =>
      resolveConversationActionState({
        organisationId,
        conversationId,
        recentMessages: recentMessagesForActionState,
        taskId,
        executionIntentId: executionId,
      }),
    );
  } catch {
    failedComponents.push("actionState");
  }

  // ── Extract document search terms from the current message ─────────────────
  const extractedSearchTerms = extractDocumentSearchTerms(currentMessage);

  // ── Round 2: Conditional library presence ──────────────────────────────────
  let libraryPresence: LibraryPresenceResult | null = null;
  let libraryPresenceLoadFailed = false;

  if (extractedSearchTerms.length > 0) {
    const t2 = Date.now();
    try {
      libraryPresence = await checkOrganisationLibraryPresence(organisationId, extractedSearchTerms);
      componentTimings.libraryPresence = Date.now() - t2;
    } catch (err) {
      libraryPresenceLoadFailed = true;
      failedComponents.push("library_presence");
      componentTimings.libraryPresence = Date.now() - t2;
    }
  }

  // ── Build ConversationContext from settled results ─────────────────────────
  const buildDurationMs = Date.now() - startMs;
  const isDegraded = failedComponents.length > 0;

  // Derive the conversation field from msgCtx + the current message
  const conversationField: MessageContext & { latestMessage: string } = {
    conversationId,
    organizationId: organisationId,
    currentTaskId:    msgCtx?.currentTaskId,
    currentTaskState: msgCtx?.currentTaskState,
    currentTaskTitle: msgCtx?.currentTaskTitle,
    currentPlan:      msgCtx?.currentPlan,
    pendingApprovalId: msgCtx?.pendingApprovalId,
    recentMessages:   memory?.recentMessages ?? msgCtx?.recentMessages ?? [],
    proposalExists:   msgCtx?.proposalExists ?? false,
    latestMessage:    currentMessage,
  };

  return {
    organisation: {
      id:      organisationId,
      profile: (memory?.organisationProfile ?? {}) as Record<string, unknown>,
    },
    memory,
    libraryPresence,
    workforce,
    actionState,
    conversation: conversationField,
    runtime: {
      isDegraded,
      buildDurationMs,
      failedComponents,
      componentTimings,
      extractedSearchTerms,
      libraryPresenceLoadFailed,
    },
    metadata: {
      organisationId,
      version:     "1.0.0",
      taskId,
      executionId,
    },
  };
}

// ─── deriveMessageContext ────────────────────────────────────────────────────

/**
 * Map a ConversationContext back to a legacy MessageContext.
 *
 * Used by functions that pre-date ConversationContext and still expect the
 * MessageContext shape (e.g. parseAndValidateLLMResponse). Do not use for
 * new code — read from ConversationContext.conversation directly instead.
 */
export function deriveMessageContext(context: ConversationContext): MessageContext {
  return {
    conversationId:    context.conversation.conversationId,
    organizationId:    context.metadata.organisationId,
    currentTaskId:     context.conversation.currentTaskId,
    currentTaskState:  context.conversation.currentTaskState,
    currentTaskTitle:  context.conversation.currentTaskTitle,
    currentPlan:       context.conversation.currentPlan,
    pendingApprovalId: context.conversation.pendingApprovalId,
    recentMessages:    context.conversation.recentMessages,
    proposalExists:    context.conversation.proposalExists,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function measureComponent<T>(
  timings: Record<string, number>,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t = Date.now();
  try {
    return await fn();
  } finally {
    timings[name] = Date.now() - t;
  }
}
