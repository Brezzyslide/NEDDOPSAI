---
name: NeedsOps Sprint 10 — Digital Workforce Intelligence
description: lib/workforce-dna package, DNA-driven specialist prompts, version tracking, execution intents, auto-dispatch, queue worker upgrade
---

## What was delivered

- **lib/workforce-dna** — new TypeScript package `@workspace/workforce-dna` with DNA type system, 4 production profiles (chief_of_staff, compliance_officer, operations_manager, document_specialist), registry, and `buildDNASystemInstruction(roleCode)` / `captureSpecialistRunVersions()` helpers. All profiles at v1.0.0. allowInventedReferences: false on all 4.

- **DB migration `sprint10-workforce-intelligence.sql`** — adds 6 version columns to `specialist_runs` (dna_version, worker_profile_version, capability_version, reasoning_version, output_schema_version, model_version); creates `execution_intents` table with RLS.

- **specialistIntelligenceService.ts** — now imports from @workspace/workforce-dna; buildDNASystemInstruction replaces hardcoded SPECIALIST_SYSTEM_INSTRUCTIONS; chief_of_staff added as active specialist; 6 version fields now persisted on every run.

- **chiefOfStaffLLMService.ts** — CoS DNA injected as system instruction; 9-step Strategic Orchestration Methodology added to prompt; new optional output fields: orchestrationSteps, shouldDispatchSpecialists, specialistSequence.

- **Auto-dispatch on approval** — taskService.transitionTaskState and createTask both fire dispatchReadyRunsByTask (fire-and-forget) when task reaches "approved" state.

- **Queue worker** — artifacts/worker/src/index.ts replaced with real polling loop: claimNext → markRunning → executeSpecialistStep → markCompleted, MAX_RETRIES=3, POLL_INTERVAL_MS=5000 (env WORKER_POLL_MS), graceful SIGTERM/SIGINT, heartbeat every 60s.

- **executionIntentService.ts** — persist/retrieve/approve/reject execution intents; called from orchestrator after each run.

- **Execution Intents API** — GET /organisations/:slug/tasks/:taskId/execution-intents; POST approve/reject.

- **Conflict resolution** — evaluateConflictWithLLM() in orchestrator; falls back to heuristic on LLM failure.

- **Specialist conversation messages** — after each run, a specialist_update message posted to workroom conversation with role badge, confidence %, summary.

- **Web Task Workroom** — SpecialistBadge component; detects isSpecialistUpdate metadata; role-colour map (compliance=red, ops=blue, doc=purple, cos=emerald).

- **Mobile Task Workroom** — SpecialistMessageBubble RN component; TaskSpecialistMessages sub-component.

## Key invariants now

- REQUIRED_RLS_TABLES = 35 (execution_intents added, tenant-scoped)
- Tests: 796 passing (89 new in sprint10-workforce-intelligence.test.ts)
- DNA profiles: immutable at v1.0.0 — editing creates a new version
- Version columns on specialist_runs: always set via captureSpecialistRunVersions()
- All AI calls through lib/ai-gateway — no direct OpenAI SDK outside providers/openai.ts
- OpenClaw boundary preserved: requestedExternalActions → execution_intents, never executed directly

## Why
**Why captureSpecialistRunVersions is at run start (not end):** Reproducibility — if the DNA version changes mid-sprint, the run record must reflect what was active when it ran, not what's current at completion time.

## Outstanding for future sprints
- OpenClaw live execution from approved execution_intents
- DNA v2 profiles (additional specialists, updated methodology)
- Additional specialist roles beyond the current 4
- Worker as a proper long-running service (currently restarts on deploy)
