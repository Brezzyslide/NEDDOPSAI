# Runbook: Backup Scheduler Failure

**Trigger:** Backup scheduler failure, missed backup window, or `backup_status = 'failed'` in registry.  
**Owner:** Platform Engineering

---

## Diagnosis

### Check registry for failed backups

```sql
SELECT organization_id, schema_name, backup_status, last_backup_at, next_backup_at
FROM org_database_registry
WHERE backup_status = 'failed' OR next_backup_at < NOW() - INTERVAL '26 hours'
ORDER BY last_backup_at ASC NULLS FIRST;
```

### Check server logs

```bash
# In Replit: refresh workflow logs for API Server
# Look for: [BackupScheduler] 
```

### Check backup storage

```ts
import { FilesystemBackupProvider } from "@workspace/org-db";
const provider = new FilesystemBackupProvider();
const backups = await provider.list("<org-uuid>");
console.log(backups); // [] = no backups exist
```

---

## Common Causes

| Cause | Fix |
|-------|-----|
| Org schema not provisioned | Run `provision-org` first |
| DB connectivity error | Check DATABASE_URL and pg connection pool |
| Advisory lock held by another instance | Wait for the lock to release (auto-releases on connection end) |
| Backup storage write error | Check filesystem permissions or storage provider |
| Session secret changed | Backups with old key are unrestorable — create fresh backups |

---

## Manual Backup (emergency)

```ts
import { createOrgBackup, FilesystemBackupProvider } from "@workspace/org-db";

const provider = new FilesystemBackupProvider();
const result = await createOrgBackup("<org-uuid>", provider);

if (result.status === "completed") {
  console.log("Backup completed:", result.storageRef);
} else {
  console.error("Backup failed:", result.error);
}
```

---

## Reset backup schedule

After resolving the root cause, set `next_backup_at` to trigger immediate retry:

```sql
UPDATE org_database_registry
SET next_backup_at = NOW() - INTERVAL '1 minute', backup_status = 'pending'
WHERE organization_id = '<uuid>';
```

The scheduler will pick this up in the next cycle (within 5 minutes).

---

## Verify

```sql
SELECT backup_status, last_backup_at, next_backup_at
FROM org_database_registry
WHERE organization_id = '<uuid>';
```

Expected after successful recovery: `backup_status = 'completed'`, `last_backup_at` is recent.
