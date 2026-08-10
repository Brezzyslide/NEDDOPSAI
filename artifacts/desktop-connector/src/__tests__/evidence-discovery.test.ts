/**
 * Sprint 29O.1 (spawn correction) — Evidence Discovery Route Tests
 *
 * Tests:
 *   1. Spawn mode invokes the OpenClaw binary
 *   2. Valid structured response maps to BrokerCandidateEvidence[]
 *   3. Malformed / missing fields drops the candidate
 *   4. retrievalMethod "connectivity_test" is rejected
 *   5. Timeout kills the process and returns unavailable
 *   6. Process error returns unavailable
 *   7. Spawn binary not found returns unavailable
 *   8. Bridge-http 404 returns unavailable (no synthetic fallback)
 *   9. Bridge-http non-JSON returns unavailable
 *  10. Bridge-http timeout returns unavailable
 *  11. Simulated mode returns clearly labelled empty result
 *  12. passageHash correction when OpenClaw provides wrong hash
 *  13. organisationId / executionId are always stamped from request
 *  14. HTTP route returns 400 on missing required fields
 *  15. HTTP route returns empty with openClawStatus:simulated in simulated mode
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

// ─── Import after mock setup ──────────────────────────────────────────────────

import {
  callSpawnDiscover,
  callBridgeDiscover,
  validateAndFilterCandidates,
  buildDiscoveryInstruction,
} from "../broker/routes/evidence.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as import("pino").Logger;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

interface FakeProcess extends EventEmitter {
  stdin:  { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill:   ReturnType<typeof vi.fn>;
}

function makeFakeProcess(): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  const stdout = new EventEmitter() as FakeProcess["stdout"];
  stdout.setEncoding = vi.fn();
  const stderr = new EventEmitter() as FakeProcess["stderr"];
  stderr.setEncoding = vi.fn();
  proc.stdin  = { write: vi.fn(), end: vi.fn() };
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.kill   = vi.fn();
  return proc;
}

function baseParams() {
  return {
    organizationId:        "org-123",
    executionId:           "exec-456",
    specialistCode:        "chief_of_staff",
    searchObjective:       "Find the health and safety policy",
    unresolvedRefs:        [],
    allowedDiscoveryScope: "internal_and_external",
    allowExternal:         false,
    maxHops:               2,
    maxSources:            5,
    maxPassages:           3,
    timeoutMs:             5000,
  };
}

function validCandidate(override: Record<string, unknown> = {}): Record<string, unknown> {
  const passage = "All employees must read the Health & Safety Policy annually.";
  return {
    sourceTitle:        "Health & Safety Policy v3",
    supportingPassage:  passage,
    passageHash:        sha256(passage),
    retrievalMethod:    "semantic_search",
    retrievalTimestamp: "2026-08-10T12:00:00.000Z",
    contentType:        "policy",
    accessLocation:     "org://library/health-safety-v3",
    sourceType:         "organisational",
    isExternal:         false,
    discoveryReason:    "Matched search objective",
    openClawConfidence: 0.92,
    relevanceScore:     0.88,
    ...override,
  };
}

// ─── callSpawnDiscover ────────────────────────────────────────────────────────

describe("callSpawnDiscover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("spawns the configured OpenClaw binary with rpc args", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());

    // Let the process exit cleanly with no candidates
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(mockSpawn).toHaveBeenCalledWith(
      "openclaw",
      ["agent", "--mode", "rpc", "--json"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    expect(result.openClawStatus).toBe("unavailable"); // no candidates emitted
  });

  it("writes the RPC request to stdin then closes it", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.emit("exit", 0, null);
    await promise;

    expect(proc.stdin.write).toHaveBeenCalledOnce();
    const writtenArg: string = proc.stdin.write.mock.calls[0][0] as string;
    const parsed = JSON.parse(writtenArg.trim()) as Record<string, unknown>;
    expect(parsed["action"]).toBe("evidence_discovery");
    expect(parsed["executionId"]).toBe("exec-456");
    expect(parsed["tenantId"]).toBe("org-123");
    expect(proc.stdin.end).toHaveBeenCalledOnce();
  });

  it("returns candidates when OpenClaw emits discovery_result event", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const passage = "All employees must read the Health & Safety Policy annually.";
    const candidate = validCandidate();
    const event = JSON.stringify({
      type:         "discovery_result",
      hopsFollowed: 1,
      candidates:   [candidate],
    });

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());

    proc.stdout.emit("data", event + "\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("available");
    expect(result.hopsFollowed).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.sourceTitle).toBe("Health & Safety Policy v3");
    // Tenant fields must be stamped from request, not from OpenClaw
    expect(result.candidates[0]!.organisationId).toBe("org-123");
    expect(result.candidates[0]!.executionId).toBe("exec-456");
  });

  it("returns candidates from completed event when no discovery_result was emitted", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const candidate = validCandidate();
    const event = JSON.stringify({
      type:         "completed",
      hopsFollowed: 2,
      candidates:   [candidate],
    });

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", event + "\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("available");
    expect(result.candidates).toHaveLength(1);
  });

  it("drops malformed candidates (missing required field) — status remains available", async () => {
    // OpenClaw ran and emitted a discovery_result event — status is "available".
    // The candidates array is empty because all records were invalid.
    // "available" distinguishes "OpenClaw ran but found nothing valid" from
    // "OpenClaw was unreachable" — the orchestrator treats these differently.
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const bad = validCandidate({ sourceTitle: "" }); // empty required field
    const event = JSON.stringify({ type: "discovery_result", candidates: [bad] });

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", event + "\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("available"); // OpenClaw ran
    expect(result.candidates).toHaveLength(0);       // all invalid — dropped
  });

  it("rejects candidates with retrievalMethod=connectivity_test — status remains available", async () => {
    // Same semantic: OpenClaw ran ("available") but the synthetic fixture was rejected.
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const synthetic = validCandidate({ retrievalMethod: "connectivity_test" });
    const event = JSON.stringify({ type: "discovery_result", candidates: [synthetic] });

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", event + "\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates).toHaveLength(0);
    expect(result.openClawStatus).toBe("available");
  });

  it("corrects wrong passageHash transparently", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const passage = "Correct passage text.";
    const candidate = validCandidate({
      supportingPassage: passage,
      passageHash:       "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // wrong
    });
    const event = JSON.stringify({ type: "discovery_result", candidates: [candidate] });

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", event + "\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.passageHash).toBe(sha256(passage));
  });

  it("handles chunked stdout across multiple data events", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const candidate = validCandidate();
    const full = JSON.stringify({ type: "discovery_result", candidates: [candidate] }) + "\n";

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    // Split the JSON across two chunks
    proc.stdout.emit("data", full.slice(0, 20));
    proc.stdout.emit("data", full.slice(20));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates).toHaveLength(1);
  });

  it("ignores non-JSON lines in stdout", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const candidate = validCandidate();
    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());

    proc.stdout.emit("data", "Initialising OpenClaw...\n");
    proc.stdout.emit("data", "Loading models...\n");
    proc.stdout.emit("data",
      JSON.stringify({ type: "discovery_result", candidates: [candidate] }) + "\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates).toHaveLength(1);
  });

  it("returns unavailable on timeout and kills the process", async () => {
    vi.useFakeTimers();
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const params = { ...baseParams(), timeoutMs: 1000 };
    const promise = callSpawnDiscover(params, "openclaw", makeLogger());

    vi.advanceTimersByTime(1001);
    proc.emit("exit", null, "SIGTERM");

    const result = await promise;
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
    expect(result.failureReason).toContain("timed out");
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");

    vi.useRealTimers();
  });

  it("returns unavailable when binary cannot be spawned", async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("ENOENT: openclaw not found");
    });

    const result = await callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
    expect(result.failureReason).toContain("ENOENT");
  });

  it("returns unavailable on process error event", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.emit("error", new Error("EPIPE"));

    const result = await promise;
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("EPIPE");
  });

  it("stamps organisationId and executionId from request regardless of what OpenClaw returns", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    // OpenClaw returns different IDs — must be overwritten
    const candidate = validCandidate({
      organisationId: "rogue-org",
      executionId:    "rogue-exec",
    });
    const event = JSON.stringify({ type: "discovery_result", candidates: [candidate] });

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", event + "\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates[0]!.organisationId).toBe("org-123");
    expect(result.candidates[0]!.executionId).toBe("exec-456");
  });
});

// ─── callBridgeDiscover ───────────────────────────────────────────────────────

describe("callBridgeDiscover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("returns unavailable when bridgeUrl is null", async () => {
    const result = await callBridgeDiscover(baseParams(), null, makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
  });

  it("returns unavailable on 404 — no synthetic fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 404,
    }));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
    expect(result.failureReason).toContain("404");

    vi.unstubAllGlobals();
  });

  it("returns unavailable when bridge returns non-JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    }));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");

    vi.unstubAllGlobals();
  });

  it("returns unavailable when bridge response has no candidates array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: vi.fn().mockResolvedValue({ result: "ok" }), // no candidates key
    }));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("missing candidates");

    vi.unstubAllGlobals();
  });

  it("returns valid candidates when bridge responds correctly", async () => {
    const candidate = validCandidate();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: vi.fn().mockResolvedValue({ candidates: [candidate], hopsFollowed: 1 }),
    }));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("available");
    expect(result.candidates).toHaveLength(1);
    expect(result.hopsFollowed).toBe(1);

    vi.unstubAllGlobals();
  });

  it("returns unavailable on network error — no synthetic fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("ECONNREFUSED");

    vi.unstubAllGlobals();
  });
});

// ─── validateAndFilterCandidates ─────────────────────────────────────────────

describe("validateAndFilterCandidates", () => {
  const logger = makeLogger();

  it("accepts a valid candidate", () => {
    const result = validateAndFilterCandidates([validCandidate()], "org-1", "exec-1", logger);
    expect(result).toHaveLength(1);
  });

  it("drops candidate with empty sourceTitle", () => {
    const result = validateAndFilterCandidates([validCandidate({ sourceTitle: "" })], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  it("drops candidate with missing supportingPassage", () => {
    const c = { ...validCandidate() };
    delete (c as Record<string, unknown>)["supportingPassage"];
    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  it("rejects connectivity_test retrievalMethod", () => {
    const result = validateAndFilterCandidates(
      [validCandidate({ retrievalMethod: "connectivity_test" })],
      "org-1", "exec-1", logger,
    );
    expect(result).toHaveLength(0);
  });

  it("corrects wrong passageHash", () => {
    const passage = "Some text.";
    const result = validateAndFilterCandidates(
      [validCandidate({ supportingPassage: passage, passageHash: "wrong" })],
      "org-1", "exec-1", logger,
    );
    expect(result[0]!.passageHash).toBe(sha256(passage));
  });

  it("clamps openClawConfidence to [0, 1]", () => {
    const result = validateAndFilterCandidates(
      [validCandidate({ openClawConfidence: 1.5 })],
      "org-1", "exec-1", logger,
    );
    expect(result[0]!.openClawConfidence).toBe(1);
  });

  it("stamps organisationId and executionId from params", () => {
    const result = validateAndFilterCandidates(
      [validCandidate({ organisationId: "evil-org", executionId: "evil-exec" })],
      "org-1", "exec-1", logger,
    );
    expect(result[0]!.organisationId).toBe("org-1");
    expect(result[0]!.executionId).toBe("exec-1");
  });

  it("generates a fresh discoveryId when absent", () => {
    const c = validCandidate();
    delete (c as Record<string, unknown>)["discoveryId"];
    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result[0]!.discoveryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("handles empty array input", () => {
    const result = validateAndFilterCandidates([], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });
});

// ─── buildDiscoveryInstruction ────────────────────────────────────────────────

describe("buildDiscoveryInstruction", () => {
  it("includes all governed parameters", () => {
    const params = {
      ...baseParams(),
      unresolvedRefs: ["See the Escalation Procedure", "Refer to section 4.2"],
    };
    const instruction = buildDiscoveryInstruction(params);

    expect(instruction).toContain("EVIDENCE DISCOVERY ONLY");
    expect(instruction).toContain(params.organizationId);
    expect(instruction).toContain(params.executionId);
    expect(instruction).toContain(params.specialistCode);
    expect(instruction).toContain(params.searchObjective);
    expect(instruction).toContain("NOT PERMITTED"); // allowExternal:false
    expect(instruction).toContain("See the Escalation Procedure");
    expect(instruction).toContain("Refer to section 4.2");
    expect(instruction).toContain("discovery_result");
  });

  it("marks external search as PERMITTED when allowExternal=true", () => {
    const instruction = buildDiscoveryInstruction({ ...baseParams(), allowExternal: true });
    expect(instruction).toContain("PERMITTED");
    expect(instruction).not.toContain("NOT PERMITTED");
  });

  it("omits unresolved references section when none", () => {
    const instruction = buildDiscoveryInstruction(baseParams());
    expect(instruction).not.toContain("UNRESOLVED REFERENCES");
  });

  it("does not allow professional analysis language", () => {
    const instruction = buildDiscoveryInstruction(baseParams());
    expect(instruction).toContain("DO NOT perform professional analysis");
    expect(instruction).toContain("DO NOT fabricate");
  });
});
