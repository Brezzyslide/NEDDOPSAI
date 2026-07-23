---
name: NeedsOps Sprint 0 conventions
description: Key decisions, gotchas, and patterns from the NeedsOps AI+ Sprint 0 build — covers OpenAPI codegen, Zod v3, mobile metro config, DB schema, and the cross-lib TypeScript resolution pattern.
---

## Cross-lib @workspace/* imports need tsconfig paths

**Rule:** Lib packages that import from other `@workspace/*` packages (e.g. `lib/auth` importing `@workspace/shared`) must declare TypeScript `paths` in their own `tsconfig.json`. pnpm does NOT hoist workspace package symlinks to root node_modules, and newly added packages don't get cross-linked automatically.

**Why:** The workspace uses pnpm without shameful hoisting. Existing packages that work only import from npm packages (drizzle-orm, zod, etc.), never from `@workspace/*`. New cross-lib imports fail with `Cannot find module '@workspace/X'` until paths are added.

**How to apply:** In the consuming package's `tsconfig.json`:
```json
"paths": {
  "@workspace/shared": ["../shared/src/index.ts"],
  "@workspace/auth": ["../auth/src/index.ts"]
}
```
For agents (two directories deep): use `../../lib/shared/src/index.ts`.
Also add the corresponding `references` entries pointing to the same packages.

---

## lib packages that need node globals must declare "types": ["node"]

**Rule:** Add `"types": ["node"]` to the tsconfig and `"@types/node": "catalog:"` to package.json devDeps.

**Why:** `tsconfig.base.json` uses `"lib": ["es2022"]` — no node globals by default. Packages using `drizzle-orm/pg-core` or any node globals need this. Pattern established in `lib/db`.

**Note:** For newly added packages, `@types/node` via devDep may not link immediately after `pnpm install`. If the error persists, simplify the package to avoid node types in Sprint 0 shells and defer the full implementation to Sprint 1 when the package is properly established.

---

## Sprint 0 — what was built

**Libs:**
- `lib/shared` — platform constants, enums, labels
- `lib/validation` — hand-authored Zod v3 schemas
- `lib/api-spec` — OpenAPI 3.1 source (12 endpoints)
- `lib/api-zod` — Orval-generated Zod schemas (do not edit)
- `lib/api-client-react` — Orval-generated React Query hooks (do not edit)
- `lib/db` — Drizzle ORM schema + pg client
- `lib/auth` — auth types + middleware stubs
- `lib/permissions` — RBAC role hierarchy + guards
- `lib/integrations` — integration provider types + registry interface
- `lib/agent-runtime` — Agent/AgentRunner interfaces + task/response types
- `lib/audit` — audit event types + logger stub (schema deferred to Sprint 1)

**Agents:**
- `agents/shared` — BaseAgent abstract class + prompt utilities
- `agents/chief-of-staff` — NeedsOpsChiefOfStaff router shell
- `agents/needsops-compliance-officer` — NDIS compliance specialist agent shell

**Artifacts:**
- `artifacts/api-server` — Express 5 API, all 12 endpoints live
- `artifacts/needsops-web` — React+Vite Command Centre (5 pages, live data)
- `artifacts/needsops-mobile` — Expo 53 mobile shell (4 tabs)
- `artifacts/worker` — background worker shell
- `artifacts/desktop-connector` — desktop connector shell
- `artifacts/admin` — admin portal placeholder (README only)

**Infrastructure:**
- `infrastructure/docker/` — Dockerfile reference
- `infrastructure/deployment/` — deployment README
- `infrastructure/scripts/` — db-push.sh, seed.sh

---

## OpenAPI codegen (Orval) — Zod v3 gotcha

`format: email` in OpenAPI spec generates `zod.email()` which is Zod v4 syntax. Project uses Zod v3 compat. Remove `format: email` from the spec to avoid codegen breakage.

---

## Expo mobile — required setup

1. `"main": "expo-router/entry"` required in mobile `package.json` — missing causes Metro startup failure.
2. `metro.config.js` needs monorepo watch folders: `watchFolders: [workspaceRoot]` and `resolver.nodeModulesPaths`.
3. `setBaseUrl` must be called in `_layout.tsx` before any React Query hooks execute.

---

## Database seed

Seeded via raw SQL using `gen_random_uuid()` (Node crypto unavailable in CodeExecution sandbox).
Seed data: 3 orgs (sunrise-ndis, horizon-care, brightpath-health), 4 users under sunrise-ndis, 4 workforce packs.

---

## lib/intelligence and lib/entitlements

Two additional libs added post-Sprint 0.

**lib/intelligence** — deterministic rule engines (SCHADS Award, NDIS Pricing, NDIS Compliance, Risk Matrix, Quality Indicators). Agents call engines; engines never call agents. All rule data must be versioned (year-based) and traceable to a source document.

**lib/entitlements** — answers "does this org's subscription include this feature?", separate from `lib/permissions` which answers "can this user do this action?". Both checks must pass for gated actions. Sprint 0 ships `TIER_FEATURES` + `TIER_USAGE_LIMITS` maps and synchronous `checkEntitlementFromTier` helpers. Sprint 2: async `EntitlementService` backed by DB subscription records.

**UI terminology**: customer-facing UI already uses "AI Workforce" / "Workforce Packs" — zero "agent" labels in web or mobile. Internal code continues to use `agents/` directory. No rename required in code.

## lib/audit schema deferred

The `auditLogTable` Drizzle definition is stubbed out in `lib/audit/src/schema.ts` (plain TS types, no drizzle-orm import). The real Drizzle definition is in the file as a commented-out code block. Sprint 1: uncomment, add drizzle-orm dep, import into lib/db, push to DB.
