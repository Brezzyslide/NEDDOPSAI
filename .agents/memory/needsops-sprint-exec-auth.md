---
name: NeedsOps Execution Authorisation Fix
description: AI gateway role/purpose bug fix, principal guard pattern, test mock lessons from the execution auth sprint.
---

# Execution Authorisation Fix

## The bug
`workExecutionPipelineService.ts` hardcoded `role: "system"` (not in `ROLE_PURPOSE_ALLOWLIST`) and `purpose: "work_execution"` (not a valid `AIPurpose`). Every specialist execution hit the AI gateway auth layer and was rejected with "Role 'system' is not authorised for purpose 'work_execution'".

## The fix pattern
- `EXECUTION_PERMITTED_ROLES = new Set(["owner", "administrator", "manager"])` guard at the top of `executeWork`; missing/invalid role returns `execution_principal_missing` outcome with correlationId in the customer message
- `generateDraft` receives `authCtx: { userId, organizationId, role }` where `role` is the requester's verified org membership role (never `"system"`)
- `purpose: "task_execution"` (not `"work_execution"`) is the correct `AIPurpose` for specialist work
- `retentionClass: "operational"` (not `"standard"`)
- `executionCoordinatorService` resolves role via `getMembershipForUser` before calling `executeWork`; if null → audit `execution_coordinator.principal_missing` + customer message, no silent pass-through

**Why:** `"system"` has no entry in `ROLE_PURPOSE_ALLOWLIST` so `allowedPurposes = []` → gateway rejects. The requester's verified org membership role must flow all the way through to the gateway context.

## Orphan recovery gap (Task #106)
`recoverOrphanedExecutions` passes `requesterId: intent.approvedBy ?? "system"`. When `approvedBy` is null, `getMembershipForUser("system", org)` returns null → `execution_principal_missing` → orphan silently fails. Needs a service-account bypass or fallback owner resolution.

## Audit registry
`"execution_coordinator.principal_missing"` added to `AUDIT_EVENTS` in `lib/shared/src/index.ts`. After any change to this array, run `cd lib/shared && npx tsc --project tsconfig.json` to rebuild dist.

## Test mock gotcha — vi.resetAllMocks() strips vi.fn() initial implementations
`vi.resetAllMocks()` calls `mockReset()` on every spy, including those created with `vi.fn((ctx) => { ... })`. After reset, the function returns `undefined`. Any `beforeEach` that calls `vi.resetAllMocks()` and needs the full pipeline to complete must re-wire `createAIGateway.mockImplementation(...)` explicitly — not just `gatewayProcess.mockResolvedValue(...)`.

Pattern: use a `setupPipelineMocks()` helper that re-wires `createAIGateway` and re-sets `gatewayProcess` together.

## Blueprint mock must be complete
`buildWorkExecutionAddendum(blueprint)` calls `blueprint.successCriteria.map(...)` and `blueprint.mandatoryCitations.join(...)`. A blueprint mock missing these fields throws inside the pipeline's try/catch → `execution_failed`. Always include the full `WorkBlueprint` shape in pipeline test fixtures.

## Updating existing tests after adding requesterRole guard
Any test that calls `executeWork` directly (without the coordinator) must pass `requesterRole: "administrator"` (or "owner"/"manager"). Any coordinator test must mock `../services/membershipService.js` to return `{ role: "administrator" }`.

Files updated: `sprint271-foundations.test.ts`, `sprint275-pipeline-ordering.test.ts`, `sprint27-execution-loop.test.ts`, `sprint271-execution-experience.test.ts`.

## Test count
3,489 passing (3,462 previous + 27 new in `sprint-execution-auth.test.ts`).
