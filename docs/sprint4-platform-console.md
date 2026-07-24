# Sprint 4 — NeedsOps Platform Console

## Overview

Sprint 4 delivers the complete **NeedsOps Platform Console** — a staff-only operational headquarters for managing organisations, subscriptions, plans, trials, usage, support, security, and platform configuration.

**Web URL:** `/platform/*`  
**API prefix:** `/v1/platform/*`  
**Access:** Users with `publicMetadata.platformAdmin: true` or a `platform_roles` DB record

---

## Architecture

### API Route Structure

The platform console is split into focused sub-routers, mounted at `/v1/platform/`:

| Mount path | File | Description |
|---|---|---|
| `/dashboard` | `platform.ts` | Real metrics dashboard |
| `/organisations/*` | `platformOrgs.ts` | Org directory + all org actions |
| `/commercial/*` | `platformCommercial.ts` | Plan designer, versions, features, packs, usage dims, overrides |
| `/trials/*` | `platformTrials.ts` | Trial management (view, extend, cancel) |
| `/workforce/*` | `platformWorkforce.ts` | Workforce designer (metadata only) |
| `/usage-monitor/*` | `platformUsageMonitor.ts` | Cross-org usage visibility, charts, warnings |
| `/support/*` | `platformSupport.ts` | Support centre (notes, flags, overrides, timeline) |
| `/security/*` | `platformSecurity.ts` | Security overview (suspended orgs, flags, actions) |
| `/audit/*` | `platformAuditLog.ts` | Full platform audit log with filters |
| `/settings/*` | `platformSettingsAdmin.ts` | Feature flags, platform config, role management |
| `/search` | `platformSearch.ts` | Global search across orgs, users, plans, notes |
| `/export/*` | `platformExport.ts` | CSV exports for all sections |

### Authentication & Authorisation

All platform routes require:
1. **`requireAuth`** — valid Clerk JWT
2. **`requirePlatformAuth`** — user must have a record in the `platform_roles` table OR `publicMetadata.platformAdmin: true`

Role-restricted routes use `requirePlatformRole(role)`:

| Role | Permissions |
|---|---|
| `platform_super_admin` | Full access including role management, feature flags, platform config |
| `platform_operations_admin` | Suspend/reactivate orgs, create/revoke overrides |
| `platform_billing_admin` | Change plans, start/extend/cancel trials |
| `platform_support_admin` | Add internal notes, flag orgs |
| `platform_security_auditor` | Security overview, security flags |
| `platform_auditor` | Read-only access to full audit log |
| `platform_developer` | Developer access (to be scoped in Sprint 5) |

### Frontend Structure

```
artifacts/needsops-web/src/
  components/layout/PlatformShell.tsx   — sidebar layout + access guard
  lib/platformApi.ts                     — usePlatformFetch hook + nav config
  pages/platform/
    PlatformDashboard.tsx               — /platform
    PlatformOrgs.tsx                    — /platform/organisations
    PlatformOrgDetail.tsx               — /platform/organisations/:id  (13 tabs)
    PlatformCommercial.tsx              — /platform/commercial
    PlatformTrials.tsx                  — /platform/trials
    PlatformWorkforce.tsx               — /platform/workforce
    PlatformUsage.tsx                   — /platform/usage
    PlatformSupport.tsx                 — /platform/support
    PlatformSecurity.tsx                — /platform/security
    PlatformAudit.tsx                   — /platform/audit
    PlatformSettings.tsx                — /platform/settings
```

---

## DB Schema Changes (Sprint 4)

### New Tables

**`feature_flags`**
```sql
key           TEXT PRIMARY KEY
label         TEXT NOT NULL
description   TEXT
is_enabled    BOOLEAN DEFAULT false
context       JSONB DEFAULT {}
updated_by    TEXT
created_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ
```

**`platform_settings`**
```sql
key           TEXT PRIMARY KEY
value         JSONB NOT NULL
label         TEXT NOT NULL
description   TEXT
updated_by    TEXT
created_at    TIMESTAMPTZ
updated_at    TIMESTAMPTZ
```

### Modified Tables

**`plans`** — added columns:
- `trial_length_days` (INTEGER, default 14)
- `monthly_price_cents` (INTEGER, nullable — pricing placeholder until Stripe)
- `annual_price_cents` (INTEGER, nullable)
- `currency` (TEXT, default "AUD")
- `notes` (TEXT — internal staff notes)

**`platform_internal_notes`** — added columns:
- `priority` (ENUM: low | medium | high | critical, default medium)
- `category` (ENUM: support | billing | security | technical | general, default general)

**`platformRoleEnum`** — added values:
- `platform_auditor`
- `platform_developer`

---

## API Reference

### Dashboard

**`GET /v1/platform/dashboard`** — Role: any platform role
```json
{
  "metrics": {
    "totalOrganisations": 12,
    "activeOrganisations": 9,
    "suspendedOrganisations": 1,
    "organisationsOnTrial": 3,
    "trialExpired": 0,
    "activeUsers": 47,
    "totalUsers": 52,
    "tasksCreated": 1240,
    "pendingApprovals": 3,
    "usageWarnings": 2,
    "systemHealthStatus": "operational"
  },
  "recentAuditEvents": [...],
  "generatedAt": "2026-07-24T00:00:00Z",
  "note": "Revenue metrics are not available until Stripe is connected."
}
```

### Organisations

**`GET /v1/platform/organisations`** — Paginated directory
- Query params: `search`, `status`, `plan`, `trial`, `suspended`, `page`, `limit`
- Returns: `{ organisations, page, limit, total }`

**`GET /v1/platform/organisations/:id`** — Full org detail
- Returns: organisation, subscription, members, overrides, entitlements, workforce packs, notes, tasks, approvals, usage summary, seat info

**`POST /v1/platform/organisations/:id/suspend`** — Role: `platform_operations_admin`
- Body: `{ reason: string }`

**`POST /v1/platform/organisations/:id/reactivate`** — Role: `platform_operations_admin`
- Body: `{ reason: string }`

**`POST /v1/platform/organisations/:id/change-plan`** — Role: `platform_billing_admin`
- Body: `{ planCode: string, reason: string }`

**`POST /v1/platform/organisations/:id/trial/start`** — Role: `platform_billing_admin`
- Body: `{ planCode: string, days: number, reason: string }`

**`POST /v1/platform/organisations/:id/trial/extend`** — Role: `platform_billing_admin`
- Body: `{ days: number, reason: string }`

**`POST /v1/platform/organisations/:id/trial/cancel`** — Role: `platform_billing_admin`
- Body: `{ reason: string }`

**`POST /v1/platform/organisations/:id/overrides`** — Role: `platform_operations_admin`
- Body: `{ overrideType, value, reason, internalNote?, customerNote?, effectiveTo? }`

**`DELETE /v1/platform/organisations/:id/overrides/:oid`** — Role: `platform_operations_admin`
- Body: `{ reason? }`

**`POST /v1/platform/organisations/:id/internal-notes`** — Role: `platform_support_admin`
- Body: `{ content: string, priority?, category?, isFlagged? }`

### Commercial

**`GET /v1/platform/commercial/plans`** — All plans with versions and subscriber counts  
**`POST /v1/platform/commercial/plans`** — Create plan  
**`PATCH /v1/platform/commercial/plans/:id`** — Update plan metadata  
**`GET /v1/platform/commercial/plans/:id/versions`** — List all versions with features, packs, allowances  
**`POST /v1/platform/commercial/plans/:id/versions`** — Create new version (clones from active)  
**`POST /v1/platform/commercial/plans/:id/versions/:vid/activate`** — Activate a version  
**`POST /v1/platform/commercial/plans/:id/versions/:vid/archive`** — Archive a version  
**`GET /v1/platform/commercial/features`** — All feature codes grouped by category  
**`GET /v1/platform/commercial/usage-dimensions`** — All usage dimensions  
**`GET /v1/platform/commercial/overrides`** — All active overrides across all orgs  

### Settings

**`GET /v1/platform/settings/flags`** — All feature flags  
**`POST /v1/platform/settings/flags`** — Create flag (Super Admin)  
**`PATCH /v1/platform/settings/flags/:key`** — Update flag (Super Admin)  
**`GET /v1/platform/settings/config`** — All platform settings  
**`PUT /v1/platform/settings/config/:key`** — Upsert setting (Super Admin)  
**`GET /v1/platform/settings/roles`** — All platform role grants (Super Admin)  
**`POST /v1/platform/settings/roles`** — Grant platform role (Super Admin)  
**`DELETE /v1/platform/settings/roles/:userId`** — Revoke all roles for user (Super Admin)  

### Export (CSV)

All exports require platform auth and return `text/csv`:
- `GET /v1/platform/export/organisations`
- `GET /v1/platform/export/plans`
- `GET /v1/platform/export/trials`
- `GET /v1/platform/export/usage`
- `GET /v1/platform/export/support`

---

## Platform Console — Page Reference

### Dashboard (`/platform`)
- Real metrics grid (10 KPIs)
- Organisation status breakdown bar chart
- Recent audit events feed
- System health banner
- No fake/mock data anywhere

### Organisations (`/platform/organisations`)
- Searchable, filterable paginated directory
- Filter by status, plan, trial
- CSV export button
- Links to org detail

### Org Detail (`/platform/organisations/:id`)
13-tab detail view:
1. **Overview** — core org fields
2. **Subscription** — plan, billing cycle, trial dates
3. **Members** — all users + roles
4. **Workforce** — granted packs
5. **Usage** — period usage summaries
6. **Entitlements** — feature entitlements
7. **Overrides** — all overrides (active + revoked)
8. **Notes** — internal notes (add new + history with priority/category)
9. **Tasks** — recent tasks
10. **Approvals** — recent approvals
11. **Audit** — link to platform audit filtered by org
12. **Security** — security flags + high-priority actions
13. **Pending** — placeholder features (connectors, devices)

Action bar: Suspend / Reactivate (with reason modal, audited)

### Commercial (`/platform/commercial`)
4 sub-sections:
- **Plan Designer** — all plans with version history; create/activate/archive versions
- **Features** — all feature codes by category
- **Usage Dimensions** — all dimensions
- **All Overrides** — cross-org active overrides

**Key rule: plans are never edited in-place. Editing creates a new version.**

### Trials (`/platform/trials`)
- Summary cards: active / expiring (7d) / expired
- Filterable table with days-left colour coding
- Extend and Cancel actions (with reason)

### Workforce (`/platform/workforce`)
- Packs (with org grant counts)
- Specialists (with capabilities)
- Stats (usage across platform)

### Usage Monitor (`/platform/usage`)
- Platform summary + dimension totals chart
- Top consuming orgs table
- Warnings panel (orgs at 80%+ with progress bars)
- 6-month trend line charts (recharts)

### Support Centre (`/platform/support`)
- All internal notes (search, filter by category/priority)
- Flagged orgs view
- Active overrides
- Support timeline

### Security (`/platform/security`)
- Suspended orgs count
- Security flags
- Recent security actions
- Login activity

### Audit (`/platform/audit`)
- Full cross-org audit log
- Filter by event type, org ID, actor ID, date range
- Colour-coded by event group (Platform/Tenant/Usage/User/Task/Approval)

### Platform Settings (`/platform/settings`)
- Feature flags with toggle switches
- Platform config key-value editor
- Platform role grants management (Super Admin only)

---

## Default Data (Seeded)

**Feature Flags (10):** `maintenance_mode`, `new_onboarding_flow`, `ai_task_routing_v2`, `approval_workflow_auto`, `platform_audit_streaming`, `csv_export_enabled`, `usage_warnings_active`, `trial_auto_expiry`, `platform_search_enabled`, `plan_version_history`

**Platform Settings (10):** `default_trial_days` (14), `default_currency` (AUD), `platform_name`, `support_email`, `maintenance_message`, `max_trial_extensions` (3), `usage_warning_threshold` (80), `usage_critical_threshold` (95), `platform_timezone` (Australia/Sydney), `ndis_jurisdiction` (Australia)

Seed with: `npx tsx src/seed-platform-defaults.ts`

---

## Hard Constraints

- **No Stripe** — pricing fields are placeholders until Sprint 5+
- **No OpenClaw** — shown as "not_implemented" placeholders
- **No browser execution** — all processing server-side
- **No connectors** — connector eligibility deferred to later sprint
- **No fake data** — all metrics from live DB
- **Every destructive action** requires: reason + actor + timestamp + audit event + confirmation modal

---

## Tests

Sprint 4 tests: `artifacts/api-server/src/__tests__/sprint4-platform-console.test.ts`

All 12 platform sub-router endpoints verified for:
- Auth guard (401 without token)
- DB schema: feature flags, platform settings, plan Sprint 4 fields, note priority/category
