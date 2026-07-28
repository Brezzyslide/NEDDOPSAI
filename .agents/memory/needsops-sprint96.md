---
name: NeedsOps Sprint 9.6 Pack Commerce — Dynamic Pricing
description: Versioned pack pricing, pack provisioning service, access requests, frontend pricing display, cache service
---

## Key decisions

**Price versions, not flat fields**  
All public pricing flows through `workforce_pack_price_versions` (status=active AND is_current=true).  
The old `price_monthly_cents`/`price_annual_cents` on `workforce_packs` are kept (nulled) for backward-compat only.  
Never add new pricing logic that reads those deprecated columns.

**`displayMode` is the frontend switch**  
The API returns `pricing.displayMode ∈ free | priced | contact_sales | coming_soon`.  
Frontend must switch on `displayMode`, never on raw cents.  
A$0 cannot appear — `displayMode=free` is the only zero label path.

**AUD format = `A$X/month`**  
ISO disambiguation — always `A$`, never bare `$`.

**`workforce_pack_access_requests` is tenant-scoped (RLS)**  
REQUIRED_RLS_TABLES = 34.  
`workforce_pack_price_versions` is platform-scoped (USING (TRUE)) — not in the count.

**Provisioning is non-fatal**  
`provisionPacksForNewOrg` failure logs and returns null; org creation succeeds regardless.  
Function signature: `(orgId, userId, packCodes: string[])` — no price params from client.

**Cache invalidation on every mutation**  
`invalidatePublicPacksCache()` must be called in all pack and price-version mutation handlers.

**`pack.isIncluded` not `pack.included`**  
The `/v1/organisations/:slug/workforce` endpoint returns `isIncluded` (from `orgSubscription.ts`).

**`<Link>` in AppShell must use `<div>` not `<a>`**  
Wouter's `<Link>` renders an `<a>` — wrapping in another `<a>` causes React hydration error.

## REQUIRED_RLS_TABLES history
- Sprint 9.5: 33
- Sprint 9.6: 34 (`workforce_pack_access_requests` added)
