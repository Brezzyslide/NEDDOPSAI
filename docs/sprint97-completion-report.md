# Sprint 9.7 — Owner Portal Control Plane: Completion Report

**Date:** 2026-07-28  
**Sprint objective:** Turn the existing read-mostly Platform Console into a full operating control plane — org lifecycle, packs, trials, subscriptions, seats, staff, and runtime governance — without touching the database directly.  
**Exclusions (per spec):** Stripe, AWS OpenClaw deployment, local-device runtime, unrelated connectors.

---

## Delivery Summary

### Schema Changes

| Change | Detail |
|---|---|
| `org_status` enum | Added `trial`, `past_due`, `restricted` (was: onboarding, active, suspended, closed) |
| `platform_role` enum | Added `platform_admin`, `platform_commercial`, `platform_operations`, `platform_support`, `platform_security` (all original Sprint 4 roles retained) |
| `organizations` table | Added: `execution_frozen` (bool), `login_disabled` (bool), `suspension_reason`, `closure_reason`, `closed_at`, `closed_by`, `status_changed_at`, `status_changed_by`, `legal_name`, `trading_name`, `support_status` (default `normal`) |
| `seat_overrides` table | New table: per-org seat allowance overrides with effective date range and revocation. |

Migration: `lib/db/migrations/sprint97-owner-control-plane.sql` — idempotent, applied.  
Drizzle schema rebuilt: `pnpm --filter @workspace/db exec tsc --build` ✓

---

### New API Endpoints

#### Organisation Control (`/v1/platform/organisations/:id/…`)

| Method | Path | Role Required | Action |
|---|---|---|---|
| `PATCH` | `/platform/organisations/:id` | `platform_admin` | Edit name, legalName, tradingName, displayName, supportStatus |
| `POST` | `/platform/organisations/:id/close` | `platform_super_admin` | Close org; sets executionFrozen=true, loginDisabled=true |
| `POST` | `/platform/organisations/:id/freeze-execution` | `platform_operations` or `platform_security` | Block new AI runs; existing sessions complete |
| `POST` | `/platform/organisations/:id/unfreeze-execution` | `platform_operations` | Restore AI execution |
| `POST` | `/platform/organisations/:id/disable-logins` | `platform_security` | Prevent new logins |
| `POST` | `/platform/organisations/:id/enable-logins` | `platform_security` | Restore login access |

#### Subscription Management (`/v1/platform/organisations/:id/subscription`)

| Method | Path | Role Required | Action |
|---|---|---|---|
| `POST` | `…/subscription` | `platform_commercial` | Create or replace subscription |
| `PATCH` | `…/subscription` | `platform_commercial` | Update plan/version/status |
| `POST` | `…/subscription/pause` | `platform_commercial` | Set status=suspended |
| `POST` | `…/subscription/resume` | `platform_commercial` | Restore from suspended |
| `POST` | `…/subscription/cancel` | `platform_commercial` | Set status=cancelled |

#### Seat Overrides (`/v1/platform/organisations/:id/seats`)

| Method | Path | Role Required | Action |
|---|---|---|---|
| `GET` | `…/seats` | platform auth | Current seat allowance + active override + history |
| `POST` | `…/seats/override` | `platform_commercial` | Create override (null = unlimited) |
| `DELETE` | `…/seats/override/:oid` | `platform_commercial` | Revoke override |

#### Trial Actions (`/v1/platform/trials/:id/…`)

| Method | Path | Role Required | Action |
|---|---|---|---|
| `POST` | `/platform/trials/:id/extend` | `platform_commercial` | Extend by N days |
| `POST` | `/platform/trials/:id/cancel` | `platform_commercial` | Expire trial immediately |
| `POST` | `/platform/trials/:id/convert` | `platform_commercial` | Convert to active; sources: manual/invoice/bank_transfer/enterprise_contract/pilot/future_stripe/reseller |

#### Pack Grants (`/v1/platform/packs/:code/…`)

New file: `artifacts/api-server/src/routes/v1/platformPackGrants.ts`  
Mounted at `/packs` in `platform.ts`.

| Method | Path | Role Required | Action |
|---|---|---|---|
| `GET` | `/platform/packs/:code/organisations` | platform auth | List orgs with this pack |
| `POST` | `/platform/packs/:code/grant` | `platform_commercial` | Grant pack to org |
| `POST` | `/platform/packs/:code/revoke` | `platform_commercial` | Revoke pack from org |
| `POST` | `/platform/packs/:code/start-trial` | `platform_commercial` | Start pack trial for org |
| `POST` | `/platform/packs/:code/extend-trial` | `platform_commercial` | Extend active pack trial |

#### Staff Management (`/v1/platform/staff/…`)

New file: `artifacts/api-server/src/routes/v1/platformStaff.ts`  
Mounted at `/staff` in `platform.ts`.

| Method | Path | Role Required | Action |
|---|---|---|---|
| `GET` | `/platform/staff` | `platform_admin` | List all active platform staff with user details |
| `POST` | `/platform/staff/invite` | `platform_admin` | Grant a platform role (super_admin cannot be granted by non-super-admin) |
| `DELETE` | `/platform/staff/:userId/roles/:role` | `platform_admin` | Revoke role (last super-admin protected — 409 if would create zero) |
| `POST` | `/platform/staff/:userId/suspend` | `platform_admin` | Revoke ALL active roles for user |
| `GET` | `/platform/staff/:userId/activity` | `platform_admin` | Last 20 privileged actions by this staff member |

---

### New Audit Event Types (17 new)

All in `lib/shared/src/index.ts` `AUDIT_EVENTS`:

```
platform.organisation_updated    platform.organisation_closed
platform.execution_frozen         platform.execution_unfrozen
platform.logins_disabled          platform.logins_enabled
platform.pack_granted             platform.pack_revoked
platform.pack_trial_started       platform.pack_trial_extended
platform.seat_override_created    platform.seat_override_revoked
platform.subscription_paused      platform.subscription_resumed
platform.subscription_cancelled   platform.subscription_created
platform.platform_staff_suspended
```

---

### UI Changes

#### `PlatformOrgDetail.tsx` (expanded)
- **Status badges**: `🧊 Execution Frozen` (red) and `🚫 Logins Disabled` (amber) banners in header
- **Action buttons**: Freeze Execution (amber), Unfreeze Execution (green), Close Organisation (red — super_admin only)
- **Subscription tab**: Convert Trial / Extend Trial / Cancel Trial buttons; calls trial action endpoints
- **Pack Admin tab**: Grant pack (code + reason + source) and Revoke per-pack

#### `PlatformTrials.tsx` (upgraded to action centre)
- Per-row actions: Extend (prompt days), Cancel (confirm), Convert (inline form with source selector + dates)
- Filter tabs: All / Expiring Soon (7d) / Expired / Active

#### `PlatformDashboard.tsx` (actionable items panel)
- Pending pack requests count → links to `/platform/pack-access-requests`
- Trials expiring in 7 days count → links to `/platform/trials`
- Onboarding orgs count → links to `/platform/organisations?status=onboarding`

#### `PlatformStaff.tsx` (new page at `/platform/staff`)
- Staff table: name, email, role badge (colour-coded by role), granted date
- Actions: Revoke (per-role), Suspend (all roles), View Activity (inline row expansion)
- Invite side panel: userId input, role selector, reason textarea
- Role badge colour system: super_admin=violet, admin=blue, commercial=emerald, operations=amber, support=sky, security=red, auditor=slate, developer=cyan

#### `App.tsx` + `PlatformShell.tsx`
- `/platform/staff` route registered
- Staff nav item added to platform navigation

---

### Tests

**File:** `artifacts/api-server/src/__tests__/sprint97-owner-control-plane.test.ts`  
**75 new tests** across:

| Suite | Tests |
|---|---|
| `org_status` enum | 4 |
| `platform_role` enum | 4 |
| Organization schema fields | 3 |
| Seat override resolution | 8 |
| Trial extension logic | 3 |
| Trial conversion validation | 6 |
| Subscription status logic | 5 |
| Pack grant validation | 6 |
| Platform staff role constraints | 8 |
| Org lifecycle state machine | 12 |
| Support status logic | 4 |
| Org PATCH validation | 5 |
| Route permission matrix (security) | 5 |
| Audit events | 3 |

---

## Test Results

```
Test Files  22 passed (22)
     Tests  707 passed (707)    ← 75 new from Sprint 9.7
  Duration  14.42s
```

Previous total: 632 tests  
Sprint 9.7 additions: +75 tests  
RLS tables verified: 34 ✓ (seat_overrides is a platform table; no tenant-scoped RLS required)

---

## Invariants Preserved

| Invariant | Status |
|---|---|
| All 632 previous tests pass | ✓ |
| RLS table count = 34 | ✓ |
| lib/db rebuilt after schema changes | ✓ |
| Migration applied before API restart | ✓ |
| AUD prices displayed as `A$X` | ✓ (existing displayMode logic unchanged) |
| packProvisioningService signature unchanged | ✓ |
| No Stripe, no AWS OpenClaw, no unrelated connectors | ✓ |

---

## What Was Not Implemented (by spec exclusion or deferral)

| Item | Reason |
|---|---|
| Stripe payment processing | Explicitly out of scope per spec |
| AWS OpenClaw deployment control | Explicitly out of scope per spec |
| Local-device runtime | Explicitly out of scope per spec |
| Two-factor enforcement for super-admin actions | Deferred — requires Clerk MFA integration |
| Bulk org operations (batch suspend, export) | Not in Sprint 9.7 spec |
| Email notifications on org closure/freeze | Deferred — no email provider configured yet |
