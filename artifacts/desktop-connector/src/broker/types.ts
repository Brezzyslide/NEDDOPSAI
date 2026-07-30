/**
 * NeedsOps Runtime Broker — Internal Types
 *
 * These types describe the broker's own internal state. They are distinct from
 * the NeedsOps wire types in lib/openclaw/src/types.ts — those describe the
 * HTTP API contract; these describe local state management.
 */

// ─── Execution state machine ──────────────────────────────────────────────────

export type BrokerExecutionStatus =
  | "queued"         // received and persisted, not yet sent to gateway
  | "submitted"      // sent to gateway adapter
  | "running"        // gateway confirmed execution has started
  | "paused"         // gateway confirmed pause
  | "completed"      // gateway confirmed successful completion
  | "failed"         // gateway reported failure, or internal error
  | "cancelled"      // cancelled by request before or during execution
  | "timed_out";     // exceeded expiresAt without completing

export const TERMINAL_STATUSES: ReadonlySet<BrokerExecutionStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "timed_out",
]);

export function isTerminal(status: BrokerExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ─── Stored execution record ──────────────────────────────────────────────────

export interface StoredExecution {
  /** NeedsOps execution session ID (echoed in all webhook events as executionId) */
  id: string;
  /** NeedsOps organisation UUID */
  tenantId: string;
  /** Broker's own runtime execution ID (returned in submission response) */
  runtimeExecutionId: string;
  /** Current state */
  status: BrokerExecutionStatus;
  /** Full OpenClawExecutionPackage JSON */
  packageJson: string;
  /** ID the gateway assigned to its own job (set by live adapter) */
  gatewaySessionId: string | null;
  /** Human-readable error detail when status === "failed" */
  errorMessage: string | null;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp of last status change */
  updatedAt: string;
  /** ISO timestamp when execution actually started at the gateway */
  startedAt: string | null;
  /** ISO timestamp when execution reached a terminal state */
  completedAt: string | null;
  /** ISO timestamp from the execution package — reject if now > expiresAt */
  expiresAt: string;
  /** URL to POST webhook events back to NeedsOps */
  callbackUrl: string;
}

// ─── Stored event record ──────────────────────────────────────────────────────

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed";

export interface StoredEvent {
  id: string;
  executionId: string;
  eventType: string;
  /** JSON string of the full webhook event body */
  payloadJson: string;
  webhookDelivered: number;       // 0 = pending, 1 = delivered
  webhookAttemptCount: number;
  webhookLastAttemptAt: string | null;
  webhookNextAttemptAt: string | null;
  createdAt: string;
}

// ─── Gateway adapter interface ────────────────────────────────────────────────

/**
 * The contract between the Runtime Broker and the OpenClaw execution gateway.
 *
 * Phase 3 ships SimulatedGatewayAdapter only.
 * Phase 4 (after OpenClaw source inspection) adds LiveGatewayAdapter.
 *
 * The broker never calls OpenClaw directly — all interaction goes through
 * an IGatewayAdapter instance. Swap the adapter by changing OPENCLAW_GATEWAY_MODE.
 */
export interface IGatewayAdapter {
  /** Display name used in health responses */
  readonly name: string;
  /** Send a job to the gateway for execution */
  submit(job: GatewayJobRequest): Promise<GatewayJobAccepted>;
  /** Poll gateway for current status */
  getStatus(gatewaySessionId: string): Promise<GatewayJobStatusResponse>;
  /** Cancel a running or paused job */
  cancel(gatewaySessionId: string): Promise<void>;
  /** Pause a running job (not supported by all adapters) */
  pause(gatewaySessionId: string): Promise<void>;
  /** Resume a paused job */
  resume(gatewaySessionId: string): Promise<void>;
  /** Check reachability and report gateway version */
  healthCheck(): Promise<GatewayHealthResult>;
}

export interface GatewayJobRequest {
  /** NeedsOps execution session ID (for correlation) */
  executionId: string;
  /** Organisation/tenant UUID */
  tenantId: string;
  /** Workforce role of the primary specialist */
  workforceRole: string;
  /** Ordered execution steps */
  steps: Array<{
    sequence: number;
    specialist: string;
    action: string;
    description: string;
  }>;
  /** Execution constraints */
  constraints: {
    maxDurationSeconds: number;
  };
}

export interface GatewayJobAccepted {
  /** Gateway's own session/job identifier */
  gatewaySessionId: string;
}

export interface GatewayJobStatusResponse {
  gatewaySessionId: string;
  status: BrokerExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface GatewayHealthResult {
  ok: boolean;
  version: string;
  detail?: string;
}

// ─── Broker configuration ─────────────────────────────────────────────────────

export interface BrokerConfig {
  /** Port to bind the HTTP server */
  port: number;
  /** Bearer token required on all incoming requests */
  authToken: string;
  /** HMAC-SHA256 secret for signing outbound webhook events */
  webhookSecret: string;
  /** Path to the SQLite database file */
  dbPath: string;
  /** Maximum JSON body size accepted (bytes) */
  maxBodyBytes: number;
  /** Maximum retry attempts for webhook delivery */
  webhookRetryAttempts: number;
  /** Base delay between webhook retries (ms) */
  webhookRetryBaseMs: number;
  /** How often the webhook delivery worker polls (ms) */
  webhookWorkerIntervalMs: number;
  /** How often the stale execution cleaner runs (ms) */
  staleCleanupIntervalMs: number;
  /** Gateway adapter mode */
  gatewayMode: "simulated" | "live";
  /** URL of the local OpenClaw gateway (used by live adapter) */
  gatewayUrl: string | null;
  /** OpenClaw version to report in health responses */
  brokerVersion: string;
}

export function loadBrokerConfig(): BrokerConfig {
  const authToken = process.env.BROKER_AUTH_TOKEN ?? "";
  if (!authToken && process.env.NODE_ENV !== "test") {
    throw new Error("BROKER_AUTH_TOKEN is required");
  }

  const webhookSecret = process.env.OPENCLAW_WEBHOOK_SECRET ?? "";
  if (!webhookSecret && process.env.NODE_ENV !== "test") {
    throw new Error("OPENCLAW_WEBHOOK_SECRET is required");
  }

  return {
    port: parseInt(process.env.BROKER_PORT ?? "19002", 10),
    authToken,
    webhookSecret,
    dbPath: process.env.BROKER_DB_PATH ?? `${process.env.HOME ?? "."}/needsops-broker.db`,
    maxBodyBytes: parseInt(process.env.BROKER_MAX_BODY_BYTES ?? String(1 * 1024 * 1024), 10), // 1 MB
    webhookRetryAttempts: parseInt(process.env.BROKER_WEBHOOK_RETRY_ATTEMPTS ?? "5", 10),
    webhookRetryBaseMs: parseInt(process.env.BROKER_WEBHOOK_RETRY_BASE_MS ?? "2000", 10),
    webhookWorkerIntervalMs: parseInt(process.env.BROKER_WEBHOOK_WORKER_INTERVAL_MS ?? "5000", 10),
    staleCleanupIntervalMs: parseInt(process.env.BROKER_STALE_CLEANUP_INTERVAL_MS ?? "60000", 10),
    gatewayMode: (process.env.OPENCLAW_GATEWAY_MODE ?? "simulated") === "live" ? "live" : "simulated",
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? null,
    brokerVersion: "1.0.0",
  };
}
