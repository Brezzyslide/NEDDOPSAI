---
name: NeedsOps Sprint 34 Cross-Platform Desktop Connector
description: Platform adapter pattern, RuntimeDiscovery, OS-specific bugs fixed, Linux added
---

## PlatformAdapter Pattern

All `process.platform === "darwin"` checks removed from Electron main process. Replaced with `platformAdapter` singleton from `PlatformAdapterFactory.ts`.

Interface: `artifacts/needsops-desktop/src/main/platform/IPlatformAdapter.ts`
Adapters: `MacPlatformAdapter`, `WindowsPlatformAdapter`, `LinuxPlatformAdapter`
Factory: `PlatformAdapterFactory.ts` — selects by `process.platform`, falls back to Linux

Files modified in Electron app:
- `main/index.ts` — titleBarStyle, icon, window-close behavior
- `main/brokerManager.ts` — isElectronExecutable(), getChildProcessOptions()
- `main/tray.ts` — getTrayIconOptions() for icon resize

## RuntimeAdapter Pattern

New `IRuntimeAdapter` interface for discovery only — does NOT replace `IGatewayAdapter` (execution).
Location: `artifacts/desktop-connector/src/runtime/`

Adapters: OpenClaw (binary + bridge-http), Ollama (/api/version + binary), LM Studio (/v1/models), vLLM (/health)
Discovery: `RuntimeDiscovery.ts` — parallel probing, 60s cache, singleton via `getRuntimeDiscovery()`

**Why:** `IGatewayAdapter` handles execution; `IRuntimeAdapter` handles discovery. Keep these separate.

## Bug Fixes (cross-platform)

1. **Broker DB path:** `process.env.HOME` → `os.homedir()` in `broker/types.ts`. HOME not reliably set on Windows (USERPROFILE is the standard). Added `import os from "node:os"` at top of file.

2. **ActivationScreen.tsx:** Platform API string was `win32` → now maps to `windows`. Device display name was `darwin → Mac, anything → PC` → now `darwin→Mac, win32→Windows, linux→Linux`.

3. **windowsHide:** Was hardcoded `true` in brokerManager. Now `true` on Windows only via `getChildProcessOptions()`.

4. **Electron executable detection:** Was `endsWith("electron.exe")` only. Now per-platform via `isElectronExecutable()`.

## Never-throws pattern in adapters

Synchronous throws from `execFile` inside a `new Promise()` must be caught with try-catch inside the Promise constructor. `Promise.allSettled` wraps only rejected promises, not sync throws from `.map()`.

Fix in `RuntimeDiscovery`: wrap each `adapter.getInfo()` in `Promise.resolve()` inside try-catch to convert sync throws to rejections before `Promise.allSettled`.

## Linux Support Added

- `LinuxPlatformAdapter`: XDG paths, Homebrew/pip locations, `os.homedir()` for all paths
- `package.json`: Added `dist:linux` script + `linux.target: AppImage (x64 + arm64)`
- Not hardware-tested — requires validation on Ubuntu 22.04, 24.04, Fedora 40 before external release
- GNOME tray requires AppIndicator extension (documented limitation)
- Headless Linux: libsecret not available → base64 fallback (pre-existing, documented)

## Test baseline

Sprint 34 adds 26 tests in `desktop-connector/src/__tests__/sprint34-cross-platform.test.ts`. All pass.
Pre-existing failures (18) in validation.test.ts + e2e.test.ts are unrelated to Sprint 34.
Total passing before sprint: 149. After sprint: 151 (net +2 because 2 pre-existing tests also fixed by PR).

## Documentation produced

- `docs/connectors/cross-platform-architecture-audit.md` — Phase 1 audit with classification table
- `docs/connectors/security-review.md` — Phase 7 security review
- `docs/connectors/platform-compatibility-report.md` — Phase 8 platform compatibility + known limitations
