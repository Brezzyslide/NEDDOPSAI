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
// Sprint 29H.2 — Action State Decision Contract (Part B)
// Note: dispatchWorkExecution lives in executionCoordinatorService which already
// imports from conversationService — wiring is in the route/ingress layer instead.
import { resolveConversationActionState } from "./conversationActionStateService.js";
import { resolveActionDecision, type ConversationActionDecision } from "./conversationActionDecisionService.js";
import { shouldTriggerSummarisation, updateConversationSummary } from "./conversationMemoryService.js";
import { detectAndProposeConversationKnowledge } from "./conversationLearningService.js";
import { planTask, type TaskPlan } from "./chiefOfStaffService.js";
// Sprint 29M — Three-lane execution classifier
import {
  classifyExecutionRequest,
  type ExecutionClassification,
} from "./executionClassifierService.js";
import { extractDocumentSearchTerms } from "./conversationContextBuilder.js";
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

/**
 * Find an existing active general_workforce conversation for this user, or create one.
 * Prevents a new conversation from being created on every page load, which was
 * causing messages to disappear after SSE delivery.
 */
export async function findOrCreateGeneralConversation(
  organizationId: string,
  userId: string,
): Promise<{ conversation: Conversation; created: boolean }> {
  // Look for an active general_workforce conversation created by this user
  const [existing] = await db
    .select()
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.createdByUserId, userId),
        eq(conversationsTable.conversationType, "general_workforce"),
        eq(conversationsTable.status, "active"),
      )
    )
    .orderBy(sql`${conversationsTable.lastMessageAt} DESC NULLS LAST, ${conversationsTable.createdAt} DESC`)
    .limit(1);

  if (existing) return { conversation: existing, created: false };

  const conversation = await createConversation({
    organizationId,
    createdByUserId: userId,
    conversationType: "general_workforce",
    title: "Workforce Chat",
  });
  return { conversation, created: true };
}

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
  // Safety guard: general_workforce conversations must remain reusable and must
  // not be permanently bound to a single task through primaryTaskId.  Callers
  // that need to associate a task with a front-desk conversation should create a
  // dedicated task_workroom via getOrCreateWorkroom() instead.
  //
  // This guard fires only if a call site that has not been updated still reaches
  // this function for a general_workforce conversation — it is defensive, not the
  // primary enforcement (which lives in autoDispatchService and the route layer).
  const [conv] = await db
    .select({ conversationType: conversationsTable.conversationType })
    .from(conversationsTable)
    .where(
      and(
        eq(conversationsTable.organizationId, organizationId),
        eq(conversationsTable.id, conversationId),
      ),
    )
    .limit(1);

  if (conv?.conversationType === "general_workforce") {
    console.warn(
      `[conversationService] linkConversationToTask blocked for general_workforce ` +
      `conversation ${conversationId}. Use getOrCreateWorkroom() for task association.`,
    );
    return;
  }

  // Only record the primaryTaskId — do NOT change conversationType.
  // Mutating a general_workforce conversation to task_workroom causes
  // findOrCreateGeneralConversation to miss it on the next page load
  // and spin up a brand-new empty conversation, losing all chat history.
  await db
    .update(conversationsTable)
    .set({
      primaryTaskId: taskId,
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

  // Root-cause guard: if the DB INSERT RETURNING yielded no row the non-null
  // assertion `msg!` would silently return `undefined` at runtime (TypeScript `!`
  // is compile-time only). Throw explicitly so callers receive a proper error
  // instead of an undefined value that propagates to SSE clients and crashes the
  // frontend when the Sprint 27.2 idempotent handler accesses `msg.id`.
  if (!msg) {
    throw new Error(
      `[addMessage] INSERT RETURNING yielded no row for conversation ${input.conversationId}. ` +
      "Check RLS policies — a WITH CHECK violation can silently drop the insert.",
    );
  }

  // Update lastMessageAt on conversation
  await db
    .update(conversationsTable)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(conversationsTable.id, input.conversationId));

  return msg;
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
  /** Sprint 29H.2 — deterministic platform action decision after CoS classification */
  actionDecision?: ConversationActionDecision;
  /**
   * Sprint 29M — Three-lane execution classification.
   * "transient" means: do NOT trigger autoCreateAndDispatch or work-product lifecycle.
   * The CoS customerResponse is sufficient and should stay in Chat.
   */
  executionClassification?: ExecutionClassification;
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

  // Sprint 28.4: flag whether a task_proposal/plan_proposal message already exists
  // (used by the action state resolver without an additional DB round-trip)
  ctx.proposalExists = ctx.recentMessages.some(
    m => m.messageType === "task_proposal" || m.messageType === "plan_proposal"
  );

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
  correlationId?: string,
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
    correlationId,
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

  // 3b. Sprint 29M — Three-lane execution classifier.
  // Runs immediately after CoS classification, using only already-computed signals.
  // "transient" classification means the caller must NOT trigger autoCreateAndDispatch
  // or any work-product lifecycle step — the chat response is sufficient.
  const executionClassification = classifyExecutionRequest({
    userRequest: text,
    conversationMode: understanding.conversationMode,
    proposedTask: understanding.proposedTask as Record<string, unknown> | null,
    confidence: understanding.confidence,
    shouldDispatchSpecialists: understanding.shouldDispatchSpecialists ?? false,
    extractedSearchTerms: extractDocumentSearchTerms(text),
    trigger: "conversation",
  });

  // 3c. Capability gate — Sprint 9.4
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

  // 3c. Sprint 29H.2 — Resolve deterministic action decision (Part B)
  // Called after LLM classification. Converts semantic intent + DB state into
  // a typed platform operation returned to the caller.
  //
  // Part C dispatch (rerun_existing / revise_existing / create_new_work) is
  // wired in the route/ingress layer to avoid a circular dependency:
  // executionCoordinatorService already imports from conversationService.
  let actionDecision: ConversationActionDecision | undefined;
  try {
    const actionState = await resolveConversationActionState({
      organisationId: organizationId,
      conversationId,
      recentMessages: (ctx.recentMessages ?? []).map(m => ({
        messageType: m.messageType ?? "text",
        content: m.content ?? "",
      })),
      taskId: taskId ?? ctx.currentTaskId,
    });
    actionDecision = resolveActionDecision(text, understanding, actionState);
  } catch (err) {
    // Action decision errors must never break conversation flow
    console.warn("[ConversationService] Action decision failed (non-fatal):", (err as Error)?.message);
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

  // Sprint 21: Conversation Learning — detect candidate org knowledge (fire-and-forget)
  if (agentMessage) {
    detectAndProposeConversationKnowledge(
      organizationId,
      text,
      userId,
      conversationId,
    ).catch(() => {});
  }

  return { userMessage, agentMessage, understanding, structuredContent, actionDecision, executionClassification };
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

// ─── Sprint 27: Execution lifecycle conversation messages ─────────────────────

/**
 * Posts an "execution started" system message to the conversation.
 * Called immediately after an intent is approved or a task is dispatched.
 */
export async function postExecutionStartedToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  correlationId: string,
): Promise<ConversationMessage> {
  const card = buildExecutionUpdateCard({
    eventType: "execution.started",
    timestamp: new Date().toISOString(),
  });
  return addMessage({
    organizationId,
    conversationId,
    taskId: taskId || undefined,
    senderType: "runtime",
    workforceRoleCode: "chief_of_staff",
    messageType: "execution_update",
    content: "Work has begun. I'll keep you updated as progress is made.",
    structuredContent: card,
    correlationId,
  });
}

/**
 * Posts a progress stage message to the conversation.
 * Called at each pipeline stage (selecting blueprint, assembling package, etc.).
 */
export async function postExecutionProgressToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  stage: string,
  correlationId: string,
): Promise<ConversationMessage> {
  const STAGE_LABELS: Record<string, string> = {
    selecting_blueprint:     "Selecting work blueprint…",
    assembling_package:      "Reviewing organisational knowledge…",
    validating:              "Validating requirements…",
    retrieving_examples:     "Consulting approved work examples…",
    executing:               "Consulting specialist…",
    reviewing:               "Running quality review…",
    creating_completed_work: "Preparing completed work document…",
  };
  const humanLabel = STAGE_LABELS[stage] ?? stage;

  const card = buildExecutionUpdateCard({
    eventType: "execution.step_started",
    stepName: humanLabel,
    timestamp: new Date().toISOString(),
  });
  return addMessage({
    organizationId,
    conversationId,
    taskId: taskId || undefined,
    senderType: "runtime",
    workforceRoleCode: "chief_of_staff",
    messageType: "execution_update",
    content: humanLabel,
    structuredContent: card,
    correlationId,
  });
}

/**
 * Posts a "completed work created" system message to the conversation.
 *
 * The message content is derived from the PERSISTED CompletedWork status —
 * never assumed. This prevents the CoS from saying "ready for your approval"
 * when submitForApproval() failed and the record is still in draft.
 *
 * Status-to-message mapping:
 *   awaiting_approval → "ready for your approval" + direct reference
 *   draft             → "saved as a draft for your review" + direct reference
 *   approved          → "has been completed and approved" + direct reference
 *   any other         → generic "ready for your review" + direct reference
 *
 * Always includes a direct reference to the CompletedWork item ID so users
 * can navigate to it without hunting through portal tabs.
 */
export async function postCompletedWorkCreatedToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  completedWorkId: string,
  title: string,
  completedWorkStatus: string,
  qualityScore: number | null,
  correlationId: string,
): Promise<ConversationMessage> {
  const scoreNote = qualityScore !== null
    ? ` Quality score: ${qualityScore}/100.`
    : "";

  // Status-aware action line — must reflect the actual persisted state.
  let actionLine: string;
  switch (completedWorkStatus) {
    case "awaiting_approval":
      actionLine = `"${title}" is ready for your approval. You'll find it under **Awaiting Approval** in the Completed Work portal (ref: \`${completedWorkId}\`).`;
      break;
    case "approved":
      actionLine = `"${title}" has been completed and approved. You'll find it in the Completed Work portal (ref: \`${completedWorkId}\`).`;
      break;
    case "draft":
      actionLine = `"${title}" has been saved as a draft. Open it from the Completed Work portal and click **Submit for Approval** when ready (ref: \`${completedWorkId}\`).`;
      break;
    default:
      actionLine = `"${title}" is ready for your review in the Completed Work portal (ref: \`${completedWorkId}\`).`;
  }

  const card = buildExecutionUpdateCard({
    eventType: "execution.completed",
    message: completedWorkId,
    timestamp: new Date().toISOString(),
  });

  // Augment the card data with completed work details
  (card.data as Record<string, unknown>).completedWorkId = completedWorkId;
  (card.data as Record<string, unknown>).completedWorkStatus = completedWorkStatus;
  (card.data as Record<string, unknown>).title = title;
  (card.data as Record<string, unknown>).qualityScore = qualityScore;

  return addMessage({
    organizationId,
    conversationId,
    taskId: taskId || undefined,
    senderType: "chief_of_staff",
    workforceRoleCode: "chief_of_staff",
    messageType: "execution_update",
    content: `The work is complete.${scoreNote} ${actionLine}`,
    structuredContent: card,
    correlationId,
  });
}

/**
 * Posts an "execution failed" system message to the conversation.
 * Always called — failures must never be silent.
 */
export async function postExecutionFailedToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  errorMessage: string,
  correlationId: string,
): Promise<ConversationMessage> {
  const card = buildExecutionUpdateCard({
    eventType: "execution.failed",
    message: errorMessage,
    timestamp: new Date().toISOString(),
  });
  (card.data as Record<string, unknown>).errorMessage = errorMessage;

  return addMessage({
    organizationId,
    conversationId,
    taskId: taskId || undefined,
    senderType: "runtime",
    workforceRoleCode: "chief_of_staff",
    messageType: "execution_update",
    content: `I encountered a problem completing this work: ${errorMessage} Please check the requirements and try again, or contact support if the issue persists.`,
    structuredContent: card,
    correlationId,
  });
}

/**
 * Posts a clarification request from the execution pipeline to the conversation.
 * Called when validation requires the user to provide missing information before
 * execution can continue. The execution is paused (checkpointed), not failed.
 */
export async function postClarificationRequestToConversation(
  organizationId: string,
  conversationId: string,
  taskId: string,
  clarificationQuestions: string[],
  correlationId: string,
): Promise<ConversationMessage> {
  const questionList = clarificationQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n");
  const card = buildExecutionUpdateCard({
    eventType: "execution.awaiting_approval",
    message: `Clarification required before work can continue.`,
    timestamp: new Date().toISOString(),
  });
  (card.data as Record<string, unknown>).clarificationQuestions = clarificationQuestions;
  (card.data as Record<string, unknown>).eventType = "execution.paused";

  return addMessage({
    organizationId,
    conversationId,
    taskId: taskId || undefined,
    senderType: "chief_of_staff",
    workforceRoleCode: "chief_of_staff",
    messageType: "execution_update",
    content: `Before I continue, I need a little more information:\n\n${questionList}\n\nPlease reply with the details above and I'll pick up right where I left off.`,
    structuredContent: card,
    correlationId,
  });
}

// ─── Runtime event (OpenClaw) ──────────────────────────────────────────────────

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
