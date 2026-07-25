---
name: NeedsOps Sprint 7 Platform Database Boundary
description: Sprint 7 conventions, gotchas, and decisions for database isolation, secrets, backup/restore, RLS, and AI gateway
---

## What Sprint 7 established

Separate PostgreSQL databases per org (shared-cluster mode for dev, separate DB for production), AES-256-GCM secrets service, logical backup/restore with cross-org protection, automated data migration, RLS startup enforcement, and AI Privacy Gateway foundation.

## Dual-mode connection manager

`withOrgContext` checks `isDedicatedDb` in the registry. If true, retrieves credentials from secrets service via `credentialsRef`. If false, uses `DATABASE_URL` with `SET search_path = org_<uuid>`. Pool is always keyed by `organizationId` (UUID), never by slug or schema name.

**Why:** Slug changes must not change routing. UUID is stable.

**How to apply:** All new org-scoped DB operations must go through `withOrgContext`. Never pass slug to the connection manager.

## Backup restore uses json_populate_recordset

The restore loop uses `INSERT INTO schema.table SELECT * FROM json_populate_recordset(null::schema.table, $json)` not hand-built SQL VALUES clauses.

**Why:** `org_settings.value` is JSONB. Hand-built SQL with `'Australia/Sydney'` (unquoted string) fails JSONB parsing. `json_populate_recordset` delegates all type casting to PostgreSQL.

**How to apply:** Any new backup restore code must use this pattern or prepared statements, never string interpolation for typed columns.

## Drizzle schema must match DB columns

When new columns are added to `org_database_registry` via SQL migration, the Drizzle schema file (`orgDatabaseRegistry.ts`) must be updated simultaneously. Otherwise `update(...).set({ newCol: value })` generates `UPDATE ... SET  WHERE ...` (empty SET) and fails silently.

**Why:** Sprint 7 configure_backup step failed until `isDedicatedDb`, `backupConfig`, `backupStatus` etc. were added to the Drizzle schema.

**How to apply:** Whenever a SQL migration adds columns to a table, update the matching Drizzle schema in the same commit.

## org_task_execution_plans needs migrated_from_id

Sprint 7 migration adds `migrated_from_id` to `org_tasks`, `org_approvals`, `org_approval_history` AND `org_task_execution_plans`. The sprint7-extended DDL in `orgSchemaVersions.ts` must include all four tables.

**Why:** The copy_task_execution_plans migration stage uses this column for lineage tracking.

## task_specialists has role not execution_status

The public `task_specialists` table has `role` column. The migration SQL must use `ts.role`, not `ts.execution_status`.

**Why:** `execution_status` doesn't exist in the table schema. The migration SQL was wrong initially.

## Platform Console response must never include credentialsRef

The `platformDatabase.ts` status endpoint explicitly omits `credentialsRef` from the response. This is intentional and must not be accidentally re-added.

**How to apply:** When adding new fields to the status endpoint, always check they do not include any secrets or credential references.

## RLS startup check is mandatory

Server startup calls `runRLSStartupCheck()` which calls `verifyRLS({ failFast: true })`. If any of 19 tables is missing RLS, server exits with code 1.

**How to apply:** Any new shared operational table that carries tenant data must be added to `REQUIRED_RLS_TABLES` in `rlsVerifier.ts` AND have RLS enabled in the platform boundary migration SQL.

## AI Gateway is the ONLY approved LLM integration point

No route or service may import OpenAI/Anthropic/Gemini SDKs directly. All LLM calls must go through `createAIGateway(ctx).process(request)`. External providers are not connected until Sprint 9.

**How to apply:** If a route needs AI, import from `@workspace/ai-gateway` only. The gateway enforces identity, purpose, provider, and field access before any call.

## Test orgs use null for originatingUserId in shared tasks table

The `tasks.originating_user_id` column is a FK to `users`. Test code that seeds tasks for migration tests must use `originatingUserId: null` (nullable) to avoid FK violations when test users don't exist in the platform users table.
