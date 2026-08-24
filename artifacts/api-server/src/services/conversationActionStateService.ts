/**
 * Conversation Action State Service — Sprint 28.4 / 29H.2
 *
 * Resolves the current action state of a Chief of Staff conversation from
 * authoritative platform records (DB only — never from conversation text).
 *
 * Sprint 29H.2 changes:
 * - Removed unconditional completedWorkId → "completed" short-circuit (Part A).
 *   Historical completed work is now surfaced as grounded metadata context
 *   (Part D) without overriding the level for active execution state.
 * - Added CompletedWorkRecord with full persisted provenance.
 * - buildActionStateSection now exposes grounded completed-work metadata
 *   including primarySpecialist, status, title, createdAt, qualityScore.
 */

import { db } from "@workspace/db";
import {
  tasksTable,
  taskSpecialistsTable,
  executionIntentsTable,
  completedWorkTable,
  completedWorkVersionsTable,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

// ─── Action State Level ────────────────────────────────────────────────────────

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
  | "completed"              // Current execution intent is completed
  | "failed";                // Task or execution failed/rejected

// ─── Grounded completed-work metadata ─────────────────────────────────────────

/**
 * Persisted metadata from completed_work + current version.
 * Injected into the LLM prompt as grounded context (Part D).
 */
export interface CompletedWorkRecord {
  id: string;
  status: string;
  title: string;
  primarySpecialist: string;
  createdAt: Date | null;
  approvedAt: Date | null;
  qualityScore: number | null;
}

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
      "The Operations Manager has been assigned to this task",
    ],
    disallowed: [
      "started / underway / in progress (execution not yet dispatched)",
      "completed / finished",
    ],
    becauseExplanation: "Specialist is assigned to the task but execution has not started.",
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
  /** Specialists assigned to the task record (task intent, not execution provenance). */
  assignedSpecialists: string[];
  executionIntentExists: boolean;
  executionStatus?: string;
  /** ID of the most recent completed_work in this conversation (kept for compatibility). */
  completedWorkId?: string;
  /**
   * Full grounded metadata of the most recent completed_work (Part D).
   * primarySpecialist reflects who actually produced the work — distinct from
   * assignedSpecialists which reflects who was assigned to the task.
   */
  completedWork?: CompletedWorkRecord;
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
    return makeState("informational", false, undefined, false, undefined, [], false, undefined, undefined, undefined);
  }

  // 1. Proposal existence — check recent message types (no extra DB query needed)
  const proposalMsg = recentMessages.find(
    m => m.messageType === "task_proposal" || m.messageType === "plan_proposal"
  );
  const proposalExists = !!proposalMsg;

  // 2. Specialist assignments (only if task exists)
  let taskState: string | undefined;
  if (taskId) {
    try {
      const [task] = await db
        .select({ currentState: tasksTable.currentState })
        .from(tasksTable)
        .where(
          and(
            eq(tasksTable.id, taskId),
            eq(tasksTable.organizationId, organisationId),
          )
        )
        .limit(1);
      taskState = task?.currentState;
    } catch (e) {
      console.warn("[ActionState] task query failed:", e instanceof Error ? e.message : e);
    }
  }

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

  // 4. Completed work — fetch full provenance metadata (Part D).
  //    The primary_specialist field is the actual producer of the work.
  //    This is DISTINCT from assignedSpecialists (the task assignment).
  //    Sprint 29H.2: no longer drives level resolution (Part A).
  let completedWorkId: string | undefined;
  let completedWork: CompletedWorkRecord | undefined;
  try {
    const [cw] = await db
      .select({
        id:               completedWorkTable.id,
        status:           completedWorkTable.status,
        title:            completedWorkTable.title,
        primarySpecialist: completedWorkTable.primarySpecialist,
        createdAt:        completedWorkTable.createdAt,
        approvedAt:       completedWorkTable.approvedAt,
        qualityScore:     completedWorkVersionsTable.qualityScore,
      })
      .from(completedWorkTable)
      .leftJoin(
        completedWorkVersionsTable,
        eq(completedWorkVersionsTable.id, completedWorkTable.currentVersionId),
      )
      .where(
        and(
          eq(completedWorkTable.organizationId, organisationId),
          eq(completedWorkTable.conversationId, conversationId),
        )
      )
      .orderBy(desc(completedWorkTable.createdAt))
      .limit(1);

    if (cw) {
      completedWorkId = cw.id;
      completedWork = {
        id:               cw.id,
        status:           cw.status,
        title:            cw.title,
        primarySpecialist: cw.primarySpecialist,
        createdAt:        cw.createdAt,
        approvedAt:       cw.approvedAt,
        qualityScore:     cw.qualityScore ?? null,
      };
    }
  } catch (e) {
    console.warn("[ActionState] completed_work query failed:", e instanceof Error ? e.message : e);
  }

  // 5. Resolve level.
  //    Sprint 29H.2 (Part A): historical completed work no longer overrides level.
  //    Level reflects current active execution state only. Historical completed
  //    work is surfaced as grounded context via completedWork field.
  const level = resolveLevel({
    proposalExists,
    taskId,
    taskState,
    assignedSpecialists,
    executionIntentExists,
    executionStatus,
    // completedWorkId intentionally excluded from level resolution
  });

  return makeState(level, proposalExists, taskId, !!taskId, taskState, assignedSpecialists, executionIntentExists, executionStatus, completedWorkId, completedWork);
}

function resolveLevel(s: {
  proposalExists: boolean;
  taskId?: string;
  taskState?: string;
  assignedSpecialists: string[];
  executionIntentExists: boolean;
  executionStatus?: string;
}): ActionStateLevel {
  // Sprint 29H.2: removed `if (s.completedWorkId) return "completed"`.
  // Historical completed work is shown as grounded context (Part D) but does
  // NOT override the active execution state level.

  if (s.taskState === "failed" || s.taskState === "cancelled") return "failed";
  if (s.taskState === "completed") return "completed";

  if (s.executionIntentExists && s.executionStatus) {
    const st = s.executionStatus;
    if (st === "completed") return "completed";
    if (st === "rejected" || st === "cancelled") return "failed";
    if (st === "dispatched") return "execution_started";
    if (st === "approved") return "execution_dispatched";
    // prepared / pending_approval → fall through to task_created / specialist_assigned
  }

  if (s.taskId) {
    if (s.taskState === "executing") return "execution_started";
    if (s.taskState === "awaiting_approval") return "execution_dispatched";
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
  completedWork: CompletedWorkRecord | undefined,
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
    completedWork,
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
  specialist_assigned:    "specialist_assigned (task has an assigned specialist; no active execution)",
  execution_dispatched:   "execution_dispatched (sent to runtime, not yet started)",
  execution_started:      "execution_started (specialist is actively working)",
  awaiting_clarification: "awaiting_clarification (work paused)",
  completed:              "completed (execution just finished)",
  failed:                 "failed",
};

/**
 * Build the === CURRENT ACTION STATE === context section for the LLM prompt.
 *
 * Sprint 29H.2 (Part D): when historical completed work exists, a grounded
 * === HISTORICAL COMPLETED WORK === block is appended with persisted metadata
 * including primarySpecialist (who actually produced the work), status, title,
 * createdAt, approvedAt, and qualityScore.
 *
 * CRITICAL: assignedSpecialists = who was assigned to the task record.
 * primarySpecialist = who actually produced the completed work output.
 * These must never be conflated in LLM attribution.
 */
export function buildActionStateSection(state: ConversationActionState): string {
  const lines: string[] = [
    "=== CURRENT ACTION STATE ===",
    "",
    `Level: ${LEVEL_LABEL[state.level]}`,
  ];

  if (state.assignedSpecialists.length > 0) {
    lines.push(
      `Task-assigned specialists: ${state.assignedSpecialists.join(", ")}`,
      "(These specialists are assigned to the task record — not necessarily who produced the completed work.)",
    );
  }
  if (state.executionStatus) {
    lines.push(`Execution status: ${state.executionStatus}`);
  }
  if (state.taskState) {
    lines.push(`Authoritative task state: ${state.taskState}`);
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

  // ── Part D: Grounded historical completed-work block ─────────────────────
  // Injected when a completed_work record exists for this conversation.
  // Provides persisted provenance the CoS must use for attribution.
  if (state.completedWork) {
    const cw = state.completedWork;
    const createdStr = cw.createdAt ? cw.createdAt.toISOString() : "unknown";

    lines.push(
      "",
      "=== HISTORICAL COMPLETED WORK ===",
      `Completed Work ID: ${cw.id}`,
      `Title: ${cw.title}`,
      `Status: ${cw.status}`,
      `Primary specialist who produced this work: ${cw.primarySpecialist}`,
      `Created at: ${createdStr}`,
    );

    if (cw.approvedAt) {
      lines.push(`Approved at: ${cw.approvedAt.toISOString()}`);
    }
    if (cw.qualityScore != null) {
      lines.push(`Quality score: ${cw.qualityScore}/100`);
    }

    lines.push(
      "",
      "ATTRIBUTION RULE: You MUST NOT attribute this completed work to any specialist",
      "other than the primary specialist listed above. If you refer to who produced",
      "this work, use the primary specialist code above or omit attribution entirely.",
      "The task-assigned specialists listed earlier are the intended task roles —",
      "not necessarily who actually produced the completed output.",
    );
  }

  return lines.join("\n");
}
