/**
 * Conversation Control Service — Sprint 33J.1
 *
 * Deterministic control layer for conversational state mutations. The LLM may
 * interpret wording, but this service decides whether a message can cancel,
 * pause, resume, approve, reject, switch focus, answer a checkpoint, or create
 * unrelated work.
 */

import { randomUUID } from "crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  approvalsTable,
  conversationMessagesTable,
  tasksTable,
} from "@workspace/db";
import type { TaskState } from "@workspace/shared";
import {
  cancelCheckpoint,
  getActiveCheckpointByConversation,
  type ActiveCheckpoint,
} from "./executionCheckpointService.js";
import { resolveApprovalWithAuthority } from "./approvalService.js";
import { cancelTask, getTaskById, recordTaskModification, transitionTaskState } from "./taskService.js";
import { getMembershipForUser } from "./membershipService.js";
import { dispatchWorkExecution } from "./executionCoordinatorService.js";
import { cancelTaskExecution } from "./executionService.js";
import { logOrgEvent } from "./auditService.js";

export type CanonicalConversationAction =
  | "NEW_TASK"
  | "CONTINUE_TASK"
  | "MODIFY_TASK"
  | "CLARIFICATION"
  | "ANSWER_TO_PENDING_QUESTION"
  | "PROVIDE_EVIDENCE"
  | "CORRECT_INFORMATION"
  | "CANCEL_TASK"
  | "PAUSE_TASK"
  | "RESUME_TASK"
  | "APPROVE_ACTION"
  | "REJECT_ACTION"
  | "STATUS_QUERY"
  | "SWITCH_TASK"
  | "GENERAL_QUESTION"
  | "NEW_UNRELATED_REQUEST";

export interface ConversationFocus {
  taskId?: string;
  entityId?: string;
  workType?: string;
  artifactId?: string;
  updatedAt: string;
  reason: string;
  source: "conversation" | "workroom" | "explicit_switch" | "state_change";
}

export interface TaskReferenceCandidate {
  taskId: string;
  title: string;
  state: string;
  score: number;
  reason: string;
}

export interface ConversationResolution {
  intent: CanonicalConversationAction;
  resolvedTaskId?: string;
  resolvedApprovalId?: string;
  confidence: number;
  ambiguity: "none" | "low" | "material";
  candidateTasks: TaskReferenceCandidate[];
  requiresClarification: boolean;
  reason: string;
}

export interface PendingConversationConfirmation {
  id: string;
  action: CanonicalConversationAction;
  taskId?: string;
  taskTitle?: string;
  approvalId?: string;
  proposedTask?: {
    title: string;
    summary: string;
    priority?: string;
    requestedOutcome?: string;
    knownConstraints?: string[];
    sourceUserRequest?: string;
  };
  candidateTasks: TaskReferenceCandidate[];
  createdAt: string;
  status: "pending" | "confirmed" | "declined" | "resolved" | "superseded";
  expectedResponse: "yes_no" | "task_selection";
  reason: string;
}

export type PendingConfirmationAnswer =
  | { kind: "confirm" }
  | { kind: "decline" }
  | { kind: "task_selection"; candidate: TaskReferenceCandidate }
  | { kind: "unrelated" };

export interface ConversationTaskSummary {
  id: string;
  title: string;
  currentState: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date | null;
  updatedAt?: Date | null;
}

export const CONSEQUENTIAL_ACTIONS: CanonicalConversationAction[] = [
  "CANCEL_TASK",
  "PAUSE_TASK",
  "RESUME_TASK",
  "APPROVE_ACTION",
  "REJECT_ACTION",
  "MODIFY_TASK",
  "SWITCH_TASK",
];

const OPEN_TASK_STATES: TaskState[] = [
  "draft",
  "queued",
  "planning",
  "awaiting_approval",
  "evidence_required",
  "approved",
  "executing",
  "failed",
];
const ORG_REFERENCE_TASK_STATES: TaskState[] = OPEN_TASK_STATES.filter(state => state !== "failed");
const PENDING_CONFIRMATION_MAX_AGE_MS = 30 * 60 * 1000;

const CANCEL_PATTERNS = [
  /\b(cancel|stop|abort|terminate|kill)\b.*\b(task|request|report|work|execution|job|that|this|it)\b/i,
  /\b(i don'?t need|do not need|don't need|forget)\b.*\b(this|that|request|task|report|it)\b/i,
  /\bdon'?t continue\b/i,
];
const PAUSE_PATTERNS = [/\b(pause|hold|leave)\b.*\b(this|that|task|request|for now)\b/i, /\bhold this for now\b/i];
const RESUME_PATTERNS = [/\b(resume|continue|carry on|restart|go back to)\b/i];
const APPROVE_PATTERNS = [
  /^(approved|approve|yes|yep|yeah|ok|okay|go ahead|send it|proceed|do it)\.?$/i,
  /^(approved|approve|go ahead|proceed)\b/i,
];
const REJECT_PATTERNS = [/^(reject|rejected|no|don'?t send it|do not send it|don'?t proceed|not approved)\.?$/i];
const ETA_STATUS_PATTERN = /\b(how long|how much longer|eta|completion estimate|when (will|is|can).*(ready|done|finished|complete)|when.*(ready|done|finished|complete))\b/i;
const STATUS_PATTERNS = [
  /\b(where are we|where are we up to|where is this work at|where is it up to|what'?s pending|what are you waiting for|has it finished|is it done|status|progress|update me|give me an update|any update|latest)\b/i,
  /^(update|progress|latest)$/i,
  /\b(what'?s happening|what is happening|what'?s happening with this task|how is it going|what'?s the current position|what is the current position)\b/i,
  /\bwhat task are we working on\b/i,
  /\bwhich task are we working on\b/i,
  /\bwhat are we working on\b/i,
  /\bwho('s| is)? working on (it|this|that|the task|this work)\b/i,
  /\b(has|have).*(specialist|worker|team).*(started|begun|started working|actually started)\b/i,
  /\b(actually started|started working|begun working)\b/i,
  ETA_STATUS_PATTERN,
];
const SWITCH_PATTERNS = [/\b(back to|return to|go back to|switch to)\b/i];
const MODIFY_PATTERNS = [/\b(add|include|change|modify|update|revise)\b.*\b(that|this|report|task|draft|it)\b/i];
const NEW_TASK_PATTERNS = [/\b(also|now|next)\b.*\b(prepare|create|check|review|audit|draft|build)\b/i, /\bprepare\b.*\b(roster|report|policy|plan)\b/i];
const CONFIRM_PATTERNS = [
  /^(yes|yep|yeah|confirm|confirmed|go ahead|proceed|procced|procceed|please proceed|please procced|please procceed|do it|cancel it|cancel that|okay proceed|ok proceed)\.?$/i,
  /^(confirm|confirmed|yes|yep|yeah|ok|okay)[, ]+(please )?(go ahead|proceed|create|do it)\.?$/i,
];
const DECLINE_PATTERNS = [/^(no|nope|no[, ]+don'?t proceed|no[, ]+do not proceed|don't|do not|don'?t cancel|keep it|leave it|not anymore|do not proceed)\.?$/i];

function matches(patterns: RegExp[], text: string): boolean {
  return patterns.some(pattern => pattern.test(text));
}

export function responseRequestsTaskConfirmation(text: string | undefined): boolean {
  if (!text) return false;
  return /\b(please confirm|confirm to proceed|confirm and i'?ll|would you like me to create|shall i create|reply yes|confirm with yes)\b/i.test(text);
}

export function isPendingConfirmationActive(confirmation: PendingConversationConfirmation, now = Date.now()): boolean {
  if (confirmation.status !== "pending") return false;
  const created = Date.parse(confirmation.createdAt);
  if (!Number.isFinite(created)) return false;
  return now - created <= PENDING_CONFIRMATION_MAX_AGE_MS;
}

export function classifyCanonicalConversationAction(text: string): CanonicalConversationAction {
  const trimmed = text.trim();
  if (matches(CANCEL_PATTERNS, trimmed)) return "CANCEL_TASK";
  if (matches(PAUSE_PATTERNS, trimmed)) return "PAUSE_TASK";
  if (matches(REJECT_PATTERNS, trimmed)) return "REJECT_ACTION";
  if (matches(APPROVE_PATTERNS, trimmed)) return "APPROVE_ACTION";
  if (matches(STATUS_PATTERNS, trimmed)) return "STATUS_QUERY";
  if (matches(SWITCH_PATTERNS, trimmed)) return "SWITCH_TASK";
  if (matches(MODIFY_PATTERNS, trimmed)) return "MODIFY_TASK";
  if (matches(RESUME_PATTERNS, trimmed)) return "RESUME_TASK";
  if (matches(NEW_TASK_PATTERNS, trimmed)) return "NEW_TASK";
  if (/^(what|how|why|when|where|who)\b/i.test(trimmed)) return "GENERAL_QUESTION";
  return "GENERAL_QUESTION";
}

export function isLikelyCheckpointAnswer(text: string, checkpoint: Pick<ActiveCheckpoint, "clarificationQuestions">): boolean {
  const intent = classifyCanonicalConversationAction(text);
  if (intent !== "GENERAL_QUESTION") return false;
  const lower = text.toLowerCase();
  if (matches(NEW_TASK_PATTERNS, text) || matches(CANCEL_PATTERNS, text) || matches(STATUS_PATTERNS, text)) return false;
  const questionText = checkpoint.clarificationQuestions.join(" ").toLowerCase();
  if (/\b(period|month|date|deadline|when|range)\b/.test(questionText)) {
    return /\b(january|february|march|april|may|june|july|august|september|october|november|december|20\d{2}|next week|last month|this month)\b/i.test(text);
  }
  return lower.split(/\s+/).length <= 12;
}

const GENERIC_REFERENCE_WORDS = new Set([
  "review",
  "report",
  "task",
  "status",
  "progress",
  "prepare",
  "improve",
  "management",
  "approach",
]);

function phraseScore(textLower: string, titleLower: string): number {
  let score = 0;
  const phrases = [
    "service delivery",
    "roster review",
    "coverage gap",
    "coverage",
    "restrictive practice",
    "fatigue management",
    "policy",
  ];
  for (const phrase of phrases) {
    if (textLower.includes(phrase) && titleLower.includes(phrase)) score += phrase.split(" ").length > 1 ? 72 : 38;
  }
  if (/\broster\b/.test(textLower) && /\broster(ing)?\b/.test(titleLower)) score += 42;
  if (/\bdelivery\b/.test(textLower) && /\bdelivery\b/.test(titleLower)) score += 42;
  return score;
}

function titleScore(text: string, title: string): number {
  const lower = text.toLowerCase();
  const titleLower = title.toLowerCase();
  const words = titleLower.split(/[^a-z0-9]+/).filter(w => w.length > 2);
  if (titleLower && lower.includes(titleLower)) return 120;
  let score = phraseScore(lower, titleLower);
  for (const word of words) {
    if (!lower.includes(word)) continue;
    score += GENERIC_REFERENCE_WORDS.has(word) ? 3 : 14;
  }
  return score;
}

function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i]![j] = Math.min(
        dp[i - 1]![j] + 1,
        dp[i]![j - 1] + 1,
        dp[i - 1]![j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length]![b.length]!;
}

function fuzzySelectionScore(text: string, title: string): number {
  const textWords = text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const titleWords = title.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  let score = titleScore(text, title);
  for (const inputWord of textWords) {
    for (const titleWord of titleWords) {
      if (inputWord === titleWord) score += 35;
      else if (inputWord.length >= 5 && titleWord.length >= 5 && editDistance(inputWord, titleWord) <= 2) score += 24;
      else if (titleWord.includes(inputWord) || inputWord.includes(titleWord)) score += 18;
    }
  }
  return score;
}

function hasImmediateTaskReference(text: string): boolean {
  return /\b(same|that|this|it|current|newly created|created task|linked task|same task|same service agreement|continue|cancel|hold|pause|status|working on|started|failed|completed)\b/i.test(text);
}

export function resolveConversationReference(input: {
  text: string;
  intent?: CanonicalConversationAction;
  focus?: ConversationFocus | null;
  currentTaskId?: string | null;
  activeTasks: ConversationTaskSummary[];
  pendingApprovals?: Array<{ id: string; taskId: string; title?: string | null }>;
}): ConversationResolution {
  const intent = input.intent ?? classifyCanonicalConversationAction(input.text);
  const lower = input.text.toLowerCase();
  const candidates: TaskReferenceCandidate[] = input.activeTasks.map(task => {
    let score = titleScore(input.text, task.title);
    const reasons: string[] = [];
    if (score > 0) reasons.push("title_match");
    if (input.focus?.taskId === task.id) {
      score += hasImmediateTaskReference(input.text) ? 140 : 20;
      reasons.push("conversation_focus");
    }
    if (input.currentTaskId === task.id) {
      score += 35;
      reasons.push("workroom_task");
    }
    if (/\broster\b/.test(lower) && /roster/i.test(task.title)) {
      score += 45;
      reasons.push("work_type_roster");
    }
    if (/\bservice delivery\b/.test(lower) && /service delivery/i.test(task.title)) {
      score += 55;
      reasons.push("work_type_service_delivery");
    }
    if (/\breport\b/.test(lower) && /report/i.test(task.title)) {
      score += 35;
      reasons.push("work_type_report");
    }
    return { taskId: task.id, title: task.title, state: task.currentState, score, reason: reasons.join("+") || "candidate" };
  }).filter(c => {
    if (c.score >= 12) return true;
    return /\b(conversation_focus|workroom_task|work_type_)/.test(c.reason);
  }).sort((a, b) => b.score - a.score);

  if (intent === "NEW_TASK" || intent === "NEW_UNRELATED_REQUEST") {
    return { intent, confidence: 0.9, ambiguity: "none", candidateTasks: candidates, requiresClarification: false, reason: "new_request_signal" };
  }

  if (intent === "APPROVE_ACTION" || intent === "REJECT_ACTION") {
    const approvals = input.pendingApprovals ?? [];
    if (approvals.length === 1) {
      return {
        intent,
        resolvedTaskId: approvals[0]!.taskId,
        resolvedApprovalId: approvals[0]!.id,
        confidence: 0.95,
        ambiguity: "none",
        candidateTasks: candidates,
        requiresClarification: false,
        reason: "single_pending_approval",
      };
    }
    if (approvals.length === 0) {
      const best = candidates[0];
      const second = candidates[1];
      return {
        intent,
        resolvedTaskId: best && best.score >= 55 && (!second || best.score - second.score >= 20) ? best.taskId : undefined,
        confidence: best ? 0.7 : 0.35,
        ambiguity: "none",
        candidateTasks: candidates,
        requiresClarification: false,
        reason: "no_concrete_pending_approval",
      };
    }
    return {
      intent,
      confidence: 0.45,
      ambiguity: "material",
      candidateTasks: candidates,
      requiresClarification: true,
      reason: "multiple_pending_approvals",
    };
  }

  const best = candidates[0];
  const second = candidates[1];
  if (best && best.score >= 55 && (!second || best.score - second.score >= 20)) {
    return {
      intent,
      resolvedTaskId: best.taskId,
      confidence: Math.min(0.99, best.score / 100),
      ambiguity: "none",
      candidateTasks: candidates.slice(0, 5),
      requiresClarification: false,
      reason: best.reason,
    };
  }

  if (!best && input.activeTasks.length === 1 && /\b(that|this|it|current|task)\b/i.test(input.text)) {
    const only = input.activeTasks[0]!;
    return {
      intent,
      resolvedTaskId: only.id,
      confidence: 0.82,
      ambiguity: "low",
      candidateTasks: [{ taskId: only.id, title: only.title, state: only.currentState, score: 82, reason: "single_open_task" }],
      requiresClarification: false,
      reason: "single_open_task_pronoun",
    };
  }

  if (intent === "STATUS_QUERY" && candidates.length === 1) {
    const only = candidates[0]!;
    return {
      intent,
      resolvedTaskId: only.taskId,
      confidence: 0.78,
      ambiguity: "low",
      candidateTasks: [only],
      requiresClarification: false,
      reason: "single_status_referent",
    };
  }

  return {
    intent,
    confidence: best ? 0.45 : 0.15,
    ambiguity: best ? "material" : "none",
    candidateTasks: candidates.slice(0, 5),
    requiresClarification: intent === "STATUS_QUERY" ? false : CONSEQUENTIAL_ACTIONS.includes(intent),
    reason: best ? "ambiguous_task_reference" : "no_task_reference",
  };
}

export async function getConversationFocus(input: {
  organizationId: string;
  conversationId: string;
}): Promise<ConversationFocus | null> {
  const rows = await db
    .select({ structuredContent: conversationMessagesTable.structuredContent })
    .from(conversationMessagesTable)
    .where(and(
      eq(conversationMessagesTable.organizationId, input.organizationId),
      eq(conversationMessagesTable.conversationId, input.conversationId),
      eq(conversationMessagesTable.messageType, "system_notice"),
    ))
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(20);

  for (const row of rows) {
    const sc = row.structuredContent as any;
    if (sc?.type === "conversation_focus") return sc.data as ConversationFocus;
  }
  return null;
}

export async function getPendingConversationConfirmation(input: {
  organizationId: string;
  conversationId: string;
}): Promise<PendingConversationConfirmation | null> {
  const rows = await db
    .select({ id: conversationMessagesTable.id, structuredContent: conversationMessagesTable.structuredContent })
    .from(conversationMessagesTable)
    .where(and(
      eq(conversationMessagesTable.organizationId, input.organizationId),
      eq(conversationMessagesTable.conversationId, input.conversationId),
      eq(conversationMessagesTable.messageType, "system_notice"),
    ))
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(30);

  for (const row of rows) {
    const sc = row.structuredContent as any;
    if (sc?.type === "conversation_pending_confirmation" && sc.data?.status === "pending") {
      const confirmation = { ...sc.data, id: sc.data.id ?? row.id } as PendingConversationConfirmation;
      if (isPendingConfirmationActive(confirmation)) return confirmation;
    }
  }
  return null;
}

async function supersedePendingConversationConfirmations(input: {
  organizationId: string;
  conversationId: string;
  supersededById: string;
  reason: string;
}): Promise<void> {
  const rows = await db
    .select({ id: conversationMessagesTable.id, structuredContent: conversationMessagesTable.structuredContent })
    .from(conversationMessagesTable)
    .where(and(
      eq(conversationMessagesTable.organizationId, input.organizationId),
      eq(conversationMessagesTable.conversationId, input.conversationId),
      eq(conversationMessagesTable.messageType, "system_notice"),
    ))
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(100);

  await Promise.all(rows.map(async row => {
    const sc = row.structuredContent as any;
    if (sc?.type !== "conversation_pending_confirmation" || sc.data?.status !== "pending") return;
    const data = {
      ...(sc.data as Record<string, unknown>),
      status: "superseded",
      supersededAt: new Date().toISOString(),
      supersededById: input.supersededById,
      supersededReason: input.reason,
    };
    await db
      .update(conversationMessagesTable)
      .set({ structuredContent: { type: "conversation_pending_confirmation", data }, updatedAt: new Date() })
      .where(and(
        eq(conversationMessagesTable.organizationId, input.organizationId),
        eq(conversationMessagesTable.conversationId, input.conversationId),
        eq(conversationMessagesTable.id, row.id),
      ));
  }));
}

export async function persistConversationConfirmation(input: {
  organizationId: string;
  conversationId: string;
  action: CanonicalConversationAction;
  taskId?: string;
  taskTitle?: string;
  approvalId?: string;
  proposedTask?: PendingConversationConfirmation["proposedTask"];
  candidateTasks?: TaskReferenceCandidate[];
  expectedResponse: PendingConversationConfirmation["expectedResponse"];
  reason: string;
}): Promise<PendingConversationConfirmation> {
  const confirmation: PendingConversationConfirmation = {
    id: randomUUID(),
    action: input.action,
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    approvalId: input.approvalId,
    proposedTask: input.proposedTask,
    candidateTasks: input.candidateTasks ?? [],
    createdAt: new Date().toISOString(),
    status: "pending",
    expectedResponse: input.expectedResponse,
    reason: input.reason,
  };

  await supersedePendingConversationConfirmations({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    supersededById: confirmation.id,
    reason: "newer_confirmation_in_same_conversation",
  }).catch(() => {});

  await db.insert(conversationMessagesTable).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    taskId: input.taskId ?? null,
    senderType: "system",
    messageType: "system_notice",
    content: `Pending conversation confirmation ${confirmation.id}.`,
    structuredContent: { type: "conversation_pending_confirmation", data: confirmation },
    status: "delivered",
  });

  await logOrgEvent({
    eventType: "conversation.pending_confirmation_created",
    organizationId: input.organizationId,
    actorType: "system",
    resourceType: "conversation",
    resourceId: input.conversationId,
    metadata: { confirmationId: confirmation.id, action: confirmation.action, taskId: confirmation.taskId },
  }).catch(() => {});

  return confirmation;
}

export async function markConversationConfirmationResolved(input: {
  organizationId: string;
  conversationId: string;
  confirmation: PendingConversationConfirmation;
  status: Exclude<PendingConversationConfirmation["status"], "pending">;
}): Promise<void> {
  const rows = await db
    .select({ id: conversationMessagesTable.id, structuredContent: conversationMessagesTable.structuredContent })
    .from(conversationMessagesTable)
    .where(and(
      eq(conversationMessagesTable.organizationId, input.organizationId),
      eq(conversationMessagesTable.conversationId, input.conversationId),
      eq(conversationMessagesTable.messageType, "system_notice"),
    ))
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(30);

  const row = rows.find(candidate => {
    const sc = candidate.structuredContent as any;
    return sc?.type === "conversation_pending_confirmation" && sc.data?.id === input.confirmation.id;
  });
  if (!row) return;
  const data = {
    ...(input.confirmation as Record<string, unknown>),
    status: input.status,
    resolvedAt: new Date().toISOString(),
  };
  await db
    .update(conversationMessagesTable)
    .set({ structuredContent: { type: "conversation_pending_confirmation", data }, updatedAt: new Date() })
    .where(and(
      eq(conversationMessagesTable.organizationId, input.organizationId),
      eq(conversationMessagesTable.conversationId, input.conversationId),
      eq(conversationMessagesTable.id, row.id),
    ));
}

export function resolvePendingConfirmationAnswer(
  text: string,
  confirmation: PendingConversationConfirmation,
): PendingConfirmationAnswer {
  const trimmed = text.trim();
  if (matches(CONFIRM_PATTERNS, trimmed)) return { kind: "confirm" };
  if (matches(DECLINE_PATTERNS, trimmed)) return { kind: "decline" };
  if (matches(NEW_TASK_PATTERNS, trimmed) || matches(STATUS_PATTERNS, trimmed) || matches(SWITCH_PATTERNS, trimmed)) {
    return { kind: "unrelated" };
  }

  if (confirmation.candidateTasks.length > 0) {
    const lower = trimmed.toLowerCase();
    const keywordCandidate = confirmation.candidateTasks.find(candidate => {
      const title = candidate.title.toLowerCase();
      return (
        (/\b(service|serice|servcie|delivery|delievery)\b/.test(lower) && /service delivery|delivery/i.test(title)) ||
        (/\broster|coverage\b/.test(lower) && /roster|coverage/i.test(title))
      );
    });
    if (keywordCandidate) return { kind: "task_selection", candidate: keywordCandidate };

    const ranked = confirmation.candidateTasks
      .map(candidate => ({ candidate, score: fuzzySelectionScore(trimmed, candidate.title) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    const second = ranked[1];
    if (best && best.score >= 35 && (!second || best.score - second.score >= 12)) {
      return { kind: "task_selection", candidate: best.candidate };
    }
  }

  return { kind: "unrelated" };
}

export async function persistConversationFocus(input: {
  organizationId: string;
  conversationId: string;
  taskId?: string;
  entityId?: string;
  workType?: string;
  artifactId?: string;
  reason: string;
  source: ConversationFocus["source"];
}): Promise<ConversationFocus> {
  const focus: ConversationFocus = {
    taskId: input.taskId,
    entityId: input.entityId,
    workType: input.workType,
    artifactId: input.artifactId,
    updatedAt: new Date().toISOString(),
    reason: input.reason,
    source: input.source,
  };

  await db.insert(conversationMessagesTable).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    senderType: "system",
    messageType: "system_notice",
    content: `Conversation focus changed${focus.taskId ? ` to task ${focus.taskId}` : ""}.`,
    structuredContent: { type: "conversation_focus", data: focus },
    status: "delivered",
  });

  await logOrgEvent({
    eventType: "conversation.focus_changed",
    organizationId: input.organizationId,
    actorType: "system",
    resourceType: "conversation",
    resourceId: input.conversationId,
    metadata: { taskId: focus.taskId, workType: focus.workType, reason: focus.reason },
  }).catch(() => {});

  return focus;
}

export async function getOpenConversationTasks(input: {
  organizationId: string;
  conversationId: string;
  currentTaskId?: string | null;
  focusedTaskId?: string | null;
}): Promise<ConversationTaskSummary[]> {
  const messageRows = await db
    .select({ taskId: conversationMessagesTable.taskId })
    .from(conversationMessagesTable)
    .where(and(
      eq(conversationMessagesTable.organizationId, input.organizationId),
      eq(conversationMessagesTable.conversationId, input.conversationId),
      sql`${conversationMessagesTable.taskId} IS NOT NULL`,
    ))
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(20);

  const taskIds = [...new Set([
    input.currentTaskId ?? undefined,
    input.focusedTaskId ?? undefined,
    ...messageRows.map(r => r.taskId ?? undefined),
  ].filter(Boolean) as string[])];

  const conversationRows = taskIds.length > 0
    ? await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.organizationId, input.organizationId), inArray(tasksTable.id, taskIds)))
      .limit(50)
    : [];

  const orgRows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.organizationId, input.organizationId), inArray(tasksTable.currentState, [...ORG_REFERENCE_TASK_STATES] as unknown as string[])))
    .orderBy(desc(tasksTable.updatedAt))
    .limit(20);

  const byId = new Map<string, typeof tasksTable.$inferSelect>();
  for (const row of [...conversationRows, ...orgRows]) byId.set(row.id, row);

  return [...byId.values()]
    .filter(row => OPEN_TASK_STATES.includes(row.currentState as TaskState))
    .map(row => ({
      id: row.id,
      title: row.title,
      currentState: row.currentState,
      metadata: row.metadata as Record<string, unknown>,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
}

export async function getPendingApprovalsForConversation(input: {
  organizationId: string;
  taskIds: string[];
}): Promise<Array<{ id: string; taskId: string; title?: string | null }>> {
  if (input.taskIds.length === 0) return [];
  const rows = await db
    .select({ id: approvalsTable.id, taskId: approvalsTable.taskId, title: tasksTable.title })
    .from(approvalsTable)
    .leftJoin(tasksTable, eq(approvalsTable.taskId, tasksTable.id))
    .where(and(
      eq(approvalsTable.organizationId, input.organizationId),
      eq(approvalsTable.state, "pending"),
      inArray(approvalsTable.taskId, input.taskIds),
    ))
    .limit(20);
  return rows.map(row => ({ id: row.id, taskId: row.taskId, title: row.title }));
}

export async function cancelTaskFromConversation(input: {
  organizationId: string;
  conversationId: string;
  taskId: string;
  actorUserId: string;
}): Promise<{ status: "cancelled" | "already_cancelled" | "not_cancelled"; taskId: string; reason?: string }> {
  const result = await cancelTask(input.taskId, input.organizationId, {
    cancelledBy: input.actorUserId,
    conversationId: input.conversationId,
    source: "conversation_control",
  });
  if (result.status === "already_completed") {
    throw Object.assign(new Error("Completed tasks cannot be cancelled."), { code: "VALIDATION_ERROR" });
  }
  if (result.status === "not_cancelled") {
    return { status: "not_cancelled", taskId: input.taskId, reason: result.reason };
  }

  const checkpoint = await getActiveCheckpointByConversation(input.conversationId).catch(() => null);
  if (checkpoint && (!checkpoint.taskId || checkpoint.taskId === input.taskId)) {
    await cancelCheckpoint(checkpoint.id).catch(() => {});
  }
  await cancelTaskExecution(input.taskId, input.organizationId).catch(() => {});
  await logOrgEvent({
    eventType: "conversation.task_cancelled",
    organizationId: input.organizationId,
    actorType: "user",
    actorUserId: input.actorUserId,
    resourceType: "task",
    resourceId: input.taskId,
    metadata: { conversationId: input.conversationId },
  }).catch(() => {});
  return { status: result.status === "already_cancelled" ? "already_cancelled" : "cancelled", taskId: input.taskId };
}

export async function holdTaskFromConversation(input: {
  organizationId: string;
  conversationId: string;
  taskId: string;
  actorUserId: string;
  hold: boolean;
}): Promise<{ status: "held" | "resumed"; taskId: string }> {
  const [task] = await db
    .select({ metadata: tasksTable.metadata, currentState: tasksTable.currentState })
    .from(tasksTable)
    .where(and(eq(tasksTable.organizationId, input.organizationId), eq(tasksTable.id, input.taskId)))
    .limit(1);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "RESOURCE_NOT_FOUND" });
  if (["completed", "cancelled"].includes(task.currentState)) {
    throw Object.assign(new Error(`Cannot ${input.hold ? "pause" : "resume"} a ${task.currentState} task`), { code: "VALIDATION_ERROR" });
  }
  const metadata = {
    ...((task.metadata as Record<string, unknown>) ?? {}),
    conversationHold: input.hold
      ? { held: true, heldAt: new Date().toISOString(), heldBy: input.actorUserId, conversationId: input.conversationId }
      : { held: false, resumedAt: new Date().toISOString(), resumedBy: input.actorUserId, conversationId: input.conversationId },
  };
  await db.update(tasksTable)
    .set({ metadata, updatedAt: new Date() })
    .where(and(eq(tasksTable.organizationId, input.organizationId), eq(tasksTable.id, input.taskId)));
  await logOrgEvent({
    eventType: input.hold ? "conversation.task_paused" : "conversation.task_resumed",
    organizationId: input.organizationId,
    actorType: "user",
    actorUserId: input.actorUserId,
    resourceType: "task",
    resourceId: input.taskId,
    metadata: { conversationId: input.conversationId },
  }).catch(() => {});
  return { status: input.hold ? "held" : "resumed", taskId: input.taskId };
}

export async function modifyTaskFromConversation(input: {
  organizationId: string;
  conversationId: string;
  taskId: string;
  actorUserId: string;
  changeRequest: string;
}): Promise<{ status: "modified" | "needs_revision_task" | "not_modified"; taskId: string; taskTitle?: string; reason?: string }> {
  const result = await recordTaskModification({
    taskId: input.taskId,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    conversationId: input.conversationId,
    changeRequest: input.changeRequest,
  });
  await logOrgEvent({
    eventType: "conversation.task_modified",
    organizationId: input.organizationId,
    actorType: "user",
    actorUserId: input.actorUserId,
    resourceType: "task",
    resourceId: input.taskId,
    metadata: {
      conversationId: input.conversationId,
      status: result.status,
      changeRequest: input.changeRequest.slice(0, 500),
    },
  }).catch(() => {});
  return { status: result.status, taskId: input.taskId, taskTitle: result.task.title, reason: result.reason };
}

export async function resolveSingleApproval(input: {
  organizationId: string;
  actorUserId: string;
  approvalId: string;
  action: "approved" | "rejected";
}): Promise<{ approvalId: string; state: string; taskId: string }> {
  const membership = await getMembershipForUser(input.organizationId, input.actorUserId);
  if (!membership?.role) {
    throw Object.assign(new Error("Approval actor role could not be verified."), { code: "APPROVAL_ACTOR_ROLE_UNVERIFIED" });
  }

  const approval = await resolveApprovalWithAuthority({
    approvalId: input.approvalId,
    organizationId: input.organizationId,
    action: input.action,
    actorUserId: input.actorUserId,
    actorRole: membership.role,
  });
  if (approval.taskId) {
    const nextTaskState: TaskState = input.action === "approved" ? "approved" : "failed";
    await transitionTaskState(approval.taskId, input.organizationId, nextTaskState);
    if (input.action === "approved") {
      const task = await getTaskById(approval.taskId, input.organizationId);
      if (task) {
        dispatchWorkExecution({
          organizationId: input.organizationId,
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description ?? undefined,
          requesterId: input.actorUserId,
        }).catch(err =>
          console.warn("[conversationControl] Post-approval dispatch failed (non-fatal):", err?.message),
        );
      }
    }
  }
  return { approvalId: approval.id, state: approval.state, taskId: approval.taskId };
}
