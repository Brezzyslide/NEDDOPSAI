---
name: NeedsOps Sprint 8 — OpenClaw Runtime Integration
description: Architecture decisions, constraints, and gotchas from the OpenClaw execution runtime integration sprint.
---

## What was built

- `lib/agent-runtime/src/executionEngine.ts` — `ExecutionEngine` interface (the stable contract)
- `lib/openclaw/` — new workspace package `@workspace/openclaw` (7 source files)
- Two DB tables: `execution_sessions`, `execution_events` (created via direct SQL; drizzle push requires TTY)
- API routes: execution lifecycle + webhook receiver + platform monitoring
- `executionService.ts` — builds packages, delegates to engine, owns session lifecycle
- `PlatformRuntime.tsx` — platform monitoring page at `/platform/runtime`
- New permission: `task:execute` (PermissionAction, granted to owner/administrator/manager)
- 95 new tests — all passing; total now 394

## Critical architecture decisions

**taskId vs executionId:**
- `executionId` = session UUID created by NeedsOps at submission time
- `taskId` = the task's NeedsOps UUID — **NOT sent to OpenClaw** (wire format intentionally omits it)
- `ExecutionPackage.taskId` is an internal field used only for DB persistence in `openClawExecutionEngine.ts`

**State machine bypass:**
- `VALID_TRANSITIONS` in taskService.ts does NOT cover `executing → completed / failed / cancelled`
- The engine's `resolveTaskStateUpdate` writes directly via Drizzle for terminal states — this is intentional
- Runtime events are authoritative for terminal transitions; the state machine guard covers human-initiated transitions only

**Package resolution gotcha:**
- `lib/openclaw/package.json` uses `"import": "./src/index.ts"` (not just `workspace`) so vite/vitest can resolve it without a compiled `dist/`
- `drizzle-orm: "catalog:"` must be in openclaw's own dependencies because esbuild inlines workspace packages and can't resolve transitive deps
- If you add more imports to openclaw, check `artifacts/api-server/build.mjs` externals list

**RLS policy naming:**
- The RLS verifier (`lib/org-db/src/rlsVerifier.ts`) checks specifically for `policyname = 'tenant_isolation'`
- Each new table needs BOTH a named `tenant_isolation` policy AND an operational `needsops_app_*` policy
- Schema tables must be added to `REQUIRED_RLS_TABLES` and the sprint7-rls-safety test count updated

**DB tables via SQL (not drizzle push):**
- `execution_sessions` and `execution_events` were created via direct `psql` SQL migration
- Drizzle push required interactive TTY approval for an unrelated unique constraint on `platform_secrets`
- Keep a `docs/migrations/sprint8-execution-tables.sql` for reference if tables need to be recreated

**Graceful not-configured mode:**
- When `OPENCLAW_RUNTIME_URL` is absent, all engine methods return safe non-error responses
- Submissions create `pending` sessions for later runtime connection
- The platform runtime page shows "OpenClaw Runtime not connected." — never fabricates health data

## Execution gate (executionPolicy.ts)

The 11-step gate from the spec — steps 1–3 and 10–11 are middleware; steps 4–8 are in `executionPolicy.ts`:
- Step 4: subscription state → `tenantCanUseFeature("execution.openclaw_runtime")` — if denied with subscription source, deniedAt = "subscription_state"
- Step 5: runtime feature entitlement → same call, if denied with feature source, deniedAt = "runtime_entitlement"
- Step 6: workforce pack → `tenantHasWorkforcePack(packForRole)`; role→pack map in SPECIALIST_PACK_MAP
- Step 7: execution channels → `tenantCanUseExecutionChannel()`; "api"/"internal" channels skip this (always available)
- Step 8: usage allowance → `checkUsage("ai_tasks", 1)`

**Provider independence:** executionPolicy.ts does NOT import drizzle, @workspace/db, Stripe, or any billing provider. It delegates entirely to entitlementService. Stripe updates NeedsOps state later via webhooks — it is never called at submission time.

## What remains before first live browser execution

1. OpenClaw Runtime Broker must be running and `OPENCLAW_RUNTIME_URL` set
2. Org-level task submission UI (button to submit approved task)
3. Execution status / output UI in org workspace
4. Commercial gating — `executionPolicy.ts` gate is now wired in (Steps 4–8). Provider-independent: checks NeedsOps internal tables only
5. Output delivery mechanism after `execution.completed`
6. Approval-to-resume flow for mid-execution pauses
7. Per-org concurrency limits
8. `OPENCLAW_AUTH_TOKEN_REF` token configured in platform secrets
