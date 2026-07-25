# Runbook: Legacy Table Write Detection

**Trigger:** `LegacyWriteError` at server startup, or write-restriction regression  
  (e.g. a new Drizzle migration re-GRANTs privileges).  
**Effect:** API server refuses to start (intentional — fail-safe).  
**Owner:** Platform Engineering

---

## Why This Exists

Sprint 7.1 revokes INSERT/UPDATE/DELETE on 7 legacy shared operational tables from
the `needsops_app` role. This prevents accidental writes to shared tables now that
all operational data must live in per-org schemas.

The `LegacyWriteError` check runs at every server startup via `verifyLegacyTablesReadOnly()`.
If ANY of the restricted tables become writeable again (e.g. after a schema push), the
server refuses to start.

---

## Error Message

```
[FATAL] Legacy table write restrictions not applied.
Run lib/db/migrations/sprint71-write-restrictions.sql.
Server will not start.
```

---

## Diagnosis

### Check which tables are writeable

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

Any rows returned here are tables that must be restricted.

### Common causes

1. `drizzle-kit push` or a new migration re-ran `GRANT ALL` on `needsops_app`.
2. A new table was added with the same name as a legacy table.
3. `pg_dump | psql` restore re-applied old grants.

---

## Fix

### Option A — Re-apply the sprint71 migration (idempotent)

```bash
psql "$DATABASE_URL" < lib/db/migrations/sprint71-write-restrictions.sql
```

### Option B — Manual REVOKE (if migration script is unavailable)

```sql
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

## Verify

```sql
-- Should return 0 rows after fix
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

Restart the API server — it will perform the startup check and start cleanly.

---

## Prevention

Add the REVOKE commands to the bottom of every migration that touches these tables.
If `drizzle-kit push` is used in CI, add a post-push step that re-runs the sprint71 migration.
