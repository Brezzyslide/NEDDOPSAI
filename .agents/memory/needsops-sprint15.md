---
name: NeedsOps Sprint 15 Production Transport
description: Outbound WSS relay, short-lived device auth, safeStorage, CI corrections, REQUIRED_RLS_TABLES=51
---

## Key decisions

**Transport architecture:**
- Production transport: outbound WSS from broker → platform at `wss://<api>/v1/devices/relay`
- Cloudflare guarded behind `DESKTOP_TRANSPORT=cloudflare-dev` (rejected in `app.isPackaged` builds)
- `ITransportAdapter` interface kept; `OutboundWebSocketTransport` is the new production impl
- `RelayClient` class in `artifacts/desktop-connector/src/broker/relayClient.ts` handles all WS lifecycle
- Exponential backoff: 1s → 2s → 4s → 8s → 16s → 32s (capped) + jitter

**Auth model (challenge/exchange):**
- Ed25519 public/private key pair registered at device enrolment
- `POST /v1/devices/auth/challenge` → 32-byte hex nonce, 60s TTL
- `POST /v1/devices/auth/exchange` → device signs nonce with `crypto.sign(null, ...)` (NOT createSign("SHA256") — incompatible with Ed25519)
- Access token: 256-bit opaque, SHA-256 hash stored, 15-min TTL, audience `device-relay`
- Refresh token: 256-bit opaque, SHA-256 hash stored, 30-day TTL, rotated on use
- `POST /v1/devices/auth/refresh` → revokes old refresh token, issues new access+refresh pair

**Ed25519 signing gotcha:**
- `createSign("SHA256")` FAILS with Ed25519 keys — Ed25519 manages its own digest
- Correct: `crypto.sign(null, Buffer.from(data), privateKeyPem)` and `crypto.verify(null, ...)`

**Secure storage — switched from keytar to safeStorage:**
- `credentialStore.ts` now uses `electron.safeStorage` (built into Electron, no native rebuild needed)
- Encrypted values written to `credentials.enc.json` in `app.getPath('userData')`
- New fields: `accessToken`, `accessTokenExpiry`, `refreshToken`, `publicKey`, `privateKey`, `legacyToken`

**DB schema — 5 new tables (46 → 51 REQUIRED_RLS_TABLES):**
- `device_auth_challenges` — nonce issuance, 60s TTL, single-use
- `device_access_tokens` — 15-min access tokens, SHA-256 hash, audience field
- `device_refresh_tokens` — 30-day refresh tokens, rotation tracking, superseded_by_id
- `device_ws_sessions` — audit trail of WS connections per device
- `device_task_dispatch` — durable task delivery queue with idempotency

**WS relay server (api-server):**
- `WebSocketServer` attached to the HTTP server in `index.ts` (NOT app.listen — use createServer(app))
- Restricted to path `/v1/devices/relay`, maxPayload 512KB
- `deviceRelayService.ts` manages in-memory Map<deviceId, ConnectedDevice>
- Duplicate connection → closes older connection with `reconnect_required` message
- On disconnect → requeues `sent` task dispatches back to `pending`

**relayProtocol.ts:**
- Single source of truth for message envelope, exists in both api-server and desktop-connector
- Protocol version: 1
- Max message size: 512KB enforced client and server side
- payload must be `null` or a plain object (arrays rejected)

**CI workflows:**
- macOS: now uses matrix `macos-14` (arm64) + `macos-13` (x64) — `macos-latest` is ambiguous
- Both: adds `@electron/rebuild` step for `better-sqlite3`
- Both: adds SHA-256 checksum generation
- Both: adds `verify-package.mjs` post-build verification step

**What remains before clean-machine test:**
1. Broker `getAccessToken()` uses the legacy long-lived token; needs real refresh flow wired through Electron IPC (private key stored via safeStorage, sign challenge, exchange)
2. `better-sqlite3` native rebuild not verified (CI-only)
3. No installer built (requires GitHub Actions on real macOS/Windows)
4. Installer files `electron`, `electron-builder`, `@electron/rebuild` all firewall-blocked in Replit

## Test counts
- Sprint 15: 1382 tests (43 new: 22 WS relay + 21 device auth)
- REQUIRED_RLS_TABLES: 51
