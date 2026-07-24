# Sprint 3 — Platform Console

## Overview

The Platform Console (`/v1/platform/*`) is a restricted API surface for NeedsOps staff. It provides full visibility into all tenants, subscriptions, overrides, and usage — without granting access to tenant operational data.

---

## Authentication

Platform console access requires **two layers**:

1. Valid Clerk session (authenticated user)
2. A row in the `platform_roles` table with a non-revoked role

The `requirePlatformAuth` middleware enforces both layers. As a bootstrap mechanism, a user with `publicMetadata.platformAdmin = true` in Clerk is also accepted (for the first platform admin onboarding only).

### Platform Roles

| Role | Access |
|---|---|
| `platform_super_admin` | Everything — bypasses all role checks |
| `platform_admin` | Full platform console |
| `platform_support` | Read-only org detail + notes |
| `platform_billing` | Subscription and override management |
| `platform_compliance` | Audit logs and security reviews |

---

## Endpoints

### Organisation Directory

```
GET /v1/platform/organisations
```

Parameters: `page`, `limit`, `status` (active/suspended/trial), `plan` (foundation/professional/…), `search`

Returns a paginated list of all organisations with their plan and subscription summary.

### Organisation Detail

```
GET /v1/platform/organisations/:id
```

Returns full org detail: subscription, entitlements, workforce packs, active overrides, usage, and recent audit events.

### Organisation Actions

| Method | Path | Role Required | Description |
|---|---|---|---|
| `POST` | `/platform/organisations/:id/suspend` | `platform_admin` | Suspend an org |
| `POST` | `/platform/organisations/:id/reactivate` | `platform_admin` | Reactivate a suspended org |
| `POST` | `/platform/organisations/:id/trial/extend` | `platform_billing` | Extend trial by N days |
| `POST` | `/platform/organisations/:id/overrides` | `platform_billing` | Create an override |
| `DELETE` | `/platform/organisations/:id/overrides/:overrideId` | `platform_billing` | Revoke an override |
| `POST` | `/platform/organisations/:id/notes` | `platform_support` | Add internal note |

### Overrides

The `tenant_overrides` table stores 7 override types:

- `seat_limit_override` — change max seats
- `feature_grant` — grant a feature outside plan
- `feature_deny` — deny a feature (highest priority)
- `pack_grant` — grant a workforce pack
- `usage_limit_override` — change a usage dimension limit
- `trial_extension` — extend trial period
- `custom` — freeform override with metadata

All overrides are audited. Every create/revoke writes to `audit_log`.

### Internal Notes

```
POST /v1/platform/organisations/:id/notes
{ "content": "string", "isFlagged": boolean }
```

Flagged notes trigger a `platform.security_review_flagged` audit event.

---

## Security Rules

1. Platform roles are granted via the `platform_roles` table — not by org membership or subscription tier.
2. Platform admins **cannot** access tenant files, task payloads, or operational data through these routes.
3. Every sensitive action (suspend, override, trial extension, note flagging) is audited with actor ID and timestamp.
4. `platform_super_admin` passes all role checks but does not bypass Clerk auth.

---

## Audit Events (platform-scoped)

| Event | Trigger |
|---|---|
| `platform.organisation_viewed` | GET org detail |
| `platform.organisation_suspended` | Suspend action |
| `platform.organisation_reactivated` | Reactivate action |
| `platform.trial_extended` | Trial extension |
| `platform.override_created` | Override creation |
| `platform.override_revoked` | Override revocation |
| `platform.internal_note_added` | Note created |
| `platform.security_review_flagged` | Note flagged for security |
