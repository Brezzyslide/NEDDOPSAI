# NEEDSOPS AI+ — FULL BUILD AND DIRECTION AUDIT

```
Audit date:                 25 July 2026
Current sprint:             Sprint 7.1 (complete)
Test status:                299/299 passing — 14 test files
Applications inspected:     API Server · NeedsOps Web Portal · NeedsOps Mobile (Expo)
Overall maturity score:     31 / 100
Direction status:           ON TRACK — architecture is correct; execution layer not yet started
Real execution status:      NOT BUILT — no AI executes real work; all task "execution" is state-machine simulation
External customer readiness: NOT READY — no payment, no real AI output, tasks produce no external side-effects
Strongest completed areas:  Multi-tenancy + RLS · Platform Console · Entitlements · Audit infrastructure · Org-DB isolation
Largest gaps:               Execution engine · OpenClaw · Real LLM routing · Stripe billing · Browser/local execution
Direction drift:            None detected — vision is intact, sprint order has been correct; gap is execution, not drift
Immediate recommendation:   Build the messaging interface and real LLM-backed Chief of Staff before adding more infrastructure
Next recommended sprint:    Sprint 8 — Messaging Interface + Live AI Routing
```

---

## Section 1 — Executive Summary

NeedsOps AI+ has built an unusually strong operational and governance foundation for a platform at this stage. Multi-tenancy is real, RLS is enforced at the database level and verified at startup, audit logging is comprehensive, the platform console gives operators genuine control over organisations and plans, and the entitlements engine correctly gates access based on subscription state. These are not placeholders — they are production-quality implementations.

However, the product as it stands today cannot perform a single real AI task. Every piece of work that a customer submits enters a state machine and stops. The Chief of Staff routes it deterministically using keyword matching. No LLM is called. No tool executes. No browser is touched. No file is read. The task transitions to `completed` only if manually advanced. The gap between the governance layer and the execution layer is complete.

**Strongest completed areas**
- Tenant isolation (PostgreSQL RLS across 19 tables, verified at server startup)
- Platform Console (org management, plan designer, trial management, usage monitoring, audit viewer)
- Entitlements and plan enforcement
- Org-DB per-tenant schema isolation
- AI Privacy Gateway (enforcement layer built; provider not yet connected)
- Sprint cadence and architectural discipline

**Largest unfinished areas**
- Execution engine (no real AI, no tool dispatch, no browser, no local device)
- OpenClaw integration (no gateway, no client, no adapter)
- Real LLM routing (Chief of Staff is deterministic keyword matching only)
- Stripe billing (no SDK, no checkout, no webhook handler)
- Intelligence engines (SCHADS, NDIS — type stubs only, no implemented rules)
- Mobile tasks and approvals screens (hardcoded placeholder data)

**Product direction**
The architecture is correct and the central vision has not drifted. The Workforce Role / Worker Profile separation is enforced. The AI Privacy Gateway is in the right place. The connector and intelligence engine abstractions are correctly positioned. The platform has not become a CRM or a chatbot. It is, however, currently an empty governance shell waiting for an execution engine to be inserted.

**Can a real external customer use it meaningfully today?**
No. A customer can register, be assigned a trial, browse the workforce catalogue, create a task, and see it appear in the task list. The task will never produce output. No AI work occurs.

**Maturity score: 31 / 100**

The score is not low because the code is poor — the code that exists is good. The score reflects that the defining capability of the product (an AI workforce that executes real work) does not exist yet. Governance and infrastructure are complete (~75% of that layer done). The product experience layer is 0–15% complete. This is an appropriate distribution for a platform that has correctly prioritised foundations, but the execution layer must now be built.

**Single most important next milestone**
A customer types a message. The Chief of Staff calls a real LLM. The LLM selects a specialist. The specialist produces a real output. The customer sees it. This has never happened. Sprint 8 must make it happen.

---

## Section 2 — Sprint-by-Sprint Audit

### Sprint 0: Platform Foundation

**Original objective:** Monorepo, Express API, database schema, React web shell, Expo mobile shell, OpenAPI-first contract.

**What was actually delivered:**
- pnpm monorepo with four artifacts (API, web, mobile, mockup sandbox)
- Express API with health and system routes
- Three-table initial schema (organisations, users, memberships)
- OpenAPI YAML as source of truth with Orval codegen for React Query hooks
- Expo mobile shell with Clerk auth scaffolding
- Drizzle ORM configured

**Status:** LIVE

**Evidence:**
- `artifacts/api-server/src/app.ts`, `index.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/` (generated hooks)
- `artifacts/needsops-mobile/app/_layout.tsx`

**Important deviations:** None. Foundation was executed as planned.

**Technical debt introduced:** `workforceRegistry.ts` and `workerProfileRegistry.ts` were introduced as static data files and have grown to 725 and 705 lines respectively — candidates for splitting.

**Does it support the original vision?** Yes.

---

### Sprint 1: Identity, Organisations and Tenant Security

**Original objective:** Clerk authentication, JIT user provisioning, organisation CRUD, membership management, 6-role RBAC, invitation system, audit logging.

**What was actually delivered:**
- Clerk integration with JIT provisioning (`tenantContext.ts`)
- Organisation create/read/update with slug-based routing
- Membership management with 6 roles (owner, admin, member, viewer, auditor, compliance_officer)
- Invitation system with token-hashed secure links and email delivery via Resend
- Audit log (`audit_log` table)
- `requirePermission` middleware with 30+ defined permission actions

**Status:** LIVE

**Evidence:**
- `artifacts/api-server/src/middlewares/tenantContext.ts`
- `artifacts/api-server/src/middlewares/requirePermission.ts`
- `artifacts/api-server/src/services/invitationService.ts`
- `lib/permissions/src/roles.ts` (30+ actions defined)
- `lib/db/src/schema/memberships.ts`, `invitations.ts`
- Email delivery: `artifacts/api-server/src/services/email/resendEmailService.ts`

**Important deviations:**
- Email delivery (Resend) was added as a sub-sprint not in the original plan — a sensible addition.

**Technical debt introduced:**
- Permission enforcement depends on `requirePermission` being manually applied per route. Several platform admin routes bypass this with `requirePlatformRole` only, meaning tenant-scoped actions on platform routes could be under-enforced if a new route is added carelessly.

**Does it support the original vision?** Yes.

---

### Sprint 2: AI Workforce Foundation

**Original objective:** 32 Workforce Roles, capabilities, Chief of Staff routing, task and approval models.

**What was actually delivered:**
- 32 specialists defined in `workforceRegistry.ts` across 6 packs (Core, Compliance, Operations, Finance, HR, Marketing)
- 35 capabilities defined
- Chief of Staff service with deterministic keyword-based routing
- Task state machine: `draft → queued → planning → awaiting_approval → approved → executing → completed/failed`
- Approval model: create, resolve, expire
- Task execution plan stored as JSONB

**Status:** PARTIAL

**Evidence:**
- `artifacts/api-server/src/lib/workforceRegistry.ts` (725 lines, static data)
- `artifacts/api-server/src/services/chiefOfStaffService.ts` (keyword routing)
- `lib/db/src/schema/tasks.ts`, `approvals.ts`, `taskExecutionPlans.ts`
- `src/__tests__/workforce.test.ts` (43 tests passing)

**Important deviations:**
- Chief of Staff uses keyword matching (`ROUTING_RULES` regex array), not an LLM. This was a deliberate decision noted in architecture docs ("zero latency, testable, cost-controlled") but it means the CoS cannot handle novel requests, nuanced language, or multi-step delegation intelligently.
- Execution plan is stored as JSONB but execution never runs. The `executing` state is never actually populated by real work.

**Technical debt introduced:**
- The word "executing" in the task state machine implies real work occurs. It does not. This is a semantic gap that will confuse developers and customers.

**Does it support the original vision?** Partly — the data model and routing structure support the vision, but without real AI execution the workforce is a catalogue, not a workforce.

---

### Sprint 2 Architecture Correction

**Original objective:** Separate Workforce Role (expertise and responsibility) from Worker Profile (permitted tools and execution surfaces).

**What was actually delivered:**
- `workerProfileRegistry.ts` with profiles for all 32 specialists
- Each profile defines: `allowedChannels`, `allowedBrowserDomains`, `allowedLocalPathCategories`, `allowedApplicationCategories`, `prohibitedActions`, `riskLevel`, `requiresApprovalFor`
- Architecture now distinguishes: Role = who, Profile = how

**Status:** METADATA ONLY

**Evidence:**
- `artifacts/api-server/src/lib/workerProfileRegistry.ts` (705 lines)
- Profile fields `allowedBrowserDomains` and `allowedLocalPathCategories` are explicitly noted in the file as "empty arrays until live"
- No enforcement layer reads from these profiles at runtime

**Important deviations:** The profile registry is correct and well-structured, but none of it is enforced during task execution because task execution does not exist.

**Does it support the original vision?** Partly — the concept is right, enforcement is missing.

---

### Sprint 3: Entitlements, Subscriptions and Usage

**Original objective:** Plan catalogue, workforce pack entitlements, feature flags, seat limits, usage tracking, tenant overrides.

**What was actually delivered:**
- Four plans: Foundation, Professional, Business, Enterprise (seeded)
- Plan versioning (immutable plan versions with cloning)
- Feature flags and plan feature linking
- `EntitlementService` with 5-level resolution: subscription status → explicit denials → overrides → plan features → workforce packs
- Usage recording (idempotent, period summaries)
- Seat limit enforcement
- Trial support (14-day default, configurable)

**Status:** LIVE

**Evidence:**
- `artifacts/api-server/src/services/entitlementService.ts` (554 lines, real DB logic)
- `lib/entitlements/` package
- `lib/db/src/schema/plans.ts`, `planFeatures.ts`, `features.ts`
- `artifacts/api-server/src/services/usageService.ts` (functional and idempotent)
- Test suite: sprint3 tests passing

**Important deviations:**
- Stripe is absent. Commercial transitions (trial → paid) require manual database updates. This is a documented gap, not a drift.

**Technical debt introduced:**
- Usage recording currently uses dev fixtures for AI usage dimensions because there is no real AI execution to meter. The `ai_tasks` dimension is written but not driven by real consumption.

**Does it support the original vision?** Yes — the commercial governance layer is well built.

---

### Sprint 4: Platform Console

**Original objective:** Staff-only `/platform` interface for NeedsOps operators to manage organisations, plans, trials, workforce packs, and usage.

**What was actually delivered:**
- `/platform` route protected by `requirePlatformRole`
- Multi-tab platform dashboard with metrics and audit viewer
- Organisation directory with search, filter, suspend/reactivate
- 13-tab org detail view (Overview, Members, Subscription, Usage, Workforce, Tasks, Approvals, Audit, Security, Notes, Database, Backups, Settings)
- Plan Designer (create/version plans, activate versions, clone features)
- Workforce management (packs, specialists, cross-org grant stats)
- Trial management (start, extend, cancel, view expiring trials)
- Usage monitoring (global and per-org)
- Internal notes and security flagging

**Status:** LIVE (Stripe management: NOT BUILT)

**Evidence:**
- `artifacts/needsops-web/src/pages/platform/` (all pages present and connected to real API)
- `artifacts/api-server/src/routes/v1/platform.ts` (mounts 12 sub-routers)
- `artifacts/api-server/src/routes/v1/platformOrgs.ts`, `platformCommercial.ts`, `platformWorkforce.ts`

**Important deviations:**
- Platform Tasks tab shows only aggregate counts (operational content is blocked by design — correct Sprint 5 decision).
- Stripe billing management is listed in the console design but has no routes or UI implementation.

**Does it support the original vision?** Yes.

---

### Sprint 5: Security Hardening

**Original objective:** PostgreSQL RLS across all tenant tables, audit log split (platform vs. org), two-layer tenant isolation.

**What was actually delivered:**
- RLS enabled and enforced on 19 tables
- `withTenantContext` / `withOrgMemberContext` wrappers set session variables for RLS policies
- Startup check (`runRLSStartupCheck`) prevents server start if RLS is missing or `needsops_app` has bypass
- Audit log split: `platform_audit_log`, `org_audit_log`, `audit_log`
- `requirePermission` middleware formalised

**Status:** LIVE

**Evidence:**
- `artifacts/api-server/src/startup/rlsStartupCheck.ts`
- `lib/db/src/schema/` (19 tables with RLS policies verified in test)
- `src/__tests__/sprint7-rls-safety.test.ts` (all passing)
- Migration: `sprint5-rls.sql`

**Technical debt introduced:**
- `approval_history` rows created before Sprint 5 had no `organization_id`. After RLS activation these rows are invisible to the application. Migration noted this risk but left orphaned rows in place.

**Does it support the original vision?** Yes.

---

### Sprint 6: Org-DB Foundation

**Original objective:** Per-organisation database schema isolation, `@workspace/org-db` package, automated provisioning.

**What was actually delivered:**
- `lib/org-db/` package with schema: `org_tasks`, `org_approvals`, `org_memberships`, `org_audit_log`
- `org_database_registry` table tracking connection parameters per org
- `withOrgMemberContext` for org-scoped DB access
- Schema provisioning scripts

**Status:** LIVE (shared cluster only; dedicated cluster: PARTIAL)

**Evidence:**
- `lib/org-db/src/schema.ts`
- `lib/db/src/schema/orgDatabaseRegistry.ts`
- `scripts/provision-org.ts`

**Important deviations:**
- Current implementation uses shared PostgreSQL cluster with per-org schemas. Dedicated database clusters are architecturally supported but require additional infrastructure provisioning (not yet done).

**Technical debt introduced:**
- Schema duplication: `lib/db` and `lib/org-db` define overlapping table structures (`tasks`, `approvals`, `memberships`). The shared-schema versions in `lib/db` remain accessible, creating risk of writes going to the wrong target if the context wrapper is not used consistently.

**Does it support the original vision?** Yes.

---

### Sprint 7 / 7.1: Platform Database Boundary

**Original objective:** Dedicated DB-per-org support, AES-256-GCM secret storage, backup/restore, AI Privacy Gateway, RLS startup enforcement.

**What was actually delivered:**
- `lib/secrets/` with AES-256-GCM encryption for org database credentials
- Backup and restore runbooks and scripts
- `lib/ai-gateway/` — AI privacy enforcement layer (purpose allowlists, role checks, field access controls, audit logging)
- RLS startup check (server refuses to boot if RLS is missing)
- Write restrictions on legacy `audit_log` table
- Generic org provisioning framework (`scripts/provision-org.ts`, `scripts/create-test-org.ts`)

**Status:** LIVE (AI gateway: enforcement LIVE, provider connection NOT BUILT)

**Evidence:**
- `lib/secrets/` (AES-256-GCM implemented)
- `lib/ai-gateway/src/aiGateway.ts` (enforcement runs; LLM provider call returns stub)
- `artifacts/api-server/src/startup/rlsStartupCheck.ts`
- `src/__tests__/sprint7-rls-safety.test.ts` (21 tests passing)
- `scripts/provision-org.ts` (generic, UUID-based, idempotent)

**Technical debt introduced:**
- AI gateway currently returns a hardcoded stub string for the "internal" provider. The enforcement logic is correct and would apply to a real provider, but the provider adapter is not implemented.

**Does it support the original vision?** Yes.

---

## Section 3 — Customer Journey Audit

### 1. Public Landing Page
**Status:** PLACEHOLDER  
**What the user can do:** See a static marketing page with hardcoded hero text, feature bullets, and icons.  
**What is missing:** Real pricing links, plan comparison, call-to-action that leads to registration, any dynamic content.  
**Evidence:** `pages/LandingPage.tsx` — all content hardcoded, no API calls.

### 2. Public Plan Comparison
**Status:** PARTIAL  
**What the user can do:** The plan catalogue exists at `GET /v1/plans` and the data is seeded. A plan listing page is not directly linked from the landing page.  
**What is missing:** A public `/pricing` page. The data is available; no page renders it publicly.  
**Evidence:** `routes/v1/plans.ts` (real API), no public pricing page in web routes.

### 3. Plan Selection
**Status:** NOT BUILT  
**What the user can do:** Nothing. There is no plan selection UI during or after registration.  
**What is missing:** A plan selection flow, checkout, or trial-start triggered by the user.  
**Evidence:** No `PlanSelection.tsx` or equivalent page found. Org creation does not assign a plan.

### 4. Registration
**Status:** LIVE  
**What the user can do:** Register with email/password via Clerk's hosted UI or the Expo sign-up screen.  
**What is missing:** Branded registration flow. Post-registration direction to onboarding is implicit.  
**Evidence:** `artifacts/needsops-mobile/app/(auth)/sign-up.tsx`, Clerk configuration.

### 5. Email Verification
**Status:** LIVE  
**What the user can do:** Receive and complete email verification via Clerk.  
**What is missing:** Custom transactional email template (Clerk's default is used).  
**Evidence:** `useSignUp` hook with `emailAddress.prepareVerification()` in mobile.

### 6. Organisation Creation
**Status:** LIVE  
**What the user can do:** Create an organisation (name, slug, industry, country) via the web onboarding flow.  
**What is missing:** Organisation creation does not trigger trial assignment or plan selection automatically.  
**Evidence:** `pages/OrgOnboarding.tsx`, `POST /v1/organisations`.

### 7. Trial or Subscription Assignment
**Status:** PARTIAL (manual only)  
**What the user can do:** Nothing self-service. A platform admin can manually start a trial via the console.  
**What is missing:** Automatic trial assignment on org creation. The `platform_settings` seed includes a 14-day trial default, but no code automatically applies it when a new org is created.  
**Evidence:** `seed-platform-defaults.ts` (trial_duration_days = 14), no auto-assign hook in `orgService.ts`.

### 8. Login
**Status:** LIVE  
**What the user can do:** Log in via Clerk on web (hosted UI redirect) or mobile (native Clerk screen).  
**What is missing:** None — login works end to end.  
**Evidence:** `app/(auth)/sign-in.tsx`, Clerk session management.

### 9. Organisation Dashboard
**Status:** LIVE  
**What the user can do:** See organisation details, member list, workforce packs assigned, recent tasks, pending approvals, subscription status, usage metrics, seat counts — all loaded from real API calls.  
**What is missing:** Real usage data (AI task consumption is zero because no tasks execute).  
**Evidence:** `pages/app/AppDashboard.tsx` (8 real API calls), all routes functional.

### 10. AI Workforce Discovery
**Status:** LIVE  
**What the user can do:** Browse workforce packs and specialists via the Workforce Browser page and mobile Workforce tab. See names, descriptions, capabilities, pack tiers.  
**What is missing:** Specialist detail pages. Filtering by capability. Understanding of what a specialist will actually do.  
**Evidence:** `pages/WorkforceBrowser.tsx`, `GET /v1/workforce/packs`, `GET /v1/workforce/specialists`.

### 11. Messaging Interface
**Status:** NOT BUILT  
**What the user can do:** Nothing. No chat or messaging interface exists anywhere in the web or mobile app.  
**What is missing:** The entire messaging surface — the core product interaction point. A customer cannot type instructions to the workforce.  
**Evidence:** No messaging page, component, or WebSocket handler found in any artifact.

### 12. Task Creation
**Status:** PARTIAL  
**What the user can do:** Create a task via a form in TaskCentrePage (title, description, priority). The task is saved to the database with `draft` status.  
**What is missing:** Task creation via natural language messaging (the intended UX). Rich task context. File attachments.  
**Evidence:** `pages/app/TaskCentrePage.tsx`, `POST /v1/organisations/:slug/tasks`.

### 13. Chief of Staff Planning
**Status:** SIMULATED  
**What the user can do:** A task transitions to `planning` state. The Chief of Staff service runs keyword matching and produces a plan (specialist list + steps).  
**What is missing:** Real LLM-based intent classification. Multi-turn clarification. Handling of ambiguous or novel requests. The plan is stored but never executed.  
**Evidence:** `services/chiefOfStaffService.ts` (keyword routing), `POST /v1/organisations/:slug/tasks/:taskId/transition`.

### 14. Workforce Role Assignment
**Status:** SIMULATED  
**What the user can do:** After planning, the task shows assigned specialists from the registry.  
**What is missing:** Dynamic role assignment based on task context. Multi-role coordination. The assignment is deterministic and static.  
**Evidence:** `chiefOfStaffService.ts` — `ROUTING_RULES` array with keyword-to-specialist mapping.

### 15. Worker Profile Mapping
**Status:** METADATA ONLY  
**What the user can do:** Nothing visible. Worker profiles are defined in the registry.  
**What is missing:** Any enforcement of worker profile permissions during execution. The profiles are never consulted at runtime because execution does not run.  
**Evidence:** `workerProfileRegistry.ts` — profiles defined, never enforced.

### 16. Execution Planning
**Status:** SIMULATED  
**What the user can do:** A JSON execution plan is created and stored in `task_execution_plans`.  
**What is missing:** The plan is a deterministic template, not an AI-generated plan. No step-level tool selection. No resource allocation.  
**Evidence:** `lib/db/src/schema/taskExecutionPlans.ts`, plan stored as JSONB blob.

### 17. Approval
**Status:** LIVE  
**What the user can do:** Request approvals, see pending approvals in the web Approvals page and API. Resolve (approve/reject) approvals. The approval state machine is real.  
**What is missing:** Approval is triggered correctly but the work that follows approval has nowhere to go (no execution engine).  
**Evidence:** `services/approvalService.ts`, `pages/app/ApprovalsPage.tsx`, all functional.

### 18. Runtime Execution
**Status:** NOT BUILT  
**What the user can do:** Nothing. The task state machine moves to `executing` but no code runs.  
**What is missing:** Everything — execution engine, tool dispatch, result capture, streaming, error recovery.  
**Evidence:** `lib/agent-runtime/src/runner.ts` is interfaces only ("Sprint 0 shell").

### 19. Browser Execution
**Status:** NOT BUILT  
**What the user can do:** Nothing.  
**What is missing:** Browser session pairing, extension, domain allowlist enforcement, tab-level access, form filling, screenshot capture.  
**Evidence:** `allowedBrowserDomains` field in worker profiles is an empty array with comment "future sprint".

### 20. Local Computer Execution
**Status:** NOT BUILT  
**What the user can do:** Nothing.  
**What is missing:** NeedsOps Connect application, device pairing, path approval, local execution runtime.  
**Evidence:** `allowedLocalPathCategories` field is empty array with comment "future expansion".

### 21. Result Delivery
**Status:** NOT BUILT  
**What the user can do:** See task status change to `completed` (if manually transitioned). No actual output.  
**What is missing:** Output capture, result formatting, delivery to user, notification.  
**Evidence:** No output storage model or result delivery service exists.

### 22. Usage Recording
**Status:** PARTIAL  
**What the user can do:** Usage dimensions are recorded. The `usageService` is functional.  
**What is missing:** Real consumption data. Usage recording calls exist but are not triggered by real AI execution. The `ai_tasks` counter does not move because no AI tasks execute.  
**Evidence:** `services/usageService.ts` (functional), `usage_events` table.

### 23. Upgrade or Payment
**Status:** NOT BUILT  
**What the user can do:** Nothing self-service. View plan details in the org dashboard.  
**What is missing:** Stripe checkout, subscription upgrade flow, invoice generation, failed payment handling.  
**Evidence:** No Stripe SDK, no checkout route, no payment webhook handler.

### 24. Mobile Experience
**Status:** PARTIAL  
**What the user can do:** Sign in/up, see dashboard with real API data, browse organisations, browse workforce, see system status.  
**What is missing:** Tasks screen (placeholder data), Approvals screen (placeholder data), no mobile messaging interface, no push notifications, no deep links configured.  
**Evidence:** `app/(tabs)/tasks.tsx` (uses `PLACEHOLDER_TASKS`), `app/(tabs)/approvals.tsx` (uses `PLACEHOLDER_APPROVALS`).

**The customer journey stops being real at step 12.** From task creation onward, everything is simulation, metadata, or not built. The user submits work and receives no output.

---

## Section 4 — Platform Owner Journey Audit

Access setup: A platform role must be manually inserted into `platform_roles` with `role = 'platform_super_admin'` for the first operator, or the Clerk metadata `platformAdmin: true` flag must be set. This is documented in runbooks but not automated.

| Capability | Status | Evidence |
|---|---|---|
| Access the console | LIVE | `requirePlatformAuth` + Clerk `platformAdmin` flag or DB platform role |
| View organisations | LIVE | `GET /v1/platform/organisations` + `PlatformOrgs.tsx` |
| Search organisations | LIVE | Query params on list endpoint, search UI in `PlatformOrgs.tsx` |
| Inspect tenant details | LIVE | 13-tab `PlatformOrgDetail.tsx` loaded from real API |
| Suspend and reactivate organisations | LIVE | `POST /:id/suspend` + `POST /:id/reactivate` with reason capture |
| Manage trials | LIVE | `POST /:id/trial/start`, `/extend`, `/cancel`; expiry monitoring |
| Create and version plans | LIVE | `platformCommercial.ts` CRUD + Plan Designer UI |
| Set monthly and annual price values | LIVE | `monthlyPriceCents`, `annualPriceCents` fields in plan version |
| Set currencies | LIVE | `currency` field on plan version (defaults AUD) |
| Manage workforce packs | LIVE | `platformWorkforce.ts` + `PlatformWorkforce.tsx` |
| Manage features | LIVE | Feature CRUD via `platformCommercial.ts` |
| Manage usage limits | LIVE | Usage allowances on plan versions, override service |
| Manage seat limits | LIVE | Seat allowances configurable per plan version |
| Manage tenant overrides | LIVE | Explicit denial and override system in entitlements |
| Grant platform roles | LIVE | `platform_roles` table, route to assign roles |
| View audit history | LIVE | Cross-org audit log viewer with actor/event/org filtering |
| Add internal notes | LIVE | `platform_internal_notes` table + Notes tab in org detail |
| Export organisation information | LIVE | `GET /v1/platform/export/organisations` (CSV link in UI) |
| Monitor task failures | PARTIAL | Aggregate counts only; operational content blocked by design |
| Monitor execution sessions | NOT BUILT | No execution sessions exist |
| Monitor OpenClaw health | NOT BUILT | No OpenClaw integration |
| Monitor browser sessions | NOT BUILT | No browser session management |
| Monitor local devices | NOT BUILT | No device management |
| View connector health | NOT BUILT | Connector registry is metadata only |
| View subscription revenue | NOT BUILT | No Stripe data |
| Manage Stripe billing | NOT BUILT | No Stripe integration |

---

## Section 5 — AI Workforce Audit

### 32 Workforce Roles (Specialists)

**Status:** METADATA ONLY

The 32 specialists across 6 packs (Core, Compliance, Operations, Finance, HR, Marketing) are defined as static TypeScript objects in `workforceRegistry.ts`. They have names, descriptions, pack codes, capability lists, and `execution_status` fields. 24 are marked `available`; Marketing pack specialists are marked `coming_soon`.

- **Are they executable entities?** No. They are data records.
- **Do their capabilities affect real task planning?** The Chief of Staff reads specialist codes to build a plan, but the plan never executes.
- **Do they contain actual domain instructions?** No. Domain knowledge is reserved for Intelligence Engines, which are stubs.
- **Do they have memory?** No memory system exists.
- **Do they have tool access?** No tool registry or tool dispatch exists.
- **Can they produce outputs?** No.
- **Do they connect to OpenClaw?** No.
- **Can they be versioned?** Each specialist has a `version` string field. No versioning system enforces this.
- **Can they be enabled/disabled?** `execution_status` field exists. No runtime check reads it before execution (because execution doesn't exist).
- **Can different organisations configure them independently?** No per-org specialist configuration exists.

### Chief of Staff

**Status:** SIMULATED (deterministic keyword routing)

- **Routing:** Deterministic. `ROUTING_RULES` is an array of `{ patterns: RegExp[], specialists: string[], confidence: number }` objects. Input is matched against patterns; highest-confidence match wins.
- **Intent classification:** Keyword/regex matching only. Cannot handle novel phrasing, context, or multi-intent requests.
- **Multi-role delegation:** Supported structurally — the plan can list multiple specialists in sequence — but no real coordination occurs.
- **Auditable?** Yes — the plan is stored as JSONB with specialist codes and step descriptions.
- **Can it accept OpenAI or OpenClaw without redesign?** Yes. The `chiefOfStaffService` structure is clean enough to replace keyword matching with an LLM call. The AI gateway is already in place.
- **Where it will fail:** Any request that doesn't match a keyword pattern scores near zero. Ambiguous, conversational, or multi-topic requests will route incorrectly or not at all.

### Worker Profiles

**Status:** METADATA ONLY

- **Enforced or descriptive?** Descriptive only. No enforcement layer reads profiles at runtime.
- **Prohibited actions blocked?** No. `prohibitedActions` is defined but never checked.
- **Allowed channels enforced?** No. `allowedChannels` is defined but not gate-checked.
- **Browser domains configured?** All profiles have `allowedBrowserDomains: []` — explicitly noted as "future sprint".
- **Local paths configured?** All profiles have `allowedLocalPathCategories: []` — explicitly noted as "future expansion".
- **Do profiles map to OpenClaw?** The structure is compatible with future mapping. The `channel` types (`browser`, `api`, `local_files`, `internal`) align with OpenClaw's expected execution surfaces.

---

## Section 6 — Execution Readiness Audit

| Component | Status | Evidence |
|---|---|---|
| Execution engine abstraction | STUB | `lib/agent-runtime/src/runner.ts` — interfaces only, "Sprint 0 shell" |
| Mock runtime | NOT BUILT | No mock runtime; task state advances manually |
| OpenClaw runtime implementation | NOT BUILT | No gateway, client, or adapter |
| Execution plans | PARTIAL | Plans stored as JSONB in `task_execution_plans`; never consumed |
| Execution plan versioning | NOT BUILT | No versioning on execution plans |
| Execution sessions | NOT BUILT | No `execution_sessions` table or service |
| Execution steps | PARTIAL | Steps defined in JSONB plan; no step-level tracking table |
| Execution queue | NOT BUILT | No queue implementation |
| Tool registry | NOT BUILT | No tool registry |
| Connector registry | METADATA ONLY | Static `INTEGRATION_CONFIGS` in `lib/integrations/src/registry.ts` |
| Execution policy service | NOT BUILT | Worker profiles define policy; no enforcement layer reads them |
| Approval gates | LIVE | Approval state machine works; gating before execution exists structurally |
| Pause, resume, cancellation | PARTIAL | `cancelled` state exists in task machine; no mid-execution pause |
| Event streaming | NOT BUILT | No WebSocket, SSE, or streaming infrastructure |
| Retry handling | PARTIAL | `failed → queued` transition exists; no automatic retry trigger |
| Runtime health checks | NOT BUILT | No runtime to check |
| Output storage | NOT BUILT | No output model |
| Error recovery | NOT BUILT | No error recovery service |
| Tenant isolation | LIVE | RLS enforced; org-db isolation in place |
| Usage metering | PARTIAL | Framework exists; not driven by real consumption |

**Can NeedsOps currently perform a real task in a customer's browser?** No. No browser session, extension, or automation code exists.

**Can NeedsOps currently read a customer's approved local folder?** No. `allowedLocalPathCategories` is an empty metadata field. No NeedsOps Connect application exists.

**Can NeedsOps currently operate a local desktop application?** No. Same as above.

**Can NeedsOps currently perform a task through an external API?** No. The connector registry is static metadata. No OAuth flows, no API call execution, no credential management for external systems.

**Can NeedsOps currently communicate with OpenClaw?** No. No OpenClaw package, gateway client, or HTTP adapter exists anywhere in the codebase.

---

## Section 7 — OpenClaw Alignment Audit

No OpenClaw code, package, container, npm module, binary, or gateway is installed or referenced anywhere in the codebase except in documentation comments describing it as a future integration target.

| Item | Status |
|---|---|
| Adapter interfaces | STUB — `lib/agent-runtime/src/runner.ts` defines `Agent` interface; no OpenClaw-specific adapter |
| Environment variables | NOT BUILT — no `OPENCLAW_*` env vars defined or validated |
| Mock implementations | NOT BUILT |
| Runtime placeholders | NOT BUILT |
| Real gateway connection | NOT BUILT |
| Authentication method | NOT BUILT |
| Tenant workspace mapping | NOT BUILT |
| Session mapping | NOT BUILT |
| Specialist mapping | NOT BUILT |
| Tool policy mapping | NOT BUILT |
| Node pairing support | NOT BUILT |
| Streaming support | NOT BUILT |
| Health checks | NOT BUILT |
| Upgrade strategy | Documented as future work |
| Version pinning | NOT BUILT |
| Persistent state strategy | NOT BUILT |

**What is already prepared:**
- The AI Privacy Gateway (`lib/ai-gateway`) is the right abstraction layer. An OpenClaw provider would plug in here.
- Worker Profiles define `allowedChannels` with values that map conceptually to OpenClaw execution surfaces.
- The task state machine has the correct states for an OpenClaw execution lifecycle.
- The `agent-runtime` interfaces define `Agent`, `AgentRegistry`, and `ChiefOfStaffRouter` — these are the right shapes.

**What remains to connect:**
- OpenClaw package or client SDK must be installed and authenticated.
- A concrete `OpenClawRuntime` class implementing the `Agent` interface must be written.
- Tenant-to-workspace mapping (each org → OpenClaw workspace) must be implemented.
- Session lifecycle (create, stream, terminate) must be wired to the task state machine.
- Tool policy enforcement must read from Worker Profiles before allowing tool invocations.
- Streaming output must flow back to the web and mobile clients.

**Are current abstractions sufficient?** Yes, structurally. The interfaces are in the right places. No major refactoring is required before OpenClaw integration — only implementation.

**Does any refactoring need to happen first?** The split-brain schema issue (overlapping tables in `lib/db` and `lib/org-db`) should be resolved before adding execution, to ensure execution results are written to the correct schema consistently.

---

## Section 8 — Browser and Local Computer Vision Audit

| Capability | Status | Evidence |
|---|---|---|
| Browser-session pairing | NOT BUILT | No session pairing model or service |
| Browser-extension pairing | NOT BUILT | No extension code, no pairing protocol |
| Domain allowlists | METADATA ONLY | `allowedBrowserDomains: []` in worker profiles |
| Tab-level access | NOT BUILT | — |
| Visible execution state | NOT BUILT | No live execution stream to the UI |
| Form filling | NOT BUILT | No browser automation code |
| Uploads and downloads | NOT BUILT | — |
| Approval before submission | PARTIAL | Approval state machine exists; no browser-level gate |
| Customer stop control | NOT BUILT | No pause/stop signal to a running session |
| Device identity | NOT BUILT | No device identity model |
| One-time device pairing | NOT BUILT | — |
| Device revocation | NOT BUILT | — |
| Allowed local paths | METADATA ONLY | `allowedLocalPathCategories: []` in worker profiles |
| Path traversal protection | NOT BUILT | No local execution to protect |
| Symbolic-link protection | NOT BUILT | — |
| Local application allowlists | METADATA ONLY | `allowedApplicationCategories: []` in worker profiles |
| Local activity logs | NOT BUILT | — |
| Local pause and disconnect | NOT BUILT | — |

**Architecture assumption risk:** The current codebase has no components that wrongly *require* an API. The connector registry correctly acknowledges three execution types (API, Browser, Local). Worker Profile channels include `browser` and `local_files`. The abstraction layer does not force an API assumption. The risk is absence, not bad design.

---

## Section 9 — Connector and External System Audit

The connector registry (`lib/integrations/src/registry.ts`) contains a static `INTEGRATION_CONFIGS` map with entries for Google Workspace, Microsoft 365, Xero, and Zoho. Each entry includes OAuth scopes and a minimum plan tier.

| System | Status | Evidence |
|---|---|---|
| Google Workspace | METADATA ONLY | `INTEGRATION_CONFIGS.google` — scopes defined, no OAuth flow |
| Microsoft 365 | METADATA ONLY | `INTEGRATION_CONFIGS.microsoft` — scopes defined, no OAuth flow |
| Xero | METADATA ONLY | `INTEGRATION_CONFIGS.xero` — scopes defined, no OAuth flow |
| MYOB | NOT BUILT | Not in registry |
| Zoho | METADATA ONLY | `INTEGRATION_CONFIGS.zoho` — defined, no OAuth flow |
| NeedsCare AI+ | NOT BUILT | Not referenced in code |
| Need2Comply AI+ | NOT BUILT | Not referenced in code |
| Needs2Learn AI+ | NOT BUILT | Not referenced in code |
| ShiftCare | NOT BUILT | Not referenced in code |
| Lumary | NOT BUILT | Not referenced in code |
| Brevity | NOT BUILT | Not referenced in code |
| Custom CRM | NOT BUILT | No generic CRM adapter |
| Government portals | NOT BUILT | — |
| ATO-related systems | NOT BUILT | — |
| Local folders | METADATA ONLY | Worker profile field only |
| Local applications | METADATA ONLY | Worker profile field only |

No connector performs real OAuth authorisation, real API calls, or real browser execution. All connectors are metadata definitions.

---

## Section 10 — Intelligence Engine Audit

All intelligence engines are in `lib/intelligence/src/` and contain **TypeScript type definitions and interfaces only**. No concrete rule implementations exist.

| Engine | Interface Status | Domain Types | Rule Versioning | Deterministic Evaluation | Real Data Files | Concrete Rules | Tests | Used by Workforce Roles |
|---|---|---|---|---|---|---|---|---|
| SCHADS Award | DEFINED | Partial | NOT BUILT | NOT BUILT | NOT BUILT | NONE | NONE | No |
| NDIS Pricing | DEFINED | Partial | NOT BUILT | NOT BUILT | NOT BUILT | NONE | NONE | No |
| NDIS Compliance | DEFINED | Partial | NOT BUILT | NOT BUILT | NOT BUILT | NONE | NONE | No |
| Risk | DEFINED | Partial | NOT BUILT | NOT BUILT | NOT BUILT | NONE | NONE | No |
| Quality | DEFINED | Partial | NOT BUILT | NOT BUILT | NOT BUILT | NONE | NONE | No |

`lib/intelligence/src/index.ts` states explicitly: *"Sprint 0: type definitions and interfaces only. Sprint 2+: concrete engine implementations."*

The source version field, effective-date support, and audit output are all described in the interfaces but not implemented.

**Must any engine be built before live OpenClaw execution?** Not strictly as a blocker, but the SCHADS and NDIS pricing engines should be implemented before the Compliance Officer and Payroll Officer specialists are activated for real customers, because those specialists will produce incorrect or dangerous outputs without them. The Core Pack specialists (Chief of Staff, Operations Manager, Document Specialist) could go live without the intelligence engines.

---

## Section 11 — Security and Governance Audit

### Controls currently working
- Clerk-based authentication with JIT user provisioning
- Tenant context enforcement on every API request (middleware + RLS)
- PostgreSQL RLS on 19 tables — verified at startup, tested in CI
- Platform role separation (`requirePlatformRole` for `/platform` routes)
- 30+ permission actions with `requirePermission` middleware
- Invitation token hashing (SHA-256)
- AES-256-GCM encryption for org database credentials (`lib/secrets`)
- AI Privacy Gateway enforcement layer (purpose allowlist, role checks — activated before any LLM call)
- Audit logging on all write operations (platform, org, and legacy layers)
- Server refuses to start if RLS is misconfigured

### Controls only documented or defined
- Worker Profile prohibited actions (`prohibitedActions` array) — defined, never enforced at runtime
- Execution policy service — described in architecture, not implemented
- Rate limiting — not implemented anywhere in the middleware chain
- Security headers (HSTS, CSP, X-Frame-Options) — not explicitly configured in the API server
- PII / PHI field-level encryption — no field-level encryption beyond credential storage
- Read-audit logging — `access_purpose` is set on DB sessions but systematic read-audit is not verified across all data access paths

### Controls missing before live execution
- Worker Profile enforcement at execution time (critical — without this, specialists could use any tool regardless of profile)
- Prompt injection detection or sandboxing before LLM calls
- Browser-session isolation (any session pairing mechanism)
- Local device path traversal protection
- Rate limiting per tenant and per user
- Customer-data exposure audit (no DPIA or data classification applied per field)

### Critical blockers before external customers
1. No payment — customer cannot have a valid paid subscription without manual DB intervention
2. No execution — customers cannot receive AI output
3. Worker Profile enforcement absent — once execution exists, profiles would not be enforced without this
4. Rate limiting absent — a single tenant could exhaust API resources

---

## Section 12 — Commercial Readiness Audit

| Item | Status | Notes |
|---|---|---|
| Plan catalogue | LIVE | Four plans, seeded, versioned |
| Plan versioning | LIVE | Immutable versions with cloning |
| Price fields | LIVE | `monthlyPriceCents`, `annualPriceCents`, currency (AUD default) |
| Workforce pack entitlements | LIVE | Pack-to-plan linking enforced |
| Connector eligibility | METADATA ONLY | `is_coming_soon` flags; no real connector gating |
| Execution entitlements | METADATA ONLY | Feature flags exist; execution not real |
| Seat limits | LIVE | Enforced by entitlement service |
| Usage limits | LIVE | Enforced, though not driven by real consumption |
| Trials | LIVE (manual start only) | Logic works; no auto-assign on org creation |
| Tenant overrides | LIVE | Explicit denial and grant overrides work |
| Public pricing page | NOT BUILT | No `/pricing` page exists |
| Plan-selection flow | NOT BUILT | No self-service plan selection |
| Automatic trial assignment | NOT BUILT | No hook on org creation |
| Stripe | NOT BUILT | No SDK, no keys, no routes |
| Payment collection | NOT BUILT | — |
| Invoices | NOT BUILT | — |
| Failed payment handling | NOT BUILT | — |
| Upgrades | NOT BUILT | No self-service upgrade flow |
| Downgrades | NOT BUILT | — |
| Promotions | NOT BUILT | — |
| Taxes | NOT BUILT | — |
| Subscription cancellation | NOT BUILT | — |

**Can a new customer currently choose a plan without NeedsOps staff?** No  
**Can a new customer currently begin a trial without NeedsOps staff?** No  
**Can a new customer currently pay?** No  
**Can NeedsOps staff manually assign a plan?** Yes — via platform console  
**Can prices and access levels be managed through the console?** Yes  

---

## Section 13 — Mobile Audit

| Feature | Status | Evidence |
|---|---|---|
| Registration | LIVE | `sign-up.tsx` with Clerk `useSignUp` |
| Login | LIVE | `sign-in.tsx` with Clerk `useSignIn`, email verification |
| Organisation selection | LIVE | `organizations.tsx` calls real `useListOrganizations` |
| Dashboard | LIVE (platform data) | `index.tsx` calls `useGetDashboardSummary`, `useGetSystemStatus` |
| Workforce | LIVE | `workforce.tsx` calls `useListWorkforcePacks` |
| Tasks | PLACEHOLDER | `tasks.tsx` uses `PLACEHOLDER_TASKS`, no backend calls |
| Approvals | PLACEHOLDER | `approvals.tsx` uses `PLACEHOLDER_APPROVALS`, directs to web portal |
| Execution sessions | NOT BUILT | No session concept in mobile |
| Notifications | NOT BUILT | No push notification configuration in `app.json` |
| Secure token storage | LIVE | Clerk Expo handles token storage natively |
| Offline behaviour | NOT BUILT | No offline strategy or caching |
| Push notifications | NOT BUILT | No Expo push setup |
| Deep links | NOT BUILT | No deep link scheme in `app.json` |
| App Store readiness | NOT READY | Placeholder content, missing screens, `app.json` has dev values |

**Backend connectivity:** The mobile app uses the generated `@workspace/api-client-react` hooks correctly. Auth token injection via `setAuthTokenGetter` is configured. The screens that connect to the backend do so correctly with real data.

---

## Section 14 — Code and Architecture Quality

### Monorepo organisation
Good. The `artifacts/` + `lib/` separation is clear. Each artifact is self-contained. The `lib/` packages provide shared types, clients, and services. Package boundaries are generally respected.

### Naming consistency
Inconsistency: API routes and some files use both `/organisations` (AU/UK) and `/organizations` (US). The primary route path is `/v1/organisations` but a root-level `organizations.ts` also exists — likely a legacy remnant.

### Duplicate logic
The most significant issue: `lib/db/src/schema/tasks.ts` and `lib/org-db/src/schema.ts` define overlapping table structures. The shared schema versions remain in `lib/db` after the org-db migration, creating dual write paths.

### Dead code
- `artifacts/api-server/src/routes/organizations.ts` (root, not v1) — appears to be a legacy file
- "Sprint 0 stub" comment remains in `organizations.ts:145`
- Mobile placeholder data (`PLACEHOLDER_TASKS`, `PLACEHOLDER_APPROVALS`)

### God files
- `workforceRegistry.ts` — 725 lines
- `workerProfileRegistry.ts` — 705 lines
- `entitlementService.ts` — 554 lines

### Test quality
High. Tests cover: RLS enforcement, task state machine, approval routing, entitlement resolution, workforce routing, worker profile correctness, organisation slug uniqueness. Tests use real database connections where needed and are not purely unit-mocked.

### Migration quality
Good overall. RLS migrations include explicit warnings about orphaned data. The `sprint71-write-restrictions.sql` revoking legacy audit_log writes is well-commented.

### Environment validation
Clerk and session secrets are required. Database connection is required. No runtime env validation library (like `zod` env schema) was found — env issues will surface as runtime crashes rather than startup errors.

### AWS/runtime portability
Good. The application depends on PostgreSQL, Clerk (JWT verification only — replaceable), and optionally Resend for email. No Replit-specific runtime coupling beyond the artifact configuration layer.

### Top 10 Technical Debts (ranked by severity)

1. **Split-brain schema** — `lib/db` and `lib/org-db` define overlapping tables. Risk of writing to wrong schema. Must be resolved before execution.
2. **Zombie write access to shared schema operational tables** — `tasks`, `approvals` in shared schema remain writable despite org-db migration.
3. **No Stripe integration** — platform cannot collect revenue. Blocks commercial launch.
4. **No execution engine** — the defining product capability. Every other layer waits on this.
5. **Worker Profile enforcement absent** — once execution exists, profiles are not enforced without building the policy check layer.
6. **Rate limiting absent** — API is unprotected from per-tenant abuse.
7. **God file registries** — `workforceRegistry.ts` (725 lines) and `workerProfileRegistry.ts` (705 lines) are difficult to test, extend, or version independently.
8. **Mobile tasks/approvals are placeholder** — two of the three most important mobile screens show no real data.
9. **Auto trial assignment missing** — new orgs are not automatically started on a trial; requires manual staff action.
10. **No startup environment validation** — missing env vars cause runtime crashes, not informative startup failures.

---

## Section 15 — Direction Drift Assessment

| Statement | Status | Notes |
|---|---|---|
| 1. NeedsOps is a multi-tenant SaaS | ON TRACK | RLS, org isolation, tenant context all implemented |
| 2. NeedsOps sells an AI Workforce rather than individual agents | ON TRACK | Pack structure, CoS orchestration model in place |
| 3. Chief of Staff coordinates specialist Workforce Roles | ON TRACK | CoS routes to specialists; routing is deterministic not AI yet |
| 4. Workforce Roles are separate from execution runtimes | ON TRACK | Role/Profile separation is enforced in the data model |
| 5. Worker Profiles control tools and surfaces | PARTLY ON TRACK | Profiles defined correctly; enforcement not yet built |
| 6. Intelligence Engines remain separate from agents | ON TRACK | `lib/intelligence` is a separate package; agents do not embed rules |
| 7. OpenClaw remains replaceable behind an adapter | ON TRACK | `lib/agent-runtime` is an interface layer; OpenClaw not hardcoded |
| 8. Browser execution is a first-class path | PARTLY ON TRACK | Schema and profile fields reserve the path; no implementation |
| 9. Local computer execution is a first-class path | PARTLY ON TRACK | Schema and profile fields reserve the path; no implementation |
| 10. Native APIs are optional accelerators, not a hard dependency | ON TRACK | No API-only assumption in architecture |
| 11. NeedsOps can work with customers using other CRMs | ON TRACK | Connector framework is CRM-agnostic by design |
| 12. NeedsCare and Need2Comply are optional systems | ON TRACK | No dependency on these systems anywhere in codebase |
| 13. Platform staff can manage organisations and commercial access | ON TRACK | Platform console is well-built and functional |
| 14. Customer users remain isolated by tenant | ON TRACK | RLS enforced at DB level, verified at startup |
| 15. Sensitive actions require human control | PARTLY ON TRACK | Approval state machine works; no runtime enforcement of profiles |
| 16. Customer experience centres on messaging and assigning work | OFF TRACK | No messaging interface exists anywhere |
| 17. Platform is progressing toward real autonomous execution | PARTLY ON TRACK | Infrastructure correct; execution not started |
| 18. Platform is not drifting into static admin and metadata system | PARTLY ON TRACK | At risk — most live functionality is admin/metadata |

**Corrections needed:**

- **Statement 5 (Worker Profile enforcement):** Build the execution policy service that reads worker profiles before dispatching any tool or channel action.
- **Statement 8 & 9 (Browser/local execution):** Begin NeedsOps Connect and browser session pairing in a near sprint. These cannot remain perpetually deferred.
- **Statement 15 (Sensitive action control):** Worker Profile `requiresApprovalFor` must be checked at execution time once execution exists.
- **Statement 16 (Messaging interface):** This is the most critical drift. The product experience begins with a message. Without a messaging interface, customers interact via a task creation form — a fundamentally different (and worse) UX than the intended product. This must be Sprint 8.
- **Statement 17 (Progress toward execution):** The execution layer has not been started. Infrastructure is 85% done. Execution is 0%. The sprint plan must turn to execution immediately.
- **Statement 18 (Not drifting into admin/metadata):** The platform is at risk of this characterisation. Every sprint so far has added governance, infrastructure, and metadata. The next sprint must add real product behaviour.

---

## Section 16 — Gap Register

| # | Gap | Priority | Business Impact | Technical Impact | Subsystem | Recommended Sprint | Dependency | Complexity |
|---|---|---|---|---|---|---|---|---|
| 1 | Messaging interface (customer chat input) | P0 | Without this, customers cannot interact naturally with the workforce | Requires WebSocket or SSE, UI component, message routing to CoS | Web, Mobile, API | Sprint 8 | CoS service exists | Medium |
| 2 | Real LLM routing in Chief of Staff | P0 | Keyword matching cannot handle real customer requests | Replace keyword matcher with AI gateway call; gateway enforcement already in place | AI Gateway, CoS Service | Sprint 8 | AI gateway built | Medium |
| 3 | Execution engine (tool dispatch, step runner) | P0 | Platform cannot produce any output | `lib/agent-runtime` implementation, tool registry, execution session tracking | Agent Runtime | Sprint 9 | LLM routing | Large |
| 4 | OpenClaw runtime adapter | P0 | Primary execution runtime is not connected | Implement `OpenClawRuntime` class, session management, tenant mapping | Agent Runtime, OpenClaw | Sprint 9/10 | Execution engine | Large |
| 5 | Worker Profile enforcement at execution | P0 | Specialists would have unconstrained tool access once execution exists | Policy check service reading profiles before tool dispatch | Permissions, Agent Runtime | Sprint 9 | Execution engine | Medium |
| 6 | Stripe billing integration | P1 | Platform cannot collect revenue; commercial launch blocked | Stripe SDK, checkout session, webhook handler, subscription state sync | Commercial, API | Sprint 10 | Plans/entitlements ready | Medium |
| 7 | Automatic trial assignment on org creation | P1 | New customers start with no plan; requires manual staff intervention | Hook in `orgService.createOrganisation` to assign Foundation trial | Entitlements, Org Service | Sprint 8 | Entitlements live | Small |
| 8 | Public pricing page | P1 | Customers cannot self-discover plans before registering | Static or API-driven `/pricing` page in web portal | Web Portal | Sprint 8 | Plans API exists | Small |
| 9 | Split-brain schema resolution | P1 | Risk of writing execution results to wrong schema | Remove shared-schema operational tables or fully migrate write paths to org-db | DB, Org-DB | Sprint 8 | Org-DB live | Medium |
| 10 | Mobile tasks screen (real backend) | P1 | Mobile shows placeholder data for the most important screen | Wire `tasks.tsx` to real `useListTasks` hook with org context | Mobile | Sprint 8 | Tasks API exists | Small |
| 11 | Mobile approvals screen (real backend) | P1 | Mobile shows placeholder data for approvals | Wire `approvals.tsx` to real API | Mobile | Sprint 8 | Approvals API exists | Small |
| 12 | Browser session pairing | P1 | Browser execution path cannot start without session pairing | Session model, extension protocol, domain allowlist enforcement | Browser Runtime, DB | Sprint 11 | Execution engine | Large |
| 13 | NeedsOps Connect (local device) | P1 | Local execution path cannot start without Connect agent | Desktop app or daemon, device pairing, path approval, local runner | Local Runtime | Sprint 12 | Execution engine | Large |
| 14 | Event streaming (WebSocket/SSE) | P1 | Customers cannot see live execution progress | WebSocket or SSE endpoint on API, client subscription in web/mobile | API, Web, Mobile | Sprint 9 | Execution engine | Medium |
| 15 | SCHADS Award engine implementation | P2 | Payroll Officer specialist cannot compute correct award entitlements | Implement `RuleEngine` interface with SCHADS 2010 + amendments | Intelligence | Sprint 11 | Execution engine | Large |
| 16 | NDIS Pricing engine implementation | P2 | Support Coordinator specialist cannot calculate correct NDIS pricing | Implement pricing rules from NDIS Price Guide | Intelligence | Sprint 11 | Execution engine | Large |
| 17 | Rate limiting | P1 | API unprotected from per-tenant abuse | Add rate limiting middleware (e.g., `express-rate-limit` with Redis) | API Security | Sprint 8 | None | Small |
| 18 | Security headers | P1 | HSTS, CSP, X-Frame-Options absent | Add `helmet` middleware to Express | API Security | Sprint 8 | None | Small |
| 19 | Environment variable validation at startup | P2 | Missing env vars cause runtime crashes, not clear errors | Add `zod` env schema validation at startup | API, Infrastructure | Sprint 8 | None | Small |
| 20 | Real OAuth connectors (Google, Microsoft, Xero) | P2 | Connector registry has no working integrations | Implement OAuth flows, credential storage, token refresh | Connectors | Sprint 11+ | Execution engine | Large |
| 21 | Prompt injection protection | P1 | LLM calls could be manipulated by customer input | Input sanitisation, sandboxed system prompts, output validation | AI Gateway | Sprint 9 | LLM routing | Medium |
| 22 | Push notifications (mobile) | P2 | Mobile customers cannot be notified of task completion | Expo push token registration, notification dispatch service | Mobile, API | Sprint 10 | Execution engine | Small |
| 23 | App Store submission preparation | P2 | Mobile cannot be distributed | App icons, splash screen, real bundle IDs, privacy policy | Mobile | Sprint 12 | Core features | Small |
| 24 | Intelligence engine: Risk | P2 | Risk Officer specialist has no rules to apply | Implement risk scoring rules | Intelligence | Sprint 11 | Execution engine | Medium |
| 25 | Self-service plan upgrade UI | P2 | Customers cannot upgrade without staff | Plan upgrade page, Stripe checkout | Commercial, Web | Sprint 10 | Stripe | Medium |

---

## Section 17 — Recommended Roadmap

The previous roadmap was correct in foundation priorities. The execution layer must now be built. The recommended order is driven by two constraints: (1) every meaningful product experience for a customer requires a messaging interface and real AI output, and (2) commercial viability requires Stripe.

---

### Sprint 8 — Messaging Interface + Live AI Routing + Quick Wins

**Objective:** Give customers the defining product experience: type a message, the Chief of Staff understands it, a specialist is selected, and a result is returned.

**Key deliverables:**
- Messaging UI in web portal (chat-style input → task creation flow)
- Real LLM call via AI gateway replacing the keyword matcher in `chiefOfStaffService`
- Mobile tasks and approvals screens connected to real backend
- Automatic trial assignment on org creation
- Public pricing page
- Rate limiting and security headers
- Environment variable startup validation
- Split-brain schema cleanup (remove or fully redirect shared-schema operational writes)

**Why this comes first:** The platform has no customer-facing product experience. Everything built so far is invisible to a customer until they can type a message and receive a response. This is the earliest moment the platform becomes a product rather than an admin system.

**Dependency:** AI gateway enforcement layer (Sprint 7 — complete), CoS service (Sprint 2 — complete).

**Definition of done:** A customer types a message. A real LLM call is made through the AI gateway. A specialist is selected. A simulated response (appropriate output) is returned and displayed. Usage is recorded.

---

### Sprint 9 — Execution Engine + Tool Dispatch + Streaming

**Objective:** Build the core execution runtime: steps run, tools are dispatched, results flow back to the customer in real time.

**Key deliverables:**
- Concrete `lib/agent-runtime` implementation replacing the Sprint 0 shell
- Tool registry with at least 5 real tools (file read, web search, structured data query, form fill, document generate)
- Execution session model (`execution_sessions` table, step tracking)
- Worker Profile policy enforcement before tool dispatch
- WebSocket or SSE streaming of execution progress
- Execution queue with retry on failure
- Prompt injection protection layer
- Approval gate enforcement at execution time (pause before sensitive actions)

**Why this comes here:** LLM routing is meaningless without an execution engine to run the work. Sprint 8 gives the conversation; Sprint 9 gives the output.

**Dependency:** Sprint 8 (messaging + LLM routing).

**Definition of done:** A customer sends a message. The CoS plans the work. A specialist executes at least one real tool call. The result is streamed back to the customer. The customer can see each step as it happens. An approval gate pauses execution if required.

---

### Sprint 10 — OpenClaw Runtime Integration

**Objective:** Replace or augment the native execution engine with OpenClaw as the primary orchestration gateway.

**Key deliverables:**
- OpenClaw client/adapter implementing the `Agent` interface
- Tenant-to-workspace mapping
- Session lifecycle management (create, stream, terminate)
- Specialist-to-OpenClaw node mapping
- Health check and reconnection logic
- Streaming output integration with Sprint 9 streaming layer
- Fallback to native execution if OpenClaw is unavailable

**Why this comes here:** The native execution engine (Sprint 9) is a necessary stepping stone — it proves the abstraction works and provides a fallback. OpenClaw integration is then a clean adapter swap.

**Dependency:** Sprint 9 (execution engine with adapter interface).

**Definition of done:** A task executes end-to-end through OpenClaw. Tenant isolation is verified. Session termination is clean. Health checks report OpenClaw status in the platform console.

---

### Sprint 11 — Stripe Billing + Self-Service Onboarding

**Objective:** Customers can pay. The commercial layer becomes self-service.

**Key deliverables:**
- Stripe SDK integration
- Checkout session creation (new subscription, trial conversion)
- Webhook handler (payment succeeded, payment failed, subscription cancelled)
- Subscription state sync from Stripe to entitlements
- Self-service plan selection and upgrade UI
- Trial-to-paid conversion flow
- Invoice display
- Failed payment recovery notifications

**Why this comes here:** Billing is a P1 but not P0. Execution capability (Sprints 8–10) must be proven first to give customers something worth paying for. Building Stripe before execution is available would mean customers sign up for a product that cannot deliver value.

**Dependency:** Sprint 8 (entitlements and trial auto-assignment), Sprint 9 (execution delivering real value).

**Definition of done:** A new customer can register, receive a trial automatically, convert to paid via Stripe checkout, and have their entitlements updated without staff intervention.

---

### Sprint 12 — Browser Execution (NeedsOps Connect + Browser Session)

**Objective:** Enable AI workforce to operate in customer browsers and on customer local computers.

**Key deliverables:**
- Browser extension for session pairing and tab-level access
- Domain allowlist enforcement from Worker Profiles
- Form fill, navigation, upload/download via approved session
- Customer visible execution state in browser
- Customer stop control
- NeedsOps Connect daemon (device pairing, path approval)
- Allowed path enforcement with traversal protection
- Local execution routing in the execution engine

**Why this comes here:** Browser and local execution are the platform's true differentiator — they enable customers without native APIs (ShiftCare, government portals, custom CRMs). They require the execution engine (Sprint 9) and OpenClaw integration (Sprint 10) as foundations.

**Dependency:** Sprint 9 (execution engine), Sprint 10 (OpenClaw).

**Definition of done:** A customer grants browser access. A specialist navigates to an approved domain, fills a form, and submits it with the customer's approval. The customer can pause execution at any point.

---

### Sprint 13 — Intelligence Engines (SCHADS + NDIS)

**Objective:** Implement the SCHADS Award and NDIS Pricing intelligence engines so compliance-sensitive specialists produce correct outputs.

**Key deliverables:**
- SCHADS Award rule engine with 2010 base + current amendments
- NDIS Pricing rule engine from current price guide
- Effective-date support (rules apply based on service date, not processing date)
- Evidence references in rule outputs (clause citations)
- Audit trail of rule evaluations
- Integration with Payroll Officer and Support Coordinator specialists

**Why this comes here:** Intelligence engines are not required to start execution (Sprints 9–10) but they are required before the Compliance and Finance packs can be used safely with real customers. This sprint gates the activation of those high-risk specialists.

**Dependency:** Sprint 9 (execution engine, so engines have a runtime context to operate in).

**Definition of done:** Payroll Officer can calculate an accurate SCHADS timesheet. Support Coordinator can calculate an accurate NDIS service booking. Both produce evidence-referenced outputs with audit trails.

---

### Sprint 14 — Production Hardening + External Pilot

**Objective:** Prepare for the first real external customer.

**Key deliverables:**
- Production infrastructure (managed PostgreSQL, secrets management, CDN)
- Load testing and performance benchmarks
- Security audit (OWASP review, penetration test scope)
- App Store submission (iOS and Android)
- Notification system (push, email for task completion, approvals)
- Deep links for mobile task and approval notifications
- Onboarding flow end-to-end test
- External pilot with 1–3 real organisations under close observation

**Dependency:** Sprints 8–12 complete.

**Definition of done:** At least one external organisation completes a real AI-assisted workflow without NeedsOps staff intervention. Revenue is collected.

---

## Section 18 — Final Verdict

### 1. What have we truly built?

A production-quality multi-tenant governance platform. This includes: robust tenant isolation (RLS, org-db), a functional platform console for operators, a working entitlements and plan system, a correct approval state machine, comprehensive audit logging, an AI privacy enforcement gateway, an organisation identity system with RBAC, and a mobile app shell with real backend connectivity on most screens.

The architecture is correct, well-layered, and maintainable.

### 2. What have we not built?

The product. Customers cannot receive AI output. No LLM is called in production. No tool executes. No browser is touched. No file is read. The messaging interface — the defining customer interaction — does not exist. Stripe does not exist. The execution engine is a set of TypeScript interfaces. The intelligence engines are type definitions. Worker Profile enforcement is entirely absent.

### 3. Is the architecture suitable for the original vision?

Yes. The architecture is well-suited to the vision. The separation of Workforce Role from Worker Profile from Execution Runtime is correct. The AI gateway is in the right place. The tenant isolation model is production-grade. The connector framework correctly accommodates API, browser, and local execution paths. No significant architectural rework is needed before execution is built.

### 4. Has the project departed from its intention?

No — but it is at risk of appearing to. The project has spent 7 sprints building what is correctly described as "the platform that will run the product." It has not yet built the product itself. This is a defensible sequence, but Sprint 8 must begin building the customer-facing experience or the gap between governance completeness and product completeness will become a credibility problem.

### 5. What is the next best sprint?

Sprint 8: Messaging Interface + Live AI Routing. The customer must be able to type a message and receive a real response from a real LLM, mediated by the Chief of Staff. Everything else can wait. This is the moment the platform becomes a product.

### 6. What must not be built yet?

- Intelligence engines (too early — no execution runtime to call them)
- App Store submission (too early — core screens are placeholders)
- NeedsOps Connect (too early — depends on execution engine)
- Advanced connector OAuth flows (too early — no execution engine to use them)
- Additional platform console features (the console is complete enough for current needs)

### 7. What is the largest risk if development continues in the wrong order?

If the next sprint adds more infrastructure (another governance layer, another metadata system, more audit tables, more platform console features) without adding execution capability, the platform will have crossed into the territory it was explicitly designed not to become: an admin dashboard.

The specific risk: stakeholder confidence erodes when the platform looks complete from the outside (console, org management, workforce catalogue) but cannot deliver a single piece of AI work. Sprints spent on governance after Sprint 7 have diminishing returns until execution exists.

### 8. What should the founder be confident about?

- The foundation is correctly built. Multi-tenancy, security, governance, and the platform console are production-quality. This work will not need to be redone.
- The architecture has not drifted. The original vision is intact in the data model, the abstractions, and the sprint documentation.
- The Chief of Staff routing structure is cleanly replaceable with real LLM calls — this transition will not require a rewrite.
- The AI privacy gateway is in place. When LLM calls are added, they will be governed from day one.
- 299/299 tests pass. The test suite is meaningful and covers real database behaviour.

### 9. What should the founder remain cautious about?

- The execution gap is complete. Zero AI work executes today. This is a large distance from the intended product.
- Stripe is entirely absent. The platform cannot collect revenue without significant work.
- Worker Profile enforcement does not exist. When execution is added, it will need to be built in parallel or the policy layer will be bypassed.
- The mobile app has placeholder screens for its most important features (tasks, approvals). Mobile-first customers will see an incomplete product.
- The intelligence engines (SCHADS, NDIS) are further away than they may appear. The type definitions create an illusion of progress. These will require significant domain-specific implementation work before they produce correct outputs.
- Speed matters now. The governance platform is done. Every further sprint without real execution output is a sprint where the product cannot be shown to investors or customers with honesty.
