---
name: NeedsOps Sprint 29J.1 Approved Version Integrity
description: approved_version_id column, approve() pin, export resolution, viewer banner, 24 tests
---

# Sprint 29J.1 — Approved Version Immutability

## The rule
When `approve()` is called, it pins `approvedVersionId` to `versions[0].id` at that exact moment.
`addVersion()` / restore (= addVersion with old content) update `currentVersionId` but NEVER touch `approvedVersionId`.
Export and viewer resolve to the pinned version for approved work; fall back to `versions[0]` for legacy rows where the field is null.

## Why
Before this fix, `completed_work` had no `approvedVersionId` column. Both the export service and viewer used `versions[0]` (latest by version_number DESC). Any post-approval `addVersion()` call — including a UI "Restore" action — silently replaced the exported content without re-triggering approval.

## Files changed
- `lib/db/src/schema/completedWork.ts` — `approvedVersionId: text("approved_version_id")` column added
- `artifacts/api-server/src/services/completedWorkService.ts`:
  - `CompletedWorkItem` interface gains `approvedVersionId: string | null`
  - `approve()` fetches `versions[0].id` and writes it to `approvedVersionId` via `extraUpdates`
  - `mapRow()` reads `(row as any).approvedVersionId ?? null` (cast needed until Drizzle regenerates types)
  - `getApprovedVersion(id, orgId)` helper added: returns pinned version or fallback
- `artifacts/api-server/src/services/completedWorkExportService.ts`:
  - Resolves to `versions.find(v => v.id === work.approvedVersionId) ?? versions[0]` for approved work
  - Filename version number comes from `resolvedVersion.versionNumber` (approved, not current)
- `artifacts/needsops-web/src/pages/app/CompletedWorkViewer.tsx`:
  - Local `CompletedWorkItem` gains `approvedVersionId?: string | null`
  - `approvedVersion` and `hasNewerRevision` computed from `work.approvedVersionId`
  - Work tab shows amber integrity banner when `hasNewerRevision` is true
  - Quality tab uses `approvedVersion` (not `versions[0]`)

## DB migration
```sql
ALTER TABLE completed_work
  ADD COLUMN IF NOT EXISTS approved_version_id TEXT
  REFERENCES completed_work_versions(id);
```
Applied via psql.

## mapRow cast
`(row as any).approvedVersionId` — Drizzle's `$inferSelect` type doesn't know about the new column until `lib/db` is rebuilt. The cast is safe: PostgreSQL returns the column via the `SELECT *` query used by `getCompletedWork`.

## Dangerous case tested (test 8 & 9)
Approve V2, then create V3 (or restore V1 as V3) → PDF/DOCX export still returns V2 content. Filename says `-v2.` not `-v3.`.

## Legacy rows
`approvedVersionId = null` → fallback to `versions[0]`. No migration of old rows needed; they behave as before.

## Test count
24 new tests in `sprint29j-approved-version-integrity.test.ts`, covering: pin at signing, stable pin through multiple addVersion() calls, dangerous cases, cross-tenant, legacy fallback, audit event.
