/**
 * Broker — SQLite execution store unit tests
 *
 * Uses an in-memory SQLite database so tests are isolated and fast.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ExecutionStore } from "../broker/store.js";
import type { StoredExecution } from "../broker/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let store: ExecutionStore;

beforeEach(() => {
  // :memory: gives a fresh in-memory DB for every test
  store = new ExecutionStore(":memory:");
});

afterEach(() => {
  store.close();
});

function makeExec(overrides: Partial<StoredExecution> = {}): StoredExecution {
  const now = new Date().toISOString();
  const future = new Date(Date.now() + 300_000).toISOString();
  return {
    id: "exec-001",
    tenantId: "tenant-001",
    runtimeExecutionId: "rt-001",
    status: "queued",
    packageJson: "{}",
    gatewaySessionId: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    expiresAt: future,
    callbackUrl: "https://example.com/v1/runtime/events",
    ...overrides,
  };
}

// ─── Execution CRUD tests ────────────────────────────────────────────────────

describe("ExecutionStore — insertExecution / getExecution", () => {
  it("stores and retrieves an execution", () => {
    const exec = makeExec();
    store.insertExecution(exec);
    const retrieved = store.getExecution("exec-001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("exec-001");
    expect(retrieved!.tenantId).toBe("tenant-001");
    expect(retrieved!.status).toBe("queued");
  });

  it("returns null for unknown execution ID", () => {
    expect(store.getExecution("does-not-exist")).toBeNull();
  });

  it("is idempotent on duplicate insertions (ON CONFLICT DO NOTHING)", () => {
    const exec = makeExec();
    store.insertExecution(exec);
    // Second insert should not throw
    expect(() => store.insertExecution({ ...exec, status: "running" })).not.toThrow();
    // First value is preserved
    expect(store.getExecution("exec-001")!.status).toBe("queued");
  });
});

describe("ExecutionStore — getExecutionForTenant", () => {
  it("returns the execution when tenant matches", () => {
    store.insertExecution(makeExec());
    expect(store.getExecutionForTenant("exec-001", "tenant-001")).not.toBeNull();
  });

  it("returns null when tenant does not match", () => {
    store.insertExecution(makeExec());
    expect(store.getExecutionForTenant("exec-001", "tenant-999")).toBeNull();
  });
});

describe("ExecutionStore — updateStatus", () => {
  it("updates status and updatedAt", () => {
    store.insertExecution(makeExec());
    store.updateStatus("exec-001", "running", { startedAt: new Date().toISOString() });
    const exec = store.getExecution("exec-001")!;
    expect(exec.status).toBe("running");
    expect(exec.startedAt).not.toBeNull();
  });

  it("persists gatewaySessionId on first update", () => {
    store.insertExecution(makeExec());
    store.updateStatus("exec-001", "submitted", { gatewaySessionId: "gw-123" });
    expect(store.getExecution("exec-001")!.gatewaySessionId).toBe("gw-123");
  });

  it("persists errorMessage on failure", () => {
    store.insertExecution(makeExec());
    store.updateStatus("exec-001", "failed", { errorMessage: "Gateway rejected" });
    expect(store.getExecution("exec-001")!.errorMessage).toBe("Gateway rejected");
  });

  it("preserves existing gatewaySessionId when not provided in update", () => {
    store.insertExecution(makeExec());
    store.updateStatus("exec-001", "submitted", { gatewaySessionId: "gw-original" });
    store.updateStatus("exec-001", "running");  // no gatewaySessionId provided
    expect(store.getExecution("exec-001")!.gatewaySessionId).toBe("gw-original");
  });
});

describe("ExecutionStore — expireStaleExecutions", () => {
  it("marks expired non-terminal executions as timed_out", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    store.insertExecution(makeExec({ expiresAt: past, status: "running" }));
    const count = store.expireStaleExecutions();
    expect(count).toBe(1);
    expect(store.getExecution("exec-001")!.status).toBe("timed_out");
  });

  it("does not affect terminal executions", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    store.insertExecution(makeExec({ expiresAt: past, status: "completed" }));
    const count = store.expireStaleExecutions();
    expect(count).toBe(0);
    expect(store.getExecution("exec-001")!.status).toBe("completed");
  });

  it("does not affect future-expiring executions", () => {
    const future = new Date(Date.now() + 300_000).toISOString();
    store.insertExecution(makeExec({ expiresAt: future, status: "running" }));
    const count = store.expireStaleExecutions();
    expect(count).toBe(0);
  });
});

describe("ExecutionStore — event log", () => {
  it("inserts and retrieves events for an execution", () => {
    store.insertExecution(makeExec());
    const nextAt = new Date().toISOString();
    const event = store.insertEvent({
      executionId: "exec-001",
      eventType: "execution.started",
      payloadJson: JSON.stringify({ status: "running" }),
      webhookNextAttemptAt: nextAt,
    });

    expect(event.id).toBeTruthy();
    expect(event.webhookDelivered).toBe(0);

    const events = store.getEventsForExecution("exec-001");
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe("execution.started");
  });

  it("returns pending events that are due for delivery", () => {
    store.insertExecution(makeExec());
    const past = new Date(Date.now() - 1000).toISOString();
    store.insertEvent({
      executionId: "exec-001",
      eventType: "execution.started",
      payloadJson: "{}",
      webhookNextAttemptAt: past,
    });

    const pending = store.getPendingWebhookEvents();
    expect(pending).toHaveLength(1);
  });

  it("does not return events scheduled in the future", () => {
    store.insertExecution(makeExec());
    const future = new Date(Date.now() + 60_000).toISOString();
    store.insertEvent({
      executionId: "exec-001",
      eventType: "execution.started",
      payloadJson: "{}",
      webhookNextAttemptAt: future,
    });

    const pending = store.getPendingWebhookEvents();
    expect(pending).toHaveLength(0);
  });

  it("markEventDelivered removes event from pending queue", () => {
    store.insertExecution(makeExec());
    const ev = store.insertEvent({
      executionId: "exec-001",
      eventType: "execution.started",
      payloadJson: "{}",
      webhookNextAttemptAt: new Date().toISOString(),
    });

    store.markEventDelivered(ev.id);
    expect(store.getPendingWebhookEvents()).toHaveLength(0);
  });

  it("markEventDeliveryAttempted increments attempt count", () => {
    store.insertExecution(makeExec());
    const ev = store.insertEvent({
      executionId: "exec-001",
      eventType: "execution.started",
      payloadJson: "{}",
      webhookNextAttemptAt: new Date(Date.now() - 1000).toISOString(),
    });

    const future = new Date(Date.now() + 60_000).toISOString();
    store.markEventDeliveryAttempted(ev.id, future);

    const events = store.getEventsForExecution("exec-001");
    expect(events[0]!.webhookAttemptCount).toBe(1);
    // Should not appear as pending since next attempt is in the future
    expect(store.getPendingWebhookEvents()).toHaveLength(0);
  });
});
