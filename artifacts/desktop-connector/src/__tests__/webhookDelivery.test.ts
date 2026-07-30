/**
 * Broker — webhook delivery unit tests
 *
 * Tests HMAC signing, retry scheduling, and the delivery worker logic.
 * All tests are offline — no real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import {
  signWebhookBody,
  nextRetryAt,
  statusToEventType,
  WebhookDeliveryWorker,
  deliverWebhookEvent,
  type BrokerWebhookEvent,
} from "../broker/webhookDelivery.js";
import { ExecutionStore } from "../broker/store.js";
import pino from "pino";
import type { StoredExecution } from "../broker/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const logger = pino({ level: "silent" });

function makeExec(overrides: Partial<StoredExecution> = {}): StoredExecution {
  const now = new Date().toISOString();
  return {
    id: "exec-001", tenantId: "tenant-001", runtimeExecutionId: "rt-001",
    status: "running", packageJson: "{}", gatewaySessionId: null, errorMessage: null,
    createdAt: now, updatedAt: now, startedAt: null, completedAt: null,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    callbackUrl: "https://example.com/v1/runtime/events",
    ...overrides,
  };
}

function makeEvent(overrides: Partial<BrokerWebhookEvent> = {}): BrokerWebhookEvent {
  return {
    eventId: "evt-001", eventType: "execution.started",
    executionId: "exec-001", runtimeExecutionId: "rt-001", tenantId: "tenant-001",
    payload: {}, occurredAt: new Date().toISOString(), runtimeVersion: "1.0.0",
    ...overrides,
  };
}

// ─── HMAC signing ─────────────────────────────────────────────────────────────

describe("signWebhookBody", () => {
  const SECRET = "test-webhook-secret";
  const BODY = JSON.stringify({ foo: "bar" });

  it("produces sha256= prefix", () => {
    const sig = signWebhookBody(BODY, SECRET);
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("produces a deterministic signature for the same input", () => {
    expect(signWebhookBody(BODY, SECRET)).toBe(signWebhookBody(BODY, SECRET));
  });

  it("produces a different signature for different body", () => {
    expect(signWebhookBody(BODY, SECRET)).not.toBe(signWebhookBody(BODY + "x", SECRET));
  });

  it("matches manual HMAC-SHA256 computation", () => {
    const expected = "sha256=" + createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex");
    expect(signWebhookBody(BODY, SECRET)).toBe(expected);
  });

  it("produces different signatures for different secrets", () => {
    expect(signWebhookBody(BODY, SECRET)).not.toBe(signWebhookBody(BODY, "different-secret"));
  });
});

// ─── Retry scheduling ─────────────────────────────────────────────────────────

describe("nextRetryAt", () => {
  it("returns a future timestamp for first attempt", () => {
    const next = nextRetryAt(0, 2000, 5);
    expect(next).not.toBeNull();
    expect(new Date(next!).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns null when attempts are exhausted", () => {
    expect(nextRetryAt(5, 2000, 5)).toBeNull();
    expect(nextRetryAt(10, 2000, 5)).toBeNull();
  });

  it("increases delay with each attempt (exponential back-off)", () => {
    const d0 = new Date(nextRetryAt(0, 2000, 10)!).getTime() - Date.now();
    const d1 = new Date(nextRetryAt(1, 2000, 10)!).getTime() - Date.now();
    const d2 = new Date(nextRetryAt(2, 2000, 10)!).getTime() - Date.now();
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it("caps at 5 minutes maximum", () => {
    // At attempt 20 with 2000ms base, un-capped would be ~2^20 * 2000ms ≈ 23 days
    const next = nextRetryAt(20, 2000, 100);
    const diff = new Date(next!).getTime() - Date.now();
    expect(diff).toBeLessThanOrEqual(301_000); // 5 min + 1 s tolerance
  });
});

// ─── Event type mapping ───────────────────────────────────────────────────────

describe("statusToEventType", () => {
  it("maps running → execution.started", () => {
    expect(statusToEventType("running")).toBe("execution.started");
  });
  it("maps completed → execution.completed", () => {
    expect(statusToEventType("completed")).toBe("execution.completed");
  });
  it("maps failed → execution.failed", () => {
    expect(statusToEventType("failed")).toBe("execution.failed");
  });
  it("maps cancelled → execution.cancelled", () => {
    expect(statusToEventType("cancelled")).toBe("execution.cancelled");
  });
  it("maps timed_out → execution.expired", () => {
    expect(statusToEventType("timed_out")).toBe("execution.expired");
  });
  it("maps paused → execution.paused", () => {
    expect(statusToEventType("paused")).toBe("execution.paused");
  });
  it("returns null for queued (no webhook for initial state)", () => {
    expect(statusToEventType("queued")).toBeNull();
  });
});

// ─── Webhook delivery (mocked fetch) ─────────────────────────────────────────

describe("deliverWebhookEvent", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok=true on successful delivery", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const result = await deliverWebhookEvent(
      "https://example.com/v1/runtime/events",
      makeEvent(),
      "secret",
    );
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("returns ok=false on 4xx response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 401 } as Response);
    const result = await deliverWebhookEvent(
      "https://example.com/v1/runtime/events",
      makeEvent(),
      "secret",
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("returns ok=false on network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await deliverWebhookEvent(
      "https://example.com/v1/runtime/events",
      makeEvent(),
      "secret",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("sends X-OpenClaw-Signature header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    await deliverWebhookEvent("https://example.com/v1/runtime/events", makeEvent(), "secret");
    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers["X-OpenClaw-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it("sends X-OpenClaw-Event-Id header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200 } as Response);
    const event = makeEvent({ eventId: "test-event-id" });
    await deliverWebhookEvent("https://example.com/v1/runtime/events", event, "secret");
    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    const headers = (options as RequestInit).headers as Record<string, string>;
    expect(headers["X-OpenClaw-Event-Id"]).toBe("test-event-id");
  });
});

// ─── WebhookDeliveryWorker ────────────────────────────────────────────────────

describe("WebhookDeliveryWorker.queueEvent", () => {
  let store: ExecutionStore;
  let worker: WebhookDeliveryWorker;

  beforeEach(() => {
    store = new ExecutionStore(":memory:");
    worker = new WebhookDeliveryWorker(store, "secret", 5, 2000, 60_000, logger);
  });

  afterEach(() => {
    worker.stop();
    store.close();
  });

  it("inserts a pending event for a terminal status", () => {
    const exec = makeExec({ status: "completed" });
    store.insertExecution(exec);
    worker.queueEvent(exec, "completed", { completedAt: new Date().toISOString() });
    const pending = store.getPendingWebhookEvents();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.eventType).toBe("execution.completed");
  });

  it("does not insert an event for queued status", () => {
    const exec = makeExec({ status: "queued" });
    store.insertExecution(exec);
    worker.queueEvent(exec, "queued");
    expect(store.getPendingWebhookEvents()).toHaveLength(0);
  });

  it("inserts separate events for separate status changes", () => {
    const exec = makeExec({ status: "running" });
    store.insertExecution(exec);
    worker.queueEvent(exec, "running");
    worker.queueEvent(exec, "completed");
    const all = store.getEventsForExecution("exec-001");
    expect(all).toHaveLength(2);
  });
});
