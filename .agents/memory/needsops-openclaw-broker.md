---
name: NeedsOps OpenClaw Runtime Broker
description: Runtime Broker implementation inside artifacts/desktop-connector — architecture, constraints, and Phase 4 gateway adapter pending state
---

# NeedsOps OpenClaw Runtime Broker

## What was built

`artifacts/desktop-connector` was transformed from a Sprint 0 heartbeat shell into a full Runtime Broker:

- Express HTTP server on `BROKER_PORT` (default 19002)
- Bearer-token auth (`BROKER_AUTH_TOKEN`) with constant-time comparison
- 6 routes matching `RuntimeBrokerClient` in `lib/openclaw/src/runtimeBrokerClient.ts`
- Zod package validation: UUID, expiry, HTTPS (prod), private-network callback blocking
- SQLite persistence via `better-sqlite3` at `~/needsops-broker.db` (`:memory:` in tests)
- `SimulatedGatewayAdapter` — state machine (queued→running→completed) used by all automated tests
- `WebhookDeliveryWorker` — HMAC-SHA256 signed, exponential backoff, 5 attempts max
- Stale execution cleanup loop (marks timed_out for expired packages)
- 102 automated tests (6 files, all passing)

## Architecture rule

The Runtime Broker runs on the Mac (NOT in Replit). Only `BROKER_PORT` (19002) is tunneled via Cloudflare Tunnel. Ports 19001 and 19011 are NEVER exposed.

```
Replit → OPENCLAW_RUNTIME_URL (tunnel) → Mac broker :19002 → IGatewayAdapter → OpenClaw :19001
```

## IGatewayAdapter interface (frozen)

All gateway interaction goes through `IGatewayAdapter` in `artifacts/desktop-connector/src/broker/gatewayAdapter.ts`. Two implementations:
- `SimulatedGatewayAdapter` — for automated tests, no OpenClaw needed
- `LiveGatewayAdapter` — throws "not implemented" until Phase 4

Swap by setting `OPENCLAW_GATEWAY_MODE=live`.

## Phase 4 blocker

`LiveGatewayAdapter` is a stub. Before implementing it, the operator must run:

```bash
cd /Users/tayephilipajao/Development/needsops-browser/OpenClaw-NeedsOps
node /path/to/needsops-repo/scripts/inspect-openclaw.mjs
```

The script writes `openclaw-inspection-report.json` and prints a paste-ready summary. Paste back to get the real gateway adapter implemented (HTTP, WebSocket, CLI spawn, or RPC — unknown until inspection).

## Environment variables (two sides)

**Replit secrets:**
- `OPENCLAW_RUNTIME_URL` — Cloudflare tunnel URL pointing to Mac broker
- `OPENCLAW_AUTH_TOKEN_REF=OPENCLAW_AUTH_TOKEN` — env var name holding the token
- `OPENCLAW_AUTH_TOKEN` — actual bearer token (must match `BROKER_AUTH_TOKEN` on Mac)
- `OPENCLAW_WEBHOOK_SECRET` — HMAC secret (must match broker's `OPENCLAW_WEBHOOK_SECRET`)
- `OPENCLAW_CALLBACK_BASE_URL` — Replit dev domain for webhook callbacks

**Mac broker `.env`:**
- `BROKER_PORT=19002`
- `BROKER_AUTH_TOKEN` — must equal `OPENCLAW_AUTH_TOKEN` in Replit
- `OPENCLAW_WEBHOOK_SECRET` — must equal Replit's `OPENCLAW_WEBHOOK_SECRET`
- `OPENCLAW_GATEWAY_MODE=simulated` (change to `live` after Phase 4)
- `OPENCLAW_GATEWAY_URL=http://127.0.0.1:19001`

## better-sqlite3 requires build approval

`pnpm-workspace.yaml` `onlyBuiltDependencies` must include `better-sqlite3` or the native module won't compile. Already added.

**Why:** better-sqlite3 is a native Node addon (C++) and requires `node-gyp` compilation at install time. pnpm's security model requires explicit approval.

## Test count

- Before this sprint: 1339 (api-server tests only)
- After: 1441 (1339 api-server + 102 desktop-connector)
