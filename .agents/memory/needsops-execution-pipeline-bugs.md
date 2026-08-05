---
name: NeedsOps Execution Pipeline Column Bugs
description: Two wrong Drizzle column-name references that crashed every task execution with "Cannot convert undefined or null to object" in orderSelectedFields.
---

## Context
Both bugs caused the same silent crash: `TypeError: Cannot convert undefined or null to object at Object.entries at orderSelectedFields (drizzle-orm/utils.ts:80)` because Drizzle receives `undefined` as a field value in an explicit `.select({...})` call.

**Critical architectural note:** `@workspace/db` exports `"." : "./src/index.ts"` and the API server uses an esbuild `workspaceSourcePlugin` that resolves all `@workspace/*` imports to `lib/<pkg>/src/index.ts` at bundle time. The compiled `lib/db/dist/*.d.ts` files are **only for TypeScript type-checking**, not runtime. Any column added to source after the last `tsc --build` is immediately available at runtime — the stale-dist hypothesis is wrong for this project.

## Bugs Found and Fixed

### Bug 1 — `workPackageService.ts` (FIXED)
- **Wrong:** `organisationMemoryTable.approvalStatus` (column does not exist)
- **Correct:** `organisationMemoryTable.status`
- Appeared in `.select({...})` at line 114 and `eq()` at line 120
- Crash stage: Step 2 of pipeline (Assemble Work Package Manifest)

### Bug 2 — `approvedExampleService.ts` (FIXED)
- **Wrong:** `knowledgeChunksTable.content` (column does not exist; schema defines it as `text("text")`)
- **Correct:** `knowledgeChunksTable.text`
- The SELECT alias `content` (left-hand key) is fine; it's the right-hand Drizzle column reference that was wrong
- Crash stage: Step 4 of pipeline (Retrieve Approved Examples / buildStyleGuidance)

## Safeguards Added
1. `assertSelectFields(fields, label)` guard function in both `workPackageService.ts` and `approvedExampleService.ts` — throws a **named** error before the Drizzle crash if any field value is `undefined` or `null`
2. `process.stderr.write("[pipeline] ... stage=...")` tracing added to `executeWork` progress wrapper so server logs show exactly which stage execution reaches
3. Regression test: `artifacts/api-server/src/__tests__/regression-execution-column-contracts.test.ts` (37 tests) — schema-contract layer checks live Drizzle column objects; service-integration layer verifies no crash with mock DB

## How to Detect Future Instances
Pattern: service code does `.select({ alias: someTable.colName })` where `someTable.colName` is `undefined` → Drizzle crashes with `Cannot convert undefined or null to object` deep in `orderSelectedFields`. The new `assertSelectFields` guard converts this to a named error. When the pipeline logs `stage=X` but not `stage=Y`, the crash is in the step between X and Y.

## Pre-existing Test Failures (not caused by this work)
16 failures in `src/tests/` and `src/services/__tests__/` subdirs are pre-existing:
- `sprint95-specialist-eligibility.test.ts` — tests `compliance_officer`/`document_specialist` removed in Sprint 11
- `deviceService.test.ts`, `discoveryService.test.ts`, `paymentBypass`, `INGESTION_JOB_STATUSES` — pre-existing count/mock mismatches

## Test Count After This Work
3011 passing (37 new regression tests + 2974 pre-existing passing)
