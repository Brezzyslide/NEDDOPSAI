/**
 * NeedsOps Runtime Broker — Webhook Delivery Worker
 *
 * Sends execution lifecycle events back to NeedsOps at the callbackUrl
 * included in every execution package. Events are signed with HMAC-SHA256
 * using OPENCLAW_WEBHOOK_SECRET so NeedsOps can verify they come from a
 * legitimate broker.
 *
 * Delivery model:
 *   1. Each status transition writes an event row in the SQLite store with
 *      webhook_delivered = 0 and a scheduled next_attempt_at.
 *   2. A background polling loop reads pending events and delivers them.
 *   3. On success, webhook_delivered = 1.
 *   4. On failure, attempt count is incremented and next_attempt_at is
 *      pushed out with exponential back-off.
 *   5. After max attempts, the event is marked as permanently failed.
 *      The broker logs the failure but does not crash.
 *
 * Idempotency:
 *   Each event carries a unique eventId. NeedsOps de-duplicates on its side
 *   using this ID, so retried deliveries are safe.
 */

import { createHmac, randomUUID } from "crypto";
import type { ExecutionStore } from "./store.js";
import type { StoredExecution, BrokerExecutionStatus } from "./types.js";
import type pino from "pino";

// ─── Webhook event shape (must match OpenClawWebhookEvent in lib/openclaw) ───

export interface BrokerWebhookEvent {
  eventId: string;
  eventType: string;
  executionId: string;
  runtimeExecutionId: string;
  tenantId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  runtimeVersion: string;
}

// ─── Status → event type mapping ─────────────────────────────────────────────

const STATUS_EVENT_TYPES: Partial<Record<BrokerExecutionStatus, string>> = {
  submitted:  "execution.accepted",
  running:    "execution.started",
  paused:     "execution.paused",
  completed:  "execution.completed",
  failed:     "execution.failed",
  cancelled:  "execution.cancelled",
  timed_out:  "execution.expired",
};

export function statusToEventType(status: BrokerExecutionStatus): string | null {
  return STATUS_EVENT_TYPES[status] ?? null;
}

// ─── HMAC signing ─────────────────────────────────────────────────────────────

export function signWebhookBody(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

// ─── Retry schedule ───────────────────────────────────────────────────────────

/**
 * Calculate the next retry timestamp using exponential back-off.
 * Returns null when all attempts are exhausted.
 */
export function nextRetryAt(
  attemptCount: number,
  baseDelayMs: number,
  maxAttempts: number,
): string | null {
  if (attemptCount >= maxAttempts) return null;
  const jitter = Math.random() * 1000; // 0–1 s jitter
  const delay = Math.min(baseDelayMs * Math.pow(2, attemptCount) + jitter, 300_000); // max 5 min
  return new Date(Date.now() + delay).toISOString();
}

// ─── Single event delivery ────────────────────────────────────────────────────

export async function deliverWebhookEvent(
  callbackUrl: string,
  event: BrokerWebhookEvent,
  webhookSecret: string,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const body = JSON.stringify(event);
  const signature = webhookSecret ? signWebhookBody(body, webhookSecret) : "";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenClaw-Signature": signature,
        "X-OpenClaw-Event-Id": event.eventId,
        "X-Broker-Version": event.runtimeVersion,
        "User-Agent": "NeedsOps-RuntimeBroker/1.0",
      },
      body,
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).name === "AbortError" ? "timeout" : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Webhook Delivery Worker ──────────────────────────────────────────────────

export class WebhookDeliveryWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly store: ExecutionStore,
    private readonly webhookSecret: string,
    private readonly maxAttempts: number,
    private readonly retryBaseMs: number,
    private readonly intervalMs: number,
    private readonly logger: pino.Logger,
    private readonly brokerVersion: string = "1.0.0",
  ) {}

  /** Queue a webhook event for the given execution status change. */
  queueEvent(exec: StoredExecution, status: BrokerExecutionStatus, extra?: {
    startedAt?: string;
    completedAt?: string;
    errorMessage?: string;
  }): void {
    const eventType = statusToEventType(status);
    if (!eventType) return; // Not all statuses produce events (e.g. "queued")

    const event: BrokerWebhookEvent = {
      eventId: randomUUID(),
      eventType,
      executionId: exec.id,
      runtimeExecutionId: exec.runtimeExecutionId,
      tenantId: exec.tenantId,
      payload: {
        ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}),
        ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
        ...(extra?.errorMessage ? { errorMessage: extra.errorMessage } : {}),
        brokerStatus: status,
      },
      occurredAt: new Date().toISOString(),
      runtimeVersion: this.brokerVersion,
    };

    this.store.insertEvent({
      executionId: exec.id,
      eventType,
      payloadJson: JSON.stringify(event),
      webhookNextAttemptAt: new Date().toISOString(), // deliver immediately on first attempt
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => void this._processQueue(), this.intervalMs);
    this.logger.info({ intervalMs: this.intervalMs }, "[webhook-worker] Webhook delivery worker started");
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.info("[webhook-worker] Webhook delivery worker stopped");
  }

  private async _processQueue(): Promise<void> {
    const pending = this.store.getPendingWebhookEvents(20);
    if (pending.length === 0) return;

    this.logger.debug({ count: pending.length }, "[webhook-worker] Processing pending webhook events");

    await Promise.all(
      pending.map(async (storedEvent) => {
        const event = JSON.parse(storedEvent.payloadJson) as BrokerWebhookEvent;
        const exec = this.store.getExecution(storedEvent.executionId);
        if (!exec) {
          // Orphaned event — mark as delivered to stop retrying
          this.store.markEventDelivered(storedEvent.id);
          return;
        }

        const result = await deliverWebhookEvent(exec.callbackUrl, event, this.webhookSecret);

        if (result.ok) {
          this.store.markEventDelivered(storedEvent.id);
          this.logger.info(
            { eventId: event.eventId, eventType: event.eventType, executionId: exec.id },
            "[webhook-worker] Webhook delivered",
          );
        } else {
          const attemptCount = storedEvent.webhookAttemptCount + 1;
          const next = nextRetryAt(attemptCount, this.retryBaseMs, this.maxAttempts);

          if (next === null) {
            // Exhausted retries — mark as permanently failed (delivered=1 stops retrying)
            this.store.markEventDelivered(storedEvent.id);
            this.logger.error(
              {
                eventId: event.eventId,
                eventType: event.eventType,
                executionId: exec.id,
                attemptCount,
                error: result.error ?? result.status,
              },
              "[webhook-worker] Webhook delivery permanently failed after max attempts",
            );
          } else {
            this.store.markEventDeliveryAttempted(storedEvent.id, next);
            this.logger.warn(
              {
                eventId: event.eventId,
                attemptCount,
                nextAttemptAt: next,
                error: result.error ?? result.status,
              },
              "[webhook-worker] Webhook delivery failed — will retry",
            );
          }
        }
      }),
    );
  }
}
