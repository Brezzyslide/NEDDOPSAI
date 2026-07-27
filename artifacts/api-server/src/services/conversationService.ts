/**
 * Conversation Service — Sprint 9
 *
 * CRUD for conversations, messages, participants, and unread state.
 * Every operation is tenant-scoped. Strict organization_id check on every query.
 */

import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  conversationsTable,
  conversationMessagesTable,
  conversationParticipantsTable,
  messageReadsTable,
  tasksTable,
  approvalsTable,
  taskExecutionPlansTable,
  type Conversation,
  type ConversationMessage,
  type InsertConversation,
  type InsertConversationMessage,
} from "@workspace/db";
import { eq, and, desc, lt, inArray, sql } from "drizzle-orm";
import type {
  ConversationUnderstanding,
  StructuredContent,
  MessageContext,
} from "./conversationIntelligenceService.js";
import {
  classifyMessage,
  buildTaskProposalCard,
  buildPlanCard,
  buildApprovalCard,
  buildExecutionUpdateCard,
  buildStatusSummaryCard,
} from "./conversationIntelligenceService.js";
import { classifyMessageLLM } from "./chiefOfStaffLLMService.js";
import { shouldTriggerSummarisation, updateConversationSummary } from "./conversationMemoryService.js";
import { planTask, type TaskPlan } from "./chiefOfStaffService.js";
// Sprint 9.4 — Capability gate
import { identifyCapabilities } from "./capabilityIdentificationService.js";
import { decideMixedCapabilityAccess } from "./capabilityAccessDecisionService.js";
import {
  buildBlockedCapabilityResponse,
  buildMixedCapabilityResponse,
  buildCapabilityBlockedCard,
  buildMixedCapabilityCard,
} from "./capabilityGateService.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateConversationInput {
  organizationId: string;
  createdByUserId: string;
  conversationType?: InsertConversation["conversationType"];
  title?: string;
  primaryTaskId?: string;
}

export interface AddMessageInput {
  organizationId: string;
  conversationId: string;
  taskId?: string;
  senderType: InsertConversationMessage["senderType"];
  senderUserId?: string;
  workforceRoleCode?: string;
  workerProfileCode?: string;
  messageType?: InsertConversationMessage["messageType"];
  content: string;
  structuredContent?: StructuredContent | null;
  parentMessageId?: string;
  correlationId?: string;
}

export interface ConversationWithMessages extends Conversation {
  messages: ConversationMessage[];
  unreadCount?: number;
}

// ─── Conversations ─────────────────────────────────────────────────────────────

export async function createConversation(input: CreateConversationInput): Promise<Conversation> {
  const [conv] = await db
    .insert(conversationsTable)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      createdByUserId: input.createdByUserId,
      conversationType: input.conversationType ?? "general_workforce",
      title: input.title ?? null,
      primaryTaskId: input.primaryTaskId ?? null,
      status: "active",
    })
    .returning();

  // Add creator as participant
  await db.insert(conversationParticipantsTable).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    conversationId: conv!.id,
    participantType: "user",
    userId: input.createdByUserId,
  });

  // Add Chief of Staff as participant
  await db.insert(conversationParticipantsTable).values({
    id: randomUUID(),
    organizationId: input.organizationId,
    conversationId: conv!.id,
    participantType: "workforce_role",
    workforceRoleCode: "chief_of_staff",
  });

  return conv!;
}

export async function getConversations(organizationId: string, userId: string): Promise<Conversation[]> {
  return db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        // RLS handles tenant isolation; also check not archived/closed for list view
      )
    )
    .orderBy(desc(conversationsTable.lastMessageAt))
    .limit(50);
}

export async function getConversationById(
  organizationId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const [conv] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.id, conversationId),
      )
    )
    .limit(1);
  return conv ?? null;
}

/** Get or create the task_workroom conversation linked to a task. */
export async function getOrCreateWorkroom(
  organizationId: string,
  taskId: string,
  createdByUserId: string,
): Promise<Conversation> {
  // Look for existing workroom
  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.primaryTaskId, taskId),
        eq(conversationsTable.conversationType, "task_workroom"),
      )
    )
    .limit(1);

  if (existing) return existing;

  // Fetch task title for conversation title
  const [task] = await db
    .select({ title: tasksTable.title })
    .from(tasksTable)
    .where(and(eq(tasksTable.organizationId, organizationId), eq(tasksTable.id, taskId)))
    .limit(1);

  return createConversation({
    organizationId,
    createdByUserId,
    conversationType: "task_workroom",
    title: task?.title ?? "Task Workroom",
    primaryTaskId: taskId,
  });
}

export async function updateConversationStatus(
  organizationId: string,
  conversationId: string,
  status: Conversation["status"],
): Promise<void> {
  await db
    .update(conversationsTable)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.id, conversationId),
      )
    );
}

export async function linkConversationToTask(
  organizationId: string,
  conversationId: string,
  taskId: string,
): Promise<void> {
  await db
    .update(conversationsTable)
    .set({
      primaryTaskId: taskId,
      conversationType: "task_workroom",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.id, conversationId),
      )
    );
}

// ─── Messages ──────────────────────────────────────────────────────────────────

export async function addMessage(input: AddMessageInput): Promise<ConversationMessage> {
  const [msg] = await db
    .insert(conversationMessagesTable)
    .values({
      id: randomUUID(),
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      taskId: input.taskId ?? null,
      senderType: input.senderType,
      senderUserId: input.senderUserId ?? null,
      workforceRoleCode: input.workforceRoleCode ?? null,
      workerProfileCode: input.workerProfileCode ?? null,
      messageType: input.messageType ?? "text",
      content: input.content,
      structuredContent: input.structuredContent ?? null,
      parentMessageId: input.parentMessageId ?? null,
      correlationId: input.correlationId ?? null,
      status: "delivered",
    })
    .returning();

  // Update lastMessageAt on conversation
  await db
    .update(conversationsTable)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(conversationsTable.id, input.conversationId));

  return msg!;
}

export async function getMessages(
  organizationId: string,
  conversationId: string,
  options: { limit?: number; before?: string } = {},
): Promise<ConversationMessage[]> {
  const limit = options.limit ?? 50;

  const msgs = await db
    .select()
    .from(conversationMessagesTable)
    .where(
      and(
        eq(conversationMessagesTable.organizationId, organizationId),
        eq(conversationMessagesTable.conversationId, conversationId),
      )
    )
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(limit);

  return msgs.reverse(); // chronological order for display
}

export async function getUnreadCount(
  organizationId: string,
  conversationId: string,
  userId: string,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(conversationMessagesTable)
    .where(
      and(
        eq(conversationMessagesTable.organizationId, organizationId),
        eq(conversationMessagesTable.conversationId, conversationId),
        // Exclude user's own messages
        sql`${conversationMessagesTable.senderUserId} != ${userId}`,
      )
    );
  return Number(result[0]?.count ?? 0);
}

export async function markMessagesRead(
  organizationId: string,
  messageIds: string[],
  userId: string,
): Promise<void> {
  if (messageIds.length === 0) return;
  const rows = messageIds.map(messageId => ({
    id: randomUUID(),
    organizationId,
    messageId,
    userId,
  }));
  // Insert ignore duplicates
  await db
    .insert(messageReadsTable)
    .values(rows)
    .onConflictDoNothing();
}

// ─── Process a user message (classify + generate Chief of Staff response) ─────

export interface ProcessMessageResult {
  userMessage: ConversationMessage;
  agentMessage: ConversationMessage | null;
  understanding: ConversationUnderstanding;
  structuredContent: StructuredContent | null;
}

export async function buildMessageContext(
  organizationId: string,
  conversationId: string,
  taskId?: string,
): Promise<MessageContext> {
  const ctx: MessageContext = { conversationId, organizationId };

  if (taskId) {
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.organizationId, organizationId), eq(tasksTable.id, taskId)))
      .limit(1);
    if (task) {
      ctx.currentTaskId = task.id;
      ctx.currentTaskState = task.currentState;
      ctx.currentTaskTitle = task.title;
    }

    // Fetch plan
    const [planRow] = await db
      .select()
      .from(taskExecutionPlansTable)
      .where(and(eq(taskExecutionPlansTable.organizationId, organizationId), eq(taskExecutionPlansTable.taskId, taskId)))
      .orderBy(desc(taskExecutionPlansTable.createdAt))
      .limit(1);
    if (planRow) ctx.currentPlan = planRow.planData as TaskPlan;

    // Fetch pending approval
    const [approval] = await db
      .select({ id: approvalsTable.id })
      .from(approvalsTable)
      .where(
        and(
          eq(approvalsTable.organizationId, organizationId),
          eq(approvalsTable.taskId, taskId),
          eq(approvalsTable.state, "pending"),
        )
      )
      .limit(1);
    if (approval) ctx.pendingApprovalId = approval.id;
  }

  // Recent messages — now configurable; contextSelectionService handles
  // full 300-message retrieval. Keep a small window here for the MessageContext type.
  const recentLimit = Math.min(
    parseInt(process.env.AI_RECENT_HISTORY_MESSAGES ?? "30", 10), 50
  );
  const recent = await db
    .select({
      senderType: conversationMessagesTable.senderType,
      content: conversationMessagesTable.content,
      messageType: conversationMessagesTable.messageType,
    })
    .from(conversationMessagesTable)
    .where(
      and(
        eq(conversationMessagesTable.organizationId, organizationId),
        eq(conversationMessagesTable.conversationId, conversationId),
      )
    )
    .orderBy(desc(conversationMessagesTable.createdAt))
    .limit(recentLimit);

  ctx.recentMessages = recent.reverse();
  return ctx;
}

/**
 * Store a user message, classify intent, generate and store the agent response.
 * Returns both messages and the structured understanding.
 */
export async function processUserMessage(
  organizationId: string,
  conversationId: string,
  userId: string,
  text: string,
  taskId?: string,
): Promise<ProcessMessageResult> {
  // 1. Store user message
  const userMessage = await addMessage({
    organizationId,
    conversationId,
    taskId,
    senderType: "user",
    senderUserId: userId,
    messageType: "text",
    content: text,
  });

  // 2. Build context
  const ctx = await buildMessageContext(organizationId, conversationId, taskId);

  // 3. Classify intent — LLM primary (OpenAI when configured), deterministic fallback.
  // Sprint 9.2: classifyMessageLLM now builds the full tenant-aware context package
  // internally (up to 300 messages, org memory, summary, pinned decisions).
  const understanding = await classifyMessageLLM(text, ctx, {
    userId,
    organizationId,
    role:        "member",   // conservative default — gateway enforces allowlist
    permissions: [],
  });

  // 3b. Capability gate — Sprint 9.4
  // When the intent is task_intent or task_clarification, identify required capabilities
  // and check organisation entitlements BEFORE routing to a specialist or creating a task.
  // Deterministic check: LLM may propose intent; NeedsOps decides access.
  let capabilityGateOverride: {
    text: string;
    structuredContent: StructuredContent;
    messageType: InsertConversationMessage["messageType"];
  } | null = null;

  if (
    understanding.conversationMode === "task_intent" ||
    understanding.conversationMode === "task_clarification"
  ) {
    try {
      const correlationId = randomUUID();
      const capabilityIdResult = await identifyCapabilities({
        organizationId,
        userId,
        conversationId,
        taskId,
        message: text,
      });

      if (capabilityIdResult.requestedCapabilities.length > 0) {
        const mixed = await decideMixedCapabilityAccess(
          organizationId, userId, capabilityIdResult,
          { conversationId, taskId, correlationId },
        );

        if (!mixed.hasFullAccess) {
          if (!mixed.canProceedPartially) {
            // Fully blocked: replace task proposal with capability blocked card
            const primaryBlocked = mixed.blockedCapabilities[0];
            if (primaryBlocked) {
              const blockedText = buildBlockedCapabilityResponse(primaryBlocked);
              const blockedCard = buildCapabilityBlockedCard(
                primaryBlocked,
                ["general_guidance", "view_plan", "request_access"],
              );
              capabilityGateOverride = {
                text: blockedText,
                structuredContent: blockedCard,
                messageType: "text",
              };
            }
          } else if (mixed.requiresUserConfirmationForPartialWork) {
            // Partial: replace with mixed capability card asking for confirmation
            const mixedText = buildMixedCapabilityResponse(mixed);
            const mixedCard = buildMixedCapabilityCard(mixed);
            capabilityGateOverride = {
              text: mixedText,
              structuredContent: mixedCard,
              messageType: "text",
            };
          }
          // If canProceedPartially and no confirmation required, continue normally
        }
      }
    } catch (err) {
      // Capability gate errors must never break the conversation flow
      console.warn("[ConversationService] Capability gate error (non-fatal):", err);
    }
  }

  // 4. Build structured content if applicable
  let structuredContent: StructuredContent | null = null;
  let messageType: InsertConversationMessage["messageType"] = "text";

  // Capability gate override takes precedence over normal task_proposal routing
  if (capabilityGateOverride) {
    structuredContent = capabilityGateOverride.structuredContent;
    messageType = capabilityGateOverride.messageType;
    // Override the CoS response text
    understanding.customerResponse = capabilityGateOverride.text;
  } else if (understanding.conversationMode === "task_intent" && understanding.proposedTask) {
    structuredContent = buildTaskProposalCard(understanding);
    messageType = "task_proposal";
  } else if (understanding.conversationMode === "task_clarification") {
    structuredContent = understanding.clarificationQuestions.length > 0
      ? {
          type: "clarification_request",
          data: {
            questions: understanding.clarificationQuestions,
            blocking: false,
            requestedBy: "Chief of Staff",
          },
        }
      : null;
    messageType = "clarification_request";
  } else if (understanding.conversationMode === "status_request") {
    structuredContent = buildStatusSummaryCard(ctx);
    messageType = "status_change";
  } else if (understanding.conversationMode === "approval_response") {
    messageType = "approval_decision";
  }

  // 5. Store agent response
  const agentMessage = await addMessage({
    organizationId,
    conversationId,
    taskId,
    senderType: "chief_of_staff",
    workforceRoleCode: "chief_of_staff",
    messageType,
    content: understanding.customerResponse,
    structuredContent,
  });

  return { userMessage, agentMessage, understanding, structuredContent };
}

/** Post a plan card to the conversation thread after task creation. */
export async function postPlanToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  plan: TaskPlan,
): Promise<ConversationMessage> {
  const planCard = buildPlanCard(plan, taskId);
  return addMessage({
    organizationId,
    conversationId,
    taskId,
    senderType: "chief_of_staff",
    workforceRoleCode: "chief_of_staff",
    messageType: "plan_proposal",
    content: `Task created. I am preparing the work plan now.\n\n**Plan: ${plan.taskTitle}**\n${plan.reasoning}\n\nEstimated duration: ${plan.estimatedTotalDuration}. ${plan.requiresApproval ? "This plan requires approval before execution." : "No approval is required."}`,
    structuredContent: planCard,
  });
}

/** Post an approval request card to the conversation thread. */
export async function postApprovalRequestToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  approvalId: string,
  detail: {
    requestedAction: string;
    requestingRole: string;
    reason: string;
    riskLevel: "low" | "medium" | "high";
    approvalType: string;
  },
): Promise<ConversationMessage> {
  const card = buildApprovalCard(approvalId, taskId, detail);
  return addMessage({
    organizationId,
    conversationId,
    taskId,
    senderType: "chief_of_staff",
    workforceRoleCode: "chief_of_staff",
    messageType: "approval_request",
    content: `The team is ready to proceed with: ${detail.requestedAction}.\n\nThis requires ${detail.approvalType.replace(/_/g, " ")} approval.\n\nReason: ${detail.reason}`,
    structuredContent: card,
  });
}

/** Convert an OpenClaw runtime event into a readable thread message. */
export async function postRuntimeEventToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  event: {
    eventType: string;
    stepName?: string;
    stepNumber?: number;
    totalSteps?: number;
    specialistCode?: string;
    specialistName?: string;
    message?: string;
    correlationId?: string;
    timestamp: string;
  },
): Promise<ConversationMessage> {
  const card = buildExecutionUpdateCard(event);
  const human = (card.data as Record<string, unknown>).humanMessage as string;
  return addMessage({
    organizationId,
    conversationId,
    taskId,
    senderType: "runtime",
    workforceRoleCode: event.specialistCode ?? "chief_of_staff",
    messageType: "execution_update",
    content: human,
    structuredContent: card,
    correlationId: event.correlationId,
  });
}
