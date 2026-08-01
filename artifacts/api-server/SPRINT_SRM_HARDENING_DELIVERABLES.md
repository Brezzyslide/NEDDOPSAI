# Sprint SRM Hardening — Deliverables Report

**Date:** 2026-08-01  
**Prior test count:** 1436 (post Sprint SRM)  
**Post-sprint test count:** 1475  
**New tests added:** 39  
**All tests:** ✅ 1475 / 1475 passing

---

## Phase 1 — Instruction Assembler Wired

### Deliverable 1: `assembleRuntimeInstructions` called in production pipeline

**File:** `artifacts/api-server/src/services/executionService.ts`

`buildExecutionPackage` is now `async`. After compiling the `specialistManifest`, it calls:

```typescript
const assembled = assembleRuntimeInstructions(specialistManifest, steps, constraints);
const instructionHash = createHash("sha256").update(assembled.instruction, "utf8").digest("hex");
```

The result is attached as `runtimeInstructions: CompiledRuntimeInstructions` on the `ExecutionPackage`. The assembler is no longer dead code — it is called on every execution submission.

### Deliverable 2: `runtimeInstructions` propagates through the full chain

The `runtimeInstructions` field is:
- Added to `SpecialistRuntimeManifest` interface (`lib/agent-runtime/src/executionEngine.ts`)
- Required in `ExecutionPackage` (`lib/agent-runtime/src/executionEngine.ts`)
- Required in `OpenClawExecutionPackage` (`lib/openclaw/src/types.ts`)
- Validated in `executePackageTranslator.ts` — packages without it get `UNSUPPORTED_PACKAGE_VERSION`
- Required in `GatewayJobRequest` (`artifacts/desktop-connector/src/broker/types.ts`)
- Validated in `validation.ts` — broker rejects absent or hash-tampered instructions
- Included in `OpenClawRpcRequest` spawn payload (`gatewayAdapter.ts`)
- Included in `BridgeActRequest.task` bridge-http payload (`gatewayAdapter.ts`)
- Passed to `gateway.submit()` in the broker route (`routes/executions.ts`)

---

## Phase 2 — Instruction Hashing and Audit

### Deliverable 3: SHA-256 instruction hash

`instructionHash` is computed as `SHA-256(instruction)` immediately after assembly in `executionService.ts`. It is:
- Stored in `runtimeInstructions.instructionHash` (64-char hex)
- Verified by the broker validator (hash must match instruction content)
- Recorded in `ManifestAuditRecord.instructionHash`
- Logged in structured audit logs at both spawn and bridge-http dispatch

### Deliverable 4: `instructionHash` in manifest audit record

`buildManifestAuditRecord()` now accepts `{ instructionHash, dnaSource }` options. The call site in `executionService.ts` passes `pkg.runtimeInstructions.instructionHash` and `pkg.dnaSource`. The full instruction string is **never** logged or stored in the audit record.

### Deliverable 5: Structured audit log at dispatch (not instruction text)

Both `_spawnSubmit()` and `_bridgeSubmit()` in `gatewayAdapter.ts` now log:
```json
{
  "executionId": "...",
  "specialistId": "...",
  "dnaVersion": "...",
  "manifestHash": "...",
  "instructionHash": "...",
  "instructionLength": 1234,
  "transport": "spawn|bridge-http"
}
```
The full `instruction` string is **never** included in log output.

---

## Phase 3 — DNA Centralised in the Database

### Deliverable 6: `specialist_dna_profiles` table

**File:** `lib/db/src/schema/specialistDnaProfiles.ts`

Platform-controlled table (no RLS). Fields: `specialist_id`, `version`, `status` (draft/published/retired), `mission`, `objectives`, `responsibilities`, `operating_principles`, `communication_style`, `escalation_rules`, `prohibited_behaviours`, `memory_policy`, `published_at`, `retired_at`.

Only one row per `specialist_id` should have `status = 'published'` at a time.

### Deliverable 7: `specialist_dna_competencies` table

**File:** `lib/db/src/schema/specialistDnaCompetencies.ts`

Platform-controlled (no RLS). Child rows of `specialist_dna_profiles` via FK. Fields: `dna_profile_id`, `competency_code`, `name`, `level`, `description`, `version`.

### Deliverable 8: `dnaStorageService.ts`

**File:** `artifacts/api-server/src/services/dnaStorageService.ts`

Four exported functions:

| Function | Description |
|---|---|
| `loadDNAFromDatabase(roleCode)` | DB query only — no fallback |
| `loadDNAWithStaticFallback(roleCode)` | DB-first; falls back to static registry if `ALLOW_STATIC_DNA_FALLBACK=true` |
| `loadOrgSpecialistConfig(orgId, specialistId)` | Returns `ResolvedOrgContext` from `organisation_specialist_configuration` |
| `seedDNAFromStaticRegistry(roleCode)` | One-time migration: copies static profile into the DB |

`ALLOW_STATIC_DNA_FALLBACK=true` is required for development; must be unset in production. When used, the service logs a warning and sets `source: "static_fallback"` in the returned DNA.

---

## Phase 4 — Static Registry Transition

### Deliverable 9: `resolveAndCompileManifest()` — new async production path

**File:** `artifacts/api-server/src/services/specialistRuntimeManifestService.ts`

```typescript
async function resolveAndCompileManifest(
  roleCode: string,
  organizationId?: string,
): Promise<SpecialistRuntimeManifest & { dnaSource: "database" | "static_fallback" }>
```

Called by `executionService.ts`. DB-first resolution via `loadDNAWithStaticFallback`. Optional org context loaded via `loadOrgSpecialistConfig`. Throws `MissingDNAError` if no DNA found (and fallback is disabled or also absent).

### Deliverable 10: `compileSpecialistManifest()` retained for backward compatibility

The synchronous static-registry compiler is retained and marked `@deprecated`. All existing Sprint SRM tests use it unchanged. New production code uses `resolveAndCompileManifest`.

---

## Phase 5 — Tenant/Organisation Context in Manifest

### Deliverable 11: `organisationContext` optional field on `SpecialistRuntimeManifest`

**File:** `lib/agent-runtime/src/executionEngine.ts`

```typescript
organisationContext?: {
  businessType?: string;
  services?: string[];
  operatingHours?: string;
  timezone?: string;
  systems?: string[];
  firstWeekGoals?: string[];
  escalationContacts?: string[];
}
```

### Deliverable 12: `organisation_specialist_configuration` table

**File:** `lib/db/src/schema/organisationSpecialistConfig.ts`

**RLS enabled** — `REQUIRED_RLS_TABLES` updated from 51 → 52. Policy: `tenant_isolation` (standard `app.current_tenant` pattern). Fields: `organization_id`, `specialist_id`, `first_week_goals`, `preferred_style`, `escalation_contacts`, `additional_context`, `source`, `last_confirmed_at`.

**Constraints enforced:**
- Org context is loaded per `(organizationId, specialistId)` — never cross-tenant
- Platform DNA fields (mission, objectives, prohibitedBehaviours) are never overridden by org context
- No credentials, tokens, passwords, or PII may enter this table

---

## Phase 6 — Broker Structural Enforcement

### Deliverable 13: Broker validation rejects missing `runtimeInstructions`

**File:** `artifacts/desktop-connector/src/broker/validation.ts`

Three new post-parse checks added (after existing `specialistManifest` check):

1. **Missing `runtimeInstructions`** → `UNSUPPORTED_PACKAGE_VERSION`
2. **`instructionHash` mismatch** → `INSTRUCTION_HASH_MISMATCH` (instruction tampering detected)
3. **`runtimeInstructions.specialistId` ≠ `workforceRole`** → `INSTRUCTION_ROLE_MISMATCH`
4. **`runtimeInstructions.manifestHash` ≠ `specialistManifest.manifestHash`** → `MANIFEST_HASH_MISMATCH`

### Deliverable 14: `workerProfile` remains a separate structural layer

`runtimeInstructions` never contains permission fields (`allowedChannels`, `prohibitedActions`, `allowedBrowserDomains`). These remain exclusively in `workerProfile`, which is enforced structurally by the broker — not by instruction text. The 5 new permission enforcement tests in Phase 6 confirm this.

---

## Phase 7 — Release / Installer Version Correction

### Deliverable 15: Desktop version bumped 0.1.0 → 0.1.1

**File:** `artifacts/needsops-desktop/package.json`  
`"version": "0.1.1"`

### Deliverable 16: Release notes document rebuild requirement

**File:** `artifacts/needsops-desktop/RELEASE_NOTES.md`

Documents:
- Why 0.1.0 installers cannot be reused
- All broker bundle changes in 0.1.1
- Build commands required
- Bundle verification grep commands

---

## Phase 8 — CI and Build Verification

### Deliverable 17: API server build clean

```
pnpm --filter @workspace/api-server build  ✅
```

`@workspace/*` added to esbuild `external` list. `dnaStorageService.ts` imports `db` directly from `@workspace/db`.

### Deliverable 18: Desktop connector bundle verified

```
pnpm --filter @workspace/desktop-connector build  ✅
```

Bundle contains all five required strings:
- `specialistManifest` ✅
- `runtimeInstructions` ✅
- `manifestVersion` ✅
- `instructionHash` ✅
- `UNSUPPORTED_PACKAGE_VERSION` ✅

### Deliverable 19: `vitest.config.ts` workspace alias

`artifacts/api-server/vitest.config.ts` now includes a `resolve.alias` mapping `@workspace/agent-runtime` → its TypeScript source. This is required because `agent-runtime` uses `emitDeclarationOnly: true` and produces no `.js` dist files.

### Deliverable 20: All 1475 tests pass

```
Test Files  34 passed (34)
Tests       1475 passed (1475)
```

Prior count was 1436. 39 new tests were added:

| File | Tests |
|---|---|
| `sprint-srm-hardening.test.ts` | 39 |
| `sprint-srm.test.ts` | +0 (updated, same count) |
| `sprint8-openclaw.test.ts` | +0 (fixture updated, same count) |

---

## Phase 9 — Live Execution Proof

### Deliverable 21: Contract-level execution proof (test)

`sprint-srm-hardening.test.ts` contains two Phase 9 tests labelled `[CONTRACT]`:

1. **Full end-to-end proof** — demonstrates the complete chain: DNA → manifest → instruction assembly → instruction hash → `CompiledRuntimeInstructions` → package → OpenClaw field. Verifies the `runtimeInstructions.instruction` contains `SPECIALIST IDENTITY`, `MISSION`, and `PROHIBITED BEHAVIOURS` sections. Verifies that changing the DNA version changes the instruction hash. Verifies that `workerProfile.prohibitedActions` is enforced separately.

2. **Audit metadata proof** — verifies `instructionHash` is present in the audit record but the full `instruction` string is absent.

**Note:** A real OpenClaw process is not available in Replit CI. The contract tests use a stub that records exactly what OpenClaw would receive. Before the first production release, a local smoke test must be performed with a real OpenClaw broker to confirm actual instruction consumption.

---

## DB Migration

**File:** `lib/db/migrations/sprint-srm-hardening.sql`

Applied to test database. Creates:
- `specialist_dna_profiles` (no RLS)
- `specialist_dna_competencies` (no RLS)  
- `organisation_specialist_configuration` (RLS: `tenant_isolation` policy)

---

## REQUIRED_RLS_TABLES

Updated: **51 → 52** (`organisation_specialist_configuration` added).

`sprint7-rls-safety.test.ts` count assertion updated to `.toHaveLength(52)`.
