---
name: NeedsOps Sprint 29F Connector Execution Actions
description: Write-side of the Unified Execution Architecture — ExecutionActionDispatcher, 8 connector write operations, approval enforcement, lifecycle states, result contract, inspector extension, audit events
---

## Scope: write-side only (read-only established in 29E)
- Supported: files.write/create/move, word.create/edit/export, excel.update, email.draft
- Explicitly NOT implemented: send_email, browser, terminal, calendar, SharePoint, Google Drive, OneDrive, cloud storage, automatic retries for destructive actions

## Architecture rule (frozen — non-negotiable)
> The Unified Execution Engine never performs external side effects.
> The NeedsOps Connector exclusively owns every filesystem and application interaction.
> Approval must be enforced before dispatch — the connector assumes every received action has already been approved.
> Evidence retrieval and execution actions must remain completely separated.

## Files Created / Modified

### Created
- `artifacts/api-server/src/services/executionActionDispatcherService.ts` — Deliverables A/C/D/E/G
- `artifacts/api-server/src/__tests__/sprint29f-connector-execution.test.ts` — 65 tests

### Modified
- `/home/runner/workspace/lib/shared/src/index.ts` — 6 new AUDIT_EVENTS: execution_action.proposed/approved/dispatched/completed/failed/cancelled
- `artifacts/api-server/src/types/canonicalExecutionContext.ts` — ExecutionAction.status extended to include "executing"|"completed"|"failed"|"cancelled"
- `artifacts/api-server/src/services/connectorBridgeService.ts` — ConnectorOperationType extended with 8 write ops; ConnectorOpRequest.parameters added; dispatchOnce passes parameters; 8 write convenience functions (connectorWrite/Create/Move/WordCreate/WordEdit/WordExport/ExcelUpdate/EmailDraft)
- `artifacts/api-server/src/services/executionInspectorService.ts` — InspectorExecutionAction type; executionActions field on ExecutionInspection; _buildInspection populates from dispatcher store (lazy import, non-fatal)

## Critical Implementation Details

### Approval enforcement (Deliverable C)
- `dispatchExecutionActions` pre-checks ALL actions for `status === "approved"` BEFORE opening any session
- Throws `ApprovalRequiredError` on first violation — no connector communication occurs
- The dispatcher NEVER re-evaluates approval logic (riskLevel, resolvedDestination.approvalRequired) — that belongs to the Governance Centre
- An `approved` high-risk action with `requiresApproval=true` MUST pass — the dispatcher trusts the approval layer

### Operation type mapping (Deliverable B)
Domain + actionType → ConnectorOperationType:
- `files` + `write_file`/`update_file` → `"write"`
- `files` + `create_file` → `"create"`
- `files` + `move_file` → `"move"`
- `word` + `create_file` → `"word_create"`
- `word` + `move_file` → `"word_export"`
- `word` + anything else → `"word_edit"`
- `excel` + any → `"excel_update"`
- `email` + `draft_email` → `"email_draft"`
- `email` + `send_email` → `null` (UNSUPPORTED_OPERATION — non-goal)
- `browser`/`terminal`/`calendar` → `null` (UNSUPPORTED_OPERATION)

### Fatal vs non-fatal connector failures
- **Fatal** (stops remaining, marks cancelled): `DEVICE_NOT_CONNECTED`, `TIMEOUT`, `CANCELLED`
- **Non-fatal** (records failure, continues next action): connector returns `success: false` with errorCode
- Close reason: `"fatal_connector_failure"` if fatal, `"execution_complete"` otherwise
- Cancelled actions get `error.code = "EXECUTION_CANCELLED"`

### In-memory dispatch store
- `dispatchStore: Map<string, DispatchRecord>` keyed by executionId
- `registerProposedActions(executionId, actions)` — called by engine after specialist output
- `getDispatchRecord(executionId)` — for inspector retrieval
- `_resetDispatcherStore()` — test helper only
- Clean up: NOT auto-cleaned (same as ConnectorSessionManager pattern — 60s delay in session manager)

### Inspector integration (Deliverable F)
- `_buildInspection` does lazy `await import("./executionActionDispatcherService.js")` — non-fatal
- `executionActions` is `null` when no dispatch record exists (evidence-only or no actions)
- `executed` = results with status "completed"; `failed` = results with "failed" or "cancelled"
- Status on `InspectorExecutionAction` is derived from result when available, falls back to `action.status`

### Audit event contract (Deliverable G)
- Events fire via `logOrgEvent` with `actorType: "agent"`
- `resourceType: "execution_action"`, `resourceId: action.actionId`
- metadata always includes: `actionType`, `domain`, `target`, `operation`, `specialist`, `connectorDevice`, `riskLevel`
- On result: additionally `status`, `durationMs`, `errorCode`, `errorMessage`
- Fire-and-forget (`.catch(() => {})`) — audit failures are non-fatal and logged as warnings

### ConnectorBridgeService.parameters extension
- `ConnectorOpRequest.parameters?: Record<string, unknown>` added
- `dispatchOnce` spreads `parameters` into relay payload only when present (avoids undefined keys)
- All 8 write convenience functions accept optional `parameters` arg

## Test Count
- Sprint 29F tests: 65 passing
- Total passing: 3,856 (Sprint 29E baseline: 3,791, +65)
- Pre-existing failures: 14 (sprint285-conversation-context-builder — unchanged, not caused by 29F)
- New failures introduced: 0
