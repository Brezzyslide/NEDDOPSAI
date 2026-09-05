/**
 * Context Selection Service — Sprint 9.2
 *
 * Builds the full ChiefOfStaffContextPackage for each AI request.
 * Stateless — reconstructs context from durable PostgreSQL data on every call.
 * Safe for multiple API instances.
 *
 * Reads up to AI_MAX_HISTORY_MESSAGES (default 300) from the DB,
 * selects relevant historical messages using deterministic scoring,
 * and respects a configurable token budget.
 */

import { db, withSystemTenantContext } from "@workspace/db";
import {
  organizationsTable,
  conversationMessagesTable,
  tasksTable,
  taskExecutionPlansTable,
  approvalsTable,
  organisationMemoryTable,
  conversationMemoryTable,
} from "@workspace/db";
import { eq, and, asc, desc, lte } from "drizzle-orm";

type DbClient = typeof db;

function withContextSelectionTenant<T>(
  organizationId: string,
  purpose: string,
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  return withSystemTenantContext(
    { tenantId: organizationId, serviceIdentity: "context_selection_service", purpose },
    fn,
  );
}

// ─── Config ───────────────────────────────────────────────────────────────────

export function memoryConfig() {
  return {
    maxHistoryMessages:     parseInt(process.env.AI_MAX_HISTORY_MESSAGES     ?? "300", 10),
    recentHistoryMessages:  parseInt(process.env.AI_RECENT_HISTORY_MESSAGES  ?? "30",  10),
    contextTokenBudget:     parseInt(process.env.AI_CONTEXT_TOKEN_BUDGET     ?? "6000", 10),
    summarisationThreshold: parseInt(process.env.AI_MEMORY_SUMMARY_THRESHOLD ?? "40",  10),
  };
}

// ─── Token estimator (4 chars ≈ 1 token) ─────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil((text ?? "").length / 4);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrganisationMemoryItem {
  id: string;
  memoryType: string;
  title: string;
  content: string;
  structuredContent: Record<string, unknown>;
  status: string;
  confidence: number;
  importance: number;
  sourceType: string;
  sourceId: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  expiresAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface ConversationMemoryStructured {
  objective?: string;
  agreedScope: string[];
  decisions: Array<{ decision: string; madeAt: string; sourceMessageId: string }>;
  unresolvedQuestions: UnresolvedQuestion[];
  assumptions: Assumption[];
  commitments: string[];
  relevantPeople: string[];
  relevantSystems: string[];
  relatedTasks: string[];
  currentStatus?: string;
}

export interface PinnedDecision {
  id: string;
  decision: string;
  sourceMessageId: string | null;
  pinnedBy: string;
  pinnedAt: string;
  conversationId: string;
}

export interface UnresolvedQuestion {
  question: string;
  blocking: boolean;
  sourceMessageId: string;
}

export interface Assumption {
  assumption: string;
  confirmed: boolean;
}

export interface ConversationMessage {
  id: string;
  senderType: string;
  content: string;
  messageType: string;
  createdAt: Date;
  relevanceScore?: number;
}

export interface TaskContext {
  id: string;
  title: string;
  currentState: string;
  priority: string;
  approvalState: string;
}

export interface ApprovalContext {
  id: string;
  taskId: string;
  approvalType: string;
  state: string;
}

export interface ConversationMemoryRecord {
  id: string;
  conversationId: string;
  summary: string;
  structuredSummary: ConversationMemoryStructured;
  summaryVersion: number;
  summarisedThroughMessageId: string | null;
  summarisedMessageCount: number;
  unresolvedQuestions: UnresolvedQuestion[];
  pinnedDecisions: PinnedDecision[];
  assumptions: Assumption[];
  participants: string[];
  relatedTaskIds: string[];
  lastUpdatedAt: Date;
}

export interface ChiefOfStaffContextPackage {
  organisationProfile: Record<string, unknown>;
  approvedOrganisationMemory: OrganisationMemoryItem[];
  conversationSummary: ConversationMemoryStructured;
  pinnedDecisions: PinnedDecision[];
  unresolvedQuestions: UnresolvedQuestion[];
  relevantHistoricalMessages: ConversationMessage[];
  recentMessages: ConversationMessage[];
  currentTasks: TaskContext[];
  currentApprovals: ApprovalContext[];
  contextWarnings: string[];
  tokenEstimate: number;
  historyStats: { totalAvailable: number; sent: number; summarised: number };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function buildChiefOfStaffContext(params: {
  organizationId: string;
  conversationId: string;
  userId: string;
  taskId?: string;
  currentMessage: string;
}): Promise<ChiefOfStaffContextPackage> {
  const { organizationId, conversationId, taskId, currentMessage } = params;
  const config = memoryConfig();
  const warnings: string[] = [];

  // All independent DB reads in parallel
  const [orgProfile, allMessages, orgMemory, convMemory, tasks, approvals] =
    await Promise.all([
      fetchOrgProfile(organizationId),
      fetchAllMessages(organizationId, conversationId, config.maxHistoryMessages),
      fetchApprovedOrgMemory(organizationId),
      fetchConversationMemory(organizationId, conversationId),
      taskId ? fetchTaskContext(organizationId, taskId) : Promise.resolve([] as TaskContext[]),
      taskId ? fetchApprovalContext(organizationId, taskId) : Promise.resolve([] as ApprovalContext[]),
    ]);

  const recentCount = Math.min(config.recentHistoryMessages, allMessages.length);
  const recentMessages = allMessages.slice(-recentCount);
  const historicalMessages = allMessages.slice(0, allMessages.length - recentCount);

  if (allMessages.length >= config.summarisationThreshold && !convMemory) {
    warnings.push(
      `Conversation has ${allMessages.length} messages and no summary. ` +
      `Summarisation will trigger after this response.`
    );
  }

  const pinnedDecisions = convMemory?.pinnedDecisions ?? [];
  const unresolvedQuestions = convMemory?.unresolvedQuestions ?? [];

  const { selected: relevantHistorical, warnings: retrievalWarnings } =
    selectRelevantMessages(historicalMessages, currentMessage, tasks, pinnedDecisions, config);
  warnings.push(...retrievalWarnings);

  const conversationSummary = convMemory?.structuredSummary ?? emptyStructuredSummary();

  const conflictWarnings = detectMemoryConflicts(orgMemory, pinnedDecisions);
  warnings.push(...conflictWarnings);

  const tokenEstimate = estimateContextTokens({
    orgMemory, convMemory, pinnedDecisions, unresolvedQuestions,
    relevantHistorical, recentMessages, tasks, currentMessage,
  });

  if (tokenEstimate > config.contextTokenBudget) {
    warnings.push(
      `Context token estimate (${tokenEstimate}) exceeds budget (${config.contextTokenBudget}). ` +
      `Historical messages were trimmed.`
    );
  }

  return {
    organisationProfile: orgProfile,
    approvedOrganisationMemory: orgMemory,
    conversationSummary,
    pinnedDecisions,
    unresolvedQuestions,
    relevantHistoricalMessages: relevantHistorical,
    recentMessages,
    currentTasks: tasks,
    currentApprovals: approvals,
    contextWarnings: warnings,
    tokenEstimate,
    historyStats: {
      totalAvailable: allMessages.length,
      sent: recentMessages.length + relevantHistorical.length,
      summarised: convMemory?.summarisedMessageCount ?? 0,
    },
  };
}

// ─── DB fetch helpers ─────────────────────────────────────────────────────────

async function fetchOrgProfile(organizationId: string): Promise<Record<string, unknown>> {
  try {
    const [org] = await withContextSelectionTenant(organizationId, "context_selection.org_profile", async (client) => client
      .select({ id: organizationsTable.id, name: organizationsTable.name, slug: organizationsTable.slug, status: organizationsTable.status })
      .from(organizationsTable).where(eq(organizationsTable.id, organizationId)).limit(1));
    return org ? { id: org.id, name: org.name, slug: org.slug, status: org.status } : {};
  } catch { return {}; }
}

async function fetchAllMessages(
  organizationId: string, conversationId: string, limit: number
): Promise<ConversationMessage[]> {
  const rows = await withContextSelectionTenant(organizationId, "context_selection.messages", async (client) => client
    .select({ id: conversationMessagesTable.id, senderType: conversationMessagesTable.senderType, content: conversationMessagesTable.content, messageType: conversationMessagesTable.messageType, createdAt: conversationMessagesTable.createdAt })
    .from(conversationMessagesTable)
    .where(and(eq(conversationMessagesTable.organizationId, organizationId), eq(conversationMessagesTable.conversationId, conversationId)))
    .orderBy(asc(conversationMessagesTable.createdAt))
    .limit(limit));
  return rows.map(r => ({ id: r.id, senderType: r.senderType, content: r.content, messageType: r.messageType, createdAt: r.createdAt }));
}

async function fetchApprovedOrgMemory(organizationId: string): Promise<OrganisationMemoryItem[]> {
  try {
    const now = new Date();
    const rows = await withContextSelectionTenant(organizationId, "context_selection.organisation_memory", async (client) => client
      .select()
      .from(organisationMemoryTable)
      .where(
        and(
          eq(organisationMemoryTable.organizationId, organizationId),
          eq(organisationMemoryTable.status, "approved"),
        )
      )
      .orderBy(desc(organisationMemoryTable.importance), desc(organisationMemoryTable.updatedAt))
      .limit(50));

    return rows
      .filter(r => !r.expiresAt || r.expiresAt > now)
      .filter(r => !r.effectiveTo || r.effectiveTo > now)
      .map(r => ({
        id: r.id,
        memoryType: r.memoryType,
        title: r.title,
        content: r.content,
        structuredContent: (r.structuredContent as Record<string, unknown>) ?? {},
        status: r.status,
        confidence: parseFloat(String(r.confidence ?? "0.8")),
        importance: r.importance,
        sourceType: r.sourceType,
        sourceId: r.sourceId ?? null,
        effectiveFrom: r.effectiveFrom ?? null,
        effectiveTo: r.effectiveTo ?? null,
        expiresAt: r.expiresAt ?? null,
        approvedBy: r.approvedBy ?? null,
        approvedAt: r.approvedAt ?? null,
        createdAt: r.createdAt,
      }));
  } catch { return []; }
}

export async function fetchConversationMemory(
  organizationId: string, conversationId: string
): Promise<ConversationMemoryRecord | null> {
  try {
    const [row] = await withContextSelectionTenant(organizationId, "context_selection.conversation_memory", async (client) => client
      .select()
      .from(conversationMemoryTable)
      .where(and(eq(conversationMemoryTable.organizationId, organizationId), eq(conversationMemoryTable.conversationId, conversationId)))
      .limit(1));
    if (!row) return null;
    return {
      id: row.id,
      conversationId: row.conversationId,
      summary: row.summary,
      structuredSummary: (row.structuredSummary as ConversationMemoryStructured) ?? emptyStructuredSummary(),
      summaryVersion: row.summaryVersion,
      summarisedThroughMessageId: row.summarisedThroughMessageId ?? null,
      summarisedMessageCount: row.summarisedMessageCount,
      unresolvedQuestions: (row.unresolvedQuestions as UnresolvedQuestion[]) ?? [],
      pinnedDecisions: (row.pinnedDecisions as PinnedDecision[]) ?? [],
      assumptions: (row.assumptions as Assumption[]) ?? [],
      participants: (row.participants as string[]) ?? [],
      relatedTaskIds: (row.relatedTaskIds as string[]) ?? [],
      lastUpdatedAt: row.lastUpdatedAt,
    };
  } catch { return null; }
}

async function fetchTaskContext(organizationId: string, taskId: string): Promise<TaskContext[]> {
  try {
    const rows = await withContextSelectionTenant(organizationId, "context_selection.task", async (client) => client
      .select({ id: tasksTable.id, title: tasksTable.title, currentState: tasksTable.currentState, priority: tasksTable.priority, approvalState: tasksTable.approvalState })
      .from(tasksTable)
      .where(and(eq(tasksTable.organizationId, organizationId), eq(tasksTable.id, taskId)))
      .limit(1));
    return rows.map(r => ({ id: r.id, title: r.title, currentState: r.currentState, priority: r.priority, approvalState: r.approvalState }));
  } catch { return []; }
}

async function fetchApprovalContext(organizationId: string, taskId: string): Promise<ApprovalContext[]> {
  try {
    const rows = await withContextSelectionTenant(organizationId, "context_selection.approvals", async (client) => client
      .select({ id: approvalsTable.id, taskId: approvalsTable.taskId, approvalType: approvalsTable.approvalType, state: approvalsTable.state })
      .from(approvalsTable)
      .where(and(eq(approvalsTable.organizationId, organizationId), eq(approvalsTable.taskId, taskId), eq(approvalsTable.state, "pending")))
      .limit(5));
    return rows.map(r => ({ id: r.id, taskId: r.taskId, approvalType: r.approvalType, state: r.state }));
  } catch { return []; }
}

// ─── Relevance scoring ────────────────────────────────────────────────────────

function selectRelevantMessages(
  historical: ConversationMessage[],
  currentMessage: string,
  tasks: TaskContext[],
  pinnedDecisions: PinnedDecision[],
  config: ReturnType<typeof memoryConfig>,
): { selected: ConversationMessage[]; warnings: string[] } {
  const warnings: string[] = [];
  if (historical.length === 0) return { selected: [], warnings };

  const current = currentMessage.toLowerCase();
  const currentKeywords = current.split(/\W+/).filter(w => w.length > 4);

  const scored = historical.map((msg, idx) => {
    const text = msg.content.toLowerCase();
    let score = 0;

    for (const kw of currentKeywords) { if (text.includes(kw)) score += 3; }
    for (const t of tasks) { if (text.includes(t.id) || text.includes(t.title.toLowerCase())) score += 7; }
    for (const pd of pinnedDecisions) {
      const words = pd.decision.toLowerCase().split(/\W+/).filter(w => w.length > 4);
      if (words.some(w => text.includes(w))) score += 10;
    }
    if (msg.messageType !== "text") score += 5;
    if (msg.content.length < 20) score -= 2;
    // Recency bonus
    score -= (historical.length - idx) * 0.02;

    return { msg, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const historicalBudget = Math.floor(config.contextTokenBudget * 0.25);
  let usedTokens = 0;
  const selected: ConversationMessage[] = [];

  for (const { msg, score } of scored) {
    if (score <= 0) break;
    const tokens = estimateTokens(`${msg.senderType}: ${msg.content}`);
    if (usedTokens + tokens > historicalBudget) {
      warnings.push(`Historical budget reached. ${scored.length - selected.length} older messages omitted.`);
      break;
    }
    usedTokens += tokens;
    selected.push({ ...msg, relevanceScore: score });
  }

  selected.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { selected, warnings };
}

// ─── Token estimator ──────────────────────────────────────────────────────────

function estimateContextTokens(parts: {
  orgMemory: OrganisationMemoryItem[];
  convMemory: ConversationMemoryRecord | null;
  pinnedDecisions: PinnedDecision[];
  unresolvedQuestions: UnresolvedQuestion[];
  relevantHistorical: ConversationMessage[];
  recentMessages: ConversationMessage[];
  tasks: TaskContext[];
  currentMessage: string;
}): number {
  let t = 800; // system prompt overhead
  for (const m of parts.orgMemory) t += estimateTokens(`${m.title}: ${m.content}`);
  if (parts.convMemory?.summary) t += estimateTokens(parts.convMemory.summary);
  for (const pd of parts.pinnedDecisions) t += estimateTokens(pd.decision);
  for (const q of parts.unresolvedQuestions) t += estimateTokens(q.question);
  for (const m of parts.relevantHistorical) t += estimateTokens(`${m.senderType}: ${m.content}`);
  for (const m of parts.recentMessages) t += estimateTokens(`${m.senderType}: ${m.content}`);
  for (const task of parts.tasks) t += estimateTokens(`${task.title} [${task.currentState}]`);
  t += estimateTokens(parts.currentMessage);
  return t;
}

// ─── Conflict detection ───────────────────────────────────────────────────────

function detectMemoryConflicts(
  memory: OrganisationMemoryItem[],
  pinnedDecisions: PinnedDecision[],
): string[] {
  const warnings: string[] = [];
  const now = new Date();

  for (const m of memory) {
    if (m.expiresAt && m.expiresAt < now) {
      warnings.push(`Organisation memory "${m.title}" has expired but is still approved.`);
    }
  }

  const approvalRules = memory.filter(m => m.memoryType === "approval_rule");
  const seen = new Map<string, string>();
  for (const r of approvalRules) {
    const key = r.title.toLowerCase().slice(0, 30);
    if (seen.has(key)) {
      warnings.push(`Conflicting approval rules: "${r.title}" — multiple approved versions exist.`);
    } else { seen.set(key, r.id); }
  }

  return warnings;
}

function emptyStructuredSummary(): ConversationMemoryStructured {
  return { agreedScope: [], decisions: [], unresolvedQuestions: [], assumptions: [], commitments: [], relevantPeople: [], relevantSystems: [], relatedTasks: [] };
}
