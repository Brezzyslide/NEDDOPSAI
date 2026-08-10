/**
 * Sprint 29O.1 (real CLI contract) — Evidence Discovery Route Tests
 *
 * Proven OpenClaw CLI contract (OpenClaw 2026.7.2):
 *   WORKING:  openclaw agent --agent main --message-file <tmpfile> --json
 *   INVALID:  openclaw agent --mode rpc --json   ← --mode flag does not exist
 *
 * OpenClaw writes a single JSON object to stdout (not streaming events):
 *   { runId, status: "ok", result: { payloads: [{ text: '{"candidates":[...]}' }] } }
 *
 * Tests:
 *   callSpawnDiscover
 *     1.  Spawns with correct --agent main --message-file --json args
 *     2.  Writes governed instruction to temp file, cleans it up after exit
 *     3.  Returns candidates when OpenClaw emits valid payload
 *     4.  Stamps organisationId/executionId from request (not from OpenClaw)
 *     5.  Drops malformed candidates — status remains "available" (OpenClaw ran)
 *     6.  Rejects connectivity_test retrievalMethod — status remains "available"
 *     7.  Corrects wrong passageHash transparently
 *     8.  Returns unavailable on non-zero exit code
 *     9.  Returns unavailable when stdout is not valid JSON
 *    10.  Returns unavailable when result.payloads is missing
 *    11.  Returns available + empty candidates when assistant payload is not JSON
 *    12.  Returns available + empty candidates when payload has no candidates array
 *    13.  Returns unavailable on timeout and kills the process
 *    14.  Returns unavailable when binary cannot be spawned
 *    15.  Returns unavailable on process error event
 *    16.  Returns unavailable when temp file cannot be written
 *
 *   callBridgeDiscover
 *    17.  Returns unavailable when bridgeUrl is null
 *    18.  Returns unavailable on 404 — no synthetic fallback
 *    19.  Returns unavailable when bridge returns non-JSON
 *    20.  Returns unavailable when bridge response has no candidates array
 *    21.  Returns valid candidates when bridge responds correctly
 *    22.  Returns unavailable on network error
 *
 *   validateAndFilterCandidates
 *    23.  Accepts a valid candidate
 *    24.  Drops candidate with empty sourceTitle
 *    25.  Drops candidate with missing supportingPassage
 *    26.  Rejects connectivity_test retrievalMethod
 *    27.  Corrects wrong passageHash
 *    28.  Clamps openClawConfidence to [0, 1]
 *    29.  Stamps organisationId and executionId from params
 *    30.  Generates fresh discoveryId when absent
 *    31.  Handles empty array input
 *
 *   buildDiscoveryInstruction
 *    32.  Includes all governed parameters
 *    33.  Marks external search as PERMITTED when allowExternal=true
 *    34.  Omits unresolved references section when none
 *    35.  Contains prohibition language (DO NOT fabricate / DO NOT perform analysis)
 *    36.  Instructs OpenClaw to return a { candidates: [...] } JSON object (not events)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────
// All vi.hoisted calls must be at the top — they are hoisted before imports.

const mockSpawn           = vi.hoisted(() => vi.fn());
const mockWriteFileSync   = vi.hoisted(() => vi.fn());
const mockUnlinkSync      = vi.hoisted(() => vi.fn());
const mockTmpdir          = vi.hoisted(() => vi.fn(() => "/tmp"));

vi.mock("node:child_process", () => ({
  spawn: mockSpawn,
}));

vi.mock("node:fs", () => ({
  writeFileSync: mockWriteFileSync,
  unlinkSync:    mockUnlinkSync,
}));

vi.mock("node:os", () => ({
  tmpdir: mockTmpdir,
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

/**
 * Fake child process matching the new stdio contract:
 *   ["ignore", "pipe", "pipe"]
 *
 * No stdin — the instruction is passed via --message-file, not stdin.
 */
interface FakeProcess extends EventEmitter {
  stdout: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  stderr: EventEmitter & { setEncoding: ReturnType<typeof vi.fn> };
  kill:   ReturnType<typeof vi.fn>;
}

function makeFakeProcess(): FakeProcess {
  const proc   = new EventEmitter() as FakeProcess;
  const stdout = new EventEmitter() as FakeProcess["stdout"];
  stdout.setEncoding = vi.fn();
  const stderr = new EventEmitter() as FakeProcess["stderr"];
  stderr.setEncoding = vi.fn();
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
    unresolvedRefs:        [] as string[],
    allowedDiscoveryScope: "internal_and_external",
    allowExternal:         false,
    maxHops:               2,
    maxSources:            5,
    maxPassages:           3,
    timeoutMs:             5000,
  };
}

/** Build a valid candidate payload (as OpenClaw would include in its JSON). */
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

/**
 * Build a complete OpenClaw stdout JSON blob matching the real output structure:
 *   { runId, status: "ok", result: { payloads: [{ text: "<JSON>" }] } }
 *
 * The assistant response (containing candidates) is JSON-stringified into
 * result.payloads[0].text.
 */
function makeOpenClawOutput(
  candidates: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    runId:  "run-test-001",
    status: "ok",
    result: {
      payloads: [
        { text: JSON.stringify({ candidates }) },
      ],
    },
    ...overrides,
  });
}

// ─── callSpawnDiscover ────────────────────────────────────────────────────────

describe("callSpawnDiscover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTmpdir.mockReturnValue("/tmp");
    mockWriteFileSync.mockImplementation(() => undefined);
    mockUnlinkSync.mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── 1: Correct spawn args ──────────────────────────────────────────────────

  it("spawns with --agent main --message-file <tmpfile> --json (not --mode rpc)", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.emit("exit", 0, null);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      "openclaw",
      ["agent", "--agent", "main", "--message-file", expect.stringContaining("/tmp/"), "--json"],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    );
  });

  // ── 2: Temp file lifecycle ─────────────────────────────────────────────────

  it("writes the instruction to a temp file and deletes it after exit", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.emit("exit", 0, null);
    await promise;

    // Instruction written
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [tmpPath, content, encoding] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    expect(tmpPath).toMatch(/\/tmp\/needsops-discovery-.*\.txt$/);
    expect(encoding).toBe("utf8");
    expect(content).toContain("EVIDENCE DISCOVERY ONLY");

    // Temp file cleaned up
    expect(mockUnlinkSync).toHaveBeenCalledWith(tmpPath);
  });

  // ── 3: Valid payload → candidates ─────────────────────────────────────────

  it("returns candidates when OpenClaw emits a valid JSON payload", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", makeOpenClawOutput([validCandidate()]));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("available");
    expect(result.hopsFollowed).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.sourceTitle).toBe("Health & Safety Policy v3");
  });

  // ── 4: Tenant field stamping ───────────────────────────────────────────────

  it("stamps organisationId and executionId from request — ignores OpenClaw values", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    // OpenClaw returns rogue IDs — must be overwritten
    const candidate = validCandidate({ organisationId: "rogue-org", executionId: "rogue-exec" });
    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", makeOpenClawOutput([candidate]));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates[0]!.organisationId).toBe("org-123");
    expect(result.candidates[0]!.executionId).toBe("exec-456");
  });

  // ── 5: Malformed candidates ────────────────────────────────────────────────

  it("drops malformed candidates — status remains available (OpenClaw ran)", async () => {
    // "available" = the binary executed successfully.
    // Invalid candidates are dropped but OpenClaw is still considered reachable.
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const bad = validCandidate({ sourceTitle: "" }); // empty required field
    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", makeOpenClawOutput([bad]));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("available");
    expect(result.candidates).toHaveLength(0);
  });

  // ── 6: Synthetic candidate rejection ──────────────────────────────────────

  it("rejects connectivity_test retrievalMethod — status remains available", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const synthetic = validCandidate({ retrievalMethod: "connectivity_test" });
    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", makeOpenClawOutput([synthetic]));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates).toHaveLength(0);
    expect(result.openClawStatus).toBe("available");
  });

  // ── 7: passageHash correction ─────────────────────────────────────────────

  it("corrects wrong passageHash transparently", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const passage   = "Correct passage text.";
    const candidate = validCandidate({
      supportingPassage: passage,
      passageHash: "a".repeat(64), // deliberately wrong
    });

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", makeOpenClawOutput([candidate]));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.passageHash).toBe(sha256(passage));
  });

  // ── 8: Non-zero exit ──────────────────────────────────────────────────────

  it("returns unavailable on non-zero exit code", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.emit("exit", 1, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("code 1");
  });

  // ── 9: Malformed stdout JSON ──────────────────────────────────────────────

  it("returns unavailable when stdout is not valid JSON", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", "OpenClaw initialising...\n");
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("JSON malformed");
  });

  // ── 10: Missing result.payloads ───────────────────────────────────────────

  it("returns unavailable when result.payloads is missing", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    // Top-level JSON present but no payloads
    proc.stdout.emit("data", JSON.stringify({ runId: "x", status: "ok", result: {} }));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("result.payloads");
  });

  // ── 11: Non-JSON assistant payload ────────────────────────────────────────

  it("returns available + empty candidates when assistant payload text is not JSON", async () => {
    // OpenClaw ran (available) but didn't return machine-readable JSON in its text.
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", JSON.stringify({
      runId:  "x",
      status: "ok",
      result: { payloads: [{ text: "I found some evidence but forgot to return JSON." }] },
    }));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("available");
    expect(result.candidates).toHaveLength(0);
    expect(result.failureReason).toContain("not valid JSON");
  });

  // ── 12: No candidates array in payload ────────────────────────────────────

  it("returns available + empty candidates when payload JSON has no candidates array", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.stdout.emit("data", JSON.stringify({
      runId:  "x",
      status: "ok",
      result: { payloads: [{ text: JSON.stringify({ status: "no_results_found" }) }] },
    }));
    proc.emit("exit", 0, null);

    const result = await promise;
    expect(result.openClawStatus).toBe("available");
    expect(result.candidates).toHaveLength(0);
    expect(result.failureReason).toContain("missing candidates");
  });

  // ── 13: Timeout ───────────────────────────────────────────────────────────

  it("returns unavailable on timeout and kills the process", async () => {
    vi.useFakeTimers();
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const params  = { ...baseParams(), timeoutMs: 1000 };
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

  // ── 14: Binary not found ──────────────────────────────────────────────────

  it("returns unavailable when binary cannot be spawned", async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error("ENOENT: openclaw not found");
    });

    const result = await callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
    expect(result.failureReason).toContain("ENOENT");
  });

  // ── 15: Process error event ───────────────────────────────────────────────

  it("returns unavailable on process error event", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const promise = callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    proc.emit("error", new Error("EPIPE"));

    const result = await promise;
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("EPIPE");
  });

  // ── 16: Temp file write failure ───────────────────────────────────────────

  it("returns unavailable when temp file cannot be written", async () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    const result = await callSpawnDiscover(baseParams(), "openclaw", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("EACCES");
    // Spawn should not have been called
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

// ─── callBridgeDiscover ───────────────────────────────────────────────────────

describe("callBridgeDiscover", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── 17 ────────────────────────────────────────────────────────────────────
  it("returns unavailable when bridgeUrl is null", async () => {
    const result = await callBridgeDiscover(baseParams(), null, makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
  });

  // ── 18 ────────────────────────────────────────────────────────────────────
  it("returns unavailable on 404 — no synthetic fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.candidates).toHaveLength(0);
    expect(result.failureReason).toContain("404");

    vi.unstubAllGlobals();
  });

  // ── 19 ────────────────────────────────────────────────────────────────────
  it("returns unavailable when bridge returns non-JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token")),
    }));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");

    vi.unstubAllGlobals();
  });

  // ── 20 ────────────────────────────────────────────────────────────────────
  it("returns unavailable when bridge response has no candidates array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok:   true,
      json: vi.fn().mockResolvedValue({ result: "ok" }),
    }));

    const result = await callBridgeDiscover(baseParams(), "http://127.0.0.1:19001", makeLogger());
    expect(result.openClawStatus).toBe("unavailable");
    expect(result.failureReason).toContain("missing candidates");

    vi.unstubAllGlobals();
  });

  // ── 21 ────────────────────────────────────────────────────────────────────
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

  // ── 22 ────────────────────────────────────────────────────────────────────
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

  // ── 23 ────────────────────────────────────────────────────────────────────
  it("accepts a valid candidate", () => {
    const result = validateAndFilterCandidates([validCandidate()], "org-1", "exec-1", logger);
    expect(result).toHaveLength(1);
  });

  // ── 24 ────────────────────────────────────────────────────────────────────
  it("drops candidate with empty sourceTitle", () => {
    const result = validateAndFilterCandidates([validCandidate({ sourceTitle: "" })], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  // ── 25 ────────────────────────────────────────────────────────────────────
  it("drops candidate with missing supportingPassage", () => {
    const c = { ...validCandidate() };
    delete (c as Record<string, unknown>)["supportingPassage"];
    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  // ── 26 ────────────────────────────────────────────────────────────────────
  it("rejects connectivity_test retrievalMethod", () => {
    const result = validateAndFilterCandidates(
      [validCandidate({ retrievalMethod: "connectivity_test" })],
      "org-1", "exec-1", logger,
    );
    expect(result).toHaveLength(0);
  });

  // ── 27 ────────────────────────────────────────────────────────────────────
  it("corrects wrong passageHash", () => {
    const passage = "Some text.";
    const result  = validateAndFilterCandidates(
      [validCandidate({ supportingPassage: passage, passageHash: "wrong" })],
      "org-1", "exec-1", logger,
    );
    expect(result[0]!.passageHash).toBe(sha256(passage));
  });

  // ── 28 ────────────────────────────────────────────────────────────────────
  it("clamps openClawConfidence to [0, 1]", () => {
    const result = validateAndFilterCandidates(
      [validCandidate({ openClawConfidence: 1.5 })],
      "org-1", "exec-1", logger,
    );
    expect(result[0]!.openClawConfidence).toBe(1);
  });

  // ── 29 ────────────────────────────────────────────────────────────────────
  it("stamps organisationId and executionId from params", () => {
    const result = validateAndFilterCandidates(
      [validCandidate({ organisationId: "evil-org", executionId: "evil-exec" })],
      "org-1", "exec-1", logger,
    );
    expect(result[0]!.organisationId).toBe("org-1");
    expect(result[0]!.executionId).toBe("exec-1");
  });

  // ── 30 ────────────────────────────────────────────────────────────────────
  it("generates a fresh discoveryId when absent", () => {
    const c = validCandidate();
    delete (c as Record<string, unknown>)["discoveryId"];
    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result[0]!.discoveryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  // ── 31 ────────────────────────────────────────────────────────────────────
  it("handles empty array input", () => {
    const result = validateAndFilterCandidates([], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });
});

// ─── buildDiscoveryInstruction ────────────────────────────────────────────────

describe("buildDiscoveryInstruction", () => {
  // ── 32 ────────────────────────────────────────────────────────────────────
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
    expect(instruction).toContain("NOT PERMITTED"); // allowExternal: false
    expect(instruction).toContain("See the Escalation Procedure");
    expect(instruction).toContain("Refer to section 4.2");
  });

  // ── 33 ────────────────────────────────────────────────────────────────────
  it("marks external search as PERMITTED when allowExternal=true", () => {
    const instruction = buildDiscoveryInstruction({ ...baseParams(), allowExternal: true });
    expect(instruction).toContain("PERMITTED");
    expect(instruction).not.toContain("NOT PERMITTED");
  });

  // ── 34 ────────────────────────────────────────────────────────────────────
  it("omits unresolved references section when none", () => {
    const instruction = buildDiscoveryInstruction(baseParams());
    expect(instruction).not.toContain("UNRESOLVED REFERENCES");
  });

  // ── 35 ────────────────────────────────────────────────────────────────────
  it("contains prohibition language", () => {
    const instruction = buildDiscoveryInstruction(baseParams());
    expect(instruction).toContain("DO NOT perform professional analysis");
    expect(instruction).toContain("DO NOT fabricate");
  });

  // ── 36 ────────────────────────────────────────────────────────────────────
  it('instructs OpenClaw to return a {"candidates":[...]} JSON object — not streaming events', () => {
    const instruction = buildDiscoveryInstruction(baseParams());
    // Must ask for a plain JSON object with a candidates key
    expect(instruction).toContain('"candidates"');
    // Must NOT instruct it to emit streaming event types that don't exist on this binary
    expect(instruction).not.toContain("discovery_result");
    expect(instruction).not.toContain("--mode rpc");
  });
});
