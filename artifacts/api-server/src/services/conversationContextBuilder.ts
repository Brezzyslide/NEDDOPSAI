/**
 * Conversation Context Builder — Sprint 28.5
 *
 * Single authoritative context assembly layer.
 *
 * Every AI employee (Chief of Staff, Operations Manager, Executive Assistant,
 * future specialists) receives a ConversationContext assembled here.
 * No specialist builds its own context.
 *
 * Responsibilities:
 *   ✓ Organisation profile and settings
 *   ✓ Organisation memory (approved, summaries, pinned decisions)
 *   ✓ Organisation library presence
 *   ✓ Live workforce availability
 *   ✓ Conversation action state
 *   ✓ Conversation history and metadata
 *   ✓ Execution capability state
 *
 * NOT responsible for:
 *   ✗ Semantic evidence retrieval (chunk search)
 *   ✗ Executing work
 *   ✗ Assigning specialists
 *   ✗ Creating tasks
 *   ✗ Modifying any state
 *   ✗ Calling LLMs
 *   ✗ Dispatching specialists
 *
 * The builder is strictly read-only.
 */

import type { MessageContext } from "./conversationIntelligenceService.js";
import type { TaskPlan } from "./chiefOfStaffService.js";
import { buildMessageContext } from "./conversationService.js";
import {
  buildChiefOfStaffContext,
  type ChiefOfStaffContextPackage,
  type OrganisationMemoryItem,
  type ConversationMemoryStructured,
  type PinnedDecision,
  type UnresolvedQuestion,
  type ConversationMessage,
  type TaskContext,
  type ApprovalContext,
} from "./contextSelectionService.js";
import {
  getConversationWorkforceContext,
  type ConversationWorkforceContext,
} from "./conversationWorkforceContextService.js";
import {
  checkOrganisationLibraryPresence,
  type LibraryPresenceResult,
} from "./organisationLibraryPresenceService.js";
import {
  resolveConversationActionState,
  type ConversationActionState,
} from "./conversationActionStateService.js";

// ─── Document search term extraction (moved from chiefOfStaffLLMService) ──────
// Extracted here to avoid circular imports — CoS imports from this module.

/**
 * Stop words that interrupt backward scanning for document-name context words.
 */
const DOC_NAME_STOP_WORDS = new Set([
  "our", "the", "your", "a", "an", "this", "that", "any", "some", "all", "its",
  "their", "my", "me", "we", "i", "you", "s",
  "review", "check", "update", "analyse", "analyze", "assess", "prepare", "create",
  "build", "improve", "help", "process", "handle", "submit", "complete", "draft",
  "ensure", "confirm", "verify", "conduct", "perform", "run",
  "with", "and", "or", "in", "of", "for", "to", "is", "are", "was", "were",
  "has", "have", "had", "will", "can", "could", "should", "would", "through",
  "via", "by", "using", "about", "regarding", "on", "at", "from", "as", "into",
  "participant", "staff", "worker", "client", "service",
]);

/** Document type keywords that anchor a document name */
const DOC_TYPE_KEYWORDS = [
  "policy", "policies", "procedure", "procedures", "sop", "standard", "standards",
  "guideline", "guidelines", "protocol", "protocols", "manual", "framework",
  "assessment", "plan", "register", "handbook",
];

/**
 * Lightweight document-requirement detector for conversation use.
 *
 * Extracts explicitly named documents from the user message.
 * Does NOT invent document requirements the user did not mention.
 */
export function extractDocumentSearchTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const terms: string[] = [];

  for (const docType of DOC_TYPE_KEYWORDS) {
    let searchFrom = 0;
    while (true) {
      const idx = lower.indexOf(docType, searchFrom);
      if (idx === -1) break;
      searchFrom = idx + 1;

      const before = idx > 0 ? lower[idx - 1] : " ";
      const after  = idx + docType.length < lower.length ? lower[idx + docType.length] : " ";
      if (/[a-z]/i.test(before) || /[a-z]/i.test(after)) continue;

      const beforeText = text.slice(0, idx).trimEnd();
      const words = beforeText.split(/\s+/).filter(w => w.length > 0);
      const nameTokens: string[] = [];

      for (let i = words.length - 1; i >= 0 && nameTokens.length < 5; i--) {
        const raw = words[i].replace(/[^a-zA-Z'-]/g, "").replace(/['']s$/i, "");
        if (!raw || DOC_NAME_STOP_WORDS.has(raw.toLowerCase())) break;
        nameTokens.unshift(words[i].replace(/[^a-zA-Z''-]/g, "").replace(/['']s$/i, ""));
      }

      if (nameTokens.length >= 1) {
        const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        const phrase = [
          ...nameTokens.map(titleCase),
          titleCase(docType),
        ].join(" ");
        terms.push(phrase);
      }
    }
  }

  const unique = [...new Set(terms)];
  return unique
    .filter(t => !unique.some(other => other !== t && other.toLowerCase().includes(t.toLowerCase())))
    .slice(0, 5);
}

// ─── ConversationContext types ────────────────────────────────────────────────

export interface ConversationOrganisation {
  id: string;
  slug: string;
  name: string;
  /** Raw org record — do not expose to LLM directly; use formatted sections. */
  profile: Record<string, unknown>;
  settings: {
    status: string;
    executionFrozen: boolean;
    loginsDisabled: boolean;
    subscriptionTier: string | null;
  };
}

export interface ConversationMemoryContext {
  approvedOrganisationMemory: OrganisationMemoryItem[];
  conversationSummary: ConversationMemoryStructured;
  pinnedDecisions: PinnedDecision[];
  unresolvedQuestions: UnresolvedQuestion[];
  relevantHistoricalMessages: ConversationMessage[];
  /** Large-window recent messages for layered prompt (from CoS context package). */
  recentMessages: ConversationMessage[];
  currentTasks: TaskContext[];
  currentApprovals: ApprovalContext[];
  contextWarnings: string[];
  tokenEstimate: number;
  historyStats: { totalAvailable: number; sent: number; summarised: number };
}

export interface ConversationData {
  id: string;
  /** Short-window recent messages for action state and MessageContext compat. */
  recentMessages: Array<{ senderType: string; content: string; messageType: string }>;
  latestMessage: string;
  pendingProposal: boolean;
  currentTaskId: string | null;
  currentTaskTitle: string | null;
  currentTaskState: string | null;
  pendingApprovalId: string | null;
  currentPlan: TaskPlan | null;
  /** Phase 2: resolved when executionId is provided. */
  currentExecution: null;
}

export interface ExecutionCapabilities {
  frozen: boolean;
  loginsDisabled: boolean;
}

export interface ContextRuntimeMetadata {
  buildDurationMs: number;
  componentsLoaded: string[];
  componentTimings: Record<string, number>;
  cacheHits: string[];
  cacheMisses: string[];
  failedComponents: string[];
  fallbacksUsed: string[];
  isDegraded: boolean;
  componentErrors: Record<string, string>;
  extractedSearchTerms: string[];
  /** True when search terms were extracted but the library check threw an error. */
  libraryPresenceLoadFailed: boolean;
}

export interface ConversationContextMetadata {
  organisationId: string;
  conversationId: string;
  userId: string;
  taskId: string | null;
  executionId: string | null;
  builtAt: string;
  version: string;
}

/**
 * Immutable context snapshot for one AI employee turn.
 * Assembled by buildConversationContext — never assembled inside an employee.
 */
export interface ConversationContext {
  organisation: ConversationOrganisation;
  /**
   * Organisation memory, conversation summaries, and historical context.
   * Null when the CoS context package could not be loaded (degraded mode).
   */
  memory: ConversationMemoryContext | null;
  /** Null when no named documents were detected or the check failed. */
  libraryPresence: LibraryPresenceResult | null;
  /** Null when the workforce service could not be reached. */
  workforce: ConversationWorkforceContext | null;
  /** Null when action state resolution failed. */
  actionState: ConversationActionState | null;
  executionCapabilities: ExecutionCapabilities;
  conversation: ConversationData;
  /** Reserved for Phase 2: per-participant profile injection. */
  participantContext: null;
  /** Reserved for Phase 2: blueprint execution context. */
  blueprintContext: null;
  runtime: ContextRuntimeMetadata;
  metadata: ConversationContextMetadata;
}

// ─── Builder input ────────────────────────────────────────────────────────────

export interface BuildContextInput {
  organisationId: string;
  conversationId: string;
  userId: string;
  currentMessage: string;
  taskId?: string;
  executionId?: string;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Assemble a ConversationContext for one AI employee turn.
 *
 * Parallelism:
 *   Round 1 (concurrent): message context, CoS package, workforce, library presence
 *   Round 2 (after round 1): action state (requires recent messages)
 *
 * Failure behaviour:
 *   Individual component failures degrade the context rather than failing the
 *   whole request. Each failure is recorded in runtime.failedComponents and
 *   runtime.componentErrors. The returned context has null/empty in the failed
 *   field and isDegraded=true.
 */
export async function buildConversationContext(
  input: BuildContextInput,
): Promise<ConversationContext> {
  const buildStart = Date.now();
  const { organisationId, conversationId, userId, currentMessage, taskId, executionId } = input;

  // ── Observability state ───────────────────────────────────────────────────
  const runtime: ContextRuntimeMetadata = {
    buildDurationMs: 0,
    componentsLoaded: [],
    componentTimings: {},
    cacheHits: [],
    cacheMisses: [],
    failedComponents: [],
    fallbacksUsed: [],
    isDegraded: false,
    componentErrors: {},
    extractedSearchTerms: [],
    libraryPresenceLoadFailed: false,
  };

  const markLoaded = (component: string, startMs: number) => {
    runtime.componentTimings[component] = Date.now() - startMs;
    if (!runtime.componentsLoaded.includes(component)) {
      runtime.componentsLoaded.push(component);
    }
  };

  const markFailed = (component: string, error: unknown) => {
    if (!runtime.failedComponents.includes(component)) {
      runtime.failedComponents.push(component);
    }
    runtime.isDegraded = true;
    runtime.componentErrors[component] = error instanceof Error ? error.message : String(error);
  };

  // Extract search terms now (pure function — no I/O cost)
  const searchTerms = extractDocumentSearchTerms(currentMessage);
  runtime.extractedSearchTerms = searchTerms;

  // ── Round 1: Independent components — all in parallel ─────────────────────

  const [msgResult, cosResult, wfResult, libResult] = await Promise.allSettled([
    // messageContext — task state, plan, pending approval, short-window messages
    (async () => {
      const t = Date.now();
      const ctx = await buildMessageContext(organisationId, conversationId, taskId);
      markLoaded("messageContext", t);
      return ctx;
    })(),

    // cosPackage — org profile, org memory, conversation summaries, large-window messages
    (async () => {
      const t = Date.now();
      const pkg = await buildChiefOfStaffContext({
        organizationId: organisationId,
        conversationId,
        userId,
        taskId,
        currentMessage,
      });
      markLoaded("cosPackage", t);
      return pkg;
    })(),

    // workforce — live specialist availability (has its own 30s cache)
    (async () => {
      const t = Date.now();
      const ctx = await getConversationWorkforceContext(organisationId);
      markLoaded("workforce", t);
      return ctx;
    })(),

    // libraryPresence — named document check (skipped when no terms found)
    (async () => {
      if (searchTerms.length === 0) return null;
      const t = Date.now();
      const result = await checkOrganisationLibraryPresence(organisationId, searchTerms);
      markLoaded("libraryPresence", t);
      return result;
    })(),
  ]);

  // Process round 1 results
  let messageCtx: MessageContext | null = null;
  if (msgResult.status === "fulfilled") {
    messageCtx = msgResult.value;
  } else {
    markFailed("messageContext", msgResult.reason);
    runtime.fallbacksUsed.push("messageContext:empty");
  }

  let cosPackage: ChiefOfStaffContextPackage | null = null;
  if (cosResult.status === "fulfilled") {
    cosPackage = cosResult.value;
  } else {
    markFailed("cosPackage", cosResult.reason);
    runtime.fallbacksUsed.push("cosPackage:null");
  }

  let workforceCtx: ConversationWorkforceContext | null = null;
  if (wfResult.status === "fulfilled") {
    workforceCtx = wfResult.value;
  } else {
    markFailed("workforce", wfResult.reason);
    runtime.fallbacksUsed.push("workforce:null");
  }

  let libraryPresence: LibraryPresenceResult | null = null;
  if (libResult.status === "fulfilled") {
    libraryPresence = libResult.value;
  } else {
    if (searchTerms.length > 0) {
      // Only flag as failed when we actually tried the lookup
      markFailed("libraryPresence", libResult.reason);
      runtime.libraryPresenceLoadFailed = true;
      runtime.fallbacksUsed.push("libraryPresence:failure");
    }
  }

  // ── Round 2: Action state (requires recent messages from round 1) ─────────
  let actionState: ConversationActionState | null = null;
  {
    const t = Date.now();
    try {
      actionState = await resolveConversationActionState({
        organisationId,
        conversationId,
        recentMessages: (messageCtx?.recentMessages ?? []).map(m => ({
          messageType: m.messageType,
          content: m.content,
        })),
        taskId,
        executionIntentId: executionId,
      });
      markLoaded("actionState", t);
    } catch (e) {
      markFailed("actionState", e);
      runtime.fallbacksUsed.push("actionState:null");
    }
  }

  runtime.buildDurationMs = Date.now() - buildStart;

  // ── Assemble the immutable ConversationContext ────────────────────────────

  const orgProfile = cosPackage?.organisationProfile ?? {};

  const organisation: ConversationOrganisation = {
    id: organisationId,
    slug: (orgProfile.slug as string) ?? "",
    name: (orgProfile.name as string) ?? "",
    profile: orgProfile,
    settings: {
      status: (orgProfile.status as string) ?? "active",
      executionFrozen: Boolean(orgProfile.executionFrozen),
      loginsDisabled: Boolean(orgProfile.loginsDisabled),
      subscriptionTier: (orgProfile.subscriptionTier as string | null) ?? null,
    },
  };

  const memory: ConversationMemoryContext | null = cosPackage
    ? {
        approvedOrganisationMemory: cosPackage.approvedOrganisationMemory,
        conversationSummary:        cosPackage.conversationSummary,
        pinnedDecisions:            cosPackage.pinnedDecisions,
        unresolvedQuestions:        cosPackage.unresolvedQuestions,
        relevantHistoricalMessages: cosPackage.relevantHistoricalMessages,
        recentMessages:             cosPackage.recentMessages,
        currentTasks:               cosPackage.currentTasks,
        currentApprovals:           cosPackage.currentApprovals,
        contextWarnings:            cosPackage.contextWarnings,
        tokenEstimate:              cosPackage.tokenEstimate,
        historyStats:               cosPackage.historyStats,
      }
    : null;

  const conversationData: ConversationData = {
    id:                 conversationId,
    recentMessages:     messageCtx?.recentMessages ?? [],
    latestMessage:      currentMessage,
    pendingProposal:    messageCtx?.proposalExists ?? false,
    currentTaskId:      messageCtx?.currentTaskId    ?? null,
    currentTaskTitle:   messageCtx?.currentTaskTitle ?? null,
    currentTaskState:   messageCtx?.currentTaskState ?? null,
    pendingApprovalId:  messageCtx?.pendingApprovalId ?? null,
    currentPlan:        (messageCtx?.currentPlan ?? null) as TaskPlan | null,
    currentExecution:   null,
  };

  return {
    organisation,
    memory,
    libraryPresence,
    workforce: workforceCtx,
    actionState,
    executionCapabilities: {
      frozen:          Boolean(orgProfile.executionFrozen),
      loginsDisabled:  Boolean(orgProfile.loginsDisabled),
    },
    conversation: conversationData,
    participantContext: null,
    blueprintContext:   null,
    runtime,
    metadata: {
      organisationId,
      conversationId,
      userId,
      taskId:      taskId      ?? null,
      executionId: executionId ?? null,
      builtAt:     new Date().toISOString(),
      version:     "1.0.0",
    },
  };
}

/**
 * Derive a legacy MessageContext from a ConversationContext.
 * Used to maintain compatibility with classifyMessage (deterministic classifier)
 * and parseAndValidateLLMResponse without changing their signatures.
 */
export function deriveMessageContext(context: ConversationContext): MessageContext {
  return {
    conversationId:    context.conversation.id,
    organizationId:    context.organisation.id,
    currentTaskId:     context.conversation.currentTaskId    ?? undefined,
    currentTaskState:  context.conversation.currentTaskState ?? undefined,
    currentTaskTitle:  context.conversation.currentTaskTitle ?? undefined,
    currentPlan:       context.conversation.currentPlan      ?? undefined,
    pendingApprovalId: context.conversation.pendingApprovalId ?? undefined,
    recentMessages:    context.conversation.recentMessages,
    proposalExists:    context.conversation.pendingProposal,
  };
}
