---
name: NeedsOps Sprint 28.4 Delegation Integrity
description: Action state model, DB resolver, phrase detection + correction, LLM/deterministic/fallback path enforcement, audit fields — truthful action language in CoS responses
---

# Sprint 28.4 — Delegation Integrity and Truthful Action Language

## What was built
- `conversationActionStateService.ts` — resolves `ConversationActionState` from DB + recentMessages. 11 levels: informational → proposal_created → task_created → specialist_assigned → execution_dispatched → execution_started → completed (+failed/pending variants). Specialists query requires `.limit(100)` (not open-ended await) so DB mock chain works.
- `delegationIntegrityService.ts` — phrase detection (5 pattern groups), state-aware filtering, pattern-substitution correction, audit fields. `premature_proceed` patterns must NOT fire when "confirmed/when you approve/once you confirm" follows (conditional guard in regex).
- `chiefOfStaffLLMService.ts` — action state resolved once before both LLM and deterministic paths. `buildLayeredUserMessage` and `buildLegacyUserMessage` receive `actionStateSection?` as new last param. `parseAndValidateLLMResponse` receives `actionState?` and sets `actionIntegrityViolationDetected` on return. Deterministic + LLM-fallback paths both apply `checkDelegationIntegrity`.

## Key rules / gotchas
**Why:** prevent CoS from claiming assignment/execution/completion unless DB state confirms it.

**DB mock pattern for action state tests:**
- Use a self-referential chain: `dbChain[m] = vi.fn(() => dbChain)` for select/from/where/orderBy; `dbChain.limit = vi.fn().mockResolvedValue([])` as the only resolver.
- Reset with `mocks.dbLimitFn.mockResolvedValue([])` in beforeEach after `vi.resetAllMocks()`.
- Use `mocks.dbLimitFn.mockResolvedValueOnce(...)` in sequence for specialists → intents → completed_work.

**Action state injection order in prompt:**
  `=== CURRENT ACTION STATE ===` → `=== AVAILABLE AI WORKFORCE ===` → presence section → user message

**Execution intent status mapping:**
- `dispatched` → level `execution_started`
- `approved` → level `execution_dispatched`
- All others (`prepared`, `pending_approval`) → level `task_created` (if no specialist assigned)

## Test baseline after this sprint
3,394 passing | 17 pre-existing failures (the `task16-ingestion INGESTION_JOB_STATUSES expects 11` failure is pre-existing from task19 adding 2 statuses — not introduced here)
