# Sprint 29N — NeedsOps vs OpenClaw Responsibility & Duplication Audit

**Date:** 8 August 2026  
**Type:** Investigation / Architecture Design Only — NO implementation  
**Evidence standard:**  
- L1 — code/source inspection  
- L2 — unit/mock integration  
- L3 — real runtime/service integration  
- L4 — live OpenClaw execution  

---

## Executive Summary

**Verdict: INSUFFICIENT EVIDENCE — OPENCLAW CAPABILITY NOT PROVEN**

The hypothesis "OpenClaw does; NeedsOps decides, governs, remembers and records" is conceptually sound and architecturally worth pursuing. However, it cannot be validated or acted on yet because OpenClaw's actual execution capability in this specific integration — skills, plugins, tool dispatch, result return — is unproven at L3 or L4. What exists today is a relay transport (WSS tunnel, auth handshake, package delivery) with no confirmed skill/plugin runtime on the receiving end.

The more important finding is that this is **not a duplication problem today**. NeedsOps does not actually execute any operational work. The UEE generates AI-authored draft documents and produces typed action proposals that are never dispatched. The Desktop Connector exists but no write operations flow through it. This is a capability gap, not a duplication problem.

The architecture review surfaces a cleaner framing of what needs to be built, and where the boundary should sit when it is built.

---

## Part A — Capability Inventory

### A1. Core Orchestration

| Capability | NeedsOps Implementation | File | OpenClaw Equivalent | Production Status | Duplication |
|---|---|---|---|---|---|
| Execution routing (task vs conversation) | `UnifiedExecutionEngine.execute()` | `unifiedExecutionEngine.ts:358` | None | Real (L1) | None |
| Intent approval + dispatch | `executionCoordinatorService` | `executionCoordinatorService.ts` | None | Real (L1) | None |
| Specialist selection | `checkExecutionReadiness`, `specialistIntelligenceService` | UEE internal | None | Real (L1) | None |
| Blueprint selection | Keyword/semantic matching in UEE | UEE:~800-1000 | None | Real (L1) | None |
| Work package/manifest assembly | UEE + organisationRuntimeService | Multiple | None | Real (L1) | None |
| Durable checkpoint persistence | `checkpointStore`, `beginResume` | Sprint272 | None | Real (L1) | None |
| Orphan recovery | `recoverOrphanedExecutions` | executionCoordinatorService | None | Real (L1) | None |

### A2. Knowledge and Evidence

| Capability | NeedsOps Implementation | File | OpenClaw Equivalent | Production Status | Duplication |
|---|---|---|---|---|---|
| Organisation library / KRS | `knowledgeResolutionService` | `lib/knowledge/` | None | Real (L1) | None |
| Evidence snapshots | `evidenceSnapshotService` | `lib/evidence/` | None | Real (L1) | None |
| Claim provenance | Claim emission + integrity pipeline | Sprint29K series | None | Real (L1) | None |
| Authority / currentness scoring | KRS scoring model, `scoreMultiSignal` | Sprint29g1 | None | Real (L1) | None |
| Library presence detection | `knowledgePresenceService` | Sprint281 | None | Real (L1) | None |
| Document ingestion pipeline | `ingestionPipelineService` | `lib/ingestion/` | None | Real (L1) | None |

### A3. Completed Work and Audit

| Capability | NeedsOps Implementation | File | OpenClaw Equivalent | Production Status | Duplication |
|---|---|---|---|---|---|
| Completed Work lifecycle | `completedWorkService`, 7 status states | Sprint22 | None | Real (L1) | None |
| Self-review (10 dimensions) | `selfReviewService` | Sprint22 | None | Real (L1) | None |
| Version pinning | `approved_version_id` FK, resolveApprovedVersion | Sprint29j1 | None | Real (L1) | None |
| Export (PDF/DOCX) | `exportService` — **STUB** | Sprint25h | None | Stub (L1) | Potential (future) |
| Quality score | `qualityReviewService` | Sprint29j | None | Real (L1) | None |

### A4. Specialist Configuration

| Capability | NeedsOps Implementation | File | OpenClaw Equivalent | Production Status | Duplication |
|---|---|---|---|---|---|
| DNA compilation | `specialistRuntimeManifestService` | Sprint12+ | UNPROVEN — package sent but runtime behaviour unconfirmed | Real send / Unproven receive (L1/L3 gap) | POTENTIAL |
| Worker Profile / allowed actions | `workerProfileRegistry` | Sprint-SRM | UNPROVEN — no confirmed OpenClaw enforcement | Design only (L1) | POTENTIAL |
| Specialist identity/instructions | Runtime manifest (identity, principles, prohibited phrases) | Sprint13b | UNPROVEN | Real send (L1) | POTENTIAL |

### A5. Execution Action Capabilities (ALL CURRENTLY STUBS/PROPOSALS)

| Action Type | NeedsOps Status | OpenClaw Equivalent | Notes |
|---|---|---|---|
| `write_file` | **Proposal only** — never dispatched | UNPROVEN | canonicalExecutionContext.ts:71 |
| `create_file` | **Proposal only** | UNPROVEN | Same file |
| `update_file` | **Proposal only** | UNPROVEN | Same file |
| `move_file` | **Proposal only** | UNPROVEN | Same file |
| `draft_email` | **Proposal only** | UNPROVEN | Same file |
| `send_email` | **Proposal only** | UNPROVEN | Same file |
| `update_spreadsheet` | **Proposal only** | UNPROVEN | Same file |
| `browser_interaction` | **Proposal only** | UNPROVEN | Same file |
| `calendar_update` | **Proposal only** | UNPROVEN | Same file |
| `terminal_command` | **Proposal only** | UNPROVEN | Same file |

**Critical finding:** NeedsOps does not execute any of these today. The UEE generates a Completed Work document (AI-authored text) and lists action proposals. The connector P6 dispatch pipeline (ExecutionActionDispatcher → ConnectorBridgeService) exists as code but is not wired into the live execution path.

### A6. Desktop Connector

| Capability | Implementation | File | OpenClaw Equivalent | Status |
|---|---|---|---|---|
| WSS relay transport | `deviceRelayService` | Sprint15 | OpenClaw local runtime | Real transport (L1), no payload execution proven |
| Challenge/exchange auth | Ed25519 signing | Sprint15 | N/A | Real (L1) |
| Activation codes | Desktop installer | Sprint14 | N/A | Real (L1) |
| Connector session management | `connectorSessionManagerService` | Sprint29e | N/A | Real (L1) |
| Connector bridge (action dispatch) | `connectorBridgeService` | Sprint29f | OpenClaw execution | Code present; not live-wired (L1) |
| Write idempotency | key=execId:actionId | Sprint29f1 | N/A | Design complete (L1) |

---

## Part B — OpenClaw Capability Inventory

### What is confirmed by code inspection (L1)

**AVAILABLE AND PROVEN (L1 transport layer only):**
- WSS relay from NeedsOps API Server → Desktop Connector → OpenClaw endpoint
- `IGatewayAdapter` interface: `spawn(package)`, `bridge(sessionId, callback)`, `sendMessage(msg)`, `terminate(sessionId)`, health-check
- `LiveGatewayAdapter` — implements IGatewayAdapter, connects to real relay, sends packages
- `SimulatedGatewayAdapter` — test double that returns deterministic results
- Package delivery: NeedsOps can assemble and transmit an `ExecutionPackage` (specialist manifest, work instructions, execution context) to OpenClaw via the relay
- The Desktop Connector (Electron app) acts as the local broker, receives packages over WSS, intended to forward to OpenClaw

**AVAILABLE BUT NOT CURRENTLY WIRED (L1 design, L2 mock-tested):**
- `connectorBridgeService` — can initiate a connector session, open a bridge channel
- `ExecutionActionDispatcher` — can classify and route action proposals
- Worker Profile constraints — designed to gate tool access but not enforced on OpenClaw side

**PLANNED/STUBBED:**
- OpenClaw skill/plugin registry — no manifest, catalogue, or API for listing available skills found in this repository
- Tool permission enforcement on OpenClaw side — referenced in `workerProfileRegistry` comments as the intended future chain, not implemented
- File locate/search/read via OpenClaw — not found; no skill interface for this exists in the codebase
- Word/Excel operations via OpenClaw — no skill interface found
- Browser automation via OpenClaw — no skill interface found
- Email dispatch via OpenClaw — no skill interface found

**NOT PROVIDED (confirmed absent by inspection):**
- OpenClaw skill/plugin API exposed back to NeedsOps (no protocol for NeedsOps to query "what can OpenClaw do right now?")
- OpenClaw result schema that carries structured action results (the relay carries text/SSE events but no typed action-result protocol was found)
- OpenClaw plugin catalogue or registry
- Any real live execution trace (L3 or L4 evidence)

### Evidence Assessment

The OpenClaw integration is a **proven transport, unproven runtime**. NeedsOps can deliver a work package to a desktop machine. What happens on that machine — whether OpenClaw has a runtime that interprets the package, executes tools, and returns results in a format NeedsOps can validate — is not evidenced in this repository beyond the `SimulatedGatewayAdapter` mock.

The relay protocol handles SSE streaming back from the execution side, but there is no confirmed response schema for structured action results (only text streaming).

---

## Part C — Duplication Matrix

| Capability | Verdict | Rationale |
|---|---|---|
| AI text generation for work output | **KEEP IN NEEDSOPS** | Tightly integrated with governance, provenance, evidence gate; not pure execution |
| Specialist identity/instructions | **SHARED RESPONSIBILITY** | NeedsOps owns authoring (DNA → manifest); OpenClaw should own runtime enforcement — but neither side is validated yet |
| Tool permission constraints | **SHARED RESPONSIBILITY** | Worker Profiles in NeedsOps; OpenClaw runtime should enforce — currently only designed, not wired |
| File write operations | **DELEGATE TO OPENCLAW** (when proven) | NeedsOps should govern the proposal; OpenClaw should execute it |
| File read/locate for evidence | **KEEP BOUNDARY** | OpenClaw raw file access should feed NeedsOps evidence model, not bypass it (see Part G) |
| Document generation (Word/PDF) | **DELEGATE TO OPENCLAW** (when proven) | Current export stubs should eventually become OpenClaw skill calls |
| Email draft/send | **DELEGATE TO OPENCLAW** (when proven) | Pure execution action; governance/approval stays in NeedsOps |
| Spreadsheet operations | **DELEGATE TO OPENCLAW** (when proven) | Same model |
| Browser interaction | **DELEGATE TO OPENCLAW** (when proven) | Same model |
| WSS relay transport | **KEEP IN NEEDSOPS** | Security, auth, tenant scope enforcement requires NeedsOps control of the channel |
| KRS / authority / currentness | **KEEP IN NEEDSOPS** | Core differentiator; not execution |
| Evidence snapshots / claim provenance | **KEEP IN NEEDSOPS** | Core differentiator; regulatory/audit value |
| Completed Work lifecycle | **KEEP IN NEEDSOPS** | Control plane responsibility |
| Self-review | **KEEP IN NEEDSOPS** | Governance; may inform OpenClaw retry but must be NeedsOps-owned |
| Specialist DNA | **KEEP IN NEEDSOPS** | Configuration plane; OpenClaw is the runtime consumer |
| Connector session management | **KEEP IN NEEDSOPS** | Security and tenant isolation require NeedsOps ownership |
| Approval workflow | **KEEP IN NEEDSOPS** | Control plane |
| Audit log | **KEEP IN NEEDSOPS** | Control plane |
| Org memory | **KEEP IN NEEDSOPS** | Control plane, governance-sensitive |

**Duplication finding:** There is currently **no meaningful duplication** because NeedsOps does not actually execute operational work. The duplication risk is forward-looking: as OpenClaw capability is proven, there will be pressure to implement capabilities in NeedsOps (because OpenClaw is not ready) that should eventually be OpenClaw's job.

---

## Part D — What NeedsOps Must Keep

Every item below is a **product/control-plane responsibility** that must not be delegated, regardless of OpenClaw capability:

| Capability | Why NeedsOps Must Own It |
|---|---|
| Organisation tenancy | Multi-tenant isolation is existential; no external runtime can be trusted to enforce it |
| RBAC | Role boundaries are a governance commitment, not a runtime preference |
| Subscription / entitlement | Revenue integrity |
| Task lifecycle | The unit of work; owned by NeedsOps from creation to archival |
| Execution classification | Determines what work is authorised to start |
| Specialist selection / authorisation | NeedsOps is accountable for which worker acts on behalf of an org |
| Governance policy | Compliance guarantee |
| Approval workflow | Customer-facing trust mechanism |
| Completed Work | Permanent record; version-pinned; GDPR/audit-relevant |
| Version pinning | Integrity of approved output |
| Evidence provenance | Legal/compliance value; ties output to authoritative sources |
| Claim integrity | Trust in AI output; prevents hallucination from being recorded as fact |
| Authority / currentness of org knowledge | Differentiating capability; governs what evidence may be cited |
| Audit log | Non-repudiable; must not pass through external runtime |
| Notifications / inbox | UX + governance (approval gating) |
| Organisational memory | Tenant-specific intelligence; governance-sensitive adoption |
| Usage accounting | Billing integrity |
| Connector session tokens / auth | Security; must not be held by external runtime |

None of these are candidates for delegation to OpenClaw. They form the irreducible NeedsOps control plane.

---

## Part E — OpenClaw Execution-Plane Responsibilities (Target State)

If OpenClaw's capability is proven, these should move there:

| Responsibility | Mechanism |
|---|---|
| File discovery on user's machine | OpenClaw skill, scoped to allowed paths per Worker Profile |
| File read/write | OpenClaw skill, action-gated by NeedsOps approval |
| Word/Excel document generation/editing | OpenClaw skill |
| PDF rendering (local tools) | OpenClaw skill |
| Browser automation | OpenClaw skill, gated |
| Email draft/send (local Outlook / Gmail connector) | OpenClaw plugin |
| Calendar operations | OpenClaw plugin |
| Shell/terminal commands | OpenClaw skill, gated by Worker Profile |
| External API calls (CRM, accounting) | OpenClaw plugin |
| Specialist tool execution at runtime | OpenClaw worker consuming DNA manifest |
| Plugin permission enforcement | OpenClaw runtime enforcing Worker Profile allowed-tools |

The boundary principle: **NeedsOps authorises, scopes and records. OpenClaw executes and reports back.**

---

## Part F — Specialist/DNA Target Model

### Current State

- 17 specialists (post-Sprint 11 reduction)
- Active in execution: Chief of Staff, Operations Manager
- DNA compiles to a runtime manifest: identity, mission, objectives, responsibilities, communication style, principles, escalation behaviour, prohibited phrases
- Worker Profile separately governs allowed channels and approval-required actions
- Manifest is sent to OpenClaw via relay but execution behaviour on receipt is **UNPROVEN**
- New specialists currently require: DNA entry in DB + new NeedsOps service code + new execution path configuration

### Target Model Assessment

**Target: DNA + allowed plugins (Worker Profile), no new NeedsOps service per specialist**

This is architecturally sound and achievable once OpenClaw execution is proven, because:

1. The manifest already carries everything needed for identity and behavioural configuration
2. Worker Profiles already carry allowed-channel and approval constraints in a data-driven way
3. The difference between an "HR specialist" and a "Finance specialist" should be: different DNA (role, expertise, style, escalation) + different allowed plugins (HRIS access vs ERP access) — not a different NeedsOps execution service

**What would be lost:**
- Per-specialist NeedsOps-side prompt engineering (today CoS has bespoke conversation prompt assembly code; this would need to generalise)
- Specialist-specific validation logic (e.g. cosResponseValidatorService) — this would need to become DNA-configurable rules or generalisable
- Bespoke routing logic (e.g. CoS → intent → OM delegation) — this would need to be expressible as DNA behaviour

**Recommendation:** DNA + plugins is the right long-term model. The blocker is not architecture — it is OpenClaw runtime capability proving. Do not invest in more per-specialist NeedsOps services.

---

## Part G — UEE Role in the Simplified Architecture

### Current Role (L1 evidence)
UEE is the actual execution engine. It performs:
- Orchestration and stage sequencing (2015 lines)
- AI prompt construction and LLM calls (gpt-4o, AI Gateway)
- Evidence assembly and injection into prompts
- Output validation and claim extraction
- Completed Work creation and approval submission
- Self-review invocation
- Provenance persistence

### Assessment Against Options

**Option A — Actual execution engine:** Current state. Appropriate for AI-text generation work (conversation responses, document drafts). Will not scale to tool execution.

**Option B — Orchestrator/control wrapper around OpenClaw:** Correct target state for operational work (file writes, email, spreadsheet). Not achievable until OpenClaw execution is proven.

**Option C — Partly replaced:** Pragmatic path. AI text generation (conversation path, document drafting) remains in UEE. Operational tool execution moves to OpenClaw when proven.

### Recommended UEE Target Role

**UEE becomes the governed execution envelope — a control-plane orchestrator, not the executor of operational tools:**

```
Request
→ classification
→ task/work package
→ permission/readiness checks (NeedsOps)
→ evidence/context assembly (NeedsOps KRS)
→ specialist manifest assembly (NeedsOps DNA)
→ AI draft generation (NeedsOps AI Gateway) [for document/advisory work]
→ OpenClaw execution (for operational tools) [when proven]
→ result validation (NeedsOps)
→ self-review/provenance (NeedsOps)
→ Completed Work (NeedsOps)
→ approval/audit (NeedsOps)
```

The split: UEE drives the envelope. For document/advisory work, the AI Gateway *is* the execution. For operational tool work, OpenClaw *is* the execution, invoked by UEE as a governed step.

No code change needed today. This is the design direction.

---

## Part H — Knowledge / File Access Boundary

### NeedsOps Knowledge Stack (all L1, all real)
- Organisation Library with ingestion pipeline
- KRS with authority, currentness, synonym expansion, scoring
- Evidence snapshots linked to Completed Work versions
- Claim provenance chain (emission → verification)
- Approved source types, tenant-scoped search

### OpenClaw File Access (UNPROVEN)
No file discovery or reading capability confirmed in this repository.

### Correct Boundary

**OpenClaw locates/reads raw files. NeedsOps decides whether they may be used.**

Specifically:
- OpenClaw finds a file on the user's machine → passes file content/metadata to NeedsOps
- NeedsOps applies: tenant-scope check, authority/currentness scoring, source-eligibility check, evidence snapshot if used in Completed Work
- If the file passes: it enters the evidence model and may be cited in output
- If it fails: it is excluded; exclusion is audited

This is important: OpenClaw file discovery should **feed** the NeedsOps evidence model, not bypass it. Raw file access as evidence without NeedsOps authority checking would break the claim integrity guarantee.

For files already in the Organisation Library (ingested, approved): these are served by KRS, not by OpenClaw file access. OpenClaw file access is the path for files that have not yet been ingested — discovery-to-ingestion, not a replacement for KRS.

---

## Part I — Desktop Connector Recommendation

### Current Architecture (L1)
- Electron app (`artifacts/desktop-connector`) installed on user's Mac/PC
- Activation code model (one-time, org-scoped)
- Ed25519 challenge/exchange auth with NeedsOps API server
- WSS relay: NeedsOps → Desktop Connector → (intended) OpenClaw
- `deviceRelayService`, `connectorSessionManagerService`, `connectorBridgeService` in API server
- Write operations designed but not dispatched through the connector
- Linux AppImage added (Sprint34)

### Assessment Against Options

**Option A — Thin secure transport to OpenClaw:** Architecturally correct target. The connector's value is the authenticated, org-scoped, tenant-isolated channel to the user's machine. It should not grow feature logic. OpenClaw running locally handles the tool execution.

**Option B — Feature-rich NeedsOps execution layer:** Current trajectory risk. If file operations, email dispatch, document editing are implemented in the connector rather than in OpenClaw, the connector becomes a second execution engine with its own maintenance surface and no tenant governance.

**Option C — Replaced by OpenClaw connectivity:** Premature. The connector provides the trust boundary (activation, identity, tenant-scope). OpenClaw may not have equivalent security/auth infrastructure natively.

**Recommendation: Option A.** Keep the connector as the secure transport and tenant-identity layer. Do not implement tool execution logic inside it. Tool execution belongs in OpenClaw on the far side of the relay. If this means some execution waits on OpenClaw capability, that is the correct tradeoff — the alternative is two execution engines to maintain.

The connector architecture (WSS relay, Ed25519 auth, activation codes) is well-designed and should not be replaced. It is the correct secure bridge.

---

## Part J — Plugin Strategy

### Principle Under Test
> If an integration is primarily an ACTION capability, prefer OpenClaw/plugin.  
> If it is an ORGANISATIONAL SOURCE OF TRUTH requiring indexing, authority, provenance or long-term retrieval, integrate it into NeedsOps knowledge/KRS.

**Assessment: Technically sound and architecturally correct.** The distinction maps cleanly onto the control-plane vs execution-plane split.

| Integration | Type | Recommendation |
|---|---|---|
| Gmail (read for context) | Source of truth (if recurring reference) | **KRS ingestion** |
| Gmail (send email action) | Action | **OpenClaw plugin** |
| Outlook (read) | Source of truth | **KRS ingestion** |
| Outlook (send/draft action) | Action | **OpenClaw plugin** |
| Google Drive (documents as org knowledge) | Source of truth | **KRS ingestion** |
| Google Drive (write file) | Action | **OpenClaw plugin** |
| SharePoint / OneDrive (read) | Source of truth | **KRS ingestion** |
| SharePoint / OneDrive (write) | Action | **OpenClaw plugin** |
| Dropbox | Action + source | **Split:** KRS for ingested docs, OpenClaw for write actions |
| Slack (read history for context) | Source of truth | **KRS ingestion** |
| Slack (send message) | Action | **OpenClaw plugin** |
| Teams (message) | Action | **OpenClaw plugin** |
| CRM (read customer data for task context) | Source of truth | **KRS ingestion** (indexed) |
| CRM (update records) | Action | **OpenClaw plugin** |
| Accounting systems (read) | Source of truth | **KRS ingestion** |
| Accounting systems (write) | Action | **OpenClaw plugin** |

**Critical qualification:** The "source of truth" path (KRS ingestion) should be NeedsOps-native connectors that push documents/data into the library, go through the ingestion pipeline, and acquire authority/currentness metadata. This is distinct from live API reads during execution — those are evidence resolution actions that should also flow through the KRS evidence model (even if not permanently ingested).

---

## Part K — Guardrails Around OpenClaw

### Controls NeedsOps Currently Has

| Control | How Enforced | Retainable if OpenClaw executes? |
|---|---|---|
| Allowed tool list | `workerProfileRegistry` (designed, not enforced on OC side) | YES — deliver via manifest; OC must enforce |
| Forbidden tool list | Same | YES — same mechanism |
| File scope | Worker Profile channel constraints | PARTIAL — NeedsOps specifies; OC must enforce |
| Tenant scope | NeedsOps owns the relay channel; org identity in package | YES — channel controls scope |
| Read/write permissions | Worker Profile + approval-required flags | YES — approval gate stays in NeedsOps |
| Network access | UNIMPLEMENTED currently | AT RISK — no mechanism to constrain OC network access |
| Connector access | Session management in NeedsOps | YES — session token issued by NeedsOps |
| Approval before external side effects | `ApprovalRequiredError`, approval workflow | YES — gate stays in NeedsOps; OC must honour hold instruction |
| Action audit | `logOrgEvent`, action persistence | PARTIAL — NeedsOps audits proposals; OC must report actual execution back |
| Output capture | Completed Work, result validation | PARTIAL — requires OC to return structured result |
| Evidence capture | Evidence snapshots, provenance chain | AT RISK — OC has no evidence model; NeedsOps must extract from OC output |
| Retries/timeouts | UEE retry logic, MAX_RETRIES | YES — orchestrated by UEE |
| Cancellation | Checkpoint store, `terminate(sessionId)` | YES — IGatewayAdapter has terminate |

### Controls at Risk if Execution Delegates to OpenClaw

1. **Network access control** — NeedsOps currently has no mechanism to tell OpenClaw which external endpoints it may call. Any plugin that makes network requests would be unconstrained. This requires a Worker Profile field for allowed domains/services + OpenClaw enforcement.

2. **Actual action audit** — NeedsOps currently audits action *proposals*. If OpenClaw executes and the result doesn't come back with a structured action log, the audit record shows intent but not execution. This requires a typed result protocol from OpenClaw.

3. **Evidence extraction from tool output** — The current claim provenance pipeline processes AI text output. Tool outputs (file writes, API responses) are structurally different. Evidence handling would need to be extended to cover tool-produced artifacts.

4. **Specialist behaviour consistency** — Today, cosResponseValidatorService validates CoS output against specific rules. OpenClaw execution output validation is entirely undefined.

---

## Part K — Proposed End-to-End Architecture (Data Flow Design)

### Transient path (conversation, advisory, no Completed Work)
```
User message
→ ConversationService (find/create conversation)
→ ExecutionClassifier (TRANSIENT lane)
→ UEE conversation path
→ Context assembly (KRS presence, org memory, workforce context)
→ AI Gateway (gpt-4o, conversation specialist prompt)
→ Output validation (action proposals extracted, not dispatched)
→ SSE stream to client
→ Conversation message stored
→ Audit (minimal)
```

### Professional work path (Completed Work, document/advisory output)
```
User approves intent / submits task
→ ExecutionCoordinatorService (idempotency, approval)
→ UEE task path
→ Readiness checks (specialist, entitlement, connector, blueprint)
→ Blueprint selection
→ Evidence assembly (KRS, authority, currentness, evidence gate)
→ Specialist manifest assembly (DNA → manifest)
→ AI Gateway (JSON output, specialist instruction, evidence-enriched context)
→ Output validation + claim extraction
→ Self-review (10 dimensions)
→ Completed Work draft creation
→ Submit for approval
→ Provenance chain (evidence snapshots, claim links)
→ Approval workflow (governance)
→ Audit (full)
```

### Evidence-bearing path (same as professional, with evidence gate)
```
... same as professional path above, with:
→ Hard evidence gate (Sprint29M): blocks execution if required evidence is absent
→ Absence verification (KRS second pass)
→ Claim integrity pipeline (emission → verification → provenance_status)
```

### External-action path (operational, connector required) — TARGET STATE, not current
```
... professional path, then:
→ Action proposals validated (approval check)
→ ConnectorBridgeService: open connector session (NeedsOps)
→ ExecutionActionDispatcher: dispatch approved actions
→ DeviceRelayService: send to Desktop Connector
→ [OpenClaw executes: file write / email / spreadsheet / browser]
→ Action results returned via bridge channel
→ Results validated (NeedsOps)
→ Action audit written (NeedsOps)
→ Evidence captured from action results (NeedsOps)
→ Completed Work updated with action outcomes
→ Connector session closed
```

The external-action path's OpenClaw steps are the **unproven section** of the architecture.

---

## Part L — Components to Retain / Adapt / Freeze / Retire

### RETAIN (core control-plane, irreplaceable)
| Component | Reason |
|---|---|
| UEE orchestration shell | Governance envelope |
| ExecutionCoordinatorService | Approval/idempotency |
| KRS + knowledge ingestion pipeline | Differentiating capability |
| Evidence snapshot + claim provenance | Trust/compliance |
| Completed Work + version pinning | Permanent record |
| Self-review service | Quality governance |
| DNA compiler (specialistRuntimeManifestService) | Behavioural configuration |
| Worker Profile registry | Permission design (needs OC enforcement) |
| Connector session / relay infrastructure | Security transport |
| Approval workflow | Governance |
| Audit log | Non-repudiable record |
| RBAC middleware | Security |
| Entitlement / capability gate | Revenue |

### ADAPT (right idea, needs generalisation)
| Component | Change Needed | Priority |
|---|---|---|
| cosResponseValidatorService | Extract rules into DNA-configurable format, not CoS-hardcoded | Medium |
| CoS prompt assembly (bespoke conversation code) | Generalise to work for any specialist via manifest | Medium |
| executionActionDispatcher | Extend to return typed results from OC, not just proposals | Blocked on OC |
| Evidence pipeline | Extend to handle tool-produced artifacts, not just text | Blocked on OC |
| Worker Profile registry | Add network domain constraints; wire actual OC enforcement | Blocked on OC |

### FREEZE (no further investment; OpenClaw should eventually replace)
| Component | Current Purpose | OpenClaw Replacement | Risk of Freezing | Migration Order |
|---|---|---|---|---|
| Export stubs (PDF/DOCX) | Placeholder for document generation | OpenClaw Word/PDF skill | Low — stubs do nothing | Phase 1 (implement in OC first) |
| FutureProviders | IKnowledgeProvider stubs | Proper OC-backed provider implementations | None — stubs do nothing | Phase 2 |
| SimulatedGatewayAdapter | Test double for OC | Keep for tests; real OC replaces production use | None | N/A |

### RETIRE EVENTUALLY (when OpenClaw capability proven and stable)
| Component | Current Purpose | OpenClaw Replacement | Risk | Migration Order |
|---|---|---|---|---|
| Any per-specialist NeedsOps execution service beyond CoS/OM | Specialist tool logic | DNA + OC plugins | Medium — behaviour parity must be verified | Phase 3 |
| Bespoke CoS/OM conversation prompt code | Specialist-specific prompting | Generalised manifest-driven prompting | Medium | Phase 2 |

**Nothing should be deleted now.** The code freeze candidates produce no observable behaviour; the retire candidates require OpenClaw to be proven first.

---

## Part M — Performance and Cost Comparison

**Caveat: no measurements exist. All figures are architectural estimates.**

### Current Architecture (one professional task)

| Step | Count | Notes |
|---|---|---|
| Services crossed | ~12-15 | UEE, coordinatorSvc, blueprintSvc, KRS, evidenceSvc, manifestSvc, selfReviewSvc, completedWorkSvc, provenanceSvc, auditSvc, approvalSvc, notificationSvc |
| LLM calls | 2-4 | 1 task draft (UEE) + 1-2 self-review + optional 1 absence verification |
| DB writes | ~15-25 | Execution intent, checkpoint, manifest observability, draft creation, evidence snapshots, claims, provenance status, audit events, approval record, notifications |
| Network hops | 0 (no external execution) | All in-process; connector not live |
| Estimated latency | 8-20 seconds | Dominated by LLM calls (3-8s each) |
| Maintenance surface | High | 2000-line UEE + 15+ services |

### Proposed Architecture (OpenClaw execution, same task)

| Step | Count | Notes |
|---|---|---|
| Services crossed | ~14-18 | +connectorBridgeSvc, +deviceRelaySvc, +actionDispatcherSvc; some inner services merge |
| LLM calls | 1-3 | Draft generation may partially shift to OC; validation/review remain in NeedsOps |
| DB writes | ~15-25 | Similar; action results add records |
| Network hops | 2-4 | NeedsOps→relay→connector→OC; results back |
| Estimated latency | 12-30 seconds | +relay round-trip +OC execution time |
| Maintenance surface | Medium-long term | Fewer NeedsOps services but OC integration surface |

**Performance finding:** Delegating to OpenClaw will likely **increase** latency for most tasks, not reduce it — the network round-trip through the relay adds overhead, and OC tool execution is an additional step after AI generation. The benefit is not latency; it is **capability** (tools that NeedsOps cannot perform today) and **maintenance** (fewer NeedsOps services to own long-term).

The latency wins come from reducing redundant LLM calls if OC can handle some context retrieval, but this is speculative.

---

## Part N — Failure Modes / Case Against Simplification

| Risk | Severity | Assessment |
|---|---|---|
| **Runtime reliability** | High | OpenClaw reliability unknown; relay adds failure surface; connector requires user machine to be on and connected |
| **Security** | High | NeedsOps loses direct control over what code runs; plugin quality is unvetted; network access from OC process is unconstrained |
| **Plugin quality** | High | No plugin quality framework exists yet; a bad plugin could corrupt files or exfiltrate data |
| **Tool determinism** | Medium | LLM-driven tool selection within OC may behave inconsistently; NeedsOps has no control over OC tool choices |
| **Vendor/runtime dependency** | High | If OpenClaw's runtime changes, NeedsOps execution breaks; version compatibility becomes a critical dependency |
| **Observability** | High | NeedsOps currently has full observability into every execution step; OC execution is a black box unless a rich result protocol is defined |
| **Offline operation** | High | Connector requires active WSS connection; professional work currently works without a connector (AI text generation always available) |
| **Upgrade compatibility** | Medium | OC package format changes could silently break execution without errors NeedsOps can detect |
| **Specialist behaviour consistency** | High | CoS/OM behaviour is carefully tuned and validated; OC runtime interpretation of manifests has not been validated |
| **Audit completeness** | High | NeedsOps cannot write a complete audit record for actions it did not observe at the step level |
| **Claim integrity** | High | The claim pipeline processes NeedsOps-generated text. OC-generated file writes produce no claim trail unless explicitly designed |
| **Data residency** | Medium | OC execution on user's machine may touch files; how NeedsOps enforces tenant-scoped file access constraints on OC is undefined |

**The strong case for not delegating today:**
1. OpenClaw is a transport endpoint, not a proven runtime. NeedsOps would be delegating to an unproven system.
2. The control-plane guarantees (audit completeness, claim integrity, evidence provenance) cannot be maintained without a rich, typed result protocol from OpenClaw that does not exist.
3. Professional work (document drafts) already functions end-to-end without OpenClaw. Operational tool execution (file writes, email) is the gap — and this is exactly the gap that requires OpenClaw to be proven first.

**The case for preparing the boundary now:**
1. Every NeedsOps-native tool implementation added before OpenClaw is proven becomes technical debt to migrate later.
2. The action proposal model (all 10 types are proposals, never dispatched) correctly anticipates OpenClaw. This architecture was right to leave operational execution as proposals.
3. Worker Profiles are the right design for tool permission governance. They should not be abandoned in favour of NeedsOps-native tool implementations.

---

## Part O — Staged Migration Plan

**Preconditions before any phase:** OpenClaw must demonstrate L3 evidence: a real execution that returns structured results NeedsOps can validate, audit, and attach to Completed Work. Without this, no phase begins.

### Phase 0 — OpenClaw Integration Proof (required before anything)
- Commission a concrete test: NeedsOps sends an ExecutionPackage → Desktop Connector → OpenClaw → OpenClaw writes one file → result returns to NeedsOps via bridge → NeedsOps records the action
- Define the result protocol: typed action results with outcome, artifact reference, error codes
- Validate that the Worker Profile allowed-tools constraint is enforced on the OpenClaw side
- Only proceed to Phase 1 when L3 evidence exists for at least one action type

### Phase 1 — File Operations (lowest risk operational action)
- Wire `write_file` and `create_file` proposals through `ExecutionActionDispatcher → ConnectorBridgeService → relay`
- Implement result receipt and audit
- Implement evidence capture for file-produced artifacts
- Keep all NeedsOps governance (approval-before-execute) intact
- Preserve fallback: if connector not present, action stays as proposal

### Phase 2 — Document Generation via OpenClaw
- Implement Word/Excel operations as OpenClaw skills
- Replace export stubs with OC skill calls for file-format output
- NeedsOps retains Completed Work ownership; document is an artifact, not a replacement for CW
- Validate manifest-driven specialist behaviour against current hardcoded CoS behaviour

### Phase 3 — Email and Calendar Actions
- Implement email draft/send and calendar via OpenClaw plugins (Outlook/Gmail)
- Approval-gate all send operations in NeedsOps
- Dual-write audit: NeedsOps records intent + OC returns confirmation of dispatch

### Phase 4 — Specialist DNA Generalisation
- Generalise CoS/OM prompt assembly to be manifest-driven (remove bespoke per-specialist code)
- Retire `cosResponseValidatorService` specifics in favour of DNA-configurable validation rules
- New specialists added via DNA + Worker Profile configuration, not new NeedsOps services

### Phase 5 — Connector Plugin Strategy
- Migrate NeedsOps-native connector action implementations (if any exist by then) to OpenClaw plugins
- KRS ingestion connectors (Google Drive, SharePoint, etc.) remain NeedsOps-native
- Action connectors (file write, CRM update) become OpenClaw plugins under Worker Profile governance

Each phase must:
- Preserve current production behaviour (proposals remain proposals if OC unavailable)
- Allow rollback (feature-flag each action type, fall back to proposal if bridge fails)
- Preserve Completed Work (OC output always captured and versioned in CW)
- Preserve provenance (all OC-executed actions logged in audit + evidence snapshots)
- Preserve RBAC/governance (approval gates, RBAC checks remain in NeedsOps, not OC)

---

## Part P — Explicit Answers to Questions 1–20

**1. Are we rebuilding capabilities OpenClaw already provides?**  
No — not yet. NeedsOps does not execute operational tools. All 10 action types are proposals only. If OpenClaw provides these capabilities (unproven), we have not rebuilt them; we have left them as stubs, which was the right call.

**2. Which ones?**  
None currently implemented in duplicate. The risk is forward-looking: if file write, email, document generation are implemented inside NeedsOps or the Desktop Connector rather than as OpenClaw capabilities, that becomes duplication.

**3. Which NeedsOps components are genuinely unique product value?**  
KRS with authority/currentness scoring, evidence snapshots, claim provenance pipeline, Completed Work with version pinning, approval workflow, organisational memory, DNA-based specialist configuration, the execution governance envelope (readiness checks, evidence gate, self-review). These have no OpenClaw equivalent and represent the differentiated product.

**4. Should UEE remain an executor or become a governed orchestrator?**  
Governed orchestrator. For AI-text professional work it will continue to call the AI Gateway directly (this is appropriate — the AI Gateway is its tool). For operational tool work, it should invoke OpenClaw as a governed step. The 2015-line monolith should be progressively decomposed as the execution types mature.

**5. Should file operations move to OpenClaw?**  
Yes — when OpenClaw is proven (L3 evidence). Not before. The action proposal model is the correct interim state.

**6. Should Word/Excel/browser operations move to OpenClaw?**  
Yes — same condition. Export stubs should be implemented in OpenClaw, not in NeedsOps.

**7. Should connector actions primarily become OpenClaw plugins?**  
Yes for ACTION connectors (email send, file write, CRM update). No for SOURCE OF TRUTH connectors (document ingestion, knowledge indexing) — those remain NeedsOps-native KRS ingestion.

**8. Should organisational knowledge/KRS remain NeedsOps-native?**  
Definitively yes. The authority, currentness, tenant-scoping, approved-source model, and evidence provenance pipeline are core product value. KRS is not a caching layer; it is a governed evidence store. No external runtime should substitute for it.

**9. Should evidence provenance remain NeedsOps-native?**  
Definitively yes. The claim integrity pipeline (emission, verification, provenance_status, snapshots) is what makes NeedsOps output trustworthy. It must process all output regardless of whether it came from AI text generation or OpenClaw tool execution.

**10. Should specialist expansion primarily be DNA + plugins?**  
Yes. New specialists should be DNA profile + Worker Profile configuration, not new NeedsOps services. The current CoS/OM implementations should be progressively generalised so they are driven by their manifests rather than by bespoke per-specialist code.

**11. Is Operations Manager enough as the default general executor?**  
Yes, for the majority of professional work requests. The CoS as intent interpreter and OM as default general executor is the right model. Specialist DNA differentiates behaviour within that envelope without requiring separate execution paths.

**12. What specialist logic must remain outside OpenClaw?**  
Intent interpretation (CoS conversation path), execution classification (transient/professional/evidence-bearing), specialist selection authorisation, governance policy enforcement, evidence assessment, self-review, output validation. These are governance steps, not execution steps.

**13. Can OpenClaw execution be sufficiently constrained by NeedsOps guardrails?**  
Not yet — the constraint mechanisms (Worker Profile → OC allowed-tools enforcement) are designed but not proven. A network access constraint mechanism does not yet exist. This must be demonstrated before delegation.

**14. What controls would be lost?**  
Network access control, real-time action-level audit (proposals vs actual execution), direct observability into execution steps, claim provenance for tool-produced artifacts. Each requires explicit protocol design before delegation is safe.

**15. Can the Desktop Connector be simplified?**  
Yes — it should be the secure transport layer (WSS, Ed25519, activation, tenant identity) and nothing more. Tool execution logic must not be added to the connector. It should remain a thin, trustworthy bridge.

**16. What code/services could eventually be retired?**  
Per-specialist bespoke execution code beyond what is expressible via manifest, cosResponseValidatorService specialist-specific rules, export stubs (once OC implements them), SimulatedGatewayAdapter in production (keep in tests), FutureProviders stubs.

**17. What should definitely NOT be removed?**  
KRS, evidence pipeline, Completed Work, version pinning, approval workflow, audit log, RBAC, entitlement/capability gate, organisational memory, DNA compiler, Worker Profile registry, connector relay infrastructure, self-review.

**18. Would simplification reduce latency materially?**  
No — it would likely increase latency for operational tasks by adding relay round-trips. It reduces maintenance burden, not latency. Latency for AI text generation is dominated by LLM response time, which OpenClaw does not improve.

**19. Would it reduce maintenance burden materially?**  
Yes — but only in Phase 3-5, after specialist expansion is DNA-driven rather than service-driven. The near-term maintenance cost is higher (OC integration, result protocol, evidence extension). The long-term benefit is not adding a new NeedsOps service per specialist domain.

**20. What is the safest target architecture?**  
NeedsOps as control plane (governance, evidence, audit, Completed Work, approval, memory). OpenClaw as execution plane (file ops, documents, email, browser, tools) reached via the secure relay connector. DNA + Worker Profiles as the behavioural configuration layer for specialists. KRS as the governed evidence foundation that all output, regardless of source, must satisfy. The connector as the thin trusted transport. Reached incrementally, with L3 proof required before each phase.

---

## Final Verdict

**INSUFFICIENT EVIDENCE — OPENCLAW CAPABILITY NOT PROVEN**

The architecture direction is correct: NeedsOps as control plane, OpenClaw as execution plane. But OpenClaw's runtime capability in this specific integration — what skills it has, whether it enforces Worker Profile constraints, whether it can return typed results NeedsOps can audit — is not proven at L3 or L4.

The good news: the codebase made the right architectural choices. Action types are proposals, not dispatched commands. The relay transport exists. Worker Profiles define the permission model. DNA compiles to a clean manifest. None of this needs to change.

What needs to happen next is not architecture — it is **proof**: one real end-to-end execution (NeedsOps → relay → OpenClaw → result → NeedsOps audit) that validates the relay protocol, the result contract, and the Worker Profile enforcement. That proof gates every phase of the migration plan above.

Until that proof exists, the correct posture is:
- **No new NeedsOps-native tool implementations** (do not build what OpenClaw should own)
- **Keep all action types as proposals** (current correct state)
- **Generalise specialist configuration toward DNA-driven** (reduce per-specialist code)
- **Define the result protocol** (what OpenClaw must return for NeedsOps to accept the result)

The clean boundary is: **NeedsOps decides, governs, remembers and records. OpenClaw does. The connector connects them securely.**

---

*Report produced: 8 August 2026. Investigation only. No implementation.*
