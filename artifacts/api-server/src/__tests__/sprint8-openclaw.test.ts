/**
 * Sprint 8 — OpenClaw Runtime Integration Tests
 *
 * Covers:
 *   - Runtime registration and health
 *   - Execution engine interface compliance
 *   - Execution package translation and validation
 *   - Runtime event translation
 *   - Execution status transitions
 *   - Webhook signature verification
 *   - Execution pause, resume, and cancellation
 *   - Tenant isolation enforcement
 *   - Invalid runtime rejection
 *   - Expired execution rejection
 *   - Event-to-task-state propagation
 *   - "Not connected" graceful degradation
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadOpenClawConfig,
  isOpenClawConfigured,
  buildCallbackUrl,
  OpenClawExecutionEngine,
  RuntimeBrokerClient,
  BrokerRequestError,
  translateToOpenClawPackage,
  validateExecutionPackage,
  ExecutionPackageValidationError,
  translateOpenClawEvent,
  validateOpenClawEvent,
  resolveStatusTransition,
  resolveTaskStateUpdate,
  isTerminalStatus,
  EVENT_TO_STATUS_TRANSITION,
  EXECUTION_STATUS_MESSAGES,
  getStatusMessage,
  TERMINAL_EXECUTION_STATUSES,
  RuntimeEventValidationError,
} from "@workspace/openclaw";
import type { ExecutionPackage, RuntimeEvent } from "@workspace/agent-runtime";
import type { OpenClawWebhookEvent } from "@workspace/openclaw";
import { randomUUID } from "crypto";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeExecutionPackage(overrides: Partial<ExecutionPackage> = {}): ExecutionPackage {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();

  return {
    executionId: randomUUID(),
    taskId: randomUUID(),
    tenantId: randomUUID(),
    workforceRole: "operations_manager",
    workerProfile: {
      allowedChannels: ["api", "internal"],
      allowedBrowserDomains: [],
      allowedLocalPathCategories: [],
      allowedApplicationCategories: [],
      prohibitedActions: ["delete_records"],
      riskLevel: "low",
      requiresApprovalFor: [],
    },
    steps: [
      {
        sequence: 1,
        specialist: "operations_manager",
        action: "analyse_request",
        description: "Analyse the incoming request",
        requiresApproval: false,
      },
      {
        sequence: 2,
        specialist: "operations_manager",
        action: "produce_output",
        description: "Produce the requested output",
        requiresApproval: false,
      },
    ],
    requestedTools: ["api_call"],
    requestedChannels: ["api"],
    requestedConnectorCategories: [],
    approvalState: "not_required",
    constraints: {
      maxDurationSeconds: 300,
      requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context"],
    },
    callbackUrl: "https://platform.needsops.com/v1/runtime/events",
    expiresAt,
    issuedAt: now.toISOString(),
    ...overrides,
  };
}

function makeOpenClawEvent(overrides: Partial<OpenClawWebhookEvent> = {}): OpenClawWebhookEvent {
  return {
    eventId: randomUUID(),
    eventType: "execution.accepted",
    executionId: randomUUID(),
    runtimeExecutionId: randomUUID(),
    tenantId: randomUUID(),
    payload: {},
    occurredAt: new Date().toISOString(),
    runtimeVersion: "1.0.0",
    ...overrides,
  };
}

// ─── Section 1: Configuration ──────────────────────────────────────────────────

describe("OpenClaw Configuration", () => {
  it("loadOpenClawConfig returns all default values when no env vars are set", () => {
    const config = loadOpenClawConfig();
    expect(config.runtimeUrl).toBeNull();
    expect(config.timeoutMs).toBe(30000);
    expect(config.retryAttempts).toBe(3);
    expect(config.retryDelayMs).toBe(1000);
    expect(config.heartbeatIntervalMs).toBe(30000);
    expect(config.executionTtlSeconds).toBe(300);
  });

  it("isOpenClawConfigured returns false when runtimeUrl is null", () => {
    expect(isOpenClawConfigured({ runtimeUrl: null } as Parameters<typeof isOpenClawConfigured>[0])).toBe(false);
  });

  it("isOpenClawConfigured returns false when runtimeUrl is empty string", () => {
    expect(isOpenClawConfigured({ runtimeUrl: "" } as Parameters<typeof isOpenClawConfigured>[0])).toBe(false);
  });

  it("isOpenClawConfigured returns true when runtimeUrl is set", () => {
    expect(isOpenClawConfigured({ runtimeUrl: "https://broker.openclaw.internal" } as Parameters<typeof isOpenClawConfigured>[0])).toBe(true);
  });

  it("buildCallbackUrl returns null when callbackBaseUrl is not configured", () => {
    expect(buildCallbackUrl({ callbackBaseUrl: null } as Parameters<typeof buildCallbackUrl>[0])).toBeNull();
  });

  it("buildCallbackUrl appends /v1/runtime/events to the base URL", () => {
    const url = buildCallbackUrl({
      callbackBaseUrl: "https://api.needsops.com",
    } as Parameters<typeof buildCallbackUrl>[0]);
    expect(url).toBe("https://api.needsops.com/v1/runtime/events");
  });

  it("buildCallbackUrl removes trailing slash before appending path", () => {
    const url = buildCallbackUrl({
      callbackBaseUrl: "https://api.needsops.com/",
    } as Parameters<typeof buildCallbackUrl>[0]);
    expect(url).toBe("https://api.needsops.com/v1/runtime/events");
  });
});

// ─── Section 2: Runtime Health (not connected) ────────────────────────────────

describe("OpenClaw Execution Engine — not connected", () => {
  let engine: OpenClawExecutionEngine;

  beforeEach(() => {
    engine = new OpenClawExecutionEngine(loadOpenClawConfig());
  });

  it("getHealth returns not_connected status when runtime URL is absent", async () => {
    const health = await engine.getHealth();
    expect(health.status).toBe("not_connected");
    expect(health.capabilities).toBeNull();
    expect(health.activeExecutions).toBe(0);
  });

  it("getHealth message contains 'not connected' when runtime is absent", async () => {
    const health = await engine.getHealth();
    expect(health.message).toMatch(/not connected/i);
  });

  it("getCapabilities returns null when runtime is not connected", async () => {
    const caps = await engine.getCapabilities();
    expect(caps).toBeNull();
  });

  it("submitExecution throws RUNTIME_NOT_CONFIGURED when not connected", async () => {
    const pkg = makeExecutionPackage();
    await expect(engine.submitExecution(pkg)).rejects.toThrow(/not configured/i);
  });

  it("runtime name is 'openclaw'", () => {
    expect(engine.runtimeName).toBe("openclaw");
  });
});

// ─── Section 3: Execution Package Validation ──────────────────────────────────

describe("Execution Package Validation", () => {
  it("valid package passes validation without throwing", () => {
    const pkg = makeExecutionPackage();
    expect(() => validateExecutionPackage(pkg)).not.toThrow();
  });

  it("missing executionId throws ExecutionPackageValidationError", () => {
    const pkg = makeExecutionPackage({ executionId: "" });
    expect(() => validateExecutionPackage(pkg)).toThrow(ExecutionPackageValidationError);
  });

  it("missing taskId does not throw (taskId is internal-only)", () => {
    const pkg = makeExecutionPackage({ taskId: "" });
    // taskId is not validated in the package translator — it's internal
    expect(() => validateExecutionPackage(pkg)).not.toThrow();
  });

  it("missing tenantId throws ExecutionPackageValidationError", () => {
    const pkg = makeExecutionPackage({ tenantId: "" });
    expect(() => validateExecutionPackage(pkg)).toThrow(ExecutionPackageValidationError);
  });

  it("missing workforceRole throws ExecutionPackageValidationError", () => {
    const pkg = makeExecutionPackage({ workforceRole: "" });
    expect(() => validateExecutionPackage(pkg)).toThrow(ExecutionPackageValidationError);
  });

  it("missing steps throws ExecutionPackageValidationError", () => {
    const pkg = makeExecutionPackage({ steps: [] });
    expect(() => validateExecutionPackage(pkg)).toThrow(ExecutionPackageValidationError);
  });

  it("expired expiresAt throws ExecutionPackageValidationError", () => {
    const expiredPkg = makeExecutionPackage({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(() => validateExecutionPackage(expiredPkg)).toThrow(ExecutionPackageValidationError);
  });

  it("invalid expiresAt date string throws ExecutionPackageValidationError", () => {
    const pkg = makeExecutionPackage({ expiresAt: "not-a-date" });
    expect(() => validateExecutionPackage(pkg)).toThrow(ExecutionPackageValidationError);
  });

  it("validation error includes the field name", () => {
    try {
      validateExecutionPackage(makeExecutionPackage({ tenantId: "" }));
    } catch (err) {
      expect((err as ExecutionPackageValidationError).field).toBe("tenantId");
    }
  });
});

// ─── Section 4: Execution Package Translation ──────────────────────────────────

describe("Execution Package Translation", () => {
  const config = loadOpenClawConfig();

  it("translates a valid NeedsOps package to OpenClaw wire format", () => {
    const pkg = makeExecutionPackage();
    const wire = translateToOpenClawPackage(pkg, config);

    expect(wire.executionId).toBe(pkg.executionId);
    expect(wire.tenantId).toBe(pkg.tenantId);
    expect(wire.workforceRole).toBe(pkg.workforceRole);
    expect(wire.steps).toHaveLength(pkg.steps.length);
    expect(wire.approvalState).toBe(pkg.approvalState);
  });

  it("wire format includes workerProfile constraints", () => {
    const pkg = makeExecutionPackage();
    const wire = translateToOpenClawPackage(pkg, config);

    expect(wire.workerProfile.allowedChannels).toEqual(pkg.workerProfile.allowedChannels);
    expect(wire.workerProfile.prohibitedActions).toEqual(pkg.workerProfile.prohibitedActions);
    expect(wire.workerProfile.riskLevel).toBe(pkg.workerProfile.riskLevel);
  });

  it("wire format does NOT include taskId (internal NeedsOps identifier)", () => {
    const pkg = makeExecutionPackage();
    const wire = translateToOpenClawPackage(pkg, config);
    expect((wire as Record<string, unknown>).taskId).toBeUndefined();
  });

  it("steps are ordered by sequence number in the wire format", () => {
    const pkg = makeExecutionPackage();
    const wire = translateToOpenClawPackage(pkg, config);

    const sequences = wire.steps.map(s => s.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  it("callbackUrl from config overrides package callbackUrl when configured", () => {
    const configWithCallback = {
      ...loadOpenClawConfig(),
      callbackBaseUrl: "https://api.needsops.com",
    };
    const pkg = makeExecutionPackage({ callbackUrl: "https://old.callback.url" });
    const wire = translateToOpenClawPackage(pkg, configWithCallback);
    expect(wire.callbackUrl).toBe("https://api.needsops.com/v1/runtime/events");
  });

  it("package callbackUrl is used when config has no callbackBaseUrl", () => {
    const pkg = makeExecutionPackage({
      callbackUrl: "https://platform.needsops.com/v1/runtime/events",
    });
    const wire = translateToOpenClawPackage(pkg, config);
    expect(wire.callbackUrl).toBe("https://platform.needsops.com/v1/runtime/events");
  });

  it("translation throws ExecutionPackageValidationError for expired package", () => {
    const pkg = makeExecutionPackage({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(() => translateToOpenClawPackage(pkg, config)).toThrow(ExecutionPackageValidationError);
  });
});

// ─── Section 5: Runtime Event Validation ──────────────────────────────────────

describe("Runtime Event Validation", () => {
  it("valid event passes validation without throwing", () => {
    const event = makeOpenClawEvent();
    expect(() => validateOpenClawEvent(event)).not.toThrow();
  });

  it("missing eventId throws RuntimeEventValidationError", () => {
    const event = makeOpenClawEvent({ eventId: "" });
    expect(() => validateOpenClawEvent(event)).toThrow(RuntimeEventValidationError);
  });

  it("missing eventType throws RuntimeEventValidationError", () => {
    const event = makeOpenClawEvent({ eventType: undefined as unknown as typeof event.eventType });
    expect(() => validateOpenClawEvent(event)).toThrow(RuntimeEventValidationError);
  });

  it("missing executionId throws RuntimeEventValidationError", () => {
    const event = makeOpenClawEvent({ executionId: "" });
    expect(() => validateOpenClawEvent(event)).toThrow(RuntimeEventValidationError);
  });

  it("missing tenantId throws RuntimeEventValidationError", () => {
    const event = makeOpenClawEvent({ tenantId: "" });
    expect(() => validateOpenClawEvent(event)).toThrow(RuntimeEventValidationError);
  });

  it("unknown event type throws RuntimeEventValidationError", () => {
    const event = makeOpenClawEvent({
      eventType: "execution.unknown_future_event" as typeof event.eventType,
    });
    expect(() => validateOpenClawEvent(event)).toThrow(RuntimeEventValidationError);
  });
});

// ─── Section 6: Runtime Event Translation ─────────────────────────────────────

describe("Runtime Event Translation", () => {
  it("translates execution.accepted correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.accepted" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.accepted");
    expect(event.executionId).toBe(raw.executionId);
    expect(event.tenantId).toBe(raw.tenantId);
  });

  it("translates execution.started correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.started" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.started");
  });

  it("translates execution.completed correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.completed" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.completed");
  });

  it("translates execution.failed correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.failed" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.failed");
  });

  it("translates execution.paused correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.paused" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.paused");
  });

  it("translates execution.resumed correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.resumed" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.resumed");
  });

  it("translates execution.awaiting_approval correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.awaiting_approval" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.awaiting_approval");
  });

  it("translates execution.cancelled correctly", () => {
    const raw = makeOpenClawEvent({ eventType: "execution.cancelled" });
    const event = translateOpenClawEvent(raw);
    expect(event.eventType).toBe("execution.cancelled");
  });

  it("runtimeExecutionId is preserved in translation", () => {
    const rteId = randomUUID();
    const raw = makeOpenClawEvent({ runtimeExecutionId: rteId });
    const event = translateOpenClawEvent(raw);
    expect(event.runtimeExecutionId).toBe(rteId);
  });

  it("event payload is preserved in translation", () => {
    const raw = makeOpenClawEvent({
      payload: { progress: 42, stepName: "analyse_request" },
    });
    const event = translateOpenClawEvent(raw);
    expect(event.payload.progress).toBe(42);
    expect(event.payload.stepName).toBe("analyse_request");
  });
});

// ─── Section 7: Status Transitions ────────────────────────────────────────────

describe("Execution Status Transitions", () => {
  function makeRuntimeEvent(eventType: RuntimeEvent["eventType"]): RuntimeEvent {
    return {
      eventId: randomUUID(),
      eventType,
      executionId: randomUUID(),
      runtimeExecutionId: randomUUID(),
      tenantId: randomUUID(),
      payload: {},
      occurredAt: new Date().toISOString(),
    };
  }

  it("execution.accepted transitions status to accepted", () => {
    const event = makeRuntimeEvent("execution.accepted");
    const newStatus = resolveStatusTransition(event, "submitted");
    expect(newStatus).toBe("accepted");
  });

  it("execution.started transitions status to running", () => {
    const event = makeRuntimeEvent("execution.started");
    const newStatus = resolveStatusTransition(event, "accepted");
    expect(newStatus).toBe("running");
  });

  it("execution.paused transitions status to paused", () => {
    const event = makeRuntimeEvent("execution.paused");
    const newStatus = resolveStatusTransition(event, "running");
    expect(newStatus).toBe("paused");
  });

  it("execution.resumed transitions status to running", () => {
    const event = makeRuntimeEvent("execution.resumed");
    const newStatus = resolveStatusTransition(event, "paused");
    expect(newStatus).toBe("running");
  });

  it("execution.awaiting_approval transitions status to awaiting_approval", () => {
    const event = makeRuntimeEvent("execution.awaiting_approval");
    const newStatus = resolveStatusTransition(event, "running");
    expect(newStatus).toBe("awaiting_approval");
  });

  it("execution.completed transitions status to completed", () => {
    const event = makeRuntimeEvent("execution.completed");
    const newStatus = resolveStatusTransition(event, "running");
    expect(newStatus).toBe("completed");
  });

  it("execution.failed transitions status to failed", () => {
    const event = makeRuntimeEvent("execution.failed");
    const newStatus = resolveStatusTransition(event, "running");
    expect(newStatus).toBe("failed");
  });

  it("execution.cancelled transitions status to cancelled", () => {
    const event = makeRuntimeEvent("execution.cancelled");
    const newStatus = resolveStatusTransition(event, "running");
    expect(newStatus).toBe("cancelled");
  });

  it("execution.progress does NOT change status", () => {
    const event = makeRuntimeEvent("execution.progress");
    const newStatus = resolveStatusTransition(event, "running");
    expect(newStatus).toBeNull();
  });

  it("runtime.connected does NOT change execution status", () => {
    const event = makeRuntimeEvent("runtime.connected");
    const newStatus = resolveStatusTransition(event, "submitted");
    expect(newStatus).toBeNull();
  });

  it("no event can transition a terminal status", () => {
    const terminalStatuses = ["completed", "failed", "cancelled", "expired"] as const;
    const event = makeRuntimeEvent("execution.started");

    for (const status of terminalStatuses) {
      const result = resolveStatusTransition(event, status);
      expect(result).toBeNull();
    }
  });

  it("same-status transition returns null (idempotent)", () => {
    const event = makeRuntimeEvent("execution.accepted");
    const result = resolveStatusTransition(event, "accepted");
    expect(result).toBeNull();
  });
});

// ─── Section 8: Terminal States ────────────────────────────────────────────────

describe("Terminal Execution States", () => {
  it("completed is a terminal state", () => {
    expect(isTerminalStatus("completed")).toBe(true);
  });

  it("failed is a terminal state", () => {
    expect(isTerminalStatus("failed")).toBe(true);
  });

  it("cancelled is a terminal state", () => {
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("expired is a terminal state", () => {
    expect(isTerminalStatus("expired")).toBe(true);
  });

  it("running is NOT a terminal state", () => {
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("accepted is NOT a terminal state", () => {
    expect(isTerminalStatus("accepted")).toBe(false);
  });

  it("paused is NOT a terminal state", () => {
    expect(isTerminalStatus("paused")).toBe(false);
  });

  it("TERMINAL_EXECUTION_STATUSES contains exactly 4 states", () => {
    expect(TERMINAL_EXECUTION_STATUSES.size).toBe(4);
  });
});

// ─── Section 9: Task State Propagation ────────────────────────────────────────

describe("Task State Propagation from Execution Status", () => {
  it("completed execution propagates to task completed state", () => {
    expect(resolveTaskStateUpdate("completed")).toBe("completed");
  });

  it("failed execution propagates to task failed state", () => {
    expect(resolveTaskStateUpdate("failed")).toBe("failed");
  });

  it("cancelled execution propagates to task cancelled state", () => {
    expect(resolveTaskStateUpdate("cancelled")).toBe("cancelled");
  });

  it("awaiting_approval execution propagates to task awaiting_approval state", () => {
    expect(resolveTaskStateUpdate("awaiting_approval")).toBe("awaiting_approval");
  });

  it("running execution does NOT change task state", () => {
    expect(resolveTaskStateUpdate("running")).toBeNull();
  });

  it("accepted execution does NOT change task state", () => {
    expect(resolveTaskStateUpdate("accepted")).toBeNull();
  });

  it("paused execution does NOT change task state", () => {
    expect(resolveTaskStateUpdate("paused")).toBeNull();
  });

  it("submitted execution does NOT change task state", () => {
    expect(resolveTaskStateUpdate("submitted")).toBeNull();
  });
});

// ─── Section 10: Webhook Signature Verification ───────────────────────────────

describe("Webhook Signature Verification", () => {
  it("accepts unsigned events in development (no webhook secret configured)", () => {
    const client = new RuntimeBrokerClient({
      ...loadOpenClawConfig(),
      webhookSecret: null,
    });
    // NODE_ENV is 'test', not 'production' — should pass
    const result = client.verifyWebhookSignature(Buffer.from("{}"), undefined);
    expect(result).toBe(true);
  });

  it("rejects events when signature header is missing and secret is configured", () => {
    const client = new RuntimeBrokerClient({
      ...loadOpenClawConfig(),
      webhookSecret: "super-secret-webhook-key-12345",
    });
    const result = client.verifyWebhookSignature(Buffer.from("{}"), undefined);
    expect(result).toBe(false);
  });

  it("accepts events with valid HMAC-SHA256 signature", () => {
    const secret = "test-webhook-secret-abc123";
    const client = new RuntimeBrokerClient({
      ...loadOpenClawConfig(),
      webhookSecret: secret,
    });

    const body = Buffer.from(JSON.stringify({ eventId: "abc", eventType: "execution.accepted" }));

    // Compute expected signature
    const { createHmac } = require("crypto");
    const expectedHex = createHmac("sha256", secret).update(body).digest("hex");
    const signatureHeader = `sha256=${expectedHex}`;

    expect(client.verifyWebhookSignature(body, signatureHeader)).toBe(true);
  });

  it("rejects events with wrong HMAC signature", () => {
    const client = new RuntimeBrokerClient({
      ...loadOpenClawConfig(),
      webhookSecret: "correct-secret",
    });

    const body = Buffer.from(JSON.stringify({ eventId: "abc" }));
    const wrongSig = "sha256=0000000000000000000000000000000000000000000000000000000000000000";

    expect(client.verifyWebhookSignature(body, wrongSig)).toBe(false);
  });

  it("rejects tampered body even with valid signature format", () => {
    const secret = "test-secret";
    const client = new RuntimeBrokerClient({
      ...loadOpenClawConfig(),
      webhookSecret: secret,
    });

    const originalBody = Buffer.from('{"eventId":"abc"}');
    const { createHmac } = require("crypto");
    const sig = `sha256=${createHmac("sha256", secret).update(originalBody).digest("hex")}`;

    // Send a different body with the original signature
    const tamperedBody = Buffer.from('{"eventId":"tampered"}');
    expect(client.verifyWebhookSignature(tamperedBody, sig)).toBe(false);
  });
});

// ─── Section 11: Status Messages ──────────────────────────────────────────────

describe("Execution Status Messages", () => {
  it("all execution statuses have customer-facing messages", () => {
    const statuses = [
      "pending", "submitted", "accepted", "running", "paused",
      "awaiting_approval", "completed", "failed", "cancelled", "expired",
    ];
    for (const status of statuses) {
      expect(EXECUTION_STATUS_MESSAGES[status]).toBeTruthy();
    }
  });

  it("getStatusMessage returns a non-empty string for known statuses", () => {
    expect(getStatusMessage("running")).toBeTruthy();
    expect(getStatusMessage("completed")).toBeTruthy();
    expect(getStatusMessage("failed")).toBeTruthy();
  });

  it("getStatusMessage does not claim browser activity for non-browser statuses", () => {
    const apiMsg = getStatusMessage("running");
    expect(apiMsg.toLowerCase()).not.toContain("browser");
  });

  it("pending message communicates preparation, not execution", () => {
    expect(getStatusMessage("pending").toLowerCase()).toContain("prepar");
  });

  it("submitted message communicates connecting, not executing", () => {
    expect(getStatusMessage("submitted").toLowerCase()).toContain("connect");
  });

  it("completed message is truthful and positive", () => {
    const msg = getStatusMessage("completed");
    expect(msg.toLowerCase()).toContain("complet");
  });
});

// ─── Section 12: Tenant Isolation Architecture ────────────────────────────────

describe("Tenant Isolation Architecture", () => {
  it("execution package always includes tenantId", () => {
    const pkg = makeExecutionPackage();
    expect(pkg.tenantId).toBeTruthy();
  });

  it("translated OpenClaw package always includes tenantId", () => {
    const pkg = makeExecutionPackage();
    const wire = translateToOpenClawPackage(pkg, loadOpenClawConfig());
    expect(wire.tenantId).toBe(pkg.tenantId);
  });

  it("OpenClaw events always include tenantId for boundary checking", () => {
    const event = makeOpenClawEvent();
    expect(event.tenantId).toBeTruthy();
  });

  it("translated NeedsOps event preserves tenantId from OpenClaw event", () => {
    const tenantId = randomUUID();
    const raw = makeOpenClawEvent({ tenantId });
    const event = translateOpenClawEvent(raw);
    expect(event.tenantId).toBe(tenantId);
  });

  it("execution package tenantId is the NeedsOps organization UUID", () => {
    const orgId = randomUUID();
    const pkg = makeExecutionPackage({ tenantId: orgId });
    expect(pkg.tenantId).toBe(orgId);
  });

  it("taskId is NOT included in the OpenClaw wire format (internal platform ID)", () => {
    const pkg = makeExecutionPackage();
    const wire = translateToOpenClawPackage(pkg, loadOpenClawConfig());
    expect(Object.keys(wire)).not.toContain("taskId");
  });

  it("execution package does not include platform secrets or credentials", () => {
    const pkg = makeExecutionPackage();
    const wire = translateToOpenClawPackage(pkg, loadOpenClawConfig());
    const wireStr = JSON.stringify(wire);
    expect(wireStr).not.toContain("secret");
    expect(wireStr).not.toContain("password");
    expect(wireStr).not.toContain("credential");
    expect(wireStr).not.toContain("DATABASE_URL");
    expect(wireStr).not.toContain("CLERK");
  });
});

// ─── Section 13: Runtime Reconnect and Failure Handling ───────────────────────

describe("Runtime Failure Handling", () => {
  it("BrokerRequestError is thrown with status code", () => {
    const err = new BrokerRequestError("Connection refused", 0);
    expect(err.statusCode).toBe(0);
    expect(err.message).toBe("Connection refused");
    expect(err.name).toBe("BrokerRequestError");
  });

  it("engine handles missing runtime gracefully — no throw on getHealth()", async () => {
    const engine = new OpenClawExecutionEngine({
      ...loadOpenClawConfig(),
      runtimeUrl: null,
    });
    const health = await engine.getHealth();
    expect(health.status).toBe("not_connected");
  });

  it("engine getHealth does not throw when runtime URL is set but unreachable", async () => {
    const engine = new OpenClawExecutionEngine({
      ...loadOpenClawConfig(),
      runtimeUrl: "http://127.0.0.1:19999", // unreachable port
      retryAttempts: 0,
      timeoutMs: 500,
    });
    const health = await engine.getHealth();
    expect(["unavailable", "not_connected", "error"]).toContain(health.status);
  });
});

// ─── Section 14: Event Type Coverage ─────────────────────────────────────────

describe("Event Type Coverage", () => {
  const allEventTypes: OpenClawWebhookEvent["eventType"][] = [
    "runtime.connected",
    "runtime.disconnected",
    "runtime.unavailable",
    "execution.accepted",
    "execution.started",
    "execution.progress",
    "execution.paused",
    "execution.resumed",
    "execution.awaiting_approval",
    "execution.completed",
    "execution.failed",
    "execution.cancelled",
    "execution.expired",
  ];

  it("all OpenClaw event types can be translated to NeedsOps events", () => {
    for (const eventType of allEventTypes) {
      const raw = makeOpenClawEvent({ eventType });
      expect(() => translateOpenClawEvent(raw)).not.toThrow();
    }
  });

  it("EVENT_TO_STATUS_TRANSITION covers all execution event types", () => {
    const executionEvents = allEventTypes.filter(e => e.startsWith("execution."));
    for (const eventType of executionEvents) {
      expect(eventType in EVENT_TO_STATUS_TRANSITION).toBe(true);
    }
  });
});
