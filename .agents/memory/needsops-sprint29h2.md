---
name: NeedsOps Sprint 29H.2 Action State Decision Contract
description: ConversationActionDecision typed operation, Part A level fix, Part D grounded metadata, Part E attribution integrity, Part C rerun dispatch wiring
---

## Part A — Level resolution fix
- Removed `if (s.completedWorkId) return "completed"` from `resolveLevel()` in `conversationActionStateService.ts`
- Historical completed work is now context, not an execution-state override
- Level resolves from active execution state (task + specialists + execution intent) only

## Part B — ConversationActionDecision type (new service)
- `conversationActionDecisionService.ts` — new file
- 7 action types: respond / view_existing / summarise_existing / approve_existing / revise_existing / rerun_existing / create_new_work
- `resolveActionDecision(text, understanding, actionState)` — 7-rule priority chain
- `hasRerunSignal()` — 20 RERUN_KEYWORDS checked against message text (beats mode classification)

## Part C — Dispatch wiring
- `dispatchWorkExecution` import kept in `conversations.ts` route handler (NOT in `conversationService.ts`)
- **Why:** `executionCoordinatorService.ts` already imports from `conversationService.ts` — circular dep if added there
- Route handler fires `dispatchWorkExecution` for `rerun_existing` and `revise_existing` after SSE agent_message event
- `create_new_work` uses existing `autoCreateAndDispatch` path (condition now includes `actionDecision.action === "create_new_work"`)

## Part D — Grounded metadata
- `CompletedWorkRecord` interface added to `ConversationActionState`
- DB query joins `completedWorkTable` LEFT JOIN `completedWorkVersionsTable` on `currentVersionId`
- `buildActionStateSection()` adds `=== HISTORICAL COMPLETED WORK ===` block with primarySpecialist, status, title, qualityScore, ATTRIBUTION RULE warning

## Part E — Attribution integrity
- `specialist_attribution` added to `ViolationCategory` union
- `checkSpecialistAttribution()` detects false attribution (specialist name + completion verb, excludes actual primarySpecialist)
- Runs BEFORE early-return in `checkDelegationIntegrity` so it catches attribution errors even without other violations
- Correction: replaces false claim with "work was produced by {primarySpecialist}"
- Enforced at ALL levels including "completed"

## Mock chain rule (sprint284)
- DB chain mock must include `leftJoin` when testing `resolveConversationActionState`
- `(["select", "from", "where", "orderBy", "leftJoin"] as const).forEach(m => { dbChain[m] = vi.fn(() => dbChain); })`

## Pre-existing failures (not Sprint 29H.2 regressions)
- sprint285-conversation-context-builder: test checks `ctx.organisation.name` but impl stores at `ctx.organisation.profile.name`
- sprint95-specialist-reasoning: "not yet activated" message changed in Sprint 11
- sprint29f1-real-connector-acceptance: requires live physical connector

## Live DB verification (mhr-holdings-2)
- Level: `specialist_assigned` (no longer `completed`) ✓
- completedWork.primarySpecialist: `knowledge_documentation_specialist` ✓
- S6 acceptance message → `rerun_existing` with `rerun_signal_existing` reason ✓
- All 8 scenarios: PASS ✓

## Test counts
- sprint29h2-action-state-decision-contract.test.ts: 39 tests
- sprint29h2-db-integration-probe.test.ts: 11 tests
- Full suite: 4173 total, 4157 passing, 15 pre-existing failures
