# Sprint 3 — Database Schema

## New Tables (18 total)

### Plan Catalogue

#### `plans`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | e.g. `plan_foundation` |
| `code` | text UNIQUE | `foundation` / `professional` / `business` / `enterprise` |
| `name` | text | Display name |
| `description` | text | Marketing copy |
| `is_active` | boolean | Hide from catalogue if false |
| `display_order` | integer | Sort order in UI |
| `created_at` | timestamptz | |

#### `plan_versions`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | e.g. `planv_professional_v1` |
| `plan_id` | text FK → plans | |
| `version_tag` | text | e.g. `v1` |
| `is_active` | boolean | Only one active per plan |
| `effective_from` | timestamptz | When this version takes effect |
| `created_at` | timestamptz | |

#### `features`
| Column | Type | Notes |
|---|---|---|
| `code` | text PK | Feature code (e.g. `task_centre`) |
| `name` | text | Display name |
| `category` | featureCategoryEnum | `platform` / `workforce` / `execution` / `integration` / `data` |
| `description` | text | |
| `is_active` | boolean | |

#### `plan_features`
| Column | Type | Notes |
|---|---|---|
| `plan_version_id` | text FK | |
| `feature_code` | text | |
| **PK** | (plan_version_id, feature_code) | |

#### `plan_workforce_packs`
| Column | Type | Notes |
|---|---|---|
| `plan_version_id` | text FK | |
| `pack_code` | text | |
| **PK** | (plan_version_id, pack_code) | |

#### `workforce_pack_specialists`
| Column | Type | Notes |
|---|---|---|
| `pack_code` | text | |
| `specialist_code` | text | |
| **PK** | (pack_code, specialist_code) | |

### Usage

#### `usage_dimensions`
| Column | Type | Notes |
|---|---|---|
| `code` | text PK | Dimension code |
| `name` | text | Display label |
| `unit` | text | e.g. `tasks`, `bytes` |
| `description` | text | |
| `is_active` | boolean | |

#### `plan_usage_allowances`
| Column | Type | Notes |
|---|---|---|
| `plan_version_id` | text FK | |
| `dimension_code` | text | |
| `hard_limit` | **bigint** | null = unlimited; bigint for byte counts |
| `soft_limit_pct` | real | Warning threshold % (default 80) |
| **PK** | (plan_version_id, dimension_code) | |

> ⚠ `hard_limit` is `bigint` (not integer) because storage byte limits exceed int4 range (max ~2.1 billion).

### Tenant Subscription

#### `tenant_subscriptions`
| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text FK UNIQUE | One active sub per org |
| `plan_id` | text FK | |
| `plan_version_id` | text FK | Version at subscription time |
| `status` | subscriptionStatusEnum | `active` / `trialing` / `past_due` / `cancelled` / `paused` |
| `billing_cycle` | text | `monthly` / `annual` |
| `current_period_start` | timestamptz | |
| `current_period_end` | timestamptz | |
| `trial_ends_at` | timestamptz | null if not trialing |
| `cancelled_at` | timestamptz | |
| `created_at` / `updated_at` | timestamptz | |

#### `tenant_entitlements`
Explicit feature grants/denials per org. Overrides plan-level resolution.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `organization_id` | text FK | |
| `feature_code` | text | |
| `state` | entitlementStateEnum | `granted` / `denied` |
| `source` | entitlementSourceEnum | `plan` / `override` / `trial` / `addon` |
| `granted_by` | text | Actor who set this |
| `expires_at` | timestamptz | null = permanent |

#### `tenant_workforce_packs`
Active pack grants per org.

#### `tenant_addons`
Purchased add-ons (billing reference only in Sprint 3).

#### `tenant_usage_allowances`
Per-org overrides for usage dimension limits.
`hard_limit` is also **bigint** here.

#### `usage_events`
Append-only event log. Unique constraint: `(org_id, dimension_code, idempotency_key)`.

#### `usage_period_summaries`
Aggregated monthly totals for fast limit checks. Maintained by `recordUsageEvent`.

### Platform

#### `tenant_overrides`
Platform admin overrides with type enum (7 types), reason, actor, and expiry.

#### `platform_roles`
Staff role assignments. `revoked_at` is null for active roles.

#### `platform_internal_notes`
Support notes per org. `is_flagged` triggers a security audit event.

---

## Running Migrations

```bash
cd lib/db && pnpm run push
```

This uses `drizzle-kit push` (schema-first, suitable for development). For production, generate and review a migration file instead.
