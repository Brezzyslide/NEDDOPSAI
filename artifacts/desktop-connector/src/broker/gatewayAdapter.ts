/**
 * NeedsOps Runtime Broker — Gateway Adapter
 *
 * IGatewayAdapter is the boundary between the Runtime Broker and whatever
 * execution engine OpenClaw actually exposes locally.
 *
 * Phase 3 ships SimulatedGatewayAdapter only. This adapter runs a local
 * state machine that advances queued → running → completed after short
 * delays, enabling all automated tests to pass without OpenClaw installed.
 *
 * Phase 4 (after OpenClaw source inspection) adds LiveGatewayAdapter.
 * Swapping the adapter requires only changing OPENCLAW_GATEWAY_MODE.
 *
 * ─── Why no LiveGatewayAdapter yet ──────────────────────────────────────────
 *
 * The OpenClaw gateway at 127.0.0.1:19001 returns 404 on /v1/health,
 * meaning its internal API is undocumented from this repository's perspective.
 *
 * Before implementing a live adapter, run the inspection script:
 *
 *   node scripts/inspect-openclaw.mjs
 *
 * from /Users/tayephilipajao/Development/needsops-browser/OpenClaw-NeedsOps
 * and paste the output back. Phase 4 will implement a real adapter based on
 * the supported interfaces found in the OpenClaw source.
 */

import { randomUUID } from "crypto";
import type {
  IGatewayAdapter,
  GatewayJobRequest,
  GatewayJobAccepted,
  GatewayJobStatusResponse,
  GatewayHealthResult,
  BrokerExecutionStatus,
} from "./types.js";

// ─── Simulated Gateway Adapter ────────────────────────────────────────────────

interface SimJob {
  gatewaySessionId: string;
  executionId: string;
  status: BrokerExecutionStatus;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * SimulatedGatewayAdapter — for automated tests only.
 *
 * Simulates the lifecycle of a real gateway:
 *   queued → running (after transitionDelayMs)
 *         → completed (after runDurationMs)
 *
 * The onStatusChange callback notifies the broker of each transition so it
 * can persist state and queue webhook delivery.
 */
export class SimulatedGatewayAdapter implements IGatewayAdapter {
  readonly name = "simulated";

  private readonly jobs = new Map<string, SimJob>();
  private readonly onStatusChange: (
    executionId: string,
    status: BrokerExecutionStatus,
    extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
  ) => void;

  /** Delay before a submitted job transitions to "running" (ms) */
  private readonly transitionDelayMs: number;
  /** How long a job runs before completing (ms) */
  private readonly runDurationMs: number;

  constructor(opts: {
    onStatusChange: (
      executionId: string,
      status: BrokerExecutionStatus,
      extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
    ) => void;
    transitionDelayMs?: number;
    runDurationMs?: number;
  }) {
    this.onStatusChange = opts.onStatusChange;
    this.transitionDelayMs = opts.transitionDelayMs ?? 200;
    this.runDurationMs = opts.runDurationMs ?? 500;
  }

  async healthCheck(): Promise<GatewayHealthResult> {
    return { ok: true, version: "simulated-1.0.0", detail: "Simulated gateway — no OpenClaw process" };
  }

  async submit(job: GatewayJobRequest): Promise<GatewayJobAccepted> {
    const gatewaySessionId = `sim-${randomUUID()}`;

    const simJob: SimJob = {
      gatewaySessionId,
      executionId: job.executionId,
      status: "submitted",
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      cancelRequested: false,
      pauseRequested: false,
      timer: null,
    };

    this.jobs.set(gatewaySessionId, simJob);

    // Advance to running after transitionDelayMs
    simJob.timer = setTimeout(() => {
      if (simJob.cancelRequested) {
        this._transition(simJob, "cancelled");
        return;
      }
      const startedAt = new Date().toISOString();
      simJob.startedAt = startedAt;
      this._transition(simJob, "running", { startedAt });

      if (!simJob.pauseRequested) {
        // Advance to completed after runDurationMs
        simJob.timer = setTimeout(() => {
          if (simJob.cancelRequested) {
            this._transition(simJob, "cancelled");
            return;
          }
          const completedAt = new Date().toISOString();
          simJob.completedAt = completedAt;
          this._transition(simJob, "completed", { completedAt });
        }, this.runDurationMs);
      }
    }, this.transitionDelayMs);

    return { gatewaySessionId };
  }

  async getStatus(gatewaySessionId: string): Promise<GatewayJobStatusResponse> {
    const job = this.jobs.get(gatewaySessionId);
    if (!job) {
      throw new Error(`Simulated gateway: unknown session ${gatewaySessionId}`);
    }
    return {
      gatewaySessionId,
      status: job.status,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorMessage: job.errorMessage,
    };
  }

  async cancel(gatewaySessionId: string): Promise<void> {
    const job = this.jobs.get(gatewaySessionId);
    if (!job) throw new Error(`Simulated gateway: unknown session ${gatewaySessionId}`);
    job.cancelRequested = true;
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (!["completed", "failed", "timed_out"].includes(job.status)) {
      this._transition(job, "cancelled");
    }
  }

  async pause(gatewaySessionId: string): Promise<void> {
    const job = this.jobs.get(gatewaySessionId);
    if (!job) throw new Error(`Simulated gateway: unknown session ${gatewaySessionId}`);
    if (job.status !== "running") {
      throw new Error(`Cannot pause execution in status: ${job.status}`);
    }
    job.pauseRequested = true;
    if (job.timer) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    this._transition(job, "paused");
  }

  async resume(gatewaySessionId: string): Promise<void> {
    const job = this.jobs.get(gatewaySessionId);
    if (!job) throw new Error(`Simulated gateway: unknown session ${gatewaySessionId}`);
    if (job.status !== "paused") {
      throw new Error(`Cannot resume execution in status: ${job.status}`);
    }
    job.pauseRequested = false;
    this._transition(job, "running", { startedAt: job.startedAt ?? new Date().toISOString() });
    // Advance to completed after runDurationMs
    job.timer = setTimeout(() => {
      if (job.cancelRequested) {
        this._transition(job, "cancelled");
        return;
      }
      const completedAt = new Date().toISOString();
      job.completedAt = completedAt;
      this._transition(job, "completed", { completedAt });
    }, this.runDurationMs);
  }

  private _transition(
    job: SimJob,
    status: BrokerExecutionStatus,
    extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
  ): void {
    job.status = status;
    this.onStatusChange(job.executionId, status, extra);
  }

  /** Stop all pending timers — call on broker shutdown or after each test */
  destroy(): void {
    for (const job of this.jobs.values()) {
      if (job.timer) clearTimeout(job.timer);
    }
    this.jobs.clear();
  }
}

// ─── Live Gateway Adapter (placeholder — Phase 4) ────────────────────────────

/**
 * LiveGatewayAdapter — bridges to the real OpenClaw process on 127.0.0.1:19001
 *
 * NOT IMPLEMENTED. Requires OpenClaw source inspection results.
 *
 * After running:
 *   node scripts/inspect-openclaw.mjs
 * in /Users/tayephilipajao/Development/needsops-browser/OpenClaw-NeedsOps
 * and pasting the findings, this class will be implemented based on
 * OpenClaw's actual supported integration protocol (HTTP, WebSocket, CLI, RPC).
 *
 * @throws Always throws — do not set OPENCLAW_GATEWAY_MODE=live until Phase 4
 */
export class LiveGatewayAdapter implements IGatewayAdapter {
  readonly name = "live";
  private readonly gatewayUrl: string;

  constructor(gatewayUrl: string) {
    this.gatewayUrl = gatewayUrl;
    // Fail fast at construction time so the operator sees the error at startup
    throw new Error(
      `LiveGatewayAdapter is not yet implemented. ` +
      `Run scripts/inspect-openclaw.mjs in your OpenClaw repository, ` +
      `paste the findings, and Phase 4 will add the real integration. ` +
      `Gateway URL configured: ${this.gatewayUrl}`,
    );
  }

  async healthCheck(): Promise<GatewayHealthResult> { throw new Error("Not implemented"); }
  async submit(_job: GatewayJobRequest): Promise<GatewayJobAccepted> { throw new Error("Not implemented"); }
  async getStatus(_id: string): Promise<GatewayJobStatusResponse> { throw new Error("Not implemented"); }
  async cancel(_id: string): Promise<void> { throw new Error("Not implemented"); }
  async pause(_id: string): Promise<void> { throw new Error("Not implemented"); }
  async resume(_id: string): Promise<void> { throw new Error("Not implemented"); }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createGatewayAdapter(
  mode: "simulated" | "live",
  gatewayUrl: string | null,
  onStatusChange: (
    executionId: string,
    status: BrokerExecutionStatus,
    extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
  ) => void,
): IGatewayAdapter {
  if (mode === "live") {
    if (!gatewayUrl) {
      throw new Error("OPENCLAW_GATEWAY_URL is required when OPENCLAW_GATEWAY_MODE=live");
    }
    return new LiveGatewayAdapter(gatewayUrl);
  }
  return new SimulatedGatewayAdapter({ onStatusChange });
}
