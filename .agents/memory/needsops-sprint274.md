---
name: NeedsOps Sprint 27.4 Execution Inspector
description: Observability-only sprint — inspector service, fire-and-forget manifest observability writes, RBAC pattern, and test conventions
---

## Observability Column Pattern

Four nullable JSONB columns added to `work_package_manifests`:
- `selection_metadata` — set at manifest assembly time (via `assembleWorkPackage`)
- `validation_snapshot` — set fire-and-forget after Step 3 (validation)
- `performance_metrics` — set fire-and-forget on completion OR failure
- `failure_info` — set fire-and-forget on failure or awaiting_clarification

**Why:** Reading them back at inspection time costs nothing; writing them must never block the execution path.

## updateManifestObservability Rule

`updateManifestObservability(manifestId, updates)` in `workPackageService.ts` MUST be called fire-and-forget:
```ts
updateManifestObservability(manifest.id, { ... }).catch(() => {});
```
Never `await` it in the execution path. The function skips the DB call entirely when the updates object has no known keys (defensive no-op).

**Why:** An observability write failure must not abort or delay the execution.

## RBAC Pattern for Inspector

Inspector service receives `actorId: string` and `role: "org_user" | "platform_owner"`.
- `org_user`: only sees executions where `manifest.requesterId === actorId`
- `platform_owner`: sees all executions in the org (no requesterId check)

**How to apply:** Check role before returning — return `null` for RBAC failures.

## matchedPhrase null-safety

`selectionMetadata.matchedKeywords?.join(", ")` returns `""` for an empty array.
Must guard: only populate `matchedPhrase` when `method === "keyword"` AND `matchedKeywords.length > 0`.
Otherwise return `null`.

## Sprint271 Regression Fix

When `workPackageService.js` is mocked in existing tests, `updateManifestObservability` must be included in the mock factory or vitest throws "No export defined" at test time:
```ts
vi.mock("../services/workPackageService.js", () => ({
  assembleWorkPackage: vi.fn()...
  updateManifestObservability: vi.fn().mockResolvedValue(undefined), // required
}));
```

Also: `selectBlueprint` mock must include `{ matchedKeywords: [], fallbackUsed: false, confidence: 0 }` in its return shape — the pipeline now reads these fields to build `selectionMeta`.

## workBlueprintsTable.title (not .name)

The `work_blueprints` table column is `title`, not `name`. The inspector uses `workBlueprintsTable.title` when fetching blueprint display name.

## Test Count

After Sprint 27.4: **3,178 total tests, 3,162 passing, 16 pre-existing failures** (same 16 as before).
New sprint274 test file: `src/__tests__/sprint274-execution-inspector.test.ts` — 47 tests.
REQUIRED_RLS_TABLES = 70 (unchanged — no new DB tables in this sprint).
