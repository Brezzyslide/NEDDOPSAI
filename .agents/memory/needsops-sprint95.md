---
name: NeedsOps Sprint 9.5 — Specialist Eligibility and Runtime
description: Eligibility enforcement, specialist AI runs, orchestrator, queue, 4 new RLS tables, REQUIRED_RLS_TABLES=33
---

## Key Facts

- **REQUIRED_RLS_TABLES = 33** (28 pre-9.4, +1 `capability_decisions` in 9.4, +4 in 9.5)
- New tables: `specialist_runs`, `specialist_queue`, `specialist_run_memory`, `specialist_conflicts`
- All policies must be named exactly `tenant_isolation` — the `rlsVerifier.ts` checks for this exact name
- `organizations.id` is `TEXT` not `UUID` — all FK references use TEXT
- PostgreSQL does not support `CREATE POLICY IF NOT EXISTS` — use `DROP POLICY IF EXISTS` + `CREATE POLICY`

## Active Specialists
Only 3 roles have real AI intelligence: `compliance_officer`, `document_specialist`, `operations_manager`. All others return a "not yet activated" blocked result via `hasActiveIntelligence()`.

## Capability Codes (registry format)
Codes use `category.specific_action` pattern:
- `compliance.audit_readiness`, `compliance.gap_analysis`, `compliance.evidence_review`, `compliance.corrective_actions`
- `documents.draft`
- `operations.workflow_review`, `operations.capacity_analysis`
- (many more — grep `capabilityRegistry.ts` for full list)

## Eligibility Architecture
- `validateSpecialistEligibilitySync(roleCode, capabilityCode)` — fast no-DB check using the Sprint 9.4 registry
- `checkSpecialistEligibility(roleCode, capabilityCode, level, ctx)` — 12-check async full check
- **Do NOT apply sync eligibility to `planTask()`** — the old workforce registry uses different capability code formats (keyword-based). Only the orchestrator's `createSpecialistPlan()` enforces eligibility.
- `getEligibleSpecialists(capabilityCode)` — returns specialist codes from registry eligibleRoles
- `hasActiveIntelligence(roleCode)` — checks the 3 active roles

## State Machine Terminal States
`completed`, `cancelled`, `expired` — no outbound transitions from these states.

## Queue Safety
`specialist_queue` has unique index on `specialist_run_id`. `claimNext()` uses `FOR UPDATE SKIP LOCKED`. Queue worker is NOT yet daemonized — must be wired into a scheduled job.

## OpenClaw Handoff
`generateOpenClawPackage()` throws if there are blocking unresolved questions. The handoff package is stored but not yet delivered over a live channel.

## Outstanding Wiring (deferred to Sprint 9.6)
- `taskService.ts`: after task moves to `approved`, call `chiefOfStaffOrchestrator.dispatchReadyRuns()` to start specialist execution
- Daemonize the queue worker (cron or background job)
- Persist capability registry to DB for non-code CRUD

## Test Count
684 total (591 pre-sprint + 93 new in Sprint 9.5)

## Migration
`lib/db/migrations/sprint95-specialist-runtime.sql` — idempotent (DROP POLICY IF EXISTS + CREATE POLICY, CREATE TABLE IF NOT EXISTS)
