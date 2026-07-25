/**
 * @workspace/agent-runtime — Execution Engine abstraction
 *
 * Defines the contract between NeedsOps and any execution runtime.
 *
 * NeedsOps owns: tenants, organisations, tasks, workforce roles, worker profiles,
 *   execution plans, approvals, permissions, entitlements, audit, usage.
 *
 * The runtime owns: execution, browser automation, tool execution,
 *   runtime state, execution events.
 *
 * OpenClaw is the first runtime that implements this interface.
 * The interface must remain stable regardless of which runtime is active.
 */

// ─── Runtime registration ─────────────────────────────────────────────────────

export interface RuntimeCapabilities {
  /** Human-readable runtime name */
  name: string;
  /** Semver string */
  version: string;
  /** Execution channel types this runtime supports */
  supportedChannels: ExecutionChannel[];
  /** Tool categories this runtime can dispatch */
  supportedToolCategories: string[];
  /** Maximum concurrent executions this runtime accepts */
  maxConcurrentExecutions: number;
}

export type ExecutionChannel =
  | "api"
  | "browser"
  | "local_files"
  | "local_applications"
  | "internal";

// ─── Runtime health ───────────────────────────────────────────────────────────

export type RuntimeHealthStatus = "healthy" | "degraded" | "unavailable" | "not_connected";

export interface RuntimeHealth {
  status: RuntimeHealthStatus;
  version: string;
  activeExecutions: number;
  queuedExecutions: number;
  failedExecutions: number;
  /** ISO timestamp of last heartbeat from runtime */
  lastHeartbeatAt: string | null;
  /** ISO timestamp when connection was established */
  connectedAt: string | null;
  capabilities: RuntimeCapabilities | null;
  message?: string;
}

// ─── Execution package (NeedsOps → Runtime) ───────────────────────────────────

export interface WorkerProfileConstraints {
  allowedChannels: ExecutionChannel[];
  allowedBrowserDomains: string[];
  allowedLocalPathCategories: string[];
  allowedApplicationCategories: string[];
  prohibitedActions: string[];
  riskLevel: "low" | "medium" | "high";
  requiresApprovalFor: string[];
}

export interface ExecutionStep {
  sequence: number;
  specialist: string;
  action: string;
  description: string;
  requiresApproval: boolean;
  estimatedDurationSeconds?: number;
}

export interface ExecutionConstraints {
  maxDurationSeconds: number;
  requireHumanApprovalBeforeSubmit: boolean;
  allowedDataCategories: string[];
}

export interface ExecutionPackage {
  /** NeedsOps execution session identifier (the session's own ID) */
  executionId: string;
  /** NeedsOps task ID that this execution session executes */
  taskId: string;
  /** Organisation UUID — immutable tenant boundary */
  tenantId: string;
  /** Workforce Role code (specialist identifier) */
  workforceRole: string;
  /** Worker Profile constraints the runtime must enforce */
  workerProfile: WorkerProfileConstraints;
  /** Ordered execution steps from the task plan */
  steps: ExecutionStep[];
  /** Tool categories the runtime may invoke */
  requestedTools: string[];
  /** Channels the runtime may use */
  requestedChannels: ExecutionChannel[];
  /** External connector categories the runtime may access */
  requestedConnectorCategories: string[];
  /** Approval state at the time of submission */
  approvalState: string;
  /** Hard constraints the runtime must not exceed */
  constraints: ExecutionConstraints;
  /** URL where the runtime must POST execution events */
  callbackUrl: string;
  /** ISO timestamp — runtime must reject if past this time */
  expiresAt: string;
  /** ISO timestamp of package creation */
  issuedAt: string;
}

// ─── Execution status (Runtime → NeedsOps) ───────────────────────────────────

export type ExecutionStatus =
  | "pending"
  | "submitted"
  | "accepted"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface ExecutionSessionInfo {
  /** NeedsOps execution session ID */
  executionId: string;
  /** Runtime's own identifier for this execution */
  runtimeExecutionId: string | null;
  status: ExecutionStatus;
  /** Human-readable status for the customer */
  statusMessage: string;
  submittedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

// ─── Runtime events ───────────────────────────────────────────────────────────

export type RuntimeEventType =
  | "runtime.connected"
  | "runtime.disconnected"
  | "runtime.unavailable"
  | "execution.accepted"
  | "execution.started"
  | "execution.progress"
  | "execution.paused"
  | "execution.resumed"
  | "execution.awaiting_approval"
  | "execution.completed"
  | "execution.failed"
  | "execution.cancelled"
  | "execution.expired";

export interface RuntimeEvent {
  eventId: string;
  eventType: RuntimeEventType;
  /** NeedsOps execution session ID — links event to session */
  executionId: string;
  /** Runtime's own execution identifier */
  runtimeExecutionId: string | null;
  /** Organisation UUID — must match the session's tenantId */
  tenantId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

// ─── Submission result ────────────────────────────────────────────────────────

export type SubmissionOutcome = "accepted" | "queued" | "rejected";

export interface SubmissionResult {
  outcome: SubmissionOutcome;
  runtimeExecutionId: string | null;
  estimatedStartAt?: string;
  rejectionReason?: string;
}

// ─── Execution Engine interface ───────────────────────────────────────────────

/**
 * The Execution Engine is the only interface through which NeedsOps dispatches
 * real work to an external runtime.
 *
 * All concrete runtimes (OpenClaw, future alternatives) must implement this
 * interface. NeedsOps code must never call runtime-specific APIs directly.
 */
export interface ExecutionEngine {
  /**
   * Returns the name of this runtime implementation.
   * Used for logging, audit, and platform console display.
   */
  readonly runtimeName: string;

  /**
   * Returns the current health state of the runtime.
   * Must not throw — returns status "not_connected" if the runtime is absent.
   */
  getHealth(): Promise<RuntimeHealth>;

  /**
   * Returns the runtime's declared capabilities.
   * Returns null if the runtime is not connected.
   */
  getCapabilities(): Promise<RuntimeCapabilities | null>;

  /**
   * Submit an approved execution package to the runtime.
   * The runtime will POST events back to the callbackUrl in the package.
   *
   * @throws if the package is invalid or the runtime refuses the submission.
   */
  submitExecution(pkg: ExecutionPackage): Promise<SubmissionResult>;

  /**
   * Request cancellation of an active execution.
   * The runtime will emit an execution.cancelled event on success.
   */
  cancelExecution(executionId: string, tenantId: string): Promise<void>;

  /**
   * Pause an active execution.
   * The runtime will emit an execution.paused event on success.
   */
  pauseExecution(executionId: string, tenantId: string): Promise<void>;

  /**
   * Resume a paused execution.
   * The runtime will emit an execution.resumed event on success.
   */
  resumeExecution(executionId: string, tenantId: string): Promise<void>;

  /**
   * Query the runtime for the current status of an execution.
   * Used for polling when event delivery is delayed.
   */
  getExecutionStatus(executionId: string, tenantId: string): Promise<ExecutionSessionInfo | null>;

  /**
   * Process an inbound runtime event received on the webhook endpoint.
   * Validates the event's tenant boundary and event shape before persisting.
   *
   * @throws if the event fails authentication or tenant validation.
   */
  processInboundEvent(event: RuntimeEvent): Promise<void>;
}
