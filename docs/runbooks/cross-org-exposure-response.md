# Runbook: Cross-Org Exposure Response

**Trigger:** RLS failure detected, suspected cross-tenant data access, or RLS policy removed.  
**Severity:** P0 — Immediate response required.  
**Owner:** Platform Engineering + Security Lead  
**Required Role:** Platform Engineering on-call + Security Lead

---

## Immediate Actions (first 15 minutes)

### 1. Freeze all org traffic (if exposure is ongoing)

```sql
-- Suspend the affected org(s) to halt access
UPDATE org_database_registry
SET status = 'suspended', suspension_reason = 'P0 security investigation', updated_at = NOW()
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

All rows must show `relrowsecurity = true`.

### 3. Check which policies are present

```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

### 4. Check app.current_organization_id config leakage

```sql
-- RLS policies use this session variable. A missing SET before a query
-- means ALL rows are visible. Check if any session has it unset:
SELECT pid, application_name,
       current_setting('app.current_organization_id', TRUE) AS org_context
FROM pg_stat_activity
WHERE state = 'active';
```

---

## Identify What Data Was Accessible

```sql
-- Review recent platform audit log for the affected orgs
SELECT actor_user_id, event_type, resource_type, resource_id, occurred_at, metadata
FROM platform_audit_log
WHERE organization_id IN ('<org1>', '<org2>')
ORDER BY occurred_at DESC
LIMIT 50;
```

---

## Restore RLS Policies

If `relrowsecurity = false` or a policy is missing:

```bash
# Re-apply the full boundary migration (idempotent):
psql "$DATABASE_URL" < lib/db/migrations/sprint7-platform-boundary.sql
```

```ts
// Verify programmatically:
import { verifyRLS } from "@workspace/org-db";
const result = await verifyRLS({ failFast: false });
console.log(result.allPoliciesPresent, result.missingRLS, result.missingPolicies);
```

---

## Re-enable the Server

After RLS is restored:

1. Restart the API server — it will run the startup RLS check before accepting traffic.
2. Un-suspend affected orgs (see `org-reactivation.md`) only after root cause is confirmed.

---

## Root Cause Investigation

Common causes:

| Cause | Detection | Prevention |
|---|---|---|
| `drizzle-kit push` re-granted table-level SELECT to PUBLIC | Check `pg_policies` after any migration | Add RLS re-application to migration post-hook |
| `search_path` injection via schema name | Audit provisioning input validation | Schema name derived from UUID — never from client input |
| Context variable not SET before query | Audit connection pool code | `withOrgContext()` sets `app.current_organization_id` per transaction |
| Superuser connection used in app code | pg_stat_activity shows `postgres` role | App must use `needsops_app` role — never superuser |

---

## Regulatory Notification Checklist

If personal data was exposed:

- [ ] Notify Security Lead and legal counsel within 1 hour
- [ ] Assess exposure scope: which users, which records, which time window
- [ ] Retain all audit log evidence before any cleanup
- [ ] Determine notification obligations (Australian Privacy Act, NDIS Practice Standards)
- [ ] Prepare incident report with timeline, root cause, and remediation

---

## Audit Evidence to Retain

- `pg_policies` snapshot before and after remediation
- `platform_audit_log` export for affected orgs (keep for ≥ 7 years per NDIS requirements)
- RLS verification output JSON
- Incident ticket reference and all approvals
- API server startup log showing clean RLS check after remediation
