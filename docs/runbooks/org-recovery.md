# Runbook: Organisation Recovery (Reactivation)

**Trigger:** Suspension resolved (payment received, legal hold lifted, investigation cleared).  
**Owner:** Platform Engineering + approval from Legal/Trust & Safety

---

## Prerequisites

- Written approval from authorising team (email/ticket reference required)
- Write access to platform database

---

## Steps

### 1. Confirm the org UUID — never use name or slug

```sql
SELECT id, name, slug, status, subscription_tier
FROM organizations
WHERE id = '<uuid>';
```

### 2. Reactivate in organizations table

```sql
UPDATE organizations
SET status = 'active', updated_at = NOW()
WHERE id = '<uuid>';
```

### 3. Reactivate in org_database_registry

```sql
UPDATE org_database_registry
SET status = 'active', updated_at = NOW()
WHERE organization_id = '<uuid>';
```

### 4. Verify operational access is restored

```ts
import { checkOrgDbHealth } from "@workspace/org-db";
const health = await checkOrgDbHealth("<uuid>");
// expect: { healthy: true }
```

### 5. Write audit event

```sql
INSERT INTO platform_audit_log
  (id, organization_id, actor_user_id, actor_type, event_type,
   resource_type, resource_id, metadata)
VALUES (
  gen_random_uuid(), '<uuid>', '<admin-user-id>', 'platform_staff',
  'platform.org_reactivated', 'organisation', '<uuid>',
  '{"reason": "<reason>", "ticket": "<ticket-id>", "approved_by": "<name>"}'
);
```

---

## Verify

```sql
SELECT status FROM organizations WHERE id = '<uuid>';
SELECT status FROM org_database_registry WHERE organization_id = '<uuid>';
```

Test that API calls for this org work:
```bash
curl -H "Authorization: Bearer <token>" https://<api>/v1/organisations/<slug>/health
# expect: HTTP 200
```

---

## Post-Recovery Checklist

- [ ] Org owner notified that access is restored
- [ ] Audit event written to platform_audit_log
- [ ] Any pending backups scheduled (check next_backup_at)
- [ ] Ticket closed with resolution notes
