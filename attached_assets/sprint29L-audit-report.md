# SPRINT 29L — FULL PRODUCT MODULE, SUBMENU & FUNCTION OVERLAP AUDIT

**Date:** 2026-08-08  
**Evidence standard:** L1 (static code inspection) unless otherwise stated.  
**No implementation changes were made.**

---

## A. FULL MODULE / SUBMENU / TAB INVENTORY

### Navigation Structure (org shell — `AppShell.tsx:9–49`)

| Section | Label | Path | Component file |
|---|---|---|---|
| WORKSPACE | Dashboard | `/app/:slug` | `AppDashboard.tsx` |
| WORKSPACE | Inbox | `/app/:slug/inbox` | `ExecutiveInbox.tsx` |
| WORKSPACE | Active Work | `/app/:slug/active-work` | `ActiveWorkPage.tsx` |
| WORKSPACE | Notifications | `/app/:slug/notifications` | `NotificationCentrePage.tsx` |
| OPERATIONS | Chat | `/app/:slug/chat` | `WorkforceChatPage.tsx` |
| OPERATIONS | Workforce | `/app/:slug/workforce` | `WorkforcePage.tsx` |
| OPERATIONS | Operations Centre | `/app/:slug/workforce-ops` | `WorkforceOpsCentre.tsx` |
| OPERATIONS | Tasks | `/app/:slug/tasks` | `TaskCentrePage.tsx` |
| OPERATIONS | Completed Work | `/app/:slug/work` | `CompletedWorkPortal.tsx` |
| KNOWLEDGE | Library | `/app/:slug/library` | `OrgLibraryPage.tsx` |
| KNOWLEDGE | Memory | `/app/:slug/memory` | `OrgMemoryPage.tsx` |
| KNOWLEDGE | Blueprint Studio | `/app/:slug/blueprints` | `BlueprintStudioPage.tsx` |
| GOVERNANCE | Governance | `/app/:slug/governance` | `GovernanceCentre.tsx` |
| GOVERNANCE | Approvals | `/app/:slug/approvals` | `ApprovalsPage.tsx` |
| GOVERNANCE | **Memory** ← DUPLICATE | `/app/:slug/memory` | `OrgMemoryPage.tsx` |
| GOVERNANCE | Knowledge Health | `/app/:slug/governance/knowledge-health` | `KnowledgeHealthPage.tsx` |
| GOVERNANCE | Timeline | `/app/:slug/governance/timeline` | `GovernanceTimelinePage.tsx` |
| GOVERNANCE | Audit Log | `/app/:slug/audit` | `AuditPage.tsx` |
| ORG | Team | `/app/:slug/team` | `TeamPage.tsx` |
| ORG | Plan | `/app/:slug/plan` | `PlanPage.tsx` |
| ORG | Usage | `/app/:slug/usage` | `UsagePage.tsx` |
| ORG | Settings | `/app/:slug/settings` | `SettingsPage.tsx` |
| BOTTOM | Platform Console | `/platform` | `PlatformShell.tsx` (platform-admin only) |

> **Note:** Memory appears in both KNOWLEDGE and GOVERNANCE nav sections, pointing to the same path and component. This is a nav configuration bug — not a functional duplication, but confusing.

### Deep module inventory

#### DASHBOARD (`AppDashboard.tsx`)
- **Tabs:** None
- **Data displayed:** Workforce pack summary, task queue count, recent completed work, org system status, quick-action shortcuts
- **API calls:** `useGetDashboardSummary()`, `useGetSystemStatus()` (generated hooks)
- **Actions (mutating):** None — navigation shortcuts only (→ /chat, → /workforce, → /tasks, → /work)
- **Creates Completed Work:** No | **Triggers Tasks:** No | **Triggers Specialists:** No | **Sends Notifications:** No

---

#### INBOX (`ExecutiveInbox.tsx`, path `/inbox`)
- **Tabs (client-side filter):** All · Work · Approvals · Knowledge
- **Data displayed:** Awaiting-approval work, recently approved work, pending approvals, proposed knowledge curation items, unread conversation count (CTA only)
- **API calls fetched:**
  - GET `/v1/organisations/:slug/completed-work?limit=50`
  - GET `/v1/organisations/:slug/approvals?state=pending`
  - GET `/v1/organisations/:slug/knowledge/curation/proposals?status=proposed&limit=20`
  - GET `/v1/organisations/:slug/notifications/unread-count`
  - GET `/v1/organisations/:slug/notifications/state`
- **Mutations:** POST `/notifications/archive`, POST `/notifications/restore`
- **Synthetic notification IDs assembled:** `work-<id>`, `done-<id>`, `approval-<id>`, `proposal-<id>`
- **Dead:** Restore button exists in code but is not rendered (`ExecutiveInbox.tsx` — mutation defined, no JSX button). Conversation item type is declared in the type but never added to the rendered list.
- **Creates Completed Work:** No | **Triggers Tasks:** No | **Triggers Specialists:** No | **Sends Notifications:** No

---

#### ACTIVE WORK (`ActiveWorkPage.tsx`, path `/active-work`)
- **Tabs (client-side filter):** All · In Progress · Awaiting Approval · Completed · Failed
- **Data displayed:** Combined task and completed-work cards, status counts, specialist/blueprint/timestamps
- **API calls:**
  - GET `/v1/organisations/:slug/completed-work?limit=100`
  - GET `/v1/organisations/:slug/tasks`
  - (polling every 60s)
- **Actions:** Tab filters, Navigate to task detail → `/tasks/:taskId`, Empty-state CTA → `/chat`
- **AMBER:** Work cards are non-clickable (detail links commented as "future"). Failed status only surfaces from task records, not completed work.
- **Creates Completed Work:** No | **Triggers Tasks:** No | **Triggers Specialists:** No | **Sends Notifications:** No

---

#### NOTIFICATIONS (`NotificationCentrePage.tsx`, path `/notifications`)
- **Tabs:** All · Unread · Archived
- **Type filter:** All Types / Work / Approvals / Knowledge / Conversations
- **Data displayed:** Same records as Inbox — assembled from same API queries
- **API calls fetched:** Identical to Inbox (completed-work, approvals, knowledge proposals, notifications/unread-count, notifications/state)
- **Mutations:** POST `/notifications/mark-read`, `/mark-unread`, `/archive`, `/restore`
- **Synthetic IDs:** `work-<id>`, `approved-<id>`, `approval-<id>`, `proposal-<id>`, `conv-unread` (aggregate)
- **Adds conv-unread item** (Inbox does not — minor difference)
- **Creates Completed Work:** No | **Triggers Tasks:** No | **Triggers Specialists:** No | **Sends Notifications:** No

---

#### CHAT (`WorkforceChatPage.tsx`, path `/chat`)
- **Tabs:** None (single conversation interface)
- **Sub-navigation:** None
- **Data displayed:** Persisted conversation messages, streaming AI tokens, task proposal / auto-created cards
- **API calls:**
  - POST `/v1/organisations/:slug/conversations` — create or find conversation
  - GET `/conversations/:id/messages`
  - POST `/conversations/:id/messages` — sends user message, SSE stream response
  - POST `/conversations/:id/create-task` — converts discussion to a task
- **SSE events consumed:** `token`, `user_message`, `agent_message`, `task_auto_created`, `done`, `error`
- **Actions:** Send message, Abort (client-side only), Prompt chips, Create task from proposal card
- **Creates Completed Work:** Indirectly — via AI execution triggered by message → UEE → completedWorkService
- **Triggers Tasks:** Yes — via create-task endpoint OR auto-dispatch when confidence ≥ 0.85
- **Triggers Specialists:** Yes — CoS routes to Operations Manager / other specialists via UEE
- **Sends Notifications:** Yes — via SSE + downstream notification_reads writes

---

#### WORKFORCE (`WorkforcePage.tsx`, path `/workforce`)
- **Tabs:** (specialist list with card grid)
- **Sub-navigation:** Individual specialist detail → `/workforce/:specialistId` (deep-link, not in sidebar)
- **Sub-pages (router-wired, not in sidebar):**
  - `/workforce/:specialistId/training` → `SpecialistTrainingPage.tsx` (6 tabs: Overview · Sources · Approved Examples · Language Profile · Memory · Settings)
- **Data displayed:** Specialist catalogue, capability pack status, DNA version, training status
- **API calls:** GET `/v1/organisations/:slug/workforce/catalogue`, GET `/workforce/capabilities`, pack status
- **Mutations:** None from the browse page (training managed in training sub-page)
- **Creates Completed Work:** No | **Triggers Tasks:** No | **Triggers Specialists:** No | **Sends Notifications:** No

---

#### OPERATIONS CENTRE (`WorkforceOpsCentre.tsx`, path `/workforce-ops`)
- **Tabs:** Overview · Specialists · Knowledge · Alerts · Health (inferred from workforceOpsService structure)
- **Sub-pages (router-wired):** `/workforce-ops/:specialistId` → specialist ops profile detail
- **Data displayed:** Aggregated operational metrics — specialist readiness blockers, workload, performance scores, recent completed work, knowledge health, alerts, org health
- **API calls:** All via `workforceOpsService` endpoints:
  - GET `/v1/organisations/:slug/workforce-ops/dashboard`
  - GET `/v1/organisations/:slug/workforce-ops/specialists/:code/profile`
  - GET `/v1/organisations/:slug/workforce-ops/readiness`
  - GET `/v1/organisations/:slug/workforce-ops/workload`
  - GET `/v1/organisations/:slug/workforce-ops/performance`
  - GET `/v1/organisations/:slug/workforce-ops/knowledge`
  - GET `/v1/organisations/:slug/workforce-ops/alerts`
  - GET `/v1/organisations/:slug/workforce-ops/health`
- **Mutations:** POST pause/resume/suspend/enable/force-retrain/refresh-knowledge (management actions)
- **Creates Completed Work:** No | **Triggers Tasks:** No | **Triggers Specialists:** Indirectly (force-retrain triggers specialist queue entry) | **Sends Notifications:** No

---

#### TASKS (`TaskCentrePage.tsx`, path `/tasks`)
- **Tabs:** All / status filters (queued, planning, awaiting approval, approved, executing, completed, failed, cancelled)
- **Sub-pages:** `/tasks/:taskId` → task detail (plan, approval state, specialists, timeline)
- **Data displayed:** Task list, execution plan, assigned specialists, approval state
- **API calls:**
  - GET `/v1/organisations/:slug/tasks`
  - GET `/v1/organisations/:slug/tasks/:taskId`
  - GET `/v1/organisations/:slug/tasks/:taskId/plan`
- **Mutations:** POST transition (approve/cancel/reject), cancel task
- **Creates Completed Work:** Yes — via taskService dispatch → UEE → completedWorkService
- **Triggers Tasks:** Yes (tasks ARE tasks)
- **Triggers Specialists:** Yes — task dispatch selects primarySpecialist from execution plan
- **Sends Notifications:** Yes — via SSE events + downstream notification_reads

---

#### COMPLETED WORK (`CompletedWorkPortal.tsx`, path `/work`)
- **Tabs:** All / status filters (draft, awaiting_approval, approved, rejected, archived)
- **Pin sidebar:** Recent and pinned work (localStorage)
- **Sub-pages:** `/work/:id` → `CompletedWorkViewer.tsx`
- **CompletedWorkViewer tabs:**
  - **Work** — rendered markdown content (normalised via `normaliseCompletedWorkContent()`)
  - **Quality** — self-review scores across 10 dimensions, evidence claim breakdown
  - **Versions** — version history, approved version integrity banner when newer revision exists
  - **Comments** — threaded comments
  - **Evidence** — evidence links and claims
  - **Details** — execution metadata (specialist, blueprint, duration, session ID)
- **Download menu:** Export as PDF / DOCX (versioned filenames `-v{n}`)
- **API calls:**
  - GET `/v1/organisations/:slug/completed-work` (list)
  - GET `/v1/organisations/:slug/completed-work/:id` (detail + versions + quality)
  - POST `/completed-work/:id/approve`, `/reject`, `/reopen`, `/submit`
  - POST `/completed-work/:id/export` (PDF/DOCX)
  - POST `/completed-work/:id/comments`
- **Creates Completed Work:** Yes — revision/revision workflow creates new version of existing work
- **Triggers Tasks:** No | **Triggers Specialists:** No | **Sends Notifications:** Yes (via approval mutations)

---

#### PLATFORM CONSOLE (path `/platform`, platform-admin only)

| Sub-page | Path | Status (L1) |
|---|---|---|
| Platform Dashboard | `/platform` | GREEN — live queries |
| Organisations | `/platform/organisations` | GREEN — live CRUD |
| Commercial | `/platform/commercial` | GREEN — plans/pricing management |
| Trials | `/platform/trials` | GREEN — trial management |
| Workforce | `/platform/workforce` | GREEN — catalogue metadata |
| Usage | `/platform/usage` | GREEN — live usage data |
| Support | `/platform/support` | Unverified — not read |
| Security | `/platform/security` | Unverified — not read |
| Audit | `/platform/audit` | GREEN — live audit log |
| Runtime | `/platform/runtime` | AMBER — AI/runtime sections live; knowledge providers are explicit stubs ("Not yet implemented") |
| Specialist Ops | `/platform/specialist-ops` | GREEN — 15s polling live stats |
| Pack Builder | `/platform/packs` | GREEN — live DB-driven |
| Staff | `/platform/staff` | Unverified — not read |
| Connector Fleet | `/platform/connector-fleet` | GREEN — device management live |
| Catalogue | `/platform/catalogue` | GREEN — live with Coming Soon status toggle |
| Platform Settings | `/platform/settings` | Unverified — not read |

---

#### KNOWLEDGE MODULES

| Module | Path | Functional status |
|---|---|---|
| Library | `/library` | GREEN — full CRUD source/chunk management |
| Memory | `/memory` | GREEN — approve/reject/edit/supersede/merge/create |
| Blueprint Studio | `/blueprints` | GREEN — list/archive/restore/clone/edit/version/test/publish |
| Governance Centre | `/governance` | GREEN — 6+ live API queries, computed health |
| Approvals | `/approvals` | GREEN — 6 approval sources, bulk operations |
| Knowledge Health | `/governance/knowledge-health` | GREEN — health metrics from API |
| Timeline | `/governance/timeline` | GREEN — audit-backed |
| Audit Log | `/audit` | GREEN — live org audit |

---

## B. MODULE PURPOSE MAP

### What job is each module hired to do?

| Module | Primary responsibility | Current secondary responsibilities |
|---|---|---|
| **Dashboard** | Org status overview and navigation shortcuts | None |
| **Inbox** | Actionable items requiring user decision (work needing approval, approvals, knowledge proposals) | Conversation unread surfacing (weak — CTA only) |
| **Active Work** | Monitor currently running and recently completed work items | Duplicates Inbox display of completed-work cards |
| **Notifications** | Read/archive/snooze all notification events across types | Almost identical to Inbox (see Part E) |
| **Chat** | Conversational AI workforce entry point — discuss work, instruct specialists, spawn tasks | Displays task proposal cards; notification-like SSE alerts |
| **Workforce** | Specialist catalogue browse + individual specialist training management | — |
| **Operations Centre** | Operational oversight and management of the live AI workforce | Surfaces completed-work quality/recency (Completed Work also does this) |
| **Tasks** | Explicit work commitments with a full lifecycle (queue → plan → approve → execute → complete) | — |
| **Completed Work** | Canonical repository of finished substantive professional outputs | Approval workflow (Governance also manages approvals) |
| **Library** | Upload and manage documents that feed specialist knowledge retrieval | — |
| **Memory** | Curate and approve AI-generated organisational memory | — |
| **Blueprint Studio** | Define, version and publish work blueprints that govern execution | — |
| **Governance** | Cross-domain compliance health, policy metrics, recommendations | Surfaces same Completed Work and Approvals data as Approvals page |
| **Approvals** | Approve / reject / bulk-act on all pending approvals across types | Partially overlaps Governance and Inbox |
| **Platform Console** | Platform-owner administration (multi-tenant management, commercial, runtime) | — |

### Boundary clarifications

**CHAT vs TASKS**  
Chat is the *conversational* entry point — fluid, real-time, discovery-oriented. It can auto-create tasks when intent confidence ≥ 0.85 but does not itself manage task lifecycle. Tasks is the *structured* entry point — explicit work commitments with a state machine (draft → queued → planning → approval → executing → completed). Both eventually converge on the same UEE execution engine. The distinction is **entry point style, not capability** — which is intentional.

**ACTIVE WORK**  
Active Work is a **unified work queue monitor** — it aggregates tasks and completed-work records into a single view of "what is happening right now". It is a read-only status dashboard, not a work-initiation surface. Currently it fetches `completed-work` (not truly "active" items) and `tasks`, blending lifecycle stages. Its "In Progress" tab shows completed-work records at `draft` or `awaiting_approval` stage alongside tasks at `executing` — this is a **conceptual mismatch**: completed-work records are the *output* of execution, not the execution itself.

**OPERATIONS CENTRE**  
Unique purpose: **AI workforce management and operational control**. It is the only surface that exposes specialist readiness blockers, per-specialist workload/performance analytics, retrain/suspend/enable management actions, and org-level AI health. It does NOT initiate execution. It reads completed-work for quality analytics, which overlaps with Completed Work Portal display but from an operational (not governance) perspective.

**INBOX vs NOTIFICATIONS**  
These are the same data with different UX. Both query completed-work, approvals, and knowledge proposals and assemble synthetic notification IDs from those records. Notifications adds a `conv-unread` aggregate item; Inbox does not. Notifications offers mark-read/unread/archive/restore; Inbox offers archive/restore only. There is no separate "notification" record type in the backend — both are frontend aggregations of existing records. **This is genuine UI duplication** (see Part E).

**COMPLETED WORK**  
Yes, it is the canonical repository of finished professional outputs. All execution paths (Chat → UEE, Task → UEE, direct specialist dispatch → UEE) converge on `completedWorkService.createDraft()` → `submitForApproval()`. It is the single canonical final artefact store (proven — see Part F).

**DASHBOARD**  
Purely a summary/navigation layer. Its `AppDashboard.tsx` contains no mutating actions — only status display and navigation links. Dashboard does not independently implement any workflow available elsewhere.

**PLATFORM CONSOLE**  
Contains functions that are exclusively platform-owner concerns: cross-tenant org management, commercial/pricing control, workforce catalogue administration, runtime/AI monitoring, device fleet management. No org-user can reach it. It does not duplicate org-level functionality.

---

## C. TECHNICAL WIRING MATRIX (Submenu / tab level)

| Surface | What it does | Service | Read tables | Write tables | Functional? | Similar screen |
|---|---|---|---|---|---|---|
| Dashboard > status | Org/workforce health overview | dashboardSummaryService | tasks, completed_work, specialist_runs, tenant_subscriptions | — | GREEN (L1) | Ops Centre overview |
| Inbox > Work tab | Awaiting-approval completed work | completedWorkService (direct API) | completed_work | notification_reads (archive) | GREEN (L1) | Notifications, Active Work, Approvals |
| Inbox > Approvals tab | Pending approvals | approvalsService | approvals | notification_reads | GREEN (L1) | Approvals page, Governance |
| Inbox > Knowledge tab | Proposed curation items | knowledgeCurationService | knowledge_curation_jobs | notification_reads | GREEN (L1) | Memory page |
| Inbox > Restore button | Restore archived notification | notificationReadsService | notification_reads | notification_reads | RED (button not rendered — code exists, no JSX) | — |
| Inbox > Conversation item | Unread chat items | — | — | — | RED (item type declared but never added to render list) | Notifications conv-unread |
| Active Work > cards | Combined task+work list | tasks + completedWork API | tasks, completed_work | — | AMBER (cards non-clickable; "detail links future") | Inbox, Notifications, Ops Centre |
| Notifications > mark-read | Read state | notificationReadsService | notification_reads | notification_reads | GREEN (L1) | — |
| Notifications > snooze | Snooze notification | notificationReadsService | notification_reads | notification_reads | GREEN backend / UNPROVEN frontend (not found in UI scan) | — |
| Chat > send message | Conversation + AI execution | messageIngressService → chiefOfStaffOrchestrator → UEE | conversations, conversation_messages | specialist_runs, completed_work, execution_checkpoints | GREEN (L1, L2) | Tasks (same UEE) |
| Chat > create task | Task from conversation | taskService.createTask | conversations | tasks, task_execution_plans | GREEN (L1) | Tasks |
| Chat > stop | Abort in-flight request | Client abort only | — | — | AMBER (client abort only; server-side execution continues) |  — |
| Workforce > browse | Specialist catalogue | specialistCatalogueService | specialist_catalogue, workforce_packs, specialist_dna_profiles | — | GREEN (L1) | Ops Centre specialists tab |
| Workforce > training page | Manage specialist training | specialistTrainingStatusService, knowledgeSourceService | specialist_training_status, knowledge_sources, specialist_language_profiles | same | GREEN (L1) | Library (source management) |
| Operations Centre > dashboard | Aggregated org health | workforceOpsService | specialist_runs, completed_work, tasks, specialist_training_status, knowledge_sources | — | GREEN (L1) | Dashboard, Governance Centre |
| Operations Centre > management actions | Pause/resume/suspend/enable/retrain | workforceOpsService | specialist_queue | specialist_queue, specialist_catalogue | GREEN (L1) | — |
| Tasks > list | Task queue | taskService | tasks, task_execution_plans, task_specialists | — | GREEN (L1) | Active Work |
| Tasks > approve/reject | Approval gate | taskService.transitionTaskState | tasks, approvals | tasks, approvals, approval_history | GREEN (L1) | Approvals page |
| Completed Work > viewer | Work content | completedWorkService | completed_work, completed_work_versions | — | GREEN (L1) | — |
| Completed Work > Quality tab | Self-review scores + claims | completedWorkService, completedWorkClaims | completed_work_versions, completed_work_claims | — | GREEN (L1) | Ops Centre quality metrics |
| Completed Work > Evidence tab | Evidence links and claims | completedWorkService | completed_work_claims, completed_work_evidence_links | — | GREEN (L1) | — |
| Completed Work > approve | Pin approved version | completedWorkService.approve() | completed_work, completed_work_versions | completed_work (approved_version_id), completed_work_versions | GREEN (L1) | Approvals page |
| Completed Work > export PDF/DOCX | Export | completedWorkExportService | completed_work_versions | completed_work_assets (audit) | AMBER (wired; export machinery functional per test; no L4 proof) | — |
| Library > upload | Ingest knowledge source | knowledgeSourceService → ingestionPipelineService | knowledge_sources | knowledge_source_versions, knowledge_chunks, ingestion_jobs | GREEN (L1, L2) | — |
| Memory > approve | Approve AI memory | conversationMemoryService / orgMemoryService | organisation_memory | organisation_memory | GREEN (L1) | — |
| Blueprint Studio > editor | Create/version blueprint | workBlueprintService | work_blueprints, blueprint_versions | same | GREEN (L1) | — |
| Blueprint Studio > sandbox test | Test blueprint via execution | UEE (trigger: task, blueprintId) | blueprint_versions, specialist_runs | completed_work | GREEN (L1) | Tasks (same UEE) |
| Governance > health | Computed health metrics | knowledgeHealthService + completedWorkService | knowledge_sources, completed_work_claims, ingestion_jobs | — | GREEN (L1) | — |
| Approvals > bulk | Batch approve/reject | approvalsService | approvals | approvals, approval_history | GREEN (L1) | — |
| Platform > Runtime > knowledge providers | Provider status | FutureProviders | — | — | RED — intentional stubs ("Not yet implemented" — `PlatformRuntime.tsx:14`) | — |

---

## D. DUPLICATION MATRIX

| Function | Module A | Module B | Same backend service? | Same DB record? | Same output? | Intentional? | True duplication? | Recommendation |
|---|---|---|---|---|---|---|---|---|
| View awaiting-approval work | Inbox | Notifications | YES | YES (completed_work) | YES | Partially | **YES — UI duplication** | Merge into one surface or give each a unique angle |
| View awaiting-approval work | Inbox | Active Work | YES | YES (completed_work) | YES | Partially | **YES — UI duplication** | Active Work should show execution status, not approval queue |
| View pending approvals | Inbox | Notifications | YES | YES (approvals) | YES | No | **YES — UI duplication** | One canonical approval surface |
| View pending approvals | Inbox/Notifications | Approvals page | YES | YES | YES | YES — Approvals is detailed action surface | SAME CAPABILITY, DIFFERENT DEPTH — acceptable |
| View pending approvals | Inbox/Notifications | Governance Centre | YES | YES | Partial | YES — Governance adds health context | SAME CAPABILITY, DIFFERENT ENTRY — acceptable |
| Mark read/archive notification | Inbox | Notifications | YES | YES (notification_reads) | YES | No | **YES — functional duplication** | Merge Inbox and Notifications |
| Execute AI work | Chat | Tasks | YES (UEE) | YES (specialist_runs, completed_work) | YES | YES — different entry point style | SAME CAPABILITY, DIFFERENT ENTRY — intentional | Document clearly |
| Execute AI work | Tasks | Blueprint Studio test | YES (UEE, trigger:task) | YES (completed_work) | YES | YES — Blueprint Studio test is sandboxed | SAME CAPABILITY, DIFFERENT CONTEXT — acceptable |
| View completed work list | Active Work | Completed Work Portal | YES | YES (completed_work) | Partial (Active Work is status; Portal is repository) | Partial | MODERATE OVERLAP — purpose distinction exists but unclear to user | Clarify Active Work = in-flight monitor; Portal = permanent repository |
| View completed work list | Inbox | Completed Work Portal | YES | YES | Partial | Partial | MODERATE OVERLAP | Inbox should not duplicate Portal list; Inbox = items needing action |
| Specialist quality/performance data | Operations Centre | Completed Work (Quality tab) | Partial | YES (completed_work_versions) | Partial | Partial | MODERATE OVERLAP — Ops Centre is aggregate; Work viewer is per-item | Acceptable — different granularity |
| Org health summary | Dashboard | Governance Centre | Partial | Partial | No — different framing | YES | SAME CAPABILITY, DIFFERENT DEPTH — acceptable | — |
| Approval workflow | Approvals page | Inbox | YES | YES (approvals) | Partial | YES — Approvals is action surface | SAME CAPABILITY, DIFFERENT ENTRY — acceptable | — |
| Memory item listed | Memory page | Governance Centre | YES (partial — both use org memory) | YES | Partial | YES — Governance shows health, Memory is CRUD | SAME CAPABILITY, DIFFERENT DEPTH — acceptable | — |
| Knowledge proposals listed | Inbox | Notifications | YES (curation API) | YES (knowledge_curation_jobs) | YES | No | **YES — UI duplication** | Merge Inbox + Notifications |
| Memory nav item | KNOWLEDGE section | GOVERNANCE section | YES — same path and component | YES | YES | No | **NAV DUPLICATION BUG** | Remove from one section |

---

## E. EXECUTION TOPOLOGY

```
USER REQUEST ENTERS VIA ONE OF THESE ENTRY POINTS:
═══════════════════════════════════════════════════

[Chat message]                    [Task creation]              [Blueprint Studio test]
WorkforceChatPage.tsx             TaskCentrePage.tsx           BlueprintEditorPage.tsx
POST /conversations/:id/messages  POST /tasks                  POST /blueprints/:id/test
↓                                 ↓                            ↓
messageIngressService             taskService.createTask()     (same as task path, blueprintId set)
↓                                 ↓
chiefOfStaffOrchestrator          taskService.planTask()
↓                                 ↓ (if approved)
executionCoordinatorService ←─────taskService.dispatchReadyRunsByTask()
            ↓
            executionCoordinatorService.dispatchWorkExecution()
            OR
            executionCoordinatorService.coordinateIntentApproval() [if approval needed]
            ↓
            workExecutionPipelineService.executeWork()  ← THIN ADAPTER ONLY
            ↓
┌───────────────────────────────────────────────────────────────┐
│          UNIFIED EXECUTION ENGINE (unifiedExecutionEngine.ts) │
│                                                               │
│  trigger=conversation  OR  trigger=task                       │
│                                                               │
│  SHARED STEPS FOR BOTH:                                       │
│  1. checkExecutionReadiness() — block archived/pending DNA    │
│  2. Resolve evidence via ResourceRegistry                     │
│     (ALWAYS attempted for conversation; task gates on plan)   │
│  3. Open ExecutionSession                                      │
│  4. Build CanonicalExecutionContext                           │
│  5. createAIGateway().process() — LLM call (GPT-4o)          │
│  6. Parse output {content, claims}                            │
│  7. completedWorkService.createDraft()                        │
│                                                               │
│  EXPENSIVE PATH (only if evidenceMode != "none" AND evidence) │
│  8. classifyEvidenceMode(blueprint) → required/optional/none  │
│  9. shouldRunClaimProvenance() → boolean                      │
│  10. validateClaimBatch() + rejectCrossTenantChunks()         │
│  11. performAbsenceVerificationBatch() [async]                │
│  12. persistProvenanceChain() [async]                         │
│                                                               │
│  13. submitForApproval() — draft → awaiting_approval          │
│  14. closeSession() → return SpecialistRunResult              │
└───────────────────────────────────────────────────────────────┘
            ↓
    completedWork DB record
            ↓
    notification_reads / SSE events → user notified

AUTO-DISPATCH PATH (no user action):
Chat classifies message with confidence ≥ 0.85 + shouldCreateTask
→ autoDispatchService → conversationService.createTask() → taskService → UEE
(same execution path as manual task creation)

ORPHAN RECOVERY:
executionCoordinatorService.recoverOrphanedExecutions()
→ requeues dispatched execution_intents stale >10 minutes
→ same UEE path

CHECKPOINT RESUME:
executionCoordinatorService.resumeFromCheckpoint()
→ same UEE with checkpointData
```

### Verdict: ONE execution architecture, multiple entry points

There is a **single canonical execution architecture** (`unifiedExecutionEngine`). `workExecutionPipelineService` is a documented thin adapter (not a second engine). `endToEndWorkflowService` is explicitly deprecated with no live callers. The architecture is convergent.

---

## F. DATABASE OWNERSHIP MAP

| Table | Canonical owner | Writers | Readers | Purpose | Possible duplication |
|---|---|---|---|---|---|
| `tasks` | taskService | taskService, executionCoordinatorService | taskService, workforceOpsService, activeWork | Task lifecycle state machine | — |
| `task_execution_plans` | taskService (planTask) | taskService | UEE, taskService | Stores specialist + blueprint plan for a task | — |
| `task_specialists` | taskService | taskService | taskService | Links specialists to tasks | — |
| `completed_work` | completedWorkService | completedWorkService | completedWorkService, workforceOpsService, ActiveWork, Inbox, Notifications | Canonical professional output record | — |
| `completed_work_versions` | completedWorkService | completedWorkService | completedWorkService, viewer, export | Versioned content | — |
| `completed_work_claims` | claimPersistenceService (via UEE) | claimPersistenceService | completedWorkService (quality tab) | Evidence claims with provenance | — |
| `completed_work_evidence_snapshots` | evidencePersistenceService | evidencePersistenceService | completedWorkService | Chunk snapshots at time of retrieval | — |
| `completed_work_evidence_links` | evidencePersistenceService | evidencePersistenceService | completedWorkService | Links claims to chunks | — |
| `completed_work_claim_evidence` | evidencePersistenceService | evidencePersistenceService | completedWorkService | Claim↔evidence join | — |
| `completed_work_assets` | completedWorkService | completedWorkService, exportService | completedWorkService | Attachments + export audit | Overlaps with evidence links for attachments |
| `completed_work_comments` | completedWorkService | completedWorkService | completedWorkService | Threaded comments | — |
| `specialist_runs` | specialistRunService | UEE, specialistRunService | workforceOpsService, specialistRunService | Record of each specialist execution | — |
| `specialist_queue` | specialistQueueService | taskService, workforceOpsService | specialistQueueService | Execution queue | — |
| `specialist_run_memory` | specialistRunService | UEE | chiefOfStaffService | Per-run memory context | Overlaps with `organisation_memory` (different scope) |
| `execution_intents` | executionCoordinatorService | executionCoordinatorService | executionCoordinatorService, autoDispatchService | Durable intent records for approval/dispatch | Overlaps with tasks (both represent "work to do") |
| `execution_checkpoints` | executionCheckpointService | UEE | executionCoordinatorService | Durable execution state for resume | — |
| `execution_actions` | executionActionLifecycleService | executionActionDispatcherService | executionInspectorService | Connector write operations | — |
| `conversations` | conversationService | conversationService, messageIngressService | conversationService, chiefOfStaffOrchestrator | Chat threads | — |
| `conversation_messages` | conversationService | messageIngressService | conversationService | Chat messages | — |
| `conversation_memory` | conversationMemoryService | conversationMemoryService | chiefOfStaffService | Per-conversation AI memory | Overlaps with `organisation_memory` (different scope) |
| `organisation_memory` | orgMemoryService | chiefOfStaffService, conversationLearningService | chiefOfStaffService | Persistent org-level AI memory | — |
| `approvals` | approvalsService | taskService, completedWorkService, approvalsService | approvalsService, Governance, Approvals page | Approval records | — |
| `notification_reads` | notificationReadsService | notificationReadsService | notificationReadsService | Per-user read/archive/snooze state for synthetic IDs | NOTE: IDs are synthetic — no notification content table |
| `knowledge_sources` | knowledgeSourceService | knowledgeSourceService | knowledgeSourceService, orgLibraryPresenceService, workforceOpsService | Library document sources | — |
| `knowledge_chunks` | ingestionPipelineService | ingestionPipelineService | hybridRetrievalService, knowledgeResolutionService | Vectorised knowledge | — |
| `work_blueprints` / `blueprint_versions` | workBlueprintService | workBlueprintService | UEE, workforceOpsService, TaskCentrePage | Work templates | — |
| `audit_log` | auditService | auditService (called from many services) | auditService, AuditPage | Organisation audit events | Three audit tables: audit_log, org_audit_log, platform_audit_log (scope separation, not true duplication) |

### Notable overlap: `execution_intents` vs `tasks`

Both represent "work that needs to be done." `execution_intents` live inside the execution coordinator as durable dispatch records; `tasks` live in the task state machine. A task dispatch creates an `execution_intent`; they are two separate records for the same unit of work. This is not dangerous (they serve different lifecycle roles) but adds complexity. L1 evidence.

### Notable overlap: three audit tables

`audit_log`, `org_audit_log`, `platform_audit_log` exist as separate tables. The separation is by scope (org events vs platform events). The org route (`routes/v1/orgAudit.ts`) has a legacy fallback that reads `audit_log` when `org_audit_log` is empty — indicating migration in progress. L1 evidence.

---

## G. SIX USER JOURNEY TRACES

### J1 — SIMPLE EMAIL: "Write an email reminding the team that timesheets are due Friday."

```
User types in Chat → POST /conversations/:id/messages
→ messageIngressService → chiefOfStaffOrchestrator
→ capabilityIdentificationService: no policy/incident/compliance keywords
  → classifies as general_information
→ capabilityGateService: no gate (general_information not capability-gated)
→ conversationContextBuilder (Round 1: memory, workforce)
  → extractDocumentSearchTerms: "timesheets" — no document-suffix keywords found → no library query
→ UEE trigger=conversation
  → checkExecutionReadiness() — CoS eligible
  → ResourceRegistry.resolveEvidenceForConversation()
    ← PROBLEM: retrieval is ALWAYS attempted for conversation trigger
    → evidencePack likely empty (no relevant chunks)
  → buildCanonicalExecutionContext()
  → createAIGateway().process() — LLM call (1 LLM call)
  → parse output {content, claims}
  → completedWorkService.createDraft()
  → classifyEvidenceMode(null/no blueprint) → "optional"
  → shouldRunClaimProvenance(optional, []) → FALSE (empty evidence)
  → *** PROVENANCE MACHINERY SKIPPED *** ✓
  → submitForApproval() → awaiting_approval
→ SSE: agent_message + done
→ User sees response in chat

UNNECESSARY OPERATIONS:
- KRS retrieval attempted even though no document terms extracted (evidence empty, so harmless but wasted)
- Completed Work record created for a simple email (every Chat response becomes a Completed Work draft)
- submitForApproval() called — email now shows in user's approval queue

LLM calls: 1 (main generation)
KRS retrieval: attempted, empty result
DB writes: completed_work, completed_work_versions, execution_checkpoints, specialist_runs, conversation_messages
Evidence/claim processing: SKIPPED ✓
LIGHT PATH: Mostly — except Completed Work creation for a transient email is heavy
```

### J2 — BUSINESS TASK: "Prepare a staff onboarding checklist."

```
Same chat path as J1.
→ capabilityIdentificationService: "checklist", "onboarding" — may score but likely general_information unless threshold crossed
→ UEE trigger=conversation
→ KRS retrieval attempted (library presence check if doc terms found; "onboarding checklist" unlikely to match doc-suffix patterns)
→ LLM generates checklist content
→ completedWorkService.createDraft()
→ evidenceMode: optional (no blueprint)
→ shouldRunClaimProvenance: FALSE (empty evidence)
→ Completed Work created → submitForApproval()

UNNECESSARY: Again a full Completed Work record + approval queue entry for a checklist.
The approval requirement for every output creates friction for lightweight requests.

LLM calls: 1
KRS retrieval: attempted (empty unless library has onboarding docs)
DB writes: completed_work, completed_work_versions, specialist_runs
Evidence/claim: SKIPPED ✓
```

### J3 — EVIDENCE-HEAVY POLICY TASK (via Chat): "Review our Complaints Management Policy and identify gaps."

```
Chat → messageIngressService → chiefOfStaffOrchestrator
→ capabilityIdentificationService: "complaints", "policy", "review", "gaps"
  → scores high → professional_analysis or execution level
  → workforceViolationDetected check → operations_manager selected
→ conversationContextBuilder:
  → extractDocumentSearchTerms: "Complaints Management Policy" → doc-suffix match → library presence query
→ UEE trigger=conversation, specialist=operations_manager
→ ResourceRegistry.resolveEvidenceForConversation()
  → KRS (hybridRetrievalService) fetches relevant chunks
  → evidencePack non-empty
→ buildCanonicalExecutionContext() with evidencePack
→ createAIGateway().process() — LLM generates {content, claims}
→ completedWorkService.createDraft()
→ classifyEvidenceMode(blueprint) — if blueprint requires evidence: "required"
  → shouldRunClaimProvenance(required, evidencePack) → TRUE
→ validateClaimBatch() + rejectCrossTenantChunks()
→ [async] performAbsenceVerificationBatch()
→ [async] persistProvenanceChain() → completed_work_claims, evidence_snapshots, evidence_links
→ submitForApproval()
→ selfReviewService (10 dimensions)
→ Completed Work record with claims, quality scores, evidence

FULL DEEP PATH ✓ — all evidence machinery runs correctly for this task type.

LLM calls: 2+ (main generation + self-review + possibly absence verification sub-calls)
KRS retrieval: YES
DB writes: completed_work + versions + claims + evidence_snapshots + evidence_links + claim_evidence
Evidence/claim: FULL PIPELINE ✓
```

### J4 — DIRECT SPECIALIST REQUEST (via Workforce page): Same policy review

```
WorkforcePage → user selects Operations Manager → "Review our Complaints Management Policy"
→ POST /conversations/:id/messages (same Chat endpoint, with specialist context)
OR
→ POST /tasks (explicit task creation with specialist pre-selected)

EITHER PATH → taskService → UEE trigger=task, specialist=operations_manager
→ UEE.executeTask()
  → reads task_execution_plans → gets primarySpecialist
  → same evidence resolution via ResourceRegistry.resolveEvidenceForTask()
  → same LLM generation
  → same completedWorkService.createDraft()
  → same evidenceMode/provenance gate

VERDICT: YES — Converges on same UEE and same Completed Work architecture as J3 ✓
The only difference is trigger=task vs trigger=conversation (different readiness check path in UEE)
but the output is identical.
```

### J5 — TASK CREATED FROM CHAT

```
User in Chat: discusses onboarding checklist
→ chiefOfStaffOrchestrator detects task intent (confidence ≥ 0.85)
→ autoDispatchService OR user clicks "Create Task" card
→ POST /conversations/:id/create-task
→ taskService.createTask() — new task record created
→ conversationService.linkConversationToTask() — conversation linked to task
→ task enters state machine: queued → planning → awaiting_approval → approved → executing
→ taskService.dispatchReadyRunsByTask() → executionCoordinatorService → UEE

IMPORTANT: The original Chat conversation does NOT execute again.
Chat → Task transfer is a HANDOFF, not duplication.
The conversation is linked (not re-executed).
Execution happens once, through taskService → UEE.

RISK: If autoDispatch fires AND user manually clicks "Create Task",
could two tasks be created for the same conversation turn?
→ autoDispatch uses `conv.primaryTaskId` idempotency guard — only fires if no primaryTaskId.
→ Manual create-task always creates a new task (no idempotency).
→ POTENTIAL for two tasks from the same conversation message if autoDispatch AND manual creation both fire.
Evidence level: L1 (code inspection). L4 unproven.
```

### J6 — COMPLETED WORK REVISION

```
User opens CompletedWorkViewer → clicks "Request Revision"
→ POST /completed-work/:id/revision (or /reopen if rejected)
→ completedWorkService.revision() → creates new completed_work_versions record
  → status: draft (parent remains, new version created)
→ Does NOT create a new completed_work parent record ✓
→ Revision is versioned correctly under the same work item ✓

VERDICT: Revision correctly creates a new VERSION, not a new Completed Work record.
No dangerous duplication at the DB level.

Edge case: if user also starts a new Chat conversation about the same topic,
a second independent completed_work record WILL be created.
There is no cross-reference between the original work item and a new chat about the same topic.
Evidence level: L1.
```

---

## H. PERFORMANCE / OVER-ENGINEERING FINDINGS

| Finding | Severity | Where | Impact |
|---|---|---|---|
| **KRS retrieval always attempted for conversation trigger** | MEDIUM | `unifiedExecutionEngine.ts:461–472` | For simple requests ("write an email"), retrieval is attempted even when no document terms exist. If `extractDocumentSearchTerms` returns empty, library presence is skipped (good) but `resolveEvidenceForConversation` still runs. Evidence pack likely returns empty (low compute) but is not short-circuited before the call. | 
| **Every Chat response creates a Completed Work record** | HIGH | `UEE:1085–1129` | A one-sentence reply to "what time is it" creates a `completed_work` row, a `completed_work_versions` row, a `specialist_runs` row, and calls `submitForApproval()`. This means the user's Inbox/Approvals fills with trivial outputs. There is no "lightweight output" type — all conversation responses are Completed Work. |
| **submitForApproval() fires for every response by default** | HIGH | `UEE:1223–1244` (`outputRequiresApproval !== false`) | Default is true — every output requires approval. For a simple email, this creates an unnecessary approval workflow item. `outputRequiresApproval` can be set per-blueprint but is true for all conversation-triggered (non-blueprint) executions. |
| **No pre-UEE lightweight vs complex routing** | HIGH | `workExecutionPipelineService → UEE` | The same execution pipeline handles "write an email" and "review our complaints management policy". Evidence mode gates the expensive provenance machinery correctly, but the full UEE setup (context building, session creation, LLM call, Completed Work creation, approval submission) runs for all requests. |
| **LLM classification runs on top of deterministic classification** | LOW | `capabilityIdentificationService.ts:87–96` | If AI_PROVIDER is OpenAI and deterministic matches exist, an additional LLM classification call runs. For most requests this is redundant — the deterministic classifier is strong enough. |
| **Orphan recovery polls on every execution** | LOW | `executionCoordinatorService.recoverOrphanedExecutions()` | Runs on every dispatch path. For high-throughput orgs this could trigger expensive intent queries frequently. Low risk at current scale. |
| **Three audit tables with legacy fallback** | LOW | `routes/v1/orgAudit.ts:61,78` | Legacy fallback reads `audit_log` when `org_audit_log` is empty, indicating schema migration in progress. Adds query complexity. |

---

## I. DEAD / LEGACY FUNCTIONALITY

| Item | Evidence | Location |
|---|---|---|
| `endToEndWorkflowService.ts` | Explicitly marked `@deprecated Sprint 29C — LEGACY / DISCONNECTED`. No live callers. `runMockedWorkflow` has production import guard. | `artifacts/api-server/src/services/endToEndWorkflowService.ts:2–12, 97–118` |
| Legacy `WorkforceBrowser.tsx` | Self-labelled legacy at line 2; supports `coming_soon` pack state only; pack-based browsing replaced by current Workforce page | `artifacts/needsops-web/src/pages/WorkforceBrowser.tsx` |
| Legacy Sprint 0 routes | `App.tsx:331–336` — routes `/dashboard`, `/organizations/:id`, `/system` commented as legacy block | `artifacts/needsops-web/src/App.tsx:331` |
| `/dashboard` orphaned route | AppShell nav doesn't link to `/dashboard`; modern dashboard is at `/app/:slug` (root path) | `App.tsx:331` |
| `FutureProviders.ts` — 8 knowledge providers | All return "not implemented" failures: Desktop Connector, SharePoint, Google Drive, OneDrive, Dropbox, Confluence, Notion, web search | `lib/knowledge/providers/FutureProviders.ts:64–199` |
| Platform Runtime knowledge provider panel | Static stubs with "Not yet implemented" labels | `PlatformRuntime.tsx:14–65, ~320` |
| Inbox Restore button | Code exists (`mutation.restore`) but JSX button not rendered | `ExecutiveInbox.tsx` — restore defined, no rendered button |
| Inbox Conversation item type | `ConversationNotifItem` type declared; never added to rendered list | `ExecutiveInbox.tsx` |
| `specialistContextService.ts:375` legacy loader | Comment: "Legacy context loader (chiefOfStaffOrchestrator compatibility)" | `artifacts/api-server/src/services/specialistContextService.ts:375` |
| `routes/organizations.ts:148–153` | Returns HTTP 410 Gone — deprecated endpoints | `artifacts/api-server/src/routes/organizations.ts:148–153` |
| `runtimeContextService` mock mode | Reports `operationMode: "mock"` when using file connector/runtime fallback | `artifacts/api-server/src/services/runtimeContextService.ts:407, 423` |
| `notification_reads` snooze — no UI | Snooze API endpoint and service fully implemented; no snooze UI found in `NotificationCentrePage.tsx` | L1 |
| Memory duplicate in GOVERNANCE nav | GOVERNANCE_NAV includes `/memory` which links to same page as KNOWLEDGE_NAV | `AppShell.tsx:35` |

---

## J. MODULE OVERLAP SCORES

| Module | Score (0–5) | Overlaps with | Detail |
|---|---|---|---|
| Dashboard | **1** | Governance Centre, Operations Centre | Summary metrics available from both; Dashboard adds no unique function |
| Inbox | **4** | Notifications | Same data sources, same synthetic IDs, same mutations. Only differences: grouping style, mark-read vs archive-only, conv-unread item |
| Active Work | **3** | Inbox, Notifications, Completed Work Portal | Duplicates work listing; cards are non-clickable; "active" work is actually completed_work at draft/awaiting_approval stage |
| Notifications | **4** | Inbox | See above |
| Chat | **1** | Tasks | Same UEE — intentional alternative entry point; Chat is conversational, Tasks is structured |
| Workforce | **2** | Operations Centre | Both display specialist status; Workforce is catalogue browse + training; Ops Centre is operational control |
| Operations Centre | **2** | Workforce, Governance Centre | Ops Centre aggregates quality/alerts from Completed Work; Governance also shows quality; Ops Centre uniquely offers management actions |
| Tasks | **1** | Chat | Same UEE — intentional; Tasks adds explicit lifecycle management Chat cannot do |
| Completed Work | **2** | Active Work, Inbox, Approvals | Work listed in 4+ places; Completed Work is the canonical repository and the only place with full viewer |
| Library | **0** | — | Unique responsibility |
| Memory | **0** | — | Unique responsibility (appears in nav twice but same page) |
| Blueprint Studio | **0** | — | Unique responsibility |
| Governance Centre | **2** | Approvals, Ops Centre | Surfaces approvals, memory, and completed-work health already available elsewhere |
| Approvals | **1** | Inbox, Governance | Approvals is the action surface; Inbox is the alert surface; acceptable separation |
| Platform Console | **0** | — | Unique responsibility (platform-owner only) |

---

## K. RECOMMENDED RESPONSIBILITY BOUNDARIES

Comparing the proposed model from the sprint spec against what the system actually does:

| Module | Proposed | Actual | Recommendation |
|---|---|---|---|
| Dashboard | Overview | Overview ✓ | **KEEP** — correct |
| Inbox | Incoming actionable items | Actionable items + duplicates Notifications | **MERGE Inbox + Notifications** into single "Action Centre" with All/Unread/Archived tabs and type filters. Inbox's date-grouping is better UX; Notifications' mark-read is better functionality. Combine both. |
| Notifications | Alerts | Same data as Inbox | **MERGE into Inbox** (see above) |
| Chat | Conversational entry point | Conversational entry point + creates Completed Work for every response ✓ | **CLARIFY**: Chat responses should become Completed Work only when they represent substantive professional output, not every reply. Needs an "output_type" gate before `createDraft()`. |
| Tasks | Explicit work requests | Explicit work requests with state machine ✓ | **KEEP** — correct and well-implemented |
| Active Work | Work currently executing | Monitor of executing work ← INACCURATE — actually shows `completed_work` records (output), not execution-in-flight | **REFRAME as "Execution Monitor"** — show `specialist_runs` / `execution_intents` at in-flight states, not completed_work records. Or make it link to task details for in-flight work. |
| Workforce | AI workforce configuration | Specialist catalogue + training ✓ | **KEEP** — correct |
| Operations Centre | Operational oversight | Operational oversight + management actions ✓ | **KEEP** — correct; uniquely exposes management actions no other module has |
| Completed Work | Canonical finished artefacts | Canonical finished artefacts ✓ | **KEEP** — correct and well-implemented |
| Platform Console | Platform administration | Platform administration ✓ | **KEEP** — correct |

---

## L. TOP 5 ISSUES BEFORE LAUNCH

### Issue 1 — Inbox and Notifications are the same screen twice (CRITICAL UX)
**Evidence:** Both fetch identical API endpoints, assemble the same synthetic notification IDs, and offer overlapping mutations. Score 4 overlap.  
**Risk:** Users see the same approvals/work items in two places, don't know which is canonical, and may action the same item twice from different screens.  
**Fix (no code change made):** Merge into a single "Action Centre." Notification state management lives in the backend already; only the two frontend pages need consolidation.

### Issue 2 — Every Chat response creates a Completed Work record and requires approval (ARCHITECTURE)
**Evidence:** `UEE:1085–1244`. `outputRequiresApproval` defaults to true for all non-blueprint conversation executions. No output_type gate before `completedWorkService.createDraft()`.  
**Risk:** Inbox, Active Work, and Completed Work Portal fill with trivial transient outputs ("write an email", "draft a short note"). Approval queue becomes noise. Users cannot distinguish substantive work from conversational artefacts.  
**Fix needed (not implemented):** Introduce an `output_type` classification upstream (e.g., `transient_response` vs `substantive_work`) and skip Completed Work creation / approval for transient outputs.

### Issue 3 — No lightweight vs heavy execution routing before UEE (PERFORMANCE / ARCHITECTURE)
**Evidence:** `workExecutionPipelineService.ts:30–66` always delegates to `createUnifiedExecutionEngine().execute()`. Evidence mode gates provenance correctly, but the full pipeline (session creation, context building, LLM call, Completed Work creation, approval submission) runs for all requests.  
**Risk:** A simple "write a polite reminder" and a "review our complaints management policy against ISO requirements" take the same code path. Latency and DB write volume are identical for both.  
**Decision gate missing:** The gate that should exist is: if `capabilityLevel === general_information` AND no document terms extracted AND no blueprint → skip Completed Work creation and approval submission; return a lightweight conversational response only.

### Issue 4 — Active Work shows completed_work records, not active execution (CONCEPTUAL MISMATCH)
**Evidence:** `ActiveWorkPage.tsx` fetches `/completed-work?limit=100` and `/tasks`. Completed Work records represent *finished outputs*, not in-flight execution. "In Progress" tab shows completed_work at draft/awaiting_approval stage alongside tasks at executing.  
**Risk:** Users expect to see "what is running right now" but instead see finished outputs pending review. The module title promises one thing and delivers another.  
**Fix needed:** Active Work should query `specialist_runs` (in-flight), `execution_intents` (dispatched), and `tasks` (executing state) — not `completed_work`.

### Issue 5 — Memory appears twice in the sidebar navigation (UX BUG)
**Evidence:** `AppShell.tsx:KNOWLEDGE_NAV` and `AppShell.tsx:GOVERNANCE_NAV` both contain `{label:"Memory", path:"/memory"}` pointing to the same `OrgMemoryPage`.  
**Risk:** Confusing navigation; implies Memory belongs to both Knowledge and Governance sections, and users may not realise they link to the same page.  
**Fix:** Remove from one nav section (GOVERNANCE is the less appropriate home — Memory is a knowledge artefact, not a governance workflow).

---

## M. TOP 5 THINGS THAT SHOULD REMAIN AS THEY ARE

### 1 — Chat and Tasks as dual entry points to the same UEE (INTENTIONAL DESIGN)
Chat is fluid and conversational. Tasks is structured and lifecycle-managed. Both converge on the same execution engine. This is correct and should be preserved. The multiplicity of entry points is a feature, not duplication, provided the backend execution is unified (it is).

### 2 — The evidence/claim-integrity pipeline as a gated path (CORRECT ARCHITECTURE)
`classifyEvidenceMode` → `shouldRunClaimProvenance` is the right gate. Blueprint-driven evidence mode classification ensures that incident investigations, risk assessments, and policy reviews get full provenance; simple outputs do not. The gate logic should be extended (Issue 3 above) but the pattern itself is sound.

### 3 — Completed Work as the single canonical output store (CORRECT ARCHITECTURE)
All execution paths converge on `completedWorkService.createDraft()`. There is no competing output store (chat does not store work results separately, tasks do not store results separately). This canonical ownership is correct and hard-won; it should not be fragmented.

### 4 — Operations Centre as separate from Workforce (CORRECT SEPARATION)
Workforce = catalogue and configuration. Operations Centre = live operational management and control (pause/resume/retrain, health, workload, alerts). These are genuinely different jobs. Combining them would create an overloaded screen and conflate configuration-time with runtime concerns.

### 5 — Approval workflow as opt-in via blueprint (CORRECT ARCHITECTURE)
`outputRequiresApproval` can be set false per blueprint. The per-blueprint approval control is the right mechanism — a blueprint for "draft a weekly summary" can bypass approval; one for "produce a formal investigation report" should require it. The problem (Issue 2) is that the default for non-blueprint conversation executions is always `true`, not that the mechanism is wrong.

---

## N. EXPLICIT ANSWERS TO QUESTIONS 1–20

**1. What is each major module actually supposed to do?**  
See Part B. Each module has a defined primary responsibility; the boundaries are mostly correct but Inbox/Notifications are redundant and Active Work's framing is misleading.

**2. Are all visible modules technically connected to real backend functionality?**  
Mostly yes. Exceptions: Platform Runtime knowledge provider panel (intentional stubs), Inbox Restore button (no rendered JSX), Inbox Conversation item type (declared but never rendered). All other modules have live API connections. Evidence: L1.

**3. Which modules are fully functional today?**  
GREEN (L1): Chat, Tasks, Completed Work, Workforce, Operations Centre, Library, Memory, Blueprint Studio, Governance, Approvals, Audit, Knowledge Health, Timeline. Platform pages: Organisations, Commercial, Trials, Specialist Ops, Connector Fleet, Catalogue, Pack Builder. Notifications (mostly — snooze UI absent).

**4. Which are only partially functional?**  
AMBER: Active Work (cards non-clickable; "In Progress" shows wrong data type); Inbox (Restore button not rendered; Conversation item not rendered); Platform Runtime (knowledge providers stubbed); Chat Stop (client abort only — server continues executing).

**5. Which contain dead/legacy functionality?**  
`endToEndWorkflowService` (deprecated, no callers), legacy WorkforceBrowser, Sprint 0 legacy routes, FutureProviders (8 stubs), Platform Runtime knowledge panel, `notification_reads` snooze (no UI), Memory duplicate nav entry, HTTP 410 deprecated organisation endpoints.

**6. Where are we doing the same thing twice?**  
Inbox and Notifications (same data, same mutations, different layout). Active Work listing completed-work records that Inbox and Notifications also list. See Part D duplication matrix.

**7. Where do two screens merely provide different entry points to the SAME capability?**  
Chat → Tasks (same UEE execution, different entry style — intentional). Approvals page → Inbox (same approval records, Approvals has bulk actions — intentional depth difference). Blueprint Studio test → Tasks (same UEE, sandboxed context — intentional). Governance → Approvals/Memory (aggregation view vs action view — intentional). These are acceptable.

**8. Are Chat, Tasks, Workforce and Operations Centre all using the same execution architecture?**  
Chat and Tasks: YES — both use UEE via `executionCoordinatorService`. Workforce page: does NOT directly execute — it is a catalogue browser and training manager. Operations Centre: does NOT execute work — it manages and monitors existing specialist runs. Operations Centre management actions (force-retrain) push to `specialist_queue`, which UEE picks up. So the answer is: Chat and Tasks share the same execution architecture. Workforce and Operations Centre observe and configure it, not execute through it. L1 evidence.

**9. Can the same user request accidentally execute twice through different paths?**  
POTENTIAL RISK: If `autoDispatchService` fires on a conversation message (confidence ≥ 0.85) AND the user simultaneously clicks "Create Task" from the proposal card, two task records could be created. `autoDispatch` uses `conv.primaryTaskId` idempotency, but manual task creation does not check `primaryTaskId`. This is unproven at L4 but represents an L1 code risk.

**10. Can the same substantive work produce duplicate Completed Work records?**  
YES — if a user starts a Chat conversation about a topic, gets a Completed Work output, then manually creates a Task for the same topic, two independent `completed_work` records will be created. There is no deduplication or cross-reference between Chat-originated and Task-originated outputs for the same subject matter. L1 evidence.

**11. Is Completed Work genuinely the canonical final output?**  
YES. Proven at L1: all execution paths (Chat → UEE, Task → UEE, Blueprint test → UEE, auto-dispatch → UEE) call `completedWorkService.createDraft()`. There is no alternative output store. Chat does not store work results in the conversation separately. Tasks link to Completed Work via `completed_work.taskId`. L1 evidence; L4 UNPROVEN.

**12. Are Inbox and Notifications meaningfully different?**  
NO. They query the same three data sources, assemble the same synthetic notification IDs, and write to the same `notification_reads` table. The only meaningful differences are: Notifications adds a `conv-unread` aggregate item; Notifications has mark-read/unread; Inbox only has archive. These differences do not justify two separate modules. They should be merged.

**13. Are Tasks and Active Work meaningfully different?**  
Tasks = explicit lifecycle management (state machine, approval gates, planning). Active Work = monitor view of in-flight and recent work. The concept is meaningfully different. The implementation is not — Active Work incorrectly shows `completed_work` (finished output) rather than `specialist_runs` / `execution_intents` (in-flight work). The concept is right; the implementation needs correction.

**14. Are Workforce and Operations Centre meaningfully different?**  
YES. Workforce = specialist catalogue browse + individual training management (configuration-time). Operations Centre = live operational oversight + management actions (runtime). Clear boundary. Score 2 overlap is acceptable — both display specialist status but from different angles (catalogue vs live metrics).

**15. Does Dashboard contain functionality that belongs elsewhere?**  
No. Dashboard is a pure navigation/summary layer with no mutating actions. It is correctly scoped.

**16. Does ordinary lightweight work avoid the evidence/claim-integrity pipeline?**  
PARTIALLY. The evidence/claim provenance pipeline is correctly gated by `classifyEvidenceMode` + `shouldRunClaimProvenance`. A simple email does NOT go through claim validation or absence verification. However, the full UEE setup (session creation, context building, LLM call, Completed Work creation, approval submission) runs for ALL requests — there is no early exit for truly lightweight work. KRS retrieval is always attempted for conversation-triggered execution, even when no document terms are found.

**17. Which functions currently trigger unnecessary LLM calls or retrieval?**  
- KRS retrieval: always initiated for conversation-triggered UEE, even for "write a reminder email." If evidence pack returns empty, provenance is skipped — but retrieval still runs.  
- Optional LLM re-classification: `capabilityIdentificationService` runs a second LLM call on top of deterministic results when AI_PROVIDER=openai and deterministic matches exist.  
- Self-review service runs for all substantive outputs (appropriate for policy work; potentially unnecessary for a simple email draft).

**18. Where are the largest latency risks?**  
1. UEE runs full pipeline for all requests (no lightweight exit path)  
2. KRS retrieval always attempted for conversation-triggered execution  
3. Context builder Round 1 is parallel (good) but Round 2 (action/proposal state) is sequential  
4. Absence verification runs asynchronously (non-blocking — correct)  
5. Self-review adds a second LLM pass for all substantive outputs

**19. What are the top five architectural overlaps to resolve before launch?**  
1. Merge Inbox + Notifications  
2. Add lightweight output path (skip Completed Work creation for transient conversational responses)  
3. Fix Active Work data source (specialist_runs / execution_intents, not completed_work)  
4. Gate submitForApproval() by output type / blueprint setting (not always-on)  
5. Remove Memory from GOVERNANCE nav (nav duplication bug)

**20. What should NOT be changed because the apparent duplication is actually useful?**  
1. Chat AND Tasks as dual entry points to UEE (intentional, serves different user mental models)  
2. Approvals page AND Inbox both surfacing pending approvals (Approvals is for acting; Inbox is for alerting — acceptable depth difference)  
3. Ops Centre AND Completed Work both showing quality metrics (Ops Centre is aggregate/operational; Work viewer is per-item/governance)  
4. Blueprint Studio test AND Tasks both using UEE (sandboxed vs production — intentional context difference)  
5. Three audit tables by scope (org_audit_log, platform_audit_log, audit_log — scope separation, not true duplication)

---

## FINAL VERDICT

### **FUNCTIONAL WITH OVERLAP**

The system works and the execution architecture converges correctly. There is one canonical execution engine (UEE), one canonical output store (Completed Work), and the evidence/claim-integrity pipeline is correctly gated. The platform is not architecturally fragmented.

However, there are four concrete issues that should be addressed before launch:

1. **Inbox and Notifications are the same screen** — true UI duplication, no justification
2. **Every Chat response becomes a Completed Work draft requiring approval** — creates noise in Inbox, Active Work, and the approval queue for lightweight requests  
3. **Active Work shows output records (completed_work), not execution records** — misleading framing breaks user mental model
4. **No lightweight execution path** — "write an email" and "review our compliance policy" run through the same pipeline depth

The first three are user-facing problems that affect day-to-day usability. The fourth is a performance/cost issue that will compound at scale.

Everything else — the execution topology, the DB ownership, the approval mechanism, the evidence pipeline gating, the blueprint system, and the knowledge infrastructure — is sound.
