# Runbook: Organisation Suspension

**Trigger:** Non-payment, policy violation, legal hold, or fraud investigation.  
**Effect:** All API requests for the org return 403. Data is preserved.  
**Owner:** Platform Engineering (requires confirmation from Legal/Trust & Safety)

---

## Prerequisites

- Write access to the platform database (via DATABASE_URL superuser connection)
- Platform admin session (to log audit event)

---

## Steps

### 1. Confirm the org UUID — never use name or slug

```sql
SELECT id, name, slug, status, subscription_tier
FROM organizations
WHERE id = '<uuid>';  -- always use UUID
```

Confirm you have the correct org before proceeding.

### 2. Suspend in organizations table

```sql
UPDATE organizations
SET status = 'suspended', updated_at = NOW()
WHERE id = '<uuid>';
```

### 3. Suspend in org_database_registry

```sql
UPDATE org_database_registry
SET status = 'suspended', updated_at = NOW()
WHERE organization_id = '<uuid>';
```

The registry suspension is what withOrgContext() checks. After this update,
all new org operational requests will fail with OrgConnectionError.

### 4. Drain existing connection pool

```ts
import { drainOrgPool } from "@workspace/org-db";
await drainOrgPool("<uuid>"); // kills any open connections for this org
```

### 5. Write audit event

```sql
INSERT INTO platform_audit_log
  (id, organization_id, actor_user_id, actor_type, event_type,
   resource_type, resource_id, metadata)
VALUES (
  gen_random_uuid(), '<uuid>', '<admin-user-id>', 'platform_staff',
  'platform.org_suspended', 'organisation', '<uuid>',
  '{"reason": "<reason>", "ticket": "<ticket-id>"}'
);
```

---

## Verify

```sql
-- Both tables must show suspended
SELECT status FROM organizations WHERE id = '<uuid>';
SELECT status FROM org_database_registry WHERE organization_id = '<uuid>';
```

Test that API calls for this org return 403:
```bash
curl -I https://<api>/v1/organisations/<slug>/tasks
# expect: HTTP 403
```

---

## Rollback (Reactivation)

See [org-recovery.md](org-recovery.md).
