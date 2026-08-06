/**
 * Conversation Action State Service — Sprint 28.4
 *
 * Resolves the current action state of a Chief of Staff conversation from
 * authoritative platform records (DB only — never from conversation text).
 *
 * The action state determines what the Chief of Staff may truthfully claim:
 * - Actions that have occurred (past tense)
 * - Actions that are currently happening (present progressive)
 * - Actions that are definitively possible (confirmed future)
 *
 * Security: No action state is inferred from LLM output or message content.
 * State is derived exclusively from platform records (tasks, specialists,
 * execution intents, completed work).
 */

import { db } from "@workspace/db";
import {
  taskSpecialistsTable,
  executionIntentsTable,
  completedWorkTable,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

// ─── Action State Level ────────────────────────────────────────────────────────

/**
 * Ordered lifecycle of a conversation action.
 * Each level defines what the CoS may truthfully claim.
 */
export type ActionStateLevel =
  | "informational"          // No task or proposal — discovery phase
  | "proposal_ready"         // LLM has enough info to propose but hasn't yet
  | "proposal_created"       // A task_proposal message exists in conversation
  | "awaiting_confirmation"  // Proposal shown; user must confirm
  | "task_created"           // Task record created; no specialist assigned yet
  | "specialist_assigned"    // Specialist(s) assigned; execution not yet dispatched
  | "execution_dispatched"   // Execution intent approved/dispatched; not yet started
  | "execution_started"      // Execution runtime has started work
  | "awaiting_clarification" // Work paused; clarification checkpoint active
  | "completed"              // Completed Work record exists
  | "failed";                // Task or execution failed/rejected

// ─── Allowed and disallowed claims per level ─────────────────────────────────

export interface AllowedClaims {
  allowed: readonly string[];
  disallowed: readonly string[];
  becauseExplanation: string;
}

const CLAIMS_BY_LEVEL: Record<ActionStateLevel, AllowedClaims> = {
  informational: {
    allowed: [
      "The specialist is available",
      "I can prepare a task proposal",
      "Shall I prepare the task?",
      "I can propose the specialist as lead",
    ],
    disallowed: [
      "assigned / delegated / allocated",
      "I have assigned / I've assigned / has been assigned",
      "I will proceed (without confirmation)",
      "I am coordinating / the team is working on it",
      "started / underway / in progress / reviewing now",
      "completed / finished / delivered",
    ],
    becauseExplanation: "No task or proposal exists yet. You are in the discovery phase.",
  },
  proposal_ready: {
    allowed: [
      "I can prepare a task proposal",
      "I can propose the specialist as lead",
      "Shall I create the task?",
    ],
    disallowed: [
      "assigned / delegated / allocated",
      "I have assigned / I will proceed",
      "started / underway / completed",
    ],
    becauseExplanation: "You have enough information to propose a task but no proposal has been created yet.",
  },
  proposal_created: {
    allowed: [
      "I've prepared a task proposal",
      "I have prepared a proposal for your review",
      "Confirm and I'll create the task",
      "The proposal is ready for your review",
    ],
    disallowed: [
      "assigned / delegated (no task created yet)",
      "started / underway / in progress",
      "completed / finished / delivered",
    ],
    becauseExplanation: "A proposal exists but has not been confirmed. No task has been created.",
  },
  awaiting_confirmation: {
    allowed: [
      "Confirm and I'll create the task",
      "I've prepared a proposal for your review",
    ],
    disallowed: [
      "assigned / started / underway / completed",
    ],
    becauseExplanation: "The proposal is awaiting user confirmation. No task has been created.",
  },
  task_created: {
    allowed: [
      "The task has been created",
      "I've created a task for this work",
    ],
    disallowed: [
      "assigned (no specialist assigned yet)",
      "started / underway / in progress",
      "completed / finished",
    ],
    becauseExplanation: "A task exists but no specialist has been assigned.",
  },
  specialist_assigned: {
    allowed: [
      "The specialist has been assigned",
      "The Operations Manager has been assigned",
    ],
    disallowed: [
      "started / underway / in progress (execution not yet dispatched)",
      "completed / finished",
    ],
    becauseExplanation: "Specialist is assigned but execution has not started.",
  },
  execution_dispatched: {
    allowed: [
      "The task has been sent to the specialist",
      "Work is being prepared",
      "The specialist is being briefed",
    ],
    disallowed: [
      "has started (not confirmed started yet)",
      "is reviewing now (not yet started)",
      "completed / finished",
    ],
    becauseExplanation: "Execution was dispatched but runtime confirmation of start has not been received.",
  },
  execution_started: {
    allowed: [
      "The specialist has started",
      "Work is underway",
      "The review is in progress",
    ],
    disallowed: [
      "completed / finished / delivered (not yet done)",
    ],
    becauseExplanation: "Execution is actively running.",
  },
  awaiting_clarification: {
    allowed: [
      "Clarification is needed before proceeding",
      "I need one piece of information to continue",
    ],
    disallowed: [
      "assigned / started / completed (work is paused)",
    ],
    becauseExplanation: "Work is paused pending clarification from the user.",
  },
  completed: {
    allowed: [
      "The review is complete",
      "The work has been completed",
      "A completed work record has been created",
    ],
    disallowed: [],
    becauseExplanation: "Work is complete.",
  },
  failed: {
    allowed: [
      "The task encountered an error",
      "The work could not be completed",
    ],
    disallowed: [
      "completed / successful",
    ],
    becauseExplanation: "The task or execution failed.",
  },
};

// ─── Output type ──────────────────────────────────────────────────────────────

export interface ConversationActionState {
  level: ActionStateLevel;
  proposalExists: boolean;
  proposalMessageId?: string;
  taskExists: boolean;
  taskId?: string;
  taskState?: string;
  assignedSpecialists: string[];
  executionIntentExists: boolean;
  executionStatus?: string;
  completedWorkId?: string;
  allowedClaims: readonly string[];
  disallowedClaims: readonly string[];
  becauseExplanation: string;
}

// ─── Resolver ─────────────────────────────────────────────────────────────────

export async function resolveConversationActionState(input: {
  organisationId: string;
  conversationId: string;
  recentMessages: Array<{ messageType: string; content: string }>;
  taskId?: string;
  executionIntentId?: string;
}): Promise<ConversationActionState> {
  const { organisationId, conversationId, recentMessages, taskId, executionIntentId } = input;

  if (!organisationId || !conversationId) {
    return makeState("informational", false, undefined, false, undefined, [], false, undefined, undefined);
  }

  // 1. Proposal existence — check recent message types (no extra DB query needed)
  const proposalMsg = recentMessages.find(
    m => m.messageType === "task_proposal" || m.messageType === "plan_proposal"
  );
  const proposalExists = !!proposalMsg;

  // 2. Specialist assignments (only if task exists)
  let assignedSpecialists: string[] = [];
  if (taskId) {
    try {
      const rows = await db
        .select({ specialistId: taskSpecialistsTable.specialistId })
        .from(taskSpecialistsTable)
        .where(
          and(
            eq(taskSpecialistsTable.taskId, taskId),
            eq(taskSpecialistsTable.organizationId, organisationId),
          )
        )
        .limit(100);
      assignedSpecialists = rows.map(r => r.specialistId ?? "").filter(Boolean);
    } catch (e) {
      console.warn("[ActionState] specialists query failed:", e instanceof Error ? e.message : e);
    }
  }

  // 3. Execution intent (most recent for task, or by explicit id)
  let executionStatus: string | undefined;
  let executionIntentExists = false;
  if (taskId || executionIntentId) {
    try {
      const [intent] = await db
        .select({ status: executionIntentsTable.status })
        .from(executionIntentsTable)
        .where(
          executionIntentId
            ? and(
                eq(executionIntentsTable.id, executionIntentId),
                eq(executionIntentsTable.organizationId, organisationId),
              )
            : and(
                eq(executionIntentsTable.taskId, taskId!),
                eq(executionIntentsTable.organizationId, organisationId),
              )
        )
        .orderBy(desc(executionIntentsTable.createdAt))
        .limit(1);

      if (intent) {
        executionIntentExists = true;
        executionStatus = intent.status;
      }
    } catch (e) {
      console.warn("[ActionState] execution intent query failed:", e instanceof Error ? e.message : e);
    }
  }

  // 4. Completed work (by conversation — most recent)
  let completedWorkId: string | undefined;
  try {
    const [cw] = await db
      .select({ id: completedWorkTable.id })
      .from(completedWorkTable)
      .where(
        and(
          eq(completedWorkTable.organizationId, organisationId),
          eq(completedWorkTable.conversationId, conversationId),
        )
      )
      .orderBy(desc(completedWorkTable.createdAt))
      .limit(1);
    if (cw) completedWorkId = cw.id;
  } catch (e) {
    console.warn("[ActionState] completed_work query failed:", e instanceof Error ? e.message : e);
  }

  // 5. Resolve level
  const level = resolveLevel({
    proposalExists,
    taskId,
    assignedSpecialists,
    executionIntentExists,
    executionStatus,
    completedWorkId,
  });

  return makeState(level, proposalExists, taskId, !!taskId, undefined, assignedSpecialists, executionIntentExists, executionStatus, completedWorkId);
}

function resolveLevel(s: {
  proposalExists: boolean;
  taskId?: string;
  assignedSpecialists: string[];
  executionIntentExists: boolean;
  executionStatus?: string;
  completedWorkId?: string;
}): ActionStateLevel {
  if (s.completedWorkId) return "completed";

  if (s.executionIntentExists && s.executionStatus) {
    const st = s.executionStatus;
    if (st === "completed") return "completed";
    if (st === "rejected" || st === "cancelled") return "failed";
    if (st === "dispatched") return "execution_started";
    if (st === "approved") return "execution_dispatched";
    // prepared / pending_approval → fall through to task_created / specialist_assigned
  }

  if (s.taskId) {
    if (s.assignedSpecialists.length > 0) return "specialist_assigned";
    return "task_created";
  }

  if (s.proposalExists) return "proposal_created";

  return "informational";
}

function makeState(
  level: ActionStateLevel,
  proposalExists: boolean,
  taskId: string | undefined,
  taskExists: boolean,
  taskState: string | undefined,
  assignedSpecialists: string[],
  executionIntentExists: boolean,
  executionStatus: string | undefined,
  completedWorkId: string | undefined,
): ConversationActionState {
  const claims = CLAIMS_BY_LEVEL[level];
  return {
    level,
    proposalExists,
    taskExists,
    taskId,
    taskState,
    assignedSpecialists,
    executionIntentExists,
    executionStatus,
    completedWorkId,
    allowedClaims: claims.allowed,
    disallowedClaims: claims.disallowed,
    becauseExplanation: claims.becauseExplanation,
  };
}

// ─── Prompt section builder ────────────────────────────────────────────────────

const LEVEL_LABEL: Record<ActionStateLevel, string> = {
  informational:          "informational (no task or proposal yet)",
  proposal_ready:         "proposal_ready",
  proposal_created:       "proposal_created (awaiting user confirmation)",
  awaiting_confirmation:  "awaiting_confirmation",
  task_created:           "task_created (task exists, no specialist assigned)",
  specialist_assigned:    "specialist_assigned",
  execution_dispatched:   "execution_dispatched (sent to runtime, not yet started)",
  execution_started:      "execution_started (specialist is actively working)",
  awaiting_clarification: "awaiting_clarification (work paused)",
  completed:              "completed",
  failed:                 "failed",
};

/**
 * Build the === CURRENT ACTION STATE === context section for the LLM prompt.
 * Injected before workforce/presence sections and before the user message.
 */
export function buildActionStateSection(state: ConversationActionState): string {
  const lines: string[] = [
    "=== CURRENT ACTION STATE ===",
    "",
    `Level: ${LEVEL_LABEL[state.level]}`,
  ];

  if (state.assignedSpecialists.length > 0) {
    lines.push(`Assigned specialists: ${state.assignedSpecialists.join(", ")}`);
  }
  if (state.executionStatus) {
    lines.push(`Execution status: ${state.executionStatus}`);
  }

  lines.push("", "Allowed claims:");
  for (const c of state.allowedClaims) {
    lines.push(`- ${c}`);
  }

  if (state.disallowedClaims.length > 0) {
    lines.push("", "Disallowed claims (not supported by platform state):");
    for (const c of state.disallowedClaims) {
      lines.push(`- ${c}`);
    }
  }

  lines.push("", `Because: ${state.becauseExplanation}`);

  return lines.join("\n");
}
