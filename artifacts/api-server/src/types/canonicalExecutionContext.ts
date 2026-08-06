/**
 * Canonical Execution Context — Sprint 29D (Execution Contract Completion)
 *
 * Every specialist receives an identical CanonicalExecutionContext regardless
 * of trigger type (conversation, task, scheduled, workflow). This is the single
 * contract between the Chief of Staff (orchestrator) and every specialist runtime.
 *
 * Sprint 29D changes (backwards-compatible additions):
 *   - ResourcePlan replaces ResourcePlanRef — full execution routing plan
 *   - ExecutionAction is now a fully typed model with discriminated action types
 *   - ExecutionSession is now created and lifecycle-managed by the engine
 *   - executionActions is always [] (never null) after Sprint 29D
 *
 * Ownership model (Deliverable E):
 *
 *   Chief of Staff owns:
 *     ● orchestration       — decides WHAT work to dispatch
 *     ● delegation          — chooses WHICH specialist
 *     ● capability planning  — resolves WHICH capabilities are needed
 *     ● resource planning    — builds ResourcePlan before dispatch
 *     ● execution planning   — determines WHAT actions are needed
 *     ● approval routing     — decides WHO must approve before actions run
 *
 *   Specialists own:
 *     ● reasoning            — applies professional judgement to the brief
 *     ● evidence usage       — reads and cites retrieved EvidencePack
 *     ● professional output  — produces the work product
 *     ● action proposals     — proposes ExecutionActions (proposals, never commands)
 *
 *   Engine owns:
 *     ● context assembly     — builds CanonicalExecutionContext
 *     ● session lifecycle    — opens and closes ExecutionSession
 *     ● action validation    — validates proposed actions against the ResourcePlan
 *     ● action persistence   — stores validated proposals in ctx.executionActions
 *
 *   Connectors own (Connector P6):
 *     ● action execution     — physically executes approved ExecutionActions
 */

import type { ExecutionSession, SessionChannel } from "../lib/resources/ExecutionSession.js";
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

// ─── ExecutionAction — typed action model (Deliverable B) ─────────────────────

/**
 * Every action type a specialist may propose.
 * These are PROPOSALS — nothing executes until a connector runs them after approval.
 */
export type ExecutionActionType =
  | "write_file"
  | "create_file"
  | "update_file"
  | "move_file"
  | "draft_email"
  | "send_email"
  | "update_spreadsheet"
  | "browser_interaction"
  | "calendar_update"
  | "terminal_command";

/**
 * Write target domains — the resolved destination for an ExecutionAction.
 * Deterministically derived by the write target resolver (Deliverable C).
 */
export type WriteTargetDomain =
  | "desktop_documents"   // ~/Documents or equivalent
  | "desktop_downloads"   // ~/Downloads
  | "desktop_desktop"     // ~/Desktop
  | "organisation_library" // NeedsOps Library
  | "completed_work"      // NeedsOps Completed Work record
  | "outlook_drafts"      // Outlook Drafts folder
  | "outlook_send"        // Outlook Send — requires approval
  | "excel_workbook"      // Active Excel workbook
  | "sharepoint"          // SharePoint site (future)
  | "google_drive"        // Google Drive (future)
  | "custom";             // Explicitly specified path

/**
 * A fully resolved destination for an ExecutionAction.
 * Every action has a deterministically resolved destination BEFORE execution.
 */
export interface ResolvedWriteTarget {
  domain: WriteTargetDomain;
  /** Human-readable display path shown to the user for approval */
  displayPath: string;
  /** Whether a NeedsOps Connector session is required to write here */
  connectorRequired: boolean;
  /** Which session channel must be open to perform this write */
  channelRequired: SessionChannel | null;
  /** Whether this specific write requires explicit user approval */
  approvalRequired: boolean;
  /** Reason shown to the user when approval is requested */
  approvalReason: string | null;
}

/**
 * A fully typed ExecutionAction — the unit of specialist side-effect intent.
 *
 * OWNERSHIP RULE: ExecutionActions are proposals produced by the specialist
 * and validated by the engine. They are NEVER commands. The connector
 * executes them only after explicit user approval where required.
 *
 * Status progression:
 *   proposed  → approved   (user approves)
 *   proposed  → rejected   (user rejects)
 *   proposed  → superseded (specialist revised the action)
 *   approved  → executing  (connector begins executing — Sprint 29F)
 *   executing → completed  (connector executed successfully — Sprint 29F)
 *   executing → failed     (connector returned an error — Sprint 29F)
 *   executing → cancelled  (execution aborted e.g. connector disconnected — Sprint 29F)
 */
export interface ExecutionAction {
  /** Unique identifier for this action (engine-assigned) */
  actionId: string;
  /** Typed action kind */
  actionType: ExecutionActionType;
  /** Domain the action operates in */
  domain: "files" | "word" | "excel" | "browser" | "email" | "calendar" | "terminal";
  /** Human-readable description of what this action will do */
  description: string;
  /** Deterministically resolved write destination (Deliverable C) */
  resolvedDestination: ResolvedWriteTarget | null;
  /** Whether this action requires explicit user approval before execution */
  requiresApproval: boolean;
  /** Human-readable reason why approval is required */
  approvalReason: string | null;
  /** Risk level assessed by the specialist */
  riskLevel: "low" | "medium" | "high";
  /** When the engine validated and persisted this proposal */
  proposedAt: string;
  /**
   * Lifecycle state.
   * Proposal states: proposed | approved | rejected | superseded
   * Execution states (Sprint 29F): executing | completed | failed | cancelled
   */
  status: "proposed" | "approved" | "rejected" | "superseded" | "executing" | "completed" | "failed" | "cancelled";
  /** When a user approved this action — undefined until approved */
  approvedAt?: string;
  /** Who approved this action — undefined until approved */
  approvedByUserId?: string;
  /** Raw parameters from specialist output — passed to connector on execution */
  parameters: Record<string, unknown>;
}

// ─── ResourcePlan — complete routing plan (Deliverable D) ─────────────────────

/**
 * State of a single evidence provider during execution.
 */
export interface EvidenceProvider {
  providerId: string;
  providerType:
    | "organisation_library"
    | "task_upload"
    | "connector_files"
    | "connector_email"
    | "connector_calendar";
  status: "active" | "unavailable" | "not_attempted";
  sourceCount: number;
}

/**
 * A connector channel required for this execution.
 * Populated from the specialist's allowedConnectorCategories / allowedExecutionChannels.
 */
export interface ConnectorRequirement {
  channel: SessionChannel;
  purpose: "evidence" | "execution";
  /** Whether this channel is mandatory for the execution to succeed */
  required: boolean;
  /** Whether a live session has been established (Connector P6 will set to true) */
  satisfied: boolean;
}

/**
 * An approval requirement derived from ExecutionActions.
 * Populated by the engine after specialist output is parsed.
 */
export interface ApprovalRequirementRef {
  actionId: string;
  actionType: ExecutionActionType;
  reason: string;
  approvalLevel: "user" | "admin" | "owner";
}

/**
 * The complete execution routing plan.
 *
 * ResourcePlan is the single source of truth for:
 *   - WHERE evidence came from (evidence providers + source IDs)
 *   - WHERE output will be written (write targets)
 *   - WHAT connector channels are required
 *   - WHO must approve before execution
 *
 * Built by the engine before AI execution using available context.
 * Write targets and approval requirements are populated after specialist output.
 */
export interface ResourcePlan {
  // Evidence side (read) — populated before AI execution
  evidenceProviders: EvidenceProvider[];
  /** Provider IDs ordered by priority for evidence resolution */
  preferredProviders: string[];
  /** Resolved source IDs that contributed to the EvidencePack */
  evidenceSources: string[];
  /** Whether a connector session was opened to retrieve evidence (Connector P6) */
  connectorSessionOpened: boolean;

  // Write side — populated after specialist output is parsed
  /** Deterministically resolved write destinations for all proposed actions */
  writeTargets: ResolvedWriteTarget[];

  // Requirements — populated from specialist capabilities and output
  /** Specialist capability codes required to complete this execution */
  requiredCapabilities: string[];
  /** Connector channels required for evidence or execution */
  connectorRequirements: ConnectorRequirement[];
  /** Actions that require explicit user approval before execution */
  approvalRequirements: ApprovalRequirementRef[];
}

// ─── Execution constraints ────────────────────────────────────────────────────

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
 * Sprint 29D guarantees:
 *   - ctx.session   is always an ExecutionSession (never null after engine init)
 *   - ctx.resourcePlan is always a complete ResourcePlan
 *   - ctx.executionActions is always ExecutionAction[] (empty array if read-only)
 *
 * Specialists receive ctx as read-only context. Only the engine mutates ctx
 * (to populate executionActions after specialist output and to close session).
 */
export interface CanonicalExecutionContext {
  /** Unique ID for this execution */
  executionId: string;
  /** Trigger type — for audit/routing only; specialists do not branch on this */
  triggerType: "conversation" | "task" | "scheduled" | "workflow";
  /** Organisation this execution runs for */
  organisationId: string;
  /** User who initiated the execution */
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

  // 6. Resource plan — complete routing plan (Sprint 29D: always a full ResourcePlan)
  resourcePlan: ResourcePlan;

  // 7. Execution actions — typed proposals (Sprint 29D: always [], never null)
  executionActions: ExecutionAction[];

  // 8. Blueprint (null for conversation steps)
  blueprint: WorkBlueprint | null;

  // 9. Constraints
  constraints: ExecutionConstraints;

  // 10. Session — lifecycle-managed by engine (Sprint 29D: always populated)
  session: ExecutionSession | null;
}

// ─── Backward-compat alias ────────────────────────────────────────────────────
// Code that previously imported ResourcePlanRef continues to compile.
/** @deprecated Use ResourcePlan instead */
export type ResourcePlanRef = ResourcePlan;
