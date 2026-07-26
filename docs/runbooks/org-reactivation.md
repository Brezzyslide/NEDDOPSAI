# Runbook: Organisation Reactivation

**Trigger:** Suspension resolved — payment received, legal hold lifted, or investigation cleared.  
**Owner:** Platform Engineering + written approval from Legal/Trust & Safety  
**Required Role:** Platform staff with write access to platform database

---

## Prerequisites

- Written approval from authorising team (email/ticket reference required)
- Write access to platform database
- Confirm reason for original suspension is fully resolved

---

## Steps

### 1. Confirm the org UUID — never use name or slug

```sql
SELECT id, name, slug, status, subscription_tier
FROM organizations
WHERE id = '<uuid>';
```

Verify the UUID matches the expected organisation name. Do not accept UUIDs from the client.

### 2. Confirm suspension reason is cleared

Review the platform_audit_log for the suspension event:

```sql
SELECT actor_user_id, event_type, metadata, occurred_at
FROM platform_audit_log
WHERE organization_id = '<uuid>'
  AND event_type = 'platform.org_suspended'
ORDER BY occurred_at DESC
LIMIT 3;
```

### 3. Reactivate in organizations table

```sql
UPDATE organizations
SET status = 'active', updated_at = NOW()
WHERE id = '<uuid>';
```

### 4. Reactivate in org_database_registry

```sql
UPDATE org_database_registry
SET status = 'active', suspension_reason = NULL, updated_at = NOW()
WHERE organization_id = '<uuid>';
```

### 5. Verify operational access is restored

```ts
import { checkOrgDbHealth } from "@workspace/org-db";
const health = await checkOrgDbHealth("<uuid>");
// expect: { status: "healthy", tableCount >= 5 }
```

### 6. Write platform audit event

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
SELECT status, suspension_reason FROM org_database_registry WHERE organization_id = '<uuid>';
```

Test that API calls for this org work:

```bash
curl -H "Authorization: Bearer <token>" https://<api>/v1/organisations/<slug>/health
# expect: HTTP 200
```

---

## Post-Reactivation Checklist

- [ ] Org owner notified that access is restored
- [ ] Audit event written to platform_audit_log
- [ ] Any pending backups checked (verify next_backup_at is set)
- [ ] Ticket closed with resolution notes
- [ ] Approval record retained in secure ticketing system

---

## Rollback

To re-suspend:

```sql
UPDATE organizations SET status = 'suspended', updated_at = NOW() WHERE id = '<uuid>';
UPDATE org_database_registry
SET status = 'suspended', suspension_reason = '<reason>', updated_at = NOW()
WHERE organization_id = '<uuid>';
```
