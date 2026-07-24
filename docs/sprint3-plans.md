# Sprint 3 — Plan Catalogue

## Plan Structure

Plans are versioned. The authoritative plan config is always the **active plan version** (`plan_versions.is_active = true`). When a plan changes, a new version is created and the old one is deactivated — existing subscriptions reference the version they were created on.

```
plans
  └─ plan_versions  (immutable snapshot; never edit in place)
       ├─ plan_features       (feature codes included)
       ├─ plan_workforce_packs (packs included by default)
       └─ plan_usage_allowances (per-dimension limits)
```

---

## The Four Plans

### Foundation (`foundation`)
- **Seats**: 5
- **Target**: Small NDIS sole providers, micro-teams
- **Packs included**: Core
- **Key limits**: 50 AI tasks/month, 500 specialist calls, 500 MB storage

### Professional (`professional`)
- **Seats**: 20
- **Target**: Growing providers, multi-coordinator teams
- **Packs included**: Core, Compliance, Operations
- **Key limits**: 500 AI tasks/month, 5,000 specialist calls, 10 GB storage

### Business (`business`)
- **Seats**: 100
- **Target**: Multi-site organisations
- **Packs included**: Core, Compliance, Operations, Finance, HR
- **Key limits**: 2,000 AI tasks/month, 20,000 specialist calls, 100 GB storage

### Enterprise (`enterprise`)
- **Seats**: Unlimited
- **Target**: Large DSPs, government-adjacent providers
- **Packs included**: All 6 packs
- **Key limits**: 10,000 AI tasks/month, unlimited specialist calls, 1 TB storage

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/v1/plans` | None | List all active plans |
| `GET` | `/v1/plans/:code` | None | Plan detail with features and allowances |

---

## Versioning Rules

1. **Never edit an existing plan version.** Create a new version with `is_active = true` and set the old one to `is_active = false`.
2. **Existing subscriptions are not auto-migrated.** A subscription references the plan version it was created on and stays on that version until explicitly upgraded.
3. **Version IDs are stable.** Format: `planv_{plan_code}_v{n}` (e.g. `planv_professional_v1`).

---

## Workforce Pack Catalogue

| Code | Name | Plans |
|---|---|---|
| `core` | Core Operations | Foundation+ |
| `compliance` | NDIS Compliance | Professional+ |
| `operations` | Service Operations | Professional+ |
| `finance` | Finance & Billing | Business+ |
| `hr` | HR & Workforce | Business+ |
| `marketing` | Engagement & Growth | Enterprise |

Endpoint: `GET /v1/workforce-packs` (public, no auth)
