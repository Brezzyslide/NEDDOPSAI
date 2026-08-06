/**
 * Conversation Memory Service — Sprint 9.2
 *
 * Rolling summarisation, pinned decisions, and unresolved question persistence.
 * Stores all data in the platform DB (conversation_memory table).
 * Original messages are NEVER modified or deleted.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  conversationMessagesTable,
  conversationMemoryTable,
  orgAuditLogTable,
} from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { createAIGateway } from "@workspace/ai-gateway";
import type {
  ConversationMemoryRecord,
  ConversationMemoryStructured,
  PinnedDecision,
  UnresolvedQuestion,
  Assumption,
} from "./contextSelectionService.js";
import { fetchConversationMemory } from "./contextSelectionService.js";

// ─── Summarisation system prompt ──────────────────────────────────────────────

const SUMMARY_SYSTEM_PROMPT = `You are a conversation summariser for an NDIS disability services operations platform.

Extract and return ONLY this JSON structure — no other text:

{
  "objective": "brief goal or null",
  "agreedScope": ["item"],
  "decisions": [{"decision": "text", "madeAt": "ISO", "sourceMessageId": "id"}],
  "unresolvedQuestions": [{"question": "text", "blocking": true, "sourceMessageId": "id"}],
  "assumptions": [{"assumption": "text", "confirmed": false}],
  "commitments": ["text"],
  "relevantPeople": ["name or role"],
  "relevantSystems": ["SharePoint", "PRODA"],
  "relatedTasks": ["task-id"],
  "currentStatus": "brief status"
}

Rules:
- Operational conclusions only — no chain-of-thought, no raw message content
- Preserve source message IDs for traceability
- Do not include secrets, credentials, or participant personal data`;

// ─── Trigger check ────────────────────────────────────────────────────────────

export async function shouldTriggerSummarisation(
  organizationId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const threshold = parseInt(process.env.AI_MEMORY_SUMMARY_THRESHOLD ?? "40", 10);
    const rows = await db
      .select({ id: conversationMessagesTable.id })
      .from(conversationMessagesTable)
      .where(and(
        eq(conversationMessagesTable.organizationId, organizationId),
        eq(conversationMessagesTable.conversationId, conversationId),
      ))
      .limit(threshold + 1);
    const total = rows.length;
    if (total < threshold) return false;

    const existing = await fetchConversationMemory(organizationId, conversationId);
    if (!existing) return true;
    return (total - existing.summarisedMessageCount) >= threshold;
  } catch { return false; }
}

// ─── Update rolling summary ───────────────────────────────────────────────────

export async function updateConversationSummary(
  organizationId: string,
  conversationId: string,
  actorUserId: string,
): Promise<{ success: boolean; version: number; reason?: string }> {
  try {
    const maxHistory = parseInt(process.env.AI_MAX_HISTORY_MESSAGES ?? "300", 10);
    const allMessages = await db
      .select({ id: conversationMessagesTable.id, senderType: conversationMessagesTable.senderType, content: conversationMessagesTable.content, messageType: conversationMessagesTable.messageType, createdAt: conversationMessagesTable.createdAt })
      .from(conversationMessagesTable)
      .where(and(eq(conversationMessagesTable.organizationId, organizationId), eq(conversationMessagesTable.conversationId, conversationId)))
      .orderBy(asc(conversationMessagesTable.createdAt))
      .limit(maxHistory);

    if (allMessages.length === 0) return { success: false, version: 0, reason: "no_messages" };

    const existing = await fetchConversationMemory(organizationId, conversationId);
    let messagesToSummarise = allMessages;
    if (existing?.summarisedThroughMessageId) {
      const idx = allMessages.findIndex(m => m.id === existing.summarisedThroughMessageId);
      if (idx >= 0) messagesToSummarise = allMessages.slice(idx + 1);
    }
    if (messagesToSummarise.length < 5) {
      return { success: false, version: existing?.summaryVersion ?? 0, reason: "insufficient_new_messages" };
    }

    const lastMessage = messagesToSummarise[messagesToSummarise.length - 1]!;
    const newVersion = (existing?.summaryVersion ?? 0) + 1;
    let usedFallback = false;
    let structuredSummary: ConversationMemoryStructured;

    const provider = (process.env.AI_PROVIDER ?? "internal").toLowerCase();
    if (provider === "openai") {
      try {
        const conversationText = messagesToSummarise
          .slice(0, 150)
          .map(m => {
            const role = m.senderType === "user" ? "User" : "Chief of Staff";
            const content = m.content.length > 300 ? m.content.slice(0, 300) + "…" : m.content;
            return `[${m.id}] ${role}: ${content}`;
          })
          .join("\n");

        const gateway = createAIGateway({
          userId: actorUserId, organizationId, role: "administrator",
          permissions: ["read:conversations"], purpose: "conversation_intelligence",
          correlationId: randomUUID(), provider: "openai",
          retentionClass: "transient", requiresHumanApproval: false,
        });
        const response = await gateway.process({
          systemPrompt: SUMMARY_SYSTEM_PROMPT,
          userMessage: `Summarise these conversation messages:\n\n${conversationText}`,
          retrievedFields: ["conversation.id"],
          maxTokens: 1000,
          outputMode: "json", // Conversation summary returns structured JSON (topics, decisions, actions)
        });
        if (!response.usedFallback) {
          structuredSummary = parseSummaryJson(response.content, existing);
        } else { throw new Error("gateway_fallback"); }
      } catch {
        usedFallback = true;
        structuredSummary = deterministicSummary(messagesToSummarise, existing);
      }
    } else {
      usedFallback = true;
      structuredSummary = deterministicSummary(messagesToSummarise, existing);
    }

    // Merge pinned decisions (they survive summarisation)
    const mergedPinned = existing?.pinnedDecisions ?? [];
    const mergedUnresolved = structuredSummary.unresolvedQuestions ?? [];
    const summaryText = buildSummaryText(structuredSummary);

    // Upsert conversation_memory
    if (existing) {
      await db
        .update(conversationMemoryTable)
        .set({
          summary: summaryText,
          structuredSummary: structuredSummary as Record<string, unknown>,
          summaryVersion: newVersion,
          summarisedThroughMessageId: lastMessage.id,
          summarisedMessageCount: allMessages.length,
          unresolvedQuestions: mergedUnresolved as unknown[],
          assumptions: (structuredSummary.assumptions ?? []) as unknown[],
          relatedTaskIds: (structuredSummary.relatedTasks ?? []) as unknown[],
          lastUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(conversationMemoryTable.organizationId, organizationId),
          eq(conversationMemoryTable.conversationId, conversationId),
        ));
    } else {
      await db.insert(conversationMemoryTable).values({
        id: randomUUID(),
        organizationId,
        conversationId,
        summary: summaryText,
        structuredSummary: structuredSummary as Record<string, unknown>,
        summaryVersion: newVersion,
        summarisedThroughMessageId: lastMessage.id,
        summarisedMessageCount: allMessages.length,
        unresolvedQuestions: mergedUnresolved as unknown[],
        pinnedDecisions: mergedPinned as unknown[],
        assumptions: (structuredSummary.assumptions ?? []) as unknown[],
        participants: [],
        relatedTaskIds: (structuredSummary.relatedTasks ?? []) as unknown[],
        lastUpdatedAt: new Date(),
      });
    }

    await writeAuditEvent(organizationId, actorUserId, conversationId, newVersion, usedFallback);
    return { success: true, version: newVersion };
  } catch (err) {
    console.error("[ConversationMemory] Summarisation failed:", err);
    return { success: false, version: 0, reason: String(err) };
  }
}

// ─── Pinned decisions ─────────────────────────────────────────────────────────

export async function pinDecision(
  organizationId: string,
  conversationId: string,
  decision: string,
  sourceMessageId: string | null,
  pinnedBy: string,
): Promise<PinnedDecision> {
  const newPin: PinnedDecision = {
    id: randomUUID(),
    decision: decision.slice(0, 500),
    sourceMessageId,
    pinnedBy,
    pinnedAt: new Date().toISOString(),
    conversationId,
  };

  const existing = await fetchConversationMemory(organizationId, conversationId);
  const currentPins: PinnedDecision[] = existing?.pinnedDecisions ?? [];
  const updated = [...currentPins, newPin];

  if (existing) {
    await db.update(conversationMemoryTable)
      .set({ pinnedDecisions: updated as unknown[], updatedAt: new Date() })
      .where(and(eq(conversationMemoryTable.organizationId, organizationId), eq(conversationMemoryTable.conversationId, conversationId)));
  } else {
    await db.insert(conversationMemoryTable).values({
      id: randomUUID(), organizationId, conversationId,
      summary: "", structuredSummary: {}, summaryVersion: 1,
      summarisedMessageCount: 0, unresolvedQuestions: [], pinnedDecisions: updated as unknown[],
      assumptions: [], participants: [], relatedTaskIds: [], lastUpdatedAt: new Date(),
    });
  }

  await writeDecisionAudit(organizationId, pinnedBy, conversationId, "decision.pinned", newPin.id);
  return newPin;
}

export async function unpinDecision(
  organizationId: string,
  conversationId: string,
  decisionId: string,
  userId: string,
): Promise<boolean> {
  try {
    const existing = await fetchConversationMemory(organizationId, conversationId);
    if (!existing) return false;
    const updated = existing.pinnedDecisions.filter(d => d.id !== decisionId);
    await db.update(conversationMemoryTable)
      .set({ pinnedDecisions: updated as unknown[], updatedAt: new Date() })
      .where(and(eq(conversationMemoryTable.organizationId, organizationId), eq(conversationMemoryTable.conversationId, conversationId)));
    await writeDecisionAudit(organizationId, userId, conversationId, "decision.unpinned", decisionId);
    return true;
  } catch { return false; }
}

// ─── Deterministic fallback summariser ───────────────────────────────────────

function deterministicSummary(
  messages: Array<{ id: string; senderType: string; content: string; createdAt: Date; messageType: string }>,
  existing: ConversationMemoryRecord | null,
): ConversationMemoryStructured {
  const decisions: ConversationMemoryStructured["decisions"] = [];
  const questions: UnresolvedQuestion[] = [];
  const systems: string[] = [];

  const DECISION_RE = /\b(?:will|decided|agreed|confirmed|approved)\b.{5,80}/i;
  const QUESTION_RE = /\b(?:who|what|when|where|how|which)\b.{10,80}\?/i;
  const SYSTEM_RE = /\b(SharePoint|PRODA|HRM|Xero|Careview|Brevity|ShiftCare|myGov|NDIS portal|Teams|Outlook)\b/gi;

  for (const msg of messages) {
    const dm = msg.content.match(DECISION_RE);
    if (dm) decisions.push({ decision: dm[0]!.slice(0, 200), madeAt: msg.createdAt.toISOString(), sourceMessageId: msg.id });
    const qm = msg.content.match(QUESTION_RE);
    if (qm && msg.senderType === "user") questions.push({ question: qm[0]!.slice(0, 200), blocking: false, sourceMessageId: msg.id });
    const sm = msg.content.match(SYSTEM_RE) ?? [];
    systems.push(...sm);
  }

  return {
    objective: existing?.structuredSummary?.objective,
    agreedScope: existing?.structuredSummary?.agreedScope ?? [],
    decisions: [...(existing?.structuredSummary?.decisions ?? []), ...decisions].slice(0, 20),
    unresolvedQuestions: questions.slice(0, 10),
    assumptions: existing?.structuredSummary?.assumptions ?? [],
    commitments: existing?.structuredSummary?.commitments ?? [],
    relevantPeople: existing?.structuredSummary?.relevantPeople ?? [],
    relevantSystems: [...new Set([...(existing?.structuredSummary?.relevantSystems ?? []), ...systems])].slice(0, 10),
    relatedTasks: existing?.structuredSummary?.relatedTasks ?? [],
    currentStatus: "Conversation in progress",
  };
}

function parseSummaryJson(content: string, existing: ConversationMemoryRecord | null): ConversationMemoryStructured {
  try {
    const r = JSON.parse(content) as Partial<ConversationMemoryStructured>;
    return {
      objective: typeof r.objective === "string" ? r.objective.slice(0, 300) : existing?.structuredSummary?.objective,
      agreedScope: Array.isArray(r.agreedScope) ? r.agreedScope.slice(0, 20) : [],
      decisions: Array.isArray(r.decisions) ? r.decisions.slice(0, 30) : [],
      unresolvedQuestions: Array.isArray(r.unresolvedQuestions) ? r.unresolvedQuestions.slice(0, 20) : [],
      assumptions: Array.isArray(r.assumptions) ? r.assumptions.slice(0, 20) : [],
      commitments: Array.isArray(r.commitments) ? r.commitments.slice(0, 20) : [],
      relevantPeople: Array.isArray(r.relevantPeople) ? r.relevantPeople.slice(0, 20) : [],
      relevantSystems: Array.isArray(r.relevantSystems) ? r.relevantSystems.slice(0, 10) : [],
      relatedTasks: Array.isArray(r.relatedTasks) ? r.relatedTasks.slice(0, 10) : [],
      currentStatus: typeof r.currentStatus === "string" ? r.currentStatus.slice(0, 200) : undefined,
    };
  } catch { return deterministicSummary([], existing); }
}

function buildSummaryText(s: ConversationMemoryStructured): string {
  const parts: string[] = [];
  if (s.objective) parts.push(`Objective: ${s.objective}`);
  if (s.agreedScope.length) parts.push(`Scope: ${s.agreedScope.join(", ")}`);
  if (s.decisions.length) parts.push(`Key decisions: ${s.decisions.map(d => d.decision).join("; ")}`);
  if (s.unresolvedQuestions.length) parts.push(`Open questions: ${s.unresolvedQuestions.map(q => q.question).join("; ")}`);
  if (s.currentStatus) parts.push(`Status: ${s.currentStatus}`);
  return parts.join("\n") || "Conversation in progress.";
}

// ─── Audit ────────────────────────────────────────────────────────────────────

async function writeAuditEvent(orgId: string, userId: string, convId: string, version: number, fallback: boolean) {
  try {
    await db.insert(orgAuditLogTable).values({
      id: randomUUID(), organizationId: orgId, actorUserId: userId, actorType: "system",
      eventType: version === 1 ? "conversation.summary_created" : "conversation.summary_updated",
      resourceType: "conversation_memory", resourceId: convId,
      isSensitive: false, metadata: { summaryVersion: version, usedFallback: fallback }, occurredAt: new Date(),
    });
  } catch { /* non-critical */ }
}

async function writeDecisionAudit(orgId: string, userId: string, convId: string, eventType: string, decisionId: string) {
  try {
    await db.insert(orgAuditLogTable).values({
      id: randomUUID(), organizationId: orgId, actorUserId: userId, actorType: "user",
      eventType, resourceType: "pinned_decision", resourceId: decisionId,
      isSensitive: false, metadata: { conversationId: convId }, occurredAt: new Date(),
    });
  } catch { /* non-critical */ }
}

export type { Assumption };
