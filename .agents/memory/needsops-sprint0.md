---
name: NeedsOps Sprint 0 + Sprint 1 conventions
description: Key decisions, gotchas, and non-obvious rules from Sprint 0 and Sprint 1 of NeedsOps AI+
---

## OpenAPI / Codegen
- `lib/api-zod` contains auto-generated Zod schemas from the OpenAPI spec; do NOT hand-edit it
- Regenerate via `pnpm --filter @workspace/api-zod run generate`

## Zod v3 gotchas
- `.default()` on optional fields must come after `.optional()`: `z.string().optional().default("")`
- Zod v3 `.enum([...])` requires a non-empty tuple literal; use `as const` on the array

## lib/permissions guards API (Sprint 1)
- `hasPermission(actor: MembershipActor, action: PermissionAction): boolean` — first arg is an OBJECT `{ userId, organizationId, role }`, NOT a role string
- `canModifyMembership(actor, targetRole, isLastOwner: boolean)` — third param required
- `roleAtLeast(role, required)` takes role strings directly (no actor object)
- Administrators CAN manage other administrators (only owners are off-limits for admins)

## DB schema decisions (Sprint 1)
- `users.organizationId` FK was REMOVED in Sprint 1 — membership is via `memberships` table
- `users.externalId` = Clerk user ID; JIT-provisioned on first authenticated API hit
- `organizations.status` enum = `onboarding | active | suspended | closed` (old: trial/inactive removed)
- `invitations.invited_by` column = FK to users.id (NOT `invited_by_user_id`)
- `workforce_packs` has NO `slug`, `category`, `display_order`, `price_per_month`, `worker_count`, or `is_featured` — only: id, name, description, industry, workers (jsonb), tier, status
- Security boundary is UUID (`tenantContext.tenantId`), slug is cosmetic only
- All tenant-scoped DB queries must use `tenantContext.tenantId`, never the slug

## Mobile metro config
- Must exclude `minimumReleaseAge` for Clerk packages in `pnpm-workspace.yaml`; otherwise pnpm skips recent Clerk releases
- `expo-secure-store`, `expo-linking` are required peers of `@clerk/expo` — must be listed in mobile `package.json`
- `react-native-worklets@0.5.1` required by `react-native-reanimated@4.x` in Expo SDK 53 (the `latest` tag installs too-new a version; pin to `0.5.1`)
- `@types/react` must match `~19.1.10` for Expo SDK 53 compatibility (pnpm catalog value); subagent bumped it to `^19.2.0` which broke metro
- `expo-linking` expected version for Expo SDK 53 is `~8.0.12`

## API server TypeScript rules
- Express 5 + `@types/express` v5: `req.params.x` returns `string | string[]` — always wrap with `String(req.params.x)`
- `@clerk/shared/keys` does NOT export `publishableKeyFromHost` in v2 — use `clerkMiddleware()` (reads env vars automatically)
- `clerkMiddleware()` from `@clerk/express` auto-reads `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` from `process.env`; do NOT pass a callback
- api-server tsconfig `references` must include lib/validation to get fresh types after schema changes; otherwise stale dist/ is used

## lib rebuild order
Rebuild in this order when schema changes: `lib/shared` → `lib/db` → `lib/auth` → `lib/permissions` → `lib/validation`
Run: `cd lib/<name> && npx tsc -p tsconfig.json`

## Sprint routing convention
- Sprint 0 routes at `/api/*` (preserved for backwards compat)
- Sprint 1 routes at `/v1/*`

## Web → API connectivity (critical)
- The web app (Vite) and API server run on different ports; root-relative `/v1/...` URLs hit Vite, not the API
- Fix: add `server.proxy` in `vite.config.ts` — `/v1` and `/api` both target `http://localhost:8080`
- All fetch calls must send a Clerk Bearer token via `Authorization: Bearer <token>`; `credentials: "include"` (cookies) does NOT work — `getAuth(req)` reads the Authorization header only
- Pattern: `useAuthFetch()` hook in `src/lib/api.ts` calls `getToken()` from `useAuth()` and attaches the header; wrap with `useCallback([getToken])` so it's stable for `useEffect` deps
- Every page that calls the API must use `apiFetch` from `useAuthFetch()` — never raw `fetch`

## Seed script
- `infrastructure/scripts/seed.sh` uses raw `psql` (not a Node script)
- Requires `DATABASE_URL` env var

## Sprint 2 — AI Workforce Foundation (complete)
- `workforceRegistry.ts` in api-server/src/lib — single source of truth for 6 packs, 32 specialists, 35 capabilities. Static TS, not DB.
- Chief of Staff: deterministic keyword routing in `chiefOfStaffService.ts` (`planTask()`). No LLM. Stable interface — future LLM replaces only `classifyIntent()`.
- Approval priority: platform > compliance > dual > owner > administrator > manager > no_approval
- Tasks/approvals routes use `requireAuth, resolveTenantFromSlug` + `req.tenantContext!.tenantId` (NOT `requireMembership`, NOT `req.appOrg`).
- 10 new DB tables: specialists, capabilities, specialist_capabilities, tasks, task_specialists, task_execution_plans, approvals, approval_rules, approval_history
- New web routes: /app/:slug/workforce, /app/:slug/tasks, /app/:slug/approvals
- Mobile: tasks.tsx and approvals.tsx tabs added (placeholder data; live API deferred to Sprint 3 mobile auth)
- Marketing pack is `coming_soon` by design; marketing specialists excluded from task routing.
- 64 total tests passing (17 email + 47 workforce)

## Sprint 3 — Entitlements, Subscriptions, Usage (complete)
- `organizations.subscriptionTier` enum values: `starter | professional | enterprise` (NOT `foundation`). Sprint 3 plans use separate `plans` table with codes `foundation | professional | business | enterprise`.
- `tenant_subscriptions.status` enum: `active | suspended | cancelled | trial | trial_expired` (NOT `trialing`).
- `plan_usage_allowances.hard_limit` and `tenant_usage_allowances.hard_limit` must be `bigint` (not `integer`) — storage byte values exceed int4 range.
- `EntitlementResult` uses `.allowed` (not `.granted`) — check `result.allowed` in tests and UI.
- Drizzle wraps pg constraint errors in `.cause.message`, not top-level `.message` — idempotency error catch must check both.
- Seat overrides use `tenant_overrides` table (`overrideType = "extra_seats"`, `value.seats`), NOT `tenant_usage_allowances`.
- Platform auth middleware: `requirePlatformAuth` exported from `requirePlatformRole.ts`. `admin.ts` must import from there, not `requirePermission.ts`.
- `auditService` in platform.ts imports as namespace object `{ auditService }` — exported as `const auditService = { log, writeAuditEvent, getRequestMeta }` at end of auditService.ts.
- New workspace dep must be added to both `package.json` AND installed via `pnpm install` before build — esbuild can't resolve workspace packages not listed as deps.
- Seed script must be run after migration: `cd artifacts/api-server && npx tsx src/seed.ts`. Idempotent.
- 112 total tests passing (17 email + 47 workforce + 35 worker profiles + 13 sprint3-entitlements).

## Sprint 2 Architecture Correction (complete)
- Internal concept: "Workforce Role" (32 specialists). Customer-facing: "AI Specialist". No UI rename.
- New: `WorkerProfile` model in `workerProfileRegistry.ts` — defines execution surfaces, tool categories, connector categories, prohibited actions, approval-required actions, risk level for future OpenClaw.
- `RegistrySpecialist` now has `workerProfileCodes: string[]` field linking roles → profiles.
- `ROLE_TO_PROFILES` map and helper functions: `getWorkerProfilesForRole`, `getActiveWorkerProfilesForRole`, `getRoleCodesForProfile`, `getWorkerProfileByCode`.
- New shared types: `WorkerProfileStatus`, `ExecutionChannel`, `ToolCategory`, `ConnectorCategory`, `RiskLevel`.
- 2 new DB tables: `worker_profiles`, `workforce_role_profiles` (join). Migrated.
- 35 new tests in `workerProfiles.test.ts`. Total: 99 tests, all passing.
- No live permissions, no browser domains, no connector credentials yet. All Worker Profile fields are metadata only.
- Chief of Staff profile: `internal_api` only, prohibits `modify_data`. Payroll profile: prohibits `process_payment`, `approve_payrun`, `access_tax_file_numbers`.
