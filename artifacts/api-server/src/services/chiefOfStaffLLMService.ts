/**
 * Chief of Staff LLM Service — Sprint 9.1
 *
 * Replaces the deterministic `classifyMessage()` as the PRIMARY intelligence layer.
 * Uses the AI Privacy Gateway to call OpenAI (or falls back to deterministic).
 *
 * Architecture:
 *   User message + context
 *     → buildGatewayRequest()      build system prompt + user message (no raw PII)
 *     → createAIGateway().process() call through gateway (OpenAI or deterministic fallback)
 *     → parseAndValidate()         parse JSON, validate every field
 *     → deterministicValidation()  verify workforce roles, task state, permissions
 *     → ConversationUnderstanding  return to conversationService
 *
 * If ANY step fails, the service falls back to the deterministic classifyMessage().
 *
 * SECURITY:
 *  - No raw user message is passed to external AI without going through the gateway
 *  - No secrets, credential refs, or platform notes enter prompts
 *  - No tenant data beyond task title/state enters retrieved fields
 *  - The AI proposes; NeedsOps services decide
 */

import { randomUUID } from "crypto";
import { createAIGateway } from "@workspace/ai-gateway";
import type { AIGatewayContext } from "@workspace/ai-gateway";
import {
  classifyMessage,
  type ConversationUnderstanding,
  type MessageContext,
} from "./conversationIntelligenceService.js";
import { SPECIALISTS } from "../lib/workforceRegistry.js";

// ─── Workforce role validation allowlist ──────────────────────────────────────

const VALID_WORKFORCE_ROLES = new Set(SPECIALISTS.map(s => s.code));

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the Chief of Staff at a disability services organisation using NeedsOps AI+.

Your role is to understand what the user is asking, determine whether they need a task created, clarification, or just a helpful conversation, and respond as a thoughtful, professional operations leader.

Context:
- You work in the Australian disability sector under the NDIS Quality and Safeguards Commission
- Common domains: NDIS compliance, SCHADS Award, participant support, incident management, quality standards, workforce management
- You have an AI Workforce of specialists: compliance_officer, quality_officer, operations_officer, hr_officer, finance_officer, chief_of_staff, marketing_officer
- Tasks are formal operational records — you only propose creating one when the user clearly wants action taken

Your output MUST be a single JSON object with these exact fields:

{
  "conversationMode": one of ["general","brainstorming","task_intent","task_clarification","task_confirmation","task_followup","approval_response","execution_query","cancellation_request","status_request","result_followup"],
  "confidence": number between 0.0 and 1.0,
  "clarificationRequired": boolean,
  "clarificationQuestions": array of strings (empty if not required),
  "shouldCreateTask": false (ALWAYS false — you propose, never create),
  "shouldUpdateTask": boolean,
  "proposedTask": {
    "title": string,
    "summary": string,
    "priority": one of ["low","normal","high","urgent"],
    "requestedOutcome": string,
    "knownConstraints": array of strings
  } or null (only include if conversationMode is "task_intent"),
  "requestedTaskAction": one of ["create","revise","approve","reject","pause","resume","cancel","status","follow_up"] or null,
  "relatedWorkforceRoles": array of role codes from ["compliance_officer","quality_officer","operations_officer","hr_officer","finance_officer","chief_of_staff","marketing_officer"],
  "customerResponse": string (your plain-text response to the user — professional, concise, helpful),
  "reasoning": string (brief internal reasoning, not shown to user)
}

Rules:
- shouldCreateTask is ALWAYS false — you cannot create tasks directly
- Informational questions (what is X, how does Y work) → conversationMode "general"
- Casual emotional statements → conversationMode "general" or "brainstorming"
- Clear actionable requests → conversationMode "task_intent" with proposedTask
- Vague actionable intent → conversationMode "task_clarification" with clarificationQuestions
- Approval/rejection keywords in awaiting_approval context → "approval_response"
- Status/progress questions → "status_request"
- Cancellation intent on existing task → "cancellation_request"
- "Try again"/"retry" on failed task → "execution_query" with requestedTaskAction "resume"
- Customer responses must be warm, professional, direct — no bullet lists unless genuinely useful
- Never include secrets, credentials, or internal system details in customerResponse`;

// ─── Conversation modes ───────────────────────────────────────────────────────

const VALID_MODES = new Set([
  "general", "brainstorming", "task_intent", "task_clarification", "task_confirmation",
  "task_followup", "approval_response", "execution_query", "cancellation_request",
  "status_request", "result_followup",
]);

const VALID_PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

const VALID_TASK_ACTIONS = new Set([
  "create", "revise", "approve", "reject", "pause", "resume", "cancel", "status", "follow_up",
]);

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Classify a user message using OpenAI (or deterministic fallback).
 *
 * @param text     The raw user message text
 * @param ctx      Conversation context (task state, recent messages, etc.)
 * @param authCtx  Authenticated user context for gateway auth
 */
export async function classifyMessageLLM(
  text: string,
  ctx: MessageContext,
  authCtx: {
    userId: string;
    organizationId: string;
    role: string;
    permissions: string[];
  },
): Promise<ConversationUnderstanding & { usedFallback?: boolean; fallbackReason?: string }> {
  // If AI_PROVIDER is not openai, skip directly to deterministic
  const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase().trim();
  if (provider !== "openai") {
    return classifyMessage(text, ctx);
  }

  try {
    const gatewayCtx: AIGatewayContext = {
      userId:               authCtx.userId,
      organizationId:       authCtx.organizationId,
      role:                 authCtx.role || "member",
      permissions:          authCtx.permissions,
      purpose:              "conversation_intelligence",
      correlationId:        randomUUID(),
      provider:             "openai",
      retentionClass:       "transient",
      requiresHumanApproval: false,  // AI proposes; user confirms
    };

    const gateway = createAIGateway(gatewayCtx);

    // Build the user message — includes conversation context but no raw PII
    const userMessage = buildUserMessage(text, ctx);

    // Validate retrieved fields (task.id, task.title, task.state if present)
    const retrievedFields: string[] = [];
    if (ctx.currentTaskId)    retrievedFields.push("task.id");
    if (ctx.currentTaskTitle) retrievedFields.push("task.title");
    if (ctx.currentTaskState) retrievedFields.push("task.state");
    if (ctx.conversationId)   retrievedFields.push("conversation.id");
    gateway.validateRetrievedFields(retrievedFields);

    const response = await gateway.process({
      systemPrompt:    SYSTEM_PROMPT,
      userMessage,
      retrievedFields,
      maxTokens:       1200,
    });

    // If the gateway used the fallback internally, the content will be the
    // internal placeholder JSON — fall back to deterministic classifier
    if (response.usedFallback) {
      const deterministic = classifyMessage(text, ctx);
      return {
        ...deterministic,
        usedFallback: true,
        fallbackReason: response.fallbackReason,
      };
    }

    // Parse and validate the structured JSON response
    const parsed = parseAndValidateLLMResponse(response.content, ctx);
    return { ...parsed, usedFallback: false };

  } catch (err) {
    // Any gateway-level error → fall back to deterministic
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[ChiefOfStaffLLM] Fallback to deterministic: ${reason}`);
    const deterministic = classifyMessage(text, ctx);
    return { ...deterministic, usedFallback: true, fallbackReason: reason };
  }
}

// ─── User message builder ─────────────────────────────────────────────────────

function buildUserMessage(text: string, ctx: MessageContext): string {
  const lines: string[] = [];

  // Current task context (no raw PII — titles are operational, not participant data)
  if (ctx.currentTaskId) {
    lines.push(`Current task: "${ctx.currentTaskTitle ?? "Untitled"}" [${ctx.currentTaskState ?? "unknown"}]`);
  }
  if (ctx.pendingApprovalId) {
    lines.push(`There is a pending approval waiting for a decision.`);
  }

  // Recent conversation history (last 8 messages — trimmed for token budget)
  if (ctx.recentMessages && ctx.recentMessages.length > 0) {
    lines.push("\nRecent conversation:");
    const recent = ctx.recentMessages.slice(-8);
    for (const msg of recent) {
      const role = msg.senderType === "user" ? "User" : "Chief of Staff";
      // Truncate long messages for the prompt
      const content = msg.content.length > 200 ? msg.content.slice(0, 200) + "…" : msg.content;
      lines.push(`${role}: ${content}`);
    }
    lines.push("");
  }

  lines.push(`User message: ${text}`);
  return lines.join("\n");
}

// ─── Response parser + validator ──────────────────────────────────────────────

function parseAndValidateLLMResponse(
  content: string,
  ctx: MessageContext,
): ConversationUnderstanding {
  // Parse JSON
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
  }

  // conversationMode
  const mode = raw.conversationMode as string;
  if (!VALID_MODES.has(mode)) {
    throw new Error(`LLM returned invalid conversationMode: "${mode}"`);
  }

  // confidence
  const confidence = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0.7;

  // clarificationRequired + clarificationQuestions
  const clarificationRequired = raw.clarificationRequired === true;
  const clarificationQuestions = Array.isArray(raw.clarificationQuestions)
    ? (raw.clarificationQuestions as unknown[]).filter(q => typeof q === "string") as string[]
    : [];

  // shouldCreateTask — ALWAYS false (AI proposes, never creates)
  const shouldCreateTask = false;
  const shouldUpdateTask = raw.shouldUpdateTask === true;

  // proposedTask
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

  // requestedTaskAction
  const rta = raw.requestedTaskAction as string | null;
  const requestedTaskAction = (rta && VALID_TASK_ACTIONS.has(rta)) ? rta as any : undefined;

  // relatedWorkforceRoles — validate against registry
  const roles = Array.isArray(raw.relatedWorkforceRoles)
    ? (raw.relatedWorkforceRoles as unknown[])
        .filter(r => typeof r === "string" && VALID_WORKFORCE_ROLES.has(r)) as string[]
    : [];

  // customerResponse — must be a non-empty string
  let customerResponse = typeof raw.customerResponse === "string"
    ? raw.customerResponse.trim()
    : "";
  if (!customerResponse) {
    customerResponse = "I'm here to help. What would you like to do?";
  }

  // existingTaskId — carry forward from context (LLM doesn't provide this)
  const existingTaskId = ctx.currentTaskId;

  return {
    conversationMode: mode as ConversationUnderstanding["conversationMode"],
    confidence,
    existingTaskId,
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
