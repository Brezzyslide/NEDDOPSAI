---
name: NeedsOps Sprint 29O.1 — Mac OpenClaw Connectivity
description: Evidence discovery endpoint on the Mac broker, Replit client method, CloudOpenClawDiscoveryAdapter, orchestrator wiring.
---

## What was built

**Mac broker** (`artifacts/desktop-connector/src/broker/routes/evidence.ts`):
- `POST /v1/evidence/discover` — authenticated via existing Bearer middleware
- Validates governed contract fields; caps timeoutMs/hops/sources/passages
- In live mode: calls `POST /agent/discover` on the local OpenClaw bridge URL
- When OpenClaw returns nothing: returns a synthetic test candidate (labelled as fixture)
- Mounted under `auth` middleware in `server.ts`

**Replit client** (`lib/openclaw/src/runtimeBrokerClient.ts`):
- `discoverEvidence(request: BrokerEvidenceDiscoveryRequest): Promise<BrokerEvidenceDiscoveryResponse>`
- Posts to `/v1/evidence/discover` on the broker
- Non-fatal failure — returns empty response (never throws)
- Types added to `lib/openclaw/src/types.ts` and exported from `index.ts`

**Cloud adapter** (`artifacts/api-server/src/lib/evidenceDiscovery/CloudOpenClawDiscoveryAdapter.ts`):
- Implements `IEvidenceDiscoveryAdapter`
- `isAvailable()` returns `true` only when `state === "connected"` (health check confirmed, not just "connecting")
- Maps `BrokerCandidateEvidence` → `CandidateEvidence` (narrows sourceType/authorityType)
- Singleton `cloudOpenClawDiscoveryAdapter` exported

**Orchestrator** (`artifacts/api-server/src/lib/evidenceDiscovery/discoveryOrchestrator.ts`):
- `REGISTERED_ADAPTERS` constant removed; replaced with `getRegisteredAdapters()` function
- `selectAdapter` falls back to `nullDiscoveryAdapter` (not `adapters[0]`) when nothing available
- `cloudOpenClawDiscoveryAdapter` registered before `nullDiscoveryAdapter`

## Critical rules

- `isAvailable()` MUST require `state === "connected"`, not "connecting" — otherwise tests fail because the adapter name leaks into results even when broker is unreachable.
- `selectAdapter` fallback MUST be `nullDiscoveryAdapter` explicitly — NOT `adapters[0]` — because `adapters[0]` is now `cloudOpenClawDiscoveryAdapter` and tests check for `"null_no_runtime"` adapter name on unavailable path.
- `IGatewayAdapter` lives in `broker/types.ts`, NOT `broker/gatewayAdapter.ts` (pre-existing TS error in existing routes is left as-is).
- `config.gatewayUrl` is `string | null` in `BrokerConfig` — must guard before calling `callOpenClawDiscover`.

## Replit secrets required (exact names)

| Secret | Value |
|--------|-------|
| `OPENCLAW_RUNTIME_URL` | Cloudflare tunnel HTTPS URL (e.g. `https://xyz.trycloudflare.com`) |
| `OPENCLAW_AUTH_TOKEN_REF` | `OPENCLAW_BROKER_TOKEN` (name of the var holding the actual token) |
| `OPENCLAW_BROKER_TOKEN` | Same value as `BROKER_AUTH_TOKEN` on the Mac |

## Mac env vars required

| Var | Value |
|-----|-------|
| `BROKER_AUTH_TOKEN` | 64-char random hex — same as `OPENCLAW_BROKER_TOKEN` on Replit |
| `OPENCLAW_WEBHOOK_SECRET` | 64-char random hex (for outbound webhook signing) |
| `OPENCLAW_GATEWAY_MODE` | `live` (not `simulated`) |
| `OPENCLAW_LIVE_MODE` | `spawn` (default) or `bridge-http` |
| `OPENCLAW_BIN_PATH` | path to openclaw binary (default: `openclaw` on PATH) |

## Spawn-mode correction (post-proof)

After live Mac proof confirmed spawn mode has no persistent HTTP server on 19001, replaced bridge-http-only implementation with real spawn-mode discovery:

- `callSpawnDiscover()` — spawns `openclaw agent --mode rpc --json`, writes `{ action: "evidence_discovery", ... }` to stdin, collects newline-delimited JSON events from stdout, finds `discovery_result` or `completed` event, validates candidates, enforces timeout with SIGTERM+SIGKILL.
- `callBridgeDiscover()` — bridge-http path, returns unavailable on 404 or non-JSON — NO synthetic fallback.
- `validateAndFilterCandidates()` — drops missing fields, rejects `retrievalMethod:"connectivity_test"`, corrects wrong passageHash, stamps organisationId/executionId from request.
- `buildDiscoveryInstruction()` — governed prompt with all parameters, explicit "discovery only" rules, required JSON output schema.
- Synthetic test candidate REMOVED from live mode entirely.
- Simulated mode: `{ candidates: [], openClawStatus: "simulated" }` — no fake data.
- `openClawStatus:"available"` when OpenClaw ran (even 0 valid candidates); `"unavailable"` only on crash/timeout/spawn failure.

32 new tests in `artifacts/desktop-connector/src/__tests__/evidence-discovery.test.ts` — all pass.

## Test count

Desktop-connector: 183 passing / 18 failing (all 18 pre-existing in e2e.test.ts, routes.test.ts, validation.test.ts — my evidence-discovery.test.ts: 32/32).
Api-server: 4757 passing / 4 failing (pre-existing pdf-parse failures).
