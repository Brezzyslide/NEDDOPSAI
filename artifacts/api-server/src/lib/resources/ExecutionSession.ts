/**
 * Execution Session — Sprint 29D (Lifecycle implementation)
 *
 * An ExecutionSession owns the connection context for the full duration of a
 * specialist execution. Every stage of the engine shares the same session so
 * multi-step connector operations (locate → read → write) can share
 * authentication state without reconnecting.
 *
 * Sprint 29D: session is now created and lifecycle-managed by the engine.
 * It starts as "idle" — no connector traffic yet — transitions through
 * "active" when connector operations are wired (Connector P6), and is always
 * closed when execution ends (success or failure).
 *
 * Session lifecycle:
 *   1. openExecutionSession()   — created before evidence retrieval
 *   2. [connector operations]   — status transitions to "active" (P6)
 *   3. closeExecutionSession()  — always called at execution end
 *   4. markSessionError()       — called instead of close when an unrecoverable
 *                                 error occurs before the session can be closed
 *
 * Ownership:
 *   The engine is the sole owner of session lifecycle. No specialist or adapter
 *   may open or close a session. Specialists receive ctx.session as read-only
 *   connection context.
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
  triggerType: "conversation" | "task" | "scheduled" | "workflow";
  /** Channels the session is permitted to use */
  allowedChannels: SessionChannel[];
  /** Maximum session lifetime in seconds (default: 600) */
  maxDurationSeconds: number;
}

/**
 * State of a single resource provider within an execution session.
 * Tracks whether a provider was attempted and whether it was reachable.
 */
export interface ResourceProviderState {
  provider:
    | "organisation_library"
    | "connector_files"
    | "connector_email"
    | "connector_calendar"
    | "connector_browser"
    | "connector_excel";
  status: "not_attempted" | "available" | "unavailable" | "error";
  checkedAt: string;   // ISO 8601
  errorMessage?: string;
}

/**
 * An ExecutionSession is the connection context for a single specialist
 * execution. It is placed into CanonicalExecutionContext so every stage
 * has access to the same authenticated channel context.
 *
 * In Sprint 29D, sessions are created and closed by the engine but carry
 * no live connector state. Connector P6 will transition the session to
 * "active" when real relay traffic begins.
 */
export interface ExecutionSession {
  /** Unique session identifier */
  sessionId: string;
  /** The execution this session belongs to */
  executionId: string;
  /** The trigger that started this execution (for routing and audit) */
  triggerType: "conversation" | "task" | "scheduled" | "workflow";
  /** Current lifecycle state */
  status: SessionStatus;
  /** Channels this session may use */
  allowedChannels: SessionChannel[];
  /** ISO 8601 timestamp when the session was opened */
  openedAt: string;
  /** ISO 8601 timestamp when the session expires (regardless of status) */
  expiresAt: string;
  /** ISO 8601 timestamp when the session was closed — null while still open */
  closedAt: string | null;
  /** Wall-clock duration in milliseconds — null while still open */
  durationMs: number | null;
  /** Per-provider availability states populated during execution */
  resourceProviderStates: ResourceProviderState[];
}

// ─── Lifecycle functions ──────────────────────────────────────────────────────

/**
 * Opens a new execution session.
 *
 * Status is "idle" — the session records the runtime context but does not
 * open connector channels until Connector P6 activates them.
 */
export function openExecutionSession(config: ExecutionSessionConfig): ExecutionSession {
  const now    = new Date();
  const expiry = new Date(now.getTime() + config.maxDurationSeconds * 1000);
  return {
    sessionId:              crypto.randomUUID(),
    executionId:            config.executionId,
    triggerType:            config.triggerType,
    status:                 "idle",
    allowedChannels:        config.allowedChannels,
    openedAt:               now.toISOString(),
    expiresAt:              expiry.toISOString(),
    closedAt:               null,
    durationMs:             null,
    resourceProviderStates: [],
  };
}

/**
 * Records a resource provider state within the session.
 * Returns a new session with the provider state appended.
 */
export function recordProviderState(
  session: ExecutionSession,
  state: ResourceProviderState,
): ExecutionSession {
  return {
    ...session,
    resourceProviderStates: [...session.resourceProviderStates, state],
  };
}

/**
 * Closes the session after successful execution.
 * Sets status to "closed", records closedAt, and computes durationMs.
 *
 * Always call this even when no connector work occurred — it signals
 * that the execution engine has released the session cleanly.
 */
export function closeExecutionSession(session: ExecutionSession): ExecutionSession {
  const closedAt   = new Date();
  const openedAt   = new Date(session.openedAt);
  const durationMs = closedAt.getTime() - openedAt.getTime();
  return {
    ...session,
    status:    "closed",
    closedAt:  closedAt.toISOString(),
    durationMs,
  };
}

/**
 * Marks the session as errored when an unrecoverable failure occurs
 * before normal close. Always call this in catch blocks so the session
 * is never left in "idle" or "active" state.
 */
export function markSessionError(session: ExecutionSession, errorMessage: string): ExecutionSession {
  const closedAt   = new Date();
  const openedAt   = new Date(session.openedAt);
  const durationMs = closedAt.getTime() - openedAt.getTime();
  return {
    ...session,
    status:    "error",
    closedAt:  closedAt.toISOString(),
    durationMs,
    resourceProviderStates: [
      ...session.resourceProviderStates,
      {
        provider:     "organisation_library" as const,
        status:       "error",
        checkedAt:    closedAt.toISOString(),
        errorMessage,
      },
    ],
  };
}

// Backward-compat alias for existing callers that used createExecutionSession.
export const createExecutionSession = (config: ExecutionSessionConfig): ExecutionSession =>
  openExecutionSession(config);
