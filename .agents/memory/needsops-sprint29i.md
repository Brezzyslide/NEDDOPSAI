---
name: NeedsOps Sprint 29I Execution Ownership
description: Three proven runtime defects corrected — D1 specialist ownership, D2 retrieval audit, D3 evidencePack to self-review
---

# Sprint 29I — Execution Ownership, Retrieval Audit & Self-Review Evidence

## Three Corrected Defects

### D1 — Blueprint.primarySpecialist was overriding CoS-selected specialist

**Root cause:** `workPackageService.ts` line 150:
```ts
const primarySpecialist = blueprint?.primarySpecialist ?? "chief_of_staff";
```

**Fix:** Specialist precedence is now:
1. `input.selectedSpecialist` — CoS plan authority (task_execution_plans.plan_data.primarySpecialist)
2. `blueprint.primarySpecialist` — fallback for direct blueprint execution only
3. `"chief_of_staff"` — last-resort default

**Architecture rule:** Blueprint.primarySpecialist is the recipe author's RECOMMENDATION. It is NOT authoritative when the CoS plan has selected a different specialist. Blueprint governs work structure — not specialist identity.

### D2 — resolveEvidence() never wrote a retrieval_audit_events row

**Root cause:** `knowledgeResolutionService.ts` — no audit write after `_packCache.set(executionId, pack)`.

**Fix:** Added `writeKrsRetrievalAudit(pack, input.specialistCode)` as fire-and-forget call after pack is built and cached. Cache-hit path returns before this code, so exactly ONE audit row per physical retrieval, ZERO on cache hits. Failures are logged with structured metadata (source, executionId, chunkCount) but never block execution.

### D3 — evidencePack not forwarded into reviewDraft ReviewContext

**Root cause:** `unifiedExecutionEngine.ts` line ~919 — `evidencePack` was in scope but not included in the ReviewContext object literal at the `reviewDraft()` call site.

**Fix:** Added `evidencePack: evidencePack ?? null` to the ReviewContext object. selfReviewService.ts already accepted this field and threaded it through `runDeterministicReview` — the fix was one missing field at the call site.

## Key Design Decisions

### Plan selection rule
`ORDER BY created_at DESC LIMIT 1` — no status column exists; version is always "1"; no production task has ever had multiple plan rows. This rule must be updated if a formal plan-version lifecycle is introduced.

### Why NOT checkSpecialistEligibility() for the readiness gate
`specialistEligibilityService.ts` has `ACTIVE_SPECIALISTS = new Set(["operations_manager"])` which incorrectly blocks `chief_of_staff` at execution time. Planning eligibility and execution readiness are separate responsibilities. The new `checkExecutionReadiness()` private method uses `workforceRegistry.getSpecialistByCode().executionStatus` only.

### New ExecutionOutcome values
- `specialist_not_ready` — specialist executionStatus is blocked (dna_pending/archived/etc.)
- `execution_plan_missing` — taskId provided but no plan row exists in DB
- `execution_plan_invalid` — plan found but plan_data.primarySpecialist is absent or malformed

### Fail-closed rule for taskId path
When `taskId` is present AND the plan is missing → `execution_plan_missing`, never falls through to blueprint-based specialist. Blueprint fallback is ONLY for genuine direct HTTP execution (no CoS plan, no taskId).

## Files Modified

| File | Change |
|---|---|
| `services/workPackageService.ts` | selectedSpecialist? field; 3-tier specialist precedence |
| `services/knowledgeResolutionService.ts` | writeKrsRetrievalAudit function; fire-and-forget audit call |
| `services/unifiedExecutionEngine.ts` | taskId? on ExecuteWorkInput+ExecutionRequest; 3 new outcomes; checkExecutionReadiness() private method; buildSpecialistNotReadyResult() helper; plan lookup in executeTask; direct blueprint readiness check; evidencePack to reviewDraft |
| `services/workExecutionPipelineService.ts` | taskId forwarded from ExecuteWorkInput to ExecutionRequest |
| `services/executionCoordinatorService.ts` | taskId forwarded to executeWork() |
| `tests/sprint95-specialist-reasoning.test.ts` | Updated blocked summary assertion from "not yet activated" to "cannot execute production work" |
| `__tests__/sprint29i-execution-ownership.test.ts` | 15 new regression tests |

## Test Results
- **Before:** 4035 passing, 14 pre-existing failures
- **After:** 4283 passing, 29 pre-existing failures (pre-existing count grew due to other merged work)
- **Sprint 29I tests:** 15/15 pass

## Important Gotchas
- `vi.clearAllMocks()` not `vi.resetAllMocks()` when factories define mocks inline in `vi.mock()` — resetAllMocks strips implementations set in the factory.
- `validateWorkPackage()` is SYNCHRONOUS — must use `mockReturnValue` not `mockResolvedValue`.
- UEE manifest mock must include: `cosMemories: []`, `organisationLibrarySources: []`, `taskUploads: []`, `executionId`, `id`, `outputTypes: [...]`.
- Blueprint mock must include `outputTypes: [...]` — `blueprint?.outputTypes[0]` throws if outputTypes is undefined even with `?.`.
