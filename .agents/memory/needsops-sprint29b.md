---
name: NeedsOps Sprint 29B Unified Execution Engine
description: Architectural refactor unifying both execution paths under a single engine; thin adapters keep backward compat; ResourceRegistry decouples evidence from providers.
---

## What changed

Two divergent execution paths unified under `UnifiedExecutionEngine`:
- Path A (conversation): `specialistIntelligenceService.executeRun` → engine.executeConversation
- Path B (task): `workExecutionPipelineService.executeWork` → engine.executeTask

Both old service files are now thin adapters that delegate to `createUnifiedExecutionEngine()`.

## Key files

- `services/unifiedExecutionEngine.ts` — ALL execution logic; exports types consumed by adapters
- `services/workExecutionPipelineService.ts` — thin adapter + re-exports engine types for backward compat
- `services/specialistIntelligenceService.ts` — thin adapter; types (SpecialistRunResult etc.) defined here
- `lib/resources/ResourceRegistry.ts` — routes evidence to providers; KRS wired as sole active provider
- `lib/resources/ExecutionSession.ts` — session lifecycle type stub (active in future connector sprint)
- `types/canonicalExecutionContext.ts` — 10-field context shape (both paths build this)

## Critical rules

- `unifiedExecutionEngine.ts` imports specialist types via `import type` ONLY — runtime imports flow the other direction (circular prevention).
- `workExecutionPipelineService.ts` must re-export `FallbackDraftError`, `EXECUTION_STAGE_LABELS`, and all `Execute*` types — coordinator and tests import from there.
- `specialistIntelligenceService.ts` owns the type definitions (SpecialistRunResult, SpecialistWorkPackage, SpecialistContext, EvidenceReference) — engine imports these type-only.
- `outputMode: "text"` for task execution (prose draft); `outputMode: "json"` for conversation execution (specialist result JSON).
- Source-inspection tests (sprint287) now check `unifiedExecutionEngine.ts` for both patterns — NOT the adapter files.

**Why:** Dual-path architecture made evidence resolution, gateway config, and retry logic drift apart. One engine enforces a single contract for all triggers.

**How to apply:** All new specialist execution features go in `unifiedExecutionEngine.ts`. Adapters never gain business logic — they stay thin forever.

## ResourceRegistry pattern

- `createResourceRegistry()` returns a pre-configured registry
- `registry.resolveEvidenceForTask()` → delegates to `knowledgeResolutionService.resolveEvidence`
- `registry.resolveEvidenceForConversation()` → returns null (Sprint 29C will populate)
- Future providers register via `registry.register(provider)` without touching engine code

## Test count

3,430 passing after Sprint 29B (0 failures). New tests in `sprint29b-unified-execution-engine.test.ts`.
