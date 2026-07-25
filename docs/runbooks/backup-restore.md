# Runbook: Backup and Restore

**Trigger:** Data corruption, accidental deletion, DR drill, or user-requested data recovery.  
**Scope:** Single-org restore only. Cross-org restore is rejected by the service.  
**Owner:** Platform Engineering

---

## Prerequisites

- API server running with backup scheduler active
- BackupStorageProvider configured (FilesystemBackupProvider for dev)
- Org is in org_database_registry with status = 'active'

---

## Create a Manual Backup

```ts
import { createOrgBackup, FilesystemBackupProvider } from "@workspace/org-db";

const provider = new FilesystemBackupProvider();
const result = await createOrgBackup("<org-uuid>", provider);

console.log({
  backupId: result.backupId,
  storageRef: result.storageRef,
  checksum: result.checksum,
  sizeBytes: result.sizeBytes,
  tables: result.tablesCaptured,
});
```

The backup is stored at: `.backup-store/<org-uuid>/<backupId>.enc`

---

## Check Backup Status

```ts
import { getOrgBackupStatus } from "@workspace/org-db";

const status = await getOrgBackupStatus("<org-uuid>");
console.log(status);
// { lastBackupAt, lastBackupStatus, nextBackupAt, ... }
```

Or check the registry:
```sql
SELECT last_backup_at, backup_status, next_backup_at
FROM org_database_registry
WHERE organization_id = '<uuid>';
```

---

## Restore from Backup

**WARNING:** Restore truncates and replaces ALL operational tables for the org.
Always create a fresh backup immediately before restoring.

### Step 1: Create a pre-restore backup

```ts
const preRestoreBackup = await createOrgBackup("<org-uuid>", provider);
console.log("Pre-restore storageRef:", preRestoreBackup.storageRef);
// Keep this ref — if restore goes wrong, use it to roll back
```

### Step 2: List available backups

```ts
const provider = new FilesystemBackupProvider();
const backupRefs = await provider.list("<org-uuid>");
console.log(backupRefs); // newest first
```

### Step 3: Restore

```ts
import { restoreOrgBackup, FilesystemBackupProvider } from "@workspace/org-db";

const provider = new FilesystemBackupProvider();
const result = await restoreOrgBackup(
  "<org-uuid>",
  "<storageRef>",
  { provider },
);

console.log(result.success, result.tablesRestored, result.recordCounts);
```

### Step 4: Verify isolation (cross-org check)

The restore service embeds the org UUID in the backup payload and rejects any
restore attempt where payload.organizationId !== requested org UUID. This is
enforced in code — not just policy.

---

## Verify

```sql
-- Check row counts look correct after restore
SELECT relname AS table, n_live_tup AS rows
FROM pg_stat_user_tables
WHERE schemaname = 'org_<uuid_underscored>'
ORDER BY relname;
```

---

## Rollback (undo the restore)

Restore from the pre-restore backup created in Step 1:
```ts
await restoreOrgBackup("<org-uuid>", preRestoreBackup.storageRef!, { provider });
```
