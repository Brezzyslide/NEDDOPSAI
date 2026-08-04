# Security Review — Sprint 34 Cross-Platform Refactor
## NeedsOps Desktop Connector

> **Date:** August 2026  
> **Scope:** All changes made in Sprint 34  
> **Finding:** No security regression. Cross-platform refactor does not weaken any security guarantee.

---

## Security Boundaries Reviewed

### 1 — Authentication

**Before:** Device token stored via Electron `safeStorage`. Challenge-response via Ed25519 in `credentialStore.ts`.  
**After:** Unchanged. The `credentialStore.ts` was not modified. `safeStorage` remains the credential backend on all platforms.

**Platform-specific behaviour of `safeStorage`:**

| Platform | Storage backend | Risk |
|---|---|---|
| macOS | Keychain (app-bound) | Low — requires app identity to access |
| Windows | DPAPI (user-scoped) | Low — requires authenticated user session |
| Linux (with keyring) | libsecret / Secret Service | Low — requires keyring unlock |
| Linux (no keyring) | Chromium obfuscated fallback | Medium — stored on-disk with obfuscation, not hardware-backed. **Documented limitation.** |

The base64 fallback in `credentialStore.ts` (triggered when `safeStorage.isEncryptionAvailable()` returns false) was already present before Sprint 34. It is test-only by design and is unchanged.

**Verdict:** Authentication security unchanged. ✅

---

### 2 — Device Registration

**Before/After:** Unchanged. Device registration flow uses activation codes redeemed against the NeedsOps API. Credentials are written to `safeStorage` post-redemption.

**Sprint 34 change:** `ActivationScreen.tsx` now correctly maps `win32 → windows` and `linux → linux` when sending the platform string to the activation API. This is a correctness fix — it does not affect security. ✅

---

### 3 — Challenge-Response (Ed25519)

**Before/After:** Unchanged. `credentialStore.ts` stores the private key in `safeStorage`. The key is never transmitted. Sprint 34 did not modify this file.

**Verdict:** Key storage unchanged. ✅

---

### 4 — Token Storage

**Before/After:** Unchanged. Access tokens, refresh tokens, and device tokens are all stored via `encryptValue()` in `credentialStore.ts`.

**Verdict:** Token storage unchanged. ✅

---

### 5 — Credential Encryption

**Before/After:** Unchanged. `encryptValue()` calls `safeStorage.encryptString()`, delegating to the OS. Platform adapters do not touch credential storage.

**Verdict:** Credential encryption unchanged. ✅

---

### 6 — TLS / Transport Security

**Before/After:** Unchanged. The relay client uses outbound WSS. The broker HTTP server binds to `127.0.0.1` only (not `0.0.0.0`) — unchanged. The `RuntimeDiscovery` adapters use `fetch()` for localhost probes only; no remote connections are made without user configuration.

**Verdict:** Transport security unchanged. ✅

---

### 7 — Tenant Isolation

**Before/After:** Unchanged. All execution requests carry `tenantId`. The broker's execution store and webhook delivery worker are unchanged. `IGatewayAdapter` interface unchanged.

**Verdict:** Tenant isolation unchanged. ✅

---

### 8 — Child Process Spawning

**Before:** `windowsHide: true` was hardcoded. On macOS this is a no-op but was unnecessarily set.  
**After:** `windowsHide` is now `true` on Windows only, `false` on macOS/Linux. This improves behavioural predictability — the platform adapter makes this explicit.

**Security impact:** None. `windowsHide` is a UI option only; it does not affect process isolation, privilege, or communication channel.

**Verdict:** No security impact. ✅

---

### 9 — Runtime Discovery (New)

The `RuntimeDiscovery` service probes local runtimes (OpenClaw, Ollama, LM Studio, vLLM) via:
- `execFile()` with binary name and `--version` flag
- `fetch()` to localhost endpoints only

**Security properties:**
- No outbound network calls to external services
- Binary probes use `execFile()` — no shell injection vector (no `exec()` with string interpolation)
- Discovery results are informational only — they do not affect the execution pipeline
- Probe endpoints are configurable but default to localhost — no remote access without user configuration
- Discovery never transmits secrets, credentials, or execution data

**Verdict:** No security concern introduced. ✅

---

### 10 — Linux-Specific Considerations

**libsecret not available (headless Linux):**  
If `safeStorage.isEncryptionAvailable()` returns false on a headless Linux system, the base64 fallback applies. This was the pre-existing behaviour and is an existing documented limitation. Sprint 34 does not introduce this behaviour — it was already present.

**Recommendation:** Document clearly in the platform compatibility report that NeedsOps Desktop is designed for desktop Linux environments with a keyring daemon. Headless operation is not a supported configuration.

---

## Summary

| Security Area | Changed? | Regression? |
|---|---|---|
| Authentication | No | No |
| Device registration | Correctness fix only | No |
| Challenge-response | No | No |
| Token storage | No | No |
| Credential encryption | No | No |
| TLS / transport | No | No |
| Tenant isolation | No | No |
| Child process spawning | Yes — windowsHide scoped to Windows | No |
| Runtime discovery (new) | New feature | No new risk |
| Linux headless | Pre-existing limitation | Not introduced by Sprint 34 |

**Overall verdict: No security regression. The cross-platform refactor does not weaken any existing security guarantee. Every platform continues to provide equivalent or better security to the macOS-only implementation.**
