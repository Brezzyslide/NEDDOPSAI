# Sprint 9.5 — Completion Report
## Specialist Eligibility and Specialist Runtime

**Date:** 2026-07-27  
**Sprint:** 9.5  
**Status:** ✅ Complete

---

## Executive Summary

Sprint 9.5 delivers full specialist eligibility enforcement and a durable specialist runtime for NeedsOps AI+. Before any specialist is assigned to a task, a 12-point eligibility check (sync fast path + async full check) verifies capability code, specialist knowledge, role alignment, entitlement, pack inclusion, usage limits, instruction version, data governance, region, approval requirements, dependency readiness, and execution channel availability.

Three roles have real AI-backed intelligence: **Compliance Officer**, **Document Specialist**, and **Operations Manager**. All other specialist roles return a "not yet activated" blocked result. The Chief of Staff orchestrator coordinates plan creation, dispatches ready runs, consolidates results, detects conflicts, and generates OpenClaw handoff packages.

---

## RLS Tables

**Total REQUIRED_RLS_TABLES: 33**

New tables added in Sprint 9.5 (4):
| Table | Purpose |
|---|---|
| `specialist_runs` | Durable record of each specialist execution, with full state machine |
| `specialist_queue` | Atomic work queue with FOR UPDATE SKIP LOCKED, lease management |
| `specialist_run_memory` | Per-run input/output memory items for audit and continuity |
| `specialist_conflicts` | Detected conflicts between specialist positions, with resolution tracking |

Previously added in Sprint 9.4:
| Table | Purpose |
|---|---|
| `capability_decisions` | Audit log of capability identification decisions |

---

## New Services (7)

| Service | Responsibility |
|---|---|
| `specialistEligibilityService.ts` | 12-check eligibility; sync + async paths |
| `specialistIntelligenceService.ts` | AI gateway execution with deterministic fallback |
| `specialistRunService.ts` | CRUD + state machine enforcement for `specialist_runs` |
| `specialistWorkPackageService.ts` | Build, validate, and plan specialist work packages |
| `specialistContextService.ts` | Role-filtered context assembly from memory + conversation |
| `specialistQueueService.ts` | Atomic queue: enqueue, claim, lease expiry, stats |
| `chiefOfStaffOrchestrator.ts` | Orchestration: plan creation, dispatch, consolidation, OpenClaw handoff |

---

## New Routes

| Method | Path | Description |
|---|---|---|
| GET | `/v1/organisations/:slug/tasks/:taskId/specialist-runs` | List runs for a task |
| GET | `/v1/organisations/:slug/tasks/:taskId/specialist-runs/:runId` | Single run detail |
| GET | `/v1/organisations/:slug/tasks/:taskId/specialist-runs/consolidated` | Consolidated results |
| POST | `/v1/organisations/:slug/tasks/:taskId/specialist-runs/:runId/clarification` | Provide clarification |
| POST | `/v1/organisations/:slug/tasks/:taskId/specialist-runs/:runId/cancel` | Cancel a run |
| GET | `/v1/platform/capabilities` | List capabilities (platform admin) |
| GET | `/v1/platform/capabilities/:code` | Get single capability |
| POST | `/v1/platform/capabilities` | Create draft capability |
| PATCH | `/v1/platform/capabilities/:code` | Edit capability |
| POST | `/v1/platform/capabilities/:code/activate` | Activate capability |
| POST | `/v1/platform/capabilities/:code/deprecate` | Deprecate capability |
| GET | `/v1/platform/specialist-runs` | Platform monitoring: all runs |
| GET | `/v1/platform/specialist-runs/stats` | Platform monitoring: stats |

---

## New Tests

| File | Tests | Coverage |
|---|---|---|
| `sprint95-specialist-eligibility.test.ts` | ~30 | All 12 eligibility checks, sync path, getEligibleSpecialists, hasActiveIntelligence, decision interface shape |
| `sprint95-specialist-runs.test.ts` | ~38 | State machine (all valid + invalid transitions), plan building, dependency resolution, work package validation |
| `sprint95-specialist-reasoning.test.ts` | ~13 | Intelligence service: all 3 active + inactive blocked; SpecialistRunResult shape; revision + clarification resume |
| `sprint95-orchestrator.test.ts` | ~12 | Plan creation (eligible + blocked), consolidation, OpenClaw precondition failures, audit events, RLS table count ≥ 33 |

**Total test count: 684 (591 pre-sprint + 93 new)**

---

## Frontend

### Task Workroom
- **SpecialistRunsPanel** (`src/components/workroom/SpecialistRunsPanel.tsx`) integrated into the Task Workroom right panel under the Workforce section. Polls every 8s, shows status badges, confidence, findings, unresolved questions, external actions, clarification form, and cancel button.

### Platform Console
- **SpecialistOpsPage** (`src/pages/platform/SpecialistOpsPage.tsx`) added at `/platform/specialist-ops`.
- Route registered in `App.tsx`.
- Navigation item **"Specialist Ops" 🧠** added to `PLATFORM_NAV` in `platformApi.ts`.

---

## Audit Events Added

19 new audit events registered in `lib/shared/src/index.ts`:

```
specialist.eligibility_checked         specialist.assignment_allowed
specialist.assignment_blocked          specialist.run_created
specialist.run_queued                  specialist.run_started
specialist.run_completed               specialist.run_failed
specialist.run_retried                 specialist.run_cancelled
specialist.context_built               specialist.work_package_created
specialist.clarification_requested     specialist.clarification_resolved
specialist.conflict_detected           chief_of_staff.specialists_dispatched
chief_of_staff.consolidation_started   chief_of_staff.consolidation_completed
openclaw.handoff_package_created
```

---

## Architecture Decisions

| Decision | Rationale |
|---|---|
| 3 active specialists only | Focus real AI effort where the domain models are validated |
| No specialist substitution | If eligibility fails, block and record — never silently swap |
| Idempotency key on `specialist_runs` | Prevents duplicate runs for same task+capability+role |
| `FOR UPDATE SKIP LOCKED` in queue | Safe multi-worker claiming without deadlocks |
| Evidence reference validation | Rejects hallucinated evidence references not in the work package |
| Sync eligibility in registry only | Async eligibility enforcement is in the orchestrator, not the legacy `planTask()` |

---

## Known Limitations

1. **Queue worker not daemonized** — `releaseExpiredLeases()` and `claimNext()` must be called by a scheduled job or request handler. A background worker is recommended for Sprint 9.6.
2. **Static capability CRUD** — The platform CRUD routes update the in-memory registry at runtime but require a code deployment to persist new capabilities. A DB-backed registry is recommended for Sprint 9.6.
3. **No live OpenClaw channel** — The `generateOpenClawPackage()` output is stored but not yet delivered over a live channel. OpenClaw handoff integration is planned for Sprint 9.6.
4. **Specialist runs not auto-dispatched from task approval** — `chiefOfStaffOrchestrator.dispatchReadyRuns()` must be wired into `taskService.ts` after the task moves to `approved` state. This wiring is deferred to Sprint 9.6.

---

## Recommended Next Sprint Items

- Wire orchestrator dispatch into `taskService.ts` on task approval
- Daemonize the specialist queue worker (cron or background job)
- Persist capability registry to a DB table with proper versioning
- Build live OpenClaw handoff channel for external execution
- Add specialist run webhook / push notification for mobile
- Expand active intelligence to 3 more specialist roles (payroll_officer, accounts_officer, hr_manager)
