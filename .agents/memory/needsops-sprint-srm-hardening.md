---
name: NeedsOps Sprint SRM Hardening
description: Instruction assembler wired, DB-first DNA, org context, broker enforcement, desktop version 0.1.1. 1475 tests.
---

## Key decisions and constraints

**`runtimeInstructions` is a required field (both translators and broker)**
- `CompiledRuntimeInstructions` = `{ instruction, instructionHash, manifestHash, dnaVersion, specialistId, compiledAt }`
- `UNSUPPORTED_PACKAGE_VERSION` thrown at: openclaw translator, broker validator
- Broker also checks: hash integrity, `specialistId` == `workforceRole`, `manifestHash` cross-check
- Full instruction string is NEVER logged — only `instructionHash` (64-char hex SHA-256)

**DB-first DNA model**
- `loadDNAWithStaticFallback(roleCode)` → DB first; static only if `ALLOW_STATIC_DNA_FALLBACK=true`
- `ALLOW_STATIC_DNA_FALLBACK` must be unset in production
- Tables: `specialist_dna_profiles` (no RLS), `specialist_dna_competencies` (no RLS), `organisation_specialist_configuration` (RLS required)
- `REQUIRED_RLS_TABLES` = 52 (was 51)

**Two manifest compilation paths**
- `resolveAndCompileManifest(roleCode, orgId?)` — async, DB-first, used in production `executionService.ts`
- `compileSpecialistManifest(roleCode)` — sync, static registry, kept for test backward compat (deprecated)
- `ResolvedDNA.domain` field must be set so `compileFromResolvedDNA` uses correct domain (not hardcoded "Operations")

**vitest alias for agent-runtime**
- `@workspace/agent-runtime` uses `emitDeclarationOnly: true` → no JS dist files
- Fix: `resolve.alias` in `artifacts/api-server/vitest.config.ts` → `lib/agent-runtime/src/index.ts`
- Do NOT re-export agent-runtime from openclaw to solve this — vitest can't follow the chain anyway

**API server build**
- `@workspace/*` added to esbuild `external` in `artifacts/api-server/build.mjs`
- `dnaStorageService.ts` imports `db` directly from `@workspace/db` (no `getPlatformDb` helper)

**Desktop version**
- `artifacts/needsops-desktop/package.json` → `"version": "0.1.1"`
- Release notes: `artifacts/needsops-desktop/RELEASE_NOTES.md`
- Installers MUST be rebuilt; 0.1.0 installers do not contain `runtimeInstructions` broker logic

**Test count**
- 1475 tests total (was 1436); 39 added in `sprint-srm-hardening.test.ts`
- vitest hoisting: use `vi.hoisted()` when mock factory needs to reference outer `const` mock fns

**Migration**
- `lib/db/migrations/sprint-srm-hardening.sql` — applied to test DB
- Creates all 3 new tables with correct RLS
