---
name: NeedsOps org provisioning and capability gate
description: Why new/test orgs appear to work then silently fail — missing subscription blocks capability gate, which silently replaces task_proposal with plain text
---

## The rule

A new org created via the platform UI (or test orgs in `onboarding` status) has **no row in `tenant_subscriptions`**. This causes `tenantCanUseFeature()` to return "No active subscription found." for every feature check — including `execution.openclaw_runtime`. The capability gate in `conversationService.processUserMessage()` silently replaces the `task_proposal` message card with a plain `text` message when this happens.

**Why it feels intermittent:** The capability gate only fires when `identifyCapabilities()` returns a non-empty list. For generic requests ("assign a task", "create a task for X") the LLM may return an empty capability list → gate skipped → task proposal shown. For specific domain requests ("review our care plan structure") the LLM correctly maps to a registered capability → gate fires → no subscription → blocked.

## To provision a test org for end-to-end testing

Run this SQL (substitute the org's UUID):

```sql
BEGIN;
UPDATE organizations SET status = 'active', status_changed_at = NOW() WHERE id = '<org-id>';

INSERT INTO tenant_subscriptions (id, organization_id, plan_id, plan_version_id, status, current_period_start, current_period_end, created_at, updated_at)
VALUES ('sub_bypass_<org-id>', '<org-id>', 'plan_business', 'planv_business_v1', 'active', NOW(), NOW() + INTERVAL '1 year', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO tenant_workforce_packs (id, organization_id, pack_code, source, granted_by, reason, tenant_pack_status, granted_at, created_at) VALUES
  ('twp_<org>_core',       '<org-id>', 'core',       'subscription', 'system', 'Business plan', 'active', NOW(), NOW()),
  ('twp_<org>_compliance', '<org-id>', 'compliance', 'subscription', 'system', 'Business plan', 'active', NOW(), NOW()),
  ('twp_<org>_operations', '<org-id>', 'operations', 'subscription', 'system', 'Business plan', 'active', NOW(), NOW()),
  ('twp_<org>_finance',    '<org-id>', 'finance',    'subscription', 'system', 'Business plan', 'active', NOW(), NOW()),
  ('twp_<org>_hr',         '<org-id>', 'hr',         'subscription', 'system', 'Business plan', 'active', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- execution.openclaw_runtime is in COMING_SOON_FEATURES and is not in any plan's plan_features.
-- It must always be granted as an explicit tenant_entitlements override.
INSERT INTO tenant_entitlements (id, organization_id, feature_code, state, source, reason, granted_by, is_customer_visible, created_at, updated_at)
VALUES ('ent_<org>_openclaw', '<org-id>', 'execution.openclaw_runtime', 'granted', 'override', 'Platform dev access', 'system', false, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

**Why:** No server restart needed — entitlements are DB-read on every request.

## Current test orgs with full provisioning

- `xyz-ltd` (id: `672e4654-1cbd-443c-8515-e20020a3c77f`) — provisioned 2026-08-05, Business plan, all packs, openclaw entitlement
- `xyz-ltd-2` (slug) — previously provisioned, core/compliance/hr packs (no openclaw entitlement — may also need it for execution testing)
- `horizon-support` — active subscription
- `coastal-healthcare` — trial subscription

## execution.openclaw_runtime is permanently "coming soon"

The feature code `execution.openclaw_runtime` lives in `COMING_SOON_FEATURES` in `seed.ts` and is never added to any `plan_features` row. The only way to grant it is via `tenant_entitlements` with `state = 'granted'`. This must be done manually for every org that needs full execution.

**Why:** OpenClaw runtime is a dedicated infrastructure product that isn't bundled with any standard plan yet.
