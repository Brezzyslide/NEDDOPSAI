---
name: NeedsOps Sprint 9.7 Owner Control Plane
description: Schema changes, new API routes, UI pages, and invariants from the Owner Portal Control Plane sprint.
---

## What changed

**Schema (migration: sprint97-owner-control-plane.sql):**
- `org_status` enum: now 7 values — onboarding, trial, active, past_due, restricted, suspended, closed
- `platform_role` enum: original Sprint 4 names retained; added platform_admin, platform_commercial, platform_operations, platform_support, platform_security
- `organizations` table: added execution_frozen, login_disabled, suspension_reason, closure_reason, closed_at, closed_by, status_changed_at, status_changed_by, legal_name, trading_name, support_status (default 'normal')
- `seat_overrides` table: new platform table (no tenant RLS needed); columns: id, organization_id, seat_allowance (nullable=unlimited), override_reason, set_by, effective_from, effective_to, revoked

**New route files:**
- `platformPackGrants.ts` — mounted at /packs in platform.ts
- `platformStaff.ts` — mounted at /staff in platform.ts
- `platformTrials.ts` — extended (extend/cancel/convert added)

**New UI pages:**
- `PlatformStaff.tsx` — /platform/staff

## Key invariants

- seat_overrides has NO per-org RLS — it's a platform table accessed only by platform staff routes
- Closing an org always sets executionFrozen=true AND loginDisabled=true
- Freezing (not closing) does NOT set loginDisabled
- Cannot unfreeze a suspended or closed org
- Last platform_super_admin cannot be revoked (409 guard in platformStaff.ts)
- platform_admin cannot grant/revoke platform_super_admin (only super_admin can)
- Trial convert sources: manual, invoice, bank_transfer, enterprise_contract, pilot, future_stripe, reseller
- REQUIRED_RLS_TABLES remains 34 (seat_overrides is excluded from RLS check)

**Why:** seat_overrides is platform-admin-only, never queried through the tenant connection pool, so no RLS policy needed. Trying to add it to REQUIRED_RLS_TABLES would cause startup to fail.

## Tests

707 total (75 new in sprint97-owner-control-plane.test.ts)
