# Sprint 29N.9 — Full Product & Platform Audit Report

**Audit date:** 9 August 2026  
**Baseline:** 4,959 tests / 0 failures  
**Method:** Static analysis of all web, API, and mobile source code via parallel subagent exploration. No production data was mutated.

---

## Part A — Complete Product Surface Inventory

### Web Application Routes (60 total)

| Path | Component | Guard |
|---|---|---|
| `/` | HomeRedirect (→ `/app-home` or LandingPage) | Clerk signed-in check |
| `/sign-in/*` | SignInPage | — |
| `/sign-up/*` | SignUpPage | — |
| `/onboarding` | OrgOnboarding | Clerk auth |
| `/invitations/:token/accept` | InvitationAccept | — |
| `/app-home` | AppHome | Clerk auth |
| `/app/:slug` | ExecutiveDashboard | Clerk auth + tenant |
| `/app/:slug/inbox` | ExecutiveInbox | Clerk auth + tenant |
| `/app/:slug/active-work` | ActiveWorkPage | Clerk auth + tenant |
| `/app/:slug/notifications` | NotificationCentrePage | Clerk auth + tenant |
| `/app/:slug/chat` | WorkforceChatPage | Clerk auth + tenant |
| `/app/:slug/workforce` | WorkforcePage | Clerk auth + tenant |
| `/app/:slug/workforce-ops` | WorkforceOpsCentre | Clerk auth + tenant |
| `/app/:slug/workforce-ops/:specialistId` | WorkforceSpecialistDetail | Clerk auth + tenant |
| `/app/:slug/tasks` | TaskCentrePage | Clerk auth + tenant |
| `/app/:slug/tasks/:taskId` | TaskWorkroomPage | Clerk auth + tenant |
| `/app/:slug/approvals` | ApprovalsPage | Clerk auth + tenant |
| `/app/:slug/team` | TeamPage | Clerk auth + tenant |
| `/app/:slug/plan` | PlanPage | Clerk auth + tenant |
| `/app/:slug/usage` | UsagePage | Clerk auth + tenant |
| `/app/:slug/settings` | OrgSettings | Clerk auth + tenant |
| `/app/:slug/audit` | AuditPage | Clerk auth + tenant |
| `/app/:slug/library` | OrgLibraryPage | Clerk auth + tenant |
| `/app/:slug/library/:sourceId` | SourceDetailPage | Clerk auth + tenant |
| `/app/:slug/workforce/:specialistId/training` | SpecialistTrainingPage | Clerk auth + tenant |
| `/app/:slug/memory` | OrgMemoryPage | Clerk auth + tenant |
| `/app/:slug/install` | InstallPage | Clerk auth + tenant |
| `/app/:slug/devices` | DevicesPage | Clerk auth + tenant |
| `/app/:slug/discover` | DiscoveryPage | Clerk auth + tenant |
| `/app/:slug/blueprints` | BlueprintStudioPage | Clerk auth + tenant |
| `/app/:slug/blueprints/new` | BlueprintEditorPage | Clerk auth + tenant |
| `/app/:slug/blueprints/:id` | BlueprintDetailPage | Clerk auth + tenant |
| `/app/:slug/blueprints/:id/edit` | BlueprintEditorPage | Clerk auth + tenant |
| `/app/:slug/blueprints/:id/versions` | BlueprintVersionHistoryPage | Clerk auth + tenant |
| `/app/:slug/blueprints/:id/test` | BlueprintTestPage | Clerk auth + tenant |
| `/app/:slug/blueprints/:id/publish` | BlueprintPublishPage | Clerk auth + tenant |
| `/app/:slug/work` | CompletedWorkPortal | Clerk auth + tenant |
| `/app/:slug/work/:id` | CompletedWorkViewer | Clerk auth + tenant |
| `/app/:slug/governance` | GovernanceCentre | Clerk auth + tenant |
| `/app/:slug/governance/knowledge-health` | KnowledgeHealthPage | Clerk auth + tenant |
| `/app/:slug/governance/timeline` | GovernanceTimelinePage | Clerk auth + tenant |
| `/account` | AccountSettings | Clerk auth |
| `/platform` | PlatformDashboard | Platform auth |
| `/platform/organisations` | PlatformOrgs | Platform auth |
| `/platform/organisations/:id` | PlatformOrgDetail | Platform auth |
| `/platform/commercial` | PlatformCommercial | Platform auth |
| `/platform/trials` | PlatformTrials | Platform auth |
| `/platform/workforce` | PlatformWorkforce | Platform auth |
| `/platform/usage` | PlatformUsage | Platform auth |
| `/platform/support` | PlatformSupport | Platform auth |
| `/platform/security` | PlatformSecurity | Platform auth |
| `/platform/audit` | PlatformAudit | Platform auth |
| `/platform/settings` | PlatformSettings | Platform auth |
| `/platform/runtime` | PlatformRuntime | Platform auth |
| `/platform/specialist-ops` | SpecialistOpsPage | Platform auth |
| `/platform/packs` | PlatformPacksPage | Platform auth |
| `/platform/staff` | PlatformStaff | Platform auth |
| `/platform/connector-fleet` | PlatformConnectorFleet | Platform auth |
| `/platform/catalogue` | PlatformCataloguePage | Platform auth |
| `/dashboard` | Dashboard (legacy platform) | Clerk auth |
| `/organizations` | OrganizationsList (legacy) | Clerk auth |
| `/organizations/:id` | OrganizationDetail (legacy) | Clerk auth |
| `/workforce` | WorkforceBrowser (legacy) | Clerk auth |
| `/system` | SystemStatus (legacy) | Clerk auth |

**Unrouted page files (orphans):**
- `src/pages/app/AppDashboard.tsx` — defined in App.tsx but never routed. Legacy dashboard. No navigation path reaches it.
- `src/pages/app/WorkforceBrowser.tsx` — duplicate of root `pages/WorkforceBrowser.tsx`. The non-app version is routed at `/workforce`; this one is not.

**Nav items with no corresponding route:** None found.

---

## Part B — Organisation App Audit

### B.1 Executive Dashboard (`/app/:slug`)

**Intended:** Summary of org operational health — active work, pending decisions, workforce status, knowledge health, recent completions.

**Data sources:**
| Card/section | Endpoint | Service |
|---|---|---|
| CoS Executive Briefing | GET `/v1/organisations/:slug/executive-briefing` | executiveBriefingService |
| Active Work count | GET `.../tasks` (states: executing/planning/queued) + `.../completed-work` (status: draft) | taskService + completedWorkService |
| Pending Decisions count | GET `.../approvals?state=pending` + `.../completed-work` (client-filter: awaiting_approval) | approvalService + completedWorkService |
| Knowledge Health score | GET `.../knowledge/health` | knowledgeHealthService |
| Unread Messages | GET `.../notifications/unread-count` (60s polling) | notificationsService / message_reads |
| AI Workforce | GET `/v1/workforce/specialists` (global catalogue, filtered client-side) | workforceService |
| Recently Completed | GET `.../completed-work?limit=50` (client-filter: status=approved, first 4) | completedWorkService |
| Pending Decisions list | GET `.../approvals?state=pending` + `.../completed-work?awaiting_approval` | — |
| Quick Actions shortcuts | Navigation links only | — |

**Issues:**
- ⚠️ **"Recently Completed" View All routes to `/active-work`** not `/work`. Misrouted shortcut.
- ⚠️ **Pending Decisions count is incomplete**: it counts only system approvals + awaiting_approval work. It misses knowledge curation proposals, memory proposals, library review sources, execution intents, and pack requests — all of which appear in the ApprovalsPage total. A user with 10 pending governance items but 0 system approvals sees "0 Pending Decisions."
- ⚠️ **Workforce metric = global catalogue availability**, not org-specific activity. A specialist shown as "Available" may not have been configured for this org.
- ℹ️ Active Work count correctly combines active tasks + active specialist runs + dispatched intents.

### B.2 Inbox (`/app/:slug/inbox`) — ExecutiveInbox

**Intended:** Actionable items only — work awaiting approval, pending approvals, proposed knowledge curation.

**Data:** GET `.../completed-work` (client-filter: awaiting_approval) + GET `.../approvals?state=pending` + GET `.../knowledge/curation/proposals?status=proposed&limit=20` + notifications state.

**Status:** GREEN. Semantics are clean — Inbox is actionable only, approved/informational items are removed. Approve/reject actions exist, invalidate cache, and navigate away.

### B.3 Active Work (`/app/:slug/active-work`) — ActiveWorkPage

**Intended:** All currently executing work.

**Data:** GET `.../active-executions` — aggregates tasks (queued/planning/executing/awaiting_approval), specialist runs (created/claimed/running/waiting_for_runtime), dispatched execution intents. Polls every 30 seconds.

**Issues:**
- ⚠️ **Polling only — no real-time.** Execution completing during a session takes up to 30 seconds to leave the list.
- ⚠️ **`awaiting_approval` tasks appear in Active Work** because that is a valid task state included in the endpoint query. A user may see work in both Active Work and Inbox simultaneously.
- No active-work empty state for "never had any executions" vs "all executions completed."

### B.4 Notifications (`/app/:slug/notifications`) — NotificationCentrePage

**Intended:** Informational event stream — approved work, system messages.

**Data:** GET `.../completed-work?limit=50` (client-filter: approved) + GET `.../notifications/unread-count` + GET `.../notifications/state`. Actions: mark read/unread, archive, restore.

**Issues:**
- 🔴 **Snooze: API endpoint exists** (`POST .../notifications/snooze`) **but no UI control.** The Notification Centre has no snooze button. The `snoozedUntil` field is stored in `notification_reads` but the page's visible-item filter ignores it entirely. Snoozed notifications reappear immediately on next render. (Known defect — Task #57 proposed.)
- ⚠️ Notification mutation handlers (mark-read, archive) have no `onError` path — silent failure if server errors.

### B.5 Workforce Chat (`/app/:slug/chat`) — WorkforceChatPage

**Intended:** Primary interface for conversational interaction with AI workforce.

**Data:** GET/POST conversations, SSE streaming, task creation from chat proposals.

**Status:** GREEN. SSE streaming, conversation history, task creation, clarification resume all wired. Messages sent to CoS → 3-lane classifier → response.

### B.6 Workforce (`/app/:slug/workforce`) — WorkforcePage

**Intended:** Browse AI workforce catalogue.

**Data:** GET `.../workforce-packs` + GET `.../workforce/specialists`.

**Issues:**
- ⚠️ **Activate/deactivate is not available here.** Must navigate to WorkforceSpecialistDetail (`/workforce-ops/:id`) via Operations Centre. The WorkforcePage has no mutation controls — catalogue view only. A user going to "Workforce" in the nav cannot activate a specialist from that page.

### B.7 Operations Centre (`/app/:slug/workforce-ops`) — WorkforceOpsCentre + WorkforceSpecialistDetail

**Intended:** Operational management of specialists — activate/deactivate, performance, readiness, workload, knowledge.

**Data/mutations:** POST `.../workforce-ops/:code/actions` (activate/deactivate), GET readiness/performance/knowledge. Errors surfaced, cache invalidated on success.

**Status:** GREEN. Actions are fully wired with response handling and invalidation.

### B.8 Tasks (`/app/:slug/tasks`, `/app/:slug/tasks/:taskId`) — TaskCentrePage + TaskWorkroomPage

**Intended:** Task management, workroom for in-progress tasks, clarification submission.

**Data:** GET `.../tasks` (org-scoped). TaskWorkroomPage: GET task detail + GET specialist runs + POST clarifications + SSE task events.

**Status:** GREEN. Task creation (via chat proposal), detail view, clarification submission all wired.

### B.9 Completed Work (`/app/:slug/work`) — CompletedWorkPortal + CompletedWorkViewer

**Intended:** Portal to all completed work; viewer with approval, quality review, version integrity, and export.

**Data:** GET `.../completed-work` (no status filter — shows all statuses including draft/awaiting_approval).

**Issues:**
- 🔴 **PDF/DOCX export returns 404.** CompletedWorkPortal calls `GET .../completed-work/:id/export?format=pdf` and `format=docx`. This endpoint is **not registered** in the API route tree. Downloads will fail. The UI has a DownloadMenu component with both options fully built; the API route does not exist.
- ⚠️ CompletedWorkPortal fetches all statuses — a draft or in-progress item appears in the portal alongside approved items. No visual distinction for "in progress" items in the portal list is confirmed.
- ✅ Approved version pinning: `approved_version_id` FK is set on approve; viewer resolves pinned version with fallback for legacy items; integrity banner shown when newer revision exists.
- ✅ Approval action (approve/reject) is wired — sets status, updates approved_version_id, triggers notification.

### B.10 Library (`/app/:slug/library`) — OrgLibraryPage + SourceDetailPage + SpecialistTrainingPage

**Intended:** Knowledge source management — upload, ingestion, specialist assignment, approval workflow.

**Data/mutations:** GET `.../knowledge/sources`, POST upload, POST `.../knowledge/sources/:id/approve`, GET `.../knowledge/sources/:id` (detail), GET `.../knowledge/sources/:id/chunks`, POST training scoping.

**Status:** GREEN. Upload → ingestion → approval pipeline wired. Specialist training scoping and approval workflow functional.

**Note:** Library nav is hidden for viewer/auditor roles (correctly scoped in AppShell).

### B.11 Memory (`/app/:slug/memory`) — OrgMemoryPage

**Intended:** Organisation memory management — proposed memory from CoS interactions, approval/rejection/correction/pinning.

**Data:** GET `.../memory` (all statuses). Mutations: approve, reject, pin, merge, retire (PATCH status).

**Issues:**
- ⚠️ **UI shows action buttons regardless of viewer role on direct URL.** OrgMemoryPage renders all action buttons without inspecting the user's role. API correctly enforces owner/administrator. But a manager, member, or viewer navigating directly to `/app/:slug/memory` would see approve/reject buttons that 403 on click. Nav correctly hides Memory for non-owner/administrator, but route is not gated.
- ⚠️ **`requireOwnerOrAdmin` in organisationMemory.ts has role-string drift** — the local helper still accepts the legacy `"admin"` string alongside `"administrator"`. The canonical middleware requires only `"administrator"`.

### B.12 Blueprint Studio (`/app/:slug/blueprints`) — All Blueprint pages

**Intended:** Create, version, test, publish, archive work blueprints.

**Data/mutations:** GET `.../work-blueprints`, POST create, PATCH edit, POST test, POST publish, POST archive/restore/clone.

**Issues:**
- ⚠️ **Blueprint Studio is nav-only gated.** App.tsx declares `/app/:slug/blueprints` routes without a role guard. The API routes must be the security boundary. Direct URL access by any authenticated org member renders the Blueprint Studio.
- ✅ All CRUD operations appear wired with response handling and cache invalidation.

### B.13 Governance (`/app/:slug/governance`) — GovernanceCentre + subpages

**Intended:** Central governance hub — links to Approval Centre, Knowledge Review, Memory Governance, Knowledge Health, Timeline, Audit Log.

**Status:** GovernanceCentre is a navigation hub with no mutations of its own. All actions delegate to appropriate subpages. 

**Knowledge Health:** GET `.../knowledge/health` → `knowledgeHealthService.computeHealthScore`. Score reflects source count, processing status, curation quality. **GREEN.**

**Timeline:** GET `.../audit` + governance events. **GREEN.**

### B.14 Approvals (`/app/:slug/approvals`) — ApprovalsPage

**Intended:** Unified approval queue — knowledge proposals, memory proposals, library sources, completed work, system approvals, execution intents, pack requests.

**Issues:**
- ⚠️ **UI renders approve/reject buttons without a role check.** ApprovalsPage does not inspect the user's role. AppShell hides Approvals for member/viewer, but a direct URL to `/app/:slug/approvals` would render all action buttons for any authenticated org member. API protects, but UX is misleading.
- ⚠️ **Bulk approvals**: POST `/approvals/bulk` is wired (server-batched). The UI has a bulk-select mode; confirmed working.
- ✅ Each approval category's action invalidates all approval feed keys on success.

### B.15 Audit Log (`/app/:slug/audit`) — AuditPage

**Status:** GREEN. Reads org audit events; correctly gated to owner/administrator/auditor in nav.

### B.16 Team (`/app/:slug/team`) — TeamPage

**Data/mutations:** GET `.../members`, POST invite, DELETE remove, PATCH role change, GET invitations, DELETE revoke invitation.

**Status:** GREEN. All mutations wired. Role change uses canonical "administrator" role string.

### B.17 Plan (`/app/:slug/plan`) — PlanPage

**Intended:** View current subscription, entitlements, seat usage, workforce packs.

**Data:** GET `.../subscription`, GET `.../entitlements`, GET `.../seats`, GET `.../workforce`.

**Mutations:** None. **INTENTIONALLY READ-ONLY** for org users.

**Status:** GREEN (correctly read-only; platform controls plan/trial).

### B.18 Usage (`/app/:slug/usage`) — UsagePage

**Data:** GET `.../usage`.

**Fields returned:** `conversationMessages`, `llmRequests` (count only — no token detail), `specialistExecutions`, `tasks`, `completedWork`, `knowledgeSources`, `seats`.

**Issues:**
- ⚠️ **LLM token usage is not tracked in any DB table.** `llmRequests` is a count, not a token sum. In-memory stats only. An org cannot see how many tokens were consumed.

### B.19 Settings (`/app/:slug/settings`) — OrgSettings

**Mutations:** PATCH `/v1/organisations/:slug` — org name, settings payload.

**Issues:**
- ⚠️ **No `onError` handler** for failed save. A network error or 403 silently fails; UI shows no error. Success shows "Saved" for 2 seconds and invalidates org cache.

### B.20 Account Settings (`/account`) — AccountSettings

**Status:** GREEN. Clerk-managed profile settings.

---

## Part C — Dashboard Audit

### ExecutiveDashboard metric-by-metric trace

| Metric | Source endpoint | DB table | Canonical? | Issue |
|---|---|---|---|---|
| Active Work count | `.../tasks` + `.../completed-work` (client) | tasks + completed_work | Partially — tasks are active states; includes draft completed_work | AMBER — conflates task states and completed_work drafts |
| Pending Decisions count | `.../approvals?state=pending` + `.../completed-work` (client) | approvals + completed_work | NO — misses curation/memory/library/intents/packs | RED — unrepresentative of total pending governance load |
| Knowledge Health score | `.../knowledge/health` | org_knowledge_sources + curation tables | YES | GREEN |
| Unread Messages | `.../notifications/unread-count` (60s poll) | conversation_messages + message_reads | YES — same source as AppShell badge | GREEN |
| AI Workforce list | `/v1/workforce/specialists` (global catalogue) | workforce catalogue | NO — global catalogue, not org-specific activity | AMBER — shows catalogue availability, not configured specialists |
| Recently Completed (4 items) | `.../completed-work` (client-filter: approved) | completed_work | YES | GREEN — but "View All" routes to `/active-work` instead of `/work` |
| CoS Briefing | `.../executive-briefing` | — (LLM-generated) | YES | GREEN |
| Connector status | Derived from device heartbeat in component | platform_devices | YES | GREEN |

**Hard-coded/static elements:** Date/time (client clock), threshold labels (≥80 Strong, ≥60 Satisfactory), display limits (4 items, 50 limit), polling intervals (30s/60s), all empty-state strings.

**Dashboard shortcuts routing:**
- "Start New Work" → `/app/:slug/chat` ✅
- "AI Workforce" → `/app/:slug/workforce` ✅
- "Active Work" → `/app/:slug/active-work` ✅
- "Organisation Library" → `/app/:slug/library` ✅
- "Approvals" → `/app/:slug/approvals` ✅
- **"View All" for Recently Completed → `/app/:slug/active-work`** ❌ (should be `/app/:slug/work`)

**Legacy AppDashboard.tsx:** Component exists in source but has no route in App.tsx. Completely orphaned. Cannot be reached by any user or navigation. Should be deleted.

---

## Part D — Task / Chat / Active Work / Completed Work Continuity

**Workflow trace:**

```
Chat (WorkforceChatPage)
  → CoS classifies as PROFESSIONAL_WORK
  → task_proposal SSE event
  → UI shows task proposal card
  → User approves
  → POST /execution-intents (dispatched status)
  [appears in Active Work as dispatched intent ✅]
  → executionCoordinatorService.coordinateIntentApproval()
  → UnifiedExecutionEngine.execute()
  → Task transitions: queued → planning → executing
  [task appears in Active Work ✅]
  → createDraft() → completed_work row (status: draft)
  [NOT in Active Work — Active Work doesn't query completed_work ✅]
  → submitForApproval() → status: awaiting_approval
  [appears in Inbox awaiting-approval section ✅]
  [appears in Active Work as task state awaiting_approval ⚠️ simultaneous]
  → User approves via Inbox or ApprovalsPage
  → status: approved; approved_version_id set
  → Notification event → appears in Notifications (informational) ✅
  → Appears in Completed Work portal ✅
  → "View Work" → CompletedWorkViewer → loads pinned approved version ✅
  → PDF/DOCX download → 404 ❌ endpoint missing
```

**ID/relationship integrity:** Task → completed_work FK confirmed. Approved version → approved_version_id FK confirmed. Viewer resolves pinned version with legacy fallback. Evidence citations and quality review persisted with version.

**Key continuity findings:**
- ✅ Chat-created task appears in Tasks
- ✅ Active execution appears in Active Work (within 30s polling)
- ✅ When task reaches terminal state, leaves Active Work on next poll
- ⚠️ `awaiting_approval` task state appears simultaneously in Active Work and Inbox — user may be confused
- ✅ Corresponding Completed Work appears in portal
- ✅ Approval changes status correctly and pins version
- ✅ Notifications receives informational event after approval
- ✅ View Work opens correct pinned version
- 🔴 PDF/DOCX export returns 404 — endpoint not implemented in API routes

---

## Part E — Button / Action Matrix

| UI Action | Status | API Endpoint | Notes |
|---|---|---|---|
| Chat message send | WORKING | POST `.../conversations/:id/messages` + SSE | — |
| Create Task (from proposal) | WORKING | POST `.../execution-intents` | — |
| Submit clarification | WORKING | POST `.../specialist-runs/:id/clarification` | — |
| Approve completed work | WORKING | POST `.../completed-work/:id/approve` | Pins version, updates status |
| Reject completed work | WORKING | POST `.../completed-work/:id/reject` | — |
| Request revision | WORKING | POST `.../completed-work/:id/reject` (status: revision_requested) | — |
| View Work (CTA) | WORKING | GET `.../completed-work/:id` | Opens viewer |
| **Download PDF** | **BROKEN** | GET `.../completed-work/:id/export?format=pdf` | **Endpoint does not exist in API — 404** |
| **Download DOCX** | **BROKEN** | GET `.../completed-work/:id/export?format=docx` | **Endpoint does not exist in API — 404** |
| Upload knowledge source | WORKING | POST `.../knowledge/sources` + multipart | Ingestion pipeline triggered |
| Approve knowledge source | WORKING | POST `.../knowledge/sources/:id/approve` | Status set |
| Reject/revoke knowledge source | PARTIALLY WIRED | No reject route confirmed; approve-only flow | Rejection path unclear |
| Approve memory | WORKING | POST `.../memory/:id/approve` | requireOwnerOrAdmin |
| Reject memory | WORKING | POST `.../memory/:id/reject` | — |
| Pin memory | WORKING | PATCH `.../memory/:id` (status: pinned) | — |
| Merge memory | WORKING | POST `.../memory/:id/merge` | — |
| Retire memory | WORKING | PATCH `.../memory/:id` (status: retired) | — |
| Approve curation proposal | WORKING | POST `.../knowledge/curation/proposals/:id/approve` | — |
| Reject curation proposal | WORKING | POST `.../knowledge/curation/proposals/:id/reject` | — |
| Blueprint create | WORKING | POST `.../work-blueprints` | — |
| Blueprint save/edit | WORKING | PATCH `.../work-blueprints/:id` | — |
| Blueprint test | WORKING | POST `.../work-blueprints/:id/test` | — |
| Blueprint publish | WORKING | POST `.../work-blueprints/:id/publish` | — |
| Blueprint archive | WORKING | POST `.../work-blueprints/:id/archive` | — |
| Blueprint clone | WORKING | POST `.../work-blueprints/:id/clone` | — |
| Blueprint restore | WORKING | POST `.../work-blueprints/:id/restore` | — |
| Blueprint version history | WORKING | GET `.../work-blueprints/:id/versions` | — |
| Invite team member | WORKING | POST `.../invitations` | — |
| Remove team member | WORKING | DELETE `.../members/:id` | — |
| Change member role | WORKING | PATCH `.../members/:id` | Uses "administrator" canonical string |
| Revoke invitation | WORKING | DELETE `.../invitations/:id` | — |
| Specialist activate | WORKING | POST `.../workforce-ops/:code/actions {action:"activate"}` | In WorkforceSpecialistDetail, not WorkforcePage |
| Specialist deactivate | WORKING | POST `.../workforce-ops/:code/actions {action:"deactivate"}` | In WorkforceSpecialistDetail only |
| Approve execution intent | WORKING | POST `.../execution-intents/:id/approve` | Triggers work pipeline |
| Reject execution intent | WORKING | POST `.../execution-intents/:id/reject` | — |
| Bulk approve | WORKING | POST `.../approvals/bulk` | Server-batched |
| Org settings save | PARTIALLY WIRED | PATCH `/v1/organisations/:slug` | **No onError handler — silent failure** |
| Mark notification read | WORKING | POST `.../notifications/mark-read` | Invalidates badge |
| Archive notification | WORKING | POST `.../notifications/archive` | — |
| **Snooze notification** | **API EXISTS BUT NO UI** | POST `.../notifications/snooze` | **No button in UI. Endpoint implemented but unreachable from UI.** |
| Org member invite | WORKING | POST `.../invitations` | — |
| PlanPage save | INTENTIONALLY READ-ONLY | — | No mutations; platform controls plan |
| Restore completed work version | WORKING | PATCH `.../completed-work/:id/versions/:versionId` | — |
| Platform org freeze | WORKING | PATCH `/v1/platform/organisations/:id/freeze` | Platform admin only |
| Platform trial extend | WORKING | POST `/v1/platform/trials/:id/extend` | — |
| Platform trial cancel | WORKING | POST `/v1/platform/trials/:id/cancel` | — |
| Platform staff invite | WORKING | POST `/v1/platform/staff/invite` | Role selector includes super_admin |
| Platform staff revoke | WORKING | DELETE `/v1/platform/staff/:userId/roles/:role` | — |
| Platform device revoke | WORKING | POST `/v1/platform/devices/:id/revoke` | — |
| Platform device enable/disable | WORKING | POST `/v1/platform/devices/:id/enable` or `/disable` | — |
| Platform device rotate credentials | WORKING | POST `/v1/platform/devices/:id/rotate-credentials` | — |

---

## Part F — Role-Aware UX

### Organisation nav visibility matrix

| Module | owner | administrator | manager | member | viewer | auditor |
|---|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Inbox | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Active Work | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Notifications | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Chat | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Workforce | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Operations Centre | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tasks | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Completed Work | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Library | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Memory | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Blueprint Studio | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Governance / Approvals | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Knowledge Health | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| Audit Log | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Team | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Plan | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Usage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Role enforcement gaps

1. **Blueprint Studio: nav-only gate.** Route `/app/:slug/blueprints` is not role-guarded in App.tsx. Any authenticated org member who types the URL directly reaches the Blueprint Studio. API endpoints (`/work-blueprints`) are protected by `requireAtLeastManager` or higher, so mutations 403. But the page renders, data may load (if list endpoint allows broader access), and the create/edit UI is visible. (Task #146 covers this — confirming KnowledgeLibrary and Blueprint Studio inaccessibility.)

2. **ApprovalsPage / OrgMemoryPage: action buttons visible on direct URL for any role.** UI renders approve/reject/manage buttons without checking the user's role. API correctly enforces role. UX gap: a viewer clicking "Approve" gets a 403 with no explanation.

3. **organisationMemory.ts local `requireOwnerOrAdmin` accepts legacy `"admin"` string.** The canonical `requireOwnerOrAdmin` from the shared middleware uses only `"administrator"`. The local helper in organisationMemory.ts was not migrated during Sprint 29M.3's systemic "admin" → "administrator" fix. Any code path that provisions `role: "admin"` on a membership row (old data or migration artifact) would get access to memory operations through this drift.

4. **No route-level guards anywhere in App.tsx.** All access control is: nav visibility (UI) + API middleware (server). The absence of route guards means direct URL navigation bypasses all nav-based access control. This is acceptable only if all API endpoints are correctly protected.

---

## Part G — Platform / Owner Console

### Access roles

- `platform_super_admin` — full access including staff management, super_admin grant/revoke
- `platform_admin` — full platform console access
- Both sourced from `platform_roles` DB table or Clerk `publicMetadata.platformAdmin` bootstrap
- Enforcement: `requirePlatformAuth` middleware (all platform routes) + `requirePlatformRole` for sensitive ops

### Platform Console modules

| Module | Route | Access | Read | Mutations | Status |
|---|---|---|---|---|---|
| Dashboard | `/platform` | platform_admin+ | Total orgs, users, packs, system status | None | GREEN |
| Organisations | `/platform/organisations` | platform_admin+ | All orgs, pagination, search, status/plan/trial | Freeze/close/login-disable via detail | GREEN |
| Org Detail | `/platform/organisations/:id` | platform_admin+ | Metadata, subscription, members, usage, audit, devices | Override seats, grant packs, add notes | AMBER (UI/API mismatch on tasks/approvals arrays) |
| Commercial | `/platform/commercial` | platform_admin+ | Plans, plan versions, entitlements | Limited — see Part L | AMBER |
| Trials | `/platform/trials` | platform_admin+ | Trial list, status, duration | Extend, Cancel | GREEN |
| Workforce | `/platform/workforce` | platform_admin+ | Global specialist catalogue | — | GREEN |
| Usage | `/platform/usage` | platform_admin+ | Cross-org aggregate + per-org drill-down | — | GREEN |
| Staff | `/platform/staff` | platform_admin+ | Staff list, roles, activity | Invite, Revoke, Suspend | GREEN |
| Security | `/platform/security` | platform_admin+ | Suspended orgs, flags, security events, logins | None (read-only) | GREEN |
| Audit | `/platform/audit` | platform_admin+ | Cross-org audit log, paginated | None | GREEN |
| Settings | `/platform/settings` | platform_admin+ | Platform config | Limited saves | AMBER |
| Runtime | `/platform/runtime` | platform_admin+ | AI provider health, gateway status | None | GREEN |
| Specialist Ops | `/platform/specialist-ops` | platform_admin+ | Active runs cross-org | None | GREEN |
| Packs | `/platform/packs` | platform_admin+ | Pack catalogue, org grants | Grant/revoke | GREEN |
| Connector Fleet | `/platform/connector-fleet` | platform_admin+ | All-org device fleet, errors, history | Revoke, Enable/Disable, Rotate creds | GREEN |
| Catalogue | `/platform/catalogue` | platform_admin+ | Specialist/DNA catalogue | — | GREEN |

---

## Part H — Can Platform Owner See All Organisations?

**YES** — categorically.

`GET /v1/platform/organisations` queries the `organizationsTable` with no membership filter. The only constraint is `requirePlatformAuth`. Platform admins see every organisation regardless of any relationship.

| Field available | Present? |
|---|---|
| Org list | ✅ ALL orgs |
| Pagination | ✅ limit/offset |
| Search | ✅ name search filter |
| Status | ✅ (active/suspended/closed) |
| Plan | ✅ (via subscription join) |
| Trial | ✅ (trial status/expiry) |
| Created date | ✅ |
| Member count | ✅ |
| Usage | ✅ (via usage join) |
| Enabled capabilities/entitlements | ✅ (via org detail) |
| Subscription/entitlement state | ✅ |

**Ordinary org owners cannot see other orgs.** `resolveTenantFromSlug` verifies active membership in the requested org — absent membership → 403. Confirmed: org routes are correctly scoped.

---

## Part I — Platform Organisation Detail

A platform owner inspecting an organisation can see:

| Data category | Available | Privacy boundary respected? |
|---|---|---|
| Organisation identity/profile | ✅ | ✅ |
| Subscription/plan | ✅ | ✅ |
| Trial status/dates | ✅ | ✅ |
| Members list + roles | ✅ | ⚠️ PII (emails/names) visible to platform staff |
| Active users (recent sessions) | ✅ | ⚠️ PII exposure |
| Workforce status / activated specialists | ✅ | ✅ operational metadata |
| Task aggregate count + state | ✅ count only | ✅ content NOT exposed |
| Completed work aggregate count | ✅ count only | ✅ content NOT exposed |
| Execution health indicators | ✅ | ✅ |
| Usage metrics | ✅ | ✅ |
| Knowledge source count | ✅ | ✅ |
| Connector/device count + status | ✅ | ✅ |
| Entitlement state | ✅ | ✅ |
| Audit/security signals | ✅ | ✅ |
| **Customer document/work content** | **❌ NOT exposed** | **✅ explicit restriction** |
| Internal admin notes | ✅ | ℹ️ Platform staff only |

**Issue — UI/API contract mismatch:** PlatformOrgDetail.tsx renders `data.tasks` and `data.approvals` as if they were arrays. The API returns `{total, note}` objects for these fields (explicitly restricted). The UI therefore renders empty arrays and shows no task/approval content. This is correct from a privacy standpoint but shows blank sections instead of a "restricted" message.

---

## Part J — Usage & Commercial Accuracy

### Org-level usage (GET `.../usage`)

Fields returned: `conversationMessages`, `llmRequests` (count, not tokens), `specialistExecutions`, `tasks`, `completedWork`, `knowledgeSources`, `seats`, plan limits.

| Metric | Tracked? | Source table | Issue |
|---|---|---|---|
| Messages | ✅ | conversation_messages | — |
| LLM requests (count) | ✅ | usage aggregation | — |
| **LLM tokens** | **❌ NOT TRACKED** | — | No DB column or accumulator |
| Specialist executions | ✅ | specialist_runs | — |
| Tasks | ✅ | tasks | — |
| Completed Work | ✅ | completed_work | — |
| Knowledge sources | ✅ | org_knowledge_sources | — |
| Storage | ❌ Not in response | — | No storage metric exposed |
| Exports | ❌ Not tracked | — | No export count |
| Connectors/devices | ✅ (device count) | platform_devices | — |
| Subscription limits | ✅ (plan limits overlaid) | org_subscriptions + plans | — |

### Platform usage (GET `/v1/platform/usage-monitor`)

- ✅ Aggregates across all organisations
- ✅ Drill-down by organisation
- ✅ Date range filter
- ✅ Distinguishes plan/tier
- ℹ️ CSV export: `platformExport` routes exist; whether usage specifically exports as CSV is not confirmed

**LLM token tracking: NOT IMPLEMENTED.** Token counts are handled in-memory only within the AI gateway; no DB accumulator exists. The Usage module cannot show token consumption. This affects billing accuracy if token-based pricing is intended.

---

## Part K — Plan / Trial / Entitlement Continuity

**Chain verified:** Platform plan config → org subscription → entitlements → capability gate → execution gate → usage limits. One coherent source of truth.

**`execution.openclaw_runtime` entitlement:**

This capability code is checked by `capabilityIdentificationService` / capability gate before every specialist work execution. If an organisation's `tenant_entitlements` table does not have a row for `execution.openclaw_runtime`, the capability gate fails closed and all professional work execution is blocked for that org.

This was a manual grant requirement documented in Sprint 9.7 (Owner Control Plane). It has NOT been removed or made automatic. Every new organisation must receive a manual grant of `execution.openclaw_runtime` or they cannot execute any specialist work — regardless of their subscription tier or pack grants.

Places where it is still checked:
- `src/lib/capabilityRegistry.ts` — CAPABILITY_KEYWORD_PATTERNS entry for `execution.openclaw_runtime`
- `src/services/capabilityIdentificationService.ts` — checked during gate evaluation
- `src/services/entitlementService.ts` — queried from `tenant_entitlements` table

This is an onboarding gap: new orgs will be silently blocked from all AI work unless a platform operator manually provisions this entitlement.

---

## Part L — Platform Commercial Console

| Feature | Status | Notes |
|---|---|---|
| View plans list | READ ONLY | GET `/v1/platform/commercial/plans` |
| View plan versions | READ ONLY | GET `/v1/platform/commercial/plans/:id/versions` |
| Create plan | FULLY MANAGEABLE | POST (platform admin) |
| Edit plan | FULLY MANAGEABLE | PATCH (platform admin) |
| Trial duration configuration | FULLY MANAGEABLE | Via PlatformTrials module (extend/cancel per org) |
| Feature entitlements (per plan) | READ ONLY | View only in Commercial; managed via org overrides |
| Organisation overrides | FULLY MANAGEABLE | PATCH via PlatformOrgDetail — seat, pack, entitlement overrides |
| Usage dimensions | READ ONLY | No dimension editor |
| Pricing | NOT IMPLEMENTED | No Stripe or billing integration; no price fields |
| Plan publishing/activation | PARTIALLY WIRED | Status transitions exist but not all verified |

---

## Part M — Platform Staff & Security

**Staff management:** Fully working. Invite (with role including `platform_super_admin`), Revoke, Suspend, view activity. Wired with response handling and list reload.

**Role escalation prevention:** Organisation roles cannot grant platform roles. Platform roles are in a separate `platform_roles` table authenticated through `requirePlatformAuth`. No code path allows an org-level request to write to `platform_roles`.

**Self-promotion to super_admin:** Technically possible from UI — the staff invite role dropdown includes `platform_super_admin` and a platform_admin can submit this. API should gate this; the constraint "at least one super admin must remain" exists for revocation, but creation is unrestricted for any platform_admin. **This is an intentional design choice or potential oversight** — document accordingly.

**Security module:** READ ONLY. Overview/flags/actions/logins. No mutations by design.

**Clerk bootstrap:** `publicMetadata.platformAdmin = true` on a Clerk user grants platform access even without a `platform_roles` DB row. This emergency bootstrap exists and is correct for initial provisioning.

---

## Part N — Connector Fleet

**Platform Fleet (`/platform/connector-fleet`):**
- Shows ALL organisations' devices — cross-org fleet view confirmed
- Platform auth required; device-owner actions (revoke/disable/enable/rotate) require `platform_owner` role within platform auth
- No rename action exists in platformDevices routes
- Status is computed from heartbeat timestamp (≤5 min = online) — no real-time push; fleet refreshes on action only

**Org Devices (`/app/:slug/devices`):**
- Shows only that org's devices — tenant ID in all queries
- Cross-tenant mutation impossible: device lookup requires `device.organizationId = ctx.tenantId`; mismatched device → 404

**Heartbeat mechanism:** Device-authenticated POST `.../devices/:id/heartbeat`. Device must authenticate first via challenge/exchange flow. Heartbeat updates `lastHeartbeatAt`. Online status computed (not stored) based on recency.

**OpenClaw evidence-discovery work (tomorrow):** Does NOT affect any device routes. New routes will be added to the broker side only; existing fleet isolation is unaffected.

---

## Part O — Mobile Parity

**Tabs:** Home, Work, Approvals, Chat (Alerts), Profile. Source is at `artifacts/needsops-mobile/app/` (Expo Router file-based routing).

| Tab | Data source (API path) | Status |
|---|---|---|
| Home | GET `/v1/organisations/{slug}/tasks`, GET `/v1/organisations/{slug}/completed-work?limit=3`, GET `/v1/workforce/specialists` | AMBER — shows summary data |
| Work | GET `/v1/organisations/{slug}/completed-work`, GET `/v1/organisations/{slug}/tasks` | GREEN — lists work and tasks |
| Approvals | GET `/v1/organisations/{slug}/approvals?state=pending`, GET `.../completed-work?...awaiting_approval` | AMBER — shows pending approvals list |
| Chat (Alerts) | GET `.../notifications/unread-count`, GET `.../completed-work?limit=3` | AMBER — notifications mixed |
| Profile | Clerk user data | GREEN |

**Mobile API version:** All calls use `/v1/` prefix — confirmed via `useAuthenticatedFetch` hook base URL.

**Issues:**
- ⚠️ **No pending approval badge on the Approvals tab.** The Approvals screen shows an in-screen count but the tab itself has no `tabBarBadge`. (Task #58 already proposed.)
- ⚠️ **Snooze not available on mobile** (same as web — no UI).
- ⚠️ **No export actions on mobile.** Completed work viewer (if present) cannot download PDF/DOCX even once the API is fixed.
- ℹ️ Mobile does not have Blueprint Studio, Memory, Governance, or Library — intentionally desktop-only features.
- ℹ️ Chat tab on mobile is actually "Alerts/Notifications" (calls notification/completed-work endpoints) rather than the CoS Workforce Chat. Full chat interface is desktop-only.

---

## Part P — API / UI Orphan Analysis

### Visible UI with no functional API
| Surface | Issue |
|---|---|
| PDF export (CompletedWorkPortal DownloadMenu) | UI calls `.../completed-work/:id/export?format=pdf` — endpoint not in API route tree |
| DOCX export (CompletedWorkPortal DownloadMenu) | Same — endpoint missing |
| Snooze button (referenced in task descriptions) | No UI button exists anywhere in web or mobile |

### Live API with no UI caller
| Endpoint | Registered at | No UI caller |
|---|---|---|
| POST `.../notifications/snooze` | `notifications.ts` | No web or mobile button triggers this |
| GET `/api/system/dashboard-summary` | `system.ts` (legacy) | Legacy platform dashboard; modern platform uses `/v1/platform/` equivalents |
| GET `/api/organizations` (legacy) | `organizations.ts` | Modern frontend uses `/v1/organisations/:slug` |
| GET `/api/workforce-packs` (legacy) | `workforcePacks.ts` | Modern frontend uses `/v1/workforce-packs` |
| GET `/v1/admin/*` (admin routes) | `admin.ts` | Admin-only diagnostic endpoints; no UI |
| POST/GET `.../devices/:id/first-run-complete` | `devices.ts` | Desktop Connector only, no web UI caller |
| GET `.../knowledge-worker/health` + POST `.../recover-stuck` | `knowledgeWorkerHealth.ts` | No web UI caller; platform diagnostic only |

### Routes with no callers
| Route path | Issue |
|---|---|
| `/dashboard` (legacy platform dashboard) | Has its own page (Dashboard.tsx) but overlaps with `/platform`; legacy artifact |
| `/organizations` | OrganizationsList — legacy pre-platform-console list; no nav link from AppShell |
| `/organizations/:id` | OrganizationDetail — legacy; no nav link |
| `/workforce` | WorkforceBrowser — legacy; no nav link from AppShell |
| `/system` | SystemStatus — no nav link |

### Pages with no nav/deep-link
| Page | Status |
|---|---|
| `AppDashboard.tsx` | Orphaned — in source, never routed |
| `app/WorkforceBrowser.tsx` | Duplicate — different from routed `WorkforceBrowser.tsx` |

### Duplicate data surfaces
| Duplication | Impact |
|---|---|
| ExecutiveDashboard pending count vs ApprovalsPage total | Different data sets; user sees inconsistent numbers |
| Dashboard unread count vs NotificationCentre unread count | Same endpoint, independent polling — can briefly differ |
| Legacy `/api/organizations` vs `/v1/organisations/:slug` | Both exist; mobile and modern web use v1 only; legacy exists for compatibility |

---

## Part Q — Tenant & Privacy

**Org A cannot see Org B:** Confirmed. `resolveTenantFromSlug` checks active membership in the requested org. No membership → 403. All service queries include `organizationId = ctx.tenantId`. RLS provides a second layer.

**Platform Console cross-org access:** Confirmed intentional. Platform admins can enumerate all orgs and see operational metadata. Customer work content is explicitly excluded.

**Platform privacy boundary:** Platform admin sees member PII (emails, names, roles, login activity). This is an intentional design choice for support/compliance purposes. Customer documents and work content are not accessible.

**RLS verification:** Runs at startup (`runRLSStartupCheck()` in `src/index.ts`). Missing RLS policies cause startup failure. `needsops_app` RLS bypass check is WARNING-only (not startup-fatal) — if the DB role accidentally has `rolbypassrls=true`, app continues but logs a warning. This is a configuration risk if the DB is misconfigured.

---

## Part R — Live Data Consistency

Based on code analysis (no live DB queries executed per audit constraint):

| Metric | Assessment |
|---|---|
| Member counts | Task Centre query is org-scoped; member list is org-scoped. Consistent. |
| Task counts | taskService.getTasksByOrg uses `eq(tasksTable.organizationId, organizationId)`. Consistent. |
| Active execution counts | Active-executions aggregates tasks + specialist_runs + execution_intents — all org-scoped. May diverge from task count. |
| Completed work counts | completedWorkService.listCompletedWork org-scoped. Usage module counts also org-scoped. Should be consistent. |
| Pending approvals | Dashboard count ≠ ApprovalsPage count (different data sets). **Definite discrepancy**. |
| Knowledge source counts | Usage module vs Library page may differ if library applies additional filters. |
| Subscription/trial status | Single source of truth in org_subscriptions table. Consistent. |

---

## Part S — Click-through Journey Assessment

| Journey | Result | Breaks at |
|---|---|---|
| S1: Owner creates org → invites user → user joins | ✅ WORKING | — |
| S2: Member asks Chat → transient answer | ✅ WORKING | — |
| S3: Member requests professional work → Task → Completed Work | ✅ WORKING (if `execution.openclaw_runtime` entitlement exists) | Breaks if entitlement missing — silent capability gate failure |
| S4: Evidence-bearing review → KRS → Completed Work → approval → **export** | ❌ BROKEN AT EXPORT | PDF/DOCX export → 404 |
| S5: Owner uploads Library source → processing → usable | ✅ WORKING | — |
| S6: Admin manages specialist/Workforce | ✅ WORKING | Must use WorkforceSpecialistDetail, not WorkforcePage, for activate/deactivate |
| S7: Admin reviews governance queue | ✅ WORKING | GovernanceCentre delegates correctly to ApprovalsPage |
| S8: Platform owner opens Organisations → inspects tenant | ✅ WORKING (with minor UI blank for tasks/approvals arrays) | — |
| S9: Platform staff adjusts trial | ✅ WORKING | — |
| S10: Org owner checks Usage vs Platform view | ✅ BOTH EXIST | No LLM token detail in either |

---

## Part T — Module Scorecard

| Module | Rating | Severity | Priority Fix |
|---|---|---|---|
| Executive Dashboard | 🟡 AMBER | Medium | Fix "Recently Completed → View All" route; expand Pending Decisions scope |
| Inbox | 🟢 GREEN | — | — |
| Active Work | 🟡 AMBER | Low | Add polling interval note; awaiting_approval dual-display is confusing |
| Notifications | 🟡 AMBER | Medium | Snooze endpoint exists but no UI; mutation error handlers missing |
| Chat | 🟢 GREEN | — | — |
| Workforce (catalogue) | 🟡 AMBER | Low | Clarify this is catalogue view not org activity |
| Operations Centre | 🟢 GREEN | — | — |
| Tasks | 🟢 GREEN | — | — |
| **Completed Work** | **🔴 RED** | **Critical** | **PDF/DOCX export → 404. Primary value-delivery action broken.** |
| Library | 🟢 GREEN | — | — |
| Memory | 🟡 AMBER | Low | Action buttons visible on direct URL for any role; local "admin" drift |
| Blueprint Studio | 🟡 AMBER | Medium | Route-level access gate missing; nav-only |
| Governance | 🟢 GREEN | — | — |
| Approvals | 🟡 AMBER | Low | Action buttons visible on direct URL; no role check in UI |
| Knowledge Health | 🟢 GREEN | — | — |
| Audit Log | 🟢 GREEN | — | — |
| Team | 🟢 GREEN | — | — |
| Plan | 🟢 GREEN | — | — (correctly read-only) |
| Usage | 🟡 AMBER | Medium | No LLM token tracking |
| Settings | 🟡 AMBER | Low | No onError handler for save |
| Account Settings | 🟢 GREEN | — | — |
| Platform Dashboard | 🟢 GREEN | — | — |
| Platform Orgs | 🟢 GREEN | — | — |
| Platform Org Detail | 🟡 AMBER | Low | tasks/approvals UI renders blank instead of restriction notice |
| Platform Commercial | 🟡 AMBER | Medium | Pricing not implemented; limited editability |
| Platform Trials | 🟢 GREEN | — | — |
| Platform Usage | 🟢 GREEN | — | — |
| Platform Staff | 🟢 GREEN | — | — |
| Platform Security | 🟢 GREEN | — | — (read-only by design) |
| Platform Connector Fleet | 🟢 GREEN | — | — |
| Platform Settings | 🟡 AMBER | Low | Limited editability |
| Platform Runtime | 🟢 GREEN | — | — |
| **Mobile (overall)** | 🟡 AMBER | Medium | No approval tab badge; no snooze; chat tab is alerts not CoS chat |

---

## Required Final Answers

1. **Are all current organisation modules correctly wired?**  
   Mostly. All modules are reachable and data-connected. Material defects: (a) Completed Work export broken, (b) Dashboard Pending Decisions count is structurally misleading, (c) execution.openclaw_runtime onboarding gate is invisible.

2. **Are all visible buttons/actions functional?**  
   No. PDF and DOCX export buttons call an API endpoint that does not exist. Both return 404. All other buttons tested are functional or intentionally read-only.

3. **Is Dashboard showing canonical data?**  
   Partially. Active Work count and Knowledge Health are canonical. Pending Decisions count is non-canonical (misses major approval categories). Workforce is global catalogue, not org-scoped activity. "Recently Completed → View All" routes to the wrong page.

4. **Does Active Work show genuine active execution?**  
   Yes. Active-executions endpoint correctly aggregates active tasks, active specialist runs, and dispatched execution intents. Polling at 30s is the only latency.

5. **Do Inbox and Notifications have clean non-duplicated semantics?**  
   Yes — semantically clean. Inbox = actionable (awaiting action). Notifications = informational (completed/approved). They use different filters on the same completed-work endpoint. The AppShell badge counts unread conversation messages only, not Inbox items — this may surprise users expecting an "action required" badge.

6. **Does Completed Work correctly view/approve/export the pinned version?**  
   View and approve: YES. The approved_version_id FK is set on approve; viewer resolves pinned version with integrity banner.  
   Export: NO. PDF/DOCX export endpoint does not exist in the API — returns 404.

7. **Is Library working according to the new ingestion model?**  
   Yes. Upload → ingestion pipeline → approval workflow is functional. Specialist training scoping works.

8. **Are Memory and Blueprint visibility/access aligned with roles?**  
   Nav visibility: YES. Route-level enforcement: NO for Blueprint Studio (nav-only gate). Memory is nav-only gated too; organisationMemory.ts API has legacy "admin" string drift.

9. **Is Governance correctly permissioned?**  
   Yes, for the hub itself. Individual governance actions (approve/reject) in the ApprovalsPage show buttons to all authenticated users regardless of role; API enforces correctly.

10. **Are Team actions complete and functional?**  
    Yes. Invite, remove, role change, revoke invitation — all wired and working.

11. **Does Usage reflect actual accounting data?**  
    Mostly. Message/task/execution/work counts are correctly tracked. LLM token usage is NOT tracked in any DB table — only request counts.

12. **Can a platform owner see all organisations?**  
    YES. Confirmed categorically.

13. **Can they inspect organisation plan/trial/usage/health?**  
    YES. All listed fields are available via platform org detail. Customer work content is excluded.

14. **Are Platform Console totals accurate?**  
    Platform usage aggregates are correctly scoped. Platform org list is correctly all-org. Platform Dashboard (legacy `/dashboard`) shows basic system totals; `/platform` is the modern console.

15. **Are Platform Console buttons/actions functional?**  
    Yes for: org freeze/close, trial extend/cancel, staff invite/revoke/suspend, device revoke/enable/disable/rotate, pack grants, org overrides.  
    Not applicable for: security (read-only by design), audit (read-only by design).

16. **Is cross-tenant isolation still correct?**  
    Yes. `resolveTenantFromSlug` + `tenantId` in all WHERE clauses + RLS at startup verification. The only intentional cross-tenant access is through platform admin routes, which are correctly guarded.

17. **Are any visible surfaces placeholders pretending to work?**  
    Yes: PDF/DOCX export buttons call a non-existent endpoint and appear functional until clicked. The Platform Commercial pricing section appears editable but pricing is not implemented.

18. **Are any production APIs orphaned?**  
    Yes: POST `.../notifications/snooze` has a working server implementation but no UI caller anywhere. Legacy `/api/organizations`, `/api/workforce-packs`, and `/api/system/dashboard-summary` are still mounted but unused by modern frontend.

19. **Are any duplicate modules still confusing responsibility?**  
    Two potential confusions: (a) Dashboard "Pending Decisions" vs ApprovalsPage total — same words, different scope. (b) Notifications vs Inbox — semantically correct but users may not understand the distinction without guidance.

20. **If we launched today, what are the five highest-risk product-surface failures?**

    | Rank | Failure | Risk |
    |---|---|---|
    | 1 | **PDF/DOCX export → 404** | Every download attempt fails silently. The primary value-delivery action for approved work is broken. |
    | 2 | **`execution.openclaw_runtime` manual entitlement required** | New organisations cannot execute any professional work without a manual platform grant. No onboarding flow provisions it automatically. Completely invisible to org users. |
    | 3 | **Dashboard "Pending Decisions" misrepresents governance load** | An owner with 20 pending knowledge/memory/library items sees "0 Pending Decisions." Governance urgency is invisible from the Dashboard. |
    | 4 | **Notification snooze: API implemented, no UI** | Users cannot snooze notifications. Snoozed notifications (once API is exposed) reappear immediately. Task #57 already proposed. |
    | 5 | **Blueprint Studio and Memory lack route-level access guards** | Direct URL navigation bypasses nav role gating. Any authenticated org member can reach these pages; API protects mutations but page renders and partial data may load. |

---

## Final Verdict

> **FUNCTIONAL WITH FIXES REQUIRED**

The product is substantially wired and coherent. All data flows are correctly tenant-isolated. The platform console is production-ready. Role-based access enforcement exists at the API layer throughout.

However, four issues prevent a clean launch declaration:

1. **PDF/DOCX export is completely broken** (endpoint missing) — this is a primary user-facing capability.
2. **`execution.openclaw_runtime` onboarding gap** — new orgs silently cannot execute work.
3. **Dashboard Pending Decisions is structurally misleading** — significant governance load is invisible.
4. **Blueprint Studio and Memory have no route-level access guard** — security relies entirely on API enforcement with no UX layer.

None of these are architecture or data integrity failures — all are targeted fixes. The test baseline (4,959 / 0) is clean and preserved.
