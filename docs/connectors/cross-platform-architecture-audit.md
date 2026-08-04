# Cross-Platform Architecture Audit
## NeedsOps Desktop Connector — Sprint 34

> **Date:** August 2026  
> **Scope:** `artifacts/needsops-desktop/` (Electron app) + `artifacts/desktop-connector/` (Node broker)  
> **Classification method:** Platform-Independent / macOS-Specific / Windows-Specific / Shared-Infrastructure / Candidate-for-Abstraction

---

## Executive Summary

The original connector was designed for macOS. Sprint 34 has refactored all platform-specific logic behind the `IPlatformAdapter` and `IRuntimeAdapter` interfaces. No cloud protocol changes were made. Existing macOS behaviour is 100% preserved.

---

## Electron App — `artifacts/needsops-desktop/src/`

### Main Process

| File | Classification (Before) | Classification (After) | Changes Made |
|---|---|---|---|
| `main/index.ts` | macOS-Specific (3 inline checks) | ✅ Platform-Independent | titleBarStyle, icon, close behaviour delegated to `platformAdapter` |
| `main/brokerManager.ts` | macOS-Specific (electron.exe + windowsHide) | ✅ Platform-Independent | `isElectronExecutable()` and `getChildProcessOptions()` delegated to `platformAdapter` |
| `main/tray.ts` | macOS-Specific (icon resize) | ✅ Platform-Independent | `getTrayIconOptions()` delegated to `platformAdapter` |
| `main/credentialStore.ts` | Shared-Infrastructure | ✅ Shared-Infrastructure | No change — Electron `safeStorage` is already cross-platform |
| `main/startupManager.ts` | Shared-Infrastructure | ✅ Shared-Infrastructure | No change — Electron `app.setLoginItemSettings()` is cross-platform |
| `main/ipcHandlers.ts` | Shared-Infrastructure | Shared-Infrastructure | No change — returns raw process.platform; renderer normalises |
| `main/platform/IPlatformAdapter.ts` | *(new)* | ✅ Platform-Independent | Interface definition |
| `main/platform/MacPlatformAdapter.ts` | *(new)* | macOS-Specific | macOS implementation, behind interface |
| `main/platform/WindowsPlatformAdapter.ts` | *(new)* | Windows-Specific | Windows implementation, behind interface |
| `main/platform/LinuxPlatformAdapter.ts` | *(new)* | Linux-Specific | Linux implementation, behind interface |
| `main/platform/PlatformAdapterFactory.ts` | *(new)* | ✅ Shared-Infrastructure | Singleton factory; selects adapter by `process.platform` |

### Renderer Process

| File | Classification | Issue | Change Made |
|---|---|---|---|
| `renderer/screens/ActivationScreen.tsx` | macOS-Specific (darwin check) | Platform string: `darwin → macos`, `win32` sent as-is (API expected `windows`) | Fixed: full map `darwin→macos`, `win32→windows`, `linux→linux` |
| `renderer/screens/PermissionsScreen.tsx` | macOS-Specific (isMac flag) | Display-only; not a data bug | No change — display behaviour acceptable |
| `renderer/screens/WelcomeScreen.tsx` | Platform-Independent | — | No change |
| `renderer/screens/ReadyScreen.tsx` | Platform-Independent | — | No change |
| `renderer/screens/SettingsScreen.tsx` | Platform-Independent | — | No change |

---

## Broker — `artifacts/desktop-connector/src/`

### Broker Core

| File | Classification (Before) | Classification (After) | Changes Made |
|---|---|---|---|
| `broker/types.ts` | macOS-Specific (HOME env path) | ✅ Platform-Independent | DB path uses `os.homedir()` instead of `process.env.HOME` |
| `broker/gatewayAdapter.ts` | Shared-Infrastructure | Shared-Infrastructure | No change — `IGatewayAdapter` interface unchanged |
| `broker/relayClient.ts` | Platform-Independent | Platform-Independent | No change |
| `broker/server.ts` | Platform-Independent | Platform-Independent | No change |
| `broker/store.ts` | Platform-Independent | Platform-Independent | No change |
| `broker/auth.ts` | Platform-Independent | Platform-Independent | No change |
| `broker/webhookDelivery.ts` | Platform-Independent | Platform-Independent | No change |
| `broker/validation.ts` | Platform-Independent | Platform-Independent | No change |
| `broker/relayProtocol.ts` | Platform-Independent | Platform-Independent | No change |
| `index.ts` | Platform-Independent | Platform-Independent | No change — runtime selection config-driven |

### Runtime Discovery (New)

| File | Classification | Purpose |
|---|---|---|
| `runtime/IRuntimeAdapter.ts` | ✅ Platform-Independent | Interface for all runtime adapters |
| `runtime/OpenClawRuntimeAdapter.ts` | Runtime-Specific | OpenClaw binary + bridge-http discovery |
| `runtime/OllamaRuntimeAdapter.ts` | Runtime-Specific | Ollama HTTP probe + binary detection |
| `runtime/LMStudioRuntimeAdapter.ts` | Runtime-Specific | LM Studio HTTP probe |
| `runtime/VllmRuntimeAdapter.ts` | Runtime-Specific | vLLM /health probe |
| `runtime/RuntimeDiscovery.ts` | ✅ Shared-Infrastructure | Parallel probing, caching, singleton |

---

## Platform-Specific Dependency Register

All items below are now isolated behind adapter interfaces.

| Dependency | Category | Where isolated | Platforms affected |
|---|---|---|---|
| `titleBarStyle: "hiddenInset"` | Window chrome | `MacPlatformAdapter.getWindowChromeOptions()` | macOS only |
| App icon undefined on launch | App icon | `MacPlatformAdapter.getAppIconPath()` | macOS only |
| Keep-alive on window-all-closed | App lifecycle | `MacPlatformAdapter.shouldKeepAliveOnWindowClose()` | macOS only |
| Tray icon resize 16×16 | Tray icon | `MacPlatformAdapter.getTrayIconOptions()` | macOS only |
| `process.execPath.endsWith("Electron")` | Dev node detection | `MacPlatformAdapter.isElectronExecutable()` | macOS only |
| `process.execPath.endsWith("electron.exe")` | Dev node detection | `WindowsPlatformAdapter.isElectronExecutable()` | Windows only |
| `windowsHide: true` | Child process spawn | `WindowsPlatformAdapter.getChildProcessOptions()` | Windows only |
| `process.env.HOME` for DB path | Filesystem | Fixed: `os.homedir()` in `broker/types.ts` | Was Windows bug |
| `PROGRAMFILES` / `LOCALAPPDATA` | Runtime discovery | `WindowsPlatformAdapter.getRuntimeLocation()` | Windows only |
| XDG base paths | Runtime discovery | `LinuxPlatformAdapter.getRuntimeLocation()` | Linux only |
| Homebrew paths | Runtime discovery | `MacPlatformAdapter.getRuntimeLocation()` | macOS only |

---

## Build & Packaging

| Platform | Before | After |
|---|---|---|
| macOS | DMG (arm64 + x64) ✅ | DMG (arm64 + x64) ✅ unchanged |
| Windows | NSIS x64 ✅ | NSIS x64 ✅ unchanged |
| Linux | ❌ Not configured | AppImage (x64 + arm64) ✅ added |
| Auto-updater | Config present, not implemented | Config present, not implemented (no change — out of scope) |

---

## What Was NOT Changed (by design)

- `IGatewayAdapter` interface — execution submission protocol unchanged
- `RelayClient` — outbound WSS relay unchanged
- `auth.ts` — device token / challenge-response unchanged
- Cloud API — no protocol changes
- Existing macOS behaviour — 100% preserved
