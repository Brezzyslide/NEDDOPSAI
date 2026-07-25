# Runbook: Applying Schema Migrations to Org Schemas

**Trigger:** New sprint adds tables or columns to org operational schemas.  
**Owner:** Platform Engineering

---

## Overview

Org schemas are versioned via `orgSchemaVersions.ts`. Each version increment applies
a DDL migration to an org's schema when `applyMigrationsUpTo()` is called during
provisioning or an explicit migration run.

Migrations are applied **per-org** — a migration run for Org A does not affect Org B.

---

## Migration versioning

Versions are defined in `lib/org-db/src/orgSchemaVersions.ts`:

```ts
export const MIGRATION_VERSIONS: MigrationVersion[] = [
  { version: 1, name: "initial", applyFn: applyV1 },
  { version: 2, name: "sprint7-extended", applyFn: applyV2 },
  // Add new versions here
];
```

Each `applyFn(schemaName, client)` runs idempotent DDL against one org schema.

---

## Apply migrations to a specific org

```ts
import { applyMigrationsUpTo, CURRENT_MIGRATION_VERSION } from "@workspace/org-db";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  await applyMigrationsUpTo(client, schemaName, CURRENT_MIGRATION_VERSION);
} finally {
  client.release();
  await pool.end();
}
```

## Apply migrations to all active orgs

```ts
import { db, orgDatabaseRegistryTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const orgs = await db
  .select()
  .from(orgDatabaseRegistryTable)
  .where(eq(orgDatabaseRegistryTable.status, "active"));

for (const org of orgs) {
  await applyMigrationsUpTo(client, org.schemaName, CURRENT_MIGRATION_VERSION);
  console.log(`✓ Migrated ${org.organizationId} (${org.schemaName})`);
}
```

---

## Adding a new migration version

1. Add a new `applyVN` function in `orgSchemaVersions.ts` with idempotent DDL (`IF NOT EXISTS`).
2. Append to `MIGRATION_VERSIONS` array with the next version number.
3. Update `CURRENT_MIGRATION_VERSION`.
4. Run `applyMigrationsUpTo()` for all active orgs.
5. Update acceptance tests if new tables affect backup/restore.

---

## Verify

```sql
-- Check a specific org's schema has the expected tables
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'org_<uuid_underscored>'
ORDER BY table_name;
```
