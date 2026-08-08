# Sprint 29N.2 — Cloud OpenClaw Responsibility Proof Gate

**Date:** 8 August 2026  
**Type:** Investigation Only — NO CODE CHANGES  
**Scope:** NeedsOps Cloud model. Evidence: L1 (code/source inspection, grep call graph).

---

## Part A — Categorical Answers

| # | Question | Answer | Proof |
|---|---|---|---|
| A1 | Is OpenClaw invoked anywhere during a normal Cloud Chat request? | **NO** | UEE conversation path calls AI Gateway (OpenAI). No gateway adapter, relay, or OpenClaw import in the conversation branch. |
| A2 | Is OpenClaw invoked anywhere during a Cloud Task execution? | **PARTIAL — depends on which route** | Two separate Cloud task paths exist. See detail below. |
| A3 | Is OpenClaw involved when Cloud reads an uploaded Organisation Library document? | **NO** | Ingestion pipeline: text extractors + chunking + embedding. KRS retrieval: `hybridRetrievalService` (SQL). No OpenClaw involvement. |
| A4 | Is OpenClaw involved in KRS retrieval? | **NO** | `knowledgeResolutionService` → `hybridRetrievalService` → PostgreSQL. No gateway adapter or relay call in this chain. |
| A5 | Is OpenClaw involved in policy review / gap analysis / recommendations? | **NO** | UEE calls AI Gateway → OpenAI gpt-4o. OpenClaw is not called for the professional reasoning step in either Cloud path. |
| A6 | Is OpenClaw involved in self-review or claim/evidence validation? | **NO** | `selfReviewService`, `claimEmissionService`, `claimValidationService`, `absenceVerificationService` all call AI Gateway (OpenAI). No OpenClaw. |
| A7 | Is OpenClaw involved in Completed Work creation? | **NO** | `completedWorkService.createDraft()` is a DB write. No OpenClaw. |
| A8 | Is OpenClaw involved in PDF/DOCX export? | **NO** | `completedWorkExportService` uses `pdfkit` and `docx`. No OpenClaw. |
| A9 | Is OpenClaw involved in any Cloud action execution today? | **NO** | All 10 action types remain as proposals in `execution_actions`. Dispatch requires connector session + human approval. No automatic Cloud dispatch to OpenClaw. |
| A10 | If OpenClaw were unavailable, would Cloud still ingest, retrieve, analyse and produce Completed Work? | **YES for the UEE path — NO for the execution-service path** | UEE path: fully independent of OpenClaw runtime. Execution-service path: submits to OpenClawExecutionEngine and would fail. Additionally: the `execution.openclaw_runtime` entitlement gate would block task execution in both paths if the entitlement is absent. |

---

## Part A — Detail: The Two Cloud Task Paths

There are **two separate, coexisting Cloud task execution paths**. This is the most important finding.

### Path 1 — UEE Path (primary, blueprint-driven)

**Entry:** `POST /v1/work-blueprints/:id/executions` → `workBlueprints.ts:400` → `workExecutionPipelineService.executeWork()` → `UnifiedExecutionEngine.execute()`

**Also entry:** `executionCoordinatorService.dispatchWorkExecution()` → same chain

**OpenClaw involvement:** None. The UEE task path:
- Calls AI Gateway (OpenAI) for draft generation
- Calls `selfReviewService` (AI Gateway)
- Creates Completed Work via `completedWorkService`
- Does **not** import or call `LiveGatewayAdapter`, `OpenClawExecutionEngine`, `connectorBridgeService`, or `deviceRelayService`

**Status:** Active production path for blueprint-driven professional work.

### Path 2 — Execution Service Path (older, direct OpenClaw submission)

**Entry:** `POST /v1/execution` (and `/status`, `/cancel`, `/pause`, `/resume`, `/log`) → `routes/v1/execution.ts` → `executionService.ts` → `OpenClawExecutionEngine` → `RuntimeBrokerClient`

**OpenClaw involvement:** Direct and real.
- `executionService.ts` builds an `ExecutionPackage`
- Constructs `new OpenClawExecutionEngine()`  
- Calls `engine.submitTaskExecution()`, `engine.getTaskStatus()`, `engine.cancelTask()` etc.
- `OpenClawExecutionEngine` (`lib/openclaw/src/openClawExecutionEngine.ts`) translates the package via `executionPackageTranslator.ts` and submits to the broker via `RuntimeBrokerClient`
- `runtimeEvents.ts` receives webhook callbacks from OpenClaw runtime

**Status:** Live production routes. This path does directly call OpenClaw. Whether it is exercised in practice depends on whether tasks are submitted via `/v1/execution` vs the UEE path.

### The Entitlement Gate (affects both paths)

`executionPolicy.ts:142-180` calls `tenantCanUseFeature(organizationId, 'execution.openclaw_runtime')` and hard-blocks Cloud task execution when this entitlement is absent. This gate applies regardless of which path is taken. Cloud task execution requires this entitlement even when the UEE path never touches OpenClaw at runtime.

This is a **design-level coupling** between Cloud task execution and the OpenClaw feature flag, even though the UEE path has no runtime OpenClaw dependency.

---

## Part B — Full Cloud Policy Review Trace

Scenario: "Review our Complaints Management Policy and identify gaps, contradictions and recommendations."

| Stage | Responsible Service | OpenClaw Involved? | Notes |
|---|---|---|---|
| User message received | `ConversationService` | NO | DB write + SSE |
| Chat ingestion | `POST /v1/conversations/:id/messages` | NO | Standard REST route |
| Execution classification | `ExecutionClassifier` | NO | Rule-based + LLM classifier; AI Gateway call, no OpenClaw |
| CoS intent interpretation | UEE conversation path | NO | AI Gateway (OpenAI); no OpenClaw |
| Intent creation + approval | `executionCoordinatorService` | NO | DB write; RBAC check |
| Entitlement gate | `executionPolicy.ts` | **INDIRECT** | Checks `execution.openclaw_runtime` entitlement — fails closed if absent |
| Readiness checks | UEE `checkExecutionReadiness` | NO | DB reads; capability gate |
| Blueprint selection | `workBlueprintService` | NO | DB query |
| Specialist manifest | `specialistRuntimeManifestService` | NO | DB read + compile; generic format |
| Evidence retrieval | `ResourceRegistry` → KRS | NO | SQL (`hybridRetrievalService`); no OpenClaw |
| Evidence assembly | `buildEvidenceSection()` | NO | String assembly |
| **AI Draft call** | AI Gateway → OpenAI gpt-4o | **NO** | OpenAI performs the reasoning; OpenClaw not called |
| Output validation | UEE | NO | Schema check; in-process |
| Self-review | `selfReviewService` → AI Gateway | NO | OpenAI; no OpenClaw |
| Claim extraction | `claimEmissionService` → AI Gateway | NO | OpenAI; no OpenClaw |
| Claim validation | `claimValidationService` → AI Gateway | NO | OpenAI; no OpenClaw |
| Absence verification | `absenceVerificationService` → KRS + AI Gateway | NO | KRS SQL + OpenAI; no OpenClaw |
| Evidence snapshots | `evidenceSnapshotService` | NO | DB write |
| Completed Work draft | `completedWorkService.createDraft()` | NO | DB write |
| Submit for approval | `completedWorkService.submitForApproval()` | NO | DB write + notification |
| Human approval | Approval workflow | NO | DB write |
| PDF/DOCX export | `completedWorkExportService` | NO | `pdfkit` / `docx`; no OpenClaw |

**OpenClaw involvement in this exact scenario: zero at runtime.** The entitlement gate (`execution.openclaw_runtime`) is a prerequisite check that must pass, but OpenClaw itself performs no work in this path.

---

## Part C — OpenClaw References Classified

### CLOUD PRODUCTION PATH — executes in Cloud but via the older execution-service path only

| File | Reference | Classification |
|---|---|---|
| `artifacts/api-server/src/routes/v1/execution.ts` | All 6 route handlers | CLOUD PRODUCTION PATH (Path 2) |
| `artifacts/api-server/src/services/executionService.ts` | `submitTaskExecution()`, `getTaskStatus()`, `cancelTask()` etc. | CLOUD PRODUCTION PATH (Path 2) |
| `lib/openclaw/src/openClawExecutionEngine.ts` | Full engine implementation | CLOUD PRODUCTION PATH (Path 2 only) |
| `lib/openclaw/src/runtimeBrokerClient.ts` | HTTP broker client | CLOUD PRODUCTION PATH (Path 2 only) |
| `artifacts/api-server/src/routes/v1/runtimeEvents.ts` | Webhook callbacks from OpenClaw | CLOUD PRODUCTION PATH (callback handler) |
| `artifacts/api-server/src/index.ts:121` | `attachRelayService()` at startup | CLOUD PRODUCTION PATH (relay server started at boot) |
| `artifacts/api-server/src/services/deviceRelayService.ts` | WSS relay server | HYBRID/DESKTOP PATH (required by Path 2 connector actions) |

### HYBRID/DESKTOP PATH ONLY — not called by UEE or normal Cloud chat

| File | Reference | Classification |
|---|---|---|
| `artifacts/desktop-connector/src/broker/gatewayAdapter.ts` | `IGatewayAdapter`, `LiveGatewayAdapter`, `SimulatedGatewayAdapter` | HYBRID/DESKTOP PATH |
| `artifacts/api-server/src/services/connectorBridgeService.ts` | Connector operation routing | HYBRID/DESKTOP PATH |
| `artifacts/api-server/src/services/connectorSessionManagerService.ts` | Connector session lifecycle | HYBRID/DESKTOP PATH |
| `artifacts/api-server/src/services/connectorEvidenceResolverService.ts` | Evidence resolution via connector | HYBRID/DESKTOP PATH (only when connector present) |
| `artifacts/api-server/src/services/executionActionDispatcherService.ts` | Action dispatch to connector | HYBRID/DESKTOP PATH (dispatch requires connector session) |

### STUB/FUTURE — referenced but not on any active execution path

| File | Reference | Classification |
|---|---|---|
| `lib/openclaw/src/executionPackageTranslator.ts` | Generic → OpenClaw package translation | STUB/FUTURE (used by Path 2 executionService; not by UEE) |
| Worker Profile → OpenClaw allowed-tools chain | Designed in `workerProfileRegistry.ts` comments | STUB/FUTURE |

### TEST ONLY

| File | Reference | Classification |
|---|---|---|
| All `__tests__/sprint-srm*.test.ts` | ExecutionPackage contract tests | TEST ONLY |
| `SimulatedGatewayAdapter` use in tests | Deterministic test double | TEST ONLY |

### ENTITLEMENT COUPLING (not a runtime OpenClaw call but a design dependency)

| File | Reference | Classification |
|---|---|---|
| `executionPolicy.ts:154-180` | `tenantCanUseFeature('execution.openclaw_runtime')` | ENTITLEMENT COUPLING — blocks Cloud task execution if absent |
| `capabilityAccessDecisionService.ts:199-227` | Same entitlement check | ENTITLEMENT COUPLING |

---

## Part D — UEE Branches — Full Call Graph

**Does `unifiedExecutionEngine.ts` import OpenClaw, `LiveGatewayAdapter`, `SimulatedGatewayAdapter`, or `OpenClawExecutionEngine`?**  
**No.** The UEE import list contains: AI Gateway, blueprint service, completed work service, self-review service, KRS/ResourceRegistry, manifest service, context builder, claim services, evidence services, coordinator types, and shared utilities. No OpenClaw package, no gateway adapter.

**Does trigger="conversation" ever cross into OpenClaw?**  
No. Conversation path: context assembly → ResourceRegistry (KRS only) → AI Gateway (OpenAI) → output validation → action proposal extraction → audit. No branch leads to OpenClaw.

**Does trigger="task" ever cross into OpenClaw?**  
No. Task path: readiness checks → blueprint selection → manifest assembly → ResourceRegistry (KRS, optional connector evidence) → AI Gateway (OpenAI) → self-review → Completed Work → provenance. No branch leads to OpenClaw.

**Is there a conditional "connector available → OpenClaw, else → OpenAI" branch?**  
No such branch exists in UEE. The connector check in `checkExecutionReadiness` records connector availability in the ResourcePlan but does not route to OpenClaw. Evidence assembly simply includes or excludes connector evidence; the AI call proceeds either way.

**Does `organisationRuntimeService` call OpenClaw?**  
`organisationRuntimeService` handles ExecutionPackage assembly (building the generic structure). The OpenClaw-specific translation (`executionPackageTranslator.ts`) is separate and is only called by `executionService.ts` (Path 2). UEE does not call the translator.

**Does `ResourceRegistry` call OpenClaw?**  
No. ResourceRegistry imports KRS and `ConnectorEvidenceResolverService`. The connector evidence resolver opens a connector session via `connectorSessionManagerService` → `deviceRelayService` when a Desktop Connector is present. This is the Hybrid path for supplementary evidence only; it does not call OpenClaw, it communicates via the WSS relay to the Desktop Connector.

---

## Part E — Cloud vs Hybrid Responsibility Table

| Capability | Cloud Responsible Component | OpenClaw in Cloud? | Hybrid/Desktop Component |
|---|---|---|---|
| Upload / read policy | `ingestionPipelineService` (text extraction, chunking, embedding) | **NO** | N/A |
| Retrieve evidence | KRS → `hybridRetrievalService` (PostgreSQL) | **NO** | Connector evidence (supplementary, Hybrid only) |
| Analyse policy | UEE → AI Gateway → OpenAI gpt-4o | **NO** | N/A |
| Generate report | UEE → AI Gateway → OpenAI gpt-4o | **NO** | N/A |
| Self-review | `selfReviewService` → AI Gateway → OpenAI | **NO** | N/A |
| Claim validation | `claimValidationService` → AI Gateway → OpenAI | **NO** | N/A |
| Completed Work | `completedWorkService` (DB) | **NO** | N/A |
| PDF/DOCX | `completedWorkExportService` (pdfkit/docx) | **NO** | N/A |
| File write/move | **Not executed** (proposal only in `execution_actions`) | **NO** | Desktop Connector + OpenClaw (when proven) |
| Email send | **Not executed** (proposal only) | **NO** | Desktop Connector + OpenClaw (when proven) |
| Browser action | **Not executed** (proposal only) | **NO** | Desktop Connector + OpenClaw (when proven) |
| Calendar action | **Not executed** (proposal only) | **NO** | Desktop Connector + OpenClaw (when proven) |
| Direct task submission (Path 2) | `executionService.ts` → `OpenClawExecutionEngine` | **YES** | `RuntimeBrokerClient` → OpenClaw broker |

---

## Part F — Indirect Cloud Dependencies on OpenClaw

| Dependency | Type | Would Cloud break if OpenClaw disappeared? |
|---|---|---|
| `artifacts/api-server/package.json` → `@workspace/openclaw` | **Runtime package dependency** | `executionService.ts` and `routes/v1/execution.ts` (Path 2) would break at import. UEE path would not break. |
| `executionPolicy.ts` → `execution.openclaw_runtime` entitlement | **Entitlement coupling** | Cloud task execution (UEE path) would be blocked if the entitlement was removed. If entitlement remains but OpenClaw runtime is gone, UEE path still executes successfully; Path 2 would fail on broker submission. |
| `ExecutionPackage` generic type | **Shared type only** | No runtime dependency. UEE assembles an ExecutionPackage; only Path 2 translates it for OpenClaw. If OpenClaw disappeared, the type would remain; only the translator would be dead code. |
| Specialist manifest format | **Shared type only** | Manifest is a generic NeedsOps structure. OpenClaw-specific translation is in `executionPackageTranslator.ts` (Path 2 only). UEE never calls the translator. |
| `ResourceRegistry` → connector evidence | **Soft runtime dependency** | Connector evidence is optional. UEE catches the error and proceeds with KRS-only evidence. No hard break. |
| `deviceRelayService` attached at startup (`index.ts:121`) | **Runtime dependency** | Relay service starts with the API server. If OpenClaw/connector runtime disappeared, the relay server would start but receive no connections. No Cloud path would break. |
| AI Gateway | **No dependency** | AI Gateway has no OpenClaw imports. Fully independent. |

**Summary:** If the OpenClaw runtime disappeared while keeping the package and entitlement:
- **UEE path (conversation and task):** Continues to work. OpenAI calls succeed. Completed Work is created. PDF/DOCX export works. Evidence from KRS works. Connector evidence is absent (silent, not a failure).
- **Path 2 (`/v1/execution`):** Fails at broker submission. Routes return error.
- **Entitlement gate:** Remains a prerequisite. If the `execution.openclaw_runtime` entitlement is also removed, UEE task execution is denied before reaching any AI call.

---

## Part G — Final Verdict

**OPENCLAW PARTIALLY USED IN CLOUD**

**In plain English:**

Two coexisting Cloud task execution paths exist. The primary path — UEE, used for blueprint-driven professional work via chat and task approval — **does not call OpenClaw at runtime**. OpenAI performs the professional reasoning; NeedsOps governs evidence, Completed Work, self-review, claims and export without touching OpenClaw. This path is entirely NeedsOps + OpenAI.

A second, older path — `executionService.ts` + `routes/v1/execution.ts` — **does directly call OpenClaw** via `OpenClawExecutionEngine` and `RuntimeBrokerClient`. This path is live Cloud production code and its routes are accessible.

Additionally, Cloud task execution (UEE path) is entitlement-gated on `execution.openclaw_runtime` — not a runtime call to OpenClaw, but a design coupling that blocks task execution when the entitlement is absent.

---

### Explicit final answers

**1. Can Cloud fully review an uploaded policy without OpenClaw?**  
Yes — via the UEE path. Ingestion, KRS retrieval, OpenAI reasoning, self-review, Completed Work creation and PDF/DOCX export all complete without OpenClaw involvement, provided the `execution.openclaw_runtime` entitlement is present.

**2. Can Cloud generate Completed Work without OpenClaw?**  
Yes — via the UEE path. `completedWorkService` is a database operation with no OpenClaw dependency.

**3. Can Cloud perform external actions without OpenClaw?**  
No. External actions (file write, email, browser, calendar) are proposals only. Dispatch requires a connector session and OpenClaw (or equivalent) on the far side of the relay.

**4. Is OpenClaw currently only relevant to Hybrid/Desktop reach and execution?**  
Mostly, but not entirely. Path 2 (`/v1/execution`) is a Cloud route that calls OpenClaw directly. It is not Hybrid/Desktop-only — it runs in the Cloud API server process. Whether this path is actively used in production depends on operational routing.

**5. Is any Cloud path unnecessarily coupled to OpenClaw types or abstractions even though runtime execution does not use it?**  
Yes — two couplings:
- The `execution.openclaw_runtime` entitlement gate blocks UEE task execution even though the UEE path has no runtime OpenClaw dependency. This is a design coupling that should be reconsidered: the UEE path is a capable Cloud-only executor and should not require an OpenClaw entitlement to operate.
- `artifacts/api-server/package.json` depends on `@workspace/openclaw` at the package level, meaning the API server imports OpenClaw code even for Cloud-only deployments.

---

*Report produced: 8 August 2026. Investigation only. No implementation.*
