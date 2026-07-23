/**
 * @workspace/agent-runtime — Core agent types
 *
 * The public interface between the NeedsOps AI+ platform and its AI agents.
 * Agents are invoked by the platform via this contract; internals are hidden.
 */

import type { AIWorkerRole } from "@workspace/shared";

// ─── Agent identity ───────────────────────────────────────────────────────────

export interface AgentIdentity {
  /** Stable identifier, e.g. "needsops-compliance-officer" */
  id: string;
  /** Display name */
  name: string;
  /** The AI worker role this agent fulfils */
  role: AIWorkerRole;
  /** Brief description of capabilities */
  description: string;
  /** Version of this agent implementation */
  version: string;
}

// ─── Agent capabilities ───────────────────────────────────────────────────────

export interface AgentCapability {
  /** Unique identifier for this capability, e.g. "audit-preparation" */
  id: string;
  /** Human label */
  label: string;
  /** Whether the capability requires a human approval step */
  requiresApproval: boolean;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export type MessageRole = "user" | "agent" | "system" | "tool";

export interface AgentMessage {
  role: MessageRole;
  content: string;
  /** Timestamp (ISO string) */
  timestamp: string;
  /** Optional metadata (tool call results, file refs, etc.) */
  metadata?: Record<string, unknown>;
}

// ─── Task context ─────────────────────────────────────────────────────────────

export interface AgentTaskContext {
  /** The organisation requesting this task */
  organizationId: string;
  /** The user who initiated (null for scheduled/system tasks) */
  userId: string | null;
  /** Conversation history for multi-turn interactions */
  history: AgentMessage[];
  /** Arbitrary key-value context (e.g. document IDs, workflow state) */
  context: Record<string, unknown>;
}

// ─── Task ─────────────────────────────────────────────────────────────────────

export interface AgentTask {
  /** Unique task ID */
  id: string;
  /** The capability to invoke */
  capability: string;
  /** Natural-language instruction */
  instruction: string;
  /** Task context */
  taskContext: AgentTaskContext;
  /** ISO timestamp */
  createdAt: string;
}

// ─── Response ─────────────────────────────────────────────────────────────────

export type AgentResponseStatus =
  | "completed"
  | "requires_approval"
  | "partial"
  | "failed"
  | "delegated";

export interface AgentResponse {
  taskId: string;
  agentId: string;
  status: AgentResponseStatus;
  /** Primary response content */
  content: string;
  /** Any follow-up messages generated */
  messages: AgentMessage[];
  /** If status is requires_approval, details of what needs human sign-off */
  approvalRequest?: ApprovalRequest;
  /** ISO timestamp */
  completedAt: string;
  /** Token usage (filled in by runtime) */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  description: string;
  /** The action the agent wants to take */
  proposedAction: string;
  /** What happens if approved */
  onApprove: string;
  /** What happens if rejected */
  onReject: string;
  /** How long the approval is valid for (seconds) */
  expiresInSeconds: number;
}

// ─── Routing (Chief of Staff) ─────────────────────────────────────────────────

export interface RoutingDecision {
  /** The agent ID that should handle this task */
  targetAgentId: string;
  /** Confidence score 0–1 */
  confidence: number;
  /** Why this agent was chosen */
  reasoning: string;
  /** Whether the task should be split across multiple agents */
  split: boolean;
  /** If split=true, the sub-tasks for each agent */
  subTasks?: Array<{ agentId: string; instruction: string }>;
}
