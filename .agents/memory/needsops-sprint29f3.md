---
name: NeedsOps Sprint 29F.3 Real Mac Connector Acceptance Support
description: Operator runbook, preflight script, enhanced acceptance test (11 scenarios, desktop-side idempotency via relay injection), evidence capture, final gate.
---

## Key decisions and constraints

### The connector is NOT an Electron app
`artifacts/desktop-connector` is a plain Node.js ESM process built with esbuild.
- Build: `pnpm --filter @workspace/desktop-connector run build`
- Dev: `pnpm --filter @workspace/desktop-connector run dev` (requires prior build; uses `node --watch`)
- No-build alternative: `npx tsx artifacts/desktop-connector/src/index.ts`

### REAL_CONNECTOR_URL format
`REAL_CONNECTOR_URL` in the acceptance tests is a **gate flag only** — the test process does NOT use it to make network connections. Set it to the API base URL (e.g. `https://yourapp.replit.dev`). The actual relay URL (`wss://<base>/v1/devices/relay`) is constructed by the connector process itself from `NEEDSOPS_API_BASE_URL`.

### Device activation flow (two stages)
1. **Stage 1** — Activation code: `NEEDSOPS_ACTIVATION_CODE` in `.env` → connector registers device → receives `brokerAuthToken`.
2. **Stage 2** — Challenge/exchange (every restart): `POST /v1/devices/auth/challenge` then `POST /v1/devices/auth/exchange` → short-lived relay access token.

### Idempotency: two independent layers
- **Layer 1 (server-side)**: `writeIdempotencyService.ts` catches duplicate `executionId:actionId` before relay dispatch.
- **Layer 2 (desktop-side)**: `connectorOperationHandler.ts` checks `idempotencyStore.ts` before filesystem write, catches relay redelivery.
- Scenario 8 tests BOTH: Part A via normal API dispatch; Part B via relay injection (`injectRelayMessage` helper) bypassing Layer 1.

### relay injection in acceptance test
`injectRelayMessage()` in the acceptance test opens a direct WS connection to `/v1/devices/relay`, authenticates as the device using `REAL_USER_TOKEN`, and sends a raw `connector_op_request` message. This bypasses the server-side dispatcher entirely and proves desktop-side dedup independently. Requires the relay to accept user tokens for the challenge step — may need adjustment if the relay requires device tokens only.

### Office scenarios
Scenarios 4 (Word), 5 (Excel), 6 (Outlook draft) return `OPERATION_NOT_AVAILABLE` when the app is absent — this is the correct connector behaviour, not a test failure. Tests detect this code and record `not_applicable`.

### Scenario 6 cleanup
Outlook draft created by Scenario 6 is NOT auto-deleted (no connector delete op for email drafts). Operator must delete manually from Outlook Drafts. Recorded as `cleanupResult: "manual_required"`.

### Required connector env vars (not all in .env.example)
`NEEDSOPS_DEVICE_ID`, `NEEDSOPS_API_BASE_URL`, `NEEDSOPS_DEVICE_TOKEN` are NOT in `.env.example` but are required at runtime (read in `src/index.ts`). The runbook documents all of them.

### Files created
- `artifacts/desktop-connector/scripts/preflight.mjs` — preflight check (18 checks, port/heartbeat/capability/fs-write)
- `docs/connectors/REAL_MAC_ACCEPTANCE_RUNBOOK.md` — end-to-end operator guide
- `artifacts/api-server/src/__tests__/sprint29f1-real-connector-acceptance.test.ts` — rewritten with 11 real scenarios (all skip when `hasRealConnector=false`), evidence capture to JSON

### Final test count
- 3,998 passing (unchanged)
- 14 failing (unchanged — all pre-existing sprint285)
- Acceptance tests skip cleanly without `REAL_CONNECTOR_URL`
