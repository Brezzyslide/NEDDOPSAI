# Sprint 6 — Organisation Database Foundation

## Overview

Sprint 6 establishes the per-organisation Operational Database architecture. Every organisation gets its own isolated data store — currently implemented as a dedicated PostgreSQL schema within the shared cluster, with the architecture designed for full database-per-org in Sprint 7.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Platform Database                           │
│   (shared, managed by lib/db, accessed by superuser connection)     │
│                                                                     │
│  organizations, users, memberships, plans, subscriptions,           │
│  entitlements, feature_flags, platform_settings,                    │
│  platform_audit_log                                                 │
│                                                                     │
│  org_database_registry  ──┐  (one row per org, stores schema name) │
└──────────────────────────┼─────────────────────────────────────────┘
                           │
               Per-org routing via schemaName
                           │
┌──────────────────────────▼──────────────────────────────────────────┐
│            Org A Schema: "org_3b4ffe73_1234_..."                    │
│                                                                     │
│  org_memberships, org_settings, org_workforce_packs,                │
│  org_tasks, org_task_execution_plans, org_task_specialists,         │
│  org_approvals, org_approval_rules, org_approval_history,           │
│  org_audit_log                                                      │
│                                                                     │
│  (Sprint 8: participants, case notes, care plans, rosters...)       │
│  (Sprint 9: AI data, embeddings, connector configurations...)       │
└─────────────────────────────────────────────────────────────────────┘

Current implementation: schema-per-org in shared PostgreSQL cluster
Target (Sprint 7): separate PostgreSQL database per org on managed host
```

---

## 2. Package: `@workspace/org-db`

**Location:** `lib/org-db/`

### Exports

| Export | Description |
|--------|-------------|
| `withOrgContext(ctx, fn)` | Primary gateway for org data access |
| `provisionOrgDb(input)` | Provision a new org database/schema |
| `deprovisionOrgDb(orgId)` | Remove schema (pre-customer use only) |
| `checkOrgDbHealth(orgId)` | Health check for an org's schema |
| `createOrgSchema(schemaName)` | Drizzle schema for org tables |
| `deriveSchemaName(orgId)` | UUID → safe PostgreSQL schema name |
| `drainAllPools()` | Graceful shutdown |
| `drainOrgPool(orgId)` | Drain one org's connection pool |
| `getPoolStatus()` | Connection pool metrics |
| `OrgConnectionError` | Typed error for routing failures |

---

## 3. Schema Name Derivation

Schema names are derived from the stable org UUID, never from the slug (which can change):

```typescript
import { deriveSchemaName } from "@workspace/org-db";

deriveSchemaName("3b4ffe73-1234-5678-abcd-ef0123456789")
// → "org_3b4ffe73_1234_5678_abcd_ef0123456789"
```

Properties:
- Valid PostgreSQL identifier (starts with letter/underscore, alphanumeric + underscore only)
- Deterministic: same UUID always produces the same schema name
- Stable: doesn't change if org slug changes
- Unique: different UUIDs produce different schema names

---

## 4. Provisioning an Org Database

### Via the API

```
POST /v1/platform/organisations/:id/database/provision
Authorization: platform_staff role required
```

```json
{
  "success": true,
  "organizationId": "...",
  "schemaName": "org_3b4ffe73_1234_...",
  "status": "active",
  "steps": [
    { "step": "validate_org",              "status": "completed", "durationMs": 5 },
    { "step": "check_existing_registry",   "status": "completed", "durationMs": 12 },
    { "step": "create_schema",             "status": "completed", "durationMs": 8 },
    { "step": "enable_extensions",         "status": "completed", "durationMs": 3 },
    { "step": "create_operational_tables", "status": "completed", "durationMs": 45 },
    { "step": "seed_initial_settings",     "status": "completed", "durationMs": 6 },
    { "step": "health_check",              "status": "completed", "durationMs": 11 },
    { "step": "mark_active",              "status": "completed", "durationMs": 4 },
    { "step": "audit_event",              "status": "completed", "durationMs": 3 }
  ]
}
```

### Via code (e.g. in org creation handler)

```typescript
import { provisionOrgDb } from "@workspace/org-db";

const result = await provisionOrgDb({ organizationId: org.id });
if (!result.success) {
  logger.error({ orgId: org.id, error: result.error, steps: result.steps }, "Provisioning failed");
  throw new Error("Failed to provision org database");
}
```

**Idempotent:** Safe to call multiple times. If the org is already provisioned and verified, returns immediately with `steps[0].status === "skipped"`.

---

## 5. Accessing Org Data: `withOrgContext`

```typescript
import { withOrgContext } from "@workspace/org-db";

// In a route handler after resolveTenantFromSlug:
const result = await withOrgContext(
  {
    tenantId: req.tenantContext.tenantId,  // Verified, never from client
    userId:   req.tenantContext.userId,
    purpose:  "task.list",
  },
  async (conn) => {
    const { orgSchema, db } = conn;
    return db.select()
      .from(orgSchema.orgTasks)
      .where(eq(orgSchema.orgTasks.currentState, "active"));
  },
);
```

**What withOrgContext does:**
1. Looks up the org's schema name from `org_database_registry` in the platform DB
2. Verifies the org's DB status is "active" — **fails closed** if not
3. Acquires a connection from the org's pool (bounded at 5 connections per org, 50 pools max)
4. Opens a transaction
5. Sets `search_path = org_<schema>, public` (schema isolation)
6. Sets RLS context variables (same pattern as `withTenantContext`)
7. Executes the callback
8. Returns the result and commits

**Failure modes:**
- `OrgConnectionError: No operational database registered` — org not provisioned
- `OrgConnectionError: Organisation database is not active (status: suspended)` — org DB suspended

---

## 6. Operational Database Schema (Sprint 6 Foundation)

All tables are prefixed `org_` to distinguish from platform tables.

### `org_memberships`
Local operational membership detail (role, permissions, clinical access level). Platform DB keeps only the access link (user_id + org_id + active).

### `org_settings`
Key-value configuration for the org. Seeded with 7 defaults:
- `ai_enabled` (false by default)
- `ai_approval_required` (true by default — all AI outputs require human review)
- `data_retention_days` (2555 = 7 years, NDIS minimum)
- `timezone` (Australia/Sydney)
- `currency` (AUD)
- `ndis_provider` (false)
- `clinical_module` (false)

### `org_tasks`, `org_task_execution_plans`, `org_task_specialists`
Operational AI task management (will receive data migrated from shared `tasks` table in Sprint 7).

### `org_approvals`, `org_approval_rules`, `org_approval_history`
Approval workflow within the org (migrating from shared tables in Sprint 7).

### `org_workforce_packs`
Org-local workforce pack grants.

### `org_audit_log`
Full operational audit trail — never exposed to platform console in detail.

---

## 7. Platform Database Routes

New routes under `/v1/platform/` (requires platform_staff role):

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/platform/organisations/:id/database/provision` | Provision org DB |
| DELETE | `/v1/platform/organisations/:id/database/deprovision` | Remove schema (pre-migration only) |
| GET | `/v1/platform/organisations/:id/database/health` | Health check |
| GET | `/v1/platform/organisations/:id/database/status` | Registry status |
| POST | `/v1/platform/organisations/:id/database/pool/drain` | Drain connection pool |
| GET | `/v1/platform/database/pools` | All active pool metrics |

---

## 8. org_database_registry Table

Platform DB table (Drizzle schema: `lib/db/src/schema/orgDatabaseRegistry.ts`).

| Column | Type | Description |
|--------|------|-------------|
| `id` | text PK | UUID |
| `organizationId` | text UNIQUE | FK to organizations |
| `schemaName` | text UNIQUE | PostgreSQL schema name |
| `internalLabel` | text | Human-readable label for ops |
| `status` | enum | provisioning/active/suspended/migrating/maintenance/deprovisioning/deprovisioned/failed |
| `migrationVersion` | text | Last applied migration label |
| `isVerified` | boolean | Health-checked and verified |
| `isMigrated` | boolean | Data migrated from shared DB |
| `lastHealthCheckAt` | timestamptz | Last successful health check |
| `lastBackupAt` | timestamptz | Last backup |
| `storageBytes` | text | Storage used |
| `credentialsRef` | text | Secrets vault key (credentials NOT stored here) |
| `dbHost`, `dbPort`, `dbName` | text/int | Filled in Sprint 7 for dedicated instances |

---

## 9. Connection Pool Management

The connection manager (`lib/org-db/src/orgConnectionManager.ts`) maintains a bounded pool of per-org database connections:

- **Max pools:** 50 concurrent org connection pools
- **Max connections per org:** 5
- **Idle timeout:** 30 seconds per connection
- **Pool TTL:** 30 minutes since last use (LRU eviction)
- **Credential security:** Credentials never logged; error messages redact password values

Drain on shutdown:
```typescript
import { drainAllPools } from "@workspace/org-db";
process.on("SIGTERM", async () => {
  await drainAllPools();
  process.exit(0);
});
```

Drain on credential rotation:
```typescript
import { drainOrgPool } from "@workspace/org-db";
await drainOrgPool(orgId);
// Pool will be recreated with fresh credentials on next withOrgContext call
```

---

## 10. Deprovisioning

**Only permitted before customer data is migrated** (`isMigrated = false`).

```
DELETE /v1/platform/organisations/:id/database/deprovision
```

If `isMigrated = true`, returns 409 and a protective error message. Use the full offboarding process instead.

---

## 11. Sprint 7 Preview

Sprint 7 will:
1. Migrate data from the shared operational tables into each org's schema
2. Create a dedicated PostgreSQL database per org (replacing shared schema)
3. Provision unique credentials per org (stored in secrets manager; referenced by `credentialsRef`)
4. Update the connection manager to use per-org connection strings
5. Remove backward-compat writes to the shared `audit_log`
6. Add automated backup scheduling and S3 export
