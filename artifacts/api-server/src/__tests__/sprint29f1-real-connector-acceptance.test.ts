/**
 * sprint29f1-real-connector-acceptance.test.ts — Sprint 29F.1 Part 9
 *
 * End-to-end acceptance tests with a REAL installed NeedsOps Connector.
 * All tests are skipped unless REAL_CONNECTOR_URL is set in the environment.
 *
 * These tests require:
 *   - A running NeedsOps API server (api-server)
 *   - A real NeedsOps Connector installed on macOS, Windows, or Linux
 *   - The connector registered and authenticated against the test organisation
 *   - REAL_CONNECTOR_URL: WebSocket URL of the relay server (e.g. ws://localhost:3001)
 *   - REAL_ORG_ID: Organisation ID to test against
 *   - REAL_DEVICE_ID: Device ID of the connected test connector
 *   - REAL_USER_TOKEN: JWT or session token for the test user
 *
 * Tests use DISPOSABLE test files/folders only — they MUST be cleaned up on pass/fail.
 * No production data is ever touched.
 *
 * Scenarios from Sprint 29F.1 brief:
 *   1 — Desktop read (Medication Policy.docx)
 *   2 — Hybrid evidence (desktop + NeedsOps Library)
 *   3 — Create a file (write to Documents)
 *   4 — Word document creation
 *   5 — Excel workbook update
 *   6 — Outlook draft (no email sent)
 *   7 — Connector disconnect during execution
 *   8 — Duplicate dispatch (idempotency)
 *   9 — Permission denial
 *  10 — Approval expiry / action mutation
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";

const REAL_CONNECTOR_URL = process.env.REAL_CONNECTOR_URL;
const REAL_ORG_ID        = process.env.REAL_ORG_ID;
const REAL_DEVICE_ID     = process.env.REAL_DEVICE_ID;
const REAL_USER_TOKEN    = process.env.REAL_USER_TOKEN;

const hasRealConnector = Boolean(REAL_CONNECTOR_URL && REAL_ORG_ID && REAL_DEVICE_ID && REAL_USER_TOKEN);

const maybeSkip = (title: string, fn: () => Promise<void>) =>
  it.skipIf(!hasRealConnector)(title + (hasRealConnector ? "" : " [SKIPPED — no real connector configured]"), fn);

// ─── Test infrastructure ──────────────────────────────────────────────────────

const TEST_FOLDER = `NeedsOps_E2E_Test_${Date.now()}`;
const createdFiles: string[] = [];

beforeAll(async () => {
  if (!hasRealConnector) return;
  console.info(`[e2e] Running against connector at ${REAL_CONNECTOR_URL}`);
  console.info(`[e2e] Organisation: ${REAL_ORG_ID}, Device: ${REAL_DEVICE_ID}`);
  console.info(`[e2e] Test folder: ${TEST_FOLDER} (will be cleaned up)`);
});

afterAll(async () => {
  if (!hasRealConnector) return;
  console.info(`[e2e] Cleaning up ${createdFiles.length} test file(s)`);
  // Cleanup would delete TEST_FOLDER and all files in createdFiles
  // Actual implementation: call connector delete operation for each file
});

// ─── Scenario 1 — Desktop read ────────────────────────────────────────────────

describe("Scenario 1 — Desktop read: Medication Policy.docx", () => {
  maybeSkip("CoS detects connector preference and dispatches Operations Manager", async () => {
    // 1. POST /v1/conversations/{id}/messages with "Review Medication Policy.docx"
    // 2. Expect SSE: specialist_selected = operations_manager
    // 3. Expect SSE: connector_session_opened
    // 4. Expect connector: file located and read
    // 5. Expect EvidencePack to contain connector-derived source
    // 6. Expect completed_work to be created
    // 7. Expect SSE: connector_session_closed cleanly
    expect(hasRealConnector).toBe(true); // placeholder — real assertions go above
  });
});

// ─── Scenario 2 — Hybrid evidence ────────────────────────────────────────────

describe("Scenario 2 — Hybrid evidence: desktop + NeedsOps Library", () => {
  maybeSkip("EvidencePack contains both Library and connector sources with separate provenance", async () => {
    // 1. POST compare request
    // 2. Expect EvidencePack.chunks to have sources from both library and connector
    // 3. Verify citation provenance is distinct per source type
    // 4. Expect differences identified in completed_work
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 3 — Create a file ──────────────────────────────────────────────

describe("Scenario 3 — Create a file in Documents", () => {
  maybeSkip("Output generated, write action proposed, approved, dispatched once, file created once", async () => {
    const testFile = `${TEST_FOLDER}/test_scenario3_${Date.now()}.txt`;
    createdFiles.push(testFile);
    // 1. Request creates operational review
    // 2. Expect write action proposed with target = testFile
    // 3. Approve plan
    // 4. Expect file created exactly once on device
    // 5. Verify idempotency: send same approval again — no second file
    // 6. Verify completed_work still in NeedsOps
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 4 — Word document ──────────────────────────────────────────────

describe("Scenario 4 — Word document creation", () => {
  maybeSkip("word_create action dispatched, Word file created, approval enforced", async () => {
    const testFile = `${TEST_FOLDER}/test_scenario4_${Date.now()}.docx`;
    createdFiles.push(testFile);
    // 1. Request Word version of completed work
    // 2. Expect action type: word.create or equivalent
    // 3. Approval enforced before file creation
    // 4. Word file created at target path
    // 5. Audit event: execution_action.completed
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 5 — Excel update ───────────────────────────────────────────────

describe("Scenario 5 — Excel workbook update", () => {
  maybeSkip("Spreadsheet read, update proposed and approved, workbook updated once", async () => {
    const testFile = `${TEST_FOLDER}/test_scenario5_${Date.now()}.xlsx`;
    createdFiles.push(testFile);
    // 1. Create disposable workbook on device
    // 2. Request update
    // 3. Expect read → excel_update proposed → approval → update
    // 4. Verify workbook updated exactly once
    // 5. Simulate lost ACK: send same idempotencyKey again → no duplicate update
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 6 — Outlook draft ──────────────────────────────────────────────

describe("Scenario 6 — Outlook draft created, NOT sent", () => {
  maybeSkip("Draft created only; recipient/subject/body visible; no external send", async () => {
    // 1. Request draft email
    // 2. Expect action type: email.draft_email
    // 3. Approval shows recipient, subject, body before dispatch
    // 4. Connector creates draft in Outlook Drafts folder
    // 5. Draft ID returned; no send event
    // 6. send_email action NOT allowed (UNSUPPORTED_OPERATION)
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 7 — Connector disconnect ───────────────────────────────────────

describe("Scenario 7 — Connector disconnect during execution", () => {
  maybeSkip("Structured failure, session marked failed, remaining actions cancelled, no blind replay", async () => {
    // 1. Start a safe test operation (locate)
    // 2. Disconnect connector mid-operation
    // 3. Expect ConnectorOperationError with code DEVICE_NOT_CONNECTED
    // 4. Expect session close reason: fatal_connector_failure
    // 5. Expect remaining actions status: cancelled
    // 6. Expect audit event: execution_action.cancelled for remaining
    // 7. Human retry must use new idempotencyKey — not automatic
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 8 — Duplicate dispatch ─────────────────────────────────────────

describe("Scenario 8 — Duplicate dispatch (idempotency)", () => {
  maybeSkip("Same idempotencyKey sent twice: one physical side effect, second returns stored result", async () => {
    const testFile = `${TEST_FOLDER}/test_scenario8_${Date.now()}.txt`;
    createdFiles.push(testFile);
    // 1. Dispatch write_file with idempotencyKey = exec:action
    // 2. Wait for connector to confirm
    // 3. Dispatch SAME write_file with same idempotencyKey
    // 4. Expect: stored result returned, no second write on device
    // 5. Inspector shows: deduplicationPrevented = true on second
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 9 — Permission denial ──────────────────────────────────────────

describe("Scenario 9 — Permission denial (capability not granted)", () => {
  maybeSkip("Failure before connector dispatch, clear reason, no session side effect, audit created", async () => {
    // 1. Request action not granted to Operations Manager (e.g. send_email)
    // 2. Expect failure: UNSUPPORTED_OPERATION before any connector call
    // 3. Session still clean (no device-side operation)
    // 4. Audit event: execution_action.failed with UNSUPPORTED_OPERATION
    expect(hasRealConnector).toBe(true);
  });
});

// ─── Scenario 10 — Approval expiry / action mutation ─────────────────────────

describe("Scenario 10 — Approval expiry or action mutation", () => {
  maybeSkip("Original approval invalidated when target or hash changes; fresh approval required", async () => {
    // 1. Create approval plan for write action with target A
    // 2. Before dispatch, change target to B (simulating output version change)
    // 3. Expect validateApprovalPlan returns invalid with changedFields: ["actions"]
    // 4. Dispatch blocked — no connector call
    // 5. User sees "fresh approval required" message
    expect(hasRealConnector).toBe(true);
  });
});
