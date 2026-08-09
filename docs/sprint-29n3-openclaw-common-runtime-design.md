# Sprint 29N.3 — OpenClaw as Common Cloud + Hybrid Capability Runtime — Architecture Proof Gate

**Date:** 8 August 2026  
**Type:** Investigation and Design Only — NO IMPLEMENTATION  
**Evidence standard:** L1 (code/source inspection) throughout. L3/L4 noted where unproven.

---

## Final Verdict

**HYBRID MODEL — OPENAI REASONS, OPENCLAW PROVIDES REACH/ACTION**

OpenAI remains the default Cloud professional reasoning engine for all intellectual execution (policy review, gap analysis, drafting, recommendations). OpenClaw should be introduced as a governed capability runtime — Cloud-hosted and/or customer-side — providing reach and action execution (file operations, email, browser, connectors, document manipulation) under a single NeedsOps control-plane governance contract. This is Q4. It is not Q3 (OpenClaw specialist reasoning) and should not be rushed to Q2 (OpenClaw as capability runtime) until the result protocol and skill contract are proven at L3.

The path to this architecture is incremental: the existing Path 2 (`/v1/execution`) is the correct structural foundation for the OpenClaw dispatch adapter; it needs a result protocol extension and integration with the UEE completion path. The UEE entitlement gate is wrong and should be redesigned. Task #149 (semantic retrieval activation) remains required and is independent of OpenClaw.

---

## Part A — Reconfirmed Current-State Facts (from Sprint 29N.2)

| # | Question | Answer | Proof |
|---|---|---|---|
| A1 | Can NeedsOps Cloud review an uploaded policy without OpenClaw? | **YES** | Full UEE path: KRS → AI Gateway (OpenAI) → selfReviewService → completedWorkService. No OpenClaw call at any step. `unifiedExecutionEngine.ts:358`, `workExecutionPipelineService.ts:42`. |
| A2 | Does the primary UEE Cloud route invoke OpenClaw? | **NO** | UEE imports: AI Gateway, KRS/ResourceRegistry, blueprint/manifest services, claim/evidence services. No `OpenClawExecutionEngine`, `LiveGatewayAdapter`, `deviceRelayService` import. Call graph confirmed clean. |
| A3 | Does /v1/execution invoke OpenClaw? | **YES** | `execution.ts:POST /` → `executionService.submitTaskExecution()` → `new OpenClawExecutionEngine()` → `RuntimeBrokerClient.POST ${OPENCLAW_RUNTIME_URL}/v1/executions`. Direct production path. |
| A4 | Does the UEE path depend on `execution.openclaw_runtime` entitlement despite not invoking OpenClaw? | **YES** | `executionPolicy.ts:154-180` calls `tenantCanUseFeature(organizationId, 'execution.openclaw_runtime')` and blocks UEE task execution when absent. UEE has zero runtime OpenClaw dependency. |
| A5 | Would normal Cloud policy analysis continue if OpenClaw runtime disappeared? | **YES (UEE path) / NO (Path 2)** | UEE path is independent. Path 2 would fail at `RuntimeBrokerClient` submission. Entitlement gate would not be affected by runtime disappearance (entitlement is a DB check, not a connectivity check). |

---

## Part B — What "OpenClaw in Cloud" Would Mean — Option Comparison

### Option A — OpenClaw as Resource/Tool Runtime Only

NeedsOps and OpenAI perform all professional reasoning. OpenClaw is invoked only when a capability action is needed: locate a resource, read a file in a cloud provider, convert a document, invoke a connector, interact with a browser or calendar.

```
NeedsOps classifies + governs + assembles context
OpenAI reasons + drafts
OpenClaw executes tool operations when needed
NeedsOps validates result + creates Completed Work
```

| Dimension | Assessment |
|---|---|
| Latency | Low overhead for knowledge-only work (OpenClaw not invoked). Added hop only when tool needed. |
| Security | OpenClaw receives a bounded tool request with pre-authorised scope; governance stays in NeedsOps |
| Auditability | NeedsOps audits the tool request and result; action audit is complete if result protocol is typed |
| Evidence integrity | KRS still filters evidence; OpenClaw can only provide additional resources through governed intake |
| Deterministic control | High — NeedsOps decides when and what tool to invoke |
| Tool flexibility | High — any skill/plugin can be swapped behind the capability contract |
| Maintenance burden | Medium — NeedsOps orchestration remains; OpenClaw skill set is additive |
| Specialist consistency | High — reasoning still in OpenAI with governed DNA context |
| Cloud/Hybrid reuse | High — same capability contract, different runtime location |

### Option B — OpenClaw as Specialist Execution Runtime

NeedsOps provides the full governed package (DNA, evidence, blueprint). OpenClaw runs the full specialist reasoning and tool loop and returns the result.

```
NeedsOps classifies + governs + assembles GovernedExecutionContext
OpenClaw: specialist reasoning + tool execution
NeedsOps validates + Completed Work + provenance
```

| Dimension | Assessment |
|---|---|
| Latency | Higher — specialist reasoning in OpenClaw adds a full reasoning loop before NeedsOps sees any output |
| Security | Risk — NeedsOps cannot observe intermediate reasoning steps; claim integrity and evidence provenance require NeedsOps intercepts |
| Auditability | Partial — NeedsOps can audit input and final output but not the reasoning chain |
| Evidence integrity | AT RISK — OpenClaw may use evidence without NeedsOps authority filtering if pre-packaged evidence is circumvented |
| Deterministic control | Lower — NeedsOps cannot govern what OpenClaw does mid-reasoning |
| Tool flexibility | Highest — OpenClaw controls its own tool loop |
| Maintenance burden | Lower long-term if OpenClaw is mature; high if specialist behaviour diverges from NeedsOps expectations |
| Specialist consistency | Lower — no `cosResponseValidatorService` equivalent in OpenClaw |
| Cloud/Hybrid reuse | High — same model for both locations |

**Problem with Option B:** The claim integrity pipeline, absence verification, and evidence provenance chain all require NeedsOps to process the LLM output. If OpenClaw performs the full reasoning loop and returns only a final result, these pipelines cannot run without post-hoc re-analysis — defeating their purpose. Option B would require redesigning the claim/evidence architecture, which is a major regression.

### Option C — Hybrid Model (OpenAI Reasons; OpenClaw Provides Reach/Action)

Professional reasoning (the actual intellectual work) stays with OpenAI under NeedsOps orchestration. OpenClaw is invoked inline — by the specialist/UEE — when a specific tool capability is needed that NeedsOps cannot fulfill natively.

```
NeedsOps classifies + governs + assembles context
UEE: readiness checks, evidence assembly, prompt construction
  → OpenAI: draft/reasoning (synchronous)
  → [if tool needed]: capability request → OpenClaw tool execution → result back to UEE
UEE: output validation, claim extraction
OpenAI: claim validation, absence verification (current model)
NeedsOps: self-review, Completed Work, provenance, approval, audit
```

This is functionally Option A with the clarification that the tool request can originate from the UEE orchestrator during a task, not only as a post-execution action proposal.

**Recommendation: Q4 / Option C.** All the reasoning quality, claim integrity, evidence provenance, and governance guarantees are preserved. OpenClaw adds capabilities without becoming the arbiter of organisational truth.

---

## Part C — Architecture Options Comparison

### Q1 — Current Architecture
NeedsOps/OpenAI Cloud + separate Hybrid OpenClaw via /v1/execution path.
- No unified capability contract
- Path 2 and UEE are disconnected
- Entitlement coupling is wrong
- Cloud knowledge work functions; action execution does not

### Q2 — OpenClaw as Common Capability Runtime
NeedsOps/OpenAI reasoning + OpenClaw capabilities in Cloud/Hybrid.
- Correct target for tool operations
- Requires: result protocol, skill contract, UEE integration
- Blocked on L3 proof

### Q3 — OpenClaw as Common Specialist Runtime
NeedsOps governance/context + OpenClaw performs all specialist reasoning and tools.
- Undermines claim integrity pipeline
- Loses evidence provenance on intermediate reasoning steps
- Inconsistent specialist behaviour (no equivalent to DNA response validation)
- **Rejected**

### Q4 — Hybrid Approach (Recommended)
OpenAI as default professional reasoning engine; OpenClaw for reach/tools; NeedsOps governs all.
- Preserves all current Cloud guarantees
- Adds capability reach incrementally
- Allows Cloud/Hybrid unification under same contract
- Requires: result protocol definition, Path 2 result → Completed Work wiring, entitlement redesign, skill contract

---

## Part D — KRS / OpenClaw Knowledge Boundary

### Model 3 (OpenClaw direct retrieval) — Rejected

OpenClaw searching and reading files during specialist execution cannot preserve:
- Tenant isolation (OpenClaw has no awareness of NeedsOps org boundary)
- Approved/current source rules (no KRS filter applied)
- Authority scoring (no authority metadata in raw files)
- Version integrity (no version tracking outside NeedsOps DB)
- Evidence snapshots (NeedsOps cannot snapshot what it didn't select)
- Claim provenance (claims would cite unvalidated sources)
- Absence verification (cannot verify absence against unauthorised sources)

If OpenClaw reads a file and that file is used in output, the claim integrity pipeline is broken at the source.

### Model 1 (KRS-first) — Required for authoritative evidence

KRS remains the only path for organisational evidence cited in professional claims:
1. NeedsOps KRS filters: tenant, approved, current, authority level, sensitivity
2. KRS retrieves and ranks chunks
3. EvidencePack delivered to UEE
4. UEE injects into prompt
5. OpenAI reasons over pre-authorised passages only

This model is unchanged from current Cloud. No OpenClaw involvement for authoritative evidence.

### Model 2 (OpenClaw discovery → KRS governance) — Permitted for resource intake

For resources NOT yet in the Organisation Library (e.g. files on cloud storage, SharePoint, Google Drive), OpenClaw can act as a resource discovery layer:
1. OpenClaw discovers candidate resources (file paths, metadata, content preview)
2. Candidates returned to NeedsOps as `candidateResources` in the result
3. NeedsOps evaluates: apply authority model, propose ingestion into Library
4. Human reviews and approves ingestion
5. After ingestion, KRS governs the resource as normal

**This is resource intake, not evidence retrieval.** OpenClaw-discovered resources cannot be cited in claims until they have passed through the Library ingestion pipeline and KRS authority model.

### Clean Boundary Statement

> **NeedsOps/KRS decides what evidence is authorised. OpenAI reasons over authorised evidence. OpenClaw discovers and reads resources that are not yet in the Library, but those resources cannot be cited in professional claims until ingested and approved.**

---

## Part E — Where OpenClaw Improves Cloud vs Where It Duplicates KRS

| Area | Current Cloud | OpenClaw Cloud addition | Verdict |
|---|---|---|---|
| Uploaded document text extraction | `ingestionPipelineService` (real) | OpenClaw document parsing | DUPLICATE — keep current |
| Chunk storage + retrieval | KRS + PostgreSQL (real) | OpenClaw file reading | DUPLICATE — keep KRS |
| Authority/currentness filtering | KRS SQL filters (real) | OpenClaw cannot replicate | KEEP IN NEEDSOPS |
| Evidence provenance | NeedsOps snapshots + claims (real) | OpenClaw has no model | KEEP IN NEEDSOPS |
| Cloud storage file discovery | Not implemented | OpenClaw cloud plugin | **GENUINE ADDITION** |
| Real-time cloud connector reads | FutureProviders (stub) | OpenClaw cloud connector plugin | **GENUINE ADDITION** |
| Document format conversion (complex) | Basic extraction only | OpenClaw richer parsing | **MARGINAL ADDITION** |
| File write / create | Proposal only | OpenClaw skill | **GENUINE ADDITION** |
| Email draft / send | Proposal only | OpenClaw plugin | **GENUINE ADDITION** |
| Browser interaction | Proposal only | OpenClaw skill | **GENUINE ADDITION** |
| Calendar operations | Proposal only | OpenClaw plugin | **GENUINE ADDITION** |
| Vector/semantic retrieval | Inactive (Task #149) | No — must stay in KRS | **FIX KRS, NOT OPENCLAW** |

OpenClaw's genuine Cloud value: **action execution and resource reach** (cloud storage, connectors, email, browser, file write). Not document ingestion, not retrieval, not reasoning.

---

## Part F — Common Cloud/Hybrid Architecture Design

### Single NeedsOps Control Plane

```
                    ┌─────────────────────────────────────┐
                    │        NEEDSOPS CONTROL PLANE        │
                    │                                      │
                    │  CoS → Classifier → RBAC/Entitlement│
                    │  → Specialist selection → DNA        │
                    │  → Memory → KRS/Evidence authority   │
                    │  → GovernedExecutionContext assembly  │
                    │  → Governance / Approval             │
                    │  → Completed Work / Provenance       │
                    │  → Audit                             │
                    └──────────────┬──────────────────────┘
                                   │ GovernedExecutionContext
                    ┌──────────────▼──────────────────────┐
                    │     EXECUTION LOCATION ROUTER        │
                    │  (executionLocation: cloud/hybrid)   │
                    └──────┬────────────────────┬──────────┘
                           │ Cloud              │ Hybrid
            ┌──────────────▼──────┐    ┌────────▼──────────────┐
            │  CLOUD CAPABILITY   │    │  HYBRID CAPABILITY    │
            │      RUNTIME        │    │       RUNTIME         │
            │                     │    │                       │
            │ Hosted OpenClaw     │    │ Customer OpenClaw     │
            │ (NeedsOps managed)  │    │ via Desktop Connector │
            │                     │    │ + secure relay        │
            │ Same skill contract │    │ Same skill contract   │
            └──────────┬──────────┘    └──────────┬────────────┘
                       │ TypedExecutionResult      │ TypedExecutionResult
                    ┌──▼────────────────────────────▼──────────┐
                    │      NEEDSOPS RESULT PROCESSOR           │
                    │  Validate → Claim extraction → Evidence  │
                    │  → Self-review → Completed Work          │
                    │  → Provenance → Approval → Audit         │
                    └──────────────────────────────────────────┘
```

**Fields that differ by execution location:**

| Field | Cloud | Hybrid |
|---|---|---|
| `executionLocation` | `cloud` | `hybrid` |
| `connectorSessionId` | None (hosted) | Active relay session ID |
| `resourceAccessPath` | Cloud storage URLs | Local paths + allowed categories |
| `allowedLocalPathCategories` | Empty (hosted has no local paths) | Per Worker Profile |
| `networkConstraints` | NeedsOps-managed egress | Customer network + relay |
| `credentialSource` | NeedsOps secrets vault | Customer connector (safeStorage) |

**Fields identical in both:**
- `organizationId`, tenancy, RBAC, specialistCode, DNA manifest, blueprint, EvidencePack, approvalState, constraints, callbackUrl, prohibited actions, required approvals, result contract.

**The same specialist DNA runs in both locations.** The DNA is runtime-agnostic: identity, mission, principles, style. The Worker Profile maps abstract channel/tool requests to location-specific implementations. This mapping layer (DNA tool request → Cloud plugin or Hybrid plugin) is what needs to be designed.

---

## Part G — Execution-Location Routing Design

`executionLocation` is orthogonal to `executionClass`. They are separate dimensions.

```typescript
type ExecutionClass = 'transient' | 'professional_work' | 'evidence_bearing_work';
type ExecutionLocation = 'cloud' | 'hybrid' | 'either';
```

### Routing Rules

| Scenario | executionClass | executionLocation | Reason |
|---|---|---|---|
| Policy already in Library → review/gap analysis | `evidence_bearing_work` | `cloud` | KRS evidence in cloud DB; no local resources needed |
| Policy exists only on local company drive | `evidence_bearing_work` | `hybrid` | Resource unreachable from Cloud; connector required |
| Generate a Word report (output to cloud storage) | `professional_work` | `cloud` | If cloud OpenClaw can write to cloud storage |
| Modify a local Word file on desktop | `professional_work` | `hybrid` | Local filesystem access required |
| Send email via cloud connector (e.g. hosted Gmail) | `professional_work` | `cloud` | If cloud plugin available |
| Send email via local Outlook | `professional_work` | `hybrid` | Local application access required |
| Analyse policy + update CRM record (cloud CRM) | `evidence_bearing_work` | `cloud` | CRM accessible via cloud connector |
| Analyse policy + update local CRM (on-prem) | `evidence_bearing_work` | `hybrid` | On-prem system requires connector |
| Conversational advisory | `transient` | `cloud` | Always Cloud; no tool execution |

### Selection Logic (proposed)

```
1. Start with executionClass (existing classifier)
2. Determine required capabilities from blueprint + task context
3. For each required capability, check:
   a. Is a cloud plugin available and authorised? → cloud candidate
   b. Is a hybrid connector active for this org? → hybrid candidate  
   c. Neither → capability unavailable; fail at readiness check
4. If all required capabilities are cloud-available: executionLocation = cloud
5. If any required capability requires hybrid: executionLocation = hybrid
6. If connector not active and hybrid needed: return CONNECTOR_REQUIRED error before execution
```

This selection happens in `checkExecutionReadiness` (already exists in UEE) — no new routing service needed.

---

## Part H — Specialist DNA + OpenClaw: What Needs Adding

### What DNA Currently Contains (compiled manifest)

From `specialistRuntimeManifestService.ts`:
- Identity (name, role, version)
- Mission statement
- Key objectives (array)
- Responsibilities (array)
- Core principles (array)
- Communication style
- Competencies (array)
- Escalation protocol (when/what/who)
- Prohibited behaviours (array of phrases)
- Memory policy
- Organisation context (specialist-specific org knowledge)
- `manifestHash` (SHA-256)

**Not in compiled manifest (in Worker Profile only):**
- Allowed execution channels
- Allowed browser domains
- Allowed local path categories
- Prohibited actions
- Risk level
- Requires-approval-for list

**Not anywhere yet:**
- Allowed OpenClaw skill/plugin IDs
- Forbidden skill/plugin IDs
- Resource scope (library-read / filesystem-denied / cloud-storage-read etc.)
- Structured escalation triggers (condition → action → approval required)
- Execution boundary (read-only vs read-write vs read-write-send)
- Runtime compatibility (cloud / hybrid / both)

### Additions Required in DNA/Worker Profile

DNA should express **professional intent and boundaries** — what kind of work and access this specialist's role justifies. Worker Profile should express **technical enforcement** — what the runtime may literally do.

```typescript
// To add to DNA profile definition (not manifest — separate signed constraints object):
interface SpecialistExecutionConstraints {
  allowedSkills: SkillConstraint[];       // [{pluginId, version, allowedOperations}]
  forbiddenSkills: string[];              // plugin IDs
  executionBoundary: {
    read: boolean;
    write: boolean;
    delete: boolean;
    sendExternalCommunication: boolean;
    submitExternalForm: boolean;
    requiresApprovalBeforeSend: boolean;
  };
  resourceScopes: ResourceScope[];       // [{type: 'library'|'filesystem'|'cloud_storage', read, write, allowedCollections}]
  escalationTriggers: EscalationTrigger[]; // [{condition, severity, requiredApprovalRole, stopOnTrigger}]
  runtimeCompatibility: ('cloud' | 'hybrid')[];
}
```

**Important constraint:** These are professional/role-level declarations. They are intersected with Worker Profile at runtime — the more restrictive of DNA-declared and Worker Profile wins. DNA cannot grant more than Worker Profile allows.

### Specialist-by-Specialist Assessment

| Specialist | Current DNA sufficient for Cloud OpenClaw? | What's missing |
|---|---|---|
| Chief of Staff | Yes for current role (orchestration/advisory only) | Would need allowedSkills=[] explicitly to prevent skill use |
| Operations Manager | Partially — DNA requests browser/connector/doc capabilities | Worker Profile doesn't allow these; gap is the mapping layer |
| Executive Assistant | Similar to OM | Same gap |
| Future: Policy Specialist | DNA structure adequate | Would need `allowedSkills: [document.read, resource.locate]`, `executionBoundary: {write: false}` |
| Future: Safeguarding Specialist | DNA structure adequate | Would need strict resource scopes — library only, no filesystem |
| Future: Knowledge/Document Specialist | DNA structure adequate | `allowedSkills: [document.create, document.edit]`, `executionBoundary: {write: true, requiresApprovalBeforeSend: true}` |

---

## Part I — Skill/Plugin Capability Contract

NeedsOps should request a **named capability**, not a specific runtime implementation. The capability contract is stable; the implementation behind it changes by location.

```
Capability                  Cloud Runtime               Hybrid Runtime
─────────────────────────── ─────────────────────────── ───────────────────────────────
resource.locate             Cloud storage index plugin   Filesystem + network discovery
resource.read               Cloud storage read plugin    Local file reader / desktop app reader
document.create             Cloud Office/Docs plugin     Local Word/Excel via connector
document.edit               Cloud Office/Docs plugin     Local Word/Excel via connector
document.convert            Hosted document converter    Local converter / LibreOffice
spreadsheet.read            Cloud Sheets/Excel plugin    Local Excel via connector
spreadsheet.write           Cloud Sheets/Excel plugin    Local Excel via connector
email.draft                 Cloud Gmail/Outlook plugin   Local Outlook via connector
email.send                  Cloud Gmail/Outlook plugin   Local Outlook via connector (approval required)
calendar.read               Cloud calendar plugin        Local calendar via connector
calendar.create_event       Cloud calendar plugin        Local calendar via connector
browser.navigate            Hosted browser (Playwright)  Local browser via connector
browser.extract             Hosted browser (Playwright)  Local browser via connector
filesystem.write            Cloud storage write plugin   Local filesystem via connector
connector.invoke            Cloud connector registry     Hybrid connector registry
```

**Evidence standard:** All of the above are UNPROVEN at L3 for both Cloud and Hybrid. The types exist in NeedsOps; no confirmed OpenClaw skill registry has been found in this repository.

The NeedsOps side of this contract — the capability name, the typed request, the typed result — should be defined in NeedsOps and remain stable. OpenClaw implements skills against it. NeedsOps does not import OpenClaw skill implementations.

---

## Part J — Result Contract Back Into NeedsOps

### Current OpenClaw Result Protocol (L1 — from Path 2 code)

**Synchronous submission response:**
```typescript
{ runtimeExecutionId: string; status: 'accepted' | 'queued' | 'rejected'; reason?: string; estimatedStartAt?: string; runtimeVersion: string; }
```

**Status poll response:**
```typescript
{ executionId: string; runtimeExecutionId: string; tenantId: string; status: string; startedAt?: string; completedAt?: string; errorMessage?: string; runtimeVersion: string; }
```

**Async webhook events** (`runtimeEvents.ts`): `connected`, `disconnected`, `unavailable`, `accepted`, `started`, `progress`, `paused`, `resumed`, `awaiting_approval`, `completed`, `failed`, `cancelled`, `expired`.

**What is currently MISSING from the result:**
- Resources read (list with source IDs or paths)
- Resources written (list with artifact references)
- Output artifacts (content, type, storage reference)
- Evidence discovered (candidate resources for KRS intake)
- External side effects performed (typed action log)
- Warnings with retryability flags
- Errors by action (not just terminal status)
- Claim-supporting text that NeedsOps can run through the claim integrity pipeline
- Completed Work content (Path 2 currently only updates task status — no Completed Work is created from Path 2 results)

### Required Extension for Target Architecture

```typescript
interface TypedExecutionResult {
  executionId: string;
  runtimeExecutionId: string;
  specialistCode: string;
  status: 'completed' | 'failed' | 'partial' | 'cancelled';
  startedAt: string;
  completedAt: string;
  // New fields required:
  outputContent: {                       // What NeedsOps uses for Completed Work
    type: 'markdown' | 'json' | 'plain';
    content: string;
    contentHash: string;
  };
  resourcesRead: ResourceAccess[];       // [{id, sourceType, path, accessedAt}]
  resourcesWritten: ResourceMutation[];  // [{id, type, path, operation, completedAt}]
  outputArtifacts: Artifact[];           // [{type, path, mimeType, storageRef}]
  evidenceDiscovered: CandidateResource[]; // For KRS intake flow
  externalSideEffects: ActionRecord[];   // [{type, target, completedAt, confirmed}]
  skillsInvoked: string[];               // Capability names used
  warnings: Warning[];                   // [{code, message, retryable}]
  errors: ExecutionError[];              // [{actionId, code, message, fatal}]
}
```

NeedsOps remains exclusively responsible for: accepting/rejecting this result, running claim extraction and validation, creating Completed Work, running self-review, managing provenance, managing approval state, and writing to the audit log.

---

## Part K — External Side-Effect Governance

### Principle: NeedsOps is the approval authority. OpenClaw is the executor. Neither can override the other's domain.

```
Specialist proposes action (parsed from reasoning output or blueprint step)
→ NeedsOps classifies action risk
→ If approval required (per Worker Profile + action type):
    → Create approval record
    → Block execution until approved
    → On approval: emit dispatch instruction to OpenClaw
→ OpenClaw executes
→ OpenClaw returns confirmation with action record
→ NeedsOps writes audit event: action confirmed
→ Provenance includes action record
```

### Pre-Action Approval Contract

| Action Type | Default | Who can lower threshold |
|---|---|---|
| `filesystem.write` (to Completed Work / Library output) | Auto-approved (managed scope) | — |
| `filesystem.write` (to user's local drive) | Requires approval | Owner can lower to manager |
| `email.draft` | Auto-approved | — |
| `email.send` | Always requires approval | Cannot be lowered |
| `spreadsheet.write` (managed) | Auto-approved | — |
| `spreadsheet.write` (live production data) | Requires approval | Owner only |
| `browser.navigate` + `browser.extract` (read-only) | Auto-approved | — |
| `browser.navigate` + form submission | Always requires approval | Cannot be lowered |
| `calendar.create_event` | Requires approval | Manager can lower |
| `external_api.read` | Auto-approved if in connector allowlist | — |
| `external_api.write` / `external_api.mutate` | Always requires approval | Cannot be lowered |
| Financial/HR/high-risk (`connector.payroll`, etc.) | Hard blocked — prohibited in Worker Profile | Cannot be unlocked at task level |

OpenClaw **must not execute** a non-auto-approved action without receiving an explicit dispatch instruction containing a valid `approvalId`. The approval check is NeedsOps-side, not OpenClaw-side.

---

## Part L — Path 2 (`/v1/execution`) Future Role

### Current State (L1)
- Mounted at `/v1/organisations/:slug/tasks/:taskId/execution`
- 6 routes: POST (submit), GET (status), POST cancel/pause/resume, GET events
- **No web or mobile frontend calls these routes** — confirmed by codebase search
- **Desktop Connector does not call these routes** — confirmed
- No active customer-facing workflow identified
- Sends a well-formed `OpenClawExecutionPackage` including: Worker Profile constraints, steps, requestedTools/channels/connectors, approvalState, constraints
- Receives: sync acceptance, async status events via HMAC-verified webhook
- **Does NOT create Completed Work from results** — runtime events only update task/session status

### Assessment

Path 2 is the **correct structural foundation for the unified OpenClaw dispatch adapter**. It already has:
- The right shape of execution package (Worker Profile constraints, approval state, callback URL)
- Async callback handling with HMAC verification
- Status polling
- Pause/cancel/resume controls
- Tenant verification in callbacks

What it lacks:
- Result-to-Completed-Work pipeline (currently only updates task status)
- The typed result contract (TypedExecutionResult above)
- UEE integration — UEE does not call it
- Execution-location routing (cloud vs hybrid)

### Recommendation

Path 2 should become the **common OpenClaw dispatch adapter** used by UEE when `executionLocation` requires OpenClaw. The migration path:

1. **Define TypedExecutionResult** — extend OpenClaw webhook payload and status response
2. **Wire result → Completed Work** — when `runtimeEvents.ts` receives `completed`, invoke the Completed Work creation pipeline (claim extraction, self-review, createDraft, submitForApproval) using the `outputContent` from the typed result
3. **Wire UEE → execution dispatch** — UEE calls `executionService.submitTaskExecution()` instead of AI Gateway when `executionLocation = hybrid` or when a specific tool capability is needed
4. **Add execution-location selection** to `checkExecutionReadiness` in UEE

This is not a big-bang replacement. The UEE continues to handle Cloud knowledge work via AI Gateway. Path 2 becomes the tool/action dispatch path when reach is needed.

---

## Part M — OpenClaw Entitlement Coupling — Redesign

### Current (Wrong) Model
```
execution.openclaw_runtime → gates ALL Cloud task execution including UEE path
```

This means Cloud-only customers who never use OpenClaw cannot run professional knowledge work unless they have an OpenClaw entitlement. This is incorrect.

### Recommended Entitlement Model

```
execution.professional_work        — Cloud task execution via UEE path
                                     (OpenAI reasoning, KRS evidence, Completed Work)
                                     Gate: all paying orgs with the relevant plan

execution.openclaw_cloud           — Hosted OpenClaw capability runtime
                                     (tool execution, cloud resource access, hosted connectors)
                                     Gate: premium capability add-on or specific plan tier

execution.openclaw_hybrid          — Customer-side OpenClaw via Desktop Connector
                                     (local file access, local applications, on-prem connectors)
                                     Gate: enterprise plan or connector subscription

execution.connector.[category]     — Specific connector types (e.g. execution.connector.email)
                                     Granular gating of specific tool capabilities
```

**Migration path (do not implement yet):**
1. Add `execution.professional_work` entitlement check that gates UEE task execution
2. Grant it to all orgs that currently have `execution.openclaw_runtime`
3. Change `executionPolicy.ts` to check `execution.professional_work` for UEE path
4. Check `execution.openclaw_cloud` or `execution.openclaw_hybrid` only when OpenClaw dispatch is being invoked

Until this migration is done: the current entitlement check remains in place (as instructed — do not remove it yet).

---

## Part N — Task #149 — Semantic Retrieval Gap

**Task #149 remains required regardless of OpenClaw architecture.**

The principle is clear: **OpenClaw must not become a workaround for weak KRS retrieval.**

KRS is the authoritative evidence store for all professional claims. If KRS retrieves poorly (lexical-only, missing semantically related documents), OpenClaw reading files directly does not solve the problem — it bypasses the authority model and undermines claim integrity.

The correct fix is activating vector retrieval in KRS (`queryEmbedding: null` → real embedding). This makes the evidence that NeedsOps authorises more complete and relevant. OpenClaw cannot substitute for this.

Under the target architecture, a `resource.locate` call to OpenClaw can discover documents that are NOT in the Library and propose them for ingestion. But once discovered and approved, they enter KRS through the standard ingestion pipeline — and then KRS must retrieve them well. Task #149 is still required.

---

## Part O — Performance Implications

### Current Cloud (knowledge work, no tools)
| Stage | Latency contribution |
|---|---|
| KRS retrieval | ~100-500ms (SQL) |
| Prompt assembly | ~10ms |
| AI Gateway (draft) | **3-8s** (dominant) |
| Self-review | **2-5s** |
| Claim pipeline (async) | 3-8s (background) |
| DB writes | ~200ms |
| **Total (synchronous)** | **~6-14s** |

### Cloud with OpenClaw tool operations (add to above when tools needed)
| Added stage | Latency contribution |
|---|---|
| Capability dispatch to OpenClaw | ~50-100ms (HTTP) |
| OpenClaw tool execution | **1-30s** (tool-dependent) |
| Result callback + processing | ~100-200ms |
| **Additional per tool operation** | **1-30s** |

**For knowledge-only work (policy review, analysis, drafting):** No latency increase — OpenClaw is not invoked.

**For tool operations (file write, email, browser):** OpenClaw adds 1-30s per tool operation. This is acceptable because: (a) these operations are currently impossible without the connector, so any latency is better than none; (b) many tool operations are approval-gated so latency is expected.

**For Hybrid:** Add relay round-trip (~100-500ms depending on connection quality) on top of tool execution time.

**Conclusion:** OpenClaw does not add latency to Cloud knowledge work. It adds latency only where it adds capability that currently doesn't exist. The cost is justified.

---

## Part P — Failure Modes

| Failure | Layer that should fail closed | Mechanism |
|---|---|---|
| OpenClaw runtime unavailable | NeedsOps — `checkExecutionReadiness` | Connector/tool capability required? → fail before dispatch. Cloud knowledge path? → continue without tool |
| Skill missing or unregistered | NeedsOps — capability registry check | Return `SKILL_NOT_AVAILABLE` before execution |
| Skill version drift | NeedsOps — version constraint in allowedSkills | Reject if version out of range; do not execute with unknown version |
| Plugin compromised | NeedsOps — result validation | Validate result hash + structure; reject anomalous results; alert; audit |
| Agent ignores resource restrictions | NeedsOps — result audit + future: OpenClaw runtime enforcement | resourcesRead in result must be subset of allowedScopes; reject and audit violation |
| Tool succeeds but result callback fails | NeedsOps — idempotency key on result | HMAC-verified callback; idempotency prevents double-processing; timeout → retry or manual recovery |
| Duplicate action execution | NeedsOps — action idempotency key (already: execId:actionId) | Duplicate dispatch is rejected at NeedsOps before sending to OpenClaw |
| Cloud/Hybrid capability mismatch | NeedsOps — execution-location routing | If cloud plugin absent, fail at routing before execution |
| Local runtime offline (Hybrid) | NeedsOps — connector health check in readiness | Heartbeat stale → fail at readiness, not mid-execution |
| Stale DNA | NeedsOps — manifest hash comparison | manifestHash in result must match issued hash; reject if mismatch |
| Evidence discovered by OpenClaw but not governed by KRS | NeedsOps — intake gate | evidenceDiscovered is candidate list only; cannot be cited until Library-approved |
| Action performed before approval | NeedsOps — dispatch gate | No action dispatched without `approvalId`; OpenClaw must receive and validate it |

---

## Part Q — What Must Never Move Out of NeedsOps

| Responsibility | Stays in NeedsOps? | Reason |
|---|---|---|
| Tenancy / RLS | ✅ Always | Multi-tenant isolation is existential |
| RBAC | ✅ Always | Role enforcement is a governance commitment |
| Entitlements | ✅ Always | Revenue integrity |
| Execution lane | ✅ Always | Classification determines what work is authorised |
| Execution-location decision | ✅ Always | NeedsOps decides cloud vs hybrid; OpenClaw does not |
| Source authority / currentness | ✅ Always | Core product guarantee; no external runtime can be trusted |
| KRS governance filters | ✅ Always | Tenant-scoped, authority-scored retrieval |
| Memory authority | ✅ Always | Memory adoption governance is sensitive |
| Approval workflow | ✅ Always | Customer-facing trust mechanism |
| Evidence snapshots | ✅ Always | Provenance chain integrity |
| Claim provenance | ✅ Always | Trust in AI output |
| Completed Work | ✅ Always | Permanent versioned record |
| Version pinning | ✅ Always | Integrity of approved output |
| Audit log | ✅ Always | Non-repudiable; must not pass through external runtime |
| Usage / commercial accounting | ✅ Always | Billing integrity |

None of these are candidates for OpenClaw. This list is the irreducible NeedsOps control plane.

---

## Part R — Explicit Answers to Questions 1–20

**1. Would OpenClaw make NeedsOps Cloud materially more capable?**  
Yes — but only for tool/action execution. Not for knowledge reasoning.

**2. In what exact areas?**  
File write/create/move, email draft/send (with approval), spreadsheet write, browser interaction, calendar operations, cloud storage access, cloud connector integration. All currently proposals with no dispatch path in Cloud.

**3. Would it make Cloud policy analysis itself better?**  
No. Policy analysis quality is determined by: (a) evidence retrieval quality (KRS/vector — Task #149), (b) OpenAI model capability, (c) specialist DNA quality. OpenClaw does not improve any of these.

**4. Or primarily improve resource reach/tool execution?**  
Yes — exclusively resource reach and tool execution.

**5. Should OpenClaw replace KRS?**  
No. KRS is the authority/evidence governance layer. OpenClaw is a tool executor. They are categorically different.

**6. Should OpenClaw feed resources into KRS?**  
Yes — as a discovery mechanism. OpenClaw discovers candidates; NeedsOps decides whether to ingest them through the Library approval model. Discovered resources cannot be cited until ingested.

**7. Should OpenAI remain the default Cloud professional reasoning engine?**  
Yes. OpenAI performs gap analysis, policy review, drafting, recommendations. This is where reasoning quality and claim integrity requirements are best met.

**8. Should OpenClaw ever be allowed to perform specialist reasoning?**  
Not as the default. If OpenClaw acquires specialist reasoning capability (L4 evidence), it could be evaluated for specific specialists — but only with equivalent claim integrity, evidence provenance, and self-review mechanisms. These do not currently exist in OpenClaw's protocol.

**9. Should Cloud and Hybrid use the same OpenClaw capability contract?**  
Yes — same named capabilities, same typed result contract, different runtime implementations. NeedsOps requests `email.send`; Cloud OpenClaw uses a hosted Gmail plugin; Hybrid OpenClaw uses the local Outlook connector.

**10. Can the same DNA run against both Cloud and Hybrid runtimes?**  
Conceptually yes — DNA is runtime-agnostic. Practically, the Worker Profile needs a deployment adapter mapping abstract tool requests to location-specific plugins. The DNA itself does not change.

**11. Should /v1/execution become the common OpenClaw adapter?**  
Yes. It is structurally correct — package format, approval state, async callbacks, HMAC verification. It needs: TypedExecutionResult extension, Completed Work pipeline wiring, UEE integration, and execution-location routing.

**12. Is the current UEE/OpenClaw entitlement coupling wrong?**  
Yes. The UEE path has zero runtime OpenClaw dependency but is blocked by the `execution.openclaw_runtime` entitlement. Cloud-only knowledge work should not require an OpenClaw entitlement.

**13. What should replace it?**  
`execution.professional_work` gates UEE path. `execution.openclaw_cloud` gates hosted OpenClaw dispatch. `execution.openclaw_hybrid` gates connector path. Do not change the entitlement code yet — design the model first.

**14. Does Task #149 remain required?**  
Yes — unconditionally. Semantic retrieval activation in KRS is independent of OpenClaw and prerequisite to high-quality evidence-bearing work. OpenClaw cannot substitute for it.

**15. What happens if OpenClaw Cloud is unavailable?**  
For knowledge-only work: nothing changes — UEE continues via AI Gateway. For tool operations: execution fails at readiness check or dispatch. NeedsOps should surface a clear error with fallback message. Action proposals remain in DB for future dispatch.

**16. Can Cloud automatically fall back to NeedsOps/OpenAI-only reasoning?**  
Yes — and it already does. Cloud knowledge work today is entirely NeedsOps/OpenAI. OpenClaw unavailability means tool capabilities are unavailable, not that reasoning fails.

**17. What actions must always require explicit approval?**  
`email.send`, `external_api.mutate`, browser form submission, `filesystem.write` to live data, any financial/HR/payroll connector operation, any action classified as irreversible.

**18. What responsibilities permanently remain NeedsOps-native?**  
The full list in Part Q: tenancy, RBAC, entitlements, execution lane, execution-location decision, source authority, KRS governance, memory authority, approval workflow, evidence snapshots, claim provenance, Completed Work, version pinning, audit, usage accounting.

**19. Does this architecture simplify the platform overall?**  
Yes — long-term. It stops NeedsOps from growing sideways into tool implementations that belong in OpenClaw. Each new specialist becomes DNA + Worker Profile + allowed skills rather than a new NeedsOps service. The maintenance surface concentrates on governance, which is the actual product.

**20. What is the safest target?**  
Q4: OpenAI as default professional reasoning engine; OpenClaw as governed capability runtime for reach/tools; NeedsOps as the single control plane governing both. Reached incrementally, gated on L3 proof of the typed result protocol. Path 2 extended to become the common adapter. Entitlements redesigned to separate knowledge work from tool capabilities.

---

## Proposed Migration Stages (when OpenClaw proves L3)

**Stage 0 — Precondition (before anything)**
Define TypedExecutionResult protocol. Agree it with OpenClaw team. Implement HMAC-verified webhook that carries the full typed result. Validate one real round-trip (L3 evidence). Do not proceed until this exists.

**Stage 1 — Wire Path 2 → Completed Work**
When `runtimeEvents.ts` receives `completed` with a TypedExecutionResult, invoke the Completed Work creation pipeline. Self-review and claim extraction run on the `outputContent`. This makes Path 2 a full execution path, not just a status tracker.

**Stage 2 — Entitlement redesign**
Introduce `execution.professional_work`. Grant it to all current `execution.openclaw_runtime` holders. Change UEE gate. Introduce `execution.openclaw_cloud` for the hosted tool path.

**Stage 3 — UEE → tool dispatch integration**
Add execution-location selection to `checkExecutionReadiness`. When location requires OpenClaw, UEE invokes the execution dispatch service (Path 2 extended) instead of or alongside the AI Gateway. Fallback: if OpenClaw unavailable, continue with knowledge-only path and surface tool-unavailable warning.

**Stage 4 — DNA skill constraints**
Add `allowedSkills`, `executionBoundary`, `resourceScopes`, `escalationTriggers` to DNA profiles. Compile into a signed constraints object alongside the manifest. Extend Worker Profile to reference OpenClaw skill IDs.

**Stage 5 — Cloud OpenClaw skill onboarding**
Introduce first Cloud OpenClaw skills: `document.create` (Word/DOCX), `filesystem.write` (to managed output). These replace the current export stubs for file-format generation.

Each stage preserves current production behaviour. Rollback: any stage can be disabled by entitlement or feature flag without affecting knowledge-work path.

---

*Report produced: 8 August 2026. Investigation and design only. No implementation.*
