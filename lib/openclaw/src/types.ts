/**
 * @workspace/openclaw — OpenClaw-specific wire types
 *
 * These are the shapes used on the wire between NeedsOps and the OpenClaw
 * Runtime Broker. They are intentionally separate from the NeedsOps domain
 * model — translation between the two happens in the package/event translators.
 *
 * Do not import these types from outside lib/openclaw. All external code should
 * use the ExecutionEngine interface from @workspace/agent-runtime.
 */

// ─── Broker request types (NeedsOps → OpenClaw) ──────────────────────────────

/**
 * The execution package sent to the OpenClaw Runtime Broker.
 * Contains only what the runtime needs — no internal platform metadata.
 *
 * Four distinct layers (Sprint SRM):
 *   specialistManifest — who the specialist is (identity + behaviour)
 *   workerProfile      — what the specialist is technically permitted to do
 *   steps              — what the specialist must do right now
 *   requestedTools/connectors — how the work may be carried out
 */
export interface OpenClawExecutionPackage {
  /** NeedsOps execution session ID — broker must echo this in all events */
  executionId: string;
  /** Organisation UUID — runtime must scope all activity to this tenant */
  tenantId: string;
  /** Workforce Role code identifying the primary specialist */
  workforceRole: string;
  /**
   * Compiled specialist identity from the active DNA profile.
   * Present on all packages with manifestVersion === 1.
   * Must not be absent — packages without this field must be rejected
   * with UNSUPPORTED_PACKAGE_VERSION.
   */
  specialistManifest: import("@workspace/agent-runtime").SpecialistRuntimeManifest;
  /**
   * Assembled runtime instruction string compiled immediately before submission.
   * This is the ACTIVE instruction field passed to OpenClaw — not the raw manifest.
   *
   * instructionHash allows audit to prove exactly which instructions were sent
   * without retaining the full text.
   *
   * Must not be absent — packages without this field must be rejected
   * with UNSUPPORTED_PACKAGE_VERSION.
   */
  runtimeInstructions: import("@workspace/agent-runtime").CompiledRuntimeInstructions;
  /** Permitted execution surfaces for this specialist */
  workerProfile: {
    allowedChannels: string[];
    allowedBrowserDomains: string[];
    allowedLocalPathCategories: string[];
    allowedApplicationCategories: string[];
    prohibitedActions: string[];
    riskLevel: string;
    requiresApprovalFor: string[];
  };
  /** Ordered steps from the approved execution plan */
  steps: Array<{
    sequence: number;
    specialist: string;
    action: string;
    description: string;
    requiresApproval: boolean;
    estimatedDurationSeconds?: number;
  }>;
  /** Tool categories the runtime may invoke */
  requestedTools: string[];
  /** Execution surfaces the runtime may use */
  requestedChannels: string[];
  /** External connector categories the runtime may access */
  requestedConnectorCategories: string[];
  /** Structured work-product contract NeedsOps resolved before runtime dispatch */
  blueprintContract?: import("@workspace/agent-runtime").BlueprintExecutionContractSnapshot | null;
  /** NeedsOps pre-dispatch authority validation snapshot */
  authorityValidation?: import("@workspace/agent-runtime").ExecutionAuthorityValidationSnapshot;
  /** Approval state at submission time */
  approvalState: string;
  /** Hard execution constraints the runtime must enforce */
  constraints: {
    maxDurationSeconds: number;
    requireHumanApprovalBeforeSubmit: boolean;
    allowedDataCategories: string[];
  };
  /** URL where the runtime must POST all execution events */
  callbackUrl: string;
  /** ISO timestamp — runtime must reject this package if now > expiresAt */
  expiresAt: string;
  /** ISO timestamp of package creation */
  issuedAt: string;
}

/**
 * Control request sent to modify a running execution.
 */
export interface OpenClawExecutionControlRequest {
  executionId: string;
  tenantId: string;
  action: "cancel" | "pause" | "resume";
  requestedAt: string;
}

// ─── Broker response types (OpenClaw → NeedsOps, synchronous) ────────────────

/**
 * Response returned immediately when a package is submitted.
 */
export interface OpenClawSubmissionResponse {
  runtimeExecutionId: string;
  status: "accepted" | "queued" | "rejected";
  reason?: string;
  estimatedStartAt?: string;
  runtimeVersion: string;
}

/**
 * Response to an execution status poll.
 */
export interface OpenClawStatusResponse {
  executionId: string;
  runtimeExecutionId: string;
  tenantId: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  runtimeVersion: string;
}

/**
 * Runtime health response from the broker.
 */
export interface OpenClawHealthResponse {
  status: "healthy" | "degraded" | "unavailable";
  version: string;
  capabilities: {
    supportedChannels: string[];
    supportedToolCategories: string[];
    maxConcurrentExecutions: number;
  };
  activeExecutions: number;
  queuedExecutions: number;
  failedExecutions: number;
  lastHeartbeatAt: string;
  connectedAt: string;
  uptime: number;
}

// ─── Event types (OpenClaw → NeedsOps, async via webhook) ────────────────────

export type OpenClawEventType =
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

/**
 * An event POSTed by the OpenClaw runtime to NeedsOps via the webhook endpoint.
 */
export interface OpenClawWebhookEvent {
  /** Unique event identifier from the runtime */
  eventId: string;
  eventType: OpenClawEventType;
  /** NeedsOps execution session ID — must match a known session */
  executionId: string;
  /** Runtime's own execution identifier */
  runtimeExecutionId: string;
  /** Organisation UUID — NeedsOps validates this against the session */
  tenantId: string;
  /** Event-specific data */
  payload: Record<string, unknown>;
  /** ISO timestamp from the runtime */
  occurredAt: string;
  /** Runtime version that emitted this event */
  runtimeVersion: string;
}

// ─── Evidence discovery wire types (Sprint 29O.1) ────────────────────────────

/**
 * Governed discovery request sent by the NeedsOps API to the Mac broker.
 * Maps directly onto the discovery contract defined in the sprint brief.
 */
export interface BrokerEvidenceDiscoveryRequest {
  organizationId:          string;
  executionId:             string;
  specialistCode:          string;
  searchObjective:         string;
  unresolvedReferences:    string[];
  allowedDiscoveryScope:   string;
  allowExternalWebSearch:  boolean;
  /**
   * Absolute Mac paths the OpenClaw agent may search within.
   * When provided, the discovery prompt bounds the search to these directories.
   * Empty array = no explicit boundary (may slow discovery for internal_references_only scope).
   */
  allowedRoots?:           string[];
  /**
   * Specific absolute Mac file paths that are known to contain relevant content.
   * OpenClaw will check these first before broader directory scanning.
   */
  knownSourcePaths?:       string[];
  maxHops:                 number;
  maxSources:              number;
  maxPassages:             number;
  timeoutMs:               number;
}

/**
 * One raw discovered evidence item returned by the Mac broker.
 * Mirrors CandidateEvidence in api-server/src/types/candidateEvidence.ts.
 * Kept separate so lib/openclaw does not import from the api-server artifact.
 */
export interface BrokerCandidateEvidence {
  organisationId:            string;
  executionId:               string;
  discoveryId:               string;
  sourceType:                string;
  isExternal:                boolean;
  internalSourceId?:         string;
  internalSourceVersionId?:  string;
  internalChunkId?:          string;
  sourceUrl?:                string;
  publisherDomain?:          string;
  claimedPublisher?:         string;
  jurisdiction?:             string;
  sourceTitle:               string;
  supportingPassage:         string;
  passageHash:               string;
  retrievalTimestamp:        string;
  retrievalMethod:           string;
  discoveryReason:           string;
  unresolvedReferenceContext?: string;
  authorityType?:            string;
  publicationDate?:          string;
  effectiveDate?:            string;
  openClawConfidence:        number;
  relevanceScore:            number;
  contentType:               string;
  accessLocation:            string;
}

/** Response shape from POST /v1/evidence/discover on the Mac broker. */
export interface BrokerEvidenceDiscoveryResponse {
  candidates:          BrokerCandidateEvidence[];
  discoveryDurationMs: number;
  openClawStatus:      "available" | "simulated" | "unavailable";
  hopsFollowed:        number;
}

// ─── Connection state ─────────────────────────────────────────────────────────

export type BrokerConnectionState =
  | "not_configured"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface BrokerConnectionStatus {
  state: BrokerConnectionState;
  runtimeUrl: string | null;
  lastHealthCheckAt: string | null;
  lastHealthStatus: string | null;
  consecutiveFailures: number;
}
