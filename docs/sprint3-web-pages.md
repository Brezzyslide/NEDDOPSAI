# Sprint 3 — Web Pages

## New Pages

### Plan Page — `/app/:slug/plan`

File: `artifacts/needsops-web/src/pages/app/PlanPage.tsx`

Displays:
- Current plan name, status, and trial countdown (if on trial)
- Trial warning bar (appears when ≤7 days remaining)
- Seat usage gauge with progress bar (colour: cyan → amber → red)
- Subscription detail (version tag, billing cycle, period dates)
- Workforce packs — included (✓) vs locked (🔒) grid
- Execution capabilities included in the plan
- Upgrade CTA for non-enterprise orgs (email contact)

**Data sources**: `/subscription`, `/entitlements`, `/seats`, `/workforce` (all org-scoped)

---

### Usage Page — `/app/:slug/usage`

File: `artifacts/needsops-web/src/pages/app/UsagePage.tsx`

Displays:
- Warning banners at the top for any dimension ≥ 80% (amber) or 100% (red)
- All 13 dimensions grouped by category (Compute, Access, Workflow, Integrations, Data)
- Per-dimension card: label, icon, progress bar, used / limit text
- Unlimited dimensions show a static bar + "Unlimited" label
- Storage formatted as GB/MB; retention in days
- Auto-refreshes every 30 seconds

**Data sources**: `/usage` (org-scoped)

---

## Updated Pages

### AppDashboard — `/app/:slug`

File: `artifacts/needsops-web/src/pages/app/AppDashboard.tsx`

**Sprint 3 additions** (three new widget cards above existing metric grid):
1. **Current Plan** — plan name, status badge (with trial countdown), links to Plan page
2. **Team Seats** — used/limit with mini progress bar, links to Plan page
3. **Usage Health** — green ✓ if all dimensions healthy, amber ⚠ with top warning dimension if not

---

## Navigation

`AppShell.tsx` now includes two new nav items:

| Icon | Label | Path |
|---|---|---|
| 💎 | Plan | `/app/:slug/plan` |
| 📊 | Usage | `/app/:slug/usage` |

Positioned between Team and Audit in the sidebar.

---

## Route Registration (App.tsx)

```tsx
<Route path="/app/:slug/plan" component={PlanPage} />
<Route path="/app/:slug/usage" component={UsagePage} />
```

Added before the settings and audit routes (order matters in wouter's Switch).
