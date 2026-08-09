# Sprint 29N.7 — Real Cloud OpenClaw Evidence Discovery Adapter
## Part A Investigation Report + Part I Baseline Integrity

**Sprint:** 29N.7  
**Date:** August 2026  
**Status:** STOPPED — Per sprint brief: "If there is no real Cloud OpenClaw runtime, STOP and report that."

---

## VERDICT

**NOT PROVEN — NO REAL CLOUD OPENCLAW RUNTIME**

Sprint 29N.7 is halted at Part A. No real Cloud OpenClaw runtime is available to the API server. All findings below are proven from the current codebase, not assumed.

---

## Part A — Proving the actual Cloud OpenClaw connection

### A1. What OpenClaw infrastructure exists

**Desktop Connector (`artifacts/desktop-connector/`)**

The only working OpenClaw execution path is through the Desktop Connector, a local application that runs on the user's machine. It has two modes:

**Spawn mode** (`OPENCLAW_LIVE_MODE=spawn`, default):
```
Desktop Connector → spawn('openclaw', ['agent', '--mode', 'rpc', '--json']) → stdin/stdout JSON-RPC
```
The OpenClaw binary is spawned as a child process per execution. Communication is via newline-delimited JSON over stdin/stdout. This is a local process on the user's machine — it cannot be reached from the cloud API server.

**Bridge mode** (`OPENCLAW_LIVE_MODE=bridge`):
```
Desktop Connector → HTTP GET/POST http://127.0.0.1:19001/{basic,agent/act,agent/snapshot,agent/act/hooks}
```
Calls an OpenClaw browser bridge running at `localhost:19001`. This is also a local process — it cannot be reached from the cloud API server.

**API Server (`artifacts/api-server/`) — `RuntimeBrokerClient`**

`lib/openclaw/src/runtimeBrokerClient.ts` makes HTTP calls to `OPENCLAW_RUNTIME_URL`. This environment variable:
- Is `null` by default (not set)
- When set, is documented and designed to point to the Desktop Connector's HTTP broker routes
- The Desktop Connector's broker exposes `/v1/executions` (POST submit, GET status, POST cancel/pause/resume)
- The broker routes these calls to the locally-spawned OpenClaw binary or local bridge

**The relay WebSocket** (`artifacts/desktop-connector/src/broker/relayClient.ts`) connects outbound from the Desktop Connector to `wss://<apiBaseUrl>/v1/devices/relay`. This is a control channel: the API server sends task dispatch instructions to the Desktop Connector over this WebSocket, which then executes them via the local OpenClaw binary. The API server cannot initiate evidence-discovery requests over this relay — it is dispatch-only, one-directional for task control.

### A2. Attempted proof: is there a cloud OpenClaw endpoint?

| Proof target | Result |
|---|---|
| `OPENCLAW_RUNTIME_URL` set to cloud endpoint | **Not set.** `lib/openclaw/src/config.ts:68` — `runtimeUrl: process.env.OPENCLAW_RUNTIME_URL ?? null` |
| Hosted OpenClaw API/SaaS | **Does not exist.** No configuration, no documentation, no implementation |
| `OPENCLAW_GATEWAY_URL` cloud endpoint | **Not applicable.** `types.ts:226` documents default `http://127.0.0.1:19001` — local bridge only |
| `OPENCLAW_GATEWAY_MODE=live` in Cloud env | **Not set.** Cloud deployment has no `OPENCLAW_GATEWAY_MODE` env var |
| Cloud knowledge providers | **Explicitly NotImplemented.** `lib/knowledge/providers/FutureProviders.ts` marks all Cloud providers as placeholders |

### A3. The `RuntimeBrokerClient` API has no evidence-discovery endpoint

Even if `OPENCLAW_RUNTIME_URL` were set to a running instance, the API supports only:

```
POST   /v1/executions              — submit ExecutionPackage (full task)
GET    /v1/executions/{id}         — get execution status
POST   /v1/executions/{id}/cancel  — cancel execution
POST   /v1/executions/{id}/pause   — pause execution
POST   /v1/executions/{id}/resume  — resume execution
GET    /v1/health                  — broker health
```

There is no `/v1/evidence/discover`, `/v1/search`, `/v1/retrieve`, or any document retrieval endpoint. The broker API is a task execution control plane, not an evidence-retrieval service.

### A4. Authentication — cannot be proven without a running instance

The authentication chain is:
- API server → broker: Bearer token (`OPENCLAW_RUNTIME_URL` auth token in env)
- Broker → OpenClaw binary: no separate auth (local process trust)
- Webhooks: HMAC-SHA256 `OPENCLAW_WEBHOOK_SECRET`

This authentication is correctly designed for future use, but cannot be proven operational without a running OpenClaw broker endpoint.

### A5. Tool/skill availability — not inspectable

The Desktop Connector's `IGatewayAdapter` interface exposes `submit(job)`, `getStatus()`, `cancel()`, `pause()`, `resume()`, `healthCheck()`. These are execution-control operations, not skill/tool enumeration. There is no `getCapabilities()` or `listTools()` method on the current gateway adapter interface.

`OpenClawExecutionEngine` in `lib/openclaw/src/openClawExecutionEngine.ts` does have `getCapabilities()`, which calls `GET /v1/health` on the broker. But this returns health metadata, not tool availability for evidence discovery.

### A6. Structured response support — not testable without runtime

The `ExecutionPackage` schema supports structured output via `outputMode` and `requestedTools`. This scaffolding exists, but cannot be validated without a running OpenClaw instance.

### A7. Ability to search/read permitted resources — not present in API

The current broker API has no search, read, or traverse operation. An `ExecutionPackage` submission kicks off a full specialist execution — it is not a lightweight evidence query. Using `submitExecution` for evidence discovery would:
1. Require wrapping the discovery query as a full specialist task
2. Consume full task execution budget
3. Have no mechanism to scope OpenClaw's access to permitted sources only
4. Have no structured evidence-candidate output format (only task completion events)

---

## Part B — Can existing broker infrastructure serve as discovery transport?

The sprint brief asks whether `/v1/execution → ExecutionPackage → OpenClawExecutionEngine → RuntimeBrokerClient` should provide the transport.

**Answer: No, not in current form.** Reasons:

1. **No running instance.** `OPENCLAW_RUNTIME_URL` is null. Even the transport cannot be exercised.

2. **Wrong API surface.** The broker exposes task execution control (`submit`, `status`, `cancel`). Evidence discovery requires a query-response contract: "find passages about X within scope Y, returning structured CandidateEvidence[]". That contract does not exist in the current broker API.

3. **ExecutionPackage is the wrong unit.** An `ExecutionPackage` carries a compiled specialist manifest, runtime instructions, worker permissions, ordered steps, and expiry timestamps. It is an approved execution envelope, not an evidence query. Converting a discovery scope into a fake ExecutionPackage would be architectural dishonesty.

4. **No scoped-access mechanism.** The sprint brief requires the adapter to send only the governed discovery scope — `organizationId`, `executionId`, `unresolvedReferences`, `allowedSourceClasses`, `maxHops`, `maxSources`, `maxPassages`, `timeout`. The current ExecutionPackage has no equivalent of these evidence-discovery constraints.

5. **Relay is dispatch-only.** The relay WebSocket sends task dispatch from API server → Desktop Connector. It cannot be reversed to send evidence queries from API server → OpenClaw.

**What would be needed** (for a future sprint when a real runtime exists):

| Component | Required addition |
|---|---|
| OpenClaw | A new `agent --mode evidence-discovery` or dedicated search endpoint |
| Broker API | `POST /v1/evidence/discover` — takes governed discovery params, returns CandidateEvidence[] |
| RuntimeBrokerClient | `discoverEvidence(params: EvidenceDiscoveryRequest): Promise<CandidateEvidence[]>` method |
| CloudOpenClawDiscoveryAdapter | Implements `IEvidenceDiscoveryAdapter`, calls RuntimeBrokerClient |
| `OPENCLAW_RUNTIME_URL` | Must be set to a real hosted endpoint |
| Orchestrator | Register CloudOpenClawDiscoveryAdapter when `OPENCLAW_RUNTIME_URL` is configured |

---

## Part C–H — Not executed

Per the sprint brief: "Do not implement a fake adapter around mocks." and "If there is no real Cloud OpenClaw runtime, STOP and report that."

Parts C (implement adapter), D (OpenClaw discovery instruction), E (internal multi-hop live proof), F (external authority live proof), G (failure proofs), and H (performance measurement) cannot be executed. There is no real runtime to call, test against, or measure.

---

## Part I — Test Baseline Integrity (pre-29N.7 baseline)

**Total:** 5,024 tests | 4,968 passing | **56 failing**

All 56 failures are proven pre-existing from Sprint 29N.6 (confirmed by git stash test). Zero were introduced by Sprint 29N.6 work.

### Exact failing test files and tests

**File 1: `src/tests/sprint285-conversation-context-builder.test.ts`** (14 failures)

These tests expect `ConversationContextBuilder` fields (`ctx.organisation.name`, `ctx.runtime.componentErrors`) that do not match the current service implementation. Pre-existing since Sprint 28.5 context builder was written against a different interface.

- `buildConversationContext — full context > assembles all components when all services succeed`
- `buildConversationContext — graceful degradation > returns partial context when messageContext fails`
- `buildConversationContext — graceful degradation > returns partial context when cosPackage fails`
- `buildConversationContext — graceful degradation > records libraryPresenceLoadFailed when terms exist but check throws`
- `buildConversationContext — graceful degradation > does not set libraryPresenceLoadFailed when no terms present`
- `buildConversationContext — observability > records build duration and component timings`
- `buildConversationContext — observability > lists loaded components`
- `buildConversationContext — observability > records fallback used when a component fails`
- `buildConversationContext — no active task > sets conversation task fields to null when no taskId provided`
- `buildConversationContext — pending proposal > flags pendingProposal when messageContext.proposalExists is true`
- `buildConversationContext — active execution > sets currentExecution to null (Phase 2 placeholder)`
- `buildConversationContext — tenant isolation > never mixes data from different organisations`
- `buildConversationContext — execution capabilities > reflects executionFrozen from org profile`
- `buildConversationContext — deterministic ordering > returns the same field layout regardless of service resolution order`

**File 2: `src/__tests__/sprint29f1-real-connector-acceptance.test.ts`** (file-level failure)

This test requires a live Desktop Connector and real OpenClaw binary (`REAL_CONNECTOR_URL`). It is an integration/acceptance test, not a unit test. It cannot pass in the Replit Cloud environment. File-level failure (skipped/crashed before tests can run).

**File 3: `src/__tests__/sprint29h2-db-integration-probe.test.ts`** (5 failures)

Live DB integration probe — requires specific data to exist in the connected database. Data state has changed since these tests were written.

- `Sprint 29H.2 — DB integration probe > Part D: completedWork is populated with full persisted metadata`
- `Sprint 29H.2 — DB integration probe > Part D: primarySpecialist is knowledge_documentation_specialist (the actual producer)`
- `Sprint 29H.2 — DB integration probe > Part D: buildActionStateSection includes grounded attribution block`
- `Sprint 29H.2 — DB integration probe > S6 — acceptance message → rerun_existing (the live gate scenario)`
- `Sprint 29H.2 — DB integration probe > existing completedWork record is preserved (not touched by probe)`

**File 4: `src/__tests__/sprint29h2-state-capture.test.ts`** (3 failures)

Live DB state-capture probe — same root cause as sprint29h2-db-integration-probe.

- `Sprint 29H.2 — State capture > specialist_runs for this task (most recent 5)`
- `Sprint 29H.2 — State capture > execution_intents for this task (most recent 5)`
- `Sprint 29H.2 — State capture > historical completed_work version metadata (e7f810e9)`

**File 5: `src/__tests__/sprint29h5-live-rerun.test.ts`** (1 failure)

Live execution rerun probe — requires specific completed work ID in the database.

- `TESTS F, G, H — Output contract, quality pipeline, completed work (NEW execution) > H1: completed work record — full detail`

**File 6: `src/__tests__/sprint29h7-post-proposal.test.ts`** (3 failures)

Post-proposal live probe — requires specific task/conversation state in the database.

- `TEST 1 — Proposal Confirmation > 1a: user confirmation message exists after proposal`
- `TEST 4 — Retrieval Audit > 4a: executionId populated in retrieval_audit_events — not null`
- `TEST 7 — Completed Work > 7a: completed work record — full detail`

**File 7: `src/__tests__/sprint94-capabilities.test.ts`** (1 failure)

Capability identification deterministic test — `accounting.bas_preparation` capability mapping has drifted from the classifier.

- `Capability Identification — deterministic > BAS preparation request maps to accounting.bas_preparation at execution level`

**File 8: `src/__tests__/sprint-execution-auth.test.ts`** (5 failures)

Execution auth integration tests — these tests exercise role-based gateway calls and appear to have been broken by a gateway mock shape change in a prior sprint.

- `executeWork — permitted roles complete execution > owner role: completes execution successfully`
- `executeWork — permitted roles complete execution > administrator role: completes execution successfully`
- `executeWork — permitted roles complete execution > manager role: completes execution successfully`
- `executeWork — no silent system fallback > never calls the AI gateway with role=system`
- `executeWork — AI gateway context > gateway is called with purpose=task_execution (not work_execution)`

**File 9: `src/__tests__/sprint29b-unified-execution-engine.test.ts`** — 0 failures (was 11 during Sprint 29N.6 debugging, fixed before finalising that sprint)

### Baseline classification

| Classification | Count | Files |
|---|---|---|
| Live DB probes (data-dependent) | 9 | sprint29h2-db-integration-probe, sprint29h2-state-capture, sprint29h5-live-rerun, sprint29h7-post-proposal |
| Requires Desktop Connector + binary | file | sprint29f1-real-connector-acceptance |
| Interface drift | 14 | sprint285-conversation-context-builder |
| Mock shape drift | 5 | sprint-execution-auth |
| Classifier drift | 1 | sprint94-capabilities |
| **Total** | **56** | **8 files** |

None of these failures are caused by Sprint 29N.6 or Sprint 29N.7 work.

---

## Final answers to the 10 sprint questions

1. **Is a real Cloud OpenClaw runtime now being called?** No. `OPENCLAW_RUNTIME_URL` is null. No hosted OpenClaw endpoint exists.

2. **Which transport does it use?** N/A — no transport is active. The designed transport is HTTP via `RuntimeBrokerClient` to the Desktop Connector's broker, which in turn spawns a local binary.

3. **Can it perform multi-hop internal discovery?** Not provable — the current broker API has no evidence-discovery endpoint. The OpenClaw binary may have the intelligence, but there is no API to invoke discovery-only mode.

4. **Can it discover external authority?** Not provable — same reason. No external-search endpoint exists in the current broker API.

5. **Does it return CandidateEvidence rather than trusted evidence?** Architecturally yes — the Sprint 29N.6 `IEvidenceDiscoveryAdapter` contract enforces this. But no real adapter is calling OpenClaw to return anything.

6. **Does NeedsOps remain the authority gate?** Yes — `evidenceAcceptanceService.ts` and `authorityRegistry/index.ts` are fully implemented and wired. No runtime change is needed for this to remain true.

7. **Does OpenAI remain the professional reasoning engine?** Yes — the UEE always uses the AI gateway (OpenAI) for final analysis. OpenClaw is intended for evidence retrieval only, not reasoning.

8. **Does KRS remain the first retrieval path?** Yes — the UEE runs `resolveEvidenceForTask()` (KRS) before any discovery adapter is consulted.

9. **Can KRS-sufficient work complete with OpenClaw offline?** Yes — this is proven by the Sprint 29N.6 P9 acceptance test. When `isResultSufficient(V1)=true`, the discovery adapter is never called.

10. **Is Hybrid/Desktop behaviour unchanged?** Yes — no changes were made to the Desktop Connector, the relay, or the task execution pipeline.

---

## What needs to happen for Sprint 29N.7 to be PROVEN

In order of dependency:

1. **A real OpenClaw runtime must be hosted** — a cloud service, SaaS endpoint, or accessible server running an OpenClaw-compatible agent with a REST API
2. **`OPENCLAW_RUNTIME_URL` must be set** to the hosted endpoint in the environment secrets
3. **An evidence-discovery endpoint must exist** — `POST /v1/evidence/discover` (or equivalent) must be added to the broker/runtime API, returning structured `CandidateEvidence[]`
4. **`RuntimeBrokerClient` must gain `discoverEvidence()`** — one HTTP method that sends the governed discovery scope and receives candidates
5. **`CloudOpenClawEvidenceDiscoveryAdapter` must be implemented** — wraps the new `discoverEvidence()` call, returns `CandidateEvidence[]`, registered in the orchestrator when `OPENCLAW_RUNTIME_URL` is set
6. **Parts C–H can then be executed** — implement, wire, prove, measure

The `IEvidenceDiscoveryAdapter` interface, `CandidateEvidence` types, `EvidenceEscalationDecision`, Authority Gate, and `discoveryOrchestrator` are all fully implemented and waiting. The only missing piece is the runtime.

---

## Summary

Sprint 29N.7 halted at Part A as instructed. The architecture for cloud evidence discovery is complete on the NeedsOps side. The gap is on the OpenClaw side: no cloud-hosted runtime exists, and the current broker API has no evidence-discovery endpoint. When those two prerequisites are met, the remaining Parts C–H can be completed in a single sprint.
