# Sprint 9.6 — Dynamic Workforce Pack Pricing: Completion Report

**Completed:** 2026-07-27  
**Tests:** 632 passing (21 test files, up from 591)  
**New tests:** 41 (in `sprint96-pricing.test.ts`)  
**RLS-verified tables:** 34 (up from 33)

---

## What was built

### 1. Schema — versioned pricing architecture

**New tables**

| Table | Purpose |
|---|---|
| `workforce_pack_price_versions` | Owner-controlled price versions per pack; `status` ∈ `{draft, active, superseded, archived}`, `is_current` flag, `effective_from/to`, `monthly_price_cents`, `annual_price_cents`, `currency` |
| `workforce_pack_access_requests` | Tenant requests for packs they cannot self-provision; `status` ∈ `{pending, approved, rejected, cancelled}`, `reviewed_by`, `source` |

**Additions to `workforce_packs`**

New columns: `is_free`, `pricing_status` (enum: `not_configured`, `contact_sales`, `coming_soon`), `fallback_display_text`, `auto_grant_on_signup`, `trial_eligible`, `trial_length_days`, `requires_manual_approval`, `requires_payment`, `publicly_selectable`, `selection_mode`.

Deprecated but retained for backward-compat: `price_monthly_cents`, `price_annual_cents` — nulled out for paid packs by migration.

**Additions to `tenant_workforce_packs`**

New columns: `status` (new `tenant_pack_status` enum), `price_version_id`, `trial_started_at`, `trial_ends_at`, `activated_at`, `requested_by`, `approved_by`.  
`pack_grant_source` enum extended to 10 values: `onboarding_trial`, `manual_grant`, `individual_purchase`, `enterprise_contract`, `tenant_override`, `core_auto` added.

### 2. Migration

`lib/db/migrations/sprint96-dynamic-pricing.sql`

- Creates both new tables with indexes and RLS policies
- Adds all new columns to existing tables
- Seeds Core Pack as `is_free = true`
- Nulls seeded prices for paid packs (idempotent — only touches rows with `pricing_status = 'not_configured'`)
- Applied successfully against live dev DB

### 3. Pack provisioning service

`artifacts/api-server/src/services/packProvisioningService.ts`

`provisionPacksForNewOrg(orgId, userId, packCodes[])`:
- Always grants Core Pack as `core_auto`
- For each selected code evaluates `selection_mode`:
  - `trial` + `trial_eligible` → grants with `status=trial`, sets `trial_ends_at`
  - `requested` / `requires_manual_approval` → creates access request
  - Archived / non-publicly-selectable → rejected (non-fatal)
- Returns `{ granted, requested, rejected }` in org creation response
- Provisioning failure is non-fatal — org creation succeeds regardless

### 4. Pack cache service

`artifacts/api-server/src/services/packCacheService.ts`

5-minute in-process TTL cache for the public pack catalogue. `invalidatePublicPacksCache()` is called on all price and pack mutations so stale data is never served.

### 5. API routes

| Route | Change |
|---|---|
| `GET /v1/workforce-packs` | Returns structured `pricing` object: `{ isFree, displayMode, currency?, monthlyPriceCents?, annualPriceCents?, fallbackText? }`. `displayMode` ∈ `free \| priced \| contact_sales \| coming_soon`. Flat price fields zeroed out for backward-compat. |
| `POST /v1/organisations` | Accepts `initialWorkforcePacks[]`, calls `provisionPacksForNewOrg`, includes provisioning result in response |
| `GET/POST /v1/platform/packs/:code/prices` | List / create draft price versions |
| `PATCH /v1/platform/packs/:code/prices/:vid` | Update draft version |
| `POST /v1/platform/packs/:code/prices/:vid/activate` | Activate; supersedes previous active for same currency |
| `POST /v1/platform/packs/:code/prices/:vid/archive` | Archive |
| `POST /v1/organisations/:slug/pack-access-requests` | Tenant submits pack request |
| `GET /v1/organisations/:slug/pack-access-requests` | Tenant views own requests |
| `GET /v1/platform/pack-access-requests` | Platform views all pending requests |
| `POST /v1/platform/pack-access-requests/:id/approve\|reject` | Platform approves or rejects |

### 6. Frontend updates

**`LandingPage.tsx`**

- `Pack` interface updated to use `pricing: PackPricing` (removed flat `priceMonthly`/`priceMonthlyAud`)
- `PackCard` component now uses `formatPackPrice()` helper which maps `displayMode` to display strings
- Free → `"Free"` / priced → `"A$299/month"` / contact_sales → `"Contact NeedsOps"` / coming_soon → text from `fallbackText`
- A$0 display eliminated — `displayMode=free` is the only zero-price path

**`OrgOnboarding.tsx` — Step 4**

- `Pack` interface updated with `pricing`, `trialEligible`, `trialLengthDays`, `selectionMode`
- Price labels: free → `"Free"`, priced + trial → `"A$X/month after trial"`, contact_sales → `"Contact NeedsOps for pricing"`
- Non-publicly-selectable packs filtered from picker

**`PlanPage.tsx` — locked packs marketplace**

- Fixed `pack.included` → `pack.isIncluded` (was always wrong — workforce endpoint returns `isIncluded`)
- Replaced static mailto links with `LockedPacksMarketplace` component:
  - Fetches current pricing from `/v1/workforce-packs` catalogue
  - Shows per-pack pricing (A$ formatted)
  - Tenant status badges: Trial active / Trial expired / Requested / Pending payment / Suspended
  - "Request access →" button POSTs to `/v1/organisations/:slug/pack-access-requests`
  - Disables request button when already in `requested` state; shows "Requested ✓"
  - Invalidates `["org-workforce"]` query on success

**`PlatformPacksPage.tsx` — pricing panel**

- Removed deprecated flat `priceMonthly`/`priceAnnual` fields from create/edit form
- Added "isFree" checkbox in pack form (replaces implicit zero-price logic)
- Added "💰 Pricing" button per pack that opens a new versioned pricing panel:
  - Lists all price versions with status badges (Draft / Active / Superseded / Archived) and Current indicator
  - Per-version: monthly, annual in A$ format, internal notes, created date
  - "Activate" button on draft versions (supersedes current active)
  - "Archive" button on draft/active versions
  - "+ New draft price version" form: currency, monthly (in dollars), annual (in dollars), notes
  - Refreshes pack list after each mutation (pricing display updates immediately)
  - Free packs show a locked message instead of version list

**`AppShell.tsx`**

- Fixed nested `<a>` hydration error — Platform Console nav item now uses `<div>` inside `<Link>` instead of `<a>` inside `<Link>`

---

## Testing (41 new tests)

`artifacts/api-server/src/__tests__/sprint96-pricing.test.ts`

| Suite | Tests | What it covers |
|---|---|---|
| Pricing display helpers | 8 | free, priced, contact_sales, coming_soon, draft/superseded not shown publicly, A$0 not shown |
| AUD currency formatting | 3 | A$ prefix, cents to dollars, thousands separator |
| Pricing validation rules | 6 | negative prices, free-with-nonzero, missing currency, valid paid price |
| Pack provisioning | 11 | Core always granted, no duplicate Core, unknown rejected, archived rejected, non-selectable rejected, trial granted with correct dates, approval-required creates request, price not in provisioning params, idempotency, multiple packs |
| Seed data integrity | 3 | paid packs have null prices post-migration, Core is_free=true, seed idempotency |
| Pack access request validation | 4 | missing code, nonexistent pack, archived pack, valid request |
| Security invariants | 3 | provisionPacksForNewOrg signature has no price params, displayMode=priced requires both current+active, internal fields not in public response |
| Cache service | 3 | cold cache returns null, stores/retrieves, invalidate clears |

All 632 tests pass (21 test files).

---

## Design principles upheld

- **Owner-controlled pricing** — no prices are seeded for paid packs; every price shown publicly must come from an active, current price version created by the platform admin
- **A$ formatting** — all AUD prices shown as `A$X/month` (ISO disambiguation, not bare `$`)
- **displayMode is the switch** — frontend never inspects raw cents to decide what to show; it maps `displayMode` to UI
- **A$0 cannot appear** — the only `displayMode` that shows a zero-price label is `"free"`; priced packs only display if `monthlyPriceCents > 0`
- **Non-fatal provisioning** — org creation cannot fail due to pack provisioning errors
- **Cache invalidated on mutation** — every price/pack write calls `invalidatePublicPacksCache()` so landing page, onboarding, and plan page always show current data

---

## Files created / modified

```
lib/db/src/schema/workforcePackPriceVersions.ts  (NEW)
lib/db/src/schema/workforcePackAccessRequests.ts  (NEW)
lib/db/src/schema/workforcePacks.ts               (MODIFIED — new columns)
lib/db/src/schema/tenantWorkforcePacks.ts         (MODIFIED — new columns, enum extensions)
lib/db/src/schema/index.ts                        (MODIFIED — new exports)
lib/db/migrations/sprint96-dynamic-pricing.sql    (NEW — applied)

artifacts/api-server/src/services/packProvisioningService.ts  (NEW)
artifacts/api-server/src/services/packCacheService.ts         (NEW)
artifacts/api-server/src/routes/v1/workforcePacks.ts          (MODIFIED)
artifacts/api-server/src/routes/v1/platformPacks.ts           (MODIFIED)
artifacts/api-server/src/routes/v1/organisations.ts           (MODIFIED)
artifacts/api-server/src/routes/v1/packAccessRequests.ts      (NEW)
artifacts/api-server/src/routes/v1/index.ts                   (MODIFIED)
artifacts/api-server/src/__tests__/sprint96-pricing.test.ts   (NEW — 41 tests)
artifacts/api-server/src/__tests__/sprint7-rls-safety.test.ts (MODIFIED — length 33→34)
lib/org-db/src/rlsVerifier.ts                                  (MODIFIED — 34th table)

artifacts/needsops-web/src/pages/LandingPage.tsx                      (MODIFIED)
artifacts/needsops-web/src/pages/OrgOnboarding.tsx                    (MODIFIED)
artifacts/needsops-web/src/pages/app/PlanPage.tsx                     (MODIFIED)
artifacts/needsops-web/src/pages/platform/PlatformPacksPage.tsx       (MODIFIED)
artifacts/needsops-web/src/components/layout/AppShell.tsx             (MODIFIED — nested <a> fix)
```
