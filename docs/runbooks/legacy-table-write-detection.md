# Runbook: Legacy Table Write Detection

**Trigger:** `LegacyWriteError` at server startup, or write-restriction regression (e.g. a new Drizzle migration re-GRANTs privileges).  
**Effect:** API server refuses to start — intentional fail-safe.  
**Owner:** Platform Engineering  
**Required Role:** Platform staff with database superuser access

---

## Background

From Sprint 7.1, `needsops_app` must NOT have INSERT, UPDATE, or DELETE on:
- `public.audit_log`
- `public.org_audit_log`
- `public.tasks`
- `public.approvals`
- `public.approval_history`
- `public.task_execution_plans`
- `public.task_specialists`

If write access exists on any of these tables, the server exits on startup with:
```
[FATAL] Startup security check failed. Run the required migrations. Server will not start.
```

---

## Step 1: Verify which tables have write access

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'needsops_app'
  AND table_schema = 'public'
  AND table_name IN (
    'audit_log', 'org_audit_log', 'tasks', 'approvals',
    'approval_history', 'task_execution_plans', 'task_specialists'
  )
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
ORDER BY table_name, privilege_type;
```

This query returning any rows means write access was re-granted.

---

## Step 2: Check when it was re-granted

```sql
-- Check recent schema changes in pg_stat_activity history (if logging enabled)
SELECT usename, application_name, query, query_start
FROM pg_stat_activity
WHERE query ILIKE '%GRANT%'
  AND query_start > NOW() - INTERVAL '24 hours';
```

Common causes:
- `drizzle-kit push` re-applied a migration that includes `GRANT ALL`
- A developer ran a manual `GRANT` command
- A `pg_dump | psql` restore re-applied old grants

---

## Step 3: Apply the REVOKE migration

```bash
# Option A — Re-apply the sprint71 migration (idempotent):
psql "$DATABASE_URL" < lib/db/migrations/sprint71-write-restrictions.sql
```

```sql
-- Option B — Manual REVOKE (if migration script is unavailable):
-- Connect as superuser
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON public.org_audit_log FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON public.tasks FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON public.approvals FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON public.approval_history FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON public.task_execution_plans FROM needsops_app;
REVOKE INSERT, UPDATE, DELETE ON public.task_specialists FROM needsops_app;
```

---

## Step 4: Verify the fix

```sql
-- Should return 0 rows after applying the fix:
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'needsops_app'
  AND table_schema = 'public'
  AND table_name IN (
    'audit_log', 'org_audit_log', 'tasks', 'approvals',
    'approval_history', 'task_execution_plans', 'task_specialists'
  )
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');
```

Programmatic check:

```ts
import { verifyLegacyTablesReadOnly } from "@workspace/org-db";

const result = await verifyLegacyTablesReadOnly();
console.log(result.allReadOnly); // must be true
console.log(result.writeableTable); // must be []
```

---

## Step 5: Restart the server

Restart the API server. The startup check will run automatically:

```
[startup] Verifying legacy table write restrictions...
[startup] Legacy table write restriction check passed — all legacy tables read-only
```

---

## Prevention

- Add the REVOKE commands to every migration that creates or modifies these tables.
- If `drizzle-kit push` is used in CI, add a post-push step that re-runs the sprint71 migration.
- The server startup check catches regressions before any traffic is served.

---

## Audit Evidence to Retain

- Before/after `information_schema.role_table_grants` query results
- Method of re-grant (migration, manual, restore)
- Timestamp of detection and fix
- API server startup log showing clean write check after remediation
