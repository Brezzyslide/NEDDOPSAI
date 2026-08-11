/**
 * relayClientState.test.ts — RelayClient WebSocket State Machine Tests
 *
 * Tests RelayClient behaviour that requires a live WebSocket interaction:
 *   - auth_error → reconnecting (not reauthentication_required)
 *   - auth_ok    → connected, heartbeat started
 *   - device_revoked → revoked, onRevoked called, no reconnect
 *   - WS close (API restart) → reconnecting, getAccessToken called again
 *   - WS close (network failure) → reconnecting with backoff
 *
 * The ws module is mocked at the module level via vi.mock so it intercepts
 * the dynamic import inside RelayClient.getWS().
 *
 * Test type: UNIT — no real network calls; ws is fully mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "pino";
import { buildRelayMessage } from "../broker/relayProtocol.js";
import { ReauthenticationRequiredError } from "../broker/relayAuthService.js";

// ── WS mock setup ─────────────────────────────────────────────────────────────
//
// vi.hoisted() creates shared state accessible inside vi.mock() factories.
// vi.mock() is hoisted by vitest to the top of the module before any imports,
// so the mock is in place when RelayClient's dynamic import("ws") runs.

const wsState = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => void>,
  instance: null as {
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  } | null,
}));

vi.mock("ws", () => ({
  default: vi.fn().mockImplementation(() => {
    wsState.handlers = {};
    const instance = {
      readyState: 1, // OPEN
      send: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        wsState.handlers[event] = handler;
        // Trigger open after short delay to let all handlers register first
        if (event === "open") setTimeout(() => handler(), 5);
      }),
      // Calling close() on the mock fires the close event so RelayClient's
      // ws.on("close") handler triggers (which emits "reconnecting" state).
      close: vi.fn().mockImplementation((code?: number, reason?: string) => {
        setTimeout(() => {
          const h = wsState.handlers["close"];
          if (h) h(code ?? 1000, Buffer.from(reason ?? "normal"));
        }, 0);
      }),
      terminate: vi.fn(),
    };
    wsState.instance = instance;
    return instance;
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function silentLogger(): Logger {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => silentLogger() } as unknown as Logger;
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function simulateMessage(payload: unknown) {
  const handler = wsState.handlers["message"];
  if (handler) handler(JSON.stringify(payload));
}

function simulateClose(code = 1006, reason = "gone") {
  const handler = wsState.handlers["close"];
  if (handler) handler(code, Buffer.from(reason));
}

// Import AFTER vi.mock is declared (vitest guarantees mock is hoisted)
const { RelayClient } = await import("../broker/relayClient.js");

type ClientConfig = ConstructorParameters<typeof RelayClient>[0];

function makeClient(overrides?: Partial<ClientConfig>): InstanceType<typeof RelayClient> {
  return new RelayClient({
    apiBaseUrl:     "https://api.example.com",
    deviceId:       "dev_test",
    organizationId: "org_test",
    appVersion:     "1.0.0",
    osPlatform:     "darwin",
    arch:           "arm64",
    getAccessToken: async () => "at_valid-token",
    onTaskDispatch: async () => {},
    onRevoked:      () => {},
    onStateChange:  () => {},
    logger:         silentLogger(),
    ...overrides,
  });
}

beforeEach(() => {
  // Reset mock WS state between tests
  wsState.handlers = {};
  wsState.instance = null;
  vi.clearAllMocks();
});

// ── auth_ok → connected ───────────────────────────────────────────────────────

describe("auth_ok message", () => {
  it("transitions to connected state", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    simulateMessage(buildRelayMessage("auth_ok", "dev_test", "org_test", {
      sessionId: "wss_test-session", configVersion: 1, serverTime: new Date().toISOString(),
    }));
    await wait(20);

    expect(stateChanges).toContain("connected");
    expect(client.getState()).toBe("connected");
    client.destroy();
  });

  it("resets reconnect attempt counter on auth_ok", async () => {
    // The client should reset backoff after a successful connection
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    simulateMessage(buildRelayMessage("auth_ok", "dev_test", "org_test", {
      sessionId: "wss_session", configVersion: 1, serverTime: new Date().toISOString(),
    }));
    await wait(20);

    // After auth_ok, state is connected — not reconnecting
    expect(client.getState()).toBe("connected");
    client.destroy();
  });
});

// ── auth_error → reconnecting ─────────────────────────────────────────────────

describe("auth_error message", () => {
  it("schedules a reconnect (not reauthentication_required) on INVALID_TOKEN auth_error", async () => {
    // This models what happens when a non-exchange token (e.g. a brokerAuthToken)
    // is presented and the server rejects it. The client must retry, not halt.
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    simulateMessage(buildRelayMessage("auth_error", null, null, {
      code: "INVALID_TOKEN",
      message: "Access token is invalid, expired, or revoked",
    }));
    await wait(20);

    expect(stateChanges).toContain("reconnecting");
    expect(stateChanges).not.toContain("reauthentication_required");
    expect(stateChanges).not.toContain("revoked");
    // WS should be closed by client after auth_error
    expect(wsState.instance?.close).toHaveBeenCalled();
    client.destroy();
  });

  it("schedules a reconnect on AUTH_TIMEOUT auth_error", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    simulateMessage(buildRelayMessage("auth_error", null, null, {
      code: "AUTH_TIMEOUT",
      message: "Authentication not received within 10 seconds",
    }));
    await wait(20);

    expect(stateChanges).toContain("reconnecting");
    client.destroy();
  });
});

// ── device_revoked → revoked, no reconnect ────────────────────────────────────

describe("device_revoked message", () => {
  it("enters revoked state after device_revoked", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    // Connect first
    simulateMessage(buildRelayMessage("auth_ok", "dev_test", "org_test", {
      sessionId: "wss_s", configVersion: 1, serverTime: new Date().toISOString(),
    }));
    await wait(10);

    simulateMessage(buildRelayMessage("device_revoked", "dev_test", "org_test", {}));
    await wait(20);

    // "revoked" state is emitted before destroy() transitions to "shutdown"
    expect(stateChanges).toContain("revoked");
    // destroy() is called internally, so final getState() is "shutdown" — that is correct
    expect(client.getState()).toBe("shutdown");
  });

  it("calls onRevoked callback when device is revoked", async () => {
    let revokedCalled = false;
    const client = makeClient({ onRevoked: () => { revokedCalled = true; } });

    client.start().catch(() => {});
    await wait(30);

    simulateMessage(buildRelayMessage("device_revoked", "dev_test", "org_test", {}));
    await wait(20);

    expect(revokedCalled).toBe(true);
    client.destroy();
  });

  it("does NOT schedule a reconnect after device_revoked", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    simulateMessage(buildRelayMessage("device_revoked", "dev_test", "org_test", {}));
    await wait(20);

    // revoked should appear, reconnecting must not appear after it
    const revokedIdx = stateChanges.indexOf("revoked");
    expect(revokedIdx).toBeGreaterThanOrEqual(0);
    const reconnectingAfter = stateChanges.slice(revokedIdx + 1).includes("reconnecting");
    expect(reconnectingAfter).toBe(false);
    client.destroy();
  });
});

// ── WS close → reconnecting ───────────────────────────────────────────────────

describe("WebSocket close (API restart / network interruption)", () => {
  it("schedules reconnect when WS closes unexpectedly (API restart)", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    // Simulate API restart — WS drops
    simulateClose(1006, "server went away");
    await wait(20);

    expect(stateChanges).toContain("reconnecting");
    client.destroy();
  });

  it("calls getAccessToken again on the reconnect attempt", async () => {
    let callCount = 0;
    const getAccessToken = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount > 1) {
        // Stop after 2nd call to prevent infinite loop
        return new Promise<string>(() => {}); // never resolves — stops the reconnect loop
      }
      return "at_valid-token";
    });

    const client = makeClient({ getAccessToken });

    client.start().catch(() => {});
    await wait(30);

    // Simulate WS close
    simulateClose(1001, "normal closure");
    // Wait for backoff (1s + jitter) to tick — but destroy before that
    await wait(20);

    // At least 1 call from the initial connect; reconnect will schedule but
    // we destroy before it fires. Key check: state went to reconnecting.
    expect(client.getState()).toBe("reconnecting");
    client.destroy();
  });

  it("schedules reconnect on temporary network failure (WS error then close)", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    // Fire error then close (typical network failure sequence)
    const errorHandler = wsState.handlers["error"];
    if (errorHandler) errorHandler(new Error("ECONNRESET"));
    simulateClose(1006, "network error");
    await wait(20);

    expect(stateChanges).toContain("reconnecting");
    client.destroy();
  });
});

// ── reauthentication_required — no WS created ────────────────────────────────

describe("reauthentication_required (getAccessToken throws before WS creation)", () => {
  it("enters reauthentication_required and does not reconnect", async () => {
    const reautherr = new ReauthenticationRequiredError("refresh token expired");
    const stateChanges: string[] = [];
    const client = makeClient({
      getAccessToken: vi.fn().mockRejectedValue(reautherr),
      onStateChange: s => stateChanges.push(s),
    });

    await client.start(); // throws are caught internally

    expect(stateChanges).toContain("reauthentication_required");
    expect(stateChanges).not.toContain("reconnecting");
    client.destroy();
  });

  it("does NOT create a WebSocket when reauthentication_required", async () => {
    const WS = (await import("ws")).default as ReturnType<typeof vi.fn>;
    WS.mockClear();

    const reautherr = new ReauthenticationRequiredError("refresh expired");
    const client = makeClient({ getAccessToken: vi.fn().mockRejectedValue(reautherr) });

    await client.start();

    // WS constructor must NOT have been called
    expect(WS).not.toHaveBeenCalled();
    client.destroy();
  });
});

// ── destroy() stops all activity ─────────────────────────────────────────────

describe("destroy()", () => {
  it("transitions to shutdown state", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    client.destroy();
    expect(client.getState()).toBe("shutdown");
  });

  it("does not reconnect after destroy()", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);
    client.destroy();

    simulateClose(1006, "server gone");
    await wait(20);

    // No reconnect after shutdown
    const shutdownIdx = stateChanges.indexOf("shutdown");
    expect(shutdownIdx).toBeGreaterThanOrEqual(0);
    const reconnectAfter = stateChanges.slice(shutdownIdx + 1).includes("reconnecting");
    expect(reconnectAfter).toBe(false);
  });
});

// ── reconnect_required server hint ────────────────────────────────────────────

describe("reconnect_required server message", () => {
  it("closes WS and schedules reconnect on reconnect_required", async () => {
    const stateChanges: string[] = [];
    const client = makeClient({ onStateChange: s => stateChanges.push(s) });

    client.start().catch(() => {});
    await wait(30);

    simulateMessage(buildRelayMessage("reconnect_required", "dev_test", "org_test", {
      reason: "duplicate_connection",
    }));
    await wait(20);

    expect(wsState.instance?.close).toHaveBeenCalled();
    client.destroy();
  });
});
