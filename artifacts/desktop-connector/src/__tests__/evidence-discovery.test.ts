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
 *    25.  Drops candidate with missing supportingPassage AND passageText (fail-closed)
 *    26.  Rejects connectivity_test retrievalMethod
 *    27.  Corrects wrong passageHash — recomputed from normalised passage
 *    28.  Clamps openClawConfidence to [0, 1]
 *    29.  Stamps organisationId and executionId from params
 *    30.  Generates fresh discoveryId when absent
 *    31.  Handles empty array input
 *    42.  Accepts passageText alias when supportingPassage is absent (OpenClaw native naming)
 *    43.  Accepts sourceUri alias when accessLocation is absent (OpenClaw native naming)
 *    44.  Accepts candidate with both OpenClaw-native names (passageText + sourceUri) simultaneously
 *    45.  Rejects candidate where supportingPassage is a schema-template placeholder
 *    46.  Rescues candidate when supportingPassage is placeholder but passageText has real data
 *    47.  Rejects candidate where both supportingPassage and passageText are placeholders
 *    48.  Rejects candidate where neither passage field is present
 *    49.  Rejects candidate where neither accessLocation nor sourceUri is present
 *    50.  Defaults contentType to "unknown" when absent or placeholder
 *    51.  Regression — full spawn path: OpenClaw-native passageText/sourceUri → canonical fields
 *
 *   buildDiscoveryInstruction
 *    32.  Includes all governed parameters
 *    33.  Marks external search as PERMITTED when allowExternal=true
 *    34.  Omits unresolved references section when none
 *    35.  Contains prohibition language (DO NOT fabricate / DO NOT perform analysis)
 *    36.  Instructs OpenClaw to return a { candidates: [...] } JSON object (not events)
 *    38.  Emits SCOPED SEARCH BOUNDARIES block and rule 8 when allowedRoots is non-empty
 *    39.  Lists knownSourcePaths in the boundary block when provided
 *    40.  Emits lightweight SCOPE section (no boundary block) for internal_references_only with no roots/paths
 *    41.  Does NOT emit rule 8 when no scope constraints are provided
 *
 *   Regression fixture (real Mac proof — 2026-08-10)
 *    37.  FATIGUE_MANAGEMENT.md candidate passes validation with retrievalMethod=local_file
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
    allowedRoots:          [] as string[],
    knownSourcePaths:      [] as string[],
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

  // ── 42: OpenClaw passageText alias ────────────────────────────────────────
  it("accepts passageText alias when supportingPassage is absent (OpenClaw native naming)", () => {
    const passage = "Employees must not exceed 12 consecutive working hours.";
    const c = validCandidate({
      passageText: passage,
      // passageHash computed from passageText — broker recomputes anyway
      passageHash: sha256(passage),
    });
    delete (c as Record<string, unknown>)["supportingPassage"];

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(1);
    // supportingPassage in canonical output must equal the passageText value
    expect(result[0]!.supportingPassage).toBe(passage);
  });

  // ── 43: OpenClaw sourceUri alias ──────────────────────────────────────────
  it("accepts sourceUri alias when accessLocation is absent (OpenClaw native naming)", () => {
    const filePath = "/Users/taye/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md";
    const c = validCandidate({ sourceUri: filePath });
    delete (c as Record<string, unknown>)["accessLocation"];

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(1);
    // accessLocation in canonical output must equal the sourceUri value
    expect(result[0]!.accessLocation).toBe(filePath);
  });

  // ── 44: Both OpenClaw-native field names simultaneously ───────────────────
  it("accepts candidate with both passageText and sourceUri — the real OpenClaw output shape", () => {
    const passage  = "Fatigue rest period: minimum 10 hours between shifts.";
    const filePath = "/Users/taye/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md";

    // Simulate the exact OpenClaw output shape: native names only, no canonical aliases
    const openClawCandidate: Record<string, unknown> = {
      sourceTitle:        "Fatigue Management Policy",
      passageText:        passage,      // OpenClaw native — NOT supportingPassage
      sourceUri:          filePath,     // OpenClaw native — NOT accessLocation
      retrievalMethod:    "local_file",
      retrievalTimestamp: "2026-08-10T15:00:00.000Z",
      contentType:        "policy",
      sourceType:         "organisational",
      isExternal:         false,
      discoveryReason:    "File matches search scope",
      openClawConfidence: 0.95,
      relevanceScore:     1.0,
    };

    const result = validateAndFilterCandidates([openClawCandidate], "org-1", "exec-1", logger);
    expect(result).toHaveLength(1);
    expect(result[0]!.supportingPassage).toBe(passage);
    expect(result[0]!.accessLocation).toBe(filePath);
    expect(result[0]!.passageHash).toBe(sha256(passage));
    expect(result[0]!.retrievalMethod).toBe("local_file");
  });

  // ── 45: Schema-template placeholder in supportingPassage → rejected ───────
  it("rejects candidate where supportingPassage is a schema-template placeholder", () => {
    const c = validCandidate({
      supportingPassage: "<verbatim passage from the source — no paraphrase>",
    });
    delete (c as Record<string, unknown>)["passageText"]; // no alias fallback

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  // ── 46: Placeholder in supportingPassage but real data in passageText ──────
  it("rescues candidate when supportingPassage is placeholder but passageText has real data", () => {
    const realPassage = "Rest periods must comply with fatigue management thresholds.";
    const c = validCandidate({
      supportingPassage: "<verbatim passage from the source — no paraphrase>", // placeholder
      passageText:       realPassage,  // real data in OpenClaw native field
    });

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(1);
    expect(result[0]!.supportingPassage).toBe(realPassage);
  });

  // ── 47: Both passage fields are placeholders → rejected ───────────────────
  it("rejects candidate where both supportingPassage and passageText are placeholders (fail-closed)", () => {
    const c = validCandidate({
      supportingPassage: "<verbatim passage from the source — no paraphrase>",
      passageText:       "<text content here>",
    });

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  // ── 48: No passage field at all → rejected (fail-closed) ─────────────────
  it("rejects candidate where neither passage field is present", () => {
    const c = validCandidate();
    delete (c as Record<string, unknown>)["supportingPassage"];
    // no passageText either

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  // ── 49: No location field at all → rejected ───────────────────────────────
  it("rejects candidate where neither accessLocation nor sourceUri is present", () => {
    const c = validCandidate();
    delete (c as Record<string, unknown>)["accessLocation"];
    // no sourceUri either

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(0);
  });

  // ── 50: contentType defaults to "unknown" when absent ─────────────────────
  it('defaults contentType to "unknown" when absent', () => {
    const c = validCandidate();
    delete (c as Record<string, unknown>)["contentType"];

    const result = validateAndFilterCandidates([c], "org-1", "exec-1", logger);
    expect(result).toHaveLength(1);
    expect(result[0]!.contentType).toBe("unknown");
  });
});

// ─── Regression fixture: real Mac proof (2026-08-10) ─────────────────────────
//
// OpenClaw 2026.7.2 proof run on Taye's Mac:
//   Command:  openclaw agent --agent main --message-file <tmpfile> --json
//   Workspace: /Users/tayephilipajao/.openclaw/workspace/rostering/
//   Duration:  19.5 seconds
//   Result:   status "ok", one verbatim passage from FATIGUE_MANAGEMENT.md,
//             zero tool failures.
//
// This test verifies that a candidate matching the proven real output shape
// passes validateAndFilterCandidates without being dropped, and that
// retrievalMethod "local_file" is not treated as synthetic.

describe("Regression fixture — real Mac proof FATIGUE_MANAGEMENT.md", () => {
  const logger = makeLogger();

  // ── 37 ────────────────────────────────────────────────────────────────────
  it("accepts a local_file candidate matching the real Mac OpenClaw result", () => {
    // Passage text modelled on the proven real run output from
    // FATIGUE_MANAGEMENT.md in the rostering workspace.
    const passageText =
      "Rostering staff must ensure minimum rest periods between shifts comply " +
      "with fatigue management thresholds. No employee may work more than " +
      "12 consecutive hours without a minimum 10-hour break.";

    const candidate = validCandidate({
      sourceTitle:        "Fatigue Management Policy",
      supportingPassage:  passageText,
      passageHash:        sha256(passageText),
      retrievalMethod:    "local_file",
      accessLocation:     "/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md",
      sourceType:         "organisational",
      isExternal:         false,
      contentType:        "policy",
      discoveryReason:    "Document directly addresses fatigue management scheduling constraints",
      openClawConfidence: 0.96,
      relevanceScore:     0.91,
    });

    const result = validateAndFilterCandidates([candidate], "org-real", "exec-real", logger);

    // Must not be dropped
    expect(result).toHaveLength(1);

    // retrievalMethod "local_file" must survive — it is NOT synthetic
    expect(result[0]!.retrievalMethod).toBe("local_file");
    expect(result[0]!.accessLocation).toBe(
      "/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md",
    );
    expect(result[0]!.sourceTitle).toBe("Fatigue Management Policy");
    expect(result[0]!.relevanceScore).toBeCloseTo(0.91);
    expect(result[0]!.openClawConfidence).toBeCloseTo(0.96);

    // Tenant fields must be stamped from params
    expect(result[0]!.organisationId).toBe("org-real");
    expect(result[0]!.executionId).toBe("exec-real");
  });

  it("returns openClawStatus available when the real-Mac-shaped payload is emitted via spawn", async () => {
    const { mockSpawn: _mockSpawn } = await import("../broker/routes/evidence.js")
      .then(() => ({ mockSpawn: undefined }))
      .catch(() => ({ mockSpawn: undefined }));
    void _mockSpawn; // unused — we use the already-hoisted mockSpawn at the top of this file

    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const passageText =
      "Rostering staff must ensure minimum rest periods between shifts comply " +
      "with fatigue management thresholds. No employee may work more than " +
      "12 consecutive hours without a minimum 10-hour break.";

    const realMacCandidate: Record<string, unknown> = {
      sourceTitle:        "Fatigue Management Policy",
      supportingPassage:  passageText,
      passageHash:        sha256(passageText),
      retrievalMethod:    "local_file",
      retrievalTimestamp: "2026-08-10T14:33:22.000Z",
      accessLocation:     "/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md",
      sourceType:         "organisational",
      isExternal:         false,
      contentType:        "policy",
      discoveryReason:    "Document directly addresses fatigue management scheduling constraints",
      openClawConfidence: 0.96,
      relevanceScore:     0.91,
    };

    // Matches real OpenClaw output shape: { runId, status:"ok", result:{ payloads:[{ text }] } }
    const params = {
      ...baseParams(),
      allowedRoots:     ["/Users/tayephilipajao/.openclaw/workspace/rostering"],
      knownSourcePaths: [] as string[],
      allowedDiscoveryScope: "internal_references_only",
    };

    const promise = callSpawnDiscover(params, "openclaw", makeLogger());
    proc.stdout.emit("data", makeOpenClawOutput([realMacCandidate], { runId: "run-mac-proof-001" }));
    proc.emit("exit", 0, null);

    const result = await promise;

    expect(result.openClawStatus).toBe("available");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.retrievalMethod).toBe("local_file");
    expect(result.candidates[0]!.sourceTitle).toBe("Fatigue Management Policy");
    expect(result.candidates[0]!.accessLocation).toContain("FATIGUE_MANAGEMENT.md");
  });

  // ── 51: Regression — full spawn path with real OpenClaw-native field names ─
  //
  // This is the exact scenario that surfaced in live testing (2026-08-10):
  // OpenClaw returned passageText and sourceUri instead of the canonical
  // supportingPassage / accessLocation names.  The candidate appeared in the
  // broker response with sourceUri:null and passageText:null because those
  // fields were not mapped.  This test confirms the full path now works.
  it("51 — full spawn path: OpenClaw passageText/sourceUri → canonical supportingPassage/accessLocation", async () => {
    const proc = makeFakeProcess();
    mockSpawn.mockReturnValue(proc);

    const realPassage = "Employees assigned to rostering duties must not schedule shifts that " +
      "violate the minimum 10-hour rest period mandated by the Fatigue Management Policy.";
    const realPath    = "/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md";

    // OpenClaw native output — uses passageText and sourceUri, not our canonical names
    const openClawNativeCandidate: Record<string, unknown> = {
      sourceTitle:        "Fatigue Management",     // OpenClaw shortened the title
      passageText:        realPassage,              // ← OpenClaw native, not supportingPassage
      sourceUri:          realPath,                 // ← OpenClaw native, not accessLocation
      retrievalMethod:    "local_file",
      retrievalTimestamp: "2026-08-10T15:22:05.000Z",
      contentType:        "policy",
      sourceType:         "organisational",
      isExternal:         false,
      discoveryReason:    "File path matched knownSourcePaths scope",
      openClawConfidence: 0.97,
      relevanceScore:     1.0,
      // No supportingPassage, no accessLocation, no passageHash — just like the real run
    };

    const params = {
      ...baseParams(),
      allowedRoots:          ["/Users/tayephilipajao/.openclaw/workspace/rostering"],
      knownSourcePaths:      [realPath],
      allowedDiscoveryScope: "internal_references_only",
    };

    const promise = callSpawnDiscover(params, "openclaw", makeLogger());
    proc.stdout.emit("data", makeOpenClawOutput([openClawNativeCandidate], { runId: "run-mac-alias-001" }));
    proc.emit("exit", 0, null);

    const result = await promise;

    // Broker must reach openClawStatus:available and return exactly one candidate
    expect(result.openClawStatus).toBe("available");
    expect(result.candidates).toHaveLength(1);

    const candidate = result.candidates[0]!;

    // passageText must be normalised into supportingPassage
    expect(candidate.supportingPassage).toBe(realPassage);
    // sourceUri must be normalised into accessLocation
    expect(candidate.accessLocation).toBe(realPath);
    // passageHash must be recomputed from the normalised passage
    expect(candidate.passageHash).toBe(sha256(realPassage));
    // Other fields carried through unchanged
    expect(candidate.sourceTitle).toBe("Fatigue Management");
    expect(candidate.retrievalMethod).toBe("local_file");
    expect(candidate.relevanceScore).toBeCloseTo(1.0);
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

  // ── 38 ────────────────────────────────────────────────────────────────────
  it("emits SCOPED SEARCH BOUNDARIES block and rule 8 when allowedRoots is non-empty", () => {
    const params = {
      ...baseParams(),
      allowedRoots: ["/Users/tayephilipajao/.openclaw/workspace/rostering"],
    };
    const instruction = buildDiscoveryInstruction(params);

    expect(instruction).toContain("SCOPED SEARCH BOUNDARIES");
    expect(instruction).toContain("ALLOWED ROOTS");
    expect(instruction).toContain("/Users/tayephilipajao/.openclaw/workspace/rostering");
    // Rule 8 must appear only when scoped
    expect(instruction).toContain("Only access files within the SCOPED SEARCH BOUNDARIES");
  });

  // ── 39 ────────────────────────────────────────────────────────────────────
  it("lists knownSourcePaths in the boundary block when provided", () => {
    const params = {
      ...baseParams(),
      allowedRoots:     ["/Users/tayephilipajao/.openclaw/workspace/rostering"],
      knownSourcePaths: [
        "/Users/tayephilipajao/.openclaw/workspace/rostering/FATIGUE_MANAGEMENT.md",
        "/Users/tayephilipajao/.openclaw/workspace/rostering/ROSTERING_POLICY.md",
      ],
    };
    const instruction = buildDiscoveryInstruction(params);

    expect(instruction).toContain("KNOWN SOURCE PATHS");
    expect(instruction).toContain("FATIGUE_MANAGEMENT.md");
    expect(instruction).toContain("ROSTERING_POLICY.md");
  });

  // ── 40 ────────────────────────────────────────────────────────────────────
  it("emits lightweight SCOPE section (no boundary block) for internal_references_only with no roots/paths", () => {
    const params = {
      ...baseParams(),
      allowedDiscoveryScope: "internal_references_only",
      allowedRoots:          [] as string[],
      knownSourcePaths:      [] as string[],
    };
    const instruction = buildDiscoveryInstruction(params);

    expect(instruction).toContain("INTERNAL ONLY");
    // No scoped boundary block when no roots/paths provided
    expect(instruction).not.toContain("SCOPED SEARCH BOUNDARIES");
    expect(instruction).not.toContain("ALLOWED ROOTS");
  });

  // ── 41 ────────────────────────────────────────────────────────────────────
  it("does NOT emit rule 8 or boundary block when no scope constraints are provided", () => {
    const instruction = buildDiscoveryInstruction(baseParams()); // no roots, no paths
    expect(instruction).not.toContain("SCOPED SEARCH BOUNDARIES");
    expect(instruction).not.toContain("Only access files within the SCOPED SEARCH BOUNDARIES");
    expect(instruction).not.toContain("ALLOWED ROOTS");
  });
});
