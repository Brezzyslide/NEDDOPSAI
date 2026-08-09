---
name: NeedsOps Sprint 29N.8 Baseline Cleanup
description: Test baseline cleanup, dead code deletion, integration test isolation, architecture map, OpenClaw proof prerequisites
---

# Sprint 29N.8 — Key Decisions and Lessons

## Test Baseline
- **After cleanup: 4,959 tests passing, 0 failures** (was 56 pre-existing failures)
- Integration tests moved to `src/__tests__/integration/` — excluded from default vitest run via `exclude` in vitest.config.ts
- Integration tests can be run manually: `pnpm vitest run src/__tests__/integration`

## Dead Code Deleted
- `src/services/endToEndWorkflowService.ts` — deleted. Had no production callers; explicitly @deprecated.
- `src/services/executionCheckpointStore.ts` — deleted. Superseded by DB-backed `executionCheckpointService.ts`.

**Why:** Both services had self-annotations marking them dead. Production import guards or grep confirmed zero live callers.

**How to apply:** When a service is deleted, grep for ALL files that reference it — including test files that do `fs.readFileSync` on the source path (sprint29c, sprint29f1 patterns). Architecture purity tests verify file existence — update them to assert the file is GONE, not that it has the right content.

## ConversationContext Shape (production contract)
- `organisation: { id, profile: Record<string, unknown> }` — NOT `organisation.name` or `organisation.settings`
- Component key for CoS memory: `"memory"` (not `"cosPackage"`)
- Failed library presence component key: `"library_presence"` (underscore, not camelCase)
- No `runtime.componentsLoaded` field — use `Object.keys(runtime.componentTimings)` instead
- No `runtime.fallbacksUsed` field — check `runtime.failedComponents` instead
- No `runtime.componentErrors` field — only `failedComponents` + `componentTimings`
- `libraryPresenceLoadFailed` is always boolean (normalized from `false || undefined` → always `false` when no failure)
- `conversation.proposalExists` (not `pendingProposal`)
- `conversation.conversationId` (not `conversation.id`)

## BAS Capability Classifier Fix
- "Prepare and lodge our BAS for this quarter" was falling through to LLM because no execution phrase matched
- Fixed: added `"lodge our bas"`, `"submit our bas"`, `"prepare our bas"` to `accounting.bas_preparation.executionPhrases` and `"our bas"`, `"quarterly bas"` to keywords
- **Why:** `msgLower.includes(phrase)` requires exact substring match — "lodge bas" doesn't match "lodge our bas"

## REQUIRED_RLS_TABLES
Still 75 — no new DB tables in Sprint 29N.8.

## Total test count: 4,959

## Architecture State After Cleanup

### Deleted (not KEEP FOR OPENCLAW):
- endToEndWorkflowService
- executionCheckpointStore

### KEEP FOR OPENCLAW (tomorrow's proof):
- `lib/openclaw/` (RuntimeBrokerClient + relayClient)
- `artifacts/desktop-connector/` (entire broker)
- `routes/v1/execution.ts`, `specialistRuns.ts`, `runtimeEvents.ts`
- `lib/evidenceDiscovery/` (IEvidenceDiscoveryAdapter, NullDiscoveryAdapter, discoveryOrchestrator)
- `services/evidenceAcceptanceService.ts` (Authority Gate)
- `services/evidenceEscalationService.ts`
- `lib/authorityRegistry/`
- `types/candidateEvidence.ts`

## Tomorrow's OpenClaw Proof Prerequisites (in order)
1. Set `OPENCLAW_RUNTIME_URL` secret to MacBook broker URL
2. Add `POST /v1/evidence/discover` to Desktop Connector broker server
3. Add `discoverEvidence()` to `RuntimeBrokerClient` in `lib/openclaw/src/runtimeBrokerClient.ts`
4. Implement `CloudOpenClawEvidenceDiscoveryAdapter` (implements `IEvidenceDiscoveryAdapter`)
5. Register adapter in `src/lib/evidenceDiscovery/discoveryOrchestrator.ts` when env var is set

**Key constraint:** Relay WebSocket cannot be used for evidence queries (dispatch-only). RuntimeBrokerClient HTTP is the right transport.
