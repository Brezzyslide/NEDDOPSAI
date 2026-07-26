/**
 * Sprint 9.1 test helpers — shared validation utilities
 *
 * These mirror the validation logic in chiefOfStaffLLMService so tests can
 * exercise the parsing path independently of the full gateway stack.
 */

import { SPECIALISTS } from "../../lib/workforceRegistry.js";
import type { ConversationUnderstanding, MessageContext } from "../../services/conversationIntelligenceService.js";

const VALID_WORKFORCE_ROLES = new Set(SPECIALISTS.map(s => s.code));

const VALID_MODES = new Set([
  "general", "brainstorming", "task_intent", "task_clarification", "task_confirmation",
  "task_followup", "approval_response", "execution_query", "cancellation_request",
  "status_request", "result_followup",
]);

const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const VALID_TASK_ACTIONS = new Set([
  "create", "revise", "approve", "reject", "pause", "resume", "cancel", "status", "follow_up",
]);

/**
 * Parse and validate a raw JSON string from the LLM into a ConversationUnderstanding.
 * This is the same logic as in chiefOfStaffLLMService.parseAndValidateLLMResponse.
 * Exported for use in tests so the validation path can be tested independently.
 *
 * @throws if the JSON is invalid or conversationMode is not in the allowed set
 */
export function parseStructuredResponse(
  content: string,
  ctx: Pick<MessageContext, "conversationId" | "organizationId" | "currentTaskId" | "currentTaskState" | "currentTaskTitle">,
): ConversationUnderstanding {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }

  const mode = raw.conversationMode as string;
  if (!VALID_MODES.has(mode)) {
    throw new Error(`LLM returned invalid conversationMode: "${mode}"`);
  }

  const confidence = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.7;

  const clarificationRequired = raw.clarificationRequired === true;
  const clarificationQuestions = Array.isArray(raw.clarificationQuestions)
    ? (raw.clarificationQuestions as unknown[]).filter(q => typeof q === "string") as string[]
    : [];

  const shouldCreateTask = false; // Always forced to false
  const shouldUpdateTask = raw.shouldUpdateTask === true;

  let proposedTask: ConversationUnderstanding["proposedTask"] | undefined;
  if (raw.proposedTask && typeof raw.proposedTask === "object") {
    const pt = raw.proposedTask as Record<string, unknown>;
    if (typeof pt.title === "string" && pt.title.trim()) {
      proposedTask = {
        title: String(pt.title).slice(0, 120),
        summary: typeof pt.summary === "string" ? pt.summary.slice(0, 500) : "",
        priority: VALID_PRIORITIES.has(pt.priority as string) ? pt.priority as any : "normal",
        requestedOutcome: typeof pt.requestedOutcome === "string" ? pt.requestedOutcome.slice(0, 300) : "",
        knownConstraints: Array.isArray(pt.knownConstraints)
          ? (pt.knownConstraints as unknown[]).filter(c => typeof c === "string").slice(0, 10) as string[]
          : [],
      };
    }
  }

  const rta = raw.requestedTaskAction as string | null;
  const requestedTaskAction = (rta && VALID_TASK_ACTIONS.has(rta)) ? rta as any : undefined;

  const roles = Array.isArray(raw.relatedWorkforceRoles)
    ? (raw.relatedWorkforceRoles as unknown[])
        .filter(r => typeof r === "string" && VALID_WORKFORCE_ROLES.has(r)) as string[]
    : [];

  let customerResponse = typeof raw.customerResponse === "string"
    ? raw.customerResponse.trim()
    : "";
  if (!customerResponse) {
    customerResponse = "I'm here to help. What would you like to do?";
  }

  return {
    conversationMode: mode as ConversationUnderstanding["conversationMode"],
    confidence,
    existingTaskId: ctx.currentTaskId,
    proposedTask,
    clarificationRequired,
    clarificationQuestions,
    shouldCreateTask,
    shouldUpdateTask,
    requestedTaskAction,
    relatedWorkforceRoles: roles.length > 0 ? roles : ["chief_of_staff"],
    customerResponse,
  };
}
