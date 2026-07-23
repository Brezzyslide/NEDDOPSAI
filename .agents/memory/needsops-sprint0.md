---
name: NeedsOps AI+ Sprint 0
description: Architecture decisions, gotchas, and conventions established during Sprint 0 foundation build
---

## Key conventions

- **OpenAPI spec is the contract**: `lib/api-spec/openapi.yaml` is the single source of truth. After any change, run `pnpm --filter @workspace/api-spec run codegen` to regenerate `@workspace/api-client-react` (React Query hooks) and `@workspace/api-zod` (Zod schemas).
- **Validation package is canonical**: API routes use Zod schemas from `@workspace/validation` (hand-authored), NOT the Orval-generated schemas from `@workspace/api-zod`. The generated schemas are for the frontend only.
- **No `format: email` in OpenAPI spec**: Orval generates `zod.email()` for email format which is Zod v4 syntax — project uses Zod v3 compat. Remove `format: email` from all OpenAPI schemas.
- **No `"typescript": "catalog:"` in lib devDeps**: TypeScript is not in the pnpm catalog. New lib packages must not declare it that way.
- **No `types: ["node"]` in lib tsconfigs**: Only add `@types/node` to packages that actually run in Node (API server, worker). Pure libs (validation, shared) don't need it.

## DB Schema

- Tables: `organizations`, `users`, `workforce_packs`
- All use typed pgEnums for status/tier/role fields
- `workforce_packs.workers` is JSONB (not normalised) — flexibility for early sprints
- Dev DB pushed: run `pnpm --filter @workspace/db run push` after schema changes
- Seed data: 3 orgs (sunrise-ndis, horizon-care, brightpath-health), 4 users, 4 workforce packs

## Mobile (Expo)

- Requires `"main": "expo-router/entry"` in package.json
- metro.config.js must set `watchFolders: [workspaceRoot]` and `resolver.nodeModulesPaths` for monorepo `@workspace/*` imports
- Do NOT include `expo-crypto` unless actually used — it causes Metro startup errors if declared but not installed

## Sprint 1 must-haves

Authentication (Clerk), tenant isolation middleware, row-level security, invitation flow, audit log table.
See `docs/sprint-0-completion-report.md` for full sprint 1 recommendations.
