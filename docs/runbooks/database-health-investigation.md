# Runbook: Database Health Investigation

**Trigger:** Health check returns `status: "degraded"` or `"unreachable"`, backup failures, or slow query reports.  
**Owner:** Platform Engineering  
**Required Role:** Platform staff with read access to platform database

---

## Step 1: Run the health check for the affected org

```ts
import { checkOrgDbHealth } from "@workspace/org-db";

const health = await checkOrgDbHealth("<uuid>");
console.log(JSON.stringify(health, null, 2));
```

Expected output:
```json
{
  "tenantId": "<uuid>",
  "schemaName": "org_<uuid_underscored>",
  "isDedicatedDb": false,
  "status": "healthy",
  "latencyMs": 12,
  "tableCount": 11,
  "migrationVersion": "sprint7-extended"
}
```

`status: "degraded"` means fewer than 5 tables were found.  
`status: "unreachable"` means the connection failed entirely.

---

## Step 2: Check registry status

```sql
SELECT organization_id, status, schema_name, migration_version,
       last_health_check_at, backup_status, next_backup_at
FROM org_database_registry
WHERE organization_id = '<uuid>';
```

---

## Step 3: Check schema table count

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'org_<uuid_underscored>'
ORDER BY table_name;
```

Expect at least 11 tables: `org_approval_history`, `org_approval_rules`, `org_approvals`,
`org_audit_log`, `org_backup_log`, `org_memberships`, `org_settings`, `org_task_execution_plans`,
`org_task_specialists`, `org_tasks`, `org_workforce_packs`.

---

## Step 4: Check connection pool status

```ts
import { getPoolStatus } from "@workspace/org-db";

const status = getPoolStatus();
console.log(status.activePools, status.maxPools, status.poolsAtCapacity);
```

If `poolsAtCapacity = true`, older pools are being evicted. This is expected behaviour but may
cause brief latency spikes on pool recreation.

---

## Step 5: Investigate PostgreSQL-level health

```sql
-- Check active connections
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';

-- Check long-running queries
SELECT pid, now() - query_start AS duration, state, query
FROM pg_stat_activity
WHERE state != 'idle' AND now() - query_start > interval '30 seconds'
ORDER BY duration DESC;

-- Check lock contention
SELECT pid, locktype, relation::regclass, mode, granted
FROM pg_locks
WHERE NOT granted;
```

---

## Step 6: Check RLS status

```ts
import { verifyRLS } from "@workspace/org-db";

const result = await verifyRLS({ failFast: false });
console.log(result.allPoliciesPresent, result.missingRLS, result.missingPolicies);
```

If any policy is missing, run:

```bash
psql "$DATABASE_URL" < lib/db/migrations/sprint7-platform-boundary.sql
```

---

## Step 7: Check backup health

```sql
SELECT last_backup_at, backup_status, next_backup_at
FROM org_database_registry
WHERE organization_id = '<uuid>';

-- Check org backup log
SELECT id, status, started_at, completed_at, size_bytes, error_message
FROM "org_<uuid_underscored>".org_backup_log
ORDER BY started_at DESC
LIMIT 10;
```

---

## Step 8: Force a health check update

```ts
import { checkOrgDbHealth } from "@workspace/org-db";

// This also updates last_health_check_at in the registry
const health = await checkOrgDbHealth("<uuid>");
```

---

## Common Issues

| Symptom | Likely Cause | Fix |
|---|---|---|
| `status: "degraded"`, `tableCount < 5` | Migration not applied | Run `applyMigrationsUpTo()` — see `failed-migration-recovery.md` |
| `status: "unreachable"` | DB connection failed | Check `DATABASE_URL`, network, and pg_stat_activity |
| Slow latency (`latencyMs > 500`) | Long-running queries or lock contention | Check pg_stat_activity and pg_locks above |
| `backup_status = "failed"` | Storage or encryption error | See `backup-failure.md` |
| Pool at capacity | > 50 active orgs | Review `MAX_POOLS` in `orgConnectionManager.ts` |

---

## Audit Evidence to Retain

- Health check output JSON
- pg_stat_activity snapshot
- Timestamp of investigation start and resolution
