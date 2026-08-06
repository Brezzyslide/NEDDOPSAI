# NeedsOps Connector — Real Mac Acceptance Runbook

**Sprint 29F.3 · Operator guide for running the 10 real-connector acceptance scenarios on a physical Mac.**

This document contains every step required to go from a clean Mac checkout to a
completed, evidence-backed acceptance report. No prior knowledge of the NeedsOps
architecture is assumed beyond basic terminal and Node.js familiarity.

---

## Contents

1. [Prerequisites](#1-prerequisites)
2. [Connector installation and start](#2-connector-installation-and-start)
3. [Device activation](#3-device-activation)
4. [Relay configuration](#4-relay-configuration)
5. [Environment variables reference](#5-environment-variables-reference)
6. [Verify the heartbeat](#6-verify-the-heartbeat)
7. [Create the disposable test directory](#7-create-the-disposable-test-directory)
8. [Run the preflight check](#8-run-the-preflight-check)
9. [Run the acceptance test suite](#9-run-the-acceptance-test-suite)
10. [Scenario reference](#10-scenario-reference)
11. [Collect logs and evidence](#11-collect-logs-and-evidence)
12. [Stop and clean up](#12-stop-and-clean-up)
13. [Failure diagnostics](#13-failure-diagnostics)

---

## 1. Prerequisites

### Software

| Requirement | Minimum version | Check |
|-------------|-----------------|-------|
| macOS | 13 Ventura | `sw_vers -productVersion` |
| Node.js | 20 LTS | `node --version` |
| pnpm | 9+ | `pnpm --version` |
| Git | any | `git --version` |

### Optional (for Scenarios 4, 5, 6)

| App | Scenario |
|-----|----------|
| Microsoft Word | Scenario 4 — `word_create` |
| Microsoft Excel | Scenario 5 — `excel_update` |
| Microsoft Outlook | Scenario 6 — Outlook draft |

> Scenarios 4–6 return `OPERATION_NOT_AVAILABLE` when the required app is absent.
> All other scenarios work without Office.

### macOS permissions required

The acceptance tests write to `~/Documents/needsops-acceptance-test/`.
macOS may prompt for **Files and Folders** permission the first time. Grant it
to Terminal (or whichever terminal app you use).

No Accessibility, Screen Recording, or Full Disk Access permission is required
for Scenarios 1–3 and 7–10.

### What you need from the NeedsOps platform

- Your API server URL (`NEEDSOPS_API_BASE_URL`)  
- An organisation ID for a test org (`REAL_ORG_ID`)  
- A Clerk session JWT for a user in that org (`REAL_USER_TOKEN`)  
- An activation code issued from the Platform Admin panel (needed during device registration)

---

## 2. Connector installation and start

### Step 1 — Clone and install

```bash
# From your Mac
git clone <your-repo-url> needsops
cd needsops
pnpm install
```

### Step 2 — Build the connector

The connector is a plain Node.js process compiled with esbuild. It is **not**
an Electron app and does not require Xcode or any native build tools.

```bash
pnpm --filter @workspace/desktop-connector run build
# Output: artifacts/desktop-connector/dist/index.mjs
```

### Step 3 — Copy and edit the environment file

```bash
cp artifacts/desktop-connector/.env.example artifacts/desktop-connector/.env
```

Open `.env` in your editor and fill in the values listed in [Section 5](#5-environment-variables-reference).

> **Do not commit `.env` to Git** — it contains secrets.

### Step 4 — Start the connector (Terminal 1)

```bash
# Option A — development mode (auto-restarts on source changes; requires prior build)
pnpm --filter @workspace/desktop-connector run dev

# Option B — production-style start (no watch, fastest)
node artifacts/desktop-connector/dist/index.mjs

# Option C — no-build dev using tsx (slower startup, no build required)
npx tsx artifacts/desktop-connector/src/index.ts
```

**Expected startup output:**

```
[relay-client] Connecting  url=wss://yourapp.replit.dev/v1/devices/relay
[relay-client] Authenticated  sessionId=sess_xxxxxxxx
[broker] HTTP server listening  port=19002
[broker] Ready
```

If you see `Auth rejected` or `DEVICE_NOT_FOUND`, the device has not been
activated yet — continue to [Section 3](#3-device-activation).

---

## 3. Device activation

The NeedsOps Connector uses a two-stage registration flow:

```
Stage 1 — Installer activation code
  Platform Admin creates an activation code in the Platform Admin panel.
  The connector uses this code to register the device and receive a
  long-lived brokerAuthToken.

Stage 2 — Challenge / exchange (automatic on every restart)
  The connector uses the brokerAuthToken to request a signing challenge
  from the API, signs the nonce with its Ed25519 key, and exchanges the
  signature for a short-lived relay access token.
  This short-lived token is used for the WebSocket relay connection.
```

### Activation steps (first time only)

**Step 1 — Obtain an activation code**

In the NeedsOps web portal:

1. Go to **Organisation Settings → Connectors** (URL: `/settings/connectors`)
2. Click **Add Connector**
3. Copy the 8-character activation code (valid for 24 hours)

Alternatively, a Platform Admin can issue a code via `POST /v1/activation-codes`.

**Step 2 — Set the activation code in your `.env`**

```dotenv
# artifacts/desktop-connector/.env
NEEDSOPS_ACTIVATION_CODE=XXXX-XXXX   # from the portal
NEEDSOPS_API_BASE_URL=https://yourapp.replit.dev
```

**Step 3 — Start the connector**

On first start, the connector detects `NEEDSOPS_ACTIVATION_CODE`, calls the
activation endpoint, and stores the resulting `brokerAuthToken`, `deviceId`,
and organisation binding in its local SQLite database (`~/needsops-broker.db`
by default).

After successful activation, the connector logs:

```
[activation] Device registered successfully  deviceId=dev_xxxxxxxx
[activation] Stored credentials in local database
[relay-client] Connecting...
[relay-client] Authenticated
```

Your `.env` will need `NEEDSOPS_DEVICE_ID` and `NEEDSOPS_DEVICE_TOKEN` for
subsequent restarts. Copy these from the logs or from `~/needsops-broker.db`.

### Authentication flow (every start after activation)

```
Connector reads NEEDSOPS_DEVICE_TOKEN (brokerAuthToken)
  → POST /v1/devices/auth/challenge  { deviceId, organizationId }
      ← { challengeId, nonce, expiresAt }
  → POST /v1/devices/auth/exchange   { deviceId, organizationId, challengeId, signature }
      ← { accessToken, refreshToken }
  → WebSocket CONNECT wss://<api>/v1/devices/relay
      Authorization: Bearer <accessToken>
  → relay protocol auth message  { token, appVersion, osPlatform, arch }
      ← auth_ok { sessionId }
  → relay heartbeat every 30s
```

---

## 4. Relay topology

```
Mac connector process
    ↓ builds wss://NEEDSOPS_API_BASE_URL/v1/devices/relay
    ↓ WebSocket (TLS)
API server WebSocketServer  (/v1/devices/relay)
    ↓ deviceRelayService.ts
    ↓ validates access token, maps deviceId → relay session
ConnectorBridgeService.ts
    ↓ submitConnectorOperation()
    ↓ relay message: connector_op_request
Mac connector handler  (connectorOperationHandler.ts)
    ↓ checkDesktopIdempotency()
    ↓ fs.writeFile / fs.readFile / fs.rename / etc.
    ↓ relay message: connector_op_result
ConnectorBridgeService.ts
    → ExecutionActionDispatcherService → lifecycle record
```

### `REAL_CONNECTOR_URL` value

For the acceptance test suite, `REAL_CONNECTOR_URL` is a **gate flag** —
it signals that a real connector is configured. Set it to the API base URL:

```bash
export REAL_CONNECTOR_URL="https://yourapp.replit.dev"
```

> The value is not used to make network connections from the test process.
> The relay connection is owned by the **connector process** (Terminal 1).
> The tests exercise the connector via the **API server** using `REAL_USER_TOKEN`.

---

## 5. Environment variables reference

### Connector `.env` (on the Mac — `artifacts/desktop-connector/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEEDSOPS_API_BASE_URL` | ✅ | API server URL, e.g. `https://yourapp.replit.dev` |
| `NEEDSOPS_DEVICE_ID` | ✅ after activation | Device ID assigned during registration |
| `NEEDSOPS_DEVICE_TOKEN` | ✅ after activation | Long-lived broker auth token |
| `NEEDSOPS_ORG_SLUG` | Optional | Org slug (used for logging) |
| `BROKER_PORT` | Optional | Local HTTP port (default `19002`) |
| `BROKER_AUTH_TOKEN` | ✅ | Random secret for local OpenClaw HTTP auth — `openssl rand -hex 32` |
| `OPENCLAW_WEBHOOK_SECRET` | ✅ | HMAC secret for webhook events — `openssl rand -hex 32` |
| `OPENCLAW_GATEWAY_MODE` | Optional | `simulated` (default) or `live` |

### Test process env vars (Terminal 2)

| Variable | Required | Description |
|----------|----------|-------------|
| `REAL_CONNECTOR_URL` | ✅ | API base URL (gate flag) |
| `REAL_ORG_ID` | ✅ | Organisation ID (not slug) |
| `REAL_DEVICE_ID` | ✅ | Device ID of the connected connector |
| `REAL_USER_TOKEN` | ✅ | Clerk JWT for a user in that org |

> **Never put real tokens or secrets in documentation or source code.**
> Store them in your shell session (`export VAR=value`) or in a `.env` file
> that is `.gitignore`d.

---

## 6. Verify the heartbeat

Once the connector is running, confirm the relay connection is healthy:

```bash
# Using the API (requires REAL_USER_TOKEN and REAL_ORG_ID)
curl -s \
  -H "Authorization: Bearer $REAL_USER_TOKEN" \
  "$REAL_CONNECTOR_URL/v1/organisations/$REAL_ORG_ID/devices" \
  | jq '.devices[] | select(.id == env.REAL_DEVICE_ID) | {id, status, lastHeartbeatAt, connectorVersion}'
```

**Expected output:**

```json
{
  "id": "dev_xxxxxxxx",
  "status": "active",
  "lastHeartbeatAt": "2026-08-06T22:30:00Z",
  "connectorVersion": "0.1.1"
}
```

`lastHeartbeatAt` must be within the last 90 seconds. If it is older, the
connector process may not be running or may have lost its relay connection.

---

## 7. Create the disposable test directory

The tests write only to:

```
~/Documents/needsops-acceptance-test/
```

Create it manually before running tests:

```bash
mkdir -p ~/Documents/needsops-acceptance-test
```

Each test run creates a timestamped subfolder (`NeedsOps_E2E_Test_<timestamp>`)
inside this directory. Files are deleted by the `afterAll` cleanup handler.

> **No files outside this directory will be read or modified by any test.**

---

## 8. Run the preflight check

Before running the full acceptance suite, run the preflight script. It checks
all prerequisites and exits with a clear summary.

```bash
# From the repo root — set env vars first
export NEEDSOPS_API_BASE_URL="https://yourapp.replit.dev"
export REAL_ORG_ID="org_xxxxxxxx"
export REAL_DEVICE_ID="dev_xxxxxxxx"
export REAL_USER_TOKEN="<your-clerk-jwt>"

node artifacts/desktop-connector/scripts/preflight.mjs
```

**Expected output (all passing):**

```
── Environment variables ──────────────────────────────────────────────────────
  ✅  NEEDSOPS_API_BASE_URL
  ✅  REAL_ORG_ID
  ✅  REAL_DEVICE_ID
  ✅  REAL_USER_TOKEN

── Local connector broker ─────────────────────────────────────────────────────
  ✅  Broker port 19002 is open

── API server reachability ────────────────────────────────────────────────────
  ✅  API server https://yourapp.replit.dev is healthy

── Device registration ─────────────────────────────────────────────────────────
  ✅  Device dev_xxxxxxxx found (status: active)

── Relay connection and heartbeat ─────────────────────────────────────────────
  ✅  Heartbeat is current (12s ago)
  ✅  Connector version: 0.1.1

── Required capabilities ───────────────────────────────────────────────────────
  ✅  Capability: execution.openclaw_runtime
  ✅  Capability: files.read
  ✅  Capability: files.write

── Acceptance test directory ───────────────────────────────────────────────────
  ✅  Directory created/exists: /Users/you/Documents/needsops-acceptance-test
  ✅  Write succeeded: ...preflight_probe_....txt
  ✅  Probe file removed successfully

── Production safety verification ─────────────────────────────────────────────
  ✅  Acceptance test directory is isolated: ...
  ✅  Desktop (/Users/you/Desktop) will NOT be written to
  ✅  All scenarios use disposable files with timestamped names
  ✅  send_email is blocked (UNSUPPORTED_OPERATION) — no email will be sent
  ✅  Scenario 6 creates only an Outlook DRAFT — draft is NOT sent

════════════════════════════════════════════════════════════════

  🟢  PREFLIGHT PASSED — 18 checks OK
```

Do not proceed to acceptance tests if preflight reports any ❌.

---

## 9. Run the acceptance test suite

### Terminal 1 — start the connector (if not already running)

```bash
cd /path/to/needsops
pnpm --filter @workspace/desktop-connector run build
pnpm --filter @workspace/desktop-connector run dev
```

Wait for `[relay-client] Authenticated` before opening Terminal 2.

### Terminal 2 — run acceptance tests

```bash
cd /path/to/needsops

# Set required environment variables
export REAL_CONNECTOR_URL="https://yourapp.replit.dev"
export REAL_ORG_ID="org_xxxxxxxx"
export REAL_DEVICE_ID="dev_xxxxxxxx"
export REAL_USER_TOKEN="<your-clerk-jwt>"
export NEEDSOPS_API_BASE_URL="$REAL_CONNECTOR_URL"

# Run the preflight first
node artifacts/desktop-connector/scripts/preflight.mjs

# Run the acceptance suite
cd artifacts/api-server
npx vitest run src/__tests__/sprint29f1-real-connector-acceptance.test.ts --reporter=verbose
```

**Expected output (all connectors passing):**

```
 ✓ Scenario 1 — Desktop read: Medication Policy.docx
     ✓ CoS detects connector preference and dispatches Operations Manager
 ✓ Scenario 2 — Hybrid evidence: desktop + NeedsOps Library
     ✓ EvidencePack contains both Library and connector sources
 ✓ Scenario 3 — Create a file in Documents
     ✓ Output generated, write action proposed, approved, dispatched once
...
 ✓ Scenario 8 — Duplicate dispatch (idempotency)
     ✓ Same idempotencyKey sent twice: one physical write, second deduped
     ✓ [DESKTOP DEDUP] Relay redelivery caught by connector idempotency store
...
Tests  10 passed (10)
```

A machine-readable results file is written to:

```
~/Documents/needsops-acceptance-test/acceptance-results-<timestamp>.json
```

---

## 10. Scenario reference

### What each scenario does on the Mac

| # | Title | Mac effect | Directory | Permission | Cleanup |
|---|-------|-----------|-----------|-----------|---------|
| 1 | Desktop read | Reads `Medication Policy.docx` (must exist) | Any readable path | Files & Folders | None |
| 2 | Hybrid evidence | Reads connector file + NeedsOps Library | Any readable path | Files & Folders | None |
| 3 | Create a file | Creates `test_scenario3_<ts>.txt` | `needsops-acceptance-test/` | Files & Folders / Documents | `afterAll` deletes file |
| 4 | Word doc creation | Creates `test_scenario4_<ts>.docx` | `needsops-acceptance-test/` | Files & Folders (+ Word automation) | `afterAll` deletes file |
| 5 | Excel update | Creates then updates `test_scenario5_<ts>.xlsx` | `needsops-acceptance-test/` | Files & Folders (+ Excel automation) | `afterAll` deletes file |
| 6 | Outlook draft | Creates draft in Outlook Drafts folder | Outlook Drafts | Automation (Outlook) | Manual — check Drafts and delete |
| 7 | Connector disconnect | Initiates `locate`, then disconnects | None (read-only) | None | None |
| 8 | Duplicate dispatch | Writes `test_scenario8_<ts>.txt` **once** | `needsops-acceptance-test/` | Files & Folders | `afterAll` deletes file |
| 9 | Permission denial | No Mac operation | None | None | None |
| 10 | Approval expiry | No Mac operation | None | None | None |

### Scenarios 4, 5, 6 — Office applications

- **Scenario 4** (Word): `word_create` requires Microsoft Word installed and
  macOS Automation permission granted to Terminal for Word.
  If absent: test returns `OPERATION_NOT_AVAILABLE` — this is the correct behaviour, not a test failure.
- **Scenario 5** (Excel): same conditions with Excel.
- **Scenario 6** (Outlook draft): requires Outlook. The test verifies that a
  **draft is created** but **no email is sent**. `send_email` operations are
  hard-blocked at the connector (`UNSUPPORTED_OPERATION`).

### Scenario 1 — Medication Policy.docx

Scenario 1 reads `Medication Policy.docx` from the Mac. This file must exist
before the test runs. Create a disposable version:

```bash
echo "Test medication policy content" > ~/Documents/Medication\ Policy.docx
```

Or copy any `.docx` file to that path. The test reads the file — it does not modify it.

### Scenario 8 — Idempotency (two layers verified)

Scenario 8 verifies **two independent deduplication barriers**:

**Layer 1 — Server-side (automatic):** The dispatcher's idempotency store catches
the duplicate before the relay message is sent. The connector is never contacted
a second time. `Inspector.deduplicationPrevented = true`.

**Layer 2 — Desktop-side (relay injection):** A second test within Scenario 8
bypasses the server-side store and injects the same `connector_op_request`
directly through the relay WebSocket. The connector's local idempotency store
(`idempotencyStore.ts`) catches the duplicate and returns the stored result
without executing the filesystem write again.

> This two-layer design means the file cannot be written twice even in the case
> of relay redelivery after an interrupted ACK.

---

## 11. Collect logs and evidence

### Connector logs (Terminal 1)

The connector logs to stdout in JSON format. To capture them:

```bash
pnpm --filter @workspace/desktop-connector run dev 2>&1 | tee connector-$(date +%Y%m%d-%H%M%S).log
```

### Test output

```bash
cd artifacts/api-server
npx vitest run src/__tests__/sprint29f1-real-connector-acceptance.test.ts \
  --reporter=verbose 2>&1 | tee ../../acceptance-run-$(date +%Y%m%d-%H%M%S).log
```

### Machine-readable results file

After each test run, a JSON evidence file is written:

```
~/Documents/needsops-acceptance-test/acceptance-results-<timestamp>.json
```

Format:

```json
{
  "runAt": "2026-08-06T23:00:00Z",
  "platform": "darwin",
  "macOsVersion": "14.5",
  "connectorVersion": "0.1.1",
  "deviceId": "dev_xxxxxxxx",
  "relayUrl": "[REDACTED]",
  "apiBase": "[REDACTED]",
  "scenarios": [
    {
      "scenario": 1,
      "title": "Desktop read: Medication Policy.docx",
      "result": "passed",
      "durationMs": 1823,
      "operationIds": ["opreq_xxxxxxxx"],
      "idempotencyResult": null,
      "cleanupResult": "not_required",
      "failureDetail": null
    }
  ]
}
```

---

## 12. Stop and clean up

### Stop the connector

Press `Ctrl+C` in Terminal 1.

The connector closes the relay WebSocket cleanly (close code 1000).
The device record on the server is marked `offline` within 90 seconds
(heartbeat timeout).

### Clean up test files

The `afterAll` handler in the acceptance tests deletes all files registered in
`createdFiles`. If a test run was interrupted, clean up manually:

```bash
rm -rf ~/Documents/needsops-acceptance-test/NeedsOps_E2E_Test_*
```

The `~/Documents/needsops-acceptance-test/` directory itself is retained for
future runs. The acceptance results JSON is not deleted.

### Scenario 6 — Outlook draft cleanup

Scenario 6 creates a draft in Outlook Drafts. Delete it manually:

1. Open Outlook
2. Go to **Drafts**
3. Find the draft with subject `[NeedsOps Test] …`
4. Delete it

---

## 13. Failure diagnostics

### Connector not connected

```bash
# Diagnostic
node artifacts/desktop-connector/scripts/preflight.mjs
```

**Likely cause:** Connector process not running. Start it:
```bash
pnpm --filter @workspace/desktop-connector run dev
```

---

### Device not activated

```bash
# Diagnostic
curl -s -H "Authorization: Bearer $REAL_USER_TOKEN" \
  "$REAL_CONNECTOR_URL/v1/organisations/$REAL_ORG_ID/devices" | jq '.'
```

**Likely cause:** First-run activation not completed. Obtain an activation code
from the portal and restart the connector with `NEEDSOPS_ACTIVATION_CODE` set.

---

### Invalid token / AUTH_REQUIRED

```bash
# Diagnostic
curl -s -H "Authorization: Bearer $REAL_USER_TOKEN" \
  "$REAL_CONNECTOR_URL/v1/me" | jq '.'
```

**Likely cause:** `REAL_USER_TOKEN` is expired (Clerk JWTs expire after ~1 hour).
Obtain a fresh token from the NeedsOps web portal Developer Tools (`localStorage.token`
or via the Clerk dashboard).

---

### Wrong relay URL / connection refused

```bash
# Diagnostic — confirm the relay path is accessible
curl -s -o /dev/null -w "%{http_code}" \
  "$REAL_CONNECTOR_URL/health"
```

**Likely cause:** `NEEDSOPS_API_BASE_URL` in the connector `.env` points to the
wrong server, or the server is down. Verify the URL returns HTTP 200 from `/health`.

---

### Heartbeat stale

```bash
# Diagnostic
curl -s -H "Authorization: Bearer $REAL_USER_TOKEN" \
  "$REAL_CONNECTOR_URL/v1/organisations/$REAL_ORG_ID/devices" \
  | jq '.devices[] | select(.id == env.REAL_DEVICE_ID) | .lastHeartbeatAt'
```

**Likely cause:** Connector crashed or lost network. Check Terminal 1 for errors.
Restart the connector process.

---

### macOS filesystem permission denied

```bash
# Diagnostic
ls -la ~/Documents/needsops-acceptance-test/ 2>&1
echo "test" > ~/Documents/needsops-acceptance-test/probe.txt && rm ~/Documents/needsops-acceptance-test/probe.txt
```

**Likely cause:** macOS Files and Folders permission not granted to Terminal.
Go to **System Settings → Privacy & Security → Files and Folders** and grant
access to Terminal (or your terminal app).

---

### File locked

**Likely cause:** The test file from a previous run was not cleaned up and is
open in another application. Close any application that has the file open, then
delete the stale test folder:

```bash
rm -rf ~/Documents/needsops-acceptance-test/NeedsOps_E2E_Test_*
```

---

### Word / Excel / Outlook unavailable

**Expected behaviour:** The test returns `OPERATION_NOT_AVAILABLE`, not a test
failure. The connector correctly reports the app is not present. Install the
required Office application or skip Scenarios 4, 5, 6.

---

### Duplicate write protection failed (desktop dedup did not fire)

```bash
# Diagnostic — check the idempotency store via connector logs
grep "idempotency" connector-*.log | tail -20
```

**Likely cause:** The second relay delivery used a different `idempotencyKey`.
The key must be identical for deduplication to fire. Check the relay injection
test helper to confirm the key is reused.

---

### Acknowledgement timeout

```bash
# Diagnostic
grep "TIMEOUT\|timeout" connector-*.log | tail -10
```

**Likely cause:** The connector received the op but the response did not reach
the server within the timeout window (default 60 seconds). Check:
1. Network latency between Mac and API server
2. Whether the operation itself is hanging (check Mac activity)
3. Increase `actionTimeoutMs` in `DispatchContext` for slow operations

---

### Connector restart between deliveries

**Expected behaviour:** Scenario 8 (desktop dedup test) verifies this case.
After a connector restart, the desktop idempotency store is cleared (process
memory). The **server-side** idempotency store persists across connector
restarts and catches the duplicate at the API layer. This is the designed
defence-in-depth: server-side dedup is the primary barrier; desktop-side is
a secondary barrier for in-process relay redelivery without a full restart.

---

## Final gate

The sprint is complete when a human operator has:

1. ✅ Run `preflight.mjs` with all checks passing
2. ✅ Run the 10 acceptance scenarios with all applicable scenarios passing
3. ✅ Retrieved `acceptance-results-<timestamp>.json` confirming pass/fail per scenario
4. ✅ Verified Scenario 8 shows `deduplicationPrevented: true` in the Inspector
5. ✅ Verified no file outside `~/Documents/needsops-acceptance-test/` was modified

Once all five criteria are met, the system has demonstrated:

> NeedsOps can think in the cloud, use knowledge already held in NeedsOps when
> appropriate, reach into a user's computer when explicitly required, and safely
> put work back onto that computer — with write-side effects that are gated on
> approval, recorded durably before dispatch, and protected against duplicate
> execution by two independent idempotency barriers.
