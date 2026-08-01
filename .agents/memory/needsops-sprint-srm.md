---
name: NeedsOps Specialist Runtime Manifest
description: SpecialistRuntimeManifest type, compiler service, four-layer execution package, full passthrough to OpenClaw spawn and bridge-http payloads
---

## Key decisions

**Four-layer ExecutionPackage (Sprint SRM):**
1. `specialistManifest` — who the specialist is (identity + behaviour, compiled from DNA)
2. `workerProfile` — what the specialist is technically permitted to do (unchanged, hard enforcement)
3. `steps` — what the specialist must do right now
4. `requestedTools/connectors` — how the work may be carried out

**`specialistManifest` is REQUIRED on all new packages:**
- Old packages without it → `UNSUPPORTED_PACKAGE_VERSION` error at both NeedsOps translator and broker validator
- `manifestVersion: 1` is a required literal — increment if shape changes

**SpecialistRuntimeManifest shape:**
- `specialistId`, `workforceRole`, `displayName`, `domain`, `dnaProfileId`, `dnaVersion`, `manifestVersion: 1`
- `mission`, `objectives`, `responsibilities`, `operatingPrinciples`
- `communicationStyle: { tone, detailLevel, language }`
- `competencies[]: { code, name, level, description, version }` — version inherits dnaVersion
- `escalationRules[]`, `prohibitedBehaviours[]`
- `memoryPolicy: { allowedScopes[], prohibitedScopes[] }`
- `manifestHash` — SHA-256 of canonical JSON (manifestHash field set to "" in hash input)
- `generatedAt` — ISO timestamp

**Manifest does NOT contain:** allowedChannels, allowedBrowserDomains, prohibitedActions, riskLevel, secrets, tenantId, credentials, billing/subscription data.

**Compiler (`specialistRuntimeManifestService.ts`):**
- Throws `MissingDNAError` (code: MISSING_DNA) if no DNA profile exists
- Throws `InactiveDNAError` (code: INACTIVE_DNA) if `currentVersion.isActive === false`
- Entitlement check (org → specialist) remains in `executionService.ts` via `checkExecutionAccess` before compiler is called

**Full passthrough chain:**
- `executionService.ts` → compiles manifest, attaches to `ExecutionPackage`
- `executionPackageTranslator.ts` → copies `specialistManifest` unchanged to `OpenClawExecutionPackage`
- Desktop broker `validation.ts` → Zod schema validates manifest; rejects old packages
- Desktop broker `executions.ts` → extracts and passes to `gateway.submit()`
- `gatewayAdapter.ts` spawn: `OpenClawRpcRequest` includes `specialistManifest` + `workerProfile`
- `gatewayAdapter.ts` bridge-http: `BridgeActRequest.task` includes `specialistManifest` + `workerProfile`

**Test files updated:**
- `sprint8-openclaw.test.ts` — added `STUB_MANIFEST_OPS_MANAGER` and added to `makeExecutionPackage`
- `sprint-srm.test.ts` — 54 new tests covering all 16 sprint-required cases

**No DB changes** — manifest travels in `executionPackage` JSONB and broker `packageJson`; audit record goes into `executionSession.metadata`.

## Test counts
- Sprint SRM: 1436 total tests (54 new in sprint-srm.test.ts)
- No REQUIRED_RLS_TABLES change
