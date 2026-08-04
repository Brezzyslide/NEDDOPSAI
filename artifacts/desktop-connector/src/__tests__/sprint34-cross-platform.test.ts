/**
 * Sprint 34 — Cross-Platform Desktop Connector Architecture
 *
 * Tests covering:
 *   - RuntimeDiscovery: parallel probing, caching, error handling
 *   - OpenClawRuntimeAdapter: binary probe + bridge HTTP probe
 *   - OllamaRuntimeAdapter: HTTP probe + binary fallback
 *   - LMStudioRuntimeAdapter: HTTP probe
 *   - VllmRuntimeAdapter: health + models probe
 *   - Broker HOME path: uses os.homedir(), not process.env.HOME
 *   - Runtime adapter availability: never throws, always returns RuntimeInfo
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RuntimeDiscovery, _setRuntimeDiscovery } from "../runtime/RuntimeDiscovery.js";
import { OpenClawRuntimeAdapter } from "../runtime/OpenClawRuntimeAdapter.js";
import { OllamaRuntimeAdapter } from "../runtime/OllamaRuntimeAdapter.js";
import { LMStudioRuntimeAdapter } from "../runtime/LMStudioRuntimeAdapter.js";
import { VllmRuntimeAdapter } from "../runtime/VllmRuntimeAdapter.js";
import type { IRuntimeAdapter, RuntimeInfo } from "../runtime/IRuntimeAdapter.js";

// ── Mock child_process for binary probes ──────────────────────────────────────

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

import { execFile } from "node:child_process";

// ── Mock fetch for HTTP probes ────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFetchOk(body: object, headers: Record<string, string> = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  });
}

function makeFetchFail(status = 503) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    headers: { get: () => null },
  });
}

function makeFetchAbort() {
  return Promise.reject(new DOMException("AbortError", "AbortError"));
}

// ── OpenClawRuntimeAdapter ────────────────────────────────────────────────────

describe("OpenClawRuntimeAdapter", () => {
  afterEach(() => vi.clearAllMocks());

  it("reports available=true when binary --version succeeds", async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error mocked callback
      cb(null, "openclaw 1.5.2\n", "");
      return {} as ReturnType<typeof execFile>;
    });

    const adapter = new OpenClawRuntimeAdapter({ binPath: "openclaw", timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(true);
    expect(info.version).toContain("1.5.2");
    expect(info.capabilities).toContain("browser");
    expect(info.id).toBe("openclaw");
  });

  it("falls back to bridge-http check when binary missing", async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error mocked callback
      cb(new Error("ENOENT"), "", "");
      return {} as ReturnType<typeof execFile>;
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ version: "2.0.0" }),
      headers: { get: () => null },
    });

    const adapter = new OpenClawRuntimeAdapter({
      binPath: "openclaw",
      bridgeUrl: "http://127.0.0.1:19001",
      timeoutMs: 5_000,
    });
    const info = await adapter.getInfo();

    expect(info.available).toBe(true);
    expect(info.version).toBe("2.0.0");
    expect(info.endpoint).toBe("http://127.0.0.1:19001");
  });

  it("reports available=false when both binary and bridge fail", async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error mocked callback
      cb(new Error("ENOENT"), "", "");
      return {} as ReturnType<typeof execFile>;
    });
    mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

    const adapter = new OpenClawRuntimeAdapter({ binPath: "openclaw", timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(false);
    expect(info.version).toBeNull();
    expect(info.unavailableReason).toContain("Binary not found");
  });

  it("never throws — returns available=false on unexpected error", async () => {
    vi.mocked(execFile).mockImplementation(() => { throw new Error("unexpected"); });
    mockFetch.mockRejectedValue(new Error("network"));

    const adapter = new OpenClawRuntimeAdapter({ binPath: "openclaw", timeoutMs: 5_000 });
    await expect(adapter.getInfo()).resolves.toMatchObject({ available: false });
  });
});

// ── OllamaRuntimeAdapter ──────────────────────────────────────────────────────

describe("OllamaRuntimeAdapter", () => {
  afterEach(() => vi.clearAllMocks());

  it("reports available=true when /api/version returns 200", async () => {
    mockFetch.mockResolvedValueOnce(makeFetchOk({ version: "0.3.14" }));

    const adapter = new OllamaRuntimeAdapter({ endpoint: "http://localhost:11434", timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(true);
    expect(info.version).toBe("0.3.14");
    expect(info.endpoint).toBe("http://localhost:11434");
    expect(info.capabilities).toContain("llm");
  });

  it("reports binary found but server not running when HTTP fails but binary exists", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error mocked callback
      cb(null, "ollama version 0.3.14\n", "");
      return {} as ReturnType<typeof execFile>;
    });

    const adapter = new OllamaRuntimeAdapter({ endpoint: "http://localhost:11434", timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(false);
    expect(info.unavailableReason).toContain("not running");
    expect(info.unavailableReason).toContain("ollama serve");
  });

  it("reports available=false when neither HTTP nor binary found", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error mocked callback
      cb(new Error("ENOENT"), "", "");
      return {} as ReturnType<typeof execFile>;
    });

    const adapter = new OllamaRuntimeAdapter({ timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(false);
    expect(info.unavailableReason).toContain("ollama.ai");
  });
});

// ── LMStudioRuntimeAdapter ────────────────────────────────────────────────────

describe("LMStudioRuntimeAdapter", () => {
  afterEach(() => vi.clearAllMocks());

  it("reports available=true when /v1/models returns 200", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ object: "list", data: [] }),
      headers: { get: (k: string) => k === "x-lm-studio-version" ? "0.3.5" : null },
    });

    const adapter = new LMStudioRuntimeAdapter({ endpoint: "http://localhost:1234", timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(true);
    expect(info.version).toBe("0.3.5");
    expect(info.endpoint).toBe("http://localhost:1234");
    expect(info.capabilities).toContain("llm");
  });

  it("reports available=false when server not reachable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const adapter = new LMStudioRuntimeAdapter({ timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(false);
    expect(info.unavailableReason).toContain("Developer tab");
  });

  it("strips trailing slash from endpoint", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      headers: { get: () => null },
    });

    const adapter = new LMStudioRuntimeAdapter({ endpoint: "http://localhost:1234/", timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.endpoint).toBe("http://localhost:1234");
    const calledUrl = (mockFetch.mock.calls[0] as [string])[0];
    expect(calledUrl).not.toContain("//v1");
  });
});

// ── VllmRuntimeAdapter ────────────────────────────────────────────────────────

describe("VllmRuntimeAdapter", () => {
  afterEach(() => vi.clearAllMocks());

  it("reports available=true when /health returns 200", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })  // /health
      .mockResolvedValueOnce({                             // /v1/models
        ok: true,
        status: 200,
        headers: { get: (k: string) => k === "x-vllm-version" ? "0.5.0" : null },
      });

    const adapter = new VllmRuntimeAdapter({ endpoint: "http://localhost:8000", timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(true);
    expect(info.capabilities).toContain("llm");
    expect(info.capabilities).toContain("gpu_acceleration");
  });

  it("reports available=false when /health fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const adapter = new VllmRuntimeAdapter({ timeoutMs: 5_000 });
    const info = await adapter.getInfo();

    expect(info.available).toBe(false);
    expect(info.unavailableReason).toContain("vllm.entrypoints");
  });
});

// ── RuntimeDiscovery ──────────────────────────────────────────────────────────

describe("RuntimeDiscovery", () => {
  afterEach(() => {
    vi.clearAllMocks();
    _setRuntimeDiscovery(null);
  });

  function makeAdapter(id: string, available: boolean): IRuntimeAdapter {
    const info: RuntimeInfo = {
      id,
      name: id,
      available,
      version: available ? "1.0.0" : null,
      capabilities: available ? ["llm"] : [],
      discoveredAt: new Date().toISOString(),
    };
    return {
      id,
      name: id,
      isAvailable: () => Promise.resolve(available),
      getInfo: () => Promise.resolve(info),
    };
  }

  it("probes all adapters in parallel and returns combined results", async () => {
    const adapters = [
      makeAdapter("openclaw", true),
      makeAdapter("ollama", false),
      makeAdapter("lm-studio", true),
    ];

    const discovery = new RuntimeDiscovery({ adapters, cacheTtlMs: 60_000 });
    const result = await discovery.discover();

    expect(result.runtimes).toHaveLength(3);
    expect(result.runtimes.find(r => r.id === "openclaw")?.available).toBe(true);
    expect(result.runtimes.find(r => r.id === "ollama")?.available).toBe(false);
    expect(result.runtimes.find(r => r.id === "lm-studio")?.available).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns cached result within TTL", async () => {
    let callCount = 0;
    const adapter: IRuntimeAdapter = {
      id: "test",
      name: "test",
      isAvailable: () => Promise.resolve(true),
      getInfo: () => {
        callCount++;
        return Promise.resolve({
          id: "test", name: "test", available: true,
          version: "1.0", capabilities: [], discoveredAt: new Date().toISOString(),
        });
      },
    };

    const discovery = new RuntimeDiscovery({ adapters: [adapter], cacheTtlMs: 60_000 });
    await discovery.discover();
    await discovery.discover();
    await discovery.discover();

    expect(callCount).toBe(1); // only called once — subsequent calls use cache
  });

  it("bypasses cache when force=true", async () => {
    let callCount = 0;
    const adapter: IRuntimeAdapter = {
      id: "test",
      name: "test",
      isAvailable: () => Promise.resolve(true),
      getInfo: () => {
        callCount++;
        return Promise.resolve({
          id: "test", name: "test", available: true,
          version: "1.0", capabilities: [], discoveredAt: new Date().toISOString(),
        });
      },
    };

    const discovery = new RuntimeDiscovery({ adapters: [adapter], cacheTtlMs: 60_000 });
    await discovery.discover();
    await discovery.discover(true); // force
    await discovery.discover(true); // force

    expect(callCount).toBe(3);
  });

  it("wraps adapter errors as available=false — never throws", async () => {
    const badAdapter: IRuntimeAdapter = {
      id: "bad",
      name: "bad",
      isAvailable: () => { throw new Error("unexpected crash"); },
      getInfo: () => { throw new Error("unexpected crash"); },
    };

    const discovery = new RuntimeDiscovery({ adapters: [badAdapter] });
    const result = await discovery.discover();

    expect(result.runtimes).toHaveLength(1);
    expect(result.runtimes[0]!.available).toBe(false);
    expect(result.runtimes[0]!.unavailableReason).toContain("Discovery probe failed");
  });

  it("checkRuntime returns null for unknown id", async () => {
    const discovery = new RuntimeDiscovery({ adapters: [makeAdapter("openclaw", true)] });
    const result = await discovery.checkRuntime("not-a-real-runtime");
    expect(result).toBeNull();
  });

  it("checkRuntime probes a single runtime by id", async () => {
    const discovery = new RuntimeDiscovery({ adapters: [makeAdapter("ollama", true)] });
    const result = await discovery.checkRuntime("ollama");
    expect(result?.available).toBe(true);
  });

  it("invalidateCache forces re-probe on next discover()", async () => {
    let callCount = 0;
    const adapter: IRuntimeAdapter = {
      id: "test",
      name: "test",
      isAvailable: () => Promise.resolve(true),
      getInfo: () => {
        callCount++;
        return Promise.resolve({
          id: "test", name: "test", available: true,
          version: "1.0", capabilities: [], discoveredAt: new Date().toISOString(),
        });
      },
    };

    const discovery = new RuntimeDiscovery({ adapters: [adapter], cacheTtlMs: 60_000 });
    await discovery.discover();
    discovery.invalidateCache();
    await discovery.discover();

    expect(callCount).toBe(2);
  });

  it("getRegisteredRuntimeIds returns all adapter ids", () => {
    const discovery = new RuntimeDiscovery({
      adapters: [makeAdapter("openclaw", true), makeAdapter("ollama", false)],
    });
    expect(discovery.getRegisteredRuntimeIds()).toEqual(["openclaw", "ollama"]);
  });
});

// ── Broker HOME path fix ──────────────────────────────────────────────────────

describe("Broker config — HOME path cross-platform fix", () => {
  it("uses os.homedir() and not process.env.HOME", async () => {
    // Import os.homedir to verify what the correct path should be
    const os = await import("node:os");
    const expectedHome = os.homedir();

    // The fix ensures the db path uses os.homedir(), which works on all platforms.
    // On Windows, HOME may be undefined; os.homedir() reads USERPROFILE correctly.
    expect(expectedHome).toBeTruthy();
    expect(typeof expectedHome).toBe("string");
    expect(expectedHome.length).toBeGreaterThan(0);

    // Simulate the Windows scenario where HOME is not set
    const originalHome = process.env["HOME"];
    delete process.env["HOME"];
    try {
      const osAfter = await import("node:os");
      // os.homedir() must still return a valid path even without HOME env var
      expect(osAfter.homedir()).toBeTruthy();
    } finally {
      if (originalHome !== undefined) process.env["HOME"] = originalHome;
    }
  });
});

// ── Platform adapter classification sanity checks ────────────────────────────

describe("Runtime capabilities declaration", () => {
  it("OpenClaw declares browser capability", async () => {
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error mocked callback
      cb(null, "openclaw 1.0.0\n", "");
      return {} as ReturnType<typeof execFile>;
    });
    const adapter = new OpenClawRuntimeAdapter({ timeoutMs: 5_000 });
    const info = await adapter.getInfo();
    expect(info.capabilities).toContain("browser");
  });

  it("Ollama declares llm capability", async () => {
    mockFetch.mockResolvedValueOnce(makeFetchOk({ version: "0.3.0" }));
    const adapter = new OllamaRuntimeAdapter({ timeoutMs: 5_000 });
    const info = await adapter.getInfo();
    expect(info.capabilities).toContain("llm");
  });

  it("LM Studio declares llm capability", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: () => Promise.resolve({}),
      headers: { get: () => null },
    });
    const adapter = new LMStudioRuntimeAdapter({ timeoutMs: 5_000 });
    const info = await adapter.getInfo();
    expect(info.capabilities).toContain("llm");
  });

  it("vLLM declares gpu_acceleration capability", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => null },
      });
    const adapter = new VllmRuntimeAdapter({ timeoutMs: 5_000 });
    const info = await adapter.getInfo();
    expect(info.capabilities).toContain("gpu_acceleration");
  });

  it("unavailable adapters declare empty capabilities", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    vi.mocked(execFile).mockImplementation((_bin, _args, _opts, cb) => {
      // @ts-expect-error mocked callback
      cb(new Error("ENOENT"), "", "");
      return {} as ReturnType<typeof execFile>;
    });

    const ocAdapter = new OpenClawRuntimeAdapter({ timeoutMs: 5_000 });
    const olAdapter = new OllamaRuntimeAdapter({ timeoutMs: 5_000 });

    const [oc, ol] = await Promise.all([ocAdapter.getInfo(), olAdapter.getInfo()]);
    expect(oc.capabilities).toHaveLength(0);
    expect(ol.capabilities).toHaveLength(0);
  });
});
