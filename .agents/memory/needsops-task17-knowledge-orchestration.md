---
name: NeedsOps Task #17 Knowledge Orchestration Engine
description: 8-layer knowledge retrieval system, provider registry patterns, test isolation rules, 85 new tests, 1856 passing
---

## Architecture
- 8-layer priority: P1 task_upload → P2 entity → P3 org_memory → P4 specialist → P5 library → P6 desktop / P7 cloud / P8 web (stubs)
- PriorityLayer type uses SHORT names: "task_upload", "entity", "org_memory", "specialist", "library", "desktop", "cloud", "web_search"
- ALL engine constants (LAYER_BUDGET_FRACTIONS, PRIORITY_LAYER_BONUS, DEFAULT_LAYER_LIMITS) and output partition filters use the same short names

## Provider conditional skips — critical for tests
- **P1 (TaskUploadProvider)**: skips `db.execute` entirely when `taskId` is null/undefined
- **P2 (EntityKnowledgeProvider)**: skips `db.execute` entirely when `entityIds` is empty/undefined
- For `baseInput` (no taskId, no entityIds): **only P4 and P5 call `db.execute`** (2 calls, not 4)
- For inputs with taskId but no entityIds: P1 + P4 + P5 call `db.execute` (3 calls)
- P3 (OrgMemoryProvider) always uses `db.select` (not `db.execute`)
- P6–P8 future stubs return `{ notImplemented: true }` with no DB calls

## Provider registry isolation — test pattern
- `_resetProviderRegistry()` exported from `IKnowledgeProvider.ts` (test-only, prefixed with `_`)
- **Must call `_resetProviderRegistry()` in `beforeEach`** of orchestration tests
- `ensureProvidersRegistered()` now checks `getProvider("task_upload")` rather than `existing.length > 0` — prevents test-registered mock providers from blocking standard provider registration
- `ALL_FUTURE_PROVIDERS` in FutureProviders.ts is an array of pre-instantiated instances (not classes) — same instances re-registered each test (safe, stateless)

## Mock queue discipline — critical
- Use `mockReset()` in `beforeEach`, NOT `vi.clearAllMocks()` — `clearAllMocks` does NOT clear `mockResolvedValueOnce` queue; leftover items corrupt subsequent tests
- Pattern: `mockDb.execute.mockReset(); mockDb.execute.mockResolvedValue({ rows: [] });`
- Number of `mockResolvedValueOnce` calls must exactly match the number of providers that will call `db.execute` for that input shape

## Test count
- Task #17 adds 85 tests (all passing)
- 16 pre-existing failures unrelated to Task #17: sprint95 specialists removed in Sprint 11, device/payment service setup issues
- Total at completion: 1856 passing tests

**Why:** Provider count bugs caused tests to "pass trivially" with 0 items retrieved. The `_resetProviderRegistry` fix in `beforeEach` properly exercises the full provider pipeline and exposes whether mocks are correctly positioned.
