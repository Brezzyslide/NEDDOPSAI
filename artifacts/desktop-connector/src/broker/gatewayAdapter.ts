/**
 * NeedsOps Runtime Broker — Gateway Adapter
 *
 * IGatewayAdapter is the boundary between the Runtime Broker and whatever
 * execution engine OpenClaw actually exposes locally.
 *
 * ─── Adapters ────────────────────────────────────────────────────────────────
 *
 * SimulatedGatewayAdapter  — automated tests only. Runs an in-process state
 *   machine (queued → running → completed) with configurable delays. No OpenClaw
 *   process required.
 *
 * LiveGatewayAdapter — Phase 4. Two sub-modes (OPENCLAW_LIVE_MODE):
 *
 *   "spawn" (default)
 *     Spawns `openclaw agent --mode rpc --json` as a child process per
 *     execution. Communicates via JSON lines on stdin/stdout.
 *
 *     Discovered from inspection:
 *       package.json bin: { openclaw: "openclaw.mjs" }
 *       scripts.openclaw:rpc = "node scripts/run-node.mjs agent --mode rpc --json"
 *
 *     Protocol (JSON lines, newline-delimited):
 *       stdin  ← { action, sessionId, executionId, tenantId, … }
 *       stdout → { type|event, sessionId, … } (one JSON object per line)
 *
 *   "bridge-http"
 *     Connects to the OpenClaw browser bridge HTTP server.
 *
 *     Discovered from inspection:
 *       extensions/browser/src/browser/bridge-server.ts  — Express app
 *       routes: /basic, /agent/act, /agent/snapshot, /agent/extract
 *
 *     Endpoints used:
 *       GET  {bridgeUrl}/basic            — health probe
 *       POST {bridgeUrl}/agent/act        — submit task
 *       GET  {bridgeUrl}/agent/snapshot   — poll status
 *       POST {bridgeUrl}/agent/act/hooks  — cancel/abort (hooks route)
 *
 * ─── Swap by env var ─────────────────────────────────────────────────────────
 *
 *   OPENCLAW_GATEWAY_MODE=live
 *   OPENCLAW_LIVE_MODE=spawn|bridge-http   (default: spawn)
 *   OPENCLAW_BIN_PATH=/path/to/openclaw    (spawn mode, default: "openclaw")
 *   OPENCLAW_GATEWAY_URL=http://...        (bridge-http mode, default: http://127.0.0.1:19001)
 *   OPENCLAW_GATEWAY_TIMEOUT_MS=30000      (default: 30000)
 */

import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
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

// ─── Live Gateway Adapter ─────────────────────────────────────────────────────

export interface LiveAdapterConfig {
  /** Transport mode — "spawn" (CLI/RPC) or "bridge-http" */
  liveMode: "spawn" | "bridge-http";
  /** Path to the openclaw binary (spawn mode) */
  openclawBin: string;
  /** URL of the OpenClaw browser bridge HTTP server (bridge-http mode) */
  bridgeUrl: string;
  /** Maximum ms to wait for any gateway operation */
  timeoutMs: number;
  /**
   * Initial delay before the first snapshot poll (bridge-http mode).
   * Default: 2000. Override to a small value (e.g. 50) in tests.
   */
  initialPollDelayMs?: number;
  /** Called whenever a job's status changes */
  onStatusChange: (
    executionId: string,
    status: BrokerExecutionStatus,
    extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
  ) => void;
}

// ─── OpenClaw RPC protocol types ──────────────────────────────────────────────
//
// The `openclaw agent --mode rpc --json` interface communicates via JSON lines.
//
// These types are inferred from:
//   1. The --mode rpc --json flag (spawn mode)
//   2. The gateway-protocol package for event shapes
//   3. Standard OpenClaw agent event naming observed in the test files
//
// If the actual OpenClaw binary uses different field names, update these types
// to match — the _handleSpawnEvent() method normalises multiple event schemas.

interface OpenClawRpcRequest {
  action: "execute" | "cancel" | "pause" | "resume";
  sessionId:          string;
  executionId:        string;
  tenantId:           string;
  workforceRole:      string;
  /** Sprint SRM: compiled specialist identity from NeedsOps DNA */
  specialistManifest: GatewayJobRequest["specialistManifest"];
  /** Hard execution permissions — enforced structurally, not by prompt */
  workerProfile:      GatewayJobRequest["workerProfile"];
  steps:              GatewayJobRequest["steps"];
  constraints:        GatewayJobRequest["constraints"];
}

interface OpenClawRpcEvent {
  // Normalise both `type` and `event` field names (seen in different extensions)
  type?:    string;
  event?:   string;
  // Session correlation
  sessionId?: string;
  // Timestamps
  timestamp?: string;
  startedAt?: string;
  completedAt?: string;
  // Error details
  error?:   string;
  message?: string;
  // Raw output / result
  output?: unknown;
}

// ─── Bridge HTTP protocol types ───────────────────────────────────────────────
//
// Inferred from extensions/browser/src/browser/routes/:
//   bridge-server.ts  → Express app at OPENCLAW_GATEWAY_URL
//   basic.ts          → GET /basic  (health / status)
//   agent.act.ts      → POST /agent/act (execute an action)
//   agent.snapshot.ts → GET /agent/snapshot (get current page/agent state)
//   agent.act.hooks.ts → POST /agent/act/hooks (control hooks inc. abort)

interface BridgeActRequest {
  action:      string;
  sessionId?:  string;
  executionId: string;
  tenantId:    string;
  task:        {
    workforceRole:      string;
    /** Sprint SRM: compiled specialist identity from NeedsOps DNA */
    specialistManifest: GatewayJobRequest["specialistManifest"];
    /** Hard execution permissions — enforced structurally, not by prompt */
    workerProfile:      GatewayJobRequest["workerProfile"];
    steps:              GatewayJobRequest["steps"];
    constraints:        GatewayJobRequest["constraints"];
  };
}

interface BridgeActResponse {
  sessionId?: string;
  id?:        string;
  status?:    string;
  ok?:        boolean;
}

interface BridgeSnapshotResponse {
  sessionId?: string;
  status?:    string;
  state?:     string;
  running?:   boolean;
  completed?: boolean;
  failed?:    boolean;
  error?:     string;
  startedAt?: string;
  completedAt?: string;
}

interface BridgeBasicResponse {
  status?: string;
  ok?:     boolean;
  version?: string;
  running?: boolean;
}

// ─── Internal job state ───────────────────────────────────────────────────────

interface LiveJobState {
  gatewaySessionId: string;
  executionId:      string;
  status:           BrokerExecutionStatus;
  startedAt:        string | null;
  completedAt:      string | null;
  errorMessage:     string | null;
  // spawn mode only
  process:          ChildProcess | null;
}

// ─── LiveGatewayAdapter ───────────────────────────────────────────────────────

/**
 * LiveGatewayAdapter — bridges to the real OpenClaw runtime.
 *
 * Two sub-modes, selected by liveMode config field:
 *
 * "spawn"
 *   Spawns `openclaw agent --mode rpc --json` as a child process.
 *   Each NeedsOps execution = one openclaw process.
 *   Communicates via JSON lines on stdin/stdout.
 *   No pre-running OpenClaw server needed.
 *
 * "bridge-http"
 *   HTTP client for the OpenClaw browser bridge server.
 *   Requires OpenClaw to be running (e.g. `openclaw gateway` or
 *   via the desktop app with the browser extension active).
 *   Routes: GET /basic, POST /agent/act, GET /agent/snapshot,
 *            POST /agent/act/hooks.
 */
export class LiveGatewayAdapter implements IGatewayAdapter {
  readonly name = "live";

  private readonly liveMode:           "spawn" | "bridge-http";
  private readonly openclawBin:        string;
  private readonly bridgeUrl:          string;
  private readonly timeoutMs:          number;
  private readonly initialPollDelayMs: number;
  private readonly onStatusChange: LiveAdapterConfig["onStatusChange"];

  /** Active job states, keyed by gatewaySessionId */
  private readonly jobStates = new Map<string, LiveJobState>();

  constructor(config: LiveAdapterConfig) {
    this.liveMode           = config.liveMode;
    this.openclawBin        = config.openclawBin;
    this.bridgeUrl          = config.bridgeUrl.replace(/\/$/, ""); // strip trailing slash
    this.timeoutMs          = config.timeoutMs;
    this.initialPollDelayMs = config.initialPollDelayMs ?? 2_000;
    this.onStatusChange     = config.onStatusChange;
  }

  // ─── Health check ────────────────────────────────────────────────────────────

  async healthCheck(): Promise<GatewayHealthResult> {
    if (this.liveMode === "bridge-http") {
      return this._bridgeHealthCheck();
    }
    return this._spawnHealthCheck();
  }

  private async _spawnHealthCheck(): Promise<GatewayHealthResult> {
    return new Promise<GatewayHealthResult>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ ok: false, version: "unknown", detail: "openclaw --version timed out" });
      }, Math.min(this.timeoutMs, 10_000));

      execFile(this.openclawBin, ["--version"], { timeout: 8_000 }, (err, stdout) => {
        clearTimeout(timeout);
        if (err) {
          resolve({
            ok: false,
            version: "unknown",
            detail: `openclaw binary not found or error: ${err.message}`,
          });
        } else {
          const version = stdout.trim().split(/\s+/).pop() ?? "unknown";
          resolve({ ok: true, version, detail: `spawn mode; bin=${this.openclawBin}` });
        }
      });
    });
  }

  private async _bridgeHealthCheck(): Promise<GatewayHealthResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.bridgeUrl}/basic`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) {
        return { ok: false, version: "unknown", detail: `GET /basic returned ${res.status}` };
      }
      const body = await res.json().catch(() => ({})) as BridgeBasicResponse;
      const version = body.version ?? "unknown";
      return { ok: true, version, detail: `bridge-http; url=${this.bridgeUrl}` };
    } catch (err) {
      clearTimeout(timer);
      return {
        ok: false,
        version: "unknown",
        detail: `bridge-http health check failed: ${(err as Error).message}`,
      };
    }
  }

  // ─── Submit ──────────────────────────────────────────────────────────────────

  async submit(job: GatewayJobRequest): Promise<GatewayJobAccepted> {
    const gatewaySessionId = `live-${randomUUID()}`;

    const state: LiveJobState = {
      gatewaySessionId,
      executionId:  job.executionId,
      status:       "submitted",
      startedAt:    null,
      completedAt:  null,
      errorMessage: null,
      process:      null,
    };
    this.jobStates.set(gatewaySessionId, state);

    if (this.liveMode === "bridge-http") {
      await this._bridgeSubmit(gatewaySessionId, job, state);
    } else {
      this._spawnSubmit(gatewaySessionId, job, state);
    }

    return { gatewaySessionId };
  }

  // ─── Spawn mode: submit ───────────────────────────────────────────────────

  private _spawnSubmit(
    gatewaySessionId: string,
    job: GatewayJobRequest,
    state: LiveJobState,
  ): void {
    const request: OpenClawRpcRequest = {
      action:            "execute",
      sessionId:         gatewaySessionId,
      executionId:       job.executionId,
      tenantId:          job.tenantId,
      workforceRole:     job.workforceRole,
      specialistManifest: job.specialistManifest,
      workerProfile:     job.workerProfile,
      steps:             job.steps,
      constraints:       job.constraints,
    };

    const maxMs = job.constraints.maxDurationSeconds * 1_000;

    const proc = spawn(this.openclawBin, ["agent", "--mode", "rpc", "--json"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    state.process = proc;

    // Write the task request to stdin.
    // Do NOT close stdin here — we keep it open so control messages (pause,
    // resume, cancel) can be sent later without hitting ERR_STREAM_WRITE_AFTER_END.
    // stdin is closed by _closeSpawnStdin() when we reach a terminal state.
    proc.stdin.write(JSON.stringify(request) + "\n");

    // Read JSON event lines from stdout
    proc.stdout.setEncoding("utf8");
    let stdoutBuf = "";
    proc.stdout.on("data", (chunk: string) => {
      stdoutBuf += chunk;
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const event = JSON.parse(trimmed) as OpenClawRpcEvent;
          this._handleSpawnEvent(gatewaySessionId, event);
        } catch {
          // Ignore non-JSON lines (progress text, etc.)
        }
      }
    });

    // Log stderr (openclaw diagnostic output)
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (_chunk: string) => {
      // Intentionally not logged at warning level — openclaw may write
      // informational messages to stderr during normal operation.
    });

    // Process exit — resolve any still-open executions
    proc.once("exit", (code, signal) => {
      // Flush remaining buffer
      if (stdoutBuf.trim()) {
        try {
          const event = JSON.parse(stdoutBuf.trim()) as OpenClawRpcEvent;
          this._handleSpawnEvent(gatewaySessionId, event);
        } catch { /* ignore */ }
      }

      const s = this.jobStates.get(gatewaySessionId);
      if (!s) return;
      if (["completed", "failed", "cancelled", "timed_out"].includes(s.status)) return;

      // Process exited without emitting a terminal event
      if (code === 0) {
        this._setStatus(s, "completed", { completedAt: new Date().toISOString() });
      } else if (signal === "SIGTERM" || signal === "SIGKILL") {
        this._setStatus(s, "cancelled");
      } else {
        this._setStatus(s, "failed", {
          errorMessage: `openclaw exited with code ${String(code)} signal ${String(signal)}`,
        });
      }
    });

    // Enforce max duration — SIGTERM then SIGKILL
    const durationTimer = setTimeout(() => {
      const s = this.jobStates.get(gatewaySessionId);
      if (!s) return;
      if (["completed", "failed", "cancelled"].includes(s.status)) return;
      this._setStatus(s, "timed_out");
      proc.kill("SIGTERM");
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      }, 5_000);
    }, maxMs);

    proc.once("exit", () => clearTimeout(durationTimer));
  }

  private _handleSpawnEvent(sessionId: string, event: OpenClawRpcEvent): void {
    const state = this.jobStates.get(sessionId);
    if (!state) return;

    // Normalise: some OpenClaw extensions use `type`, others use `event`
    const eventType = (event.type ?? event.event ?? "").toLowerCase();

    switch (eventType) {
      case "started":
      case "running":
      case "begin":
        this._setStatus(state, "running", {
          startedAt: event.startedAt ?? event.timestamp ?? new Date().toISOString(),
        });
        break;

      case "paused":
      case "suspend":
        this._setStatus(state, "paused");
        break;

      case "resumed":
        this._setStatus(state, "running");
        break;

      case "completed":
      case "done":
      case "success":
      case "finish":
        this._setStatus(state, "completed", {
          completedAt: event.completedAt ?? event.timestamp ?? new Date().toISOString(),
        });
        break;

      case "failed":
      case "error":
      case "failure":
        this._setStatus(state, "failed", {
          errorMessage: event.error ?? event.message ?? "OpenClaw reported failure",
        });
        break;

      case "cancelled":
      case "aborted":
      case "abort":
        this._setStatus(state, "cancelled");
        break;

      default:
        // Unknown event — ignore (progress pings, log lines, etc.)
        break;
    }
  }

  // ─── Bridge HTTP mode: submit ─────────────────────────────────────────────

  private async _bridgeSubmit(
    gatewaySessionId: string,
    job: GatewayJobRequest,
    state: LiveJobState,
  ): Promise<void> {
    const body: BridgeActRequest = {
      action:      "execute",
      sessionId:   gatewaySessionId,
      executionId: job.executionId,
      tenantId:    job.tenantId,
      task: {
        workforceRole:      job.workforceRole,
        specialistManifest: job.specialistManifest,
        workerProfile:      job.workerProfile,
        steps:              job.steps,
        constraints:        job.constraints,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.bridgeUrl}/agent/act`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      this._setStatus(state, "failed", {
        errorMessage: `bridge-http submit failed: ${(err as Error).message}`,
      });
      return;
    }
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this._setStatus(state, "failed", {
        errorMessage: `bridge-http POST /agent/act returned ${res.status}: ${text.slice(0, 200)}`,
      });
      return;
    }

    let resp: BridgeActResponse;
    try {
      resp = await res.json() as BridgeActResponse;
    } catch {
      // Non-JSON 200 response — treat as accepted and start polling
      resp = {};
    }

    // The bridge server may echo a session/run ID — use it as an alias
    // The gatewaySessionId we already generated is used for all tracking.
    const _ = resp.sessionId ?? resp.id; // informational only

    // Start polling for completion
    void this._bridgePoll(gatewaySessionId, state, job.constraints.maxDurationSeconds * 1_000);
  }

  /**
   * Poll GET /agent/snapshot until a terminal status is observed or the
   * execution exceeds maxMs.
   */
  private async _bridgePoll(
    gatewaySessionId: string,
    state: LiveJobState,
    maxMs: number,
  ): Promise<void> {
    const deadline = Date.now() + maxMs;
    let pollInterval = this.initialPollDelayMs;
    const maxPollInterval = 10_000;

    // Transition to "running" immediately (bridge doesn't have a queued state)
    if (state.status === "submitted") {
      this._setStatus(state, "running", { startedAt: new Date().toISOString() });
    }

    while (Date.now() < deadline) {
      // Check if cancelled externally
      const current = this.jobStates.get(gatewaySessionId);
      if (!current) return;
      if (["completed", "failed", "cancelled", "timed_out"].includes(current.status)) return;

      await new Promise<void>(r => setTimeout(r, pollInterval));
      pollInterval = Math.min(pollInterval * 1.5, maxPollInterval);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      let snap: BridgeSnapshotResponse;
      try {
        const res = await fetch(
          `${this.bridgeUrl}/agent/snapshot?sessionId=${encodeURIComponent(gatewaySessionId)}`,
          { signal: controller.signal, headers: { Accept: "application/json" } },
        );
        clearTimeout(timer);
        if (!res.ok) continue; // non-fatal — keep polling
        snap = await res.json() as BridgeSnapshotResponse;
      } catch {
        clearTimeout(timer);
        continue; // network hiccup — keep polling
      }

      const s = this.jobStates.get(gatewaySessionId);
      if (!s) return;

      // Map bridge snapshot state to broker status
      const snapshotStatus = (snap.status ?? snap.state ?? "").toLowerCase();
      if (snap.completed || snapshotStatus === "completed" || snapshotStatus === "done") {
        this._setStatus(s, "completed", {
          completedAt: snap.completedAt ?? new Date().toISOString(),
        });
        return;
      }
      if (snap.failed || snapshotStatus === "failed" || snapshotStatus === "error") {
        this._setStatus(s, "failed", {
          errorMessage: snap.error ?? "Bridge reported failure",
          completedAt:  snap.completedAt ?? new Date().toISOString(),
        });
        return;
      }
      if (snapshotStatus === "cancelled" || snapshotStatus === "aborted") {
        this._setStatus(s, "cancelled");
        return;
      }
    }

    // Deadline reached
    const s = this.jobStates.get(gatewaySessionId);
    if (s && !["completed", "failed", "cancelled"].includes(s.status)) {
      this._setStatus(s, "timed_out");
    }
  }

  // ─── Get status ──────────────────────────────────────────────────────────────

  async getStatus(gatewaySessionId: string): Promise<GatewayJobStatusResponse> {
    const state = this.jobStates.get(gatewaySessionId);
    if (!state) {
      throw new Error(`LiveGatewayAdapter: unknown session ${gatewaySessionId}`);
    }
    return {
      gatewaySessionId,
      status:       state.status,
      startedAt:    state.startedAt,
      completedAt:  state.completedAt,
      errorMessage: state.errorMessage,
    };
  }

  // ─── Cancel ──────────────────────────────────────────────────────────────────

  async cancel(gatewaySessionId: string): Promise<void> {
    const state = this.jobStates.get(gatewaySessionId);
    if (!state) throw new Error(`LiveGatewayAdapter: unknown session ${gatewaySessionId}`);

    if (["completed", "failed", "cancelled", "timed_out"].includes(state.status)) return;

    if (this.liveMode === "spawn" && state.process) {
      // Send a JSON cancel message then SIGTERM
      try {
        const msg: Pick<OpenClawRpcRequest, "action" | "sessionId" | "executionId" | "tenantId" | "workforceRole" | "steps" | "constraints"> = {
          action:        "cancel",
          sessionId:     gatewaySessionId,
          executionId:   state.executionId,
          tenantId:      "",
          workforceRole: "",
          steps:         [],
          constraints:   { maxDurationSeconds: 0 },
        };
        if (!state.process.stdin.destroyed) {
          state.process.stdin.write(JSON.stringify(msg) + "\n");
          state.process.stdin.end();
        }
      } catch { /* stdin already closed */ }

      setTimeout(() => {
        try { state.process?.kill("SIGTERM"); } catch { /* ok */ }
      }, 2_000);
    } else if (this.liveMode === "bridge-http") {
      // POST abort hook to bridge server
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        await fetch(`${this.bridgeUrl}/agent/act/hooks`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "abort", sessionId: gatewaySessionId }),
          signal:  controller.signal,
        });
      } catch { /* best-effort */ } finally {
        clearTimeout(timer);
      }
    }

    this._setStatus(state, "cancelled");
  }

  // ─── Pause ───────────────────────────────────────────────────────────────────

  async pause(gatewaySessionId: string): Promise<void> {
    const state = this.jobStates.get(gatewaySessionId);
    if (!state) throw new Error(`LiveGatewayAdapter: unknown session ${gatewaySessionId}`);
    if (state.status !== "running") {
      throw new Error(`Cannot pause execution in status: ${state.status}`);
    }

    if (this.liveMode === "spawn" && state.process) {
      try {
        if (!state.process.stdin.destroyed) {
          state.process.stdin.write(
            JSON.stringify({
              action: "pause", sessionId: gatewaySessionId,
              executionId: state.executionId, tenantId: "",
              workforceRole: "", steps: [], constraints: { maxDurationSeconds: 0 },
            }) + "\n",
          );
        }
      } catch { /* stdin already closed — pause not supported */ }
      // Transition optimistically; the process will confirm via stdout
      this._setStatus(state, "paused");
    } else {
      // Bridge HTTP has no dedicated pause route in discovered API
      throw new Error("pause is not supported in bridge-http mode");
    }
  }

  // ─── Resume ──────────────────────────────────────────────────────────────────

  async resume(gatewaySessionId: string): Promise<void> {
    const state = this.jobStates.get(gatewaySessionId);
    if (!state) throw new Error(`LiveGatewayAdapter: unknown session ${gatewaySessionId}`);
    if (state.status !== "paused") {
      throw new Error(`Cannot resume execution in status: ${state.status}`);
    }

    if (this.liveMode === "spawn" && state.process) {
      try {
        if (!state.process.stdin.destroyed) {
          state.process.stdin.write(
            JSON.stringify({
              action: "resume", sessionId: gatewaySessionId,
              executionId: state.executionId, tenantId: "",
              workforceRole: "", steps: [], constraints: { maxDurationSeconds: 0 },
            }) + "\n",
          );
        }
      } catch { /* stdin already closed */ }
      this._setStatus(state, "running");
    } else {
      throw new Error("resume is not supported in bridge-http mode");
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _setStatus(
    state: LiveJobState,
    status: BrokerExecutionStatus,
    extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
  ): void {
    state.status = status;
    if (extra?.startedAt)    state.startedAt    = extra.startedAt;
    if (extra?.completedAt)  state.completedAt  = extra.completedAt;
    if (extra?.errorMessage) state.errorMessage = extra.errorMessage;
    this.onStatusChange(state.executionId, status, extra);
    // Once terminal, close the process stdin so openclaw can exit cleanly
    if (["completed", "failed", "cancelled", "timed_out"].includes(status)) {
      this._closeSpawnStdin(state);
    }
  }

  private _closeSpawnStdin(state: LiveJobState): void {
    if (state.process?.stdin && !state.process.stdin.destroyed) {
      try { state.process.stdin.end(); } catch { /* already closed */ }
    }
  }

  /** Kill all running processes — call on broker shutdown */
  destroy(): void {
    for (const state of this.jobStates.values()) {
      if (state.process) {
        try { state.process.kill("SIGTERM"); } catch { /* ok */ }
      }
    }
    this.jobStates.clear();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createGatewayAdapter(
  mode: "simulated" | "live",
  config: {
    gatewayUrl:   string | null;
    liveMode:     "spawn" | "bridge-http";
    openclawBin:  string;
    gatewayTimeoutMs: number;
  },
  onStatusChange: (
    executionId: string,
    status: BrokerExecutionStatus,
    extra?: { startedAt?: string; completedAt?: string; errorMessage?: string },
  ) => void,
): IGatewayAdapter {
  if (mode === "live") {
    return new LiveGatewayAdapter({
      liveMode:     config.liveMode,
      openclawBin:  config.openclawBin,
      bridgeUrl:    config.gatewayUrl ?? "http://127.0.0.1:19001",
      timeoutMs:    config.gatewayTimeoutMs,
      onStatusChange,
    });
  }
  return new SimulatedGatewayAdapter({ onStatusChange });
}
