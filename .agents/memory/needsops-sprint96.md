---
name: NeedsOps Sprint 9.6 — Pack Commerce
description: DB-driven pack catalogue, Platform Pack Builder, landing page showcase, onboarding picker, in-app marketplace
---

## Key Facts

- **workforce_packs** table now has: `code` (UNIQUE NOT NULL), `marketing_tagline`, `icon_emoji`, `color_hex`, `price_monthly_cents`, `price_annual_cents`, `currency`, `display_order`, `featured`, `is_publicly_visible`
- **pack_status enum** now includes `draft` and `archived` (in addition to `available`, `coming_soon`)
- 6 packs seeded: `core` (free, included), `compliance` ($299/mo), `operations` ($299/mo), `finance` ($299/mo), `hr` ($299/mo), `marketing` ($399/mo, coming_soon, not visible)
- 4 old legacy test packs (UUIDs as ids) also exist in the DB — they have `code = id` and `is_publicly_visible = FALSE`
- **Public catalogue** (`GET /v1/workforce-packs`) filters to `is_publicly_visible = TRUE` only
- **Platform Pack Builder** at `/v1/platform/packs/*` — full CRUD; requires `requirePlatformAuth`
- **Onboarding** is now 4 steps — step 4 is pack picker; posts `initialWorkforcePacks` array to org creation endpoint
- **PlanPage** marketplace now shows locked packs with pricing and "Request access" mailto links

## DB note
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` is safe to re-run. The NOT NULL on `code` required first updating legacy rows (`UPDATE workforce_packs SET code = id WHERE code IS NULL`).

## Outstanding
- `taskService.ts` auto-dispatch on approval (deferred from Sprint 9.5) still not wired
- `POST /v1/organisations/:slug/pack-requests` endpoint not yet built (Plan page uses mailto fallback)
- Onboarding's `initialWorkforcePacks` param needs to be consumed by the org creation route (currently ignored — packs are set by platform admin)
