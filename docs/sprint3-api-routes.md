# Sprint 3 — API Routes

## New Routes Added in Sprint 3

### Public Catalogue (no auth)

| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/plans` | All active plans with their active version |
| `GET` | `/v1/plans/:code` | Plan detail with features, packs, usage allowances |
| `GET` | `/v1/workforce-packs` | All workforce packs (filter by `?status=available`) |
| `GET` | `/v1/workforce-packs/:code` | Pack detail with full specialist list |

### Tenant Subscription & Entitlements (requires auth + tenant context)

All paths below are prefixed with `/v1/organisations/:slug`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/subscription` | Current plan, version, trial status, billing period |
| `GET` | `/entitlements` | Active features, packs, and customer-visible overrides |
| `POST` | `/entitlements/check` | Check if `featureCode` is accessible |
| `GET` | `/workforce` | All packs with `included: true/false` per this org's plan |
| `GET` | `/usage` | All 13 dimensions with current usage and limits |
| `POST` | `/usage/check` | Check if `qty` of `dimensionCode` is within limits |
| `GET` | `/seats` | Seat allowance (limit, used, remaining) |

### Platform Console (requires platform role)

Prefix: `/v1/platform`

| Method | Path | Min Role | Description |
|---|---|---|---|
| `GET` | `/organisations` | `platform_support` | Paginated org directory |
| `GET` | `/organisations/:id` | `platform_support` | Full org detail |
| `POST` | `/organisations/:id/suspend` | `platform_admin` | Suspend org |
| `POST` | `/organisations/:id/reactivate` | `platform_admin` | Reactivate org |
| `POST` | `/organisations/:id/trial/extend` | `platform_billing` | Extend trial |
| `GET` | `/organisations/:id/overrides` | `platform_support` | List overrides |
| `POST` | `/organisations/:id/overrides` | `platform_billing` | Create override |
| `DELETE` | `/organisations/:id/overrides/:overrideId` | `platform_billing` | Revoke override |
| `GET` | `/organisations/:id/usage` | `platform_support` | Org usage detail |
| `GET` | `/organisations/:id/entitlements` | `platform_support` | Org entitlements |
| `GET` | `/organisations/:id/audit` | `platform_compliance` | Org audit events |
| `GET` | `/organisations/:id/notes` | `platform_support` | Internal notes |
| `POST` | `/organisations/:id/notes` | `platform_support` | Add internal note |

---

## Middleware Chain

```
requireAuth                    — Clerk JWT validation
  └─ resolveTenantFromSlug    — loads org from slug, attaches tenantContext
       └─ requirePermission   — checks RBAC permission for action
```

Platform routes use a separate chain:

```
requirePlatformAuth            — Clerk JWT + platform_roles DB lookup
  └─ requirePlatformRole(r)   — checks specific role (super_admin always passes)
```

---

## Route Registration Order

In `routes/v1/index.ts`, `organisations/:slug` routes are mounted before the general `organisations` router to avoid slug collisions with org-level subroutes. Platform routes are registered at `/platform`, separate from the legacy `/admin` routes (which remain for backward compatibility).
