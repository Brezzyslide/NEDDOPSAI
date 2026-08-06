/**
 * Canonical Execution Context — Sprint 29B
 *
 * Every specialist receives an identical CanonicalExecutionContext regardless
 * of trigger type (conversation, task, scheduled, workflow). This is the single
 * contract between the Chief of Staff (orchestrator) and every specialist runtime.
 *
 * Field rationale:
 *
 *  1. dna             — WHO the specialist is; immutable professional character.
 *                       Cached by dnaVersion; does not change per execution.
 *
 *  2. manifest        — WHAT this specialist can do TODAY; compiled per dispatch.
 *                       Includes active capabilities, permissions, and org context.
 *
 *  3. conversationContext — WHY this execution was triggered; the dialogue leading
 *                       here. All triggers receive this — scheduled and workflow
 *                       executions get a synthetic conversation representing their
 *                       trigger parameters.
 *
 *  4. organisationMemory — WHAT the org has decided / knows. Always present.
 *                       Trusted source — different from retrieved evidence.
 *
 *  5. evidence        — WHAT the specialist reads to produce output.
 *                       EvidencePack from the ResourceRegistry. Read-only.
 *                       Null for conversation steps (Sprint 29C will populate).
 *
 *  6. resourcePlan    — WHERE resources came from and where write targets are.
 *                       Tells the engine and OpenClaw the routing decisions made.
 *
 *  7. executionActions — WHAT the specialist does AFTER output is produced.
 *                       Side effects: write, send, automate. Null when read-only.
 *
 *  8. blueprint       — HOW the output should be structured. Null for conversation.
 *
 *  9. constraints     — HOW LONG / HOW MUCH for this run. Execution-scoped limits.
 *
 * 10. session         — Connection context shared across all stages.
 *                       Stub in Sprint 29B; active in future connector sprint.
 */

import type { ExecutionSession } from "../lib/resources/ExecutionSession.js";
import type { EvidencePack } from "../services/knowledgeResolutionService.js";
import type { WorkBlueprint } from "../services/workBlueprintService.js";

// ─── Supporting types ─────────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface ApprovedMemoryItem {
  id: string;
  content: string;
  category: string;
  memoryType?: string;
}

export interface PinnedDecision {
  id: string;
  decision: string;
}

export interface ResourcePlanRef {
  /** Evidence sources used, in resolution order */
  evidenceSources: string[];
  /** Whether a connector session was opened for evidence retrieval */
  connectorSessionOpened: boolean;
  /** Approved write targets for execution actions */
  writeTargets: string[];
}

export interface ExecutionAction {
  domain: "files" | "word" | "excel" | "browser" | "email" | "calendar" | "terminal";
  action: string;
  parameters: Record<string, unknown>;
  requiresApproval: boolean;
  approvedAt?: string;
  approvedByUserId?: string;
}

export interface ExecutionConstraints {
  maxDurationSeconds: number;
  maxTokens: number;
  requireHumanApprovalBeforeSubmit: boolean;
  allowedDataCategories: string[];
}

// ─── Canonical context ────────────────────────────────────────────────────────

/**
 * The single execution context passed to every specialist regardless of trigger.
 *
 * Both the task pipeline and the conversation pipeline build this object.
 * Specialists never know which trigger produced their context.
 */
export interface CanonicalExecutionContext {
  /** Unique ID for this execution */
  executionId: string;
  /** Trigger type — for audit/routing only; specialists do not branch on this */
  triggerType: "conversation" | "task" | "scheduled" | "workflow";
  /** Organisation this execution runs for */
  organisationId: string;
  /** User who initiated the execution (requesterId) */
  requesterId: string;
  /** Verified org membership role of the requester */
  requesterRole: string;

  // 1. Professional DNA (reference only — loaded separately by runtime)
  dnaVersion: string;
  specialistCode: string;

  // 2. Runtime Manifest (compiled per dispatch)
  manifestVersion: number;

  // 3. Conversation context
  conversationContext: {
    conversationId?: string;
    messages: ConversationMessage[];
    unresolvedQuestions: string[];
    previousSpecialistOutputs: Array<{
      specialistRunId: string;
      role: string;
      summary: string;
    }>;
  };

  // 4. Organisation memory (always present; trusted source)
  organisationMemory: {
    approvedMemory: ApprovedMemoryItem[];
    pinnedDecisions: PinnedDecision[];
  };

  // 5. Evidence (resolved from ResourceRegistry before execution)
  evidence: EvidencePack | null;

  // 6. Resource plan
  resourcePlan: ResourcePlanRef;

  // 7. Execution actions (null when read-only)
  executionActions: ExecutionAction[] | null;

  // 8. Blueprint (null for conversation steps)
  blueprint: WorkBlueprint | null;

  // 9. Constraints
  constraints: ExecutionConstraints;

  // 10. Session (stub in Sprint 29B; active when connector ships)
  session: ExecutionSession | null;
}
