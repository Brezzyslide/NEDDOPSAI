---
name: NeedsOps Relay Auth Lifecycle Bugs
description: Two bugs found during relay auth implementation and pairing verification; fixes applied
---

## Bug 1 — Drizzle `eq(col, null)` generates `= NULL` not `IS NULL`

**Rule:** Never use `eq(column, null as any)` in Drizzle 0.45.x. It generates `column = NULL` which is always false in SQL. Use `isNull(column)` instead.

**Why:** Drizzle 0.45.2 deprecated the `null` overload of `eq()`. The generated SQL `= NULL` never matches any row. This caused `authenticateDevice()` in `deviceService.ts` to always return `null`, silently breaking all challenge/exchange auth flows.

**How to apply:** Import `isNull` from `drizzle-orm` and replace all `eq(col, null as any)` with `isNull(col)`. Files fixed: `deviceService.ts` (3 occurrences). `deviceAuthService.ts` was already using `isNull` correctly.

---

## Bug 2 — `exchangeChallenge` never promoted device from `"pending"` to `"connected"`

**Rule:** After a successful `exchangeChallenge`, immediately UPDATE the device status from `"pending"` to `"connected"`.

**Why:** `refreshAccessToken` explicitly rejects devices with `status === "pending"` (interpreted as "awaiting re-activation after credential rotation"). Without the status promotion, the first token refresh after pairing always threw `DEVICE_REACTIVATION_REQUIRED`, breaking the entire relay auth lifecycle.

**How to apply:** At the end of `deviceAuthService.exchangeChallenge()`, after inserting the refresh token, add:
```typescript
if (device.status === "pending") {
  await db.update(devicesTable).set({ status: "connected" }).where(eq(devicesTable.id, deviceId));
}
```

---

## Device Status Enum

Valid values (Postgres enum `device_status`): `pending`, `connected`, `disconnected`, `revoked`.
There is NO `"active"` status — do not use it.

---

## Pairing Lifecycle Proof (verified 2026-08-11)

All 6 steps verified in a single Node.js session against the live Replit API server:
1. Redeem activation code → deviceId returned, status=pending
2. Challenge with brokerAuthToken → challengeId + nonce
3. Sign nonce with Ed25519 private key → exchange → accessToken (15m) + refreshToken (30d)
4. Refresh → both tokens rotated (old ones invalidated)
5. Old refresh token replay rejected (401)
6. Second refresh with new token → chain continues

Access token verified in `device_access_tokens` table with `audience=device-relay` and `expires_at > NOW()`.
