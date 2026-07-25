# Runbook: Secret Compromise Response

**Trigger:** Confirmed or suspected platform secret leak (SESSION_SECRET, DATABASE_URL, credentials).  
**Severity:** P0 — Immediate response required.  
**Owner:** Platform Engineering + Security Lead

---

## Identification

Check which secrets may have been exposed:

| Secret | Impact if compromised |
|--------|----------------------|
| `SESSION_SECRET` | All AES-256-GCM encrypted secrets and backups unreadable/decryptable |
| `DATABASE_URL` | Full platform database access as superuser |
| `CLERK_SECRET_KEY` | Auth token forgery |
| Org DB credential (in platform_secrets) | Single org operational database |

---

## SESSION_SECRET Compromise

This is the highest-impact scenario. SESSION_SECRET encrypts all `platform_secrets` rows
and all backup payloads.

### Step 1: Export all secrets NOW (while you still have the old key)

```bash
# Connect to DB and export all secret values
psql "$DATABASE_URL" -c "
SELECT secret_ref, encrypted_value, version
FROM platform_secrets
WHERE is_revoked = FALSE
" > /tmp/secrets-export-$(date +%Y%m%d).tsv
```

Then decrypt each entry and store in a temporary secure vault (not in the codebase).

### Step 2: Rotate SESSION_SECRET

Update `SESSION_SECRET` in Replit Secrets to a new strong random value (min 64 chars).

### Step 3: Re-encrypt all secrets

For each exported secret, re-encrypt with the new key:
```ts
import { storeSecret } from "@workspace/secrets";
await storeSecret("<secret_ref>", { /* decrypted value */ }, { /* options */ });
```

### Step 4: Invalidate all org connection pools

```ts
import { drainAllPools } from "@workspace/org-db";
await drainAllPools();
```

### Step 5: Mark all old backups as invalid

Old backup files encrypted with the previous key cannot be restored. Remove them:
```ts
import { FilesystemBackupProvider } from "@workspace/org-db";
const provider = new FilesystemBackupProvider();
// For each org: await provider.delete(orgId, storageRef);
// Then run fresh backups for all orgs.
```

---

## DATABASE_URL Compromise

### Step 1: Rotate the postgres superuser password immediately

```sql
ALTER ROLE postgres WITH PASSWORD '<new-strong-password>';
```

### Step 2: Rotate needsops_app password

See [credential-rotation.md](credential-rotation.md) — Step 1.

### Step 3: Update DATABASE_URL and app DB connection env vars

Update in Replit Secrets and restart all workflows.

---

## CLERK_SECRET_KEY Compromise

1. Log in to the Replit Clerk dashboard and rotate the secret key.
2. Update `CLERK_SECRET_KEY` and `VITE_CLERK_PUBLISHABLE_KEY` in Replit Secrets.
3. Restart API server workflow.
4. All current JWT sessions become invalid — users must re-authenticate.

---

## Post-Incident

- Write a platform audit event documenting what was rotated and when.
- File an incident report with OAIC if any sensitive data may have been accessed.
- Schedule a post-mortem within 5 business days.
