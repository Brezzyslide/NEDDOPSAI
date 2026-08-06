# Conversation Context Builder

**Sprint 28.5 — Single Authoritative Context Assembly Layer**

---

## Overview

The `conversationContextBuilder` is the single authoritative source of truth for all AI employee context. Every AI employee — Chief of Staff, Operations Manager, Executive Assistant, and all future specialists — receives a `ConversationContext` assembled by the builder before any prompt is constructed.

No AI employee assembles its own context. The builder is strictly read-only.

---

## Architecture Diagram

```
User Message
     │
     ▼
classifyMessageLLM()
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     buildConversationContext()                       │
│                                                                     │
│  ┌──── Round 1: Parallel ────────────────────────────────────────┐  │
│  │                                                               │  │
│  │  buildMessageContext()   buildChiefOfStaffContext()           │  │
│  │  (task, plan, approval,  (org profile, org memory,           │  │
│  │   short-window messages)  summaries, large-window messages)   │  │
│  │                                                               │  │
│  │  getConversationWorkforceContext()                            │  │
│  │  (live specialist availability)                               │  │
│  │                                                               │  │
│  │  checkOrganisationLibraryPresence()   [if named docs found]  │  │
│  │  (document presence check)                                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──── Round 2: Sequential (depends on Round 1) ─────────────────┐  │
│  │                                                               │  │
│  │  resolveConversationActionState()                             │  │
│  │  (requires recentMessages from buildMessageContext)           │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  → Returns: ConversationContext (immutable snapshot)                │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
buildLayeredUserMessage(context)   [if memory available]
buildLegacyUserMessage(context)    [if memory unavailable — degraded]
     │
     ▼
LLM / Deterministic Classifier
```

---

## Component Responsibilities

| Component | Source Service | ConversationContext Field |
|---|---|---|
| Organisation profile & settings | `buildChiefOfStaffContext` | `organisation` |
| Approved organisation memory | `buildChiefOfStaffContext` | `memory.approvedOrganisationMemory` |
| Conversation summaries & decisions | `buildChiefOfStaffContext` | `memory.conversationSummary`, `memory.pinnedDecisions` |
| Large-window message history | `buildChiefOfStaffContext` | `memory.recentMessages`, `memory.relevantHistoricalMessages` |
| Current tasks & approvals | `buildChiefOfStaffContext` | `memory.currentTasks`, `memory.currentApprovals` |
| Short-window recent messages | `buildMessageContext` | `conversation.recentMessages` |
| Current task state & plan | `buildMessageContext` | `conversation.currentTask*`, `conversation.currentPlan` |
| Pending approval | `buildMessageContext` | `conversation.pendingApprovalId` |
| Live workforce availability | `getConversationWorkforceContext` | `workforce` |
| Document presence | `checkOrganisationLibraryPresence` | `libraryPresence` |
| Conversation action state | `resolveConversationActionState` | `actionState` |

---

## ConversationContext Schema

```typescript
ConversationContext {
  organisation: {
    id: string
    slug: string
    name: string
    profile: Record<string, unknown>  // raw org record — not exposed to LLM
    settings: {
      status: string
      executionFrozen: boolean
      loginsDisabled: boolean
      subscriptionTier: string | null
    }
  }

  memory: ConversationMemoryContext | null   // null when CoS package unavailable
  libraryPresence: LibraryPresenceResult | null
  workforce: ConversationWorkforceContext | null
  actionState: ConversationActionState | null
  executionCapabilities: { frozen: boolean; loginsDisabled: boolean }

  conversation: {
    id: string
    recentMessages: Array<{ senderType; content; messageType }>
    latestMessage: string
    pendingProposal: boolean
    currentTaskId: string | null
    currentTaskTitle: string | null
    currentTaskState: string | null
    pendingApprovalId: string | null
    currentPlan: TaskPlan | null
    currentExecution: null   // Phase 2
  }

  participantContext: null   // Phase 2
  blueprintContext: null     // Phase 2

  runtime: ContextRuntimeMetadata
  metadata: ConversationContextMetadata
}
```

---

## Sequence Diagram

```
classifyMessageLLM
    │
    │──buildConversationContext──────────────────────────────────────────┐
    │                                                                    │
    │  Promise.allSettled([                                              │
    │    buildMessageContext(orgId, convId, taskId),       ─┐           │
    │    buildChiefOfStaffContext({ orgId, convId, ... }), ─┤ Round 1   │
    │    getConversationWorkforceContext(orgId),           ─┤ Parallel  │
    │    checkOrganisationLibraryPresence(orgId, terms),  ─┘           │
    │  ])                                                                │
    │                                                                    │
    │  resolveConversationActionState({ recentMessages }) ── Round 2    │
    │                                                                    │
    │  return ConversationContext ───────────────────────────────────────┘
    │
    │──buildLayeredUserMessage(context) or buildLegacyUserMessage(context)
    │
    └──LLM or deterministic classifier
```

---

## Context Lifecycle

1. **Request arrives** at `classifyMessageLLM`.
2. **Builder called** — `buildConversationContext` assembles all components.
3. **Round 1** — 4 independent lookups run in parallel via `Promise.allSettled`.
4. **Round 2** — Action state is resolved using `recentMessages` from Round 1.
5. **Context returned** — immutable `ConversationContext` object.
6. **Message built** — `buildLayeredUserMessage(context)` or `buildLegacyUserMessage(context)` formats the LLM prompt.
7. **LLM or classifier** — receives the formatted prompt with all context injected.

---

## Caching Strategy

| Component | Cache | TTL | Owner |
|---|---|---|---|
| `workforce` | In-memory, per org | 30 seconds | `conversationWorkforceContextService` |
| `libraryPresence` | In-memory, per org+terms | 30 seconds | `organisationLibraryPresenceService` |
| `memory` (org memory) | None — fresh per request | — | `contextSelectionService` |
| `messageContext` | None — always fresh | — | `conversationService` |
| `actionState` | None — always fresh | — | `conversationActionStateService` |

The builder does not own any cache. Caching is delegated to the services that know their own staleness tolerance. The builder runs both workforce and library presence checks on every request, but both services use their own internal caches to avoid duplicate DB work within a 30-second window.

---

## Failure Strategy

The builder uses `Promise.allSettled` for Round 1 and try/catch for Round 2. Every component failure:

1. Leaves its `ConversationContext` field as `null` (never throws).
2. Records the error in `runtime.failedComponents` and `runtime.componentErrors`.
3. Sets `runtime.isDegraded = true`.
4. Records a fallback descriptor in `runtime.fallbacksUsed`.

The Chief of Staff checks `context.memory` before choosing `buildLayeredUserMessage` vs `buildLegacyUserMessage`. When any required component is null, the CoS continues with reduced context.

```
Component fails → null field + isDegraded:true + error recorded
Chief of Staff → selects legacy builder when memory is null
LLM prompt → sent with best available context
```

---

## Performance

- **Round 1 parallelism**: Up to 4 concurrent lookups instead of 4 sequential.
- **No duplicate entitlement checks**: Workforce entitlements computed once in workforce service cache.
- **Library skipped when unneeded**: If `extractDocumentSearchTerms` returns `[]`, the library check is skipped entirely.
- **Target**: No measurable latency regression vs Sprint 28.4.

---

## Extension Guide for Future Specialists

Every new AI employee receives `ConversationContext` via `buildConversationContext`. The employee:

1. Calls `buildConversationContext({ organisationId, conversationId, userId, currentMessage, taskId? })`.
2. Reads the fields it needs.
3. **Never calls** any of the component services directly.

To add a new context component:

1. Add the field to `ConversationContext` (with `| null` if optional).
2. Add the service call to the Round 1 `Promise.allSettled` block in `buildConversationContext`.
3. Process the settled result with the standard `markLoaded`/`markFailed` helpers.
4. Populate the new field in the `return` object.
5. Add tests covering: success, failure (degraded mode), and null-when-unneeded cases.

**Do not** add context retrieval inside the specialist itself.

### Phase 2: Participant context and blueprint context

`participantContext` and `blueprintContext` are reserved fields (`null` in v1.0.0). When Phase 2 is ready:

- `participantContext` — per-participant profile (roles, permissions, preferences) resolved from the conversation membership.
- `blueprintContext` — the active Work Blueprint configuration when a specialist is executing under a blueprint.

Both will be added as Round 1 components following the same pattern.

---

## Files Changed

| File | Change |
|---|---|
| `src/services/conversationContextBuilder.ts` | **Created** — builder, types, `extractDocumentSearchTerms` |
| `src/services/chiefOfStaffLLMService.ts` | **Modified** — uses `buildConversationContext`; `buildLayeredUserMessage` and `buildLegacyUserMessage` accept `ConversationContext` |
| `src/tests/sprint285-conversation-context-builder.test.ts` | **Created** — comprehensive test suite |
| `docs/architecture/ConversationContextBuilder.md` | **Created** — this document |

---

## Components Intentionally Excluded from the Builder

| What | Why |
|---|---|
| Semantic chunk retrieval | Knowledge retrieval happens at execution time, not at context assembly time |
| Specialist dispatch | Work initiation is a service concern, not context assembly |
| Task creation | Mutations are outside the builder's read-only scope |
| State modification | The builder never writes — it only reads |
| LLM calls | The builder delivers data; AI employees decide what to do with it |
| Execution | The OpenClaw execution engine is invoked by orchestration services, not the context builder |
