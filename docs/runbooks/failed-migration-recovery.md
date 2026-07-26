# Runbook: Failed Migration Recovery

**Trigger:** `applyMigrationsUpTo()` failed mid-run, or org schema is on an older migration version.  
**Owner:** Platform Engineering  
**Required Role:** Platform staff with write access to platform database

---

## Overview

Org schema migrations are versioned in `lib/org-db/src/orgSchemaVersions.ts`.
Each migration is idempotent — it uses `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, etc.
Failed migrations can be retried safely.

---

## Step 1: Identify affected orgs

```sql
SELECT organization_id, schema_name, migration_version, status
FROM org_database_registry
WHERE migration_version != 'sprint7-extended'
   OR migration_version IS NULL;
```

---

## Step 2: Check the current migration version

```ts
import { CURRENT_MIGRATION_VERSION } from "@workspace/org-db";
console.log(CURRENT_MIGRATION_VERSION); // e.g. "sprint7-extended"
```

---

## Step 3: Check schema state for affected org

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'org_<uuid_underscored>'
ORDER BY table_name;
```

Identify which tables are present vs. missing.

---

## Step 4: Re-run migration (idempotent)

```ts
import { applyMigrationsUpTo, CURRENT_MIGRATION_VERSION } from "@workspace/org-db";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
const db = drizzle(pool);

try {
  const result = await applyMigrationsUpTo(db, "org_<uuid_underscored>", CURRENT_MIGRATION_VERSION);
  console.log("Applied:", result.appliedVersions);
} finally {
  await pool.end();
}
```

---

## Step 5: Update registry with new migration version

After successful migration:

```sql
UPDATE org_database_registry
SET migration_version = 'sprint7-extended', updated_at = NOW()
WHERE organization_id = '<uuid>';
```

---

## Step 6: Re-run health check

```ts
import { checkOrgDbHealth } from "@workspace/org-db";
const health = await checkOrgDbHealth("<uuid>");
console.log(health.status, health.tableCount);
```

---

## Step 7: Verify new tables/columns exist

For each version in the migration, verify key tables or columns:

```sql
-- sprint7-extended: check migrated_from_id column on org_tasks
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'org_<uuid_underscored>'
  AND table_name = 'org_tasks'
  AND column_name = 'migrated_from_id';

-- sprint7-extended: check org_backup_log table
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'org_<uuid_underscored>'
  AND table_name = 'org_backup_log';
```

---

## Bulk Migration (all active orgs)

To migrate all orgs at once:

```ts
import { db, orgDatabaseRegistryTable } from "@workspace/db";
import { applyMigrationsUpTo, CURRENT_MIGRATION_VERSION } from "@workspace/org-db";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

const orgs = await db.select().from(orgDatabaseRegistryTable)
  .where(eq(orgDatabaseRegistryTable.status, "active"));

for (const org of orgs) {
  const pool = new Pool({ connectionString: process.env["DATABASE_URL"] });
  const orgDb = drizzle(pool);
  try {
    await applyMigrationsUpTo(orgDb, org.schemaName, CURRENT_MIGRATION_VERSION);
    console.log(`Migrated: ${org.schemaName}`);
  } finally {
    await pool.end();
  }
}
```

---

## Common Failure Causes

| Symptom | Likely Cause | Fix |
|---|---|---|
| `duplicate column` error | Migration partially applied | Safe to re-run — uses `ADD COLUMN IF NOT EXISTS` |
| `relation does not exist` | Schema not created | Run full provisioning first |
| Type already exists | Enum was created in previous attempt | Uses `IF NOT EXISTS` check in DO block |

---

## Audit Evidence to Retain

- List of affected org UUIDs and schema names
- Migration version before and after
- Timestamp of recovery
- Ticket reference
