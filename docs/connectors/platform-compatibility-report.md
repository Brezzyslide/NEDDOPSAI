# Platform Compatibility Report
## NeedsOps Desktop Connector — Sprint 34

> **Date:** August 2026  
> **Status:** macOS production-ready. Windows shippable. Linux AppImage build added.

---

## macOS

| Feature | Status | Notes |
|---|---|---|
| Installer | ✅ DMG (arm64 + x64) | Universal binary; Apple Silicon and Intel |
| Credential storage | ✅ Keychain (via safeStorage) | Hardware-backed via Secure Enclave on Apple Silicon |
| Window chrome | ✅ hiddenInset title bar | Native macOS look with traffic-light buttons |
| System tray | ✅ Menu bar icon (16×16 template) | Auto-adapts dark/light mode |
| Keep-alive on window close | ✅ Yes — stays in menu bar | Standard macOS app convention |
| Auto-launch | ✅ Login Items | Visible in System Settings → General → Login Items |
| Notifications | ✅ Yes | macOS notification centre |
| Broker spawn | ✅ System node (dev) / bundled node (packaged) | |
| Relay (outbound WSS) | ✅ Cross-platform | Unchanged |
| Activation | ✅ Platform sends "macos" to API | Correct |
| Runtime discovery | ✅ Searches Homebrew, /usr/local/bin, ~/.local/bin | |
| Auto-updater | ⚠️ Config present, not implemented | Dependency installed; `checkForUpdates()` not wired |

**Verdict: Production-ready.** macOS was the original target platform. No regressions from Sprint 34 refactor.

---

## Windows

| Feature | Status | Notes |
|---|---|---|
| Installer | ✅ NSIS x64 | `.exe` in `/release` |
| Credential storage | ✅ DPAPI (via safeStorage) | User-scoped; requires authenticated session |
| Window chrome | ✅ Default title bar | Standard Windows appearance |
| System tray | ✅ Notification area | Supported by Electron |
| Keep-alive on window close | ✅ No — quits on window close | Correct Windows convention |
| Auto-launch | ✅ Registry (HKCU Run key) | Via Electron `app.setLoginItemSettings()` |
| Notifications | ✅ Toast notifications | Requires packaged build (App User Model ID) |
| Broker spawn | ✅ `windowsHide: true` | Prevents console flash |
| Broker DB path | ✅ Fixed — uses `os.homedir()` | Was: `process.env.HOME` (unreliable on Windows) |
| Relay (outbound WSS) | ✅ Cross-platform | Unchanged |
| Activation | ✅ Platform sends "windows" to API | Fixed in Sprint 34 (was "win32") |
| Runtime discovery | ✅ Searches PROGRAMFILES, LOCALAPPDATA | |
| Auto-updater | ⚠️ Config present, not implemented | Same as macOS |

**Known limitations:**
- vLLM on Windows requires WSL2. The adapter detects the HTTP API endpoint if WSL2 is running and the port is forwarded.
- UI was designed on macOS. Minor spacing/font differences on Windows are expected. Not a functional issue.

**Verdict: Shippable with the DB path fix (applied in Sprint 34). Recommend testing on a clean Windows 10 and Windows 11 machine before first external release.**

---

## Linux

| Feature | Status | Notes |
|---|---|---|
| Installer | ✅ AppImage (x64 + arm64) | Added in Sprint 34. Self-contained; no install step |
| Credential storage | ⚠️ libsecret (if available) | Falls back to Chromium obfuscation if no keyring |
| Window chrome | ✅ Default title bar | Standard on most Linux DEs |
| System tray | ⚠️ Supported on GNOME/KDE/XFCE | GNOME requires AppIndicator extension |
| Keep-alive on window close | ✅ No — quits on window close | Correct Linux convention |
| Auto-launch | ✅ XDG autostart | Writes `~/.config/autostart/NeedsOps AI+.desktop` |
| Notifications | ✅ libnotify | Works on most DEs; not available headless |
| Broker spawn | ✅ `windowsHide: false` | Not needed on Linux; correct |
| Broker DB path | ✅ `os.homedir()` | Correct on Linux |
| Relay (outbound WSS) | ✅ Cross-platform | Unchanged |
| Activation | ✅ Platform sends "linux" to API | Fixed in Sprint 34 |
| Runtime discovery | ✅ Searches /usr/local/bin, ~/.local/bin, conda/mamba paths | |
| Auto-updater | ⚠️ Not configured for Linux | AppImage updates require AppImageUpdate or manual re-download |

**Known limitations:**
- **Headless Linux:** `safeStorage` encryption not available without a keyring daemon (libsecret). Falls back to base64 obfuscation (pre-existing behaviour). NeedsOps Desktop is designed for desktop Linux only — headless operation is not a supported configuration.
- **GNOME tray:** GNOME 40+ hides tray icons by default. Users need the AppIndicator GNOME extension.
- **systemd user services:** Auto-launch via XDG autostart works for most users. systemd user service support is not implemented but can be added as a future enhancement.
- **AppImage distribution:** AppImage builds have not been end-to-end tested on hardware. Recommend testing on Ubuntu 22.04 LTS, Ubuntu 24.04 LTS, and Fedora 40 before external release.
- **Auto-updater:** AppImage does not support electron-updater's built-in GitHub releases mechanism without AppImageUpdate. Manual re-download required for now.

**Verdict: Architecture and packaging are in place. AppImage build is configured. Requires hardware testing before external release.**

---

## Future Platform Extensibility

The `IPlatformAdapter` and `IRuntimeAdapter` interfaces were designed to support future execution environments without redesigning the connector.

| Future Target | What's needed |
|---|---|
| Docker-hosted runtimes | `DockerRuntimeAdapter` implementing `IRuntimeAdapter`; probe Docker daemon socket |
| Remote GPU servers | `RemoteGpuRuntimeAdapter`; HTTP probe against GPU server API |
| Kubernetes workers | `KubernetesRuntimeAdapter`; probe kube API or custom health endpoint |
| Hybrid cloud/local | `HybridRuntimeAdapter`; combines local + remote probes, reports both |

The connector core (`IGatewayAdapter`, relay client, auth, store) does not need to change for any of the above.

---

## Remaining Limitations (All Platforms)

| Limitation | Platform | Priority |
|---|---|---|
| Auto-updater not wired (`electron-updater` installed, `checkForUpdates()` not called) | All | Medium |
| Windows: NSIS is x64 only (arm64/Windows on ARM not supported) | Windows | Low |
| Linux: AppImage not hardware-tested | Linux | High (before external release) |
| Linux: GNOME tray requires extension | Linux | Low (document, not fix) |
| Linux: headless keyring fallback to base64 | Linux | Low (expected limitation) |
| Linux: auto-updater requires AppImageUpdate or manual re-download | Linux | Medium |
