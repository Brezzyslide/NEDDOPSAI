# Runbook: Failed Provisioning Recovery

**Trigger:** `provisionOrgDb()` returned `success: false`, or `org_database_registry.status = 'failed'`.  
**Owner:** Platform Engineering  
**Required Role:** Platform staff with write access to platform database and schema management rights

---

## Overview

Provisioning is idempotent — calling `provisionOrgDb()` again after a partial failure
will resume from the last failed step. This runbook covers investigation and recovery.

---

## Step 1: Identify the failure

Check the registry for the failed org:

```sql
SELECT id, organization_id, status, schema_name, migration_version, metadata
FROM org_database_registry
WHERE organization_id = '<uuid>';
```

The `metadata` column contains `failedAt`, `error`, and `steps` from the last run.

Check the platform audit log:

```sql
SELECT event_type, metadata, occurred_at
FROM platform_audit_log
WHERE organization_id = '<uuid>'
ORDER BY occurred_at DESC
LIMIT 10;
```

---

## Step 2: Confirm the org record exists

```sql
SELECT id, name, slug, status FROM organizations WHERE id = '<uuid>';
```

If missing, create the org record first (via platform admin UI — not direct SQL).
If status is `'closed'`, provisioning will always fail — check whether org should be closed.

---

## Step 3: Re-run provisioning

```ts
import { provisionOrgDb } from "@workspace/org-db";

const result = await provisionOrgDb({
  organizationId: "<uuid>",
  provisionedBy: "<staff-user-id>",
});

console.log(result.success, result.steps);
```

Provisioning is idempotent — it skips completed steps and retries only failed ones.

---

## Step 4: Verify the schema was created

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'org_<uuid_underscored>'
ORDER BY table_name;
```

Expect: at least 10 org_ tables (org_tasks, org_approvals, org_memberships, etc.)

---

## Step 5: Run health check

```ts
import { checkOrgDbHealth } from "@workspace/org-db";

const health = await checkOrgDbHealth("<uuid>");
console.log(health);
// expect: { status: "healthy", tableCount >= 5 }
```

---

## Step 6: Confirm registry is active

```sql
SELECT status, is_verified, migration_version
FROM org_database_registry
WHERE organization_id = '<uuid>';
```

Expect: `status = 'active'`, `is_verified = true`.

---

## Common Failure Causes

| Failure Step | Likely Cause | Fix |
|---|---|---|
| `validate_org` | Org UUID not in organizations table | Create org record first |
| `create_database` | CREATEDB privilege unavailable | Expected on Replit — schema mode used automatically |
| `create_credentials` | SESSION_SECRET not set | Set SESSION_SECRET env var |
| `apply_migrations` | Schema exists but partially migrated | Re-run provisioning (idempotent) |
| `health_check` | < 5 tables created | Migration may be incomplete — check migration log |
| `isolation_check` | Non-org_ table found in schema | Investigate — may indicate a platform schema leak |

---

## Emergency: Manual schema cleanup before retry

Only if the schema is in a critically broken state:

```sql
-- DANGEROUS: drops all data in the org schema
DROP SCHEMA IF EXISTS "org_<uuid_underscored>" CASCADE;

-- Then reset the registry entry:
UPDATE org_database_registry
SET status = 'provisioning', is_verified = false, migration_version = NULL,
    metadata = '{}', updated_at = NOW()
WHERE organization_id = '<uuid>';
```

Then re-run provisioning.

---

## Audit Evidence to Retain

- Screenshot or log of `provisionOrgDb()` step output
- Ticket reference for the failed provisioning event
- Platform audit log entry for `platform.org_database_provisioned`
