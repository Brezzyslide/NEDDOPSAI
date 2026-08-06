---
name: NeedsOps Sprint 29E Connector P6 Foundation
description: P6 evidence provider for NeedsOps Connector — relay protocol extension, bridge, session manager, ResourceRegistry three-stage model, ConnectorEvidenceResolver, Inspector diagnostics
---

## Architecture Rule (frozen — non-negotiable)

> The Unified Execution Engine never selects providers.
> The ResourceRegistry never interprets user intent.
> The Chief of Staff determines provider preference through Capability Planning and Resource Planning (EvidenceRequest.preferredProviders[]).
> The ResourceRegistry simply executes the approved provider plan, while each provider encapsulates its own connection lifecycle (isAvailable → resolve → close).

## Sprint 29E scope: read-only only
- locate / search / inspect / read
- No writes, no automation, no Outlook/Excel/browser/terminal (those are Sprint 29F)
- OpenClaw is an internal runtime only — never surface "openclaw" in user-facing output or diagnostics

## Files Created / Modified

### Modified
- `artifacts/api-server/src/lib/relayProtocol.ts` — 3 new types: `connector_op_request`, `connector_op_result`, `connector_op_error` (distinct from task_*)
- `artifacts/desktop-connector/src/broker/relayProtocol.ts` — same 3 types added to union and VALID_TYPES
- `artifacts/api-server/src/lib/resources/types.ts` — `EvidenceRequest.preferredProviders?: string[]`, `ConnectorCapabilityError` class, `IResourceProvider.close(): Promise<void>`
- `artifacts/api-server/src/services/deviceRelayService.ts` — `opEvents` EventEmitter (distinct from taskEvents), `connector_op_result/error` handlers in `handleMessage()`, `sendConnectorOpRequest()`, `getConnectedDevicesForOrg()`
- `artifacts/api-server/src/services/executionInspectorService.ts` — `InspectorConnectorDiagnostics` interface, `connector` field on `InspectorDiagnostics`, telemetry populated from ConnectorSessionManager
- `artifacts/desktop-connector/src/broker/relayClient.ts` — `onConnectorOpRequest` config callback, `connector_op_request` handler in `handleMessage()`, `sendConnectorOpResult()`, `sendConnectorOpError()`

### Created
- `artifacts/api-server/src/services/connectorBridgeService.ts` — Deliverable D; `submitConnectorOperation()` with timeout/retry/cancel/correlation IDs; `ConnectorOperationError` class; convenience functions
- `artifacts/api-server/src/services/connectorSessionManagerService.ts` — Deliverable E; 30s idle timeout; `ConnectorSessionTelemetry`; DB reads `devicesTable.status/displayName/platform/appVersion`
- `artifacts/api-server/src/services/connectorEvidenceResolverService.ts` — Deliverable H; `ConnectorEvidenceResolver` implements `IResourceProvider`; P6 priority; `close()` is always a no-op
- `artifacts/api-server/src/lib/resources/ResourceRegistry.ts` — Deliverable A/B/G; three-stage resolution (KRS → external providers → merge); private `evidenceChunksFromHandles()` adapter (Deliverable B); `preferredProviders[]` routing
- `artifacts/api-server/src/__tests__/sprint29e-connector-foundation.test.ts` — 58 tests covering all 9 deliverables and 4 acceptance scenarios

## Critical Implementation Details

### opEvents vs taskEvents
- `taskEvents` — for work execution task lifecycle (task_dispatch/result/error)
- `opEvents` — for connector evidence operations (connector_op_request/result/error)
- These MUST remain separate — mixing them would conflate evidence retrieval with work execution

### Event correlation
- Each operation generates a unique `requestId` (UUID)
- Bridge listens: `opEvents.once('op:result:{requestId}', ...)` and `opEvents.once('op:error:{requestId}', ...)`
- `opEvents` emits these from `handleMessage()` in deviceRelayService when connector_op_result/error arrives

### Device schema columns used
- `devicesTable.status` — check `=== "revoked"` NOT `isRevoked` (no such column)
- `devicesTable.displayName` — NOT `.name`
- `devicesTable.platform` — NOT `.osPlatform`
- `devicesTable.appVersion` — NeedsOps desktop app version

### ResourceRegistry factory
- Uses ESM static import for `connectorEvidenceResolverService.js`
- Do NOT use `require()` — this is an ESM module
- `createResourceRegistry()` registers P6 (ConnectorEvidenceResolver) by default

### Adapter contract (Deliverable B)
- `evidenceChunksFromHandles()` is PRIVATE to ResourceRegistry — only the registry may construct EvidenceChunk from external handles
- Mapping: `policy_document→policy`, `procedure_document→procedure`, `legislation→legislation`, `standard→standards`, `template→template`, email/spreadsheet/file/unknown→`reference`
- All external file chunks: `authorityLevel="supporting"`, `selectionReason="desktop_file"`, citation prefix `"Desktop File: "`

### ConnectorCapabilityError propagation
- When `preferredProviders` includes "connector" and connector unavailable → throw `ConnectorCapabilityError` immediately (no AI execution starts)
- When `preferredProviders` is empty/absent and connector unavailable → silently skip (supplementary only)
- Error code: `"REQUIRED_PROVIDER_UNAVAILABLE"` from registry; `"CONNECTOR_NOT_CONNECTED"` or `"CONNECTOR_REVOKED"` from session manager

### Test file pattern (important for future sprints)
- All variables referenced in `vi.mock()` factories MUST be defined via `vi.hoisted()`
- Use `vi.clearAllMocks()` in `afterEach` — NOT `vi.resetAllMocks()` which strips implementations
- Re-set mock return values in `afterEach` after `vi.clearAllMocks()`
- `vi.mock()` at top level only — never inside `beforeEach`

## Test Count
- Sprint 29E tests: 58 new passing
- Total passing: 3,791 (baseline was 3,687)
- Pre-existing failures: 14 (sprint285-conversation-context-builder — NOT caused by Sprint 29E, confirmed via git stash)
- New failures introduced by Sprint 29E: 0
