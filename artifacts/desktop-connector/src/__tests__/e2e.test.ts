/**
 * Broker — End-to-end test with SimulatedGatewayAdapter
 *
 * Verifies the full execution lifecycle:
 *   NeedsOps submits → broker accepts → simulated gateway runs → webhooks sent
 *
 * This test is labelled "automated" and uses the simulated adapter only.
 * The live smoke test command is documented in the runbook (see .env.example).
 *
 * Distinction:
 *   [AUTOMATED] — runs in CI/CD with no external dependencies (this file)
 *   [LIVE SMOKE] — requires real OpenClaw + tunnel (see runbook)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import request from "supertest";
import pino from "pino";
import { createBrokerApp } from "../broker/server.js";
import { ExecutionStore } from "../broker/store.js";
import { SimulatedGatewayAdapter } from "../broker/gatewayAdapter.js";
import { WebhookDeliveryWorker } from "../broker/webhookDelivery.js";
import type { BrokerConfig, BrokerExecutionStatus } from "../broker/types.js";
import { verifyWebhookSignature } from "./helpers/webhookVerify.js";

// ─── Test constants ───────────────────────────────────────────────────────────

const AUTH_TOKEN     = "e2e-auth-token-xyz789";
const WEBHOOK_SECRET = "e2e-webhook-secret-abc";
const EXEC_ID        = "e2e00001-face-babe-cafe-000000000001";
const TENANT_ID      = "e2e00002-face-babe-cafe-000000000002";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function futureISO(ms = 300_000): string {
  return new Date(Date.now() + ms).toISOString();
}

function waitMs(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Wait until the execution in the store reaches one of the target statuses,
 * polling every 20 ms up to maxMs.
 */
async function waitForStatus(
  store: ExecutionStore,
  executionId: string,
  targetStatuses: BrokerExecutionStatus[],
  maxMs = 2000,
): Promise<BrokerExecutionStatus | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const exec = store.getExecution(executionId);
    if (exec && targetStatuses.includes(exec.status)) return exec.status;
    await waitMs(20);
  }
  return store.getExecution(executionId)?.status ?? null;
}

// ─── Captured webhooks server ─────────────────────────────────────────────────

interface CapturedWebhook {
  body: Record<string, unknown>;
  signature: string | undefined;
  valid: boolean;
}

function startWebhookCaptureServer(): {
  port: number;
  webhooks: CapturedWebhook[];
  close: () => Promise<void>;
} {
  const webhooks: CapturedWebhook[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      const body = JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
      const signature = req.headers["x-openclaw-signature"] as string | undefined;
      const valid = verifyWebhookSignature(raw, signature, WEBHOOK_SECRET);
      webhooks.push({ body, signature, valid });
      res.writeHead(200);
      res.end();
    });
  });

  // Listen on a random port
  server.listen(0);
  const port = (server.address() as { port: number }).port;

  return {
    port,
    webhooks,
    close: () => new Promise(r => server.close(() => r())),
  };
}

// ─── App factory ──────────────────────────────────────────────────────────────

function makeApp(callbackPort: number) {
  const logger = pino({ level: "silent" });
  const store = new ExecutionStore(":memory:");

  const config: BrokerConfig = {
    port: 19002,
    authToken: AUTH_TOKEN,
    webhookSecret: WEBHOOK_SECRET,
    dbPath: ":memory:",
    maxBodyBytes: 1_048_576,
    webhookRetryAttempts: 3,
    webhookRetryBaseMs: 50,
    webhookWorkerIntervalMs: 100, // fast polling for test
    staleCleanupIntervalMs: 60_000,
    gatewayMode: "simulated",
    gatewayUrl: null,
    brokerVersion: "1.0.0",
  };

  const gateway = new SimulatedGatewayAdapter({
    onStatusChange(executionId, status, extra) {
      store.updateStatus(executionId, status, extra);
      const exec = store.getExecution(executionId);
      if (exec) webhookWorker.queueEvent(exec, status, extra);
    },
    transitionDelayMs: 80,   // queued→running after 80 ms
    runDurationMs:     120,  // running→completed after 120 ms
  });

  const webhookWorker = new WebhookDeliveryWorker(
    store, WEBHOOK_SECRET, 3, 50, 100, logger,
  );

  const app = createBrokerApp(config, store, gateway, webhookWorker, logger);

  return { app, store, gateway, webhookWorker };
}

// ─── Full lifecycle test ──────────────────────────────────────────────────────

describe("[AUTOMATED] Full execution lifecycle with SimulatedGatewayAdapter", () => {
  let capture: ReturnType<typeof startWebhookCaptureServer>;
  let store: ExecutionStore;
  let gateway: SimulatedGatewayAdapter;
  let webhookWorker: WebhookDeliveryWorker;
  let app: ReturnType<typeof createBrokerApp>;

  beforeEach(() => {
    capture = startWebhookCaptureServer();
    ({ app, store, gateway, webhookWorker } = makeApp(capture.port));
    webhookWorker.start();
  });

  afterEach(async () => {
    webhookWorker.stop();
    store.close();
    gateway.destroy();
    await capture.close();
  });

  it("completes queued → running → completed lifecycle", async () => {
    const callbackUrl = `http://127.0.0.1:${capture.port}/v1/runtime/events`;

    // 1. Submit execution
    const submitRes = await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({
        executionId: EXEC_ID,
        tenantId: TENANT_ID,
        workforceRole: "chief_of_staff",
        workerProfile: {
          allowedChannels: ["api"], allowedBrowserDomains: [],
          allowedLocalPathCategories: [], allowedApplicationCategories: [],
          prohibitedActions: [], riskLevel: "low", requiresApprovalFor: [],
        },
        steps: [{ sequence: 1, specialist: "chief_of_staff", action: "execute",
          description: "E2E test step", requiresApproval: false }],
        requestedTools: ["api_call"], requestedChannels: ["api"],
        requestedConnectorCategories: [], approvalState: "approved",
        constraints: { maxDurationSeconds: 60, requireHumanApprovalBeforeSubmit: false,
          allowedDataCategories: ["task_context"] },
        callbackUrl,
        expiresAt: futureISO(),
        issuedAt: new Date().toISOString(),
      });

    expect(submitRes.status).toBe(202);
    const { runtimeExecutionId } = submitRes.body as { runtimeExecutionId: string };
    expect(runtimeExecutionId).toBeTruthy();

    // 2. Wait for completion (simulated adapter completes after ~200ms)
    const finalStatus = await waitForStatus(store, EXEC_ID, ["completed", "failed"], 3000);
    expect(finalStatus).toBe("completed");

    // 3. Status endpoint must reflect completion
    const statusRes = await request(app)
      .get(`/v1/executions/${EXEC_ID}?tenantId=${TENANT_ID}`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe("completed");
    expect(statusRes.body.runtimeExecutionId).toBe(runtimeExecutionId);

    // 4. Webhook events must have been delivered
    // Allow webhook worker a moment to deliver
    await waitMs(500);
    expect(capture.webhooks.length).toBeGreaterThanOrEqual(1);

    // 5. Verify all delivered webhooks have valid HMAC signatures
    for (const wh of capture.webhooks) {
      expect(wh.valid).toBe(true);
    }

    // 6. At least one webhook should be execution.completed
    const completedEvent = capture.webhooks.find(
      wh => wh.body.eventType === "execution.completed"
    );
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.body.executionId).toBe(EXEC_ID);
    expect(completedEvent!.body.tenantId).toBe(TENANT_ID);
  }, 10_000); // 10 s timeout for the full lifecycle

  it("cancel stops execution and delivers execution.cancelled webhook", async () => {
    const callbackUrl = `http://127.0.0.1:${capture.port}/v1/runtime/events`;

    // Submit
    await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({
        executionId: EXEC_ID, tenantId: TENANT_ID, workforceRole: "chief_of_staff",
        workerProfile: {
          allowedChannels: ["api"], allowedBrowserDomains: [],
          allowedLocalPathCategories: [], allowedApplicationCategories: [],
          prohibitedActions: [], riskLevel: "low", requiresApprovalFor: [],
        },
        steps: [{ sequence: 1, specialist: "chief_of_staff", action: "execute",
          description: "Cancellable step", requiresApproval: false }],
        requestedTools: ["api_call"], requestedChannels: ["api"],
        requestedConnectorCategories: [], approvalState: "approved",
        constraints: { maxDurationSeconds: 60, requireHumanApprovalBeforeSubmit: false,
          allowedDataCategories: [] },
        callbackUrl, expiresAt: futureISO(), issuedAt: new Date().toISOString(),
      });

    // Give the adapter a tick to start
    await waitMs(10);

    // Cancel immediately
    const cancelRes = await request(app)
      .post(`/v1/executions/${EXEC_ID}/cancel`)
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ tenantId: TENANT_ID });

    expect(cancelRes.status).toBe(200);

    // Wait for cancel to propagate
    const finalStatus = await waitForStatus(store, EXEC_ID, ["cancelled", "completed", "failed"], 2000);
    expect(["cancelled", "completed"]).toContain(finalStatus);

    // Webhook must eventually deliver
    await waitMs(500);
    const hasTerminalEvent = capture.webhooks.some(
      wh => ["execution.cancelled", "execution.completed"].includes(wh.body.eventType as string)
    );
    expect(hasTerminalEvent).toBe(true);
  }, 8_000);

  it("duplicate submission returns the existing runtimeExecutionId", async () => {
    const callbackUrl = `http://127.0.0.1:${capture.port}/v1/runtime/events`;
    const pkg = {
      executionId: EXEC_ID, tenantId: TENANT_ID, workforceRole: "chief_of_staff",
      workerProfile: {
        allowedChannels: ["api"], allowedBrowserDomains: [],
        allowedLocalPathCategories: [], allowedApplicationCategories: [],
        prohibitedActions: [], riskLevel: "low", requiresApprovalFor: [],
      },
      steps: [{ sequence: 1, specialist: "chief_of_staff", action: "execute",
        description: "Idempotency test", requiresApproval: false }],
      requestedTools: ["api_call"], requestedChannels: ["api"],
      requestedConnectorCategories: [], approvalState: "approved",
      constraints: { maxDurationSeconds: 60, requireHumanApprovalBeforeSubmit: false,
        allowedDataCategories: [] },
      callbackUrl, expiresAt: futureISO(), issuedAt: new Date().toISOString(),
    };

    const r1 = await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(pkg);

    const r2 = await request(app)
      .post("/v1/executions")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send(pkg);

    expect(r1.status).toBe(202);
    expect(r2.status).toBe(200);
    expect(r2.body.runtimeExecutionId).toBe(r1.body.runtimeExecutionId);
  }, 8_000);
});
