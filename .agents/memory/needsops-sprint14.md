---
name: NeedsOps Sprint 14 — Installer, Device Management, Business Discovery
description: Customer onboarding wizard (6 steps), Electron desktop app, device activation codes, payment bypass, Business Discovery (6 screens), installer release catalogue, REQUIRED_RLS_TABLES=46
---

## Key Facts

- **REQUIRED_RLS_TABLES** increased from 35 → 46; migration file: `lib/db/migrations/sprint14-installer-device-discovery.sql`
- **Payment bypass** gated on `ENABLE_PAYMENT_BYPASS=true` env var; button shows in onboarding wizard step 6 only when flag is set; `POST /v1/organisations/:slug/payment/bypass`
- **Activation codes** are 96-bit CSPRNG, displayed as XXXX-XXXX-XXXX-XXXX, SHA-256 hashed in DB, 15-minute expiry, single-use, 5-attempt lockout; no dashes stored in hash (strip before hashing)
- **Device credentials** are 256-bit CSPRNG hex, SHA-256 hashed; bearer token format: `deviceId.rawSecret`
- **OS keychain** (`keytar`) used for ALL desktop credentials — nothing on disk; macOS Keychain + Windows Credential Manager

## New DB Tables (all in Sprint 14 migration)

Per-org (with RLS + tenant_isolation policy):
- `devices`, `device_credentials`, `device_activation_tokens`, `device_runtime_status`
- `onboarding_sessions`, `org_company_profile`, `org_connected_systems`
- `device_approved_resources`, `org_approval_rules_discovery`
- `org_discovery_answers`, `org_discovery_status`, `agent_configurations`

Platform-wide (no RLS):
- `installer_releases`, `installer_download_events`

Columns added by migration: `organizations.onboarding_step`, `organizations.installer_connected_at`, `organizations.discovery_completed_at`, `plans.monthly_price_cents`, `plans.annual_price_cents`, `plans.feature_bullets`

Existing orgs migration: `UPDATE organizations SET onboarding_step = 6` so they skip new wizard.

## New API Routes (all registered in `v1/index.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/organisations/:slug/activation-codes` | Generate code |
| DELETE | `/organisations/:slug/activation-codes/current` | Revoke code |
| POST | `/activation-codes/redeem` | Redeem → register device |
| GET | `/organisations/:slug/devices` | List devices |
| POST | `/organisations/:slug/devices/:id/revoke` | Revoke device |
| PATCH | `/organisations/:slug/devices/:id/name` | Rename device |
| POST | `/devices/:id/heartbeat` | Device heartbeat (device auth) |
| GET | `/payment/bypass/status` | Check if bypass enabled |
| POST | `/organisations/:slug/payment/bypass` | Activate trial (dev only) |
| GET | `/installer/latest.json` | Latest releases JSON |
| GET | `/installer/latest` | Redirect to download |
| POST | `/installer/releases` | Publish new release (admin key) |
| GET | `/organisations/:slug/discovery` | Get discovery progress |
| POST | `/organisations/:slug/discovery/screens/:screenKey` | Save screen answers |
| POST | `/organisations/:slug/discovery/complete` | Complete discovery |

## New Web Pages

- `/app/:slug/install` → `InstallPage.tsx` — OS detection, download, activation code display, device poll
- `/app/:slug/devices` → `DevicesPage.tsx` — device list, rename, revoke
- `/app/:slug/discover` → `DiscoveryPage.tsx` — 6-screen business discovery wizard
- `/onboarding` → `OrgOnboarding.tsx` — 6-step wizard (was 4 steps; now includes plan + checkout)
- `AppDashboard.tsx` — install-reminder banner when no connected devices

## Electron Desktop App (`artifacts/needsops-desktop/`)

Architecture:
- `src/main/index.ts` — Electron main, window lifecycle, broker auto-start
- `src/main/credentialStore.ts` — keytar wrapper; all secrets in OS keychain
- `src/main/brokerManager.ts` — spawns desktop-connector as Node.js child process
- `src/main/ipcHandlers.ts` — IPC bridge; all channels registered here
- `src/main/tray.ts` — system tray icon + context menu
- `src/main/tunnelManager.ts` — CloudflareTunnelAdapter / OutboundWebSocketAdapter interfaces
- `src/main/startupManager.ts` — OS login item / auto-launch
- `src/preload/preload.ts` — contextBridge; renderer uses `window.needsops.*`
- `src/renderer/App.tsx` — screen-state machine (welcome→activation→permissions→browser-select→folder-select→discovery→connecting→ready→settings)

Screens: WelcomeScreen, ActivationScreen, PermissionsScreen, BrowserSelectScreen, FolderSelectScreen, DiscoveryScreen, ConnectingScreen, ReadyScreen, SettingsScreen

Build targets:
- macOS: arm64 + x64 DMG (`electron-builder --mac`)
- Windows: x64 NSIS (`electron-builder --win`)
- CI: `.github/workflows/build-desktop-macos.yml`, `.github/workflows/build-desktop-windows.yml`

## DISCOVERY_SCREENS Shape Changed

`DISCOVERY_SCREENS` in `discoveryService.ts` is now an array of `{ key, title }` objects (not a string tuple). Any code doing `.indexOf(key)` must use `.findIndex(s => s.key === key)`.

## Service Exports Added for Testing

- `activationCodeService.ts`: `formatCode`, `hashCode` (async), `isExpired`, `isLocked`
- `deviceService.ts`: `generateDeviceToken`, `hashDeviceToken`, `buildDeviceToken`
- `discoveryService.ts`: `computeCompletionPercentage`

## Open Items

- `PLATFORM_ADMIN_KEY` secret for installer release API: add to Replit secrets before using POST /installer/releases in production
- GitHub repo URL placeholder (`needsops/needsops-desktop`) in migration seed data: replace when real repo exists
- `discoveryService.ts` line ~233: `discoveryCompletedAt` column set via `as any` — needs proper Drizzle schema column added to `organizations.ts`
- Electron app does not yet have macOS entitlements plist (`assets/entitlements.mac.plist`) or tray icon (`assets/tray-icon.png`) — needed for code signing / packaged build

## Why

- Org onboarding extended to 6 steps to include plan selection and payment bypass before redirect to install page
- Electron chosen over Tauri for TypeScript alignment and mature electron-builder tooling
- Device credentials in OS keychain (not disk files) for security — keytar works cross-platform
- Activation codes stripped of 0/O/1/I/L ambiguous chars before display to users
