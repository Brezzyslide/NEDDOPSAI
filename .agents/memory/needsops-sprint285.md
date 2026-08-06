---
name: NeedsOps Sprint 28.5 Conversation Context Builder
description: Single authoritative context assembly layer — ConversationContext type, builder, CoS migration, test patterns
---

## What was built

`conversationContextBuilder.ts` — the single authoritative context assembly layer for all AI employees.

## Key rules

**Builder is read-only.** Never calls LLMs, never modifies state, never dispatches.

**Parallelism:** Round 1 = `buildMessageContext` + `buildChiefOfStaffContext` + `getConversationWorkforceContext` + `checkOrganisationLibraryPresence` (all concurrent). Round 2 = `resolveConversationActionState` (needs recentMessages from Round 1).

**Library presence skipped when no search terms.** If `extractDocumentSearchTerms(currentMessage)` returns `[]`, the DB lookup is never made.

**`extractDocumentSearchTerms` moved from `chiefOfStaffLLMService.ts` to `conversationContextBuilder.ts`** to break circular imports. It is re-exported from CoS for backward compat.

**`buildLayeredUserMessage` and `buildLegacyUserMessage`** now accept `ConversationContext` directly (not `text, ctx, pkg, presenceSection, ...`). Internal formatters (`buildLibraryPresenceSection`, `buildWorkforceSection`, `buildActionStateSection`) are called inside the builders.

**`libraryPresenceLoadFailed: boolean`** on `ContextRuntimeMetadata` — distinguishes "no search terms (skip)" from "terms found but service threw (show failure section)".

**`deriveMessageContext(context)`** — helper to produce a `MessageContext` from `ConversationContext` for backward-compat with `classifyMessage` (deterministic classifier) and `parseAndValidateLLMResponse`.

## Test pattern for tests that call `classifyMessageLLM`

Tests that call `classifyMessageLLM` MUST now mock `conversationService.buildMessageContext`:
```
vi.mock("../services/conversationService.js", () => ({ buildMessageContext: mocks.buildMessageContext }))
```
And reset it in `beforeEach`:
```
mocks.buildMessageContext.mockResolvedValue({ conversationId, organizationId, recentMessages: [], proposalExists: false })
```
Without this, `buildMessageContext` consumes the DB mock sequence before `resolveConversationActionState` gets its expected calls.

For tests that need specific `recentMessages` in action state (e.g. proposal detection), use `mockResolvedValueOnce` with the messages BEFORE the `classifyMessageLLM` call.

## Phase 2 placeholders

`participantContext` and `blueprintContext` are `null` in v1.0.0. Extension guide is in `docs/architecture/ConversationContextBuilder.md`.

## Test count

3,462 tests passing (34 new in sprint285).
