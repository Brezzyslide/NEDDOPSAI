---
name: NeedsOps Sprint 9.1 OpenAI Integration
description: OpenAI provider wiring, gateway routing, fallback behaviour, and test changes from Sprint 9.1
---

## What Sprint 9.1 established

OpenAI is the primary conversation intelligence provider when AI_PROVIDER=openai + OPENAI_API_KEY are set. Deterministic classifier is the fallback. All calls flow through createAIGateway().

## Key rules

### OpenAI SDK isolation
The `openai` npm package is imported ONLY in `lib/ai-gateway/src/providers/openai.ts`. No other file may import it directly.

**Why:** AI Privacy Gateway is the single enforced chokepoint for all external AI calls (audit, auth, field validation all happen there).

**How to apply:** If you need OpenAI calls, add them inside the provider file. Never import `openai` from a route, service, or component.

### Gateway routing changed in Sprint 9.1
`getConfiguredProvider()` reads `process.env.AI_PROVIDER` at runtime. When it is `openai` and the call fails, the gateway falls back to internal deterministic (returns `_source: internal_deterministic` JSON) instead of throwing `PROVIDER_NOT_CONNECTED`.

**Why:** Sprint 7 threw to enforce "not yet connected." Sprint 9.1 connects OpenAI with graceful fallback.

**How to apply:** If tests expect external providers to throw, update them — they now fall back instead. Sprint 7 tests were updated for this.

### `conversation_intelligence` purpose added
New AIPurpose added to types.ts. Allowed fields: `["conversation.id", "task.id", "task.title", "task.state", "task.priority"]`. Added to `ROLE_PURPOSE_ALLOWLIST` for owner/administrator/manager/member.

**Why:** Chief of Staff LLM calls need a separate purpose so field access is correctly scoped.

### Usage tracker is in-memory only
`lib/ai-gateway/src/usageTracker.ts` resets on server restart. For durable token accounting, read `org_audit_log` where `ai_gateway.response_delivered` events include `inputTokens`, `outputTokens`, `latencyMs` in metadata.

### processUserMessage is now async calling classifyMessageLLM
`conversationService.processUserMessage` calls `classifyMessageLLM()` (async, LLM) instead of `classifyMessage()` (sync, deterministic). The LLM service skips to deterministic when AI_PROVIDER != openai.

### Sprint 7 gateway tests updated
Two tests that expected `rejects.toThrow(AIGatewayError)` for external providers were updated to expect success with fallback content instead.
