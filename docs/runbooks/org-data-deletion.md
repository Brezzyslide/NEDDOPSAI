# Runbook: Organisation Data Deletion (Right to Erasure)

**Trigger:** GDPR Art. 17 request, Australian Privacy Act APP 13, or court order.  
**Owner:** Platform Engineering + Legal (legal review required before executing)  
**SLA:** 30 days from verified request under APA; shorter under GDPR if applicable.

---

## Prerequisites

- Written request from verified data subject or authorised representative
- Legal team sign-off (ticket reference required in audit log)
- Verified org UUID — confirm with the org admin

---

## Scope of Erasure

Before executing, clarify what must be deleted:

| Scope | Tables |
|-------|--------|
| All org operational data | All tables in `org_<uuid>` schema |
| Specific user's data | Filter by `actor_user_id` / `platform_user_id` across all tables |
| Platform-level data | `organizations`, `platform_audit_log`, `platform_secrets` rows for org |
| Backups | Backup files in backup storage for org |

**Note:** `platform_audit_log` rows may need to be retained for legal/compliance reasons
even under an erasure request. Confirm with Legal before deleting audit log entries.

---

## Full Organisation Erasure

### Step 1: Create a final backup (for legal retention)

```ts
import { createOrgBackup, FilesystemBackupProvider } from "@workspace/org-db";
const provider = new FilesystemBackupProvider();
const finalBackup = await createOrgBackup("<org-uuid>", provider);
console.log("Retention backup:", finalBackup.storageRef);
// Store this ref — do NOT delete it during erasure
```

### Step 2: Deprovision the operational schema

```ts
import { deprovisionOrgDb } from "@workspace/org-db";
await deprovisionOrgDb("<org-uuid>");
// Drops org_<uuid> schema and all its tables
```

### Step 3: Delete platform DB records

```sql
-- In order: most dependent tables first
DELETE FROM org_database_registry WHERE organization_id = '<uuid>';
DELETE FROM platform_secrets WHERE secret_ref LIKE 'org:<uuid>:%';
-- Optionally (confirm with Legal):
DELETE FROM platform_audit_log WHERE organization_id = '<uuid>';
UPDATE organizations SET status = 'closed', updated_at = NOW() WHERE id = '<uuid>';
-- Or hard-delete if required:
DELETE FROM organizations WHERE id = '<uuid>';
```

### Step 4: Delete backup files

```ts
const provider = new FilesystemBackupProvider();
const refs = await provider.list("<org-uuid>");
for (const ref of refs) {
  await provider.delete("<org-uuid>", ref);
}
```

### Step 5: Write audit event

```sql
INSERT INTO platform_audit_log
  (id, organization_id, actor_user_id, actor_type, event_type,
   resource_type, resource_id, metadata)
VALUES (
  gen_random_uuid(), '<uuid>', '<admin-user-id>', 'platform_staff',
  'platform.org_data_erased', 'organisation', '<uuid>',
  '{"legal_ticket": "<ticket>", "retention_backup_ref": "<ref>", "erased_by": "<name>"}'
);
```

---

## Partial User Erasure (within an org)

For erasing a specific user's records within an org schema, use `withOrgContext()` to
run targeted DELETEs across org tables filtered by `platform_user_id`.

This requires a custom script — contact Platform Engineering.
