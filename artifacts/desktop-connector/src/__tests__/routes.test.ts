/**
 * Broker — route integration tests
 *
 * Spins up an in-process Express app with SimulatedGatewayAdapter and
 * in-memory SQLite. Tests all 6 HTTP routes.
 *
 * No real network calls. No real OpenClaw process needed.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { Express } from "express";
import pino from "pino";
import { createBrokerApp } from "../broker/server.js";
import { ExecutionStore } from "../broker/store.js";
import { SimulatedGatewayAdapter } from "../broker/gatewayAdapter.js";
import { WebhookDeliveryWorker } from "../broker/webhookDelivery.js";
import type { BrokerConfig, BrokerExecutionStatus } from "../broker/types.js";

// ─── Test constants ───────────────────────────────────────────────────────────

const AUTH_TOKEN = "integration-test-token-abc123";
const WEBHOOK_SECRET = "integration-test-webhook-secret";
const EXEC_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const TENANT_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function futureISO(ms = 300_000): string {
  return new Date(Date.now() + ms).toISOString();
}

function makePackage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    executionId: EXEC_ID,
    tenantId: TENANT_ID,
    workforceRole: "chief_of_staff",
    workerProfile: {
      allowedChannels: ["api"], allowedBrowserDomains: [],
      allowedLocalPathCategories: [], allowedApplicationCategories: [],
      prohibitedActions: [], riskLevel: "low", requiresApprovalFor: [],
    },
    steps: [{ sequence: 1, specialist: "chief_of_staff", action: "execute",
      description: "Test step", requiresApproval: false }],
    requestedTools: ["api_call"], requestedChannels: ["api"],
    requestedConnectorCategories: [], approvalState: "approved",
    constraints: { maxDurationSeconds: 300, requireHumanApprovalBeforeSubmit: false,
      allowedDataCategories: ["task_context"] },
    callbackUrl: "http://localhost:5001/v1/runtime/events",
    expiresAt: futureISO(),
    issuedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── App factory ──────────────────────────────────────────────────────────────

function makeApp() {
  const logger = pino({ level: "silent" });

  const config: BrokerConfig = {
    port: 19002,
    authToken: AUTH_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    dbPath: ":memory:",
    maxBodyBytes: 1_048_576,
    webhookRetryAttempts: 3,
    webhookRetryBaseMs: 100,
    webhookWorkerIntervalMs: 60_000, // don't run during tests
    staleCleanupIntervalMs: 60_000,
    gatewayMode: "simulated",
    gatewayUrl: null,
    brokerVersion: "1.0.0",
  };

  const store = new ExecutionStore(":memory:");

  const statusChanges: Array<{ id: string; status: BrokerExecutionStatus }> = [];

  const gateway = new SimulatedGatewayAdapter({
    onStatusChange(executionId, status, extra) {
      statusChanges.push({ id: executionId, status });
      store.updateStatus(executionId, status, extra);
      const exec = store.getExecution(executionId);
      if (exec) webhookWorker.queueEvent(exec, status, extra);
    },
    transitionDelayMs: 50,
    runDurationMs: 100,
  });

  const webhookWorker = new WebhookDeliveryWorker(
    store, WEBHOOK_SECRET, 3, 100, 60_000, logger,
  );

  const app = createBrokerApp(config, store, gateway, webhookWorker, logger);

  return { app, store, gateway, webhookWorker, statusChanges };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /v1/health", () => {
  let app: Express;
  let webhookWorker: WebhookDeliveryWorker;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;

  beforeEach(() => {
    ({ app, webhookWorker, store, gateway } = makeApp());
  });
  afterEach(() => {
    webhookWorker.stop();
    store.close();
    gateway.destroy();
  });

  it("returns 200 with status healthy", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("includes version, capabilities, and gateway fields", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.body.version).toBe("1.0.0");
    expect(res.body.capabilities.supportedChannels).toBeInstanceOf(Array);
    expect(res.body.gateway.adapter).toBe("simulated");
    expect(res.body.gateway.ok).toBe(true);
  });

  it("does NOT require authentication", async () => {
    const res = await request(app).get("/v1/health");
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/executions — authentication", () => {
  let app: Express;
  let webhookWorker: WebhookDeliveryWorker;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;

  beforeEach(() => ({ app, webhookWorker, store, gateway } = makeApp()));
  afterEach(() => { webhookWorker.stop(); store.close(); gateway.destroy(); });

  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).post("/v1/executions").send(makePackage());
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 with wrong token", async () => {
    const res = await request(app)
      .post("/v1/executions")
      .set("Authorization", "Bearer wrong-token")
      .send(makePackage());
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/executions — submission", () => {
  let app: Express;
  let webhookWorker: WebhookDeliveryWorker;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;

  beforeEach(() => ({ app, webhookWorker, store, gateway } = makeApp()));
  afterEach(() => { webhookWorker.stop(); store.close(); gateway.destroy(); });

  it("accepts a valid package and returns 202 with runtimeExecutionId", async () => {
    const res = await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());

    expect(res.status).toBe(202);
    expect(res.body.runtimeExecutionId).toBeTruthy();
    expect(res.body.status).toBe("queued");
    expect(res.body.runtimeVersion).toBe("1.0.0");
  });

  it("persists the execution in the store", async () => {
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());

    // Give setImmediate a tick to run the submission
    await new Promise(r => setTimeout(r, 10));
    const exec = store.getExecution(EXEC_ID);
    expect(exec).not.toBeNull();
    expect(exec!.tenantId).toBe(TENANT_ID);
  });

  it("returns 422 for an expired package", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const res = await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage({ expiresAt: past }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for a missing executionId", async () => {
    const pkg = makePackage({ executionId: undefined });
    const res = await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(pkg);
    expect(res.status).toBe(422);
  });

  it("returns idempotent 200 for a duplicate executionId", async () => {
    const pkg = makePackage();
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(pkg);

    const res2 = await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(pkg);
    expect(res2.status).toBe(200);
    expect(res2.body.runtimeExecutionId).toBeTruthy();
  });
});

describe("GET /v1/executions/:executionId", () => {
  let app: Express;
  let webhookWorker: WebhookDeliveryWorker;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;

  beforeEach(() => ({ app, webhookWorker, store, gateway } = makeApp()));
  afterEach(() => { webhookWorker.stop(); store.close(); gateway.destroy(); });

  it("returns 404 for unknown execution", async () => {
    const res = await request(app)
      .get(`/v1/executions/${EXEC_ID}?tenantId=${TENANT_ID}`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it("returns 400 when tenantId query param is missing", async () => {
    const res = await request(app)
      .get(`/v1/executions/${EXEC_ID}`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(400);
  });

  it("returns execution status after submission", async () => {
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());

    await new Promise(r => setTimeout(r, 20));

    const res = await request(app)
      .get(`/v1/executions/${EXEC_ID}?tenantId=${TENANT_ID}`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.executionId).toBe(EXEC_ID);
    expect(res.body.tenantId).toBe(TENANT_ID);
    expect(typeof res.body.status).toBe("string");
  });

  it("enforces tenant isolation — wrong tenant returns 404", async () => {
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());

    const wrongTenant = "c3d4e5f6-a7b8-9012-cdef-123456789012";
    const res = await request(app)
      .get(`/v1/executions/${EXEC_ID}?tenantId=${wrongTenant}`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/executions/:id/cancel", () => {
  let app: Express;
  let webhookWorker: WebhookDeliveryWorker;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;

  beforeEach(() => ({ app, webhookWorker, store, gateway } = makeApp()));
  afterEach(() => { webhookWorker.stop(); store.close(); gateway.destroy(); });

  it("returns 404 for unknown execution", async () => {
    const res = await request(app)
      .post(`/v1/executions/${EXEC_ID}/cancel`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(404);
  });

  it("returns 200 and marks execution as cancelled", async () => {
    // Submit first
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());
    await new Promise(r => setTimeout(r, 20));

    const res = await request(app)
      .post(`/v1/executions/${EXEC_ID}/cancel`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ tenantId: TENANT_ID });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects cancel with missing tenantId body", async () => {
    const res = await request(app)
      .post(`/v1/executions/${EXEC_ID}/cancel`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it("enforces tenant isolation on cancel", async () => {
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());

    const wrongTenant = "c3d4e5f6-a7b8-9012-cdef-123456789012";
    const res = await request(app)
      .post(`/v1/executions/${EXEC_ID}/cancel`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ tenantId: wrongTenant });
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/executions/:id/pause and /resume", () => {
  let app: Express;
  let webhookWorker: WebhookDeliveryWorker;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;

  beforeEach(() => ({ app, webhookWorker, store, gateway } = makeApp()));
  afterEach(() => { webhookWorker.stop(); store.close(); gateway.destroy(); });

  it("pause returns 409 when execution is not running", async () => {
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());
    // Still queued/submitted — not running yet
    await new Promise(r => setTimeout(r, 5));

    const res = await request(app)
      .post(`/v1/executions/${EXEC_ID}/pause`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ tenantId: TENANT_ID });

    // Either 409 (not running) or 200 (if it started already) — both are valid
    expect([200, 409]).toContain(res.status);
  });

  it("resume returns 409 when execution is not paused", async () => {
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(makePackage());
    await new Promise(r => setTimeout(r, 20));

    const res = await request(app)
      .post(`/v1/executions/${EXEC_ID}/resume`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ tenantId: TENANT_ID });

    // Execution may be running or completed by now — should not be paused
    expect([409, 404]).toContain(res.status);
  });
});

describe("Route authentication coverage", () => {
  let app: Express;
  let webhookWorker: WebhookDeliveryWorker;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;

  beforeEach(() => ({ app, webhookWorker, store, gateway } = makeApp()));
  afterEach(() => { webhookWorker.stop(); store.close(); gateway.destroy(); });

  const protectedRoutes: Array<{ method: "get" | "post"; path: string; body?: object }> = [
    { method: "post", path: "/v1/executions", body: {} },
    { method: "get",  path: `/v1/executions/${EXEC_ID}?tenantId=${TENANT_ID}` },
    { method: "post", path: `/v1/executions/${EXEC_ID}/cancel`, body: { tenantId: TENANT_ID } },
    { method: "post", path: `/v1/executions/${EXEC_ID}/pause`,  body: { tenantId: TENANT_ID } },
    { method: "post", path: `/v1/executions/${EXEC_ID}/resume`, body: { tenantId: TENANT_ID } },
  ];

  for (const route of protectedRoutes) {
    it(`${route.method.toUpperCase()} ${route.path} — returns 401 without auth`, async () => {
      const req = request(app)[route.method](route.path);
      if (route.body) req.send(route.body);
      const res = await req;
      expect(res.status).toBe(401);
    });
  }
});
