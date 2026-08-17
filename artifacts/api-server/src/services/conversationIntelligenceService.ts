/**
 * Conversation Intelligence Service — Sprint 9
 *
 * Provider-independent intent recognition and Chief of Staff response generation.
 * All classification is deterministic (keyword + rule-based).
 * No LLM or external AI is called directly from this service.
 *
 * Architecture:
 *   User message → classifyMessage() → ConversationUnderstanding
 *   ConversationUnderstanding + context → buildChiefOfStaffResponse() → string + structuredContent
 *
 * Validation of permissions, task state, and transitions is done by deterministic
 * services (taskService, approvalService). The LLM layer (future) may propose intent
 * but never mutates state directly.
 */

import type { TaskPlan } from "./chiefOfStaffService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConversationUnderstanding {
  conversationMode:
    | "general"
    | "brainstorming"
    | "task_intent"
    | "task_clarification"
    | "task_confirmation"
    | "task_followup"
    | "approval_response"
    | "execution_query"
    | "cancellation_request"
    | "status_request"
    | "result_followup";
  confidence: number;                    // 0–1
  existingTaskId?: string;
  proposedTask?: {
    title: string;
    summary: string;
    priority: "low" | "normal" | "high" | "urgent";
    requestedOutcome: string;
    knownConstraints: string[];
  };
  clarificationRequired: boolean;
  clarificationQuestions: string[];
  shouldCreateTask: boolean;
  shouldUpdateTask: boolean;
  requestedTaskAction?:
    | "create"
    | "revise"
    | "approve"
    | "reject"
    | "pause"
    | "resume"
    | "cancel"
    | "status"
    | "follow_up";
  relatedWorkforceRoles: string[];
  customerResponse: string;             // suggested plain-text reply from Chief of Staff
}

export interface MessageContext {
  conversationId: string;
  organizationId: string;
  currentTaskId?: string;
  currentTaskState?: string;
  currentTaskTitle?: string;
  currentPlan?: TaskPlan | null;
  pendingApprovalId?: string;
  recentMessages?: Array<{ senderType: string; content: string; messageType: string }>;
  participantRoles?: string[];
  /** Sprint 28.4: true when a task_proposal or plan_proposal message exists in the conversation */
  proposalExists?: boolean;
}

export interface StructuredContent {
  type:
    | "task_proposal"
    | "plan_proposal"
    | "approval_request"
    | "clarification_request"
    | "execution_update"
    | "task_created"
    | "status_summary"
    | "result_summary"
    | "follow_up_prompt"
    // Sprint 9.4 — Capability gate cards
    | "capability_blocked"
    | "capability_partial"
    // Sprint 10 — Specialist updates posted to workroom
    | "specialist_update";
  data: Record<string, unknown>;
}

// ─── Keyword patterns ─────────────────────────────────────────────────────────

// High-confidence action verbs that signal an actionable task request
const ACTION_VERBS = [
  "review", "prepare", "check", "create", "update", "write", "draft",
  "send", "schedule", "audit", "analyse", "analyze", "investigate",
  "organise", "organize", "coordinate", "submit", "complete", "process",
  "assess", "evaluate", "report", "document", "implement", "resolve",
  "remediate", "fix", "build", "develop", "establish", "set up",
  "remind", "notify", "open", "close", "approve", "request",
  "add", "remove", "assign", "change", "update", "modify",
];

// Patterns that signal an informational question (not a task)
const INFORMATIONAL_PATTERNS = [
  /^what (is|are|does|do)\b/i,
  /^how (do|does|can|should)\b/i,
  /^(tell me|explain|describe|define)\b/i,
  /^(can you|could you) (tell me|explain|describe|help me understand)\b/i,
  /^(what|when|where|who|why|how) (is|are|was|were)\b/i,
];

// Patterns that signal brainstorming / exploratory thinking
const EXPLORATORY_PATTERNS = [
  /i('m| am) (thinking|considering|wondering|unsure)\b/i,
  /\b(not sure|don't know|do you think|what would you)\b/i,
  /\b(options?|ideas?|approaches?|alternatives?|thoughts?)\b/i,
  /^(help me think|can we discuss|let's talk about|brainstorm)\b/i,
];

// Patterns that signal confirmation of a proposed action
const CONFIRMATION_PATTERNS = [
  /^(yes|yeah|yep|sure|ok|okay|go ahead|confirm|proceed|do it|create it|let's do it|sounds good|approved)\b/i,
  /^(please|can you) (go ahead|proceed|create|do it)\b/i,
];

// Patterns that signal approval intent
const APPROVAL_PATTERNS = [
  /\b(approve|approved|sign off|authorise|authorize|give the go.ahead|yes approve|approve that)\b/i,
];

// Patterns that signal rejection intent
const REJECTION_PATTERNS = [
  /\b(reject|decline|deny|no don't|don't proceed|stop|not yet|hold off)\b/i,
];

// Status request patterns
const STATUS_PATTERNS = [
  /\b(what('s| is) (happening|the status|going on|the progress|next)|where are we|how is it going|update me|any update|what are you waiting for|is it done|has it)\b/i,
  /\b(status|progress|update|what's next)\b/i,
  /\b(why (is|was|are|has it|did it)|what (went wrong|failed|happened|caused))\b/i,
  /\b(did it|has it been|is it|was it) (complet|done|finish|approv|start|run|fail|cancel|reject|approv)/i,
  /\bwhat happened\b/i,
];

// Cancellation patterns
const CANCELLATION_PATTERNS = [
  /\b(cancel|stop|abort|terminate|kill|end|shut down) (the |this )?(task|job|execution|process)\b/i,
];

// Pause / resume patterns
const PAUSE_PATTERNS  = [/\b(pause|hold|suspend|put on hold)\b/i];
const RESUME_PATTERNS = [/\b(resume|continue|unpause|restart|carry on|proceed)\b/i];

// Retry patterns (for failed tasks)
const RETRY_PATTERNS = [/\b(try again|retry|try it again|have another go|retry the task)\b/i];

// Domain keywords mapped to current v2 workforce role codes.
// Sprint 28.3: replaced deprecated v1 codes (compliance_officer, quality_officer,
// policy_officer, operations_officer, hr_officer, marketing_officer) with the
// canonical v2 catalogue codes. The deterministic path no longer produces
// obsolete role codes that cannot be dispatched.
const DOMAIN_ROLE_MAP: Array<{ keywords: string[]; roles: string[] }> = [
  { keywords: ["compliance", "audit", "ndis", "regulatory", "registration", "safeguard"],
    roles: ["compliance_quality_manager"] },
  { keywords: ["policy", "policies", "procedure", "practice", "framework"],
    roles: ["compliance_quality_manager", "operations_manager"] },
  { keywords: ["incident", "accident", "injury", "near miss", "behaviour support", "restrictive"],
    roles: ["incident_safeguarding_specialist", "compliance_quality_manager"] },
  { keywords: ["quality", "standard", "benchmark", "corrective action"],
    roles: ["compliance_quality_manager"] },
  { keywords: ["roster", "shift", "schedule", "coverage", "coverage gap", "vacancy", "staff allocation", "worker allocation"],
    roles: ["workforce_rostering_coordinator"] },
  { keywords: ["service delivery", "service gap", "planned vs actual", "delivery fidelity", "support implementation"],
    roles: ["service_delivery_coordinator"] },
  { keywords: ["worker screening", "police check", "wwcc", "credential", "credentials", "clearance", "worker eligibility", "deployment eligibility", "credential expiry", "mandatory evidence", "compliance exception"],
    roles: ["workforce_compliance_specialist"] },
  { keywords: ["capacity", "headcount", "operations", "resource planning"],
    roles: ["operations_manager"] },
  { keywords: ["payroll", "wages", "pay run", "timesheet", "overtime", "penalty rate", "allowance", "schads", "award rate", "workforce cost", "labour cost", "labor cost", "shift cost"],
    roles: ["payroll_workforce_cost_officer"] },
  { keywords: ["invoice", "billing", "budget", "finance", "expenditure"],
    roles: ["finance_officer"] },
  { keywords: ["recruit", "hiring", "performance review", "training", "hr policy", "people culture"],
    roles: ["people_culture_manager", "workforce_compliance_specialist"] },
  { keywords: ["marketing", "campaign", "social media", "brand", "content"],
    roles: ["marketing_communications_manager"] },
  { keywords: ["document", "report", "draft", "email", "letter", "knowledge base"],
    roles: ["knowledge_documentation_specialist", "chief_of_staff"] },
  { keywords: ["sharepoint", "sharpoint", "crm", "system", "database"],
    roles: ["operations_manager"] },
];

// ─── Intent classification ─────────────────────────────────────────────────────

function detectRoles(text: string): string[] {
  const lower = text.toLowerCase();
  const roles = new Set<string>();
  for (const { keywords, roles: r } of DOMAIN_ROLE_MAP) {
    if (keywords.some(kw => lower.includes(kw))) {
      r.forEach(role => roles.add(role));
    }
  }
  // Always add Chief of Staff as coordinator if any specialist is assigned
  if (roles.size > 0) roles.add("chief_of_staff");
  return Array.from(roles);
}

function hasActionVerb(text: string): boolean {
  // Use word-boundary matching so "audits" doesn't match verb "audit",
  // "complete" as question ("did it complete?") doesn't create a new task, etc.
  return ACTION_VERBS.some(v => {
    const regex = new RegExp(`\\b${v.replace(/\s+/g, "\\s+")}\\b`, "i");
    return regex.test(text);
  });
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some(p => p.test(text));
}

function buildProposedTask(
  text: string,
  roles: string[],
): ConversationUnderstanding["proposedTask"] {
  // Heuristic: first sentence or first 120 chars as title
  const sentences = text.split(/[.!?]+/);
  const rawTitle = (sentences[0] ?? text).trim();
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  return {
    title: title.length > 120 ? title.slice(0, 117) + "…" : title,
    summary: text.length > 200 ? text.slice(0, 197) + "…" : text,
    priority: "normal",
    requestedOutcome: `Complete: ${title}`,
    knownConstraints: [],
  };
}

/**
 * Sprint 28.2: pattern to detect a specific document name in the user's message.
 * Matches "Medication Management Policy", "incident reporting procedure", etc.
 * Used to suppress the generic "which policies?" clarification question when the
 * user has already named the document.
 */
const SPECIFIC_DOC_NAME_PATTERN = /\b[A-Za-z][A-Za-z\s]{2,50}\s+(policy|policies|procedure|procedures|sop|standard|standards|guideline|guidelines|protocol|protocols|manual|framework|assessment|plan|register|handbook)\b/i;

function buildClarificationQuestions(
  text: string,
  roles: string[],
  namedDocTerms?: string[],
): string[] {
  const lower = text.toLowerCase();
  const questions: string[] = [];

  if (lower.includes("audit") && !lower.includes("registration group")) {
    questions.push("Which registration groups are in scope for this audit?");
  }
  if ((lower.includes("audit") || lower.includes("deadline")) && !lower.match(/\b(next (week|month|quarter|year)|by \w+|due \w+|before \w+)\b/)) {
    questions.push("When is the deadline or target date?");
  }
  if (lower.includes("document") && !lower.match(/\bsharep|onedrive|google drive|folder|location\b/)) {
    questions.push("Where is the relevant documentation currently stored?");
  }

  // Sprint 28.2: Skip "which policies?" when:
  //   (a) namedDocTerms were detected by extractDocumentSearchTerms, OR
  //   (b) the message itself contains a specific document name pattern.
  // The user has already named the document — asking "which?" is redundant and wrong.
  const userNamedSpecificDoc =
    (namedDocTerms && namedDocTerms.length > 0) ||
    SPECIFIC_DOC_NAME_PATTERN.test(text);

  if (
    (lower.includes("policy") || lower.includes("procedure")) &&
    !lower.includes("which") &&
    !userNamedSpecificDoc
  ) {
    questions.push("Which specific policies or procedures should be included?");
  }

  return questions;
}

// ─── Main classifier ──────────────────────────────────────────────────────────

export function classifyMessage(
  text: string,
  ctx: MessageContext,
  namedDocTerms?: string[],
): ConversationUnderstanding {
  const hasTask = !!ctx.currentTaskId;
  const taskState = ctx.currentTaskState;

  // 1. Cancellation
  if (matchesAny(CANCELLATION_PATTERNS, text)) {
    return {
      conversationMode: "cancellation_request",
      confidence: 0.9,
      existingTaskId: ctx.currentTaskId,
      clarificationRequired: !hasTask,
      clarificationQuestions: hasTask ? [] : ["Which task would you like to cancel?"],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      requestedTaskAction: "cancel",
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: hasTask
        ? `I can cancel the task "${ctx.currentTaskTitle}". Please confirm — this cannot be undone.`
        : "Which task would you like to cancel?",
    };
  }

  // 2. Status request
  if (matchesAny(STATUS_PATTERNS, text)) {
    return {
      conversationMode: "status_request",
      confidence: 0.85,
      existingTaskId: ctx.currentTaskId,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      requestedTaskAction: "status",
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: buildStatusResponse(ctx),
    };
  }

  // 3. Confirmation of a previous proposal
  if (matchesAny(CONFIRMATION_PATTERNS, text)) {
    const prevMsg = ctx.recentMessages?.slice().reverse().find(
      m => m.messageType === "task_proposal" || m.messageType === "plan_proposal"
    );
    if (prevMsg) {
      return {
        conversationMode: "task_confirmation",
        confidence: 0.9,
        existingTaskId: ctx.currentTaskId,
        clarificationRequired: false,
        clarificationQuestions: [],
        shouldCreateTask: !ctx.currentTaskId,
        shouldUpdateTask: !!ctx.currentTaskId,
        requestedTaskAction: ctx.currentTaskId ? "approve" : "create",
        relatedWorkforceRoles: ["chief_of_staff"],
        customerResponse: ctx.currentTaskId
          ? "Plan approved. I will proceed."
          : "Task created. I am preparing the work plan now.",
      };
    }
  }

  // 4. Approval response (when task awaiting_approval)
  if (taskState === "awaiting_approval" && matchesAny(APPROVAL_PATTERNS, text)) {
    return {
      conversationMode: "approval_response",
      confidence: 0.88,
      existingTaskId: ctx.currentTaskId,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: true,
      requestedTaskAction: "approve",
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: "Approval received. I will confirm and proceed with the authorised action.",
    };
  }

  // 5. Rejection response
  if (taskState === "awaiting_approval" && matchesAny(REJECTION_PATTERNS, text)) {
    return {
      conversationMode: "approval_response",
      confidence: 0.85,
      existingTaskId: ctx.currentTaskId,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: true,
      requestedTaskAction: "reject",
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: "Understood. I will not proceed with that action. Would you like to revise the plan?",
    };
  }

  // 6. Pause / resume
  if (matchesAny(PAUSE_PATTERNS, text) && hasTask) {
    return {
      conversationMode: "execution_query",
      confidence: 0.8,
      existingTaskId: ctx.currentTaskId,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      requestedTaskAction: "pause",
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: "I will pause the task. The workforce will stop work at the next safe checkpoint.",
    };
  }

  if (matchesAny(RESUME_PATTERNS, text) && hasTask && (taskState === "queued" || taskState === "approved")) {
    return {
      conversationMode: "execution_query",
      confidence: 0.8,
      existingTaskId: ctx.currentTaskId,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      requestedTaskAction: "resume",
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: "Resuming the task now.",
    };
  }

  // 7a. Retry — for failed tasks only
  if ((matchesAny(RETRY_PATTERNS, text) || (text.trim().toLowerCase() === "try again.") || (text.trim().toLowerCase() === "try again"))
    && hasTask && taskState === "failed") {
    return {
      conversationMode: "execution_query",
      confidence: 0.85,
      existingTaskId: ctx.currentTaskId,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      requestedTaskAction: "resume",
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: "I will retry the task. The workforce will start from the last safe checkpoint.",
    };
  }

  // 7. Informational question — not a task
  if (matchesAny(INFORMATIONAL_PATTERNS, text) && !hasActionVerb(text)) {
    return {
      conversationMode: "general",
      confidence: 0.8,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      relatedWorkforceRoles: ["chief_of_staff"],
      customerResponse: buildInformationalResponse(text),
    };
  }

  // 8. Exploratory / brainstorming — not immediately actionable
  if (matchesAny(EXPLORATORY_PATTERNS, text)) {
    return {
      conversationMode: "brainstorming",
      confidence: 0.72,
      clarificationRequired: false,
      clarificationQuestions: [],
      shouldCreateTask: false,
      shouldUpdateTask: false,
      relatedWorkforceRoles: detectRoles(text),
      customerResponse: buildBrainstormingResponse(text),
    };
  }

  // 9. Task intent — actionable request
  if (hasActionVerb(text)) {
    const roles = detectRoles(text);
    const clarQuestions = buildClarificationQuestions(text, roles, namedDocTerms);
    const hasSufficientInfo = clarQuestions.length === 0;
    const confidence = hasSufficientInfo ? 0.82 : 0.65;

    if (hasTask && taskState && !["completed", "cancelled", "failed"].includes(taskState)) {
      // Message is about an existing active task
      return {
        conversationMode: "task_followup",
        confidence: 0.75,
        existingTaskId: ctx.currentTaskId,
        clarificationRequired: clarQuestions.length > 0,
        clarificationQuestions: clarQuestions,
        shouldCreateTask: false,
        shouldUpdateTask: true,
        requestedTaskAction: "revise",
        relatedWorkforceRoles: roles,
        customerResponse: `I understand you want to refine the current task. ${clarQuestions.length > 0 ? clarQuestions[0] : "What changes would you like to make?"}`,
      };
    }

    if (hasSufficientInfo) {
      return {
        conversationMode: "task_intent",
        confidence,
        proposedTask: buildProposedTask(text, roles),
        clarificationRequired: false,
        clarificationQuestions: [],
        shouldCreateTask: false, // still need user confirmation
        shouldUpdateTask: false,
        relatedWorkforceRoles: roles,
        customerResponse: buildTaskProposalResponse(text, roles),
      };
    } else {
      return {
        conversationMode: "task_clarification",
        confidence,
        proposedTask: buildProposedTask(text, roles),
        clarificationRequired: true,
        clarificationQuestions: clarQuestions,
        shouldCreateTask: false,
        shouldUpdateTask: false,
        relatedWorkforceRoles: roles,
        customerResponse: buildClarificationResponse(text, clarQuestions),
      };
    }
  }

  // 10. Default — general conversation
  return {
    conversationMode: "general",
    confidence: 0.5,
    // Carry forward existingTaskId when a task is in context, even for general messages
    existingTaskId: ctx.currentTaskId,
    clarificationRequired: false,
    clarificationQuestions: [],
    shouldCreateTask: false,
    shouldUpdateTask: false,
    relatedWorkforceRoles: ["chief_of_staff"],
    customerResponse: buildGeneralResponse(text, ctx),
  };
}

// ─── Response builders ────────────────────────────────────────────────────────

function buildStatusResponse(ctx: MessageContext): string {
  const { currentTaskTitle, currentTaskState, currentPlan } = ctx;
  if (!currentTaskTitle) {
    return "There is no active task in this conversation. Would you like to create one?";
  }

  const stateMessages: Record<string, string> = {
    draft: `The task "${currentTaskTitle}" has been drafted. The Chief of Staff is reviewing the scope.`,
    queued: `The task "${currentTaskTitle}" is queued and will begin shortly.`,
    planning: `I am currently preparing the work plan for "${currentTaskTitle}".`,
    awaiting_approval: `The task "${currentTaskTitle}" is waiting for your approval before the workforce can proceed.`,
    approved: `The task "${currentTaskTitle}" has been approved and is ready to begin execution.`,
    executing: `The task "${currentTaskTitle}" is currently being worked on by your AI workforce.`,
    completed: `The task "${currentTaskTitle}" has been completed. You can review the outputs above.`,
    cancelled: `The task "${currentTaskTitle}" was cancelled.`,
    failed: `The task "${currentTaskTitle}" encountered an error. I can provide details or help you retry.`,
  };

  return stateMessages[currentTaskState ?? ""] ?? `The task "${currentTaskTitle}" is in state: ${currentTaskState}.`;
}

function buildTaskProposalResponse(text: string, roles: string[]): string {
  const roleNames = roles
    .filter(r => r !== "chief_of_staff")
    .map(r => r.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()))
    .slice(0, 3);

  const task = buildProposedTask(text, roles);
  const roleList = roleNames.length > 0
    ? `\n\nI recommend involving:\n${roleNames.map(r => `• ${r}`).join("\n")}`
    : "";

  return `This looks like a formal task request.\n\nProposed task:\n${task.title}${roleList}\n\nWould you like me to create the task and prepare the work plan?`;
}

function buildClarificationResponse(text: string, questions: string[]): string {
  return `I can help with that. Before I create a task, I need a few details:\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`;
}

function buildBrainstormingResponse(text: string): string {
  return "Happy to think this through with you. Tell me more about what you are trying to achieve — I can help identify the best approach, the workforce roles to involve, and when it makes sense to formalise this as a task.";
}

function buildInformationalResponse(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("ndis") || lower.includes("audit")) {
    return "I can provide guidance on that topic. For a detailed review or any formal action, I can also create a task for your compliance or quality officer. What would be most helpful?";
  }
  if (lower.includes("policy") || lower.includes("procedure")) {
    return "I can discuss policy and procedure matters with you. If you need a formal review or update, I can coordinate that through a task. What specifically would you like to know?";
  }
  return "Happy to help with that. Could you share a bit more context so I can give you a useful answer?";
}

function buildGeneralResponse(text: string, ctx: MessageContext): string {
  if (ctx.currentTaskId && ctx.currentTaskState) {
    const stateLabel = ctx.currentTaskState.replace(/_/g, " ");
    return `I'm here to help. The current task is ${stateLabel}. What would you like to do next?`;
  }
  return "Happy to help. You can describe a task, ask a question, or we can think through something together.";
}

// ─── Structured content builders ─────────────────────────────────────────────

export function buildTaskProposalCard(understanding: ConversationUnderstanding): StructuredContent | null {
  if (!understanding.proposedTask) return null;
  return {
    type: "task_proposal",
    data: {
      title: understanding.proposedTask.title,
      summary: understanding.proposedTask.summary,
      priority: understanding.proposedTask.priority,
      requestedOutcome: understanding.proposedTask.requestedOutcome,
      knownConstraints: understanding.proposedTask.knownConstraints,
      suggestedRoles: understanding.relatedWorkforceRoles,
      actions: ["create_task", "continue_discussing"],
    },
  };
}

export function buildPlanCard(plan: TaskPlan, taskId: string): StructuredContent {
  return {
    type: "plan_proposal",
    data: {
      taskId,
      planId: plan.planId,
      intent: plan.intent,
      primarySpecialist: plan.primarySpecialist,
      assignedSpecialists: plan.assignedSpecialists,
      steps: plan.steps,
      estimatedTotalDuration: plan.estimatedTotalDuration,
      requiresApproval: plan.requiresApproval,
      approvalType: plan.approvalType,
      confidence: plan.confidence,
      reasoning: plan.reasoning,
      actions: ["approve_plan", "request_changes", "ask_question", "cancel_task"],
    },
  };
}

export function buildApprovalCard(approvalId: string, taskId: string, detail: {
  requestedAction: string;
  requestingRole: string;
  reason: string;
  riskLevel: "low" | "medium" | "high";
  approvalType: string;
}): StructuredContent {
  return {
    type: "approval_request",
    data: {
      approvalId,
      taskId,
      ...detail,
      actions: ["approve", "reject", "request_changes", "ask_more"],
    },
  };
}

export function buildClarificationCard(question: string, reason: string, requestedBy: string, blocking: boolean): StructuredContent {
  return {
    type: "clarification_request",
    data: {
      question,
      reason,
      requestedBy,
      blocking,
      expectedResponseType: "text",
      actions: ["reply"],
    },
  };
}

export function buildExecutionUpdateCard(event: {
  eventType: string;
  stepName?: string;
  stepNumber?: number;
  totalSteps?: number;
  specialistCode?: string;
  specialistName?: string;
  message?: string;
  timestamp: string;
}): StructuredContent {
  const humanMessages: Record<string, string> = {
    "execution.accepted":   "The task has been accepted by the runtime.",
    "execution.started":    "Work has begun.",
    "execution.step_started":   `${event.specialistName ?? "The workforce"} started: ${event.stepName ?? "next step"}.`,
    "execution.step_completed": `Step ${event.stepNumber ?? ""} completed: ${event.stepName ?? "step finished"}.`,
    "execution.awaiting_approval": "Work is paused. Approval is required before continuing.",
    "execution.paused":     "Work is paused.",
    "execution.resumed":    "Work has resumed.",
    "execution.completed":  "The task is complete.",
    "execution.failed":     "An error occurred during execution.",
    "execution.cancelled":  "Execution has been cancelled.",
  };
  return {
    type: "execution_update",
    data: {
      eventType: event.eventType,
      humanMessage: humanMessages[event.eventType] ?? event.message ?? "Execution update received.",
      stepNumber: event.stepNumber,
      totalSteps: event.totalSteps,
      specialistName: event.specialistName,
      timestamp: event.timestamp,
    },
  };
}

export function buildStatusSummaryCard(ctx: MessageContext): StructuredContent {
  return {
    type: "status_summary",
    data: {
      taskId: ctx.currentTaskId,
      taskTitle: ctx.currentTaskTitle,
      taskState: ctx.currentTaskState,
      pendingApprovalId: ctx.pendingApprovalId,
      participantRoles: ctx.participantRoles ?? [],
    },
  };
}
