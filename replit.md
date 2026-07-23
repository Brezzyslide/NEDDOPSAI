# NeedsOps AI+

An enterprise AI Operations Platform that enables organisations to build, manage and work alongside an intelligent AI workforce. Sprint 0 foundation build — monorepo, API, web portal, mobile shell, shared libraries, and database schema.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port assigned by workflow)
- `pnpm --filter @workspace/needsops-web run dev` — run the web portal
- `pnpm --filter @workspace/needsops-mobile run dev` — run the Expo mobile shell
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `SESSION_SECRET` — session signing secret

## Stack

- pnpm workspaces, Node.js 22, TypeScript 5.9
- Web: React + Vite (Wouter routing, TanStack Query, shadcn/ui)
- Mobile: Expo 53 + React Native (Expo Router)
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod v4, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Build: esbuild (CJS bundle for API)
- Docker: multi-stage Dockerfile + docker-compose.yml

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle table definitions (organizations, users, workforce_packs)
- `lib/shared/src/index.ts` — platform-wide constants, enums, and utility types
- `lib/validation/src/index.ts` — canonical Zod schemas for domain entities
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/needsops-web/src/` — React web portal (Command Centre UI)
- `artifacts/needsops-mobile/app/` — Expo mobile shell (4-tab Command Centre)
- `artifacts/worker/src/index.ts` — background worker shell (Sprint 0: health loop only)
- `artifacts/desktop-connector/src/index.ts` — desktop connector shell (Sprint 0: heartbeat loop)
- `docs/sprint-0-completion-report.md` — full Sprint 0 completion report

## Architecture decisions

- **OpenAPI-first**: `lib/api-spec/openapi.yaml` gates codegen → typed React Query hooks + Zod schemas generated automatically
- **Multi-tenant from day one**: all data rows reference `organization_id`; tenant isolation enforced at query layer (RLS in Sprint 1)
- **JSONB for workforce workers**: roster stored as JSONB in `workforce_packs` table for schema flexibility during early sprints
- **Shared constants in `@workspace/shared`**: enums and labels defined once, imported by both API and frontend
- **Worker/connector are real shells**: each is a complete runnable Node.js process with graceful shutdown and logging — not stubs

## Product

NeedsOps AI+ is the operational brain of an organisation. It coordinates specialist AI employees — Compliance Officers, HR Managers, Finance Officers, and more — behind a single secure Command Centre. Built first for Australian NDIS providers, expanding to all regulated industries.

Sprint 0 delivers: the foundation monorepo, organization/user/workforce-pack API + schema, web Command Centre (deep space UI), Expo mobile shell, worker + desktop connector shells, Docker support.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any change to `lib/api-spec/openapi.yaml`
- Run `pnpm --filter @workspace/db run push` after any DB schema change in `lib/db/src/schema/`
- Do NOT use `format: email` in the OpenAPI spec — Orval generates `zod.email()` which only exists in Zod v4 (project uses v3 compat)
- The `typescript` package is NOT in the pnpm catalog — new lib packages should not declare it as `"typescript": "catalog:"`
- API routes use `@workspace/validation` Zod schemas (hand-authored), not the Orval-generated schemas from `@workspace/api-zod`
- Worker and desktop connector are shells — they have no workflow registered by default (run manually with `pnpm start`)

## Pointers

- See `docs/sprint-0-completion-report.md` for the full Sprint 0 completion report and Sprint 1 recommendations
- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
