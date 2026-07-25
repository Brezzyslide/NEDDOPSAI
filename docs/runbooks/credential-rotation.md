# Runbook: Database Credential Rotation

**Trigger:** 90-day scheduled rotation, suspected credential leak, or staff offboarding.  
**RTO:** < 2 hours for any single org. Platform credentials < 30 minutes.  
**Owner:** Platform Engineering

---

## Prerequisites

- Superuser access to Helium DB (platform DATABASE_URL)
- `pnpm run provision-org` access on the server
- Write access to Replit Secrets (to update `DATABASE_URL` etc.)

---

## 1. Platform Database Credentials

### 1.1 Create new needsops_app password

```sql
-- Connect as superuser (postgres role / DATABASE_URL)
ALTER ROLE needsops_app WITH PASSWORD '<new-strong-random-password>';
```

### 1.2 Update environment secret

```
NEEDSOPS_APP_DB_PASSWORD=<new-password>
```
Update in Replit Secrets → restart the API server workflow.

### 1.3 Verify

```sql
-- Should connect successfully with new password
psql "postgres://needsops_app:<new-password>@host/heliumdb" -c "SELECT current_user"
```

---

## 2. Per-Organisation DB Credentials

Org operational schemas use platform connection (same `needsops_app`). When
dedicated-database mode is enabled (future), per-org credentials live in
`platform_secrets`. Rotation steps:

### 2.1 Identify the secret ref

```sql
SELECT secret_ref, version, last_validated_at
FROM platform_secrets
WHERE secret_ref LIKE 'org:<uuid>:db:%'
ORDER BY created_at DESC
LIMIT 5;
```

### 2.2 Rotate via API

```ts
import { rotateSecret, buildOrgDbCredentialRef } from "@workspace/secrets";
const ref = buildOrgDbCredentialRef("<org-uuid>", currentVersion);
const { newVersion } = await rotateSecret(ref, { password: "<new>", username: "..." });
```

### 2.3 Drain the org connection pool

```ts
import { drainOrgPool } from "@workspace/org-db";
await drainOrgPool("<org-uuid>"); // forces reconnect with new credentials
```

### 2.4 Verify org connectivity

```ts
import { checkOrgDbHealth } from "@workspace/org-db";
const health = await checkOrgDbHealth("<org-uuid>");
// expect: { healthy: true }
```

---

## 3. SESSION_SECRET rotation

SESSION_SECRET is used for:
- AES-256-GCM encryption of `platform_secrets` rows
- AES-256-GCM encryption of org backup payloads

**WARNING:** Rotating SESSION_SECRET invalidates ALL existing encrypted secrets
and ALL existing backup payloads. Follow the migration procedure:

1. Export all secrets in plaintext (requires current key — do this FIRST).
2. Update SESSION_SECRET in Replit Secrets.
3. Re-encrypt all secrets with the new key.
4. Invalidate old backups (they cannot be decrypted with the new key).

**Never rotate SESSION_SECRET without a completed export and re-encrypt.**

---

## Verify

```sql
-- Confirm secret has new version
SELECT secret_ref, version, updated_at
FROM platform_secrets
WHERE secret_ref = 'org:<uuid>:db:v<N>';
```

## Rollback

Revert the password in `ALTER ROLE` and restore the old env secret.
