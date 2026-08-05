---
name: NeedsOps Sprint 27.3 Knowledge Resolution & Evidence Delivery Engine
description: Three architectural gaps fixed — specialists now receive chunk text; approval preserved on version replace; LLM blueprint classifier as semantic fallback.
---

## Rule: DB queries without `.limit()` fail in tests

Any `db.select().from().where()` chain that is awaited WITHOUT a terminal `.limit()` call will fail in vitest because the mock `.where()` returns the chain object (not a Promise). The chain object isn't iterable, so `for...of` throws inside a try/catch, silently returning null.

**Fix:** Always add `.limit(N)` even when you want all rows — use `.limit(500)` or `.limit(100)` as a safety cap. This applies to `getVersionLabels`, `getSourceTypes`, and `classifyBlueprintWithLLM`.

**Why:** The shared mock chain only exposes `.limit()` as the terminal thenable. Without it, the chain never resolves to an array.

## Rule: Use pre-computed IDs in fire-and-forget enqueue calls

`replaceSourceVersion` computes `newVersionId = randomUUID()` before the transaction. After the transaction, it fetches the new version via SELECT to return it to the caller. The fire-and-forget `getIngestionQueue().enqueue(...)` call must use `newVersionId` (not `newVersion!.id`) because:

1. `getIngestionQueue()` lazy-initialises and may call `db.select()` internally, consuming mock return values before the `newVersion` SELECT runs.
2. Using `newVersion!.id` with `!` crashes if the SELECT returns empty (e.g. in tests without the ingestion queue mocked).

**How to apply:** In any service function that computes a new UUID before insertion, use that UUID in any downstream fire-and-forget calls rather than re-accessing the entity's `.id` field.

## Rule: makeSelectChain helper for test DB mocks

The `makeSelectChain(limitResult, whereResult?)` helper (introduced in `sprint273-knowledge-resolution.test.ts`) creates a chain that is both:
- Awaitable without `.limit()` — `whereResult ?? limitResult` is used
- Chainable with `.limit()` — returns the `limitResult`
- Has `.orderBy()` returning a chain with its own `.limit()`

**How to apply:** Copy this helper to any new test file that needs to mock `db.select().from().where()` patterns, including both with and without `.limit()` terminal calls.

## Files added/changed this sprint

- `lib/services/knowledgeResolutionService.ts` — NEW: `resolveEvidence`, `buildEvidenceSection`, `buildCitationSummary`, in-process evidence cache, task-upload direct query
- `lib/services/workExecutionPipelineService.ts` — Step 4 calls resolveEvidence; prompt now emits `=== AUTHORITATIVE EVIDENCE ===` with chunk text; `assetIds` includes `citationRef`
- `lib/services/knowledgeSourceService.ts` — `replaceSourceVersion` no longer resets `status`; both `replaceSourceVersion` and `supersedeKnowledgeSource` fire-and-forget ingestion enqueue
- `lib/services/workBlueprintService.ts` — `selectBlueprint` two-stage: keyword fast path + `classifyBlueprintWithLLM` semantic fallback (exported); `.limit(100)` added to classification query
- `src/__tests__/sprint273-knowledge-resolution.test.ts` — 26 tests, all passing

## Test count

REQUIRED_RLS_TABLES: unchanged (no new DB tables this sprint)
Total tests: 3131 (was 3089 before sprint 27.3)
Pre-existing failures: 16 (unchanged)
