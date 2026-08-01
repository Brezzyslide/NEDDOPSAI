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

// ─── Specialist Runtime Manifest (NeedsOps → Runtime) ────────────────────────
//
// Carries the compiled specialist identity, behaviour, and skills from the
// active DNA profile. This is the sole authoritative identity signal for the
// runtime — no separate specialist file should exist inside OpenClaw.
//
// IMPORTANT separation of concerns:
//   - SpecialistRuntimeManifest  → who the specialist is and how they behave
//   - WorkerProfileConstraints   → what the specialist is technically permitted to do
//   - ExecutionStep[]            → what the specialist must do right now
//
// The manifest must NEVER contain credentials, API keys, secrets, bearer tokens,
// database IDs, subscription metadata, or anything that enlarges permissions
// beyond what WorkerProfileConstraints explicitly grants.

export interface SpecialistManifestCompetency {
  /** Canonical competency code from the DNA profile */
  code: string;
  /** Human-readable competency name */
  name: string;
  /** Proficiency level */
  level: string;
  /** Competency description */
  description: string;
  /**
   * Version string — competencies are versioned with the DNA profile.
   * Individual competencies do not carry separate version numbers.
   */
  version: string;
}

export interface SpecialistRuntimeManifest {
  // ── Identity ──────────────────────────────────────────────────────────────
  /** Canonical workforce role code, e.g. "chief_of_staff" */
  specialistId: string;
  /** Matches ExecutionPackage.workforceRole — must be identical */
  workforceRole: string;
  /** Human-readable display name from the DNA profile */
  displayName: string;
  /** Professional domain, e.g. "Strategic Operations" */
  domain: string;
  /** Stable canonical DNA profile identifier (same as specialistId) */
  dnaProfileId: string;
  /** Semver string of the DNA version this manifest was compiled from */
  dnaVersion: string;
  /**
   * Manifest format version.
   * Increment this when the shape of SpecialistRuntimeManifest changes.
   * Old packages carrying a different version must be rejected.
   */
  manifestVersion: 1;

  // ── Purpose ───────────────────────────────────────────────────────────────
  /** One-sentence professional mission statement */
  mission: string;
  /** 3-5 core professional objectives */
  objectives: string[];
  /** What this specialist is authorised to do (identity layer, not enforcement) */
  responsibilities: string[];
  /** Non-negotiable professional values and guiding principles */
  operatingPrinciples: string[];

  // ── Communication ─────────────────────────────────────────────────────────
  communicationStyle: {
    /** Tone of voice, e.g. "authoritative_professional" */
    tone: string;
    /** Language register, e.g. "formal" */
    detailLevel: string;
    /** How the specialist labels itself in conversation */
    language: string;
  };

  // ── Skills / competencies ─────────────────────────────────────────────────
  competencies: SpecialistManifestCompetency[];

  // ── Behaviour ─────────────────────────────────────────────────────────────
  /**
   * Conditions that trigger escalation or refusal.
   * Behavioural description only — hard stops are enforced structurally
   * by the broker and tool layer via WorkerProfileConstraints.
   */
  escalationRules: string[];
  /**
   * Behaviours this specialist must refuse on principle.
   * Does NOT replace workerProfile.prohibitedActions — that is the
   * technical enforcement layer.
   */
  prohibitedBehaviours: string[];

  // ── Memory ────────────────────────────────────────────────────────────────
  memoryPolicy: {
    /** Memory scopes this specialist reads and writes */
    allowedScopes: string[];
    /** Memory scopes this specialist must not access */
    prohibitedScopes: string[];
  };

  // ── Organisation context (Phase 5 — SRM Hardening) ───────────────────────
  /**
   * Organisation-specific context included for the selected specialist.
   * Loaded from org_company_profile and agent_configurations at runtime.
   *
   * This section MUST NOT contain credentials, tokens, passwords, private keys,
   * cross-tenant data, or anything that enlarges workerProfile permissions.
   * It is redacted from logs and must not appear in audit records.
   */
  organisationContext?: {
    /** Opaque version hash for the org profile snapshot used */
    organisationProfileVersion: string;
    /** Business type / industry description */
    businessType?: string;
    /** Primary services the organisation provides */
    services?: string[];
    /** Human-readable operating hours description */
    operatingHours?: string;
    /** Timezone string, e.g. "Australia/Sydney" */
    timezone?: string;
    /** Connected system names (never URLs or credentials) */
    systems?: string[];
    /** First-week goals seeded from Business Discovery */
    firstWeekGoals?: string[];
    /** Named escalation contacts (names only — never email/phone) */
    escalationContacts?: string[];
  };

  // ── Audit ─────────────────────────────────────────────────────────────────
  /**
   * SHA-256 hex digest of the canonical JSON serialisation of this manifest,
   * computed with this field set to an empty string.
   * Allows NeedsOps to prove which exact specialist instructions were used
   * for any given execution.
   */
  manifestHash: string;
  /** ISO 8601 timestamp of manifest compilation */
  generatedAt: string;
}

// ─── Compiled Runtime Instructions (Phase 1 — SRM Hardening) ─────────────────
//
// Produced by runtimeInstructionAssembler immediately before each OpenClaw call.
// This is the instruction string that OpenClaw actually consumes.
//
// The raw specialistManifest remains in the package for auditability.
// runtimeInstructions is what is injected into the OpenClaw payload.

export interface CompiledRuntimeInstructions {
  /**
   * The full assembled instruction string sent to OpenClaw as its active
   * runtime instructions. Built from: specialistManifest + steps + constraints.
   * Produced by runtimeInstructionAssembler immediately before submission.
   *
   * NOT logged in production (use instructionHash for audit instead).
   */
  instruction: string;
  /**
   * SHA-256 hex digest of the instruction string.
   * Allows audit to prove exactly which instructions were sent to OpenClaw
   * without storing the full text.
   */
  instructionHash: string;
  /** Source manifest hash — matches specialistManifest.manifestHash */
  manifestHash: string;
  /** DNA version used in instruction compilation */
  dnaVersion: string;
  /** Specialist role code */
  specialistId: string;
  /** ISO timestamp of instruction compilation */
  compiledAt: string;
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
  /**
   * Compiled specialist identity from the active DNA profile.
   * Required for all new execution packages (manifestVersion must be 1).
   * Packages without this field will be rejected with UNSUPPORTED_PACKAGE_VERSION.
   */
  specialistManifest: SpecialistRuntimeManifest;
  /**
   * Assembled runtime instruction string (compiled from specialistManifest +
   * steps + constraints immediately before OpenClaw submission).
   *
   * This is the ACTIVE instruction field passed to OpenClaw.
   * The raw specialistManifest is also retained for auditability.
   *
   * Required for all new execution packages — packages without this field
   * will be rejected with UNSUPPORTED_PACKAGE_VERSION.
   */
  runtimeInstructions: CompiledRuntimeInstructions;
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
