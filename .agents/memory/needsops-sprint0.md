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

## Seed script
- `infrastructure/scripts/seed.sh` uses raw `psql` (not a Node script)
- Requires `DATABASE_URL` env var
