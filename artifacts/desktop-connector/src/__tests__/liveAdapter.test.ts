/**
 * LiveGatewayAdapter — unit tests
 *
 * All tests are fully offline:
 *   - spawn mode: child_process.spawn and execFile are mocked
 *   - bridge-http mode: global fetch is mocked
 *
 * No real openclaw binary required.
 */

import {
  describe, it, expect, vi, beforeEach, afterEach, type MockInstance,
} from "vitest";
import { EventEmitter, PassThrough } from "node:stream";
import { LiveGatewayAdapter, type LiveAdapterConfig } from "../broker/gatewayAdapter.js";
import type { BrokerExecutionStatus, GatewayJobRequest } from "../broker/types.js";

// ─── Mock child_process ───────────────────────────────────────────────────────

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
}));

import { spawn, execFile } from "node:child_process";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fake child process with controllable stdin/stdout/stderr streams */
function makeFakeProc() {
  const proc = new EventEmitter() as ReturnType<typeof spawn>;
  const stdin  = new PassThrough();
  const stdout = new PassThrough({ encoding: "utf8" });
  const stderr = new PassThrough({ encoding: "utf8" });

  Object.assign(proc, { stdin, stdout, stderr, kill: vi.fn() });
  return proc as typeof proc & {
    stdin:  PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill:   MockInstance;
  };
}

function makeJob(overrides: Partial<GatewayJobRequest> = {}): GatewayJobRequest {
  return {
    executionId:   "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    tenantId:      "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    workforceRole: "chief_of_staff",
    steps: [{ sequence: 1, specialist: "chief_of_staff", action: "execute",
      description: "Test step" }],
    constraints: { maxDurationSeconds: 30 },
    ...overrides,
  };
}

type StatusRecord = { executionId: string; status: BrokerExecutionStatus; extra?: unknown };

function makeAdapter(
  liveMode: "spawn" | "bridge-http" = "spawn",
  extraConfig: Partial<LiveAdapterConfig> = {},
): { adapter: LiveGatewayAdapter; statusChanges: StatusRecord[] } {
  const statusChanges: StatusRecord[] = [];
  const adapter = new LiveGatewayAdapter({
    liveMode,
    openclawBin:  "openclaw",
    bridgeUrl:    "http://127.0.0.1:19001",
    timeoutMs:    5_000,
    onStatusChange(executionId, status, extra) {
      statusChanges.push({ executionId, status, extra });
    },
    ...extraConfig,
  });
  return { adapter, statusChanges };
}

// ─── Spawn mode — health check ────────────────────────────────────────────────

describe("LiveGatewayAdapter (spawn) — healthCheck", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns ok=true when openclaw --version succeeds", async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error — mocked callback
      cb(null, "openclaw 1.2.3\n", "");
      return {} as ReturnType<typeof execFile>;
    });

    const { adapter } = makeAdapter("spawn");
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.version).toContain("1.2.3");
  });

  it("returns ok=false when binary not found", async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error — mocked callback
      cb(new Error("ENOENT: openclaw not found"), "", "");
      return {} as ReturnType<typeof execFile>;
    });

    const { adapter } = makeAdapter("spawn");
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("ENOENT");
  });
});

// ─── Spawn mode — submit and lifecycle ───────────────────────────────────────

describe("LiveGatewayAdapter (spawn) — submit / lifecycle", () => {
  let fakeProc: ReturnType<typeof makeFakeProc>;

  beforeEach(() => {
    fakeProc = makeFakeProc();
    vi.mocked(spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("spawns openclaw with the correct arguments", async () => {
    const { adapter } = makeAdapter("spawn");
    await adapter.submit(makeJob());
    expect(vi.mocked(spawn)).toHaveBeenCalledWith(
      "openclaw",
      ["agent", "--mode", "rpc", "--json"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    adapter.destroy();
  });

  it("returns a gatewaySessionId starting with 'live-'", async () => {
    const { adapter } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());
    expect(gatewaySessionId).toMatch(/^live-/);
    adapter.destroy();
  });

  it("writes a JSON execute request to stdin", async () => {
    // Spy on stdin.write BEFORE submit so we capture the write call
    const writeSpy = vi.spyOn(fakeProc.stdin, "write");

    const { adapter } = makeAdapter("spawn");
    const job = makeJob();
    await adapter.submit(job);
    await new Promise(r => setImmediate(r));

    expect(writeSpy).toHaveBeenCalled();
    const firstCall = writeSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(firstCall.trim()) as { action: string; executionId: string };
    expect(parsed.action).toBe("execute");
    expect(parsed.executionId).toBe(job.executionId);
    adapter.destroy();
  });

  it("transitions to running on 'started' stdout event", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    const job = makeJob();
    await adapter.submit(job);

    fakeProc.stdout.push(JSON.stringify({ type: "started", sessionId: "x" }) + "\n");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "running")).toBe(true);
    adapter.destroy();
  });

  it("also handles 'running' event type", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "running" }) + "\n");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "running")).toBe(true);
    adapter.destroy();
  });

  it("transitions to completed on 'completed' event", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "completed", completedAt: new Date().toISOString() }) + "\n");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "completed")).toBe(true);
    adapter.destroy();
  });

  it("also handles 'done' event type → completed", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ event: "done" }) + "\n");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "completed")).toBe(true);
    adapter.destroy();
  });

  it("transitions to failed on 'error' event", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "error", error: "Something went wrong" }) + "\n");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "failed")).toBe(true);
    const failedEvent = statusChanges.find(s => s.status === "failed");
    expect((failedEvent!.extra as { errorMessage?: string })?.errorMessage).toBe("Something went wrong");
    adapter.destroy();
  });

  it("transitions to failed on 'failed' event", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "failed", message: "Task failed" }) + "\n");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "failed")).toBe(true);
    adapter.destroy();
  });

  it("transitions to cancelled on 'cancelled' event", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "cancelled" }) + "\n");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "cancelled")).toBe(true);
    adapter.destroy();
  });

  it("ignores non-JSON stdout lines without throwing", async () => {
    const { adapter } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    expect(() => {
      fakeProc.stdout.push("INFO Starting OpenClaw agent runtime\n");
      fakeProc.stdout.push("DEBUG loading config\n");
    }).not.toThrow();

    adapter.destroy();
  });

  it("handles multiple JSON events in a single chunk", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    const chunk = [
      JSON.stringify({ type: "started" }),
      JSON.stringify({ type: "completed", completedAt: new Date().toISOString() }),
    ].join("\n") + "\n";
    fakeProc.stdout.push(chunk);
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "running")).toBe(true);
    expect(statusChanges.some(s => s.status === "completed")).toBe(true);
    adapter.destroy();
  });

  it("getStatus returns submitted status before any events", async () => {
    const { adapter } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());

    const status = await adapter.getStatus(gatewaySessionId);
    expect(status.status).toBe("submitted");
    adapter.destroy();
  });

  it("getStatus returns updated status after event", async () => {
    const { adapter } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "running" }) + "\n");
    await new Promise(r => setImmediate(r));

    const status = await adapter.getStatus(gatewaySessionId);
    expect(status.status).toBe("running");
    adapter.destroy();
  });

  it("getStatus throws for unknown session", async () => {
    const { adapter } = makeAdapter("spawn");
    await expect(adapter.getStatus("unknown-session")).rejects.toThrow("unknown session");
  });
});

// ─── Spawn mode — process exit handling ──────────────────────────────────────

describe("LiveGatewayAdapter (spawn) — process exit", () => {
  let fakeProc: ReturnType<typeof makeFakeProc>;

  beforeEach(() => {
    fakeProc = makeFakeProc();
    vi.mocked(spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>);
  });
  afterEach(() => vi.restoreAllMocks());

  it("marks completed when process exits with code 0 without terminal event", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "running" }) + "\n");
    await new Promise(r => setImmediate(r));
    fakeProc.emit("exit", 0, null);
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "completed")).toBe(true);
    adapter.destroy();
  });

  it("marks failed when process exits with non-zero code", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.emit("exit", 1, null);
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "failed")).toBe(true);
    const ev = statusChanges.find(s => s.status === "failed")!;
    expect((ev.extra as { errorMessage?: string })?.errorMessage).toContain("code 1");
    adapter.destroy();
  });

  it("marks cancelled when process is killed with SIGTERM", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.emit("exit", null, "SIGTERM");
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "cancelled")).toBe(true);
    adapter.destroy();
  });

  it("does not double-emit if process exits after terminal event", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "completed" }) + "\n");
    await new Promise(r => setImmediate(r));
    fakeProc.emit("exit", 0, null);
    await new Promise(r => setImmediate(r));

    const completedEvents = statusChanges.filter(s => s.status === "completed");
    expect(completedEvents).toHaveLength(1);
    adapter.destroy();
  });
});

// ─── Spawn mode — cancel / pause / resume ────────────────────────────────────

describe("LiveGatewayAdapter (spawn) — control operations", () => {
  let fakeProc: ReturnType<typeof makeFakeProc>;

  beforeEach(() => {
    fakeProc = makeFakeProc();
    vi.mocked(spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>);
  });
  afterEach(() => vi.restoreAllMocks());

  it("cancel triggers SIGTERM and emits cancelled status", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());

    await adapter.cancel(gatewaySessionId);
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "cancelled")).toBe(true);
    adapter.destroy();
  });

  it("cancel on already-completed execution is a no-op", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "completed" }) + "\n");
    await new Promise(r => setImmediate(r));

    const before = statusChanges.length;
    await adapter.cancel(gatewaySessionId);
    expect(statusChanges.length).toBe(before);
    adapter.destroy();
  });

  it("cancel on unknown session throws", async () => {
    const { adapter } = makeAdapter("spawn");
    await expect(adapter.cancel("unknown")).rejects.toThrow("unknown session");
  });

  it("pause transitions to paused status", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());

    // Move to running first
    fakeProc.stdout.push(JSON.stringify({ type: "running" }) + "\n");
    await new Promise(r => setImmediate(r));

    await adapter.pause(gatewaySessionId);
    expect(statusChanges.some(s => s.status === "paused")).toBe(true);
    adapter.destroy();
  });

  it("pause throws when execution is not running", async () => {
    const { adapter } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());
    // Still in "submitted" state — cannot pause
    await expect(adapter.pause(gatewaySessionId)).rejects.toThrow(/Cannot pause/);
    adapter.destroy();
  });

  it("resume transitions back to running from paused", async () => {
    const { adapter, statusChanges } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());

    fakeProc.stdout.push(JSON.stringify({ type: "running" }) + "\n");
    await new Promise(r => setImmediate(r));

    await adapter.pause(gatewaySessionId);
    await adapter.resume(gatewaySessionId);

    const last = statusChanges[statusChanges.length - 1]!;
    expect(last.status).toBe("running");
    adapter.destroy();
  });

  it("resume throws when execution is not paused", async () => {
    const { adapter } = makeAdapter("spawn");
    const { gatewaySessionId } = await adapter.submit(makeJob());
    await expect(adapter.resume(gatewaySessionId)).rejects.toThrow(/Cannot resume/);
    adapter.destroy();
  });
});

// ─── Spawn mode — destroy ─────────────────────────────────────────────────────

describe("LiveGatewayAdapter (spawn) — destroy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("kills all running processes and clears job state", async () => {
    const fakeProc = makeFakeProc();
    vi.mocked(spawn).mockReturnValue(fakeProc as unknown as ReturnType<typeof spawn>);

    const { adapter } = makeAdapter("spawn");
    await adapter.submit(makeJob());

    adapter.destroy();
    expect(fakeProc.kill).toHaveBeenCalledWith("SIGTERM");

    // getStatus should throw after destroy
    await expect(adapter.getStatus("any")).rejects.toThrow();
  });
});

// ─── Bridge HTTP mode — health check ─────────────────────────────────────────

describe("LiveGatewayAdapter (bridge-http) — healthCheck", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns ok=true on 200 /basic response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true, version: "0.100.0" }), { status: 200 }),
    );
    const { adapter } = makeAdapter("bridge-http");
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(true);
    expect(result.version).toBe("0.100.0");
  });

  it("returns ok=false on non-200 /basic response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
    const { adapter } = makeAdapter("bridge-http");
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(false);
  });

  it("returns ok=false on network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { adapter } = makeAdapter("bridge-http");
    const result = await adapter.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("ECONNREFUSED");
  });

  it("hits the /basic route on the configured bridge URL", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const { adapter } = makeAdapter("bridge-http", { bridgeUrl: "http://127.0.0.1:19001" });
    await adapter.healthCheck();
    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/basic");
  });
});

// ─── Bridge HTTP mode — submit ────────────────────────────────────────────────

describe("LiveGatewayAdapter (bridge-http) — submit", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("returns a gatewaySessionId starting with 'live-'", async () => {
    // POST /agent/act — success
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ sessionId: "bridge-abc" }), { status: 200 }),
    );
    // Subsequent snapshot polls can 404 safely
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 404 }));

    const { adapter } = makeAdapter("bridge-http", { timeoutMs: 100 });
    const { gatewaySessionId } = await adapter.submit(makeJob());
    expect(gatewaySessionId).toMatch(/^live-/);
    adapter.destroy();
  });

  it("POSTs to /agent/act with correct body fields", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    const { adapter } = makeAdapter("bridge-http", { timeoutMs: 100 });
    const job = makeJob();
    await adapter.submit(job);

    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toContain("/agent/act");
    const body = JSON.parse((options as RequestInit).body as string) as {
      executionId: string; action: string;
    };
    expect(body.executionId).toBe(job.executionId);
    expect(body.action).toBe("execute");
    adapter.destroy();
  });

  it("marks execution failed when POST /agent/act returns 500", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Internal Error", { status: 500 }),
    );

    const { adapter, statusChanges } = makeAdapter("bridge-http");
    await adapter.submit(makeJob());
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "failed")).toBe(true);
    const ev = statusChanges.find(s => s.status === "failed")!;
    expect((ev.extra as { errorMessage?: string })?.errorMessage).toContain("500");
    adapter.destroy();
  });

  it("marks execution failed on network error during submit", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const { adapter, statusChanges } = makeAdapter("bridge-http");
    await adapter.submit(makeJob());
    await new Promise(r => setImmediate(r));

    expect(statusChanges.some(s => s.status === "failed")).toBe(true);
    adapter.destroy();
  });
});

// ─── Bridge HTTP mode — polling / status ──────────────────────────────────────

describe("LiveGatewayAdapter (bridge-http) — snapshot polling", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("transitions to completed when snapshot returns completed=true", async () => {
    // First call: POST /agent/act
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    // Second call: GET /agent/snapshot — completed
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ completed: true, completedAt: new Date().toISOString() }), { status: 200 }),
    );
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    // initialPollDelayMs=50 so the first snapshot poll fires quickly in tests
    const { adapter, statusChanges } = makeAdapter("bridge-http", { timeoutMs: 2_000, initialPollDelayMs: 50 });
    await adapter.submit(makeJob());

    // Wait long enough for the first poll to complete (50ms delay + fetch resolve)
    await new Promise(r => setTimeout(r, 300));

    expect(statusChanges.some(s => s.status === "completed")).toBe(true);
    adapter.destroy();
  });

  it("transitions to failed when snapshot returns failed=true", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ failed: true, error: "Task failed" }), { status: 200 }),
    );
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    const { adapter, statusChanges } = makeAdapter("bridge-http", { timeoutMs: 2_000, initialPollDelayMs: 50 });
    await adapter.submit(makeJob());

    await new Promise(r => setTimeout(r, 300));

    expect(statusChanges.some(s => s.status === "failed")).toBe(true);
    adapter.destroy();
  });
});

// ─── Bridge HTTP mode — cancel ────────────────────────────────────────────────

describe("LiveGatewayAdapter (bridge-http) — cancel", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs abort to /agent/act/hooks and emits cancelled", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    const { adapter, statusChanges } = makeAdapter("bridge-http", { timeoutMs: 100 });
    const { gatewaySessionId } = await adapter.submit(makeJob());
    await adapter.cancel(gatewaySessionId);

    expect(statusChanges.some(s => s.status === "cancelled")).toBe(true);

    // Find the hooks call
    const calls = vi.mocked(fetch).mock.calls;
    const hooksCall = calls.find(([url]) => String(url).includes("/agent/act/hooks"));
    expect(hooksCall).toBeDefined();
    const body = JSON.parse((hooksCall![1] as RequestInit).body as string) as {
      action: string;
    };
    expect(body.action).toBe("abort");
    adapter.destroy();
  });

  it("pause throws NOT_SUPPORTED in bridge-http mode", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }));

    const { adapter, statusChanges } = makeAdapter("bridge-http", { timeoutMs: 100 });
    const { gatewaySessionId } = await adapter.submit(makeJob());

    // Move to running via manual state injection
    statusChanges.push({ executionId: makeJob().executionId, status: "running" });

    // pause is explicitly unsupported in bridge mode
    await expect(adapter.pause(gatewaySessionId)).rejects.toThrow(/not supported/i);
    adapter.destroy();
  });
});
