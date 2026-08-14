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
import type { ActiveCheckpoint } from "./executionCheckpointService.js";
import { resolveApproval } from "./approvalService.js";
import { transitionTaskState } from "./taskService.js";
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
  "STATUS_QUERY",
];

const OPEN_TASK_STATES: TaskState[] = [
  "draft",
  "queued",
  "planning",
  "awaiting_approval",
  "approved",
  "executing",
  "failed",
];

const CANCEL_PATTERNS = [
  /\b(cancel|stop|abort|terminate|kill)\b.*\b(task|request|report|work|execution|job|that|this|it)\b/i,
  /\b(i don'?t need|do not need|don't need|forget)\b.*\b(this|that|request|task|report|it)\b/i,
  /\bdon'?t continue\b/i,
];
const PAUSE_PATTERNS = [/\b(pause|hold|leave)\b.*\b(this|that|task|request|for now)\b/i, /\bhold this for now\b/i];
const RESUME_PATTERNS = [/\b(resume|continue|carry on|restart|go back to)\b/i];
const APPROVE_PATTERNS = [/^(approved|approve|yes|yep|yeah|ok|okay|go ahead|send it|proceed|do it)\.?$/i];
const REJECT_PATTERNS = [/^(reject|rejected|no|don'?t send it|do not send it|don'?t proceed|not approved)\.?$/i];
const STATUS_PATTERNS = [/\b(where are we|what'?s pending|what are you waiting for|has it finished|is it done|status|progress|update me)\b/i];
const SWITCH_PATTERNS = [/\b(back to|return to|go back to|switch to)\b/i];
const MODIFY_PATTERNS = [/\b(add|include|change|modify|update|revise)\b.*\b(that|this|report|task|draft|it)\b/i];
const NEW_TASK_PATTERNS = [/\b(also|now|next)\b.*\b(prepare|create|check|review|audit|draft|build)\b/i, /\bprepare\b.*\b(roster|report|policy|plan)\b/i];
const CONFIRM_PATTERNS = [/^(yes|yep|yeah|confirm|confirmed|go ahead|proceed|do it|cancel it|cancel that)\.?$/i];
const DECLINE_PATTERNS = [/^(no|nope|don't|do not|don'?t cancel|keep it|leave it|not anymore)\.?$/i];

function matches(patterns: RegExp[], text: string): boolean {
  return patterns.some(pattern => pattern.test(text));
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

function titleScore(text: string, title: string): number {
  const lower = text.toLowerCase();
  const titleLower = title.toLowerCase();
  const words = titleLower.split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const matchesCount = words.filter(word => lower.includes(word)).length;
  if (titleLower && lower.includes(titleLower)) return 60;
  return matchesCount * 12;
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
      score += /\b(that|this|it|current|continue|cancel|hold|pause|status)\b/i.test(input.text) ? 55 : 20;
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
    if (/\breport\b/.test(lower) && /report/i.test(task.title)) {
      score += 35;
      reasons.push("work_type_report");
    }
    return { taskId: task.id, title: task.title, state: task.currentState, score, reason: reasons.join("+") || "candidate" };
  }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);

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
    return {
      intent,
      confidence: approvals.length === 0 ? 0.2 : 0.45,
      ambiguity: approvals.length > 1 ? "material" : "none",
      candidateTasks: candidates,
      requiresClarification: true,
      reason: approvals.length > 1 ? "multiple_pending_approvals" : "no_pending_approval",
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

  return {
    intent,
    confidence: best ? 0.45 : 0.15,
    ambiguity: best ? "material" : "none",
    candidateTasks: candidates.slice(0, 5),
    requiresClarification: CONSEQUENTIAL_ACTIONS.includes(intent),
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
      return { ...sc.data, id: sc.data.id ?? row.id } as PendingConversationConfirmation;
    }
  }
  return null;
}

export async function persistConversationConfirmation(input: {
  organizationId: string;
  conversationId: string;
  action: CanonicalConversationAction;
  taskId?: string;
  taskTitle?: string;
  approvalId?: string;
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
    candidateTasks: input.candidateTasks ?? [],
    createdAt: new Date().toISOString(),
    status: "pending",
    expectedResponse: input.expectedResponse,
    reason: input.reason,
  };

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

  if (taskIds.length === 0) return [];
  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.organizationId, input.organizationId), inArray(tasksTable.id, taskIds)))
    .limit(50);

  return rows
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
}): Promise<{ status: "cancelled" | "already_cancelled"; taskId: string }> {
  const [task] = await db
    .select({ currentState: tasksTable.currentState })
    .from(tasksTable)
    .where(and(eq(tasksTable.organizationId, input.organizationId), eq(tasksTable.id, input.taskId)))
    .limit(1);
  if (!task) throw Object.assign(new Error("Task not found"), { code: "RESOURCE_NOT_FOUND" });
  if (task.currentState === "cancelled") return { status: "already_cancelled", taskId: input.taskId };
  await transitionTaskState(input.taskId, input.organizationId, "cancelled" as TaskState);
  await logOrgEvent({
    eventType: "conversation.task_cancelled",
    organizationId: input.organizationId,
    actorType: "user",
    actorUserId: input.actorUserId,
    resourceType: "task",
    resourceId: input.taskId,
    metadata: { conversationId: input.conversationId },
  }).catch(() => {});
  return { status: "cancelled", taskId: input.taskId };
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

export async function resolveSingleApproval(input: {
  organizationId: string;
  actorUserId: string;
  approvalId: string;
  action: "approved" | "rejected";
}): Promise<{ approvalId: string; state: string; taskId: string }> {
  const approval = await resolveApproval({
    approvalId: input.approvalId,
    organizationId: input.organizationId,
    action: input.action,
    actorUserId: input.actorUserId,
  });
  return { approvalId: approval.id, state: approval.state, taskId: approval.taskId };
}
