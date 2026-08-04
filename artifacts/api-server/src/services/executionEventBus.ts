/**
 * Execution Event Bus — Sprint 27.1
 *
 * In-process pub/sub for streaming execution progress to SSE clients.
 * The execution coordinator emits here; SSE route handlers subscribe.
 *
 * Architecture:
 *   ExecutionCoordinator → emitExecutionEvent(conversationId, event)
 *                                  ↓
 *              EventEmitter keyed by conversationId
 *                                  ↓
 *   GET /conversations/:id/execution-stream → SSE client
 *
 * Designed for single-process deployments. Each event carries a monotonic
 * eventId so reconnecting clients can request only missed events via
 * Last-Event-ID. A 60-second event buffer allows safe reconnect.
 *
 * Security: callers must validate tenant ownership before subscribing.
 */

import { EventEmitter } from "events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionEventType =
  | "execution_started"
  | "execution_progress"
  | "execution_completed"
  | "execution_failed"
  | "execution_clarification_required"
  | "execution_clarification_received"
  | "execution_recovered"
  | "heartbeat";

export interface ExecutionEvent {
  eventId: number;
  type: ExecutionEventType;
  conversationId: string;
  correlationId: string;
  organizationId: string;
  timestamp: string;
  /** Machine-readable stage name, e.g. "executing" */
  stage?: string;
  /** Human-readable label, e.g. "Consulting specialist…" */
  humanLabel?: string;
  /** Only present on completion */
  completedWorkId?: string;
  /** Only present on failure */
  errorMessage?: string;
  /** Only present on clarification */
  clarificationQuestions?: string[];
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

// ─── Event buffer ─────────────────────────────────────────────────────────────

const EVENT_BUFFER_TTL_MS = 60_000; // 60 seconds

interface BufferedEvent {
  event: ExecutionEvent;
  expiresAt: number;
}

class ExecutionEventBuffer {
  private buffers = new Map<string, BufferedEvent[]>(); // conversationId → events

  push(conversationId: string, event: ExecutionEvent): void {
    const now = Date.now();
    if (!this.buffers.has(conversationId)) {
      this.buffers.set(conversationId, []);
    }
    const buf = this.buffers.get(conversationId)!;
    buf.push({ event, expiresAt: now + EVENT_BUFFER_TTL_MS });
    // Evict expired entries inline
    const fresh = buf.filter(e => e.expiresAt > now);
    this.buffers.set(conversationId, fresh);
  }

  /** Returns events with eventId > lastEventId (for reconnect catch-up). */
  since(conversationId: string, lastEventId: number): ExecutionEvent[] {
    const now = Date.now();
    return (this.buffers.get(conversationId) ?? [])
      .filter(e => e.expiresAt > now && e.event.eventId > lastEventId)
      .map(e => e.event);
  }

  clear(conversationId: string): void {
    this.buffers.delete(conversationId);
  }
}

// ─── Bus ─────────────────────────────────────────────────────────────────────

class ExecutionEventBusClass extends EventEmitter {
  private counter = 0;
  readonly buffer = new ExecutionEventBuffer();

  /** Emit an event to all SSE subscribers for this conversation. */
  emit(event: string | symbol, ...args: unknown[]): boolean;
  emit(
    conversationId: string,
    payload: Omit<ExecutionEvent, "eventId" | "timestamp">,
  ): boolean;
  emit(conversationId: string | symbol, ...args: unknown[]): boolean {
    // Overloaded: when first arg is a conversationId string and second is a payload object
    if (
      typeof conversationId === "string" &&
      args.length === 1 &&
      args[0] !== null &&
      typeof args[0] === "object" &&
      "type" in (args[0] as object)
    ) {
      const payload = args[0] as Omit<ExecutionEvent, "eventId" | "timestamp">;
      const full: ExecutionEvent = {
        ...payload,
        eventId: ++this.counter,
        timestamp: new Date().toISOString(),
      };
      this.buffer.push(conversationId, full);
      return super.emit(`exec:${conversationId}`, full);
    }
    return super.emit(conversationId as string, ...args);
  }
}

export const executionEventBus = new ExecutionEventBusClass();
executionEventBus.setMaxListeners(500); // allow many concurrent SSE clients

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Emit a progress event to all active SSE subscribers for a conversation.
 * Safe to call if no subscribers are connected — event is buffered for reconnect.
 */
export function emitExecutionEvent(
  conversationId: string,
  payload: Omit<ExecutionEvent, "eventId" | "timestamp">,
): void {
  executionEventBus.emit(conversationId, payload);
}

/**
 * Subscribe to execution events for a conversation.
 * Returns an unsubscribe function.
 */
export function subscribeToExecutionEvents(
  conversationId: string,
  listener: (event: ExecutionEvent) => void,
): () => void {
  const key = `exec:${conversationId}`;
  executionEventBus.on(key, listener);
  return () => executionEventBus.off(key, listener);
}

/**
 * Get buffered events since a given eventId (for SSE reconnect catch-up).
 */
export function getBufferedEventsSince(
  conversationId: string,
  lastEventId: number,
): ExecutionEvent[] {
  return executionEventBus.buffer.since(conversationId, lastEventId);
}
