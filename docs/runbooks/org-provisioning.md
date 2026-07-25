# Runbook: Organisation Provisioning

**Trigger:** Onboarding a new customer organisation.  
**Prerequisite:** Organisation record must exist in `public.organizations`.  
**Owner:** Platform Engineering or automated onboarding flow

---

## Overview

Provisioning creates:
1. A PostgreSQL schema named `org_<uuid_underscored>`
2. All operational tables (tasks, approvals, memberships, audit_log, etc.)
3. Per-schema RLS policies
4. SECURITY DEFINER helper functions
5. Initial `org_settings` rows
6. Optionally: an initial owner membership record

Company creation and provisioning are **two separate steps**:
- Company creation → deliberate admin action in the platform UI (never automatic)
- Schema provisioning → this runbook

---

## Step 1: Create the organisation record

This is done via the platform admin UI or a manual SQL insert — never from application code.

```sql
INSERT INTO organizations
  (id, name, slug, display_name, type, status, subscription_tier,
   is_test_organisation, environment)
VALUES (
  gen_random_uuid(),
  'Acme Support Services',
  'acme-support',
  'Acme Support Services',
  'ndis_provider',
  'onboarding',
  'starter',
  FALSE,           -- NOT a test org
  'production'
)
RETURNING id;      -- copy this UUID for the next step
```

---

## Step 2: Provision the operational schema

```bash
pnpm run provision-org -- --org-id <uuid-from-step-1>
```

Add an initial owner (optional):
```bash
pnpm run provision-org -- --org-id <uuid> --admin-user-id <platform-user-id>
```

Dry run to preview steps without changes:
```bash
pnpm run provision-org -- --org-id <uuid> --dry-run
```

---

## Step 3: Verify provisioning

```sql
SELECT organization_id, schema_name, status, provisioned_at
FROM org_database_registry
WHERE organization_id = '<uuid>';
```

Test org connectivity:
```ts
import { checkOrgDbHealth } from "@workspace/org-db";
const health = await checkOrgDbHealth("<uuid>");
console.log(health); // expect: { healthy: true }
```

---

## Troubleshooting

**"No registry entry" error:**  
Provisioning did not complete. Re-run `provision-org` — it is idempotent.

**"CREATEDB permission denied":**  
Replit shared DB mode is active (expected). The provisioner falls back to schema mode automatically.

**Schema name collision:**  
Schema names are derived from the org UUID — collisions are impossible unless two orgs share the same UUID (they can't).

---

## Test Organisations

To create a test org for development or automated testing:
```bash
pnpm run create-test-org -- --name "Test Corp" --slug test-corp-001
```

Test orgs are marked `is_test_organisation=true` and excluded from billing/analytics.
