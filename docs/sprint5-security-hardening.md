# Sprint 5 — Tenant Security Hardening

## Overview

Sprint 5 adds database-level Row Level Security (RLS) as a second enforcement layer beneath the existing application-layer tenant isolation. It also splits the shared audit log into purpose-specific tables and restricts the platform console from accessing operational data.

---

## 1. Two-Layer Isolation Model

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 — Application Layer (always enforced, all roles)       │
│                                                                 │
│  • resolveTenantFromSlug middleware verifies membership before  │
│    attaching tenantContext.tenantId to the request              │
│  • Services and routes ONLY use tenantContext.tenantId in WHERE │
│    clauses — never accept org IDs from the client               │
│  • TypeScript enforces withTenantContext usage at compile time  │
└────────────────────────┬────────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────────┐
│  Layer 2 — PostgreSQL RLS (enforced for needsops_app role)      │
│                                                                 │
│  • 19 operational tables have ENABLE ROW LEVEL SECURITY         │
│  • Policy: organization_id = NULLIF(                            │
│      current_setting('app.current_organization_id', TRUE), ''   │
│    )                                                            │
│  • Fails CLOSED: when context not set, NULLIF returns NULL,     │
│    and no row matches NULL                                       │
│  • Superuser bypasses RLS (by PostgreSQL design) — used only    │
│    for platform admin queries and migrations                     │
│  • needsops_app role: NOSUPERUSER, NOLOGIN, NOINHERIT,         │
│    NOBYPASSRLS — enforces RLS strictly                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. withTenantContext API

**File:** `lib/db/src/tenantAccess.ts`

### Primary accessor: `withTenantContext`

```typescript
import { withTenantContext } from "@workspace/db";

// In a route handler, after resolveTenantFromSlug runs:
const tasks = await withTenantContext(
  {
    tenantId: req.tenantContext.tenantId,
    userId:   req.tenantContext.userId,
    purpose:  "task.list",
  },
  (tx) => tx.select().from(tasksTable)
            .where(eq(tasksTable.organizationId, req.tenantContext.tenantId)),
);
```

**What it does:**
1. Opens a database transaction
2. Calls `set_config('app.current_organization_id', tenantId, true)` — `is_local=true` means the setting is cleared automatically when the transaction ends (no pool leakage)
3. Executes your callback with the transaction
4. Returns the result and closes the transaction

### System context (bypasses RLS, for cross-org aggregate queries):

```typescript
import { withSystemTenantContext } from "@workspace/db";

const allOrgs = await withSystemTenantContext(async (db) => {
  return db.select({ count: count() }).from(organizationsTable);
});
```

### Platform context (read-only platform tables only):

```typescript
import { withPlatformContext } from "@workspace/db";

const plans = await withPlatformContext(async (platformDb) => {
  return platformDb.select().from(plansTable);
});
```

---

## 3. RLS Policy Details

**Migration:** `lib/db/migrations/sprint5-rls.sql` (idempotent — safe to re-run)

### Tables with RLS enabled (19 total):

| Category          | Tables                                                              |
|-------------------|---------------------------------------------------------------------|
| Membership        | memberships, invitations                                            |
| Subscriptions     | tenant_subscriptions, tenant_entitlements, tenant_overrides         |
| Add-ons & Usage   | tenant_addons, tenant_usage_allowances, tenant_workforce_packs      |
| Settings          | tenant_settings                                                     |
| Usage tracking    | usage_events, usage_period_summaries                                |
| Tasks             | tasks, task_execution_plans, task_specialists                       |
| Approvals         | approvals, approval_rules, approval_history                         |
| Audit             | org_audit_log                                                       |
| Legacy audit      | audit_log (has RLS policy, references organizationId column)        |

### Policy definition (same on all tables):

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (
    organization_id = NULLIF(
      current_setting('app.current_organization_id', TRUE),
      ''
    )
  );
```

### SECURITY DEFINER aggregate functions (for platform console):

These functions run with elevated privileges to compute aggregate counts across org boundaries, without exposing individual records:

```sql
platform_get_org_task_count(org_id TEXT) → BIGINT
platform_get_org_approval_count(org_id TEXT) → BIGINT
platform_get_org_pending_approval_count(org_id TEXT) → BIGINT
```

---

## 4. Join Table Ownership Fix

Three join tables lacked a direct `organization_id` column, creating potential for cross-org data access via joined queries. Fixed in Sprint 5:

| Table                 | Change                                           |
|-----------------------|--------------------------------------------------|
| `approval_history`    | Added `organization_id TEXT NOT NULL` + index    |
| `task_execution_plans`| Added `organization_id TEXT NOT NULL` + index    |
| `task_specialists`    | Added `organization_id TEXT NOT NULL` + index    |

**Service changes:** Both `taskService.createTask()` and `approvalService.createApproval()` / `resolveApproval()` now include `organizationId` in all insert operations for these tables.

---

## 5. Audit Log Split

**Old:** Single shared `audit_log` table for all event types.

**New (Sprint 5):**

| Table                | Purpose                                           | Org scoped |
|----------------------|---------------------------------------------------|------------|
| `platform_audit_log` | Platform staff actions, system events             | No (global)|
| `org_audit_log`      | Organisation operational events                   | Yes (RLS)  |
| `audit_log`          | Legacy — still written for backward compat        | Mixed      |

**Audit service routing (`auditService.ts`):**

```
event.type starts with "platform." → platformAuditLogTable
event has organizationId            → orgAuditLogTable
both write also to                  → audit_log (backward compat until Sprint 7)
```

New helper for org events:
```typescript
import { logOrgEvent } from "../services/auditService";

await logOrgEvent({
  organizationId: ctx.tenantId,
  actorUserId:    ctx.userId,
  eventType:      "task.completed",
  resourceType:   "task",
  resourceId:     task.id,
  accessPurpose:  ctx.purpose,
});
```

---

## 6. Platform Console Restrictions

The platform console (`/v1/platform/organisations/:id/*`) must NEVER expose operational content.

**`GET /v1/platform/organisations/:id`** — returns aggregate counts only:
```json
{
  "id": "...",
  "name": "...",
  "taskCount": 14,
  "approvalCount": 3,
  "pendingApprovalCount": 1
}
```

**`GET /v1/platform/organisations/:id/tasks`** — restricted:
```json
{ "restricted": true, "total": 14, "message": "Task content is restricted..." }
```

**`GET /v1/platform/organisations/:id/approvals`** — restricted:
```json
{ "restricted": true, "total": 3, "message": "Approval content is restricted..." }
```

---

## 7. Known Limitations

| Limitation | Status | Resolution |
|-----------|--------|------------|
| Superuser connection bypasses RLS | By design | needsops_app role enforced in Sprint 6 connection manager |
| audit_log backward compat writes | Sprint 5 temporary | Removed in Sprint 7 |
| needsops_app role password is a placeholder | Must be rotated | Rotate before Sprint 6 production deployment |
| RLS policies wiped on drizzle push table recreation | Risk | Always re-run sprint5-rls.sql after drizzle push |

---

## 8. Re-running the RLS Migration

The migration is idempotent. Run after any `drizzle push` that touches operational tables:

```bash
psql "$DATABASE_URL" -f lib/db/migrations/sprint5-rls.sql
```

Expected output: `COMMIT` with NOTICE messages for each table.
