# Sprint 3 — Entitlements & Subscription System

## Overview

The NeedsOps AI+ entitlement system determines what each organisation can access, based on:

1. Their **active subscription plan** (Foundation → Enterprise)
2. **Tenant-level overrides** set by platform admins (grant or deny)
3. **Workforce pack grants** (subscription-included, add-on, trial, or platform override)

---

## Resolution Order

When `entitlementService.tenantCanUseFeature(orgId, featureCode)` is called, resolution follows this strict priority chain:

```
1. Explicit denial in tenant_entitlements          → DENY (always wins)
2. Explicit grant in tenant_entitlements (override) → GRANT
3. Plan version's feature list (plan_features)      → GRANT if present
4. Active trial with trial_features set             → GRANT if included
5. Default                                          → DENY
```

> **Rule**: An explicit denial is absolute. Even a platform override cannot grant if a denial row exists. To re-grant, the denial row must be removed first.

---

## Database Tables

| Table | Purpose |
|---|---|
| `plans` | Static plan catalogue (Foundation, Professional, Business, Enterprise) |
| `plan_versions` | Immutable versioned snapshots of a plan's config |
| `plan_features` | Feature codes included in each plan version |
| `plan_workforce_packs` | Workforce packs included in each plan version |
| `plan_usage_allowances` | Per-dimension usage limits per plan version |
| `tenant_subscriptions` | Authoritative subscription per org (one active per org) |
| `tenant_entitlements` | Explicit feature grants/denials for an org |
| `tenant_workforce_packs` | Active pack grants for an org |
| `tenant_usage_allowances` | Per-org usage overrides (seat limit override, etc.) |

---

## Plan Codes

| Code | Seats | Description |
|---|---|---|
| `foundation` | 5 | Entry-level NDIS provider |
| `professional` | 20 | Growing mid-size provider |
| `business` | 100 | Multi-site organisations |
| `enterprise` | Unlimited | Large providers and DSPs |

---

## Entitlement Service API

```typescript
// Feature access
tenantCanUseFeature(orgId, featureCode)           → EntitlementResult
tenantHasWorkforcePack(orgId, packCode)            → EntitlementResult
tenantCanUseSpecialist(orgId, specialistCode)      → EntitlementResult
tenantCanUseExecutionChannel(orgId, channelCode)   → EntitlementResult
tenantCanUseConnector(orgId, connectorCode)        → EntitlementResult

// Usage
getUsageAllowance(orgId, dimensionCode)            → UsageAllowance
getCurrentUsage(orgId, dimensionCode)              → number
checkUsage(orgId, dimensionCode, qty)              → UsageCheckResult
getUsagePercentage(orgId, dimensionCode)           → number | null
getUsageWarnings(orgId)                            → UsageCheckResult[]

// Seats
getSeatAllowance(orgId)                            → SeatInfo
getSeatsUsed(orgId)                                → number
getSeatsRemaining(orgId)                           → number | null
canInviteMember(orgId)                             → boolean
```

---

## Adding a New Feature Code

1. Add to `FEATURE_CODES` in `lib/shared/src/index.ts`
2. Insert into `features` table (via seed or migration)
3. Add to relevant plan versions in `plan_features`
4. Update `PLAN_INCLUDED_FEATURES` in `lib/entitlements/src/helpers.ts`

---

## Security Notes

- `organizations.subscriptionTier` is a **legacy Sprint 0 column** kept for backward compatibility. The authoritative source is `tenant_subscriptions`.
- Never use slug-based org identity for security checks — always use org UUID.
- Platform role grants (from `platform_roles` table) never automatically grant feature access to an org's data.
