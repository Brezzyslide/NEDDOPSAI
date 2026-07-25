# Sprint 8 Completion Report — OpenClaw Runtime Integration

**Date:** 2026-07-25  
**Test count:** 394 passing (was 299 at Sprint 7.1 close-out)  
**New tests added:** 95 (all passing)  
**RLS tables:** 21 (was 19)  
**API server boot:** Clean — all startup checks passed

---

## What Was Built

### 1. `lib/agent-runtime` — Execution Abstraction Interface

**`executionEngine.ts`** — New stable contract that all runtime adapters implement.

Key types:
- `ExecutionEngine` — interface with `submitExecution`, `cancelExecution`, `pauseExecution`, `resumeExecution`, `getExecutionStatus`, `processInboundEvent`, `getHealth`, `getCapabilities`
- `ExecutionPackage` — the full submission unit: now includes `taskId` (internal NeedsOps link), `tenantId`, `workforceRole`, `workerProfile`, `steps`, `constraints`, `approvalState`, `callbackUrl`, `expiresAt`
- `RuntimeEvent` — translated inbound event (what NeedsOps code sees)
- `RuntimeHealth` — health snapshot including status, version, capabilities, heartbeat timestamp
- `ExecutionSessionInfo` — status response shape for API consumers

External code **never** imports OpenClaw types directly — only this interface.

---

### 2. `lib/openclaw` — New Workspace Package

New package `@workspace/openclaw` with 7 source files:

| File | Purpose |
|---|---|
| `config.ts` | `loadOpenClawConfig()`, `isOpenClawConfigured()`, `buildCallbackUrl()` — all from env vars |
| `types.ts` | OpenClaw wire types: `OpenClawExecutionPackage`, `OpenClawWebhookEvent`, `OpenClawHealthResponse`, all event type strings |
| `runtimeBrokerClient.ts` | `RuntimeBrokerClient` — the only class that makes HTTP calls to the broker. Retry + exponential back-off. HMAC-SHA256 signature verification. |
| `executionPackageTranslator.ts` | `translateToOpenClawPackage()`, `validateExecutionPackage()` — NeedsOps → wire format. **taskId is NOT included in wire format.** |
| `runtimeEventTranslator.ts` | `translateOpenClawEvent()`, `resolveStatusTransition()`, `resolveTaskStateUpdate()`, `isTerminalStatus()` |
| `openClawExecutionEngine.ts` | `OpenClawExecutionEngine` — the `ExecutionEngine` implementation: full lifecycle, DB persistence, tenant boundary enforcement, webhook processing |
| `index.ts` | Barrel exports |

---

### 3. Database Schema — Two New Tables

Both tables created via SQL migration (drizzle push required TTY for an unrelated constraint):

**`execution_sessions`** — one row per submitted execution:
- `id` (session UUID), `task_id`, `organization_id` (RLS key), `runtime_name`, `runtime_execution_id` (OpenClaw's own ID), `current_status`, `execution_package` (JSONB snapshot), `submitted_at`, `started_at`, `completed_at`, `error_message`, `metadata`

**`execution_events`** — append-only event log per session:
- `id`, `execution_session_id`, `organization_id` (RLS key), `event_type`, `event_source`, `payload` (JSONB), `is_applied`, `occurred_at`

RLS policies applied for both tables — `tenant_isolation` policy for the verifier, `needsops_app_exec_*` operational policy for the application role.

---

### 4. API Server — Service Layer and Routes

**`executionService.ts`** — builds `ExecutionPackage` from approved task plan and worker profile, manages session lifecycle, queries status, delegates to the engine.

New routes:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/organisations/:slug/tasks/:taskId/execution` | Submit approved task to runtime |
| `GET` | `/v1/organisations/:slug/tasks/:taskId/execution` | Current execution status |
| `POST` | `/v1/organisations/:slug/tasks/:taskId/execution/cancel` | Cancel running execution |
| `POST` | `/v1/organisations/:slug/tasks/:taskId/execution/pause` | Pause running execution |
| `POST` | `/v1/organisations/:slug/tasks/:taskId/execution/resume` | Resume paused execution |
| `GET` | `/v1/organisations/:slug/tasks/:taskId/execution/events` | Execution event log |
| `POST` | `/v1/runtime/events` | OpenClaw webhook receiver (HMAC-verified, raw body) |
| `GET` | `/v1/platform/runtime/status` | Platform runtime health monitor |
| `GET` | `/v1/platform/runtime/capabilities` | Runtime capability declaration |

New permission: `task:execute` — added to `PermissionAction`, granted to `owner`, `administrator`, and `manager` roles.

---

### 5. Web UI — Platform Runtime Monitor

**`PlatformRuntime.tsx`** at `/platform/runtime` — live monitoring page:
- Connection status badge (healthy / degraded / unavailable / not_connected)
- Runtime version, URL (redacted to `[configured]`), last heartbeat, connected since
- Active / queued / failed execution counts from the DB
- Capabilities panel (channels, tool categories, max concurrent)
- Auto-refreshes every 30 seconds
- **Shows "OpenClaw Runtime not connected." when no runtime URL is configured — never fabricates data**

Wired into:
- `App.tsx` → `/platform/runtime` route
- `platformApi.ts` → `PLATFORM_NAV` with ⚡ Runtime entry

---

### 6. RLS Verifier Updated

`lib/org-db/src/rlsVerifier.ts`:  
`REQUIRED_RLS_TABLES` now has 21 entries (was 19). `execution_sessions` and `execution_events` added.

API server startup log confirms: `tablesChecked: 21`.

---

## Architecture Decisions

### NeedsOps owns, OpenClaw executes
- NeedsOps: tenants, orgs, tasks, roles, profiles, plans, approvals, permissions, audit, usage
- OpenClaw: execution, browser automation, tool execution, runtime state, runtime events
- The boundary is the `ExecutionEngine` interface — no NeedsOps route touches a browser or tool

### taskId vs executionId
- `executionId` = the session's own UUID (created by NeedsOps at submission time)
- `taskId` = the task's UUID (NeedsOps internal — NOT sent to OpenClaw)
- The `OpenClawExecutionPackage` (wire format) has `executionId` and `tenantId` but **no taskId** — this is intentional. OpenClaw must not know NeedsOps task IDs.

### State machine bypass for terminal events
The existing `VALID_TRANSITIONS` guard in `taskService.ts` does not cover `executing → completed` etc. The execution engine's `resolveTaskStateUpdate` writes directly via Drizzle for terminal states. This is intentional — runtime events are authoritative for terminal transitions. The task state machine guard covers human-initiated transitions only.

### Graceful "not configured" mode
When `OPENCLAW_RUNTIME_URL` is absent:
- `getHealth()` returns `{ status: "not_connected", capabilities: null }`
- `submitExecution()` creates a `pending` session for when the runtime connects
- The platform runtime page shows "OpenClaw Runtime not connected."
- No method throws, no fabricated data is returned

### Webhook security
- HMAC-SHA256 on raw request body using `OPENCLAW_WEBHOOK_SECRET`
- Tenant boundary double-checked on every inbound event (event `tenantId` must match session `organizationId`)
- In non-production, unsigned events are accepted (to simplify local testing)
- Rejected events return 401/403 and are logged; transient errors return 500 so OpenClaw retries

---

## What Remains Before First Live Browser Execution

The following items are **not yet built** — NeedsOps is not yet capable of running a real browser task end-to-end:

1. **OpenClaw Runtime Broker** — the external system is not installed or running. `OPENCLAW_RUNTIME_URL` is not set. All execution submissions will create `pending` sessions only.

2. **Task submission UI** — there is no button in the org UI to submit an approved task to execution. The API routes exist and work; no frontend has been built to call them.

3. **Execution status UI** — no real-time display of execution progress, step completions, or final output within the org workspace. `PlatformRuntime` gives platform-level counts only.

4. **Stripe / commercial gating** — execution is not yet gated on entitlement plan. Any `manager`-or-above member can submit any approved task.

5. **Output delivery** — when OpenClaw sends `execution.completed`, the task transitions to `completed` and the event payload is stored in `execution_events`. There is no mechanism to surface the output document or artefact back to the requesting user.

6. **Approval flow for mid-execution pauses** — when OpenClaw sends `execution.awaiting_approval`, the task transitions to `awaiting_approval`. The existing approval system is not yet connected to the execution engine to resume after approval.

7. **Rate limits / concurrency caps** — no per-org concurrent execution limit is enforced at the API layer.

8. **`OPENCLAW_AUTH_TOKEN_REF`** — the broker auth token is read from a platform secret reference. The platform secrets store exists (Sprint 7), but no token has been configured.

---

## Test Coverage Summary

| Suite | Tests | Category |
|---|---|---|
| Sprint 8 OpenClaw | 95 | New |
| Sprint 7 RLS Safety | 13 | Updated (count 19→21) |
| Sprint 7.1 Acceptance | 14 | Unchanged |
| Sprint 7 Database Isolation | 13 | Unchanged |
| Sprint 7 Backup/Restore | 8 | Unchanged |
| Sprint 7 Migration | 9 | Unchanged |
| Sprint 7 AI Gateway | 19 | Unchanged |
| Sprint 7 Secrets | 18 | Unchanged |
| Sprint 6 Org DB | 28 | Unchanged |
| Sprint 5 Isolation | 30 | Unchanged |
| Sprint 4 Platform Console | 35 | Unchanged |
| Sprint 3 Entitlements | 13 | Unchanged |
| Workforce | 47 | Unchanged |
| Worker Profiles | 35 | Unchanged |
| Email Service | 17 | Unchanged |
| **Total** | **394** | |
