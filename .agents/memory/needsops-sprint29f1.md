---
name: NeedsOps Sprint 29F.1
description: Connector hardening, write idempotency, action lifecycle persistence, approval plans, evidence-grounded self-review, manifest integrity, legacy isolation.
---

# Sprint 29F.1 — Connector Hardening, Loose Ends & End-to-End Acceptance

## What was built

**Part 1 — Write Idempotency**
- `writeIdempotencyService.ts` — Server-side bounded dedup store (max 1,000 entries, 24h TTL, LRU eviction).
  - `checkIdempotency(orgId, deviceId, key)` → `{ found, isExecuting, isDuplicate, record }`
  - `beginIdempotencyRecord(...)` before bridge call
  - `finaliseIdempotencyRecord(...)` with `{ success, status, completedAt, data?, errorCode?, errorMessage? }` after bridge returns
- `idempotencyStore.ts` (desktop-connector) — Mirror dedup store (max 500 entries).
- Key format: `{executionId}:{actionId}` — deterministic, server-generated.
- `WRITE_OPERATION_TYPES` set exported from `connectorBridgeService.ts` (8 types).
- Write ops: `maxRetries = 0` enforced unconditionally in `connectorBridgeService.submitConnectorOperation`.
- Dispatcher: checks dedup before bridge dispatch; returns stored result without re-executing on duplicate.

**Part 2 — Action Lifecycle Persistence**
- `executionActionLifecycleService.ts` — DB persistence for 8 status transitions (proposed → awaiting_approval → approved/rejected → executing → completed/failed/cancelled).
- All DB writes fire-and-forget (`catch(() => {})`) — DB failures NEVER block connector dispatch.
- `executionActionsTable` (Drizzle, `lib/db/src/schema/executionActions.ts`) — 31 columns, 8-state CHECK constraint, 4 indexes, RLS.
- Migration applied: `lib/db/migrations/sprint29f1-execution-actions.sql`.

**Part 3 — Approval Plan**
- `executionApprovalPlanService.ts` — Plan creation, binding hash, expiry, mutation detection.
- Low/medium-risk → `groupedItems` (one plan-level approval); high/critical or `delete_file` → `separateItems` (individual confirmation).
- Binding hash: SHA-256 of `executionId + deviceId + sorted actionIds + targets`.
- Default expiry: 15 minutes.
- `validateApprovalPlan(plan, actions, deviceId)` → `{ valid, reason?, changedFields? }`.

**Part 4 — Evidence-Grounded Self-Review**
- `evidence_citation_grounding` added to `REVIEW_DIMENSIONS` → now 11 dimensions, still 100 total weight.
- `source_coverage` rebalanced from 10→5; `evidence_citation_grounding` = 5.
- `reviewEvidenceCitationGrounding()` — 4 checks: connector provenance, manifest source verification, invented reference detection, uncertainty markers.
- Baseline (no evidencePack): score 6 (passes), feedback says "no evidencepack provided to self-review — citation grounding skipped".
- `ReviewContext` now accepts `evidencePack?: EvidencePack | null`.

**Part 5 — Manifest Integrity**
- `manifestHash` added to `CanonicalExecutionContext` (optional `string`).
- SHA-256 of `{ id: executionId, specialist, blueprint: blueprintId, version }`.
- Computed in `unifiedExecutionEngine.ts` task path; stored in `ctx.manifestHash`.
- `null` for conversation-mode executions (no manifest).

**Part 7 — Legacy Isolation**
- `endToEndWorkflowService.ts`: `assertLegacyPermitted()` guard — throws in production unless `ALLOW_LEGACY_WORKFLOW=1`.
- `executionCheckpointStore.ts`: annotated `@legacy ISOLATED`, `RETAIN TEMPORARILY`.
- `chiefOfStaffOrchestrator.ts`: unused `buildSpecialistContext` import removed (replaced with comment).

## Critical constraints

- **REQUIRED_RLS_TABLES = 53** — `execution_actions` is RLS-protected; update count in `rlsStartupCheck.ts`.
- **`@workspace/db` must be rebuilt** after any schema change (`pnpm --filter @workspace/db run build`).
- Any test that mocks `connectorBridgeService.js` must now include `WRITE_OPERATION_TYPES: new Set([...])` in the mock factory.
- Any test that imports `executionActionDispatcherService` must mock both `writeIdempotencyService.js` and `executionActionLifecycleService.js`.
- `evidence_citation_grounding` dimension — all hardcoded `10`-dimension counts in existing tests must be updated to `11` (sprint22, sprint285-hardening, task39 already fixed).

## Test count
3,943 passing, 14 failing (all pre-existing sprint285), 10 skipped.
New sprint29f1 tests: 7 test files, ~86 tests, 10 acceptance scenarios (all `.skipIf(!REAL_CONNECTOR_URL)`).
