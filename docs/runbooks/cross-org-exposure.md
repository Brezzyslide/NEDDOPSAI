# Runbook: Cross-Org Data Exposure Response

**Trigger:** RLS failure detected, suspected cross-tenant data access, or RLS policy removed.  
**Severity:** P0 — Immediate response required.  
**Owner:** Platform Engineering + Security Lead

---

## Immediate Actions (first 15 minutes)

### 1. Freeze all org traffic (if exposure is ongoing)

```sql
-- Emergency: revoke SELECT from needsops_app on the affected table
-- Only do this if you are certain exposure is via that table
REVOKE SELECT ON public.<table> FROM needsops_app;
```

Or suspend the affected org(s):
```sql
UPDATE org_database_registry SET status = 'suspended', updated_at = NOW()
WHERE organization_id IN ('<victim-org-uuid>', '<source-org-uuid>');
```

### 2. Check current RLS status

```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class
JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
WHERE pg_namespace.nspname = 'public'
  AND relname IN (
    'tasks', 'approvals', 'approval_history', 'task_execution_plans',
    'task_specialists', 'audit_log', 'org_audit_log',
    'org_database_registry', 'platform_secrets', 'platform_audit_log'
  )
ORDER BY relname;
```

All rows should show `relrowsecurity = true`.

### 3. Check which policies are present

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 4. Identify what data was accessible

```sql
-- Review recent audit log for the source org
SELECT actor_user_id, event_type, resource_type, resource_id, occurred_at
FROM platform_audit_log
WHERE organization_id = '<source-org-uuid>'
  AND occurred_at > NOW() - INTERVAL '4 hours'
ORDER BY occurred_at DESC
LIMIT 100;
```

---

## Remediation

### Re-apply missing RLS policies

```bash
psql "$DATABASE_URL" < lib/db/migrations/sprint7-platform-boundary.sql
```

This migration is idempotent — safe to re-apply.

### Re-apply write restrictions

```bash
psql "$DATABASE_URL" < lib/db/migrations/sprint71-write-restrictions.sql
```

### Restart API server

Restart triggers the RLS startup check — server will not start if policies are still missing.

---

## Notification Obligations

Under Australian Privacy Act and NDIS Practice Standards:
- If health/disability data was accessed: notify OAIC within 30 days (NNDB eligible — notify earlier).
- Notify affected organisations (org owners) in writing.
- Preserve all audit logs — do not delete or truncate.

Document in the incident ticket: what was exposed, to whom, for how long, and the fix applied.

---

## Verify Resolution

```bash
# Run the RLS startup check manually
npx tsx -e "
import { verifyRLS, verifyLegacyTablesReadOnly } from '@workspace/org-db';
const r = await verifyRLS({ failFast: false });
const w = await verifyLegacyTablesReadOnly();
console.log('RLS all present:', r.allPoliciesPresent);
console.log('Legacy read-only:', w.allReadOnly);
"
```
