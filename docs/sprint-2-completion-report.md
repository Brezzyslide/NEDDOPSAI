# Sprint 2 Completion Report — AI Workforce Foundation

**Date:** 2026-07-23  
**Status:** ✅ Complete  
**Sprint:** 2 of N

---

## Sprint Status

All Sprint 2 deliverables are complete. No AI execution, no OpenAI, no OpenClaw, no billing, no Stripe, no connectors, no Intelligence Engine implementations.

---

## Packages Added

| Package | Version | Purpose |
|---------|---------|---------|
| No new runtime packages | — | All Sprint 2 functionality uses existing dependencies |

---

## Database Changes

10 new tables added and migrated via `drizzle-kit push`:

| Table | Purpose | Tenant-scoped |
|-------|---------|---------------|
| `specialists` | Platform-level specialist registry | No (platform-wide) |
| `capabilities` | Named capability definitions | No (platform-wide) |
| `specialist_capabilities` | Specialist ↔ capability join table | No |
| `tasks` | Platform-wide task entity | ✅ `organization_id` |
| `task_specialists` | Specialists assigned to a task | Via task |
| `task_execution_plans` | Chief of Staff execution plan (JSONB) | Via task |
| `approvals` | Approval instances | ✅ `organization_id` |
| `approval_rules` | Per-org approval configuration | ✅ `organization_id` |
| `approval_history` | Immutable approval audit trail | Via approval |

New DB enums:
- `specialist_execution_status`: available, beta, coming_soon, deprecated
- `task_state`: draft, queued, planning, awaiting_approval, approved, executing, completed, cancelled, failed
- `task_priority`: low, normal, high, urgent
- `approval_type`: no_approval, manager_approval, administrator_approval, owner_approval, dual_approval, compliance_approval, platform_approval

---

## Shared Library Updates (`lib/shared`)

New types added to `lib/shared/src/index.ts`:
- `SPECIALIST_EXECUTION_STATUSES` + `SpecialistExecutionStatus`
- `WORKFORCE_PACK_CODES` + `WorkforcePackCode` + `WORKFORCE_PACK_LABELS`
- `TASK_STATES` + `TaskState` + `TASK_STATE_LABELS`
- `TASK_PRIORITIES` + `TaskPriority`
- `APPROVAL_TYPES` + `ApprovalType` + `APPROVAL_TYPE_LABELS`
- `APPROVAL_STATES` + `ApprovalState`

New audit event types:
- `task.created`
- `task.planned`
- `task.state_changed`
- `task.cancelled`
- `specialist.assigned`
- `approval.requested`
- `approval.granted`
- `approval.rejected`

---

## API Routes

### Workforce (public catalogue)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/v1/workforce/packs` | List all 6 workforce packs |
| GET | `/v1/workforce/packs/:code` | Get pack + specialists |
| GET | `/v1/workforce/specialists` | List specialists (filter: `?pack=`, `?status=`) |
| GET | `/v1/workforce/specialists/:code` | Get specialist + resolved capabilities |
| GET | `/v1/workforce/capabilities` | List all 35 capabilities |
| GET | `/v1/workforce/capabilities/:code` | Get capability + which specialists have it |
| POST | `/v1/workforce/plan` | Chief of Staff planning (auth required) |

### Tasks (tenant-scoped)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/v1/organisations/:slug/tasks` | List tasks (filter: `?state=a,b,c`) |
| POST | `/v1/organisations/:slug/tasks` | Create task → triggers CoS planning |
| GET | `/v1/organisations/:slug/tasks/:id` | Get task + execution plan |
| POST | `/v1/organisations/:slug/tasks/:id/transition` | Transition state |
| DELETE | `/v1/organisations/:slug/tasks/:id` | Cancel task |

### Approvals (tenant-scoped)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/v1/organisations/:slug/approvals` | List approvals (filter: `?state=`) |
| POST | `/v1/organisations/:slug/approvals` | Create approval |
| GET | `/v1/organisations/:slug/approvals/:id` | Get approval + history |
| POST | `/v1/organisations/:slug/approvals/:id/resolve` | Approve or reject |

---

## Pages Created / Updated

### Web (`artifacts/needsops-web`)

| Page | Path | Status |
|------|------|--------|
| AppDashboard | `/app/:slug` | Updated — workforce widgets, task queue, pending approvals |
| WorkforcePage | `/app/:slug/workforce` | ✅ New — pack browser, specialist cards, capability tags |
| TaskCentrePage | `/app/:slug/tasks` | ✅ New — create task, tabbed state view, CoS planning result |
| ApprovalsPage | `/app/:slug/approvals` | ✅ New — pending/approved/rejected/expired with inline resolve |
| AppShell nav | — | Updated — Workforce, Tasks, Approvals added to sidebar |

### Mobile (`artifacts/needsops-mobile`)

| Screen | Tab | Status |
|--------|-----|--------|
| Tasks | tasks | ✅ New — task list with state filter chips |
| Approvals | approvals | ✅ New — approval list with pending banner |
| Workforce | workforce | Existing tab (already present from Sprint 0) |
| Tab layout | `_layout.tsx` | Updated — Tasks and Approvals tabs added |

---

## Tests

**File:** `artifacts/api-server/src/__tests__/workforce.test.ts`

| Category | Tests |
|----------|-------|
| Workforce Registry | 7 tests |
| Specialist lookup | 4 tests |
| Capability lookup | 3 tests |
| Chief of Staff planning | 9 tests |
| Task state transitions | 11 tests |
| Approval routing | 3 tests |
| Tenant isolation | 4 tests |
| Platform admin separation | 5 tests |
| **Total** | **46 tests** |

Combined with Sprint 1 email tests (17): **63 tests total**, all passing.

---

## Architecture Decisions

### 1. Registry-first design
The workforce registry (`workforceRegistry.ts`) is a static TypeScript file, not a database query. Specialists and capabilities are seeded from this registry. This ensures the registry is the source of truth and is version-controlled alongside the code. Database tables exist for runtime state (task assignments, approval rules), not for the catalogue.

### 2. Deterministic Chief of Staff
The CoS uses keyword-based routing rules, not an LLM. This was specified in the sprint and has major benefits: zero latency, zero cost, fully testable, and identical behaviour across environments. The `planTask()` interface is stable — future LLM-based routing will replace only `classifyIntent()`, keeping the rest of the pipeline identical.

### 3. Approval priority hierarchy
When multiple assigned specialists have different approval requirements, the Chief of Staff selects the highest-priority approval type. Priority: `platform > compliance > dual > owner > administrator > manager > no_approval`.

### 4. Non-blocking task creation
`POST /v1/organisations/:slug/tasks` completes the full CoS planning cycle synchronously (planning is fast — pure in-process computation). The task returns from the API already in `approved` or `awaiting_approval` state, with a complete execution plan attached.

### 5. Execution plan persisted as JSONB
`task_execution_plans.plan_data` stores the full `TaskPlan` object as JSONB. This makes the plan queryable and auditable without a normalised schema. When real execution is added, the steps array drives the execution engine.

### 6. Marketing pack is `coming_soon`
Marketing specialists have `executionStatus: "coming_soon"` by design. They appear in the Workforce Explorer with clear status badges but cannot be selected for task routing (filtered to `available | beta` during specialist selection).

---

## Known Limitations

1. **Execution is fully simulated** — tasks reach `approved` state but no AI action is taken. Real execution requires Intelligence Engines (future sprint).

2. **Mobile has no live API connection** — the Tasks and Approvals mobile screens use placeholder data. Live data requires the mobile app to have org context (Sprint 3 mobile auth).

3. **Platform admin workforce pages not yet built** — admin pages for managing specialists, capabilities, and approval rules via the UI are deferred to Sprint 3.

4. **Approval expiry not enforced** — `approvals.expires_at` is set but no background job checks and expires approvals. Needs a scheduled job in Sprint 3+.

5. **`specialist_capabilities` table is not seeded** — the DB table exists but the registry data is served directly from the in-memory `workforceRegistry.ts`. Seeding the DB is deferred until a migration system is established.

6. **No `requirePermission` on task/approval routes** — tasks and approvals require only `requireAuth + resolveTenantFromSlug` (any member can create tasks). Fine-grained permissions (e.g. only managers can approve) will be added when the permissions module is extended.

---

## Technical Debt

1. The DB mock in tests is a chain mock — any change to query shape may require mock updates.
2. `resolveTenantFromSlug` requires a valid membership. Tasks and approvals should eventually support `viewer` role read-only access with `requirePermission("task:read")`.
3. Marketing workforce pack `workers` JSONB field on `workforce_packs` table (Sprint 0) now duplicates the specialists registry. These should be reconciled in Sprint 3 (remove JSONB field, always join to specialists table).

---

## Recommended Sprint 3

Based on Sprint 2 completion, Sprint 3 should focus on:

1. **Connector Framework** — wire specialists to real external systems (NDIS portal, Xero, SharePoint). Each specialist needs a connector registry.
2. **Mobile org context** — authenticate mobile users and wire to org-scoped APIs so Tasks and Approvals tabs show live data.
3. **Approval enforcement** — background job to expire approvals, email notifications for pending approvals, approval delegation.
4. **Platform admin UI** — pages to manage specialists, capabilities, and approval rules.
5. **Task execution simulation** — simulate specialist execution with realistic timing and state progression (for demo/preview purposes before Intelligence Engines are live).

---

## Ready for Sprint 3

✅ All Sprint 2 deliverables completed  
✅ TypeScript builds clean  
✅ All tests pass  
✅ DB migrated  
✅ Architecture documented  
✅ Web and mobile UIs delivered  

**Do not begin OpenAI, OpenClaw, Stripe, Google, Microsoft, connectors, Intelligence Engines, or billing until Sprint 3 is specified.**
