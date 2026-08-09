/**
 * @workspace/openclaw — Runtime Broker Client
 *
 * The ONLY component in NeedsOps that communicates directly with the OpenClaw
 * Runtime Broker. All other services must go through OpenClawExecutionEngine,
 * which delegates to this client.
 *
 * When OPENCLAW_RUNTIME_URL is not set, all methods return graceful "not
 * connected" responses — no errors are thrown, no retries occur.
 */

import { createHmac } from "crypto";
import type {
  OpenClawExecutionPackage,
  OpenClawSubmissionResponse,
  OpenClawStatusResponse,
  OpenClawHealthResponse,
  OpenClawWebhookEvent,
  BrokerConnectionStatus,
  BrokerConnectionState,
  BrokerEvidenceDiscoveryRequest,
  BrokerEvidenceDiscoveryResponse,
} from "./types.js";
import type { OpenClawConfig } from "./config.js";
import { isOpenClawConfigured } from "./config.js";

// ─── Internal helpers ─────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface BrokerRequestOptions {
  method: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  body?: unknown;
  authToken: string | null;
  timeoutMs: number;
}

async function brokerRequest<T>(
  runtimeUrl: string,
  opts: BrokerRequestOptions,
): Promise<T> {
  const url = `${runtimeUrl.replace(/\/$/, "")}${opts.path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-NeedsOps-Client": "needsops-ai-platform/1.0",
  };

  if (opts.authToken) {
    headers["Authorization"] = `Bearer ${opts.authToken}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const response = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new BrokerRequestError(
        `OpenClaw broker returned ${response.status}: ${text}`,
        response.status,
      );
    }

    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof BrokerRequestError) throw err;
    if ((err as Error).name === "AbortError") {
      throw new BrokerRequestError("OpenClaw broker request timed out", 0);
    }
    throw new BrokerRequestError(
      `OpenClaw broker unreachable: ${(err as Error).message}`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }
}

export class BrokerRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "BrokerRequestError";
  }
}

// ─── Runtime Broker Client ────────────────────────────────────────────────────

export class RuntimeBrokerClient {
  private readonly config: OpenClawConfig;
  private _connectionStatus: BrokerConnectionStatus;
  private _cachedAuthToken: string | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: OpenClawConfig) {
    this.config = config;
    this._connectionStatus = {
      state: isOpenClawConfigured(config) ? "connecting" : "not_configured",
      runtimeUrl: config.runtimeUrl,
      lastHealthCheckAt: null,
      lastHealthStatus: null,
      consecutiveFailures: 0,
    };
  }

  // ─── Connection state ───────────────────────────────────────────────────────

  get connectionStatus(): BrokerConnectionStatus {
    return { ...this._connectionStatus };
  }

  get isConfigured(): boolean {
    return isOpenClawConfigured(this.config);
  }

  // ─── Auth token resolution ──────────────────────────────────────────────────

  /**
   * Resolve the auth token from environment.
   * The config holds a reference name, not the token value.
   * In production this would resolve from the secrets service;
   * here we read from the env var named by authTokenRef.
   */
  private async resolveAuthToken(): Promise<string | null> {
    if (!this.config.authTokenRef) return null;
    // The token reference is an env var name — read the actual value
    const token = process.env[this.config.authTokenRef] ?? null;
    this._cachedAuthToken = token;
    return token;
  }

  // ─── Health check ───────────────────────────────────────────────────────────

  async getHealth(): Promise<OpenClawHealthResponse | null> {
    if (!this.isConfigured) return null;

    const authToken = await this.resolveAuthToken();

    try {
      const health = await this.withRetry(() =>
        brokerRequest<OpenClawHealthResponse>(this.config.runtimeUrl!, {
          method: "GET",
          path: "/v1/health",
          authToken,
          timeoutMs: this.config.timeoutMs,
        }),
      );

      this._connectionStatus = {
        ...this._connectionStatus,
        state: "connected",
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthStatus: health.status,
        consecutiveFailures: 0,
      };

      return health;
    } catch (err) {
      const failures = this._connectionStatus.consecutiveFailures + 1;
      const state: BrokerConnectionState = failures >= 3 ? "error" : "reconnecting";

      this._connectionStatus = {
        ...this._connectionStatus,
        state,
        lastHealthCheckAt: new Date().toISOString(),
        lastHealthStatus: "unavailable",
        consecutiveFailures: failures,
      };

      return null;
    }
  }

  // ─── Execution submission ───────────────────────────────────────────────────

  async submitExecution(pkg: OpenClawExecutionPackage): Promise<OpenClawSubmissionResponse> {
    if (!this.isConfigured) {
      throw new BrokerRequestError("OpenClaw runtime is not configured", 0);
    }

    const authToken = await this.resolveAuthToken();

    return this.withRetry(() =>
      brokerRequest<OpenClawSubmissionResponse>(this.config.runtimeUrl!, {
        method: "POST",
        path: "/v1/executions",
        body: pkg,
        authToken,
        timeoutMs: this.config.timeoutMs,
      }),
    );
  }

  // ─── Execution status poll ──────────────────────────────────────────────────

  async getExecutionStatus(
    executionId: string,
    tenantId: string,
  ): Promise<OpenClawStatusResponse | null> {
    if (!this.isConfigured) return null;

    const authToken = await this.resolveAuthToken();

    try {
      return await brokerRequest<OpenClawStatusResponse>(this.config.runtimeUrl!, {
        method: "GET",
        path: `/v1/executions/${encodeURIComponent(executionId)}?tenantId=${encodeURIComponent(tenantId)}`,
        authToken,
        timeoutMs: this.config.timeoutMs,
      });
    } catch {
      return null;
    }
  }

  // ─── Execution control ──────────────────────────────────────────────────────

  async cancelExecution(executionId: string, tenantId: string): Promise<void> {
    if (!this.isConfigured) {
      throw new BrokerRequestError("OpenClaw runtime is not configured", 0);
    }
    const authToken = await this.resolveAuthToken();
    await this.withRetry(() =>
      brokerRequest<void>(this.config.runtimeUrl!, {
        method: "POST",
        path: `/v1/executions/${encodeURIComponent(executionId)}/cancel`,
        body: { tenantId, requestedAt: new Date().toISOString() },
        authToken,
        timeoutMs: this.config.timeoutMs,
      }),
    );
  }

  async pauseExecution(executionId: string, tenantId: string): Promise<void> {
    if (!this.isConfigured) {
      throw new BrokerRequestError("OpenClaw runtime is not configured", 0);
    }
    const authToken = await this.resolveAuthToken();
    await this.withRetry(() =>
      brokerRequest<void>(this.config.runtimeUrl!, {
        method: "POST",
        path: `/v1/executions/${encodeURIComponent(executionId)}/pause`,
        body: { tenantId, requestedAt: new Date().toISOString() },
        authToken,
        timeoutMs: this.config.timeoutMs,
      }),
    );
  }

  async resumeExecution(executionId: string, tenantId: string): Promise<void> {
    if (!this.isConfigured) {
      throw new BrokerRequestError("OpenClaw runtime is not configured", 0);
    }
    const authToken = await this.resolveAuthToken();
    await this.withRetry(() =>
      brokerRequest<void>(this.config.runtimeUrl!, {
        method: "POST",
        path: `/v1/executions/${encodeURIComponent(executionId)}/resume`,
        body: { tenantId, requestedAt: new Date().toISOString() },
        authToken,
        timeoutMs: this.config.timeoutMs,
      }),
    );
  }

  // ─── Evidence discovery (Sprint 29O.1) ─────────────────────────────────────

  /**
   * Call POST /v1/evidence/discover on the Mac broker.
   *
   * Returns raw BrokerCandidateEvidence[] — NOT yet validated by the Authority
   * Gate. The caller (CloudOpenClawDiscoveryAdapter) maps these to
   * CandidateEvidence[] and the orchestrator runs them through the gate.
   *
   * Returns an empty response when the broker is unreachable rather than
   * throwing, so the orchestrator can degrade gracefully.
   */
  async discoverEvidence(
    request: BrokerEvidenceDiscoveryRequest,
  ): Promise<BrokerEvidenceDiscoveryResponse> {
    if (!this.isConfigured) {
      return { candidates: [], discoveryDurationMs: 0, openClawStatus: "unavailable", hopsFollowed: 0 };
    }

    const authToken = await this.resolveAuthToken();

    try {
      return await brokerRequest<BrokerEvidenceDiscoveryResponse>(this.config.runtimeUrl!, {
        method:    "POST",
        path:      "/v1/evidence/discover",
        body:      request,
        authToken,
        timeoutMs: Math.min(request.timeoutMs + 5_000, this.config.timeoutMs), // allow broker-side timeout
      });
    } catch (err) {
      // Non-fatal — return empty so the orchestrator can degrade to KRS-only
      const failures = this._connectionStatus.consecutiveFailures + 1;
      this._connectionStatus = {
        ...this._connectionStatus,
        state: failures >= 3 ? "error" : "reconnecting",
        consecutiveFailures: failures,
      };
      return {
        candidates:          [],
        discoveryDurationMs: 0,
        openClawStatus:      "unavailable",
        hopsFollowed:        0,
      };
    }
  }

  // ─── Webhook verification ───────────────────────────────────────────────────

  /**
   * Verify the HMAC-SHA256 signature on an inbound webhook event.
   * Returns true if the signature is valid or if webhook secret is not configured
   * (development mode only).
   *
   * In production, OPENCLAW_WEBHOOK_SECRET must be set.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string | undefined,
  ): boolean {
    if (!this.config.webhookSecret) {
      // No secret configured — accept in development, warn that production requires it
      if (process.env.NODE_ENV === "production") {
        return false; // Reject unsigned events in production
      }
      return true;
    }

    if (!signatureHeader) return false;

    const expected = createHmac("sha256", this.config.webhookSecret)
      .update(rawBody)
      .digest("hex");

    const actual = signatureHeader.replace(/^sha256=/, "");

    // Constant-time comparison to prevent timing attacks
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
    }
    return diff === 0;
  }

  // ─── Heartbeat management ─────────────────────────────────────────────────

  /**
   * Start the background heartbeat loop.
   * Safe to call multiple times — only one loop runs at a time.
   */
  startHeartbeat(): void {
    if (this._heartbeatTimer || !this.isConfigured) return;
    this._heartbeatTimer = setInterval(
      () => void this.getHealth(),
      this.config.heartbeatIntervalMs,
    );
  }

  stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  // ─── Retry logic ──────────────────────────────────────────────────────────

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        // Don't retry on 4xx client errors — only on network/5xx failures
        if (err instanceof BrokerRequestError && err.statusCode >= 400 && err.statusCode < 500) {
          throw err;
        }
        if (attempt < this.config.retryAttempts) {
          const delay = this.config.retryDelayMs * Math.pow(2, attempt);
          await sleep(Math.min(delay, 10000));
        }
      }
    }
    throw lastError!;
  }
}
