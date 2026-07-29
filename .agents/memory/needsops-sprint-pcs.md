---
name: NeedsOps Platform Completion Sprint (PCS)
description: 10 new DB tables, 7 new services, stateful DB mock pattern for drizzle-orm services, 1254 total tests
---

## Key decisions and constraints

### DB schema additions (10 tables)
Six organisation structure tables (`org_departments`, `org_teams`, `org_positions`, `org_reporting_lines`, `org_delegated_authority`, `org_escalation_paths`), one config table (`org_configuration`), one persistent resource registry (`org_resources`), and two execution tracking tables (`execution_graph_nodes`, `execution_history`). All added to `lib/db/src/schema/` and re-exported from `lib/db/src/schema/index.ts`. **REQUIRED_RLS_TABLES is still 35** — none of these tables require RLS.

### Services added
- `organisationStructureService.ts` — 14 functions for org hierarchy
- `organisationConfigurationService.ts` — upsert/get config + NDIS defaults + prompt-injection string builder
- `organisationResourceRegistryService.ts` — replaced in-memory Map with DB persistence via `orgResourcesTable`; `registerResource`, `getResource`, `getResourcesForEmployee`, `listResources` are now `async`
- `resourceManagerService.ts` — updated awaits for async registry
- `specialistOutputContractService.ts` — 12-field output contract, validate, contractToCoSPromptBlock
- `organisationRuntimeService.ts` — execution graph, graph node tracking, event publishing, retry/recovery metadata, `MockIntentDispatcher`
- `runtimeContextService.ts` — assembles full `OrganisationRuntimeContext` from DB (org + memory + resources + workforce); `organisationStructureService` and `organisationConfigurationService` wiring is STUBBED (commented-out dynamic imports)
- `connectorMockService.ts` — `MockFileConnector`, `MockBrowserConnector`, `MockApiConnector`, `MOCK_CONNECTOR_REGISTRY`; connector interfaces defined inline (not from `@workspace/organisation-resource`) due to tsconfig path alias issue at build time
- `endToEndWorkflowService.ts` — 10-stage mocked pipeline, `runMockedWorkflow()`, per-stage timing

### Critical: drizzle-orm mock pattern for DB-backed service tests
Any test file that tests a service which imports `eq`/`and` from `drizzle-orm` directly **must** mock `drizzle-orm` in addition to `@workspace/db`. Otherwise the real Drizzle query objects are produced and the DB mock's `where` handler cannot parse them.

```typescript
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ __eq__: true, col, val }),
  and: (...conditions: unknown[]) => ({ __and__: true, conditions }),
  isNull: (col: unknown) => ({ __isNull__: true, col }),
  sql: (strings: TemplateStringsArray) => ({ __sql__: true, strings }),
}));
```

**Why:** `organisationResourceRegistryService.ts` and `organisationStructureService.ts` both `import { eq, and } from "drizzle-orm"`. The `@workspace/db` mock only intercepts the DB object itself — the `eq`/`and` helpers come from a separate package import.

### Stateful orgResourcesTable mock pattern (sprint-xx-organisation-resource.test.ts)
The `@workspace/db` mock uses an in-memory `Map<orgId, Map<resourceId, row>>` to simulate `orgResourcesTable` persistence. Column references are encoded as `'__ORG_RES__<fieldName>'` strings; `extractConditions()` strips the prefix to recover field names from the `where` clause. Insert stores the raw `values()` object; select filters the store; update merges `set()` data over the existing row.

**Why:** `organisationResourceRegistryService` was changed from in-memory Map to DB persistence in PCS; without a stateful mock the old tests (Groups 5 & 6) would get stale data — or all data — on every read.

### runtimeContextService.ts — organisationStructureService/organisationConfigurationService not yet wired
The service has commented-out dynamic imports for both. `assembleRuntimeContext` returns stub/empty values for structure and configuration sections. This is intentional — wiring is deferred to the next sprint once org structure and config services are validated in production.

**How to apply:** When wiring these in a future sprint, uncomment the dynamic imports in `assembleRuntimeContext` (around line 198–230 of `runtimeContextService.ts`).

### runtimeContextService.ts — now fully wired (PCS Close-Out)
`assembleRuntimeContext` now calls the real `getConfiguration`, `getOrgStructureSummary`, and `getEscalationPaths`. The stub `OrgConfigurationData` interface was removed; the canonical one is imported from `organisationConfigurationService.ts` and re-exported. `structure` type now includes `reportingLineCount` and `activeDelegationCount`.

### ResourceDescriptor — single canonical definition
Removed local `ResourceDescriptor` from `organisationResourceRegistryService.ts`. Both that service and `resourceManagerService.ts` now import it from `@workspace/organisation-resource`. `buildDescriptor` casts string DB values to typed enum fields via `as ResourceDescriptor["resourceType"]` etc. `"access"` permission removed (not a valid `ResourcePermission`).

### getOrgStructureSummary — extended in PCS Close-Out
Now returns `reportingLineCount` and `activeDelegationCount` in addition to dept/team/position/escalation counts. The Promise.all fetches 6 tables simultaneously (orgDepartments, orgTeams, orgPositions, orgEscalationPaths, orgReportingLines, orgDelegatedAuthority). All scoped by `organizationId`.

### drizzle-orm mock: use importOriginal for services with real synchronous functions
When mocking a service module that has both sync (non-DB) and async (DB) functions, use `importOriginal` and spread `...actual` — then override only the async DB functions. Otherwise sync functions like `buildDescriptor` and `hasPermission` become mocks that return wrong values.

**Why:** Tests 41, 43, 49 in the close-out suite failed because `buildDescriptor` was mocked to always return "policies" descriptor — breaking classification and permission tests that pass different entries.

### Test counts
- Before PCS: 1164 tests
- After PCS close-out: 1339 tests (+85 new in `sprint-pcs-closeout.test.ts`)
