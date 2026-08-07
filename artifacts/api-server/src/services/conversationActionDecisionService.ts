/**
 * Conversation Action Decision Service — Sprint 29H.2
 *
 * After the Chief of Staff classifies a user message, this service resolves a
 * deterministic typed platform operation. It is the boundary between
 * "what the user seems to want" and "what the platform will do".
 *
 * Architecture invariant (Part G):
 *   User → CoS → ConversationActionDecision → dispatch → UEE → specialist
 *
 * Historical completed work is context, not an execution lock.
 */

import type { ConversationActionState } from "./conversationActionStateService.js";
import type { ConversationUnderstanding } from "./conversationIntelligenceService.js";

// ─── Decision type ────────────────────────────────────────────────────────────

export type ActionDecisionType =
  | "respond"             // Conversational reply; no platform operation
  | "view_existing"       // Surface link/reference to existing completedWork
  | "summarise_existing"  // Discuss/summarise existing completedWork
  | "approve_existing"    // Approval workflow against existing completedWork
  | "revise_existing"     // Revision execution linked to existing completedWork
  | "rerun_existing"      // New execution; historical work preserved as-is
  | "create_new_work";    // New task + new execution; no prior work

export interface ConversationActionDecision {
  /** The deterministic platform operation to perform. */
  action: ActionDecisionType;

  /**
   * The completedWork record that this decision operates on (if any).
   * For view/summarise/approve/revise/rerun, this is the historical record.
   */
  completedWorkId?: string;

  /** The task this decision is scoped to (if any). */
  taskId?: string;

  /**
   * Whether the platform should create a new task record.
   * Replaces the LLM's informational shouldCreateTask field.
   */
  shouldCreateTask: boolean;

  /**
   * Whether the platform should dispatch specialist execution.
   * Replaces the LLM's informational shouldDispatchSpecialists field.
   */
  shouldDispatchSpecialist: boolean;

  /** Machine-readable reason code for audit and diagnostics. */
  reasonCode: string;
}

// ─── Rerun signal vocabulary ──────────────────────────────────────────────────

/**
 * Keyword phrases that signal an explicit request for a new execution even
 * when historical completed work exists in the conversation.
 *
 * These ALWAYS override task_followup classification — the user's explicit
 * phrasing takes precedence over conversational context.
 */
const RERUN_KEYWORDS: readonly string[] = [
  "again",
  "redo",
  "re-do",
  "re-run",
  "rerun",
  "replace",
  "new review",
  "new improvement plan",
  "new plan",
  "new execution",
  "new operations manager",
  "latest approved",
  "latest evidence",
  "this is a new",
  "not a request to show",
  "not to show",
  "do not use the existing",
  "do not use the previous",
  "do not use prior",
  "fresh review",
  "fresh analysis",
  "produce a new",
  "create a new",
];

/**
 * Returns true if the user's message contains an explicit signal for a new
 * execution, even when historical completed work exists.
 */
export function hasRerunSignal(
  text: string,
  rta: string | undefined,
  shouldDispatchSpecialists: boolean | undefined,
  conversationMode: string | undefined,
): boolean {
  const lower = text.toLowerCase();
  if (RERUN_KEYWORDS.some(k => lower.includes(k))) return true;
  if (rta === "resume" || rta === "create") return true;
  // shouldDispatchSpecialists=true from LLM is a soft rerun signal when combined
  // with a dispatch-oriented mode. It alone is not sufficient — require a mode check.
  if (
    shouldDispatchSpecialists === true &&
    (conversationMode === "task_intent" || conversationMode === "task_followup")
  ) return true;
  return false;
}

// ─── Decision builder helper ──────────────────────────────────────────────────

function decision(
  action: ActionDecisionType,
  shouldCreateTask: boolean,
  shouldDispatchSpecialist: boolean,
  reasonCode: string,
  completedWorkId?: string,
  taskId?: string,
): ConversationActionDecision {
  return { action, completedWorkId, taskId, shouldCreateTask, shouldDispatchSpecialist, reasonCode };
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve the deterministic platform operation after CoS LLM classification.
 *
 * Decision order (first matching rule wins):
 *   1. View/inspect modes       → view_existing (no dispatch)
 *   2. Approval mode            → approve_existing (status-aware)
 *   3. Explicit revise RTA      → revise_existing (dispatch with revision context)
 *   4. Explicit rerun signals   → rerun_existing | create_new_work
 *   5. task_intent mode         → rerun_existing | create_new_work
 *   6. task_followup + work     → summarise_existing (no dispatch)
 *   7. Default                  → respond
 *
 * @param text        Raw user message text (for rerun keyword detection)
 * @param understanding CoS LLM classification output
 * @param actionState   DB-grounded conversation action state
 */
export function resolveActionDecision(
  text: string,
  understanding: ConversationUnderstanding & {
    shouldDispatchSpecialists?: boolean;
    requestedTaskAction?: string;
  },
  actionState: ConversationActionState,
): ConversationActionDecision {
  const { completedWork } = actionState;
  const mode = understanding.conversationMode;
  const rta = understanding.requestedTaskAction;
  const hasExistingWork = !!completedWork;
  const cwId = completedWork?.id;
  const taskId = actionState.taskId;

  // ── 1. View / inspect intent ───────────────────────────────────────────────
  // These modes are purely informational and must never trigger a new execution.
  if (
    mode === "result_followup" ||
    mode === "status_request" ||
    mode === "execution_query"
  ) {
    return hasExistingWork
      ? decision("view_existing", false, false, "mode_view_existing", cwId, taskId)
      : decision("respond", false, false, "mode_view_no_work");
  }

  // ── 2. Approval intent ─────────────────────────────────────────────────────
  // Approval action must check persisted status — never assume awaiting_approval.
  if (mode === "approval_response") {
    return hasExistingWork
      ? decision("approve_existing", false, false, "mode_approve_existing", cwId, taskId)
      : decision("respond", false, false, "mode_approve_no_work");
  }

  // ── 3. Explicit revision intent ────────────────────────────────────────────
  // requestedTaskAction === "revise" takes precedence over generic followup.
  if (rta === "revise" && hasExistingWork) {
    return decision("revise_existing", false, true, "rta_revise_existing", cwId, taskId);
  }

  // ── 4. Explicit rerun / replacement signals ────────────────────────────────
  // Text signals override conversational classification. "Review again" should
  // always dispatch even inside a task_followup conversation.
  if (hasRerunSignal(text, rta, understanding.shouldDispatchSpecialists, mode)) {
    return hasExistingWork
      ? decision("rerun_existing", false, true, "rerun_signal_existing", cwId, taskId)
      : decision("create_new_work", true, true, "rerun_signal_no_existing");
  }

  // ── 5. task_intent — user wants new work regardless of historical state ────
  if (mode === "task_intent") {
    return hasExistingWork
      ? decision("rerun_existing", false, true, "task_intent_existing", cwId, taskId)
      : decision("create_new_work", true, true, "task_intent_no_existing");
  }

  // ── 6. task_followup with existing work — discuss; no new execution ────────
  if (mode === "task_followup" && hasExistingWork) {
    return decision("summarise_existing", false, false, "followup_with_existing", cwId, taskId);
  }

  // ── 7. General conversation — no dispatch ──────────────────────────────────
  return decision("respond", false, false, "default_respond");
}
