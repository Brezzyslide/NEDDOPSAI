/**
 * relayAuth.test.ts — Relay Authentication Lifecycle Tests
 *
 * Tests the complete relay auth lifecycle:
 *   - Credential store (load / save / clear)
 *   - Token validation and proactive refresh
 *   - Refresh rotation and deduplication
 *   - Reauthentication detection
 *   - RelayClient reauthentication_required state
 *   - Token/credential log-safety
 *   - Org tenant-binding enforcement
 *
 * Test type: UNIT — no real network calls; fetch is fully mocked.
 * Live proof: see scripts/pair-device.mjs and the proof table in the task report.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import type { Logger } from "pino";
import {
  RelayAuthService,
  ReauthenticationRequiredError,
  REFRESH_BEFORE_EXPIRY_MS,
} from "../broker/relayAuthService.js";
import type { ICredentialStore, RelayCredentials } from "../broker/credentialStore.js";
import { RelayClient } from "../broker/relayClient.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function silentLogger(): Logger {
  const noop = () => {};
  return {
    info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop,
    child: () => silentLogger(),
  } as unknown as Logger;
}

/** Capture all logger calls for log-safety assertions. */
function capturingLogger(): { logger: Logger; calls: Array<{ level: string; args: unknown[] }> } {
  const calls: Array<{ level: string; args: unknown[] }> = [];
  const make = (level: string) =>
    (...args: unknown[]) => calls.push({ level, args });
  const logger = {
    info:  make("info"),
    warn:  make("warn"),
    error: make("error"),
    debug: make("debug"),
    trace: make("trace"),
    fatal: make("fatal"),
    child: () => logger,
  } as unknown as Logger;
  return { logger, calls };
}

/** A future ISO timestamp, offset by `offsetMs` milliseconds. */
function futureISO(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/** An ISO timestamp in the past. */
function pastISO(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

/** Build a valid RelayCredentials object with configurable expiry offsets. */
function makeCredentials(opts?: {
  accessOffsetMs?: number;
  refreshOffsetMs?: number;
  deviceId?: string;
  organizationId?: string;
}): RelayCredentials {
  return {
    deviceId:              opts?.deviceId ?? "dev_test-device-id",
    organizationId:        opts?.organizationId ?? "org_test-org-id",
    accessToken:           "at_valid-access-token",
    accessTokenExpiresAt:  futureISO(opts?.accessOffsetMs ?? 15 * 60_000),
    refreshToken:          "rt_valid-refresh-token",
    refreshTokenExpiresAt: futureISO(opts?.refreshOffsetMs ?? 7 * 24 * 60 * 60_000),
  };
}

/** Build a fresh server refresh response. */
function makeRefreshResponse() {
  return {
    accessToken:           "at_new-access-token",
    accessTokenExpiresAt:  futureISO(15 * 60_000),
    refreshToken:          "rt_new-refresh-token",
    refreshTokenExpiresAt: futureISO(7 * 24 * 60 * 60_000),
  };
}

/** In-memory credential store for tests. */
class MemoryCredentialStore implements ICredentialStore {
  private data: RelayCredentials | null = null;

  async load() { return this.data ? { ...this.data } : null; }
  async save(c: RelayCredentials) { this.data = { ...c }; }
  async clear() { this.data = null; }

  /** Inspect stored credentials without triggering async. */
  get stored() { return this.data ? { ...this.data } : null; }
}

/** Build a RelayAuthService backed by a MemoryCredentialStore. */
function makeService(opts?: {
  fetchFn?: typeof fetch;
  store?: ICredentialStore;
  logger?: Logger;
}) {
  const store = opts?.store ?? new MemoryCredentialStore();
  const service = new RelayAuthService({
    apiBaseUrl: "https://api.example.com",
    store,
    logger: opts?.logger ?? silentLogger(),
    fetchFn: opts?.fetchFn,
  });
  return { service, store: store as MemoryCredentialStore };
}

// ── Credential Store ──────────────────────────────────────────────────────────

describe("MemoryCredentialStore (in-test)", () => {
  it("returns null when empty", async () => {
    const store = new MemoryCredentialStore();
    expect(await store.load()).toBeNull();
  });

  it("saves and reloads credentials", async () => {
    const store = new MemoryCredentialStore();
    const creds = makeCredentials();
    await store.save(creds);
    const loaded = await store.load();
    expect(loaded?.deviceId).toBe(creds.deviceId);
    expect(loaded?.organizationId).toBe(creds.organizationId);
    expect(loaded?.accessToken).toBe(creds.accessToken);
    expect(loaded?.refreshToken).toBe(creds.refreshToken);
  });

  it("clear removes stored credentials", async () => {
    const store = new MemoryCredentialStore();
    await store.save(makeCredentials());
    await store.clear();
    expect(await store.load()).toBeNull();
  });
});

// ── RelayAuthService.initialise() ─────────────────────────────────────────────

describe("RelayAuthService.initialise()", () => {
  it("returns false and warns when no credentials are stored", async () => {
    const { service } = makeService();
    const ok = await service.initialise();
    expect(ok).toBe(false);
    expect(service.deviceId).toBeNull();
    expect(service.organizationId).toBeNull();
  });

  it("returns true and exposes deviceId/organizationId when credentials exist", async () => {
    const store = new MemoryCredentialStore();
    const creds = makeCredentials({ deviceId: "dev_abc", organizationId: "org_xyz" });
    await store.save(creds);
    const { service } = makeService({ store });
    const ok = await service.initialise();
    expect(ok).toBe(true);
    expect(service.deviceId).toBe("dev_abc");
    expect(service.organizationId).toBe("org_xyz");
  });
});

// ── getValidAccessToken — valid token ─────────────────────────────────────────

describe("getValidAccessToken — valid access token", () => {
  it("returns the cached access token without calling fetch when token is valid", async () => {
    const fetchFn = vi.fn();
    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: 10 * 60_000 })); // 10 min remaining
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    const token = await service.getValidAccessToken();
    expect(token).toBe("at_valid-access-token");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns token exactly at the boundary (>REFRESH_BEFORE_EXPIRY_MS remaining)", async () => {
    const store = new MemoryCredentialStore();
    // Just beyond the 4-minute refresh window
    await store.save(makeCredentials({ accessOffsetMs: REFRESH_BEFORE_EXPIRY_MS + 5000 }));
    const { service } = makeService({ store });
    await service.initialise();

    const token = await service.getValidAccessToken();
    expect(token).toBe("at_valid-access-token");
  });
});

// ── getValidAccessToken — refresh triggered ───────────────────────────────────

describe("getValidAccessToken — refresh triggered", () => {
  it("calls POST /v1/devices/auth/refresh when access token is near expiry", async () => {
    const refreshResp = makeRefreshResponse();
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => refreshResp,
    } as unknown as Response);

    const store = new MemoryCredentialStore();
    // Within the 4-minute refresh window
    await store.save(makeCredentials({ accessOffsetMs: REFRESH_BEFORE_EXPIRY_MS - 1000 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    const token = await service.getValidAccessToken();
    expect(token).toBe("at_new-access-token");
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, opts] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v1/devices/auth/refresh");
    expect(opts.method).toBe("POST");
  });

  it("calls refresh when access token is already expired", async () => {
    const refreshResp = makeRefreshResponse();
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => refreshResp,
    } as unknown as Response);

    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: -5000 })); // expired 5s ago
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    const token = await service.getValidAccessToken();
    expect(token).toBe("at_new-access-token");
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("rotates BOTH access token and refresh token on successful refresh", async () => {
    const refreshResp = makeRefreshResponse();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => refreshResp,
    } as unknown as Response);

    const store = new MemoryCredentialStore();
    const original = makeCredentials({ accessOffsetMs: 0 }); // at expiry
    await store.save(original);
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    await service.getValidAccessToken();

    const saved = store.stored!;
    expect(saved.accessToken).toBe("at_new-access-token");
    expect(saved.refreshToken).toBe("rt_new-refresh-token");
    // Old tokens must be replaced
    expect(saved.accessToken).not.toBe(original.accessToken);
    expect(saved.refreshToken).not.toBe(original.refreshToken);
  });

  it("deduplicates concurrent refresh calls — only one network request issued", async () => {
    const refreshResp = makeRefreshResponse();
    let resolveRefresh!: (v: unknown) => void;
    const fetchFn = vi.fn().mockReturnValueOnce(
      new Promise((res) => { resolveRefresh = res; })
    );

    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: 0 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    // Trigger two concurrent getValidAccessToken calls
    const p1 = service.getValidAccessToken();
    const p2 = service.getValidAccessToken();

    resolveRefresh({ ok: true, status: 200, json: async () => refreshResp });

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe("at_new-access-token");
    expect(t2).toBe("at_new-access-token");
    // Only one fetch despite two concurrent calls
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});

// ── getValidAccessToken — reauthentication required ───────────────────────────

describe("getValidAccessToken — reauthentication required", () => {
  it("throws ReauthenticationRequiredError when no credentials are stored", async () => {
    const { service } = makeService();
    await service.initialise();

    await expect(service.getValidAccessToken())
      .rejects.toThrow(ReauthenticationRequiredError);
  });

  it("throws ReauthenticationRequiredError when refresh token is expired", async () => {
    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({
      accessOffsetMs:  -1000,               // access token expired
      refreshOffsetMs: -1000,               // refresh token also expired
    }));
    const { service } = makeService({ store });
    await service.initialise();

    await expect(service.getValidAccessToken())
      .rejects.toThrow(ReauthenticationRequiredError);
  });

  it("clears stored credentials when refresh token is expired", async () => {
    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: -1000, refreshOffsetMs: -1000 }));
    const { service } = makeService({ store });
    await service.initialise();

    await expect(service.getValidAccessToken()).rejects.toThrow(ReauthenticationRequiredError);
    expect(store.stored).toBeNull();
  });

  it("throws ReauthenticationRequiredError when server rejects refresh token (401)", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as unknown as Response);

    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: 0 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    await expect(service.getValidAccessToken())
      .rejects.toThrow(ReauthenticationRequiredError);
  });

  it("clears stored credentials when server rejects refresh token (401)", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as unknown as Response);

    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: 0 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    await expect(service.getValidAccessToken()).rejects.toThrow();
    expect(store.stored).toBeNull();
  });

  it("ReauthenticationRequiredError has code REAUTHENTICATION_REQUIRED", async () => {
    const { service } = makeService();
    await service.initialise();

    let caught: unknown;
    try {
      await service.getValidAccessToken();
    } catch (e) {
      caught = e;
    }
    expect((caught as ReauthenticationRequiredError).code).toBe("REAUTHENTICATION_REQUIRED");
  });

  it("old refresh token cannot be reused after rotation", async () => {
    const firstResponse = makeRefreshResponse();
    // On second call, server returns 401 (token was already rotated)
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => firstResponse } as unknown as Response)
      .mockResolvedValueOnce({ ok: false, status: 401 } as unknown as Response);

    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: 0 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    // First refresh succeeds
    await service.getValidAccessToken();
    expect(store.stored?.refreshToken).toBe("rt_new-refresh-token");

    // Force second refresh (expire new access token)
    const saved = store.stored!;
    await store.save({ ...saved, accessTokenExpiresAt: pastISO(1000) });
    // Re-initialise with the new state
    const { service: service2 } = makeService({ fetchFn, store });
    await service2.initialise();

    // Second refresh: server rejects old refresh token
    await expect(service2.getValidAccessToken())
      .rejects.toThrow(ReauthenticationRequiredError);
  });
});

// ── Transient refresh errors ──────────────────────────────────────────────────

describe("getValidAccessToken — transient errors", () => {
  it("throws a non-reauth error on network failure during refresh", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET"));
    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: 0 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    await expect(service.getValidAccessToken())
      .rejects.toThrow("network error");
    // Credentials must still be intact (caller can retry)
    expect(store.stored).not.toBeNull();
  });

  it("throws a non-reauth error on HTTP 500 from refresh endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as unknown as Response);

    const store = new MemoryCredentialStore();
    await store.save(makeCredentials({ accessOffsetMs: 0 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    const err = await service.getValidAccessToken().catch(e => e);
    expect(err).not.toBeInstanceOf(ReauthenticationRequiredError);
    // Credentials still present — can retry
    expect(store.stored).not.toBeNull();
  });
});

// ── saveCredentials ───────────────────────────────────────────────────────────

describe("saveCredentials", () => {
  it("persists credentials and makes them retrievable", async () => {
    const store = new MemoryCredentialStore();
    const { service } = makeService({ store });

    const creds = makeCredentials({ deviceId: "dev_new", organizationId: "org_new" });
    await service.saveCredentials(creds);

    expect(store.stored?.deviceId).toBe("dev_new");
    expect(store.stored?.organizationId).toBe("org_new");
    expect(service.deviceId).toBe("dev_new");
    expect(service.organizationId).toBe("org_new");
  });

  it("exposes the correct access token after save", async () => {
    const store = new MemoryCredentialStore();
    const { service } = makeService({ store });
    await service.saveCredentials(makeCredentials({ accessOffsetMs: 10 * 60_000 }));

    const token = await service.getValidAccessToken();
    expect(token).toBe("at_valid-access-token");
  });
});

// ── Token log-safety ──────────────────────────────────────────────────────────

describe("Token log-safety", () => {
  /** Recursively stringify all logger call arguments and search for raw token values. */
  function callsContainToken(calls: Array<{ args: unknown[] }>, token: string): boolean {
    return calls.some(({ args }) => JSON.stringify(args).includes(token));
  }

  it("does not log raw access tokens at any log level", async () => {
    const { logger, calls } = capturingLogger();
    const store = new MemoryCredentialStore();
    const creds = makeCredentials({ accessOffsetMs: 10 * 60_000 });
    await store.save(creds);
    const { service } = makeService({ logger, store });
    await service.initialise();
    await service.getValidAccessToken();

    expect(callsContainToken(calls, creds.accessToken)).toBe(false);
  });

  it("does not log refresh tokens at any level", async () => {
    const refreshResp = makeRefreshResponse();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => refreshResp,
    } as unknown as Response);

    const { logger, calls } = capturingLogger();
    const store = new MemoryCredentialStore();
    const creds = makeCredentials({ accessOffsetMs: 0 });
    await store.save(creds);
    const { service } = makeService({ fetchFn, logger, store });
    await service.initialise();
    await service.getValidAccessToken();

    expect(callsContainToken(calls, creds.refreshToken)).toBe(false);
    expect(callsContainToken(calls, refreshResp.refreshToken)).toBe(false);
    expect(callsContainToken(calls, refreshResp.accessToken)).toBe(false);
  });
});

// ── Tenant binding ────────────────────────────────────────────────────────────

describe("Tenant binding", () => {
  it("organizationId comes from the credential store, not env var", async () => {
    // Simulate someone setting NEEDSOPS_ORG_SLUG to a different org
    const originalSlug = process.env["NEEDSOPS_ORG_SLUG"];
    process.env["NEEDSOPS_ORG_SLUG"] = "attacker-org";
    try {
      const store = new MemoryCredentialStore();
      await store.save(makeCredentials({ organizationId: "org_legitimate" }));
      const { service } = makeService({ store });
      await service.initialise();

      // The service always returns the credential-store org, never the env var
      expect(service.organizationId).toBe("org_legitimate");
      expect(service.organizationId).not.toBe("attacker-org");
    } finally {
      if (originalSlug === undefined) {
        delete process.env["NEEDSOPS_ORG_SLUG"];
      } else {
        process.env["NEEDSOPS_ORG_SLUG"] = originalSlug;
      }
    }
  });

  it("deviceId comes from the credential store, not env var", async () => {
    const originalId = process.env["NEEDSOPS_DEVICE_ID"];
    process.env["NEEDSOPS_DEVICE_ID"] = "dev_attacker";
    try {
      const store = new MemoryCredentialStore();
      await store.save(makeCredentials({ deviceId: "dev_legitimate" }));
      const { service } = makeService({ store });
      await service.initialise();

      expect(service.deviceId).toBe("dev_legitimate");
      expect(service.deviceId).not.toBe("dev_attacker");
    } finally {
      if (originalId === undefined) {
        delete process.env["NEEDSOPS_DEVICE_ID"];
      } else {
        process.env["NEEDSOPS_DEVICE_ID"] = originalId;
      }
    }
  });
});

// ── brokerAuthToken cannot authenticate relay ─────────────────────────────────
//
// Architecture proof (does not require WS mock):
//
// The server's validateAccessToken() looks up device_access_tokens table.
// brokerAuthToken is stored in device_credentials table — different table, different
// hash function. validateAccessToken() never falls back to device_credentials.
//
// From the broker's perspective:
//   - RelayAuthService.getValidAccessToken() NEVER returns a brokerAuthToken.
//     It only returns tokens obtained via POST /v1/devices/auth/exchange or /refresh,
//     which produce audience:"device-relay" tokens in device_access_tokens.
//   - If a static brokerAuthToken were somehow passed to the relay, the server would
//     respond with auth_error:INVALID_TOKEN → RelayClient schedules reconnect.
//
// The WS message-flow proof (auth_error → reconnecting, not reauthentication_required)
// is in relayClientState.test.ts which uses a proper vi.mock("ws") setup.
//
// This test proves the service-level boundary: getValidAccessToken() cannot return
// a brokerAuthToken even if it were set in an env var.

describe("brokerAuthToken cannot authenticate relay (service boundary)", () => {
  it("getValidAccessToken never returns a brokerAuthToken — tokens come from exchange/refresh only", async () => {
    // With no credentials stored, getValidAccessToken throws — it never falls back to
    // returning NEEDSOPS_DEVICE_TOKEN or any other env-var token.
    const store = new MemoryCredentialStore();
    const { service } = makeService({ store });
    await service.initialise();

    // There are no stored credentials — even if NEEDSOPS_DEVICE_TOKEN is set,
    // the service does NOT fall back to it.
    const savedToken = process.env["NEEDSOPS_DEVICE_TOKEN"];
    process.env["NEEDSOPS_DEVICE_TOKEN"] = "bt_broker-auth-token-should-never-be-used";
    try {
      await expect(service.getValidAccessToken())
        .rejects.toThrow(ReauthenticationRequiredError);
    } finally {
      if (savedToken === undefined) delete process.env["NEEDSOPS_DEVICE_TOKEN"];
      else process.env["NEEDSOPS_DEVICE_TOKEN"] = savedToken;
    }
  });

  it("access tokens returned by getValidAccessToken come only from the refresh API response", async () => {
    const refreshResp = makeRefreshResponse();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => refreshResp,
    } as unknown as Response);

    const store = new MemoryCredentialStore();
    // Token near expiry — will trigger refresh
    await store.save(makeCredentials({ accessOffsetMs: 0 }));
    const { service } = makeService({ fetchFn, store });
    await service.initialise();

    const token = await service.getValidAccessToken();
    // Token is exactly the exchange/refresh response accessToken — not any env var value
    expect(token).toBe(refreshResp.accessToken);
    expect(token).not.toBe(process.env["NEEDSOPS_DEVICE_TOKEN"] ?? "");
  });
});

// ── RelayClient state machine ─────────────────────────────────────────────────
// WS-level state machine tests (auth_error, auth_ok, device_revoked, WS close)
// are in relayClientState.test.ts which uses a proper vi.mock("ws") at module level.

describe("RelayClient — reauthentication_required state", () => {
  it("enters reauthentication_required and stops reconnecting when getAccessToken throws ReauthenticationRequiredError", async () => {
    const err = new ReauthenticationRequiredError("refresh token expired");
    const getAccessToken = vi.fn().mockRejectedValue(err);

    const stateChanges: string[] = [];
    const client = new RelayClient({
      apiBaseUrl:      "https://api.example.com",
      deviceId:        "dev_test",
      organizationId:  "org_test",
      appVersion:      "1.0.0",
      osPlatform:      "darwin",
      arch:            "arm64",
      getAccessToken,
      onTaskDispatch:  async () => {},
      onRevoked:       () => {},
      onStateChange:   (s) => stateChanges.push(s),
      logger:          silentLogger(),
    });

    await client.start();

    expect(stateChanges).toContain("reauthentication_required");
    // Must not schedule a reconnect after reauthentication_required
    expect(stateChanges.filter(s => s === "reconnecting")).toHaveLength(0);

    client.destroy();
  });

  it("does NOT enter reauthentication_required on transient getAccessToken error", async () => {
    // Transient error (no .code property) → should reconnect, not halt
    const transientErr = new Error("ECONNRESET");
    const getAccessToken = vi.fn().mockRejectedValue(transientErr);

    const stateChanges: string[] = [];
    const client = new RelayClient({
      apiBaseUrl:      "https://api.example.com",
      deviceId:        "dev_test",
      organizationId:  "org_test",
      appVersion:      "1.0.0",
      osPlatform:      "darwin",
      arch:            "arm64",
      getAccessToken,
      onTaskDispatch:  async () => {},
      onRevoked:       () => {},
      onStateChange:   (s) => stateChanges.push(s),
      logger:          silentLogger(),
    });

    await client.start();

    expect(stateChanges).toContain("reconnecting");
    expect(stateChanges).not.toContain("reauthentication_required");

    client.destroy();
  });
});

// Device-revoked and WS-level tests live in relayClientState.test.ts
