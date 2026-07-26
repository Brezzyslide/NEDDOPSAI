# Runbook: Restore Execution

**Trigger:** Data corruption, accidental deletion, DR drill, or user-requested data recovery.  
**Scope:** Single-org restore only. Cross-org restore is rejected by the service.  
**Owner:** Platform Engineering  
**Required Role:** Platform staff with write access to platform database

---

## Prerequisites

- Org is in `org_database_registry` with `status = 'active'`
- A valid backup exists (check `org_backup_log` or object storage)
- The encrypted payload was created with the current `SESSION_SECRET`

---

## Step 1: Confirm the org and find available backups

```sql
SELECT id, status, schema_name, last_backup_at, backup_status
FROM org_database_registry
WHERE organization_id = '<uuid>';
```

```sql
SELECT id, status, started_at, completed_at, size_bytes, storage_ref, checksum
FROM "org_<uuid_underscored>".org_backup_log
WHERE status = 'completed'
ORDER BY started_at DESC
LIMIT 10;
```

---

## Step 2: Create a pre-restore backup

**Always take a fresh backup before restoring.** This is your rollback point.

```ts
import { createOrgBackup, FilesystemBackupProvider } from "@workspace/org-db";

const provider = new FilesystemBackupProvider(); // or ObjectStorageBackupProvider
const preRestoreBackup = await createOrgBackup("<uuid>", provider);

console.log("Pre-restore backup:", {
  backupId: preRestoreBackup.backupId,
  storageRef: preRestoreBackup.storageRef,
  checksum: preRestoreBackup.checksum,
});
```

Record the `storageRef` — you will need it if the restore must be rolled back.

---

## Step 3: Identify the target backup storageRef

From the `org_backup_log` query in Step 1, copy the `storage_ref` for the backup you want to restore.

---

## Step 4: Execute the restore

```ts
import { restoreOrgBackup, FilesystemBackupProvider } from "@workspace/org-db";

const provider = new FilesystemBackupProvider(); // must match provider used when backup was created

const result = await restoreOrgBackup(
  "<uuid>",      // organization ID — must match backup payload
  "<storageRef>", // from org_backup_log.storage_ref
  { provider },
);

console.log(result.success, result.tablesRestored, result.recordCounts);
```

The restore will:
1. Verify ownership: `payload.organizationId === requestedOrgId`
2. Verify checksum (SHA-256)
3. Truncate all org operational tables (in safe FK order)
4. Re-insert all rows from the backup
5. Write a platform audit event

---

## Step 5: Verify the restored data

```sql
-- Check row counts per table after restore
SELECT relname AS table, n_live_tup AS rows
FROM pg_stat_user_tables
WHERE schemaname = 'org_<uuid_underscored>'
ORDER BY relname;
```

Run the org health check:

```ts
import { checkOrgDbHealth } from "@workspace/org-db";
const health = await checkOrgDbHealth("<uuid>");
console.log(health.status, health.tableCount);
```

---

## Step 6: Verify cross-org isolation

Spot-check that another org's data was not affected:

```sql
-- Check a neighbouring org's task count is unchanged
SELECT COUNT(*) FROM "org_<other-uuid-underscored>".org_tasks;
```

---

## Rollback (undo the restore)

Restore from the pre-restore backup saved in Step 2:

```ts
const rollback = await restoreOrgBackup(
  "<uuid>",
  preRestoreBackup.storageRef!,
  { provider },
);
console.log(rollback.success);
```

---

## Error Handling

| Error | Cause | Fix |
|---|---|---|
| `Backup belongs to org X but restore requested for Y` | Cross-org restore attempt | Use the correct org UUID |
| `Backup checksum mismatch` | Payload tampered or corrupted | Use a different, verified backup |
| `Failed to decrypt backup payload` | SESSION_SECRET changed since backup was created | Restore SESSION_SECRET from secure store |
| `Backup not found` | storageRef is incorrect or backup was pruned | List backups and verify the storageRef |

---

## Audit Evidence to Retain

- Pre-restore backup `storageRef` and checksum
- Target backup `storageRef` and checksum
- `restoreOrgBackup()` result JSON
- Platform audit log entry: `platform.org_backup_restored`
- Ticket reference and approval
