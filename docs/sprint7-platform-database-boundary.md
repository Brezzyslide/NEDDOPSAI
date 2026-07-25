# Sprint 7 — Platform Database Boundary Architecture

**Status:** Complete  
**Date:** 2026-07-25  
**Tests:** 285/285 passing (Sprint 7 adds 74 new tests)

---

## Overview

Sprint 7 establishes a hard technical boundary between the NeedsOps **Platform Database** (shared infrastructure metadata) and each organisation's **Operational Database** (org-scoped clinical/workforce data).

The Sprint 6 foundation (schema-per-org isolation) remains in place as the dev/small-org mode. Sprint 7 adds:

- **Separate PostgreSQL database per org** (production target, graceful fallback in dev)
- **AES-256-GCM encrypted credential storage** (`platform_secrets` table)
- **Org-specific logical backup and restore** with cross-org protection
- **Automated data migration** from shared tables to org schemas
- **RLS startup enforcement** — server refuses to start if any of 19 required policies are missing
- **AI Privacy Gateway foundation** — enforces identity, purpose, provider, and field-level access before any LLM call
- **Legacy dual-write stopped** — `audit_log` INSERT revoked for app role; all events go to `platform_audit_log` or `org_audit_log`

---

## Database Architecture

### Platform Database (`DATABASE_URL`)

Shared PostgreSQL database for platform-level metadata. No operational (org-scoped) data lives here.

| Table | Purpose |
|---|---|
| `organizations` | Org registry |
| `org_database_registry` | Per-org DB/schema provisioning state, backup config, migration state |
| `platform_secrets` | AES-256-GCM encrypted credential store |
| `platform_audit_log` | Cross-org platform events |
| `platform_roles`, `platform_settings` | Platform staff config |
| `plans`, `plan_versions`, `features` | Commercial catalogue |
| `tenant_subscriptions`, `tenant_entitlements` | Org subscription state |
| `memberships`, `users`, `invitations` | Identity |
| `audit_log` | LEGACY — read-only from Sprint 7 |

### Org Operational Database / Schema

Each org has a separate schema within the shared PostgreSQL cluster (dev mode), or a separate PostgreSQL database (production).

**Schema name derivation:** `org_<uuid_underscored>` — **never** derived from slug; always from stable org UUID.

**Tables in each org schema (all prefixed `org_`):**

| Table | Description |
|---|---|
| `org_tasks` | Workforce tasks |
| `org_task_execution_plans` | AI-generated execution plans |
| `org_task_specialists` | Task↔specialist assignments |
| `org_approvals` | Approval instances |
| `org_approval_rules` | Approval configuration |
| `org_approval_history` | Approval audit trail |
| `org_memberships` | Org-level membership + roles |
| `org_settings` | Org configuration (timezone, modules) |
| `org_workforce_packs` | Workforce pack entitlements |
| `org_audit_log` | Org-scoped audit events |
| `org_backup_log` | Backup metadata (Sprint 7) |

---

## Connection Routing

```
Authenticated request (tenantId from middleware, never from body)
    ↓
withOrgContext({ tenantId, userId, purpose })
    ↓
Registry lookup (platform DB) → entry.status must be "active"
    ↓
Mode A (isDedicatedDb = false):  shared DATABASE_URL + SET search_path = org_xxx
Mode B (isDedicatedDb = true):   credentialsRef → secrets service → org-specific pool
    ↓
Pool keyed by organisationId (never reused across orgs)
    ↓
SET LOCAL app.current_organization_id = <orgId>   ← RLS reads this
    ↓
SET LOCAL app.user_id = <userId>
    ↓
Callback executes in isolated org context
    ↓
Pool idle-timeout reaper / SIGTERM drain (drainAllPools)
```

**Security guarantees:**
- Registry lookup validates status before creating/using any pool
- `isDedicatedDb=true` pools use per-org credentials from secrets service
- Pool registry keys are org UUIDs — never slug, never schema name
- Credentials are scrubbed from all error messages
- Suspended orgs fail closed immediately
- Graceful shutdown: SIGTERM → `drainAllPools()` → 15s force exit

---

## Secrets Service

**File:** `lib/secrets/src/secretsService.ts`

### Encryption

- Algorithm: AES-256-GCM
- Key: SHA-256 of `SESSION_SECRET` (must be ≥ 32 chars)
- Format: `base64(IV[16] + AuthTag[16] + ciphertext)`
- Stored in: `platform_secrets.encrypted_value`

### Credential reference format

```
org:<orgId>:db:v<version>
```

The reference (not the credential) is stored in `org_database_registry.credentials_ref`.

### API

```ts
await storeSecret(ref, { username, password }, options?)
await retrieveSecret(ref)     // throws if revoked or expired
await rotateSecret(ref, newValue)  // increments version
await revokeSecret(ref)            // marks isRevoked=true
await getSecretStatus(ref)         // metadata only, no plaintext
await markSecretValidated(ref)
```

### Platform Console rules

- `credentialsRef` column is **never** included in any API response
- `encryptedValue` is never readable through any API
- `getSecretStatus()` returns metadata only (version, expiry, revocation)
- Provisioning response includes steps but **never** credentials

---

## Backup and Restore

**File:** `lib/org-db/src/orgBackupService.ts`

### Backup

1. Verify org registry entry (status = active)
2. Capture row data for all org tables using `json_populate_recordset`-compatible format
3. JSON-serialize payload: `{ version, organizationId, schemaName, tables: {...}, capturedAt }`
4. AES-256-GCM encrypt full payload
5. Compute SHA-256 checksum of plaintext payload
6. Write `org_backup_log` entry in org schema
7. Update `org_database_registry.lastBackupAt`, `backupStatus`

### Restore

1. AES-256-GCM decrypt encrypted payload
2. Verify SHA-256 checksum — abort if tampered
3. Parse payload and verify `organizationId` matches target — **cross-org restore blocked**
4. Truncate tables in reverse FK order (CASCADE)
5. Re-insert using `INSERT INTO schema.table SELECT * FROM json_populate_recordset(null::schema.table, $json)` — PostgreSQL handles all type casts automatically
6. Write restore audit event

### Acceptance test

`sprint7-backup-restore.test.ts` proves: **restoring Organisation Alpha does not alter Organisation Beta's data.**

---

## AI Privacy Gateway

**File:** `lib/ai-gateway/src/aiGateway.ts`

Sprint 7 establishes the full gateway interface. No external LLM calls in Sprint 7 — provider integration is deferred to Sprint 9.

### Enforcement pipeline

```
createAIGateway(ctx)
    ↓
Context validation (userId, orgId, correlationId required)
    ↓
Provider check (only APPROVED_PROVIDERS allowed)
    ↓
Role → purpose allowlist (ROLE_PURPOSE_ALLOWLIST)
    ↓
gateway.process(request)
    ↓
Field-level access check (PURPOSE_FIELD_ALLOWLIST)
    ↓
Pre-request audit event written
    ↓
Provider call (internal only in Sprint 7; external = PROVIDER_NOT_CONNECTED)
    ↓
Post-response audit event written
    ↓
AIResponse with auditEventId, correlationId, requiresHumanApproval
```

### Approved providers (Sprint 7)

| Provider | Connected |
|---|---|
| `internal` | ✓ (deterministic routing, no external call) |
| `anthropic` | ✗ Sprint 9 |
| `openai` | ✗ Sprint 9 |
| `openrouter` | ✗ Sprint 9 |
| `gemini` | ✗ Sprint 9 |

### Roles and permitted purposes

| Role | Permitted purposes |
|---|---|
| `owner`, `administrator` | `task_planning`, `workforce_routing`, `search_assistance` |
| `case_manager` | `task_planning`, `search_assistance` |
| `worker` | `search_assistance` |
| `support` | `search_assistance` |
| `platform_staff` | `internal_tooling` |

---

## RLS Startup Check

**File:** `artifacts/api-server/src/startup/rlsStartupCheck.ts`

On every server start:

1. `verifyRLS({ failFast: true })` — checks all 19 operational tables have RLS enabled and `tenant_isolation` policy present
2. `verifyNeedsOpsAppRoleIsSecure()` — verifies app role does not have `BYPASSRLS`
3. If either check fails → `process.exit(1)` with clear error listing missing tables

**Required tables (19):**
tasks, task_specialists, task_execution_plans, approvals, approval_rules, approval_history, memberships, invitations, tenant_subscriptions, tenant_entitlements, tenant_overrides, tenant_settings, tenant_addons, tenant_usage_allowances, tenant_workforce_packs, usage_events, usage_period_summaries, org_audit_log, audit_log

---

## Data Migration

**File:** `lib/org-db/src/orgMigrationService.ts`

Moves org-scoped records from shared public tables to the org schema. Idempotent and supports dry-run mode.

**7 stages:**

| Stage | Description |
|---|---|
| `verify_registry` | Check registry entry exists and status = active |
| `inventory` | Count records per table in shared DB |
| `mark_migrating` | Set registry status = migrating |
| `copy_tasks` / `copy_task_execution_plans` / `copy_task_specialists` / `copy_approvals` / `copy_approval_history` | INSERT INTO org schema ON CONFLICT DO NOTHING |
| `validate` | Count records in dest; verify crossOrgCount = 0 |
| `mark_migrated` | Set isMigrated=true, status=active, migrationState=finalised |
| `audit_event` | Write platform audit record |

**Cross-org ownership check (stage validate):**
```sql
SELECT COUNT(*) FROM org_tasks t
JOIN public.tasks pt ON pt.id = t.migrated_from_id
WHERE pt.organization_id != '<orgId>'
```
Non-zero → migration aborted.

---

## SECURITY DEFINER Functions

All platform aggregate functions have a fixed `search_path = public, pg_temp` and are SECURITY DEFINER:

| Function | Returns |
|---|---|
| `platform_get_org_task_count(org_id TEXT)` | `BIGINT` |
| `platform_get_org_approval_count(org_id TEXT)` | `BIGINT` |
| `platform_get_org_pending_approval_count(org_id TEXT)` | `BIGINT` |
| `platform_get_org_record_counts(org_id TEXT)` | `JSONB` — `{tasks, approvals, members}` |

All validate UUID format — invalid input returns `{error: "invalid_org_id"}` or `0`.

---

## Sprint 7 File Inventory

### New packages

| Path | Description |
|---|---|
| `lib/secrets/` | AES-256-GCM secrets service |
| `lib/ai-gateway/` | AI Privacy Gateway foundation |

### lib/db changes

| File | Change |
|---|---|
| `src/schema/platformSecrets.ts` | NEW — platform_secrets Drizzle schema |
| `src/schema/orgDatabaseRegistry.ts` | +7 Sprint 7 columns (isDedicatedDb, clusterRef, backupConfig, backupStatus, nextBackupAt, migrationState, suspensionReason) |
| `src/schema/index.ts` | +platformSecrets export |
| `migrations/sprint7-platform-boundary.sql` | Idempotent migration: platform_secrets, new registry columns, RLS re-apply, SECURITY DEFINER functions |

### lib/org-db changes

| File | Change |
|---|---|
| `src/orgConnectionManager.ts` | REWRITE — dual-mode routing, pool keyed by orgId, SIGTERM drain |
| `src/orgProvisioningService.ts` | REWRITE — 14-step provisioning, secrets service, dedicated DB attempt with fallback |
| `src/orgSchemaVersions.ts` | NEW — versioned DDL registry (sprint6-foundation, sprint7-extended) |
| `src/orgMigrationService.ts` | NEW — 7-stage migration with inventory, copy, validate, ownership check |
| `src/orgBackupService.ts` | NEW — AES-256-GCM backup/restore with cross-org protection |
| `src/rlsVerifier.ts` | NEW — checks all 19 RLS policies; startup check throws on any missing |

### artifacts/api-server changes

| File | Change |
|---|---|
| `src/index.ts` | +RLS startup check, +pool reaper, +SIGTERM drain |
| `src/startup/rlsStartupCheck.ts` | NEW |
| `src/services/auditService.ts` | REWRITE — legacy dual-write removed |
| `src/routes/v1/platform.ts` | Dashboard no longer reads operational tables |
| `src/routes/v1/platformDatabase.ts` | REWRITE — backup/restore/migrate/RLS routes |

### Sprint 7 test files

| File | Tests |
|---|---|
| `sprint7-database-isolation.test.ts` | 13 real-DB isolation tests |
| `sprint7-secrets.test.ts` | 18 secrets management tests |
| `sprint7-rls-safety.test.ts` | 13 RLS enforcement tests |
| `sprint7-backup-restore.test.ts` | 8 backup/restore tests (incl. acceptance test) |
| `sprint7-ai-gateway.test.ts` | 19 gateway enforcement tests |
| `sprint7-migration.test.ts` | 9 migration tests |

---

## Rollback Procedure

1. Run `git revert <sprint7-commit>` to revert code changes
2. Revert schema: legacy audit writes must be re-enabled manually:
   ```sql
   GRANT INSERT ON audit_log TO needsops_app;
   ```
3. The `platform_secrets`, `org_database_registry` Sprint 7 columns, and SECURITY DEFINER functions are additive — they do not need to be removed unless you want a clean rollback:
   ```sql
   DROP TABLE IF EXISTS platform_secrets;
   ALTER TABLE org_database_registry
     DROP COLUMN IF EXISTS is_dedicated_db,
     DROP COLUMN IF EXISTS cluster_ref,
     DROP COLUMN IF EXISTS backup_config,
     DROP COLUMN IF EXISTS backup_status,
     DROP COLUMN IF EXISTS next_backup_at,
     DROP COLUMN IF EXISTS migration_state,
     DROP COLUMN IF EXISTS suspension_reason;
   DROP FUNCTION IF EXISTS platform_get_org_task_count(TEXT);
   DROP FUNCTION IF EXISTS platform_get_org_approval_count(TEXT);
   DROP FUNCTION IF EXISTS platform_get_org_pending_approval_count(TEXT);
   DROP FUNCTION IF EXISTS platform_get_org_record_counts(TEXT);
   ```
4. Org schemas created during Sprint 7 testing were dropped by test cleanup. Production schemas (if any) retain `migrated_from_id` columns (additive, harmless to Sprint 6 code).

---

## Definition of Done — Sprint 7 Checklist

| Item | Status |
|---|---|
| Separate database per org (graceful fallback in dev) | ✅ |
| Credentials via secrets service (encrypted, never plaintext) | ✅ |
| Platform Console never exposes credentialsRef | ✅ |
| Backup/restore with cross-org protection | ✅ |
| Acceptance test: restore Alpha does not alter Beta | ✅ |
| RLS cannot be silently removed (startup check) | ✅ |
| Legacy audit INSERT revoked | ✅ |
| SECURITY DEFINER functions with fixed search_path | ✅ |
| AI Gateway foundation enforces all 4 checks | ✅ |
| Connection pool safety (keyed by orgId, SIGTERM drain) | ✅ |
| Platform Console dashboard no longer reads operational tables | ✅ |
| Real-DB isolation tests pass | ✅ |
| All 285 tests pass | ✅ |
