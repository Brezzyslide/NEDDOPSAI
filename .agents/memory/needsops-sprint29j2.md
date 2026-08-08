---
name: NeedsOps Sprint 29J.2 — Approved Version Fail-Closed & Audit Completeness
description: Two integrity gaps from Sprint 29J.1 proof gate closed — broken modern pin now fail-closed, audit metadata now complete.
---

## Rule
`resolveApprovedVersion(work, versions)` is the canonical approved-version resolver.
All callers (export service, viewer, quality) must use it — no inline fallback logic.

**Three cases (must be kept in sync across service, viewer, export):**
1. `status === "approved" && approvedVersionId != null` → CASE 1 (modern): resolve exact pin; throw `APPROVED_VERSION_INTEGRITY_ERROR` (code + statusCode 409) if unresolvable
2. `status === "approved" && approvedVersionId == null` → CASE 2 (LEGACY_APPROVAL_FALLBACK): return `versions[0]`
3. any other status → CASE 3: return `versions[0]`

**Why:** Sprint 29J.1 proof gate (Test H) found that `?? versions[0]` silently exported unapproved content for broken modern pins. Test J found `approvedVersionId` was missing from audit event metadata.

**Critical gotcha:** Use `!= null` (loose) NOT `!== null` (strict). `undefined != null` is `false` in JS (caught by loose), but `undefined !== null` is `true` (NOT caught by strict). Pre-29J.2 fixtures that have no `approvedVersionId` field (undefined) must follow the LEGACY path, not the fail-closed modern path.

## Audit completeness
`approve()` now passes `metadata: { completedWorkId, approvedVersionId, approvedByUserId, approvedAt }` to `transitionStatus()`. The `completed_work_approved` event metadata therefore includes all four fields needed for reconstruction without reading the mutable DB row.

## DB integrity finding
The FK constraint on `completed_work.approved_version_id → completed_work_versions(id)` prevents broken modern pins from being stored at the DB level (confirmed live: UPDATE rejected with FK violation). This is STRONGER than service-level fail-closed — a broken pin cannot even exist in the DB.

## Test mock pattern
All test files that mock `completedWorkService.js` AND test `CompletedWorkExportService` must use:
```ts
vi.mock("../services/completedWorkService.js", async (importOriginal) => {
  const original = await importOriginal<...>();
  return { ...original, approve: vi.fn(), getCompletedWork: vi.fn(), getVersions: vi.fn(), ... };
  // resolveApprovedVersion: kept real (pure sync, no DB)
});
```
Files fixed: `sprint29j-approved-version-integrity.test.ts`, `sprint29j-completed-work-viewer.test.ts`, `sprint29j2-approved-version-fail-closed.test.ts`.

## Test counts
- 60 new tests in `sprint29j2-approved-version-fail-closed.test.ts` (H1–H15 + regression)
- 82 total across all three sprint29j* test files — all pass
- Full suite: 4367 passing / 27 pre-existing failures (count unchanged)
