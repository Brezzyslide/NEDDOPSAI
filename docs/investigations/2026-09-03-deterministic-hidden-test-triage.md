# Deterministic Hidden Test Triage — 2026-09-03

## Scope

Read-only triage of the 21 failures exposed after `9d90cdc` (`Fix hoisted deterministic test mocks`) in:

- `artifacts/api-server/src/__tests__/sprint-execution-auth.test.ts`
- `artifacts/api-server/src/__tests__/sprint22-work-execution.test.ts`
- `artifacts/api-server/src/__tests__/sprint284-delegation-integrity.test.ts`

No source code or test files were modified.

## Commands Run

Current target run:

```sh
cd artifacts/api-server
./node_modules/.bin/vitest run --config vitest.config.deterministic.ts \
  src/__tests__/sprint-execution-auth.test.ts \
  src/__tests__/sprint22-work-execution.test.ts \
  src/__tests__/sprint284-delegation-integrity.test.ts
```

Observed result:

```text
Test Files  3 failed (3)
Tests  21 failed | 169 passed (190)
```

Historical collection run at `950a3df` (`2026-08-17 10:30:53 +1000`, first commit containing `vitest.config.deterministic.ts`) produced:

```text
Test Files  3 failed (3)
Tests  no tests
```

Historical collection run at `8e671cc` (`2026-09-02 17:39:00 +1000`, parent of `9d90cdc`) also produced:

```text
Test Files  3 failed (3)
Tests  no tests
```

In both historical runs, each target suite failed during collection with the same root cause:

```text
Caused by: Error: DATABASE_URL or DB_HOST/DB_NAME/DB_USERNAME/DB_PASSWORD must be set. Did you forget to provision a database?
```

Because those historical commits collected zero tests for these files, no assertion-level failure below is classified as PRE-EXISTING. The requested evidence standard for PRE-EXISTING is not met.

## Classification Summary

- A. STALE ASSERTION: 9
- B. REAL REGRESSION: 12
- C. PRE-EXISTING: 0
- D. ENVIRONMENTAL: 0

## Tenant Isolation Failure First

### 19. `sprint284-delegation-integrity.test.ts` — tenant isolation: execution status from org B does not leak into org A response

Classification: **A. STALE ASSERTION**

Observed failure:

```text
FAIL  src/__tests__/sprint284-delegation-integrity.test.ts > tenant isolation > execution status from org B does not leak into org A response
AssertionError: expected undefined to be 'dispatched' // Object.is equality

Expected:
"dispatched"

Received:
undefined
```

Observed implementation context:

- `resolveConversationActionState()` now queries `tasks` first with `eq(tasksTable.organizationId, organisationId)`.
- It then queries `task_specialists` with `eq(taskSpecialistsTable.organizationId, organisationId)`.
- It then queries `execution_intents` with `eq(executionIntentsTable.organizationId, organisationId)`.

The test mock still queues three `limit()` responses as if the first call is `task_specialists`, the second is `execution_intents`, and the third is `completed_work`. The first mocked row is therefore consumed by the task-state query, and the intended execution intent row is not consumed as an intent. The observed result is missing org-A execution status, not evidence of org-B status leakage.

## Detailed Classifications

### `sprint-execution-auth.test.ts` — 12 failures

All 12 are classified **B. REAL REGRESSION**.

Reasoning: these tests set up the pipeline so permitted `owner`, `administrator`, and `manager` callers should reach task execution. The observed result is that execution exits as `validation_failed` before the gateway is called, so authorised execution no longer reaches the mocked execution path. This breaks the requester role, gateway context, and completed-work attribution contracts.

1. `owner role: completes execution successfully`

```text
Expected: "completed"
Received: "validation_failed"
```

2. `administrator role: completes execution successfully`

```text
Expected: "completed"
Received: "validation_failed"
```

3. `manager role: completes execution successfully`

```text
Expected: "completed"
Received: "validation_failed"
```

4. `gateway is called with purpose=task_execution (not work_execution)`

```text
AssertionError: expected null not to be null
```

5. `gateway is called with the requester's org role (not system)`

```text
TypeError: Cannot read properties of null (reading 'role')
```

6. `gateway receives the requester's userId`

```text
TypeError: Cannot read properties of null (reading 'userId')
```

7. `gateway receives the correct organizationId`

```text
TypeError: Cannot read properties of null (reading 'organizationId')
```

8. `gateway has requiresHumanApproval=true for work execution`

```text
TypeError: Cannot read properties of null (reading 'requiresHumanApproval')
```

9. `different owners in same org get their own userId in gateway context`

```text
Expected: "user-owner-A"
Received: undefined
```

10. `completed work is attributed to the requester userId, not system`

```text
AssertionError: expected "spy" to be called with arguments: [ ObjectContaining{...} ]
Number of calls: 0
```

11. `task created → OM assigned → execution principal resolved → work_execution passes → Completed Work produced`

```text
Expected: "completed"
Received: "validation_failed"
```

12. `owner who requested and approved: gateway receives their role`

```text
Expected: "completed"
Received: "validation_failed"
```

### `sprint22-work-execution.test.ts` — 4 failures

13. `validateWorkPackage — blueprint validation rules > returns proceed when no validation rules defined`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
Expected: "proceed"
Received: "retrieve_additional_documents"
```

Observed implementation context: `validateWorkPackage()` now evaluates more than `blueprint.validationRules`; it also checks `requiredLibraryKnowledge`, `requiredMemories`, conflicts, and citations. The fixture keeps default required knowledge and memory while only clearing `validationRules`, so the newer recommendation to retrieve documents is consistent with the broader validation contract.

14. `completedWorkService — approve > transitions awaiting_approval → approved`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
Error: Cannot transition from "approved" to "approved" — expected "awaiting_approval"
```

Observed implementation context: `approve()` now calls `getVersions()`, then `getCompletedWork()`, then `transitionStatus()`, and `transitionStatus()` itself reads existing work before updating and again after updating. The test provides too few ordered `select()` responses for the current read sequence, so the approved row is consumed as the pre-transition existing row.

15. `seedBuiltInBlueprints > runs without throwing when DB returns no existing blueprints (all seeds inserted)`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
AssertionError: promise rejected "TypeError: rows.map is not a function" instead of resolving
```

Observed implementation context: built-in seeding now calls `seedRegistryBlueprints()`, `seedRegistryBlueprintSections()`, and `verifySeededRegistryBlueprintSections()`. The verification query expects a Drizzle result array, but the old mock returns a chain object shaped for `.limit()`, producing `rows.map is not a function`.

16. `seedBuiltInBlueprints > skips insert for blueprints that already exist (idempotent)`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
TypeError: rows.map is not a function
```

Observed implementation context: same stale mock shape as item 15. The failure occurs in section verification, not in the idempotency condition itself.

### `sprint284-delegation-integrity.test.ts` — 5 failures

17. `resolveConversationActionState > populates completedWork metadata but does NOT override level to 'completed'`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
Expected: "cw-001"
Received: undefined
```

Observed implementation context: `resolveConversationActionState()` now reads task state before specialists, execution intents, and completed work. The test only queues responses for the older specialists/intent/completed-work order, so the completed-work row is not consumed by the completed-work query.

18. `classifyMessageLLM — action state enforcement > does NOT flag 'has been assigned' when state=specialist_assigned`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
AssertionError: expected true not to be true // Object.is equality
```

Observed implementation context: the test mock intends to produce `specialist_assigned`, but the first mocked specialist row is consumed by the new task-state query. The resolved level falls back to `task_created`, where an assignment claim is correctly flagged.

19. `tenant isolation > execution status from org B does not leak into org A response`

Classification: **A. STALE ASSERTION**

Observed failure and detail are reported first above.

20. `regression — Medication Management Policy conversation arc > after assignment: 'The Operations Manager has been assigned' is valid`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
AssertionError: expected true not to be true // Object.is equality
```

Observed implementation context: same shifted DB mock sequence as item 18. The expected state is `specialist_assigned`, but the mocked rows no longer line up with the current resolver query order.

21. `regression — Medication Management Policy conversation arc > execution started: 'The Operations Manager has started the review' is valid`

Classification: **A. STALE ASSERTION**

Observed failure:

```text
AssertionError: expected true not to be true // Object.is equality
```

Observed implementation context: same shifted DB mock sequence. The expected state is `execution_started`, but the execution-intent row is not consumed by the execution-intent query after the resolver's newer task-state read.

## When These Files Stopped Collecting

The direct cause fixed by `9d90cdc` was present in each target file as:

```ts
const actual = await importOriginal<typeof import("@workspace/db")>();
```

That imported the live `@workspace/db` package inside a hoisted Vitest mock factory, which required DB environment variables during collection.

File-specific introduction commits:

- `sprint22-work-execution.test.ts`: `2904387` (`2026-08-03 10:46:12 +0000`) added the file with the risky mock pattern.
- `sprint284-delegation-integrity.test.ts`: `f9387f5` (`2026-08-06 00:26:39 +0000`) added the file with the risky mock pattern.
- `sprint-execution-auth.test.ts`: `ed8bb5e` (`2026-08-06 02:48:30 +0000`) added the file with the risky mock pattern.

Deterministic-gate timeline:

- `950a3df` (`2026-08-17 10:30:53 +1000`) added `vitest.config.deterministic.ts`.
- At `950a3df`, the three target files already failed during deterministic collection with `Tests no tests`.
- `24b27f0` (`2026-09-02 11:32:02 +1000`) added `scripts/compare-vitest-deterministic-gate.mjs`.
- `9d90cdc` (`2026-09-02 21:24:27 +1000`) changed the mocks to import `@workspace/db/schema`, allowing these files to collect and exposing the 21 assertion failures.

Conclusion: the files were blind to assertion-level execution in the deterministic gate from the moment the deterministic config existed on `2026-08-17` until `9d90cdc` on `2026-09-02`. The underlying risky mock pattern predates the deterministic config in all three files.
