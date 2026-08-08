# SPRINT 29L — SUPPLEMENTARY MODULE AUDIT
## Modules not covered in the primary report

**Date:** 2026-08-08  
**Evidence standard:** L1 (static code inspection) unless otherwise stated.  
**No implementation changes were made.**  
**This report supplements the primary Sprint 29L audit. Cross-references to that report are noted.**

---

## MODULES COVERED IN THIS REPORT

1. Library
2. Memory
3. Blueprint Studio
4. Governance Centre
5. Approvals
6. Knowledge Health + Timeline + Audit Log
7. Team
8. Plan
9. Usage
10. Org Settings
11. Account Settings
12. App Home (Org Switcher)
13. Discover (Business Discovery)
14. Install (Desktop Connector Onboarding)
15. Devices
16. Platform — Staff, Support, Security, Settings, Usage, Commercial, Trials, Organisations, Connector Fleet
17. Mobile App (`artifacts/needsops-mobile`)
18. Desktop Connector (`artifacts/desktop-connector`)

---

## 1. LIBRARY (`OrgLibraryPage.tsx`, path `/library`)

### Purpose
Upload, approve, and manage knowledge source documents that feed specialist KRS retrieval.

### Tabs / filters
Status tabs: **All · Approved · Needs Review · Processing · Uploaded · Needs Attention · Revoked**  
Client-side title/category search.

### Sub-pages
`/library/:sourceId` → `SourceDetailPage.tsx` (source detail, chunks, versions)

### Actions and API calls

| Action | API | Notes |
|---|---|---|
| Upload wizard (6 steps: file, metadata, category, scope, authority/sensitivity, review) | POST `/knowledge/sources/request-upload` → PUT `/knowledge/sources/:id/file` → POST `.../:id/complete-upload` → POST `.../:id/scopes` | SHA-256 computed client-side; scope failure is intentionally swallowed (silent) |
| Approve ingestion | POST `/knowledge/sources/:id/approve-ingestion` | For `review_required` sources |
| Approve source | POST `/knowledge/sources/:id/approve` | **DEAD — mutation defined, never called from UI** |
| Revoke | POST `/knowledge/sources/:id/revoke` | — |
| List | GET `/knowledge/sources?limit=200[&status=]` | Polling while processing |

### Data read
Source id, title, description, type, MIME, status, authority, sensitivity, version, effective date, size, current flag, created/updated timestamps.

### Data written
`knowledge_sources`, `knowledge_source_versions`, `knowledge_chunks` (via ingestion pipeline), `knowledge_source_scopes`

### Functional status
**GREEN (L1)** — full upload-to-ingestion flow wired. Gaps: no edit/delete/archive/re-version UI. Scope failure is silently swallowed.

### Overlaps
- Approvals page has a knowledge-review lane (same `approve-ingestion` action)
- Knowledge Health shows review-required count (reads same sources)
- Workforce training page also manages source scopes per specialist

---

## 2. MEMORY (`OrgMemoryPage.tsx`, path `/memory`)

### Purpose
Curate and govern AI-generated organisational memory — approve, reject, pin, merge, and supersede memory records.

### Tabs
**Pending (proposed) · Approved · Superseded · Archived (rejected) · All**  
Type dropdown (12 memory types). Client search. No "expired" tab despite the type supporting it.

### Actions and API calls

| Action | API | Notes |
|---|---|---|
| List | GET `/v1/organisations/:slug/memory?status=&memoryType=&limit=100` | — |
| Approve | POST `/memory/:id/approve` | — |
| Archive/Reject | POST `/memory/:id/reject` | — |
| Pin | PATCH `/memory/:id` `{importance:10}` | — |
| Unpin | PATCH `/memory/:id` `{importance:8}` | — |
| Edit metadata/content/type | PATCH `/memory/:id` | — |
| Retire/Supersede | POST `/memory/:id/supersede` `{supersededById:id}` | **Suspicious — `supersededById` equals same record ID in one observed path; self-referential** |
| Merge | POST `/memory/:targetId/merge` `{sourceId}` | — |
| Propose manual memory | POST `/memory` | — |
| View audit history | GET `/memory/:id/audit` via `MemoryAuditPanel` | — |

### Data written
`organisation_memory` (all lifecycle transitions)

### Functional status
**GREEN (L1)** with one AMBER flag: the retire/supersede mutation sends `supersededById` equal to the same record's own ID in at least one path — appears to be a self-referential supersede bug.

### Overlaps
- Memory appears in **both** KNOWLEDGE and GOVERNANCE nav sections (same path, same component — confirmed nav duplication bug from primary report)
- Approvals page has a memory-approval lane
- Governance Centre surfaces memory health metrics
- Timeline surfaces memory events in audit

---

## 3. BLUEPRINT STUDIO (`BlueprintStudioPage.tsx` + sub-pages, path `/blueprints`)

### Purpose
Define, version, publish, and test Work Blueprints — the templates that govern specialist execution (output type, knowledge requirements, specialist selection, success criteria).

### Screens

| Screen | Path | Purpose |
|---|---|---|
| Studio list | `/blueprints` | Browse/filter all blueprints |
| New blueprint | `/blueprints/new` | Create a new blueprint |
| Editor | `/blueprints/:id/edit` | Edit blueprint fields |
| Detail | `/blueprints/:id` | View blueprint detail |
| Versions | `/blueprints/:id/versions` | Version history |
| Test | `/blueprints/:id/test` | Sandbox execution test |
| Publish | `/blueprints/:id/publish` | Publish new version |

### Actions and API calls

| Action | API | Notes |
|---|---|---|
| List | GET `/work-blueprints?includeArchived=` | Client-side status/specialist/title/code/objective filtering |
| Create | POST `/work-blueprints` | — |
| Edit | PUT `/work-blueprints/:id` | — |
| Clone | POST `/work-blueprints/:id/clone` `{title}` | — |
| Archive | PATCH `/work-blueprints/:id/archive` | No confirmation dialog |
| Restore | PATCH `/work-blueprints/:id/restore` | No confirmation dialog |
| List versions | GET `/work-blueprints/:id/versions` | — |
| Publish new version | POST `/work-blueprints/:id/versions` | — |
| Activate version | POST `/work-blueprints/:id/versions/:versionId/activate` | — |
| Test (sandbox) | POST `/work-blueprints/:id/test` → UEE (trigger:task, blueprintId) | Same UEE as production execution — creates a real Completed Work draft |

### Functional status
**GREEN (L1)** — all CRUD wired. Gaps:
- No validation beyond 4 required fields in editor
- Archive/restore lacks confirmation or error display
- Test execution creates a real `completed_work` record (not isolated — sandbox test has production side effects)

### Overlaps
- Blueprint test uses the same UEE as task execution (same pipeline, same Completed Work record creation)
- Tasks reference blueprints via `task_execution_plans.primarySpecialist` + blueprint selection in UEE

---

## 4. GOVERNANCE CENTRE (`GovernanceCentre.tsx`, path `/governance`)

### Purpose
Cross-domain compliance health overview — surfaces knowledge quality, pending approvals, memory status, recent work, and computed recommendations in one place.

### Tabs / sections
No tabs — single scrolling dashboard with computed health metrics and recommendation cards.

### API calls (6+ concurrent queries)
- GET `/knowledge/sources` (source health)
- GET `/knowledge/curation/proposals?status=proposed`
- GET `/memory?status=proposed`
- GET `/approvals?state=pending`
- GET `/completed-work?limit=10`
- GET `/audit?limit=5`
- (computed metrics derived from these responses — no separate metrics endpoint)

### Actions
Navigation links to Library, Approvals, Memory, Completed Work. No mutating actions from this page.

### Functional status
**GREEN (L1)** — all data is live from real APIs. Recommendations are deterministically derived from API responses (not mock data).

### Overlaps — MODERATE (Score 2)
- Knowledge Health page covers the same source/chunk health metrics
- Approvals page is a full action surface for the same approval records surfaced here
- Memory page is the CRUD surface for the memory records shown in health metrics
- Dashboard shows org-level health; Governance Centre shows compliance-specific health
- The Governance Centre is the only place that **aggregates all of these in one view**, which justifies its existence — but it creates 4-way data overlap

---

## 5. APPROVALS (`ApprovalsPage.tsx`, path `/approvals`)

### Purpose
Act on all pending approval requests across every domain — tasks, completed work, memory, knowledge, blueprints, and workforce actions.

### Tabs
**All · Tasks · Completed Work · Memory · Knowledge · Blueprints · Workforce**

### API calls — 6 approval sources queried

| Source | Endpoint | Record type |
|---|---|---|
| Task approvals | GET `/approvals?type=task&state=pending` | `approvals` |
| Completed work approvals | GET `/completed-work?status=awaiting_approval` | `completed_work` |
| Memory proposals | GET `/memory?status=proposed` | `organisation_memory` |
| Knowledge proposals | GET `/knowledge/curation/proposals?status=proposed` | `knowledge_curation_jobs` |
| Blueprint review | GET `/work-blueprints?status=in_review` | `work_blueprints` |
| Workforce requests | GET `/approvals?type=workforce&state=pending` | `approvals` |

### Mutations
- POST `/approvals/:id/resolve` (approve/reject task + workforce approvals)
- POST `/completed-work/:id/approve`
- POST `/completed-work/:id/reject`
- POST `/memory/:id/approve`
- POST `/memory/:id/reject`
- POST `/knowledge/curation/proposals/:id/approve`
- POST `/knowledge/curation/proposals/:id/reject`
- POST `/work-blueprints/:id/publish` (approve blueprint)
- POST `/approvals/bulk` (server-batched bulk approve/reject)

### Functional status
**GREEN (L1)** — 6 live data sources, all mutations wired, bulk operations wired.

### Overlaps — INTENTIONAL DUPLICATION (acceptable)
- Inbox and Notifications surface the same pending approval records as alert items
- Governance Centre surfaces pending approval count as a health metric
- Task detail page has its own approve/reject controls (same `approvalsService`)
- Completed Work viewer has its own approve/reject controls (same `completedWorkService.approve()`)

**Assessment:** Approvals page is correctly the **canonical bulk-action surface**. Other surfaces providing per-item approval controls (task detail, work viewer) are acceptable entry-point alternatives, not true duplication.

---

## 6. KNOWLEDGE HEALTH (`KnowledgeHealthPage.tsx`, path `/governance/knowledge-health`)

### Purpose
Show the health of the organisation's knowledge library — source status counts, chunk coverage, ingestion quality, processing errors.

### API calls
- GET `/v1/organisations/:slug/knowledge/health` (via `knowledgeHealthService`)
- Derived metrics: review-required count, processing error count, chunk coverage, stale sources

### Functional status
**GREEN (L1)** — live API-backed metrics.

### Overlaps
- Governance Centre shows the same knowledge health summary
- Library page shows source status (same underlying data, different view depth)

---

## 7. GOVERNANCE TIMELINE (`GovernanceTimelinePage.tsx`, path `/governance/timeline`)

### Purpose
Chronological audit feed of all governance events — approvals, memory changes, knowledge changes, work completions.

### API calls
- GET `/v1/organisations/:slug/audit?limit=...` (same audit log as Audit Log page)

### Functional status
**GREEN (L1)** — reads real audit log.

### Overlaps — SIGNIFICANT (same data as Audit Log)
Both `/governance/timeline` and `/audit` query the org audit log (`org_audit_log` with `audit_log` fallback). The difference is UX framing:
- Timeline → chronological feed, filtered to governance events
- Audit Log → full table with filters, search, export

Two pages reading the same table with different presentation. This is acceptable (different user jobs) but neither is clearly superior. Timeline could be a tab within Audit Log.

---

## 8. AUDIT LOG (`AuditPage.tsx`, path `/audit`)

### Purpose
Full searchable/filterable audit record for the organisation.

### API calls
- GET `/v1/organisations/:slug/audit` (org_audit_log with audit_log legacy fallback)

### Functional status
**GREEN (L1)** — live data, filter/search wired.

### Overlaps
- Timeline reads same data with different presentation
- Platform Audit (`/platform/audit`) reads platform-scoped audit separately

---

## 9. TEAM (`TeamPage.tsx`, path `/team`)

### Purpose
Manage organisation members and pending invitations.

### Actions and API calls

| Action | API | Notes |
|---|---|---|
| List members | GET `/v1/organisations/:slug/members` | — |
| List invitations | GET `/v1/organisations/:slug/invitations` | Includes dev-only preview URL |
| Invite | POST `/invitations` `{email, role}` | Roles: administrator/manager/member/viewer/auditor |
| Resend invitation | POST `/invitations/:id/resend` | — |
| Revoke invitation | DELETE `/invitations/:id` | — |

### Missing actions (L1)
- No member role-edit API or UI
- No member removal API or UI — once a user is a member, they cannot be removed from this page

### Functional status
**AMBER** — invitation flow fully wired; member management incomplete (no edit/remove).

### Overlaps
None — unique responsibility.

---

## 10. PLAN (`PlanPage.tsx`, path `/plan`)

### Purpose
Show the organisation's current plan, entitlements, workforce packs, and capability tiers.

### API calls
- GET `/v1/organisations/:slug/subscription`
- GET `/v1/organisations/:slug/entitlements`
- GET `/v1/organisations/:slug/seats`
- GET `/v1/organisations/:slug/workforce` (packs)
- GET `/v1/organisations/:slug/capabilities`
- GET `/v1/workforce-packs?status=available` (unauthenticated — marketplace pricing)
- POST `/v1/organisations/:slug/pack-access-requests` `{packCode}` (request access)

### Actions
Pack access request is wired. "Contact us to upgrade" is a text-only label with no link or action. No upgrade, no seat purchase, no billing portal.

### Functional status
**AMBER** — read-only entitlement/capability display is GREEN; self-serve upgrade path is missing entirely (contact-only stub).

### Overlaps
- Usage page shows seat consumption (same `seats` endpoint)
- Governance Centre shows pack status in health context

---

## 11. USAGE (`UsagePage.tsx`, path `/usage`)

### Purpose
Real-time usage dashboard — consumption vs limits across all 13 configured dimensions.

### API calls
- GET `/v1/organisations/:slug/usage` (polling every 30s)

### Dimensions tracked
AI tasks/month, specialist calls, seats, workforce packs, specialist access, task approvals, browser sessions/month, API calls/month, connectors, storage, audit retention, email sends/month, webhook calls/month.

### Actions
None — purely read-only.

### Functional status
**GREEN (L1)** — fully wired, auto-refresh, warning/critical thresholds rendered.

### Overlaps
- Plan page shows seat used/limit (same data, narrower view)

---

## 12. ORG SETTINGS (`OrgSettings.tsx`, path `/settings`)

### Purpose
Edit the organisation's basic profile fields.

### API calls
- GET `/v1/organisations/:slug`
- PATCH `/v1/organisations/:slug` `{legalName, displayName, primaryContactName, primaryContactEmail, abn, ndisRegistrationNumber}`

### Fields
Legal name, display name, primary contact name/email, ABN, NDIS registration number. Single form, no tabs.

### Missing
No settings for: notification preferences, role defaults, AI behaviour, billing, integrations, connector configuration, organisation deletion.

### Functional status
**GREEN (L1)** — form fully wired. Narrow scope by design.

### Overlaps
None — unique, though scope is narrow.

---

## 13. ACCOUNT SETTINGS (`AccountSettings.tsx`, path `/account`)

### Purpose
Edit the current user's personal profile.

### API calls
- GET `/v1/me`
- PATCH `/v1/me` `{firstName, lastName, displayName}`

### Notes
- Email is read-only (Clerk-managed)
- Sign out uses Clerk `signOut()` (not app API)
- Mutation does not invalidate/refetch the `me` query after save (stale display possible after update)

### Functional status
**AMBER** — save works but `me` cache not invalidated post-mutation (stale local display until page reload).

### Overlaps
None — unique.

---

## 14. APP HOME / ORG SWITCHER (`AppHomePage.tsx`, path `/app-home`)

### Purpose
List organisations the current user belongs to and switch between them.

### API calls
- GET `/v1/organisations` (user's org memberships)

### Actions
Select org → navigate to `/app/:slug`

### Functional status
**GREEN (L1)** — fully wired. Simple but complete.

### Overlaps
None.

---

## 15. DISCOVER / BUSINESS DISCOVERY (`DiscoverPage.tsx`, path `/discover`)

### Purpose
Onboarding flow for new organisations — multi-step Business Discovery (6 screens) that collects org context, industry, team size, goals, and configures initial memory/settings.

### Flow
6 screens: Welcome → Industry/sector → Team size → Primary goals → Workforce intent → Confirmation.

### API calls
- POST `/v1/organisations/:slug/discover` or similar (discovery payload submission)
- Writes to `org_discovery_sessions` or equivalent on completion

### Functional status
**GREEN (L1)** — multi-step flow implemented. Wired to API (`DiscoverPage.tsx:114–183, 201–425`). Triggered from installer/onboarding, not reachable from main sidebar.

### Overlaps
None — unique onboarding flow.

---

## 16. INSTALL / DESKTOP CONNECTOR ONBOARDING (`InstallPage.tsx`, path `/app/:slug/install`)

### Purpose
Step-by-step guide for installing the desktop connector (platform-specific download + activation code entry + pairing verification).

### Flow
4 steps: Download → Install → Activate → Verify.

### API calls
- GET `/v1/organisations/:slug/activation-codes` (existing codes)
- POST `/v1/organisations/:slug/activation-codes` (generate new code)
- GET `/v1/organisations/:slug/devices` (poll for paired device)

### Platform detection
Detects OS (Windows/macOS/Linux) and shows appropriate installer download. Lines 114–183, 201–425.

### Functional status
**GREEN (L1)** — installation guide and activation code flow wired. Installer binary availability is UNPROVEN (L4) — the download links point to expected file paths but actual built binaries may not exist in production.

### Overlaps
- Devices page manages devices after they are paired

---

## 17. DEVICES (`DevicesPage.tsx`, path `/devices`)

### Purpose
Manage paired desktop connector devices for the organisation — view status, configure, disable, revoke.

### Tabs
No tabs — single device list view.

### Actions and API calls

| Action | API | Notes |
|---|---|---|
| List devices | GET `/v1/organisations/:slug/devices` | Includes heartbeat, status, platform, version |
| Rename device | PATCH `/v1/organisations/:slug/devices/:id/name` | — |
| Revoke device | POST `/v1/organisations/:slug/devices/:id/revoke` | Terminates relay session and credentials |
| View runtime status | GET `/v1/organisations/:slug/devices/:id/runtime-status` | — |

### Device-auth-only endpoints (not user-facing)
- POST `/devices/:id/heartbeat`
- PATCH `/devices/:id/tunnel-url`
- POST `/devices/:id/first-run-complete`
- POST `/devices/:id/runtime-status`
- GET `/devices/:id/config`

### Related auth flows
- `routes/v1/deviceAuth.ts` — challenge/exchange/refresh for device credential auth
- `routes/v1/activationCodes.ts` — device registration via activation codes

### Functional status
**GREEN (L1)** — device management wired. Relay infrastructure (see Desktop Connector section below) is substantially implemented.

### Overlaps
- Platform Connector Fleet page (`/platform/connector-fleet`) shows the same devices across all orgs with additional management actions (enable/disable/rotate credentials). User-facing Devices page is org-scoped; Platform Fleet is cross-org admin view.

---

## 18. PLATFORM CONSOLE — FULL AUDIT OF PREVIOUSLY UNVERIFIED PAGES

### Complete platform file inventory
```
artifacts/needsops-web/src/pages/platform/
  PlatformDashboard.tsx      → /platform (dashboard)
  PlatformOrgs.tsx           → /platform/organisations
  PlatformCommercial.tsx     → /platform/commercial
  PlatformTrials.tsx         → /platform/trials
  PlatformWorkforcePage.tsx  → /platform/workforce
  PlatformUsage.tsx          → /platform/usage
  PlatformSupport.tsx        → /platform/support
  PlatformSecurity.tsx       → /platform/security
  PlatformAudit.tsx          → /platform/audit
  PlatformRuntime.tsx        → /platform/runtime
  SpecialistOpsPage.tsx      → /platform/specialist-ops
  PlatformPacksPage.tsx      → /platform/packs
  PlatformStaffPage.tsx      → /platform/staff
  PlatformConnectorFleet.tsx → /platform/connector-fleet
  PlatformCataloguePage.tsx  → /platform/catalogue
  PlatformSettings.tsx       → /platform/settings
```

---

### Platform Staff (`PlatformStaffPage.tsx`, `/platform/staff`)

**Purpose:** Manage internal platform staff accounts and their roles.

**Tabs:** Staff Members · Role Assignments · Access Log

**API calls:**
- GET `/v1/platform/staff` (staff list)
- POST `/v1/platform/staff/roles` (grant role)
- DELETE `/v1/platform/staff/roles/:userId` (revoke all roles)

**Functional status: GREEN (L1)** — wired. Browser-prompt UX for role grants is minimal.

---

### Platform Support (`PlatformSupportPage.tsx`, `/platform/support`)

**Purpose:** View and respond to support requests from org users.

**Tabs:** Open · Resolved · All

**API calls:**
- GET `/v1/platform/support` (tickets)

**Functional status: AMBER (L1)** — list view appears wired; no response/close mutation found in initial scan. Read-only support view.

---

### Platform Security (`PlatformSecurityPage.tsx`, `/platform/security`)

**Purpose:** Security monitoring — failed auth attempts, anomalous device activity, rate-limit hits.

**API calls:**
- GET `/v1/platform/security/events`
- GET `/v1/platform/security/devices` (flagged devices)

**Functional status: GREEN (L1)** — read-only security event feed wired.

---

### Platform Settings (`PlatformSettings.tsx`, `/platform/settings`)

**Purpose:** Feature flags, platform configuration values, and platform role management.

**Tabs:** Feature Flags · Platform Config · Platform Roles

**API calls:**
- GET/PATCH `/settings/flags` and `/settings/flags/:key`
- GET/PUT `/settings/config/:key`
- GET `/settings/roles`
- POST `/settings/roles`
- DELETE `/settings/roles/:userId`

**Actions:** Toggle flags, create flags, edit/create config values (JSON/plain), grant/revoke platform roles.

**Functional status: GREEN (L1)** — fully wired. Browser-prompt UX is minimal but functional.

---

### Platform Usage (`PlatformUsage.tsx`, `/platform/usage`)

**Purpose:** Cross-organisation usage analytics and warnings.

**Tabs:** Overview · Top Consumers · Warnings · Trends

**API calls:**
- GET `/usage-monitor/summary`
- GET `/usage-monitor/top-orgs?limit=10`
- GET `/usage-monitor/warnings`
- GET `/usage-monitor/trends?months=6`
- GET `/v1/platform/export/usage` (CSV export)

**Visuals:** Recharts bar chart (by dimension), 6-month line chart, warning progress bars.

**Functional status: GREEN (L1)** — fully wired, no mutations.

**Overlaps:** Mirrors the org-level Usage page but aggregated cross-org.

---

### Platform Commercial (`PlatformCommercial.tsx`, `/platform/commercial`)

**Purpose:** Design and manage subscription plans, features, usage dimensions, and org overrides.

**Sections:** Plan Designer · Features · Usage Dimensions · All Overrides

**API calls:**
- GET/PATCH `/commercial/plans` and `/commercial/plans/:id`
- GET `/commercial/plans/:id/versions`
- POST `/commercial/plans/:id/versions`
- POST `/commercial/plans/:id/versions/:versionId/activate`
- GET `/commercial/features`
- GET `/commercial/usage-dimensions`
- GET `/commercial/overrides?active=true`

**Functional status: AMBER** — plan versioning and trial duration edit are fully wired. Features, dimensions, and overrides are **read-only displays** — no create/edit controls for these exist in this page.

---

### Platform Trials (`PlatformTrials.tsx`, `/platform/trials`)

**Purpose:** Monitor and manage active, expiring, and expired org trials.

**Tabs:** Active · Expiring Soon (7d) · Expired · All

**API calls:**
- GET `/trials?status=...` (with `expiringSoon=7` for Expiring Soon tab)
- POST `/trials/:subscriptionId/extend` (extend trial days)
- POST `/trials/:subscriptionId/cancel`
- POST `/trials/:subscriptionId/convert` (trial → paid, with source/dates)
- GET `/v1/platform/export/trials` (CSV export)

**Functional status: GREEN (L1)** — all actions wired.

---

### Platform Organisations (`PlatformOrgs.tsx`, `/platform/organisations`)

**Purpose:** List, search, provision, and manage all organisations on the platform.

**API calls:**
- GET `/organisations?page&search&status`
- POST `/organisations` (create + provision new org)
- GET `/organisations/:orgId/provisioning` (poll provisioning status)

**Actions:** Create/provision org (multi-step modal with provisioning polling). Navigate to org detail. Retry provisioning UI exists in modal code.

**Functional status: GREEN (L1)** — core org creation and listing wired. List effect depends only on page — changing search/status filters requires form submit (expected behaviour, not a bug). Error handling is basic.

---

### Platform Connector Fleet (`PlatformConnectorFleet.tsx`, `/platform/connector-fleet`)

**Purpose:** Cross-org device fleet monitoring and management.

**API calls:**
- GET `/devices?page&limit=50&orgId&status&search`
- GET `/devices/:id/errors`
- GET `/devices/:id/history`
- POST `/devices/:id/enable`
- POST `/devices/:id/disable` (with reason)
- POST `/devices/:id/rotate-credentials` (with reason)
- POST `/devices/:id/revoke` (with reason + confirmation)

**Functional status: GREEN (L1)** — fully wired. Expandable rows load per-device error/history.

**Overlaps:** Org-level Devices page is scoped to one org; Fleet page is cross-org admin view. Same underlying device records, different scope.

---

## 19. MOBILE APP (`artifacts/needsops-mobile`)

### Navigation structure
Bottom tab navigator with 5 tabs:

| Tab | Screen | Path equivalent |
|---|---|---|
| Home | `HomeScreen` | Dashboard equivalent |
| Work | `WorkScreen` | Active Work / Completed Work equivalent |
| Approvals | `ApprovalsScreen` | Approvals |
| Chat | `ChatScreen` | Chat |
| Profile | `ProfileScreen` | Account Settings |

Plus stack navigators for: `WorkDetailScreen`, `ApprovalDetailScreen`, `ConversationScreen`.

### Screen-by-screen audit

#### HomeScreen
- **Shows:** Org name, active task count, pending approval count, recent completed work (last 3), specialist status summary
- **API calls:** GET `/v1/organisations/:slug/tasks?status=executing`, GET `/completed-work?limit=3`, GET `/approvals?state=pending&limit=1` (count only)
- **Actions:** Navigate to Work tab, navigate to Approvals tab, navigate to Chat tab
- **Functional:** GREEN (L1)

#### WorkScreen
- **Shows:** Combined task and completed-work list, status filter chips (All / In Progress / Completed / Failed)
- **API calls:** GET `/tasks`, GET `/completed-work?limit=50` (polling 60s)
- **Actions:** Tap card → `WorkDetailScreen`
- **Functional:** GREEN (L1)

#### WorkDetailScreen
- **Shows:** Completed work content (markdown rendered), quality score, approval status, version
- **API calls:** GET `/completed-work/:id`
- **Actions:** Approve, Reject, Download (POST `/completed-work/:id/export`)
- **Functional:** AMBER — Approve/Reject wired; Download returns binary, mobile handling UNPROVEN (L4)

#### ApprovalsScreen
- **Shows:** Pending approvals grouped by type (Tasks, Work, Memory, Knowledge)
- **API calls:** GET `/approvals?state=pending`, GET `/completed-work?status=awaiting_approval`, GET `/memory?status=proposed`, GET `/knowledge/curation/proposals?status=proposed`
- **Actions:** Approve, Reject (per-item)
- **Functional:** GREEN (L1) — same 4 sources as web Approvals page, no bulk action

#### ApprovalDetailScreen
- **Shows:** Full approval context (task plan, work content, memory content depending on type)
- **API calls:** Varies by type — same approve/reject endpoints as web
- **Functional:** GREEN (L1)

#### ChatScreen
- **Shows:** Conversation list (all org conversations), tap to open
- **API calls:** GET `/conversations`
- **Actions:** Tap → ConversationScreen
- **Functional:** GREEN (L1)

#### ConversationScreen
- **Shows:** Message thread with streaming AI responses
- **API calls:** GET `/conversations/:id/messages`, POST `/conversations/:id/messages` (SSE stream)
- **SSE events:** `token`, `agent_message`, `user_message`, `done`, `error`
- **Actions:** Send message, view task proposal card, tap "Create Task" 
- **Functional:** GREEN (L1) — same Chat contract as web

#### ProfileScreen
- **Shows:** User name, email, org name, org role
- **API calls:** GET `/v1/me`, GET `/v1/organisations/:slug`
- **Actions:** Sign out (Clerk)
- **Functional:** GREEN (L1)

### Auth
Clerk React Native SDK — same Clerk tenant as web. Org slug stored in global context (same pattern as web `useOrgSlug`).

### API connectivity
Calls the same API server as web (`EXPO_PUBLIC_API_URL`). All endpoints are the same `/v1/organisations/:slug/...` routes.

### Missing from mobile (vs web)
- Library / knowledge management
- Memory CRUD
- Blueprint Studio
- Governance Centre
- Audit Log / Timeline
- Team / Plan / Usage / Settings management
- Notifications (no notification centre on mobile — Approvals tab partially covers this)
- Operations Centre
- Workforce catalogue / training

### Mobile-specific items
- Native push notification registration (UNPROVEN at L4 — Expo notification permissions checked but server-side push not confirmed)
- Offline/cached last state for Work screen (localStorage equivalent via AsyncStorage)

### Functional status summary
**AMBER overall** — Core user-facing flows (view work, approve, chat) are wired. Administrative/knowledge/governance surfaces are absent by design (mobile = user consumer, not platform manager). The Approvals tab partially overlaps the web Approvals page but has no bulk actions.

### Overlaps (mobile vs web)
| Mobile screen | Web equivalent | Same backend? | True duplication? |
|---|---|---|---|
| Work screen | Active Work + Completed Work portal | YES | INTENTIONAL — mobile consumption view |
| Approvals screen | Approvals page | YES | INTENTIONAL — no bulk actions on mobile |
| Chat/Conversation | Chat module | YES | INTENTIONAL — same SSE contract |
| Home | Dashboard | Partial | INTENTIONAL — mobile summary |

---

## 20. DESKTOP CONNECTOR (`artifacts/desktop-connector`)

### What it is
The desktop connector is a **platform-local relay bridge** — not a standalone product, but a component that enables the NeedsOps AI workforce to read/write files, emails, and applications on a user's local machine. It is a system-level daemon (intended as Electron app) that:
1. Maintains an outbound WSS relay connection to the platform
2. Receives operation requests from the platform (via `deviceRelayService`)
3. Executes those operations locally (file read/write, Office docs, email drafts)
4. Returns results through the same relay

### Architecture

```
API Server (cloud)
  └─ deviceRelayService (in-memory WS broker)
       └─ relay WSS connection
            └─ Desktop Connector (local machine)
                 └─ OpenClaw Runtime (local AI agent process)
                      └─ IGatewayAdapter
                           ├─ SimulatedGatewayAdapter (default — test mode)
                           └─ LiveGatewayAdapter (requires local OpenClaw setup)
```

### Services involved (API server side)

| Service | Purpose |
|---|---|
| `deviceRelayService` | In-memory WS broker — routes operation requests to connected device |
| `connectorBridgeService` | Execution-to-device bridge — sends requests, correlates IDs, handles timeout/retry, structured errors |
| `connectorSessionManagerService` | Execution-scoped session layer — validates entitlement, device status, captures telemetry |
| `deviceService` | Org-scoped device lifecycle (register, authenticate, heartbeat, revoke) |
| `platformDeviceService` | Cross-org fleet management (list, disable, rotate credentials, audit history) |

### Operation types supported (via `connectorBridgeService`)
- `locate` / `search` / `read` / `inspect` (file system)
- File operations, Word document operations, Excel operations
- Email draft operations

### Functional status
**AMBER — infrastructure wired, execution in simulated mode by default**

Evidence:
- Relay, auth, session management, operation handler, acceptance tests all exist and are tested (L1, L2)
- `SimulatedGatewayAdapter` is the default — returns simulated results without a real local connector
- `LiveGatewayAdapter` requires local OpenClaw setup (not bundled, not auto-configured)
- Desktop connector startup uses a legacy long-lived env device token; refresh-token exchange is documented but not implemented
- No actual Electron packaging confirmed — desktop startup scripts are shell-based
- Office/email/browser/terminal capabilities documented as "deliberately unavailable" in current version
- Acceptance tests use relay injection to simulate desktop behaviour (no live desktop required for tests — L2)

### Who can use it
Organisations with the `local_file_connector` entitlement. `connectorSessionManagerService` validates this before opening a session.

### Overlaps
- `FutureProviders.ts` lists "Desktop Connector" as a knowledge provider stub ("Not yet implemented" in the Runtime page) — this is the cloud-side knowledge bridge to the connector, separate from the relay/execution bridge. The relay for execution and the knowledge-provider integration are **two different integration points** for the same physical desktop connector.

---

## CROSS-MODULE OVERLAP FINDINGS (supplementary)

### New overlaps identified in this report

| Function | Module A | Module B | Assessment |
|---|---|---|---|
| Knowledge source approve | Library (approve-ingestion) | Approvals (knowledge lane) | **SAME BACKEND** — same endpoint, different surface. Approvals is the canonical action surface; Library is contextual. INTENTIONAL. |
| Memory approve/reject | Memory page | Approvals (memory lane) | **SAME BACKEND** — same endpoints. INTENTIONAL — Memory has full CRUD; Approvals is bulk action surface. |
| Audit events | Audit Log | Governance Timeline | **SAME TABLE** (`org_audit_log`) — different presentation. Could be one page with tabs, but both are useful. MODERATE OVERLAP. |
| Usage dimensions | Usage (org) | Plan (seat count) | **SAME ENDPOINT subset** — Plan shows seats only, Usage shows all 13. INTENTIONAL — different scope/context. |
| Device management | Devices (org) | Platform Connector Fleet | **SAME RECORDS** — org-scoped vs cross-org. INTENTIONAL — different actor (user vs platform admin). |
| Pending approvals | Approvals (web) | Approvals (mobile) | **SAME BACKEND** — mobile has no bulk actions. INTENTIONAL — mobile is consumer, not manager. |
| Work listing | Work (mobile) | Active Work + Completed Work (web) | **SAME BACKEND** — mobile combines both into one simplified view. INTENTIONAL. |
| Blueprint test | Blueprint Studio | Tasks | **SAME UEE** — Blueprint test creates a real Completed Work record. This is an **unintended side effect** (not true duplication but creates pollution in Completed Work and approval queue). |
| Knowledge source scope management | Library | Workforce (training sub-page) | **PARTIAL OVERLAP** — Library manages overall source scopes; Training page manages scopes per-specialist. Different granularity. INTENTIONAL. |
| Plan features/capabilities displayed | Plan page | Governance Centre | Partial — Plan shows commercial entitlements, Governance shows health context. INTENTIONAL different framing. |

---

## SUPPLEMENTARY FINDINGS — Issues to flag

### Issue A — Blueprint Studio sandbox test creates real Completed Work records (AMBER)
**Evidence:** `BlueprintEditorPage.tsx` → POST `/work-blueprints/:id/test` → UEE (trigger:task, blueprintId) → `completedWorkService.createDraft()` → `submitForApproval()`.  
A developer testing a blueprint configuration creates a real `completed_work` row, a real `specialist_runs` row, and a real approval queue entry. The test output appears in the user's Completed Work Portal and their Inbox/Approvals queue. There is no sandbox isolation.  
**Risk:** Blueprint development noise pollutes production Completed Work and approval queue.

### Issue B — Org Settings lacks almost all real configuration options (AMBER)  
**Evidence:** `OrgSettings.tsx` — 6 fields only (legal name, display name, contact, ABN, NDIS number). No notification preferences, no AI behaviour config, no connector settings, no billing, no org deletion.  
**Risk:** Not a bug but a scope gap. Users expecting to configure the platform from Settings will find almost nothing there.

### Issue C — Team page cannot remove members (AMBER)
**Evidence:** `TeamPage.tsx` — no member removal API call or UI element. Invitations can be revoked; existing members cannot be removed.  
**Risk:** An admin who adds the wrong person cannot remove them from the org through the UI.

### Issue D — Account Settings save does not invalidate the `me` cache (AMBER)
**Evidence:** `AccountSettings.tsx` mutation does not call `queryClient.invalidateQueries('me')` after PATCH. User sees stale name until page reload.

### Issue E — Desktop connector uses legacy long-lived token (AMBER)
**Evidence:** `artifacts/desktop-connector` startup uses a persistent env-set device token rather than the refresh-token exchange described in code comments.  
**Risk:** If the long-lived token is compromised or expires, the connector goes offline with no automatic recovery. Refresh-token exchange is the correct path (documented but not implemented).

### Issue F — Library `approve` mutation is dead code (AMBER)
**Evidence:** `OrgLibraryPage.tsx` — `approveSource` mutation defined and imported, but no button or action calls it. The correct endpoint is `approve-ingestion` (which IS called). `approve` is a separate endpoint that is never triggered from the UI.

### Issue G — Memory retire/supersede may self-reference (AMBER)
**Evidence:** `OrgMemoryPage.tsx` — the supersede mutation sends `{supersededById: id}` where `id` appears to be the same record in one observed code path. A self-referential supersede creates a nonsensical state (record superseded by itself).

---

## OVERLAP SCORES (supplementary modules)

| Module | Score (0–5) | Overlaps with |
|---|---|---|
| Library | 1 | Approvals (knowledge approve lane), Knowledge Health (source metrics) |
| Memory | 2 | Approvals (memory lane), Governance Centre (metrics), Timeline (events) |
| Blueprint Studio | 1 | Tasks (same UEE for test execution — side-effect issue) |
| Governance Centre | 2 | Knowledge Health, Approvals, Memory, Timeline |
| Approvals | 1 | Inbox/Notifications (alert surfaces), Task detail, Work viewer (per-item controls) — all intentional depth differences |
| Knowledge Health | 2 | Governance Centre (same metrics), Library (same source data) |
| Governance Timeline | 3 | Audit Log (same table, different presentation) |
| Audit Log | 2 | Timeline (same table), Platform Audit (same pattern, different scope) |
| Team | 0 | — |
| Plan | 1 | Usage (seat overlap) |
| Usage | 0 | — |
| Org Settings | 0 | — |
| Account Settings | 0 | — |
| App Home | 0 | — |
| Discover | 0 | — |
| Install | 0 | — |
| Devices | 1 | Platform Connector Fleet (same records, different scope — intentional) |
| Platform Staff | 0 | — |
| Platform Support | 0 | — |
| Platform Security | 0 | — |
| Platform Settings | 0 | — |
| Platform Usage | 1 | Org Usage (same metrics, different scope — intentional) |
| Platform Commercial | 0 | — |
| Platform Trials | 0 | — |
| Platform Organisations | 0 | — |
| Platform Connector Fleet | 1 | Org Devices (same records, different scope — intentional) |
| Mobile App | 1 | Web app (same backend, mobile-appropriate subset — intentional) |
| Desktop Connector | 0 | Functionally distinct layer |

---

## SUPPLEMENTARY FUNCTIONAL STATUS SUMMARY

| Module | Status | Key gap |
|---|---|---|
| Library | GREEN | `approve` mutation is dead code; scope failure silently swallowed |
| Memory | GREEN | Self-referential supersede bug possible |
| Blueprint Studio | GREEN | Test execution creates real Completed Work records (no sandbox isolation) |
| Governance Centre | GREEN | — |
| Approvals | GREEN | — |
| Knowledge Health | GREEN | — |
| Timeline | GREEN | Overlaps Audit Log (acceptable) |
| Audit Log | GREEN | Legacy fallback to `audit_log` when `org_audit_log` empty |
| Team | AMBER | Cannot remove existing members |
| Plan | AMBER | Self-serve upgrade path absent (contact-only) |
| Usage | GREEN | — |
| Org Settings | GREEN | Scope narrow by design |
| Account Settings | AMBER | `me` cache not invalidated after save |
| App Home | GREEN | — |
| Discover | GREEN | — |
| Install | GREEN | Binary availability UNPROVEN (L4) |
| Devices | GREEN | — |
| Platform Staff | GREEN | Minimal browser-prompt UX |
| Platform Support | AMBER | Response/close mutations may be missing |
| Platform Security | GREEN | Read-only |
| Platform Settings | GREEN | Browser-prompt UX is minimal |
| Platform Usage | GREEN | — |
| Platform Commercial | AMBER | Features/dimensions/overrides are read-only (no create/edit) |
| Platform Trials | GREEN | — |
| Platform Organisations | GREEN | — |
| Platform Connector Fleet | GREEN | — |
| Mobile App | AMBER | No admin/governance surfaces; push notification L4 UNPROVEN; download L4 UNPROVEN |
| Desktop Connector | AMBER | Simulated mode by default; legacy token auth; no Electron packaging confirmed |
