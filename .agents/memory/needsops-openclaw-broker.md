---
name: NeedsOps OpenClaw Runtime Broker
description: Phase 3 + Phase 4 — broker inside artifacts/desktop-connector, LiveGatewayAdapter transport modes, test patterns
---

## Runtime Broker location

`artifacts/desktop-connector/` — Mac-side Express HTTP server, port 19002 (Cloudflare tunnel only, never 19001/19011).

## IGatewayAdapter interface (frozen)

`artifacts/desktop-connector/src/broker/types.ts` — all adapters must implement:
- `healthCheck()`, `submit()`, `getStatus()`, `cancel()`, `pause()`, `resume()`
- Both adapters also implement `destroy()` (not on interface — duck-typed in index.ts shutdown)

## Adapter implementations

`artifacts/desktop-connector/src/broker/gatewayAdapter.ts`

**SimulatedGatewayAdapter** — tests only. In-process state machine (queued → running → completed). `transitionDelayMs` + `runDurationMs` config. Call `destroy()` after each test or on shutdown.

**LiveGatewayAdapter** — Phase 4. Two sub-modes:

### spawn mode (default, `OPENCLAW_LIVE_MODE=spawn`)
- `spawn("openclaw", ["agent", "--mode", "rpc", "--json"])` — one process per execution
- Discovered from: `openclaw/package.json` bin + `scripts.openclaw:rpc`
- JSON lines on stdin/stdout
- **DO NOT call `proc.stdin.end()` after the initial request** — keep stdin open so `pause()`, `resume()`, `cancel()` can send control messages. `_closeSpawnStdin()` called from `_setStatus()` on terminal states.
- Event normalisation: handles both `type` and `event` field names; aliases: started/running/begin → running; completed/done/success/finish → completed; failed/error/failure → failed; cancelled/aborted/abort → cancelled
- Process exit fallback: exit 0 → completed, SIGTERM/SIGKILL → cancelled, non-zero → failed

### bridge-http mode (`OPENCLAW_LIVE_MODE=bridge-http`)
- Connects to OpenClaw browser bridge at `OPENCLAW_GATEWAY_URL` (default `http://127.0.0.1:19001`)
- Discovered from: `extensions/browser/src/browser/bridge-server.ts`
- Routes: `GET /basic` (health), `POST /agent/act` (submit), `GET /agent/snapshot` (poll), `POST /agent/act/hooks` (cancel/abort)
- **pause and resume NOT supported** in bridge-http — throws "not supported in bridge-http mode"
- Polls every `initialPollDelayMs` (default 2000ms), exponential backoff to 10s

## Factory

```typescript
createGatewayAdapter(mode, { gatewayUrl, liveMode, openclawBin, gatewayTimeoutMs }, onStatusChange)
```

`index.ts` shutdown uses duck-typing: `if ("destroy" in gateway) gateway.destroy()`

## New config fields (Phase 4)

`BrokerConfig` now includes: `liveMode`, `openclawBin`, `gatewayTimeoutMs` — all read by `loadBrokerConfig()`.

`loadBrokerConfig()` defaults: `OPENCLAW_LIVE_MODE=spawn`, `OPENCLAW_BIN_PATH=openclaw`, `OPENCLAW_GATEWAY_TIMEOUT_MS=30000`.

## Test patterns

**Spawn tests** — mock `node:child_process` with `vi.mock`. Create fake process using PassThrough streams + EventEmitter. Spy on `fakeProc.stdin.write` (not reading from stream after end — stream is kept open now).

**Bridge-http tests** — `vi.stubGlobal("fetch", vi.fn())`. Polling tests: pass `initialPollDelayMs: 50` to `LiveAdapterConfig` and wait `300ms` in the test.

**`initialPollDelayMs`** is a `LiveAdapterConfig` field (not on `BrokerConfig`). Override in tests; production gets the 2000ms default.

## Test counts

Phase 3 completed: 102 broker tests  
Phase 4 added: 41 new `liveAdapter.test.ts` tests  
**Total broker tests: 143/143 passing**  
**Total project tests: 1339 (api-server) + 143 (broker) = 1482**

## Env vars

See `artifacts/desktop-connector/.env.example` for the full runbook.
Key: `BROKER_PORT=19002`, `OPENCLAW_GATEWAY_MODE=live`, `OPENCLAW_LIVE_MODE=spawn|bridge-http`, `OPENCLAW_BIN_PATH`, `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TIMEOUT_MS`.

## What remains before production live execution

- Validate actual `openclaw agent --mode rpc --json` JSON event field names against a real binary
- Confirm `/agent/snapshot?sessionId=...` query param name vs body param in bridge-http mode
- Confirm `/agent/act/hooks` abort payload shape
- Cloudflare tunnel setup on the operator's Mac
