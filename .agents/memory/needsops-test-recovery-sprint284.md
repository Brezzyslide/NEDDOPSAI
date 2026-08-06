---
name: NeedsOps Test Recovery (post Sprint 28.4)
description: Classification and fixes for the 17 pre-existing test failures cleared after Sprint 28.4 landed. 0 failures, 3428 passing.
---

# Test Recovery — Post Sprint 28.4

Sprint baseline: 3394 passing, 17 failing. After fixes: 3428 passing, 0 failing.

## Failure Groups and Root Causes

### Group A — Broken mock: vi.hoisted() missing (deviceService, discoveryService)

**Problem:** `const mockDb = { ... }` declared at top-level, referenced inside `vi.mock()` factory. Vitest hoists `vi.mock()` calls ABOVE all module-level code, so `mockDb` was in the temporal dead zone (TDZ) when the factory ran. Only affects files with STATIC imports of the mocked service — static imports force the factory to execute during collection.

**Fix:** Wrap the mock object in `vi.hoisted(() => ({ ... }))`. This creates the object during the hoisting phase, making it available to the factory.

**Subtlety for discoveryService:** The service has two queries — one with `.limit()` (status query) and one that ends at `.where()` (answers query, no `.limit()`). The test had incorrectly set `mockDb.where.mockResolvedValueOnce([])` which applied to the FIRST `.where()` call (status query), returning a Promise. `.limit(1)` was then called on the Promise → `TypeError: limit is not a function`.

**Correct mock sequence:**
```typescript
mockDb.limit.mockResolvedValueOnce([]); // status query .limit(1)
mockDb.where
  .mockReturnValueOnce(mockDb)  // 1st call (status query): chain continues
  .mockResolvedValueOnce([]);   // 2nd call (answers query): resolve directly
```

**Rule:** `mockReturnThis()` inside `vi.hoisted()` works correctly when the mock is called as a method on the mockDb object. However, if a chain method has `mockResolvedValueOnce` queued, that Promise return breaks the SYNCHRONOUS chain — callers that chain further (`.limit()`) will fail with "not a function".

### Group B — Stale specialist codes (sprint95-specialist-eligibility, sprint95-specialist-reasoning)

Sprint 11 deprecated `compliance_officer` (merged into `compliance_quality_manager`) and renamed `document_specialist` to `knowledge_documentation_specialist`. Both successors have `executionStatus: "dna_pending"`. Only `operations_manager` and `chief_of_staff` have `executionStatus: "available"` and approved DNA.

**Key facts:**
- `validateSpecialistEligibilitySync()` returns `false` for any specialist with `executionStatus` in `["deprecated", "coming_soon", "dna_pending", "archived"]` — so dna_pending successors always fail sync tests that expect `true`.
- `ACTIVE_SPECIALISTS = new Set(["operations_manager"])` — only one specialist for `hasActiveIntelligence()`.
- `ACTIVE_SPECIALIST_VERSIONS = { chief_of_staff: "1.0.0", operations_manager: "1.0.0" }` — used by the intelligence service to gate `executeRun()`.
- `chief_of_staff` IS in `ACTIVE_SPECIALIST_VERSIONS` so the reasoning service handles it for `AI_PROVIDER=internal`.
- `hasActiveIntelligence("chief_of_staff")` returns `false` (only operations_manager is in ACTIVE_SPECIALISTS set) — do not use chief_of_staff to test `hasActiveIntelligence` returning `true`.

**Replacements made:**
- eligibility sync "compliance_officer + compliance.audit_readiness → true": changed to `chief_of_staff + administration.general`
- eligibility sync "document_specialist + documents.draft → true": changed to `operations_manager + operations.capacity_analysis`
- async eligible (was compliance_officer): `operations_manager + operations.capacity_analysis`
- async eligible (was document_specialist): `chief_of_staff + administration.general`
- usage_limit_reached (was compliance_officer): `operations_manager + operations.workflow_review` — valid specialist must pass all earlier checks before reaching usage gate
- getEligibleSpecialists "includes compliance_officer": updated assertion to `compliance_quality_manager`
- hasActiveIntelligence "returns true for compliance_officer": renamed to "returns false for compliance_quality_manager (dna_pending)"
- hasActiveIntelligence "returns true for document_specialist": renamed to "returns false for knowledge_documentation_specialist (dna_pending)"
- reasoning FAKE_WORK_PACKAGE: `compliance_officer + compliance.audit_readiness + compliance_auditor` → `operations_manager + operations.workflow_review + operations_manager_profile`
- reasoning test 1 (was "compliance_officer"): changed to `chief_of_staff + administration.general` with pkg override
- reasoning test 2 (was "document_specialist"): changed to `operations_manager + operations.capacity_analysis` with pkg override

### Group C — paymentBypassService: missing structured errors and org existence check

**Problem 1:** Service threw `new Error(...)` without a `.code` property. Tests expected `{ code: "PAYMENT_BYPASS_DISABLED" }`.

**Problem 2:** Service had no org existence check. Tests expected `{ code: /NOT_FOUND/ }` on missing org, but service jumped straight to plan lookup and threw `Plan not found`.

**Problem 3:** Tests used old parameter names (`orgId`, `orgSlug`, `actorUserId`) that don't match the current interface (`organizationId`, `userId`).

**Fix:** Added `BypassServiceError extends Error { readonly code: string }`. Added org existence check (step 0) before plan lookup. Replaced all `throw new Error(...)` with `throw new BypassServiceError(code, message)`. Updated tests to use current param names and removed the second redundant `mockResolvedValueOnce` (org failure never reaches plan lookup).

### Group D — Stale status count (task16-ingestion.test.ts)

Sprint 19 added `dead_lettered` and `cancelling` to `INGESTION_JOB_STATUSES`. Count is 13, not 11. Updated assertion and added explicit `.toContain()` checks for both new statuses.
