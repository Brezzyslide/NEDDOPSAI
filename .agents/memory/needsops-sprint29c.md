---
name: NeedsOps Sprint 29C Canonical Execution Context
description: Architecture sprint — ExecutionContextBuilder, CanonicalExecutionContext in both engine paths, conversation EvidencePack, requester identity threading, endToEndWorkflowService deprecation.
---

## Key decisions

**Naming collision (critical):** Sprint 28.5 already owned `conversationContextBuilder.ts` (CoS LLM context — memory, workforce, library presence, action state). Sprint 29C service was renamed to `executionContextBuilderService.ts` with its main export `buildExecutionContext`. Never write Sprint 29C deliverables to `conversationContextBuilder.ts`.

**conversationContextBuilder.ts must sequence messageContext before actionState:** `resolveConversationActionState` requires `recentMessages` to detect `task_proposal` / `plan_proposal` message types. The builder runs `buildMessageContext` in Round 1a (parallel with CoS context + workforce), then feeds `msgCtx.recentMessages` into `resolveConversationActionState` in Round 1b (sequential after Round 1a). Passing an empty array silently skips proposal detection.

**executionContextBuilderService.ts:** Queries `specialistRunsTable` for the run, calls `buildSpecialistContext` + `buildWorkPackage` (both mocked in tests), returns `{ workPackage, context, effectiveRequesterId, effectiveRequesterRole }`. Defaults `effectiveRequesterId = "system"` when not provided. Makes no AI gateway calls (pure DB + context assembly).

**CanonicalExecutionContext in both engine paths:** `executeTask()` and `executeConversation()` each instantiate `const ctx: CanonicalExecutionContext = { ... }` at the top. Both paths have the pattern `const ctx: CanonicalExecutionContext` — grep for this to verify.

**resolveEvidenceForConversation delegates actively:** ResourceRegistry's `resolveEvidenceForConversation` must call `await resolveConversationEvidence(...)` (from knowledgeResolutionService) — not return null. Tests assert `toContain("await resolveConversationEvidence(")`.

**endToEndWorkflowService.ts:** Marked `@deprecated LEGACY / DISCONNECTED`. Only the file itself and test files should reference it — no live production callers. Sprint-pcs-platform-completion.test.ts imports it (historical test) so the "no live callers" assertion must exclude `__tests__/` files.

## extractDocumentSearchTerms — backward-scan algorithm

**Never use a greedy forward regex with `gi` flag.** It matches the full sentence ("Review Our Medication Management Policy") instead of just the doc name.

**Correct algorithm:** Scan words array left-to-right. When a SUFFIX keyword is found (case-insensitive), scan BACKWARDS collecting words until:
1. A word containing an apostrophe (possessive / contraction) → STOP
2. A word in the GENERIC stop set → STOP
3. Start of array → STOP

**GENERIC stop set must include pronouns:** "me", "us", "we", "you", "he", "him", "she", "her", "it", "they", "them" etc. Without "me", `"Help me plan..."` would collect "Help" + "me" before "plan" → wrong match "Help Me Plan".

**Suffix list does NOT include:** "review", "reviews", "process", "processes" — too likely to false-positive on verbs. Includes: policy, procedure, plan, protocol, standard, framework, guide, guideline, manual, handbook, act, award, agreement, code, charter, assessment, sop (and their plurals).

**Case normalization:** All-caps acronyms (SOP, NDIS) preserved. Small connector words (of, for, in, at, to) lowercased in middle positions. Everything else Title-cased. Cap at 5 results.

## Test patterns

**Hoisted DB mock for sprint29c tests:** Use `const mockDbSelect = vi.hoisted(() => vi.fn())` and wire it into `vi.mock("@workspace/db")`. Do NOT use `require("@workspace/db")` inside helper functions — `require` in ESM vitest context does not reliably get the mocked module. Use `mockDbSelect.mockImplementationOnce(...)` directly.

**mockDbRunReturn helper:**
```javascript
function mockDbRunReturn(run) {
  mockDbSelect.mockImplementationOnce(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: (cb) => Promise.resolve(cb([run])),
        }),
      }),
    }),
  }));
}
```

## Test count

3,453 passing after Sprint 29C (up from 3,382 before this sprint). The Sprint 28.7 memory note citing 3,642 appears to reflect a different test run configuration; the actual baseline entering Sprint 29C was ~3,382.
