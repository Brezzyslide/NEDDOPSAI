---
name: NeedsOps Task #34 Connector & Device Fleet Management
description: Platform device fleet routes, platformDeviceService, Connector Fleet UI page, Devices tab in org detail, DB disable columns.
---

# Task #34 — Connector & Device Fleet

## What was built
- `lib/db/src/schema/devices.ts` — added `isPlatformDisabled`, `platformDisabledAt`, `platformDisabledBy`, `platformDisabledReason` (reversible disable, separate from permanent revoke)
- `lib/db/migrations/0034_devices_platform_disable.sql` — migration applied via psql
- `artifacts/api-server/src/services/platformDeviceService.ts` — all platform query and action functions
- `artifacts/api-server/src/routes/v1/platformDevices.ts` — fleet routes mounted at `/v1/platform/devices`
- `artifacts/api-server/src/routes/v1/platform.ts` — mounts `platformDevicesRouter` at `/devices`
- `artifacts/api-server/src/routes/v1/platformOrgs.ts` — org-detail `GET /:id` now returns `deviceCount` (replaced placeholder)
- `artifacts/needsops-web/src/pages/platform/PlatformConnectorFleet.tsx` — fleet page at `/platform/connector-fleet`
- `artifacts/needsops-web/src/pages/platform/PlatformOrgDetail.tsx` — added Devices tab
- `artifacts/needsops-web/src/lib/platformApi.ts` — added "Connector Fleet" to `PLATFORM_NAV`
- `artifacts/needsops-web/src/App.tsx` — registered `/platform/connector-fleet` route

## Key decisions

**Stale threshold**: >5 min = offline, computed at query time, never stored. See `computeOnlineStatus()`.

**Disable vs revoke**: Disable is reversible (`isPlatformDisabled` boolean + metadata columns). Revoke is permanent (`status = revoked`, `revokedAt`). Both are audited.

**Credential rotation**: Revokes active credentials in `device_credentials`, sets device `status = pending`. No new token issued by platform — device owner must re-activate.

**No secrets in responses**: `platformDeviceService` never queries `tokenHash` or `webhookSecretHash`. Verified by test.

**Rate limiting**: 20 actions/hr per platform user, in-process map in `platformDeviceService.checkActionRateLimit()`, enforced in route layer (same pattern as orgProvisioningService).

**Test location**: Tests must go in `src/__tests__/task34-*.test.ts`. The `src/services/__tests__/` subdirectory is NOT picked up by vitest (default include only finds top-level `__tests__`).

## Test count
2120 tests in 49 files (12 new from Task #34).
