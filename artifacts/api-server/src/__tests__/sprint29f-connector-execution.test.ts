/**
 * Sprint 29F — Connector Execution Actions (Execution Ownership)
 *
 * Tests all 7 deliverables and 5 acceptance scenarios:
 *   A — ExecutionActionDispatcher (sequential, stop-on-fatal)
 *   B — Connector write operations (all 8 operation types)
 *   C — Approval enforcement (pre-dispatch status check)
 *   D — ExecutionAction lifecycle states
 *   E — ConnectorExecutionResult contract
 *   F — Execution Inspector action diagnostics
 *   G — Audit events per action
 *
 * Architecture rules verified:
 *   - UEE never performs side effects
 *   - Connector owns every external operation
 *   - Approval enforced before dispatch
 *   - Evidence retrieval separate from execution
 *   - "openclaw" never in any result
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock infrastructure (vi.hoisted — must precede vi.mock calls) ────────────

const mockSubmitConnectorOperation = vi.hoisted(() => vi.fn());
const mockOpenConnectorSession     = vi.hoisted(() => vi.fn());
const mockCloseConnectorSession    = vi.hoisted(() => vi.fn());
const mockRecordConnectorOperation = vi.hoisted(() => vi.fn());
const mockGetConnectorSessionTelemetry = vi.hoisted(() => vi.fn());
const mockIsConnectorSessionOpen   = vi.hoisted(() => vi.fn());
const mockLogOrgEvent              = vi.hoisted(() => vi.fn());

vi.mock("../services/connectorBridgeService.js", () => ({
  submitConnectorOperation:  mockSubmitConnectorOperation,
  // Sprint 29F.1 — WRITE_OPERATION_TYPES must be exported from the mock
  WRITE_OPERATION_TYPES: new Set([
    "write", "create", "move",
    "word_create", "word_edit", "word_export",
    "excel_update", "email_draft",
  ]),
  ConnectorOperationError: class ConnectorOperationError extends Error {
    code: string;
    requestId?: string;
    constructor(code: string, message: string, requestId?: string) {
      super(message);
      this.name = "ConnectorOperationError";
      this.code = code;
      this.requestId = requestId;
    }
  },
  connectorWrite:       mockSubmitConnectorOperation,
  connectorCreate:      mockSubmitConnectorOperation,
  connectorMove:        mockSubmitConnectorOperation,
  connectorWordCreate:  mockSubmitConnectorOperation,
  connectorWordEdit:    mockSubmitConnectorOperation,
  connectorWordExport:  mockSubmitConnectorOperation,
  connectorExcelUpdate: mockSubmitConnectorOperation,
  connectorEmailDraft:  mockSubmitConnectorOperation,
}));

// Sprint 29F.1 — writeIdempotencyService (fire-and-forget, all stubs)
vi.mock("../services/writeIdempotencyService.js", () => ({
  checkIdempotency:          vi.fn().mockReturnValue({ found: false }),
  beginIdempotencyRecord:    vi.fn(),
  finaliseIdempotencyRecord: vi.fn(),
  _resetIdempotencyStore:    vi.fn(),
}));

// Sprint 29F.1 — executionActionLifecycleService (fire-and-forget, all stubs)
vi.mock("../services/executionActionLifecycleService.js", () => ({
  recordActionProposed:         vi.fn().mockResolvedValue(undefined),
  recordActionAwaitingApproval: vi.fn().mockResolvedValue(undefined),
  recordActionApproved:         vi.fn().mockResolvedValue(undefined),
  recordActionRejected:         vi.fn().mockResolvedValue(undefined),
  recordActionExecuting:        vi.fn().mockResolvedValue(undefined),
  recordActionCompleted:        vi.fn().mockResolvedValue(undefined),
  recordActionFailed:           vi.fn().mockResolvedValue(undefined),
  recordActionCancelled:        vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/connectorSessionManagerService.js", () => ({
  openConnectorSession:         mockOpenConnectorSession,
  closeConnectorSession:        mockCloseConnectorSession,
  recordConnectorOperation:     mockRecordConnectorOperation,
  getConnectorSessionTelemetry: mockGetConnectorSessionTelemetry,
  isConnectorSessionOpen:       mockIsConnectorSessionOpen,
}));

vi.mock("../services/auditService.js", () => ({
  logOrgEvent: mockLogOrgEvent,
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  dispatchExecutionActions,
  registerProposedActions,
  getDispatchRecord,
  _resetDispatcherStore,
  ApprovalRequiredError,
  type DispatchContext,
  type ConnectorExecutionResult,
} from "../services/executionActionDispatcherService.js";
import type { ExecutionAction } from "../types/canonicalExecutionContext.js";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeAction(overrides: Partial<ExecutionAction> = {}): ExecutionAction {
  return {
    actionId:            `act_${Math.random().toString(36).slice(2)}`,
    actionType:          "write_file",
    domain:              "files",
    description:         "Write policy document",
    resolvedDestination: {
      domain:          "desktop_documents",
      displayPath:     "~/Documents/policy.docx",
      connectorRequired: true,
      channelRequired:  null,
      approvalRequired:  false,
      approvalReason:    null,
    },
    requiresApproval:    false,
    approvalReason:      null,
    riskLevel:           "low",
    proposedAt:          new Date().toISOString(),
    status:              "approved",
    parameters:          { path: "~/Documents/policy.docx", content: "Updated policy text" },
    ...overrides,
  };
}

const BASE_CONTEXT: DispatchContext = {
  executionId:    "exec_test_001",
  organisationId: "org_test",
  requesterId:    "user_test",
  requesterRole:  "org_admin",
  specialistCode: "chief_of_staff",
};

const MOCK_SESSION = { deviceId: "dev_001", sessionId: "sess_001" };
const MOCK_TELEMETRY = {
  sessionId:          "sess_001",
  executionId:        "exec_test_001",
  deviceId:           "dev_001",
  organisationId:     "org_test",
  connectorVersion:   "1.2.0",
  deviceName:         "MacBook Pro",
  osPlatform:         "darwin",
  openedAt:           new Date().toISOString(),
  closedAt:           null,
  durationMs:         null,
  idleMs:             null,
  closeReason:        null,
  operationsExecuted: 0,
  evidenceRetrieved:  0,
  avgLatencyMs:       null,
  providerUsed:       "connector" as const,
  opLog:              [],
};

const SUCCESS_OP_RESULT = { requestId: "req_1", success: true, latencyMs: 80, data: { written: true } };
const FAIL_OP_RESULT    = { requestId: "req_1", success: false, latencyMs: 50, errorCode: "WRITE_DENIED", errorMessage: "Permission denied" };

// ─── beforeEach / afterEach ───────────────────────────────────────────────────

beforeEach(() => {
  _resetDispatcherStore();
  mockOpenConnectorSession.mockResolvedValue(MOCK_SESSION);
  mockCloseConnectorSession.mockReturnValue(null);
  mockRecordConnectorOperation.mockReturnValue(undefined);
  mockGetConnectorSessionTelemetry.mockReturnValue(MOCK_TELEMETRY);
  mockIsConnectorSessionOpen.mockReturnValue(true);
  mockLogOrgEvent.mockResolvedValue(undefined);
  mockSubmitConnectorOperation.mockResolvedValue(SUCCESS_OP_RESULT);
});

afterEach(() => {
  vi.clearAllMocks();
  mockOpenConnectorSession.mockResolvedValue(MOCK_SESSION);
  mockCloseConnectorSession.mockReturnValue(null);
  mockRecordConnectorOperation.mockReturnValue(undefined);
  mockGetConnectorSessionTelemetry.mockReturnValue(MOCK_TELEMETRY);
  mockIsConnectorSessionOpen.mockReturnValue(true);
  mockLogOrgEvent.mockResolvedValue(undefined);
  mockSubmitConnectorOperation.mockResolvedValue(SUCCESS_OP_RESULT);
});

// ─── Deliverable C: Approval enforcement ─────────────────────────────────────

describe("Deliverable C — approval enforcement", () => {
  it("passes when all actions have status=approved", async () => {
    const actions = [makeAction({ status: "approved" })];
    await expect(dispatchExecutionActions(actions, BASE_CONTEXT)).resolves.toBeDefined();
  });

  it("throws ApprovalRequiredError when any action has status=proposed", async () => {
    const actions = [makeAction({ status: "proposed" })];
    await expect(dispatchExecutionActions(actions, BASE_CONTEXT))
      .rejects.toThrow(ApprovalRequiredError);
  });

  it("throws ApprovalRequiredError for status=rejected", async () => {
    const actions = [makeAction({ status: "rejected" })] as unknown as ExecutionAction[];
    await expect(dispatchExecutionActions(actions as ExecutionAction[], BASE_CONTEXT))
      .rejects.toThrow(ApprovalRequiredError);
  });

  it("throws before opening a session when approval check fails", async () => {
    const actions = [makeAction({ status: "proposed" })];
    await expect(dispatchExecutionActions(actions, BASE_CONTEXT)).rejects.toThrow(ApprovalRequiredError);
    expect(mockOpenConnectorSession).not.toHaveBeenCalled();
  });

  it("throws with the offending actionId and actionType in the error", async () => {
    const action = makeAction({ status: "proposed", actionType: "write_file" });
    try {
      await dispatchExecutionActions([action], BASE_CONTEXT);
    } catch (err) {
      expect(err).toBeInstanceOf(ApprovalRequiredError);
      const approvalErr = err as ApprovalRequiredError;
      expect(approvalErr.actionId).toBe(action.actionId);
      expect(approvalErr.actionType).toBe("write_file");
      expect(approvalErr.currentStatus).toBe("proposed");
    }
  });

  it("throws on first unapproved action even if later actions are approved", async () => {
    const actions = [
      makeAction({ status: "proposed" }),
      makeAction({ status: "approved" }),
    ];
    await expect(dispatchExecutionActions(actions, BASE_CONTEXT))
      .rejects.toThrow(ApprovalRequiredError);
    expect(mockSubmitConnectorOperation).not.toHaveBeenCalled();
  });
});

// ─── Deliverable A: Sequential dispatch ──────────────────────────────────────

describe("Deliverable A — sequential dispatch", () => {
  it("dispatches all approved actions sequentially", async () => {
    const actions = [
      makeAction(),
      makeAction({ actionType: "create_file" }),
      makeAction({ actionType: "move_file" }),
    ];
    const result = await dispatchExecutionActions(actions, BASE_CONTEXT);
    expect(result.results).toHaveLength(3);
    expect(result.summary.total).toBe(3);
    expect(result.summary.completed).toBe(3);
    expect(mockSubmitConnectorOperation).toHaveBeenCalledTimes(3);
  });

  it("returns empty result for empty action list without opening session", async () => {
    const result = await dispatchExecutionActions([], BASE_CONTEXT);
    expect(result.results).toHaveLength(0);
    expect(result.summary.total).toBe(0);
    expect(mockOpenConnectorSession).not.toHaveBeenCalled();
  });

  it("opens connector session before first dispatch", async () => {
    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(mockOpenConnectorSession).toHaveBeenCalledWith(
      BASE_CONTEXT.executionId,
      BASE_CONTEXT.organisationId,
    );
    expect(mockOpenConnectorSession).toHaveBeenCalledTimes(1);
  });

  it("closes connector session after dispatch completes", async () => {
    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(mockCloseConnectorSession).toHaveBeenCalledWith(
      BASE_CONTEXT.executionId,
      "execution_complete",
    );
  });

  it("preserves action execution order in result", async () => {
    const a1 = makeAction({ actionId: "act_1" });
    const a2 = makeAction({ actionId: "act_2" });
    const a3 = makeAction({ actionId: "act_3" });
    const result = await dispatchExecutionActions([a1, a2, a3], BASE_CONTEXT);
    expect(result.results[0].actionId).toBe("act_1");
    expect(result.results[1].actionId).toBe("act_2");
    expect(result.results[2].actionId).toBe("act_3");
  });

  it("stops dispatch and cancels remaining on fatal DEVICE_NOT_CONNECTED failure", async () => {
    const { ConnectorOperationError } = await import("../services/connectorBridgeService.js");
    mockSubmitConnectorOperation
      .mockResolvedValueOnce(SUCCESS_OP_RESULT) // action 1 succeeds
      .mockRejectedValueOnce(new ConnectorOperationError("DEVICE_NOT_CONNECTED", "Device lost")); // action 2 fatal

    const actions = [makeAction(), makeAction(), makeAction()];
    const result = await dispatchExecutionActions(actions, BASE_CONTEXT);

    expect(result.summary.completed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.cancelled).toBe(1);
    expect(result.summary.stoppedOnFatalFailure).toBe(true);
    expect(result.summary.fatalFailureActionId).toBe(actions[1].actionId);
  });

  it("closes session with fatal_connector_failure on device disconnect", async () => {
    const { ConnectorOperationError } = await import("../services/connectorBridgeService.js");
    mockSubmitConnectorOperation
      .mockRejectedValueOnce(new ConnectorOperationError("DEVICE_NOT_CONNECTED", "Device lost"));

    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(mockCloseConnectorSession).toHaveBeenCalledWith(
      BASE_CONTEXT.executionId,
      "fatal_connector_failure",
    );
  });

  it("does NOT stop on non-fatal individual action failures", async () => {
    mockSubmitConnectorOperation
      .mockResolvedValueOnce(SUCCESS_OP_RESULT)
      .mockResolvedValueOnce(FAIL_OP_RESULT) // non-fatal failure
      .mockResolvedValueOnce(SUCCESS_OP_RESULT);

    const actions = [makeAction(), makeAction(), makeAction()];
    const result = await dispatchExecutionActions(actions, BASE_CONTEXT);

    expect(result.summary.completed).toBe(2);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.cancelled).toBe(0);
    expect(result.summary.stoppedOnFatalFailure).toBe(false);
  });
});

// ─── Deliverable B: Write operation mapping ───────────────────────────────────

describe("Deliverable B — write operation type mapping", () => {
  it("maps files domain write_file to 'write' operation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "files", actionType: "write_file" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("write");
  });

  it("maps files domain create_file to 'create' operation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "files", actionType: "create_file" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("create");
  });

  it("maps files domain move_file to 'move' operation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "files", actionType: "move_file" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("move");
  });

  it("maps word domain create_file to 'word_create' operation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "word", actionType: "create_file" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("word_create");
  });

  it("maps word domain write_file to 'word_edit' operation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "word", actionType: "write_file" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("word_edit");
  });

  it("maps word domain move_file to 'word_export' operation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "word", actionType: "move_file" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("word_export");
  });

  it("maps excel domain to 'excel_update' regardless of actionType", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "excel", actionType: "update_spreadsheet" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("excel_update");
  });

  it("maps email domain draft_email to 'email_draft' operation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "email", actionType: "draft_email" })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.operationType).toBe("email_draft");
  });

  it("produces UNSUPPORTED_OPERATION failure for terminal_command", async () => {
    const result = await dispatchExecutionActions(
      [makeAction({ domain: "terminal", actionType: "terminal_command" })],
      BASE_CONTEXT,
    );
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].error?.code).toBe("UNSUPPORTED_OPERATION");
    expect(mockSubmitConnectorOperation).not.toHaveBeenCalled();
  });

  it("produces UNSUPPORTED_OPERATION failure for browser_interaction", async () => {
    const result = await dispatchExecutionActions(
      [makeAction({ domain: "browser", actionType: "browser_interaction" })],
      BASE_CONTEXT,
    );
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].error?.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("produces UNSUPPORTED_OPERATION failure for email send_email", async () => {
    const result = await dispatchExecutionActions(
      [makeAction({ domain: "email", actionType: "send_email" })],
      BASE_CONTEXT,
    );
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].error?.code).toBe("UNSUPPORTED_OPERATION");
  });

  it("passes action parameters through to the connector operation", async () => {
    const params = { content: "New policy text", encoding: "utf-8" };
    await dispatchExecutionActions(
      [makeAction({ parameters: { ...params, path: "~/Documents/policy.docx" } })],
      BASE_CONTEXT,
    );
    const callArg = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(callArg.parameters).toMatchObject(params);
  });

  it("does not implement email sending — send_email is a non-goal", async () => {
    const result = await dispatchExecutionActions(
      [makeAction({ domain: "email", actionType: "send_email" })],
      BASE_CONTEXT,
    );
    // Must fail with UNSUPPORTED_OPERATION, not succeed
    expect(result.results[0].status).toBe("failed");
    expect(result.results[0].error?.code).toBe("UNSUPPORTED_OPERATION");
  });
});

// ─── Deliverable D: Lifecycle states ─────────────────────────────────────────

describe("Deliverable D — lifecycle states", () => {
  it("successful action result has status=completed", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].status).toBe("completed");
  });

  it("failed action result has status=failed", async () => {
    mockSubmitConnectorOperation.mockResolvedValueOnce(FAIL_OP_RESULT);
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].status).toBe("failed");
  });

  it("remaining actions after fatal failure have status=cancelled", async () => {
    const { ConnectorOperationError } = await import("../services/connectorBridgeService.js");
    mockSubmitConnectorOperation
      .mockRejectedValueOnce(new ConnectorOperationError("DEVICE_NOT_CONNECTED", "Lost"));

    const result = await dispatchExecutionActions([makeAction(), makeAction()], BASE_CONTEXT);
    expect(result.results[0].status).toBe("failed");
    expect(result.results[1].status).toBe("cancelled");
  });

  it("all timestamps are present on every result", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    const r = result.results[0];
    expect(r.startedAt).toBeTruthy();
    expect(r.completedAt).toBeTruthy();
    expect(typeof r.duration).toBe("number");
    expect(r.duration).toBeGreaterThanOrEqual(0);
  });
});

// ─── Deliverable E: Result contract ──────────────────────────────────────────

describe("Deliverable E — ConnectorExecutionResult contract", () => {
  it("result contains actionId matching the input action", async () => {
    const action = makeAction({ actionId: "act_known" });
    const result = await dispatchExecutionActions([action], BASE_CONTEXT);
    expect(result.results[0].actionId).toBe("act_known");
  });

  it("result contains executionId from context", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].executionId).toBe(BASE_CONTEXT.executionId);
  });

  it("result contains sessionId from session manager", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].sessionId).toBe(MOCK_SESSION.sessionId);
  });

  it("result contains the connector operation type", async () => {
    const result = await dispatchExecutionActions(
      [makeAction({ domain: "files", actionType: "write_file" })],
      BASE_CONTEXT,
    );
    expect(result.results[0].operation).toBe("write");
  });

  it("result contains target from resolvedDestination.displayPath", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].target).toBe("~/Documents/policy.docx");
  });

  it("result contains connectorVersion from telemetry", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].connectorVersion).toBe("1.2.0");
  });

  it("failed result contains error.code and error.message", async () => {
    mockSubmitConnectorOperation.mockResolvedValueOnce(FAIL_OP_RESULT);
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].error?.code).toBe("WRITE_DENIED");
    expect(result.results[0].error?.message).toBeTruthy();
  });

  it("successful result has no error field", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.results[0].error).toBeUndefined();
  });

  it("result.sessionId is always the top-level sessionId", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    expect(result.sessionId).toBe(result.results[0].sessionId);
  });
});

// ─── Deliverable G: Audit events ─────────────────────────────────────────────

describe("Deliverable G — audit events", () => {
  it("fires execution_action.dispatched before connector operation", async () => {
    const auditCalls: string[] = [];
    mockLogOrgEvent.mockImplementation(async ({ eventType }: { eventType: string }) => {
      auditCalls.push(eventType);
    });
    mockSubmitConnectorOperation.mockImplementation(async () => {
      // At point of connector call, dispatched should already be fired
      expect(auditCalls).toContain("execution_action.dispatched");
      return SUCCESS_OP_RESULT;
    });

    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
  });

  it("fires execution_action.completed on successful action", async () => {
    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    const eventTypes = mockLogOrgEvent.mock.calls.map((c: any) => c[0].eventType);
    expect(eventTypes).toContain("execution_action.dispatched");
    expect(eventTypes).toContain("execution_action.completed");
  });

  it("fires execution_action.failed on connector error response", async () => {
    mockSubmitConnectorOperation.mockResolvedValueOnce(FAIL_OP_RESULT);
    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    const eventTypes = mockLogOrgEvent.mock.calls.map((c: any) => c[0].eventType);
    expect(eventTypes).toContain("execution_action.failed");
  });

  it("fires execution_action.cancelled for remaining after fatal failure", async () => {
    const { ConnectorOperationError } = await import("../services/connectorBridgeService.js");
    mockSubmitConnectorOperation
      .mockRejectedValueOnce(new ConnectorOperationError("DEVICE_NOT_CONNECTED", "Lost"));

    await dispatchExecutionActions([makeAction(), makeAction()], BASE_CONTEXT);
    const eventTypes = mockLogOrgEvent.mock.calls.map((c: any) => c[0].eventType);
    expect(eventTypes).toContain("execution_action.cancelled");
  });

  it("audit includes target, operation, specialist, and connectorDevice", async () => {
    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    const completedCall = mockLogOrgEvent.mock.calls.find(
      (c: any) => c[0].eventType === "execution_action.completed",
    );
    expect(completedCall).toBeDefined();
    const meta = completedCall![0].metadata;
    expect(meta.target).toBeTruthy();
    expect(meta.operation).toBeTruthy();
    expect(meta.specialist).toBe(BASE_CONTEXT.specialistCode);
    expect(meta.connectorDevice).toBe(MOCK_SESSION.deviceId);
  });

  it("audit eventType never contains 'openclaw'", async () => {
    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    const eventTypes = mockLogOrgEvent.mock.calls.map((c: any) => c[0].eventType as string);
    for (const et of eventTypes) {
      expect(et.toLowerCase()).not.toContain("openclaw");
    }
  });

  it("fires audit even when connector operation fails with throw", async () => {
    const { ConnectorOperationError } = await import("../services/connectorBridgeService.js");
    mockSubmitConnectorOperation.mockRejectedValueOnce(
      new ConnectorOperationError("TIMEOUT", "Timed out"),
    );
    await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    const eventTypes = mockLogOrgEvent.mock.calls.map((c: any) => c[0].eventType);
    expect(eventTypes).toContain("execution_action.failed");
  });
});

// ─── Deliverable F: registerProposedActions and getDispatchRecord ─────────────

describe("Deliverable F — inspector dispatch record", () => {
  it("registerProposedActions stores proposed actions for retrieval", () => {
    const actions = [makeAction({ status: "proposed" })];
    registerProposedActions("exec_001", actions);
    const record = getDispatchRecord("exec_001");
    expect(record).not.toBeNull();
    expect(record!.proposedActions).toHaveLength(1);
  });

  it("getDispatchRecord returns null before any registration or dispatch", () => {
    const record = getDispatchRecord("exec_unknown");
    expect(record).toBeNull();
  });

  it("dispatch stores results in the record", async () => {
    const ctx = { ...BASE_CONTEXT, executionId: "exec_for_record" };
    mockOpenConnectorSession.mockResolvedValue({ deviceId: "dev_001", sessionId: "sess_for_record" });
    await dispatchExecutionActions([makeAction()], ctx);
    const record = getDispatchRecord("exec_for_record");
    expect(record).not.toBeNull();
    expect(record!.results).toHaveLength(1);
    expect(record!.approvedActions).toHaveLength(1);
  });

  it("executionOrder matches the dispatch sequence", async () => {
    const ctx = { ...BASE_CONTEXT, executionId: "exec_order_test" };
    mockOpenConnectorSession.mockResolvedValue({ deviceId: "dev_001", sessionId: "sess_order" });
    const a1 = makeAction({ actionId: "ord_1" });
    const a2 = makeAction({ actionId: "ord_2" });
    await dispatchExecutionActions([a1, a2], ctx);
    const record = getDispatchRecord("exec_order_test");
    expect(record!.executionOrder).toEqual(["ord_1", "ord_2"]);
  });

  it("record includes startedAt and completedAt timestamps", async () => {
    const ctx = { ...BASE_CONTEXT, executionId: "exec_ts_test" };
    mockOpenConnectorSession.mockResolvedValue({ deviceId: "dev_001", sessionId: "sess_ts" });
    await dispatchExecutionActions([makeAction()], ctx);
    const record = getDispatchRecord("exec_ts_test");
    expect(record!.startedAt).toBeTruthy();
    expect(record!.completedAt).toBeTruthy();
  });

  it("registerProposedActions is idempotent — re-registration replaces proposedActions", () => {
    registerProposedActions("exec_idem", [makeAction({ actionId: "old" })]);
    registerProposedActions("exec_idem", [makeAction({ actionId: "new" })]);
    const record = getDispatchRecord("exec_idem");
    expect(record!.proposedActions[0].actionId).toBe("new");
  });

  it("re-registration preserves existing dispatch results", async () => {
    const ctx = { ...BASE_CONTEXT, executionId: "exec_preserve" };
    mockOpenConnectorSession.mockResolvedValue({ deviceId: "dev_001", sessionId: "sess_pres" });
    await dispatchExecutionActions([makeAction()], ctx);
    // Re-register proposed actions
    registerProposedActions("exec_preserve", [makeAction({ actionId: "new_proposed" })]);
    const record = getDispatchRecord("exec_preserve");
    expect(record!.results).toHaveLength(1); // results preserved
    expect(record!.proposedActions[0].actionId).toBe("new_proposed");
  });
});

// ─── Architecture rules ───────────────────────────────────────────────────────

describe("Architecture rules", () => {
  it("dispatcher never evaluates approval logic — only checks status field", async () => {
    // A high-risk action that would require approval IF the approval layer hadn't run
    // The dispatcher must NOT re-check riskLevel or resolvedDestination.approvalRequired
    const highRiskApprovedAction = makeAction({
      status: "approved",
      riskLevel: "high",
      requiresApproval: true,
      approvalReason: "High risk — admin approved",
      resolvedDestination: {
        domain: "organisation_library",
        displayPath: "/org/library/policy.docx",
        connectorRequired: true,
        channelRequired: null,
        approvalRequired: true,
        approvalReason: "Organisation library writes require approval",
      },
    });
    // Must succeed — the dispatcher trusts the approval layer
    await expect(dispatchExecutionActions([highRiskApprovedAction], BASE_CONTEXT))
      .resolves.toBeDefined();
  });

  it("result never contains the string 'openclaw'", async () => {
    const result = await dispatchExecutionActions([makeAction()], BASE_CONTEXT);
    const serialised = JSON.stringify(result);
    expect(serialised.toLowerCase()).not.toContain("openclaw");
  });

  it("connector session is opened exactly once per dispatch run", async () => {
    const actions = [makeAction(), makeAction(), makeAction()];
    await dispatchExecutionActions(actions, BASE_CONTEXT);
    expect(mockOpenConnectorSession).toHaveBeenCalledTimes(1);
  });

  it("connector session is closed exactly once per dispatch run", async () => {
    const actions = [makeAction(), makeAction()];
    await dispatchExecutionActions(actions, BASE_CONTEXT);
    expect(mockCloseConnectorSession).toHaveBeenCalledTimes(1);
  });

  it("recordConnectorOperation called once per dispatched action", async () => {
    await dispatchExecutionActions([makeAction(), makeAction()], BASE_CONTEXT);
    // Each action that reaches the bridge triggers a recordConnectorOperation call
    expect(mockRecordConnectorOperation).toHaveBeenCalledTimes(2);
  });

  it("unsupported actions do NOT call recordConnectorOperation", async () => {
    await dispatchExecutionActions(
      [makeAction({ domain: "terminal", actionType: "terminal_command" })],
      BASE_CONTEXT,
    );
    expect(mockRecordConnectorOperation).not.toHaveBeenCalled();
  });
});

// ─── Acceptance scenarios ─────────────────────────────────────────────────────

describe("Acceptance scenarios", () => {
  it("Scenario 1: review and save revised policy file (files.write → approval → connector write → audit)", async () => {
    const policyAction = makeAction({
      status: "approved",
      domain: "files",
      actionType: "write_file",
      description: "Save revised OHS policy to Documents",
      resolvedDestination: {
        domain:          "desktop_documents",
        displayPath:     "~/Documents/OHS_Policy_v2.docx",
        connectorRequired: true,
        channelRequired:   null,
        approvalRequired:  true,
        approvalReason:    "Document write requires approval",
      },
      approvedAt: new Date().toISOString(),
      approvedByUserId: "user_admin",
    });

    const result = await dispatchExecutionActions([policyAction], {
      ...BASE_CONTEXT,
      executionId: "exec_scenario_1",
    });

    expect(result.summary.completed).toBe(1);
    expect(result.summary.total).toBe(1);
    const connOp = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(connOp.operationType).toBe("write");
    const auditEvents = mockLogOrgEvent.mock.calls.map((c: any) => c[0].eventType);
    expect(auditEvents).toContain("execution_action.dispatched");
    expect(auditEvents).toContain("execution_action.completed");
  });

  it("Scenario 2: generate incident report and create Word document (word.create)", async () => {
    const wordAction = makeAction({
      status: "approved",
      domain: "word",
      actionType: "create_file",
      description: "Create incident report document",
      resolvedDestination: {
        domain:          "desktop_documents",
        displayPath:     "~/Documents/Incident_Report_2026.docx",
        connectorRequired: true,
        channelRequired:   null,
        approvalRequired:  false,
        approvalReason:    null,
      },
    });

    const result = await dispatchExecutionActions([wordAction], {
      ...BASE_CONTEXT,
      executionId: "exec_scenario_2",
    });

    expect(result.summary.completed).toBe(1);
    const connOp = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(connOp.operationType).toBe("word_create");
    expect(result.results[0].target).toContain("Incident_Report_2026.docx");
  });

  it("Scenario 3: analyse spreadsheet and update workbook (excel.update)", async () => {
    const excelAction = makeAction({
      status: "approved",
      domain: "excel",
      actionType: "update_spreadsheet",
      description: "Update Q3 metrics in Financials workbook",
      resolvedDestination: {
        domain:          "excel_workbook",
        displayPath:     "~/Documents/Financials_Q3.xlsx",
        connectorRequired: true,
        channelRequired:   null,
        approvalRequired:  false,
        approvalReason:    null,
      },
      parameters: { path: "~/Documents/Financials_Q3.xlsx", sheetName: "Q3", updates: [] },
    });

    const result = await dispatchExecutionActions([excelAction], {
      ...BASE_CONTEXT,
      executionId: "exec_scenario_3",
    });

    expect(result.summary.completed).toBe(1);
    const connOp = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(connOp.operationType).toBe("excel_update");
    const auditEvents = mockLogOrgEvent.mock.calls.map((c: any) => c[0].eventType);
    expect(auditEvents).toContain("execution_action.completed");
  });

  it("Scenario 4: draft Outlook email — created as draft, NOT sent", async () => {
    const emailAction = makeAction({
      status: "approved",
      domain: "email",
      actionType: "draft_email",
      description: "Draft follow-up email to stakeholders",
      resolvedDestination: {
        domain:          "outlook_drafts",
        displayPath:     "outlook://drafts",
        connectorRequired: true,
        channelRequired:   null,
        approvalRequired:  false,
        approvalReason:    null,
      },
      parameters: {
        to: ["stakeholder@example.com"],
        subject: "Incident Report Follow-up",
        body: "Please review the attached incident report.",
      },
    });

    // Must succeed as email_draft, not send_email
    const result = await dispatchExecutionActions([emailAction], {
      ...BASE_CONTEXT,
      executionId: "exec_scenario_4",
    });

    expect(result.summary.completed).toBe(1);
    const connOp = mockSubmitConnectorOperation.mock.calls[0][2];
    expect(connOp.operationType).toBe("email_draft");
    // Verify the operation is NOT "send" — email sending is a non-goal
    expect(connOp.operationType).not.toBe("send");
    expect(connOp.operationType).not.toBe("email_send");
  });

  it("Scenario 5: connector disconnects during execution — graceful failure, remaining cancelled", async () => {
    const { ConnectorOperationError } = await import("../services/connectorBridgeService.js");
    mockSubmitConnectorOperation
      .mockResolvedValueOnce(SUCCESS_OP_RESULT)  // action 1: succeeds
      .mockRejectedValueOnce(new ConnectorOperationError("DEVICE_NOT_CONNECTED", "WebSocket closed")); // action 2: fatal

    const actions = [
      makeAction({ actionId: "s5_act1", description: "Write file" }),
      makeAction({ actionId: "s5_act2", description: "Create Word doc" }),
      makeAction({ actionId: "s5_act3", description: "Draft email" }),
    ];

    const result = await dispatchExecutionActions(actions, {
      ...BASE_CONTEXT,
      executionId: "exec_scenario_5",
    });

    // Graceful failure
    expect(result.summary.completed).toBe(1);
    expect(result.summary.failed).toBe(1);
    expect(result.summary.cancelled).toBe(1);
    expect(result.summary.stoppedOnFatalFailure).toBe(true);

    // Session closed
    expect(mockCloseConnectorSession).toHaveBeenCalledWith(
      "exec_scenario_5",
      "fatal_connector_failure",
    );

    // Execution report produced
    expect(result.results).toHaveLength(3);
    expect(result.results[0].status).toBe("completed");
    expect(result.results[1].status).toBe("failed");
    expect(result.results[2].status).toBe("cancelled");
    expect(result.results[2].error?.code).toBe("EXECUTION_CANCELLED");

    // All actions have an execution report entry
    expect(result.results.every(r => r.actionId && r.sessionId && r.executionId)).toBe(true);
  });
});
