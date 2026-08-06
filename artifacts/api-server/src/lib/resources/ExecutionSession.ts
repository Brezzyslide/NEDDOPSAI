/**
 * Execution Session — Sprint 29B (type definitions)
 *
 * An ExecutionSession owns open channel connections for the full duration of
 * a specialist execution. It allows multi-step connector operations (locate →
 * read → write) to share authentication state without reconnecting between
 * stages.
 *
 * In Sprint 29B the session is typed but not yet operational — the NeedsOps
 * Connector wire protocol for session lifecycle ships in a future sprint.
 * The slot is present in CanonicalExecutionContext now so the engine's
 * session-management logic can be added without changing the context shape.
 *
 * Session ownership model:
 *   1. Session is opened before evidence retrieval (Stage 5).
 *   2. Session is idle while AI execution runs (Stage 8).
 *   3. Session is active again during execution actions (Stage 11).
 *   4. Session is closed after actions complete (Stage 12) — always.
 */

export type SessionStatus = "idle" | "active" | "closing" | "closed" | "error";

export type SessionChannel =
  | "connector"  // NeedsOps Connector → OpenClaw local capabilities
  | "browser"    // Browser automation
  | "office"     // Word, Excel, Outlook
  | "cloud";     // SharePoint, Google Drive, OneDrive (future)

export interface ExecutionSessionConfig {
  executionId: string;
  organisationId: string;
  /** Channels the session is permitted to use */
  allowedChannels: SessionChannel[];
  /** Maximum session lifetime in seconds (default: 600) */
  maxDurationSeconds: number;
}

/**
 * An ExecutionSession is the connection context for a single specialist
 * execution. It is passed into CanonicalExecutionContext so every stage has
 * access to the same authenticated channel.
 */
export interface ExecutionSession {
  sessionId: string;
  executionId: string;
  status: SessionStatus;
  allowedChannels: SessionChannel[];
  openedAt: string;
  expiresAt: string;
}

/**
 * Creates a stub session record for the current execution.
 * Status starts as "idle" — transitions to "active" when connector
 * operations are implemented in a future sprint.
 */
export function createExecutionSession(config: ExecutionSessionConfig): ExecutionSession {
  const now = new Date();
  const expiry = new Date(now.getTime() + config.maxDurationSeconds * 1000);
  return {
    sessionId: crypto.randomUUID(),
    executionId: config.executionId,
    status: "idle",
    allowedChannels: config.allowedChannels,
    openedAt: now.toISOString(),
    expiresAt: expiry.toISOString(),
  };
}
