---
name: NeedsOps Sprint 29F.2 Connector Production Readiness
description: Desktop-side idempotency wired, blocking pre-dispatch record, approval binding revalidation, 13 failure-path tests, 10 architecture invariant tests, inspector Part F fields.
---

## Key decisions and constraints

### Part A — Desktop handler wiring
- `connectorOperationHandler.ts` created in `artifacts/desktop-connector/src/`.
  It is wired into `RelayClient` as `onConnectorOpRequest` via dynamic `import()` in `index.ts`.
- Write ops: `write`, `create`, `move` — fully implemented with Node.js `fs`.
- Office ops (`word_create/edit/export`, `excel_update`, `email_draft`): return `OPERATION_NOT_AVAILABLE` (stubs).
- Unsupported forever (`send_email`, `browser_interaction`, `terminal_command`): return `UNSUPPORTED_OPERATION`.
- Desktop idempotency store (`idempotencyStore.ts`) is now wired. Key = `organisationId::deviceId::idempotencyKey`.

### Part B — Blocking pre-dispatch lifecycle record
- `recordActionPreDispatch()` added to `executionActionLifecycleService.ts`.
- It performs an INSERT ... ON CONFLICT DO UPDATE — works even if `recordActionProposed` never ran.
- **Must NOT be wrapped in try/catch at call site** — the error must propagate to block connector dispatch.
- Post-dispatch (completed/failed) stays fire-and-forget.
- If physical success + lifecycle persistence fails → `recordReconciliationRequired()` is called (best-effort).

### Part C — Approval binding revalidation
- `ApprovalBindingInvalidError` added to dispatcher's public API.
- Validation happens ONCE before the loop (not per-action), blocking ALL dispatch if invalid.
- `approvalPlan` is optional in `DispatchContext` — when absent, validation is skipped.

### DB schema additions (migration applied)
- `operation_type text` — resolved connector op type
- `approval_plan_binding_hash text` — approval proof
- `reconciliation_required boolean NOT NULL DEFAULT false`
- Migration: `lib/db/migrations/sprint29f2-execution-actions-additions.sql`

### Inspector Part F fields
- `bindingValidationResult`, `dispatchedAt`, `connectorAcknowledgement`, `idempotencyResult`, `deduplicationPrevented`, `reconciliationRequired` added to `InspectorExecutionAction` type.
- Builder in `executionInspectorService.ts` derives these from `ConnectorExecutionResult`.

### Test files
- `sprint29f2-failure-paths.test.ts` — 14 scenarios (all passing)
- `sprint29f2-architecture-verification.test.ts` — 10 invariants (all passing)
- `desktopIdempotencyStoreProxy.ts` in `services/__mocks__/` — cross-artifact idempotency proxy for API server tests (mirrors the desktop store interface).

### Critical mock update rule
Any test file importing `executionActionDispatcherService` MUST now also mock:
- `recordActionPreDispatch` → `vi.fn().mockResolvedValue(undefined)` (blocking in prod, stub in test)
- `recordReconciliationRequired` → `vi.fn().mockResolvedValue(undefined)`

The existing `sprint29f-connector-execution.test.ts` was updated to include these.

### Final test counts
- 3,998 passing (was 3,943 before sprint29f2, +55 new tests)
- 14 failing (unchanged — all pre-existing sprint285 failures)
- 10 skipped

## What remains for production readiness (Go/No-Go)
- Real macOS/Windows/Linux acceptance: 10 tests in `sprint29f1-real-connector-acceptance.test.ts` remain `.skipIf(!REAL_CONNECTOR_URL)` — requires physical devices.
- Office stubs (`word_create/edit/export`, `excel_update`, `email_draft`) require OS Office installation.
