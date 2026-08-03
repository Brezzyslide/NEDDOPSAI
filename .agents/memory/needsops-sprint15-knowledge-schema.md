---
name: NeedsOps Task #15 — Knowledge Schema, Scopes & Secure Upload
description: 6 new DB tables for the Organisation Library; vi.mock hoisting rules; pagination mock chain pattern
---

## Rules

**vi.mock hoisting — always use vi.hoisted():**
Any test file that references a `const mockDb` (or other mock object) inside a `vi.mock(...)` factory MUST define those objects via `vi.hoisted(() => { ... return { mockDb, selectChain, ... }; })`. Plain `const` declarations are in the TDZ when the hoisted factory runs. Pattern established in task15 tests.

**vi.clearAllMocks() does NOT clear the once-queue:**
`mockReturnValueOnce` / `mockResolvedValueOnce` values that are set but NOT consumed in a test persist into the next test even after `vi.clearAllMocks()`. Only `vi.resetAllMocks()` (or `mockFn.mockReset()`) clears the queue. Avoid setting DB mocks in tests where the service throws before hitting the DB — the unconsumed once-value leaks.

**Paginated queries (.limit().offset()):**
`listKnowledgeSources` (and any query using `.offset()`) requires a two-step mock:
```ts
selectChain.limit.mockReturnValueOnce(selectChain); // chain, don't resolve
selectChain.offset.mockResolvedValueOnce([...data]); // terminal
```
Tests using `.limit()` as the terminal must use `selectChain.limit.mockResolvedValueOnce(...)` directly. Both patterns must coexist in selectChain — `offset` must be its own mock fn (not just `mockReturnThis`).

## Schema Added (REQUIRED_RLS_TABLES = 59)
- `knowledge_sources` — core asset record, sourceScope (library/task), taskId for isolation
- `knowledge_source_scopes` — relational scope assignments (org/workforce/specialist/dept/location/task_type)
- `knowledge_source_versions` — version lineage; isCurrent invariant enforced transactionally
- `knowledge_chunks` — placeholder for Task #16; embedding as jsonb, lexicalSearchVector as text
- `specialist_training_status` — 8-status state machine; TRAINING_STATUS_TRANSITIONS map exported
- `retrieval_audit_events` — placeholder for Task #17; citation chain for Completed Work module

**Why:** Organisation Library needs multi-source, multi-version, multi-scope knowledge with full audit trail. Task-scoped sources NEVER auto-promote to library.

## Services Added
- `knowledgeStorageService.ts` — GCSStorageAdapter, validateUploadMetadata, buildStorageKey, computeChecksum
- `knowledgeSourceService.ts` — full CRUD + version replace (transactional), scope assign/remove, approve/revoke/supersede
- `specialistTrainingStatusService.ts` — transitionTrainingStatus (validates status BEFORE DB query)

## Key invariants
- `INVALID_STATUS` is thrown before any DB call → do not mock DB in that test
- Task-scoped sources throw `TASK_SCOPE_CONFLICT` on any scope assignment
- `SELF_SUPERSEDE` when oldId === newId in supersedeKnowledgeSource
- Version replacement uses db.transaction() — test must mock `db.transaction`
- Storage keys are system-generated (no user-supplied filename), always prefixed `orgs/{orgId}/`
- Extension check fires BEFORE MIME type check in validateUploadMetadata

## Test count
1574 (was 1498 before Task #14, 1498 before Task #15 work)
