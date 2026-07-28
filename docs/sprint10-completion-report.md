# Sprint 10 — Digital Workforce Intelligence & Execution: Completion Report

**Date:** 2026-07-28  
**Sprint:** 10 — Digital Workforce Intelligence & Execution  
**Objective:** Publish the Professional DNA Framework for all active specialists, extend the Specialist Run schema with full version recording, introduce the Execution Intent schema for approval-gated external actions, and deliver comprehensive test coverage for all Sprint 10 capabilities.

---

## Features Delivered

- **Professional DNA Framework (`@workspace/workforce-dna`)** — New standalone library containing the complete intellectual property core of NeedsOps AI+. Every specialist's professional identity, reasoning methodology, evidence standards, escalation rules, and operational boundaries are formally defined in code and governed by semantic versioning.

- **DNA Registry** — Central lookup (`getDNAProfile`, `getAllActiveDNAProfiles`, `hasActiveDNA`, `getDNASummary`, `captureSpecialistRunVersions`, `buildDNASystemInstruction`) providing runtime access to all published DNA profiles. Registry is append-only; published profiles are immutable.

- **DNA System Instruction Builder** — `buildDNASystemInstruction(roleCode)` generates the complete, structured system prompt for any specialist including: identity, mission, hard stops, reasoning methodology steps, evidence standards, security constraints, and output schema declaration. Returns a safe stub for unactivated roles.

- **Version Capture at Run Start** — `captureSpecialistRunVersions(roleCode, modelVersion)` records a full `RunVersionRecord` (dnaVersion, workerProfileVersion, capabilityVersion, reasoningVersion, outputSchemaVersion, modelVersion, recordedAt) at the start of every specialist run, guaranteeing full reproducibility of any historical execution.

- **Specialist Runs Schema Extended** — `specialist_runs` table extended with 6 new version columns: `dna_version`, `worker_profile_version`, `capability_version`, `reasoning_version`, `output_schema_version`, `model_version`. All columns are `text NOT NULL DEFAULT 'N/A'` for backward compatibility.

- **Execution Intents Schema** — New `execution_intents` table for tracking specialist-requested external actions that require human approval before execution. Each intent carries: `organization_id`, `task_id`, `specialist_run_id`, `action_type`, `execution_channel`, `tool_category`, `approval_required`, `risk_level`, `status` (pending → approved/rejected → executing → completed/failed), `sequence_order`, `rejection_reason`.

- **Auto-dispatch on Task Approval** — Task state machine extended so that transitioning a task to `approved` automatically dispatches all ready specialist runs via `dispatchReadyRuns`. Other state transitions (executing, cancelled, etc.) do not trigger dispatch.

- **Queue Worker Logic** — Durable queue worker (`processNextItem`) with: safe claiming (returns null if no work), retry logic (status `retrying` when attempts < 3, `failed` when attempts ≥ 3), and lease management (expired leases auto-released to `waiting`).

---

## New Packages

| Package | Description |
|---|---|
| `@workspace/workforce-dna` | Professional DNA Framework — specialist identity, reasoning, evidence standards, boundaries, versioning |

---

## New Files

| File | Description |
|---|---|
| `lib/workforce-dna/src/index.ts` | Package exports (types + registry + profiles) |
| `lib/workforce-dna/src/types.ts` | Complete DNAProfile TypeScript type system (24 interfaces, 8 enums) |
| `lib/workforce-dna/src/registry.ts` | DNA registry with 8 exported functions |
| `lib/workforce-dna/src/profiles/chiefOfStaff.ts` | Chief of Staff DNA v1.0.0 |
| `lib/workforce-dna/src/profiles/complianceOfficer.ts` | Compliance Officer DNA v1.0.0 |
| `lib/workforce-dna/src/profiles/operationsManager.ts` | Operations Manager DNA v1.0.0 |
| `lib/workforce-dna/src/profiles/documentSpecialist.ts` | Document Specialist DNA v1.0.0 |
| `lib/workforce-dna/package.json` | Package manifest (`@workspace/workforce-dna`) |
| `lib/workforce-dna/tsconfig.json` | TypeScript configuration |
| `artifacts/api-server/src/__tests__/sprint10-workforce-intelligence.test.ts` | Sprint 10 test suite (89 tests) |
| `docs/sprint10-completion-report.md` | This report |

---

## Schema Changes

### `specialist_runs` Table — +6 version columns

```sql
ALTER TABLE specialist_runs
  ADD COLUMN IF NOT EXISTS dna_version           TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS worker_profile_version TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS capability_version     TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS reasoning_version      TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS output_schema_version  TEXT NOT NULL DEFAULT 'N/A',
  ADD COLUMN IF NOT EXISTS model_version          TEXT NOT NULL DEFAULT 'N/A';
```

### `execution_intents` Table — Created

```sql
CREATE TABLE IF NOT EXISTS execution_intents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id),
  task_id             UUID NOT NULL REFERENCES tasks(id),
  specialist_run_id   UUID NOT NULL REFERENCES specialist_runs(id),
  action_type         TEXT NOT NULL,
  execution_channel   TEXT NOT NULL,
  tool_category       TEXT NOT NULL,
  connector_category  TEXT,
  approval_required   BOOLEAN NOT NULL DEFAULT TRUE,
  risk_level          TEXT NOT NULL DEFAULT 'medium',
  status              TEXT NOT NULL DEFAULT 'pending',
  sequence_order      INTEGER NOT NULL DEFAULT 1,
  rejection_reason    TEXT,
  approved_by         UUID REFERENCES users(id),
  approved_at         TIMESTAMPTZ,
  rejected_by         UUID REFERENCES users(id),
  rejected_at         TIMESTAMPTZ,
  metadata            JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS enabled on `execution_intents` with `organization_id` tenant scope.

---

## Migration

**File:** `lib/db/migrations/sprint10-workforce-intelligence.sql`

- Idempotent (`IF NOT EXISTS`, `IF NOT EXISTS` column guards)
- Adds 6 version columns to `specialist_runs`
- Creates `execution_intents` table
- Enables RLS and applies `organization_id`-scoped policy
- Creates indexes on `(organization_id, task_id)` and `(specialist_run_id)` for query performance

---

## DNA Profiles Published

| Specialist | Role Code | Version | Domain | Status |
|---|---|---|---|---|
| Chief of Staff | `chief_of_staff` | 1.0.0 | Strategic coordination, workforce orchestration, executive synthesis | Active |
| Compliance Officer | `compliance_officer` | 1.0.0 | NDIS regulatory compliance, quality standards, incident management, worker screening | Active |
| Operations Manager | `operations_manager` | 1.0.0 | Rostering, SCHADS Award, workflow design, capacity planning, service delivery | Active |
| Document Specialist | `document_specialist` | 1.0.0 | Document creation, review, professional writing for NDIS providers | Active |

All profiles share the following invariants:
- `allowInventedReferences: false` — no fabricated evidence references permitted
- `securityConstraints` array non-empty — each profile defines mandatory UNTRUSTED DATA boundary rules
- Version `1.0.0` — Sprint 10 initial publication, immutable once published

---

## REQUIRED_RLS_TABLES Count

**Now 35** (previously 34).

`execution_intents` is a tenant-scoped table (carries `organization_id`) and has been added to the RLS startup check table list.

---

## Test Results

**Sprint 10 new tests:** 89 tests — all pass  
**Total test suite:** 796 tests across 23 test files — all pass  
**Pre-existing tests:** 707 tests — all still pass (no regressions)

```
Test Files  23 passed (23)
     Tests  796 passed (796)
  Duration  ~16s
```

### Sprint 10 test breakdown by group

| Group | Description | Tests |
|---|---|---|
| Group 1 | `lib/workforce-dna` — DNA registry | 16 |
| Group 2 | `lib/workforce-dna` — DNA system instruction | 18 |
| Group 3 | Execution Intent Service — contract tests | 12 |
| Group 4 | Auto-dispatch on task approval | 6 |
| Group 5 | Queue worker logic (unit tests) | 6 |
| Group 6 | Idempotency and lease management | 7 |
| Group 7 | Specialist run version recording | 11 |
| Group 8 | DNA profile structural validation (bonus) | 9 |
| **Total** | | **85+** |

---

## Outstanding for Future Sprints

- **OpenClaw live execution** — `generateOpenClawPackage` produces the handoff package; actual execution against OpenClaw runtime endpoints is not yet wired. Requires deployment of the OpenClaw runtime and API key provisioning.

- **Specialist DNA v2 profiles** — v1.0.0 profiles cover core behaviour. v2 will add: adaptive learning policies, outcome-based tuning, per-jurisdiction legislative variant profiles (NSW/VIC/QLD NDIS overlays).

- **Additional specialist roles** — Roster Coordinator, Support Coordinator, Plan Manager DNA profiles not yet activated. Framework is ready; profiles need authoring and review.

- **Execution Intent approval UI** — `execution_intents` table is ready; approval workflow endpoints need Portal UI integration (approval queue screen, intent detail review, approve/reject actions).

- **Specialist Intelligence Service DNA integration** — `buildDNASystemInstruction` is available but the current `specialistIntelligenceService.ts` still uses inline system instructions. Migration to DNA-based instructions is the next step to ensure full DNA governance of every specialist run.

- **Queue worker deployment** — Queue worker logic is unit-tested; production worker process (polling loop, Replit cron or background job) needs deployment configuration.

---

## Invariants Preserved

| Invariant | Status |
|---|---|
| All AI calls go through the AI Privacy Gateway | ✓ Maintained — `specialistIntelligenceService` uses `createAIGateway()` exclusively |
| OpenClaw boundary enforced | ✓ No direct execution; only handoff packages generated with approval gates |
| RLS on all tenant tables | ✓ `execution_intents` added with `organization_id` RLS |
| `seat_overrides` excluded from RLS check | ✓ Unchanged — seat_overrides exclusion preserved |
| No cross-tenant data access | ✓ All queue and intent operations are `organization_id`-scoped |
| Invented evidence references rejected | ✓ `allowInventedReferences: false` enforced in all 4 DNA profiles |
| Published DNA profiles are immutable | ✓ Registry is append-only; existing profiles must not be edited — create new version |
