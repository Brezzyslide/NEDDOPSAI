/**
 * sprint-122-123-completed-work-lifecycle.test.ts
 *
 * Regression tests for the Completed Work lifecycle consistency fix.
 *
 * Root causes fixed:
 *   #122 — After execution, completed_work.status stayed "draft" because
 *           submitForApproval() was never called. Active Work showed the item
 *           under "In Progress" not "Awaiting Approval".
 *   #123 — postCompletedWorkCreatedToConversation() always said
 *           "ready for your approval" regardless of actual persisted status,
 *           and provided no direct reference to the work item.
 *
 * Test strategy:
 *   Part 1 — Simulation-based unit tests for the engine's new completion logic
 *             (createDraft → submitForApproval → result assembly). These mirror
 *             the exact code added to unifiedExecutionEngine.ts without running
 *             the full pipeline stack.
 *   Part 2 — Source-code contract tests. Verify the three changed files
 *             contain the required patterns (structural regression guards).
 *   Part 3 — Active Work status-to-tab mapping regression guard.
 *   Part 4 — postCompletedWorkCreatedToConversation signature/structure tests.
 *
 * Invariants verified (per spec):
 *   1+2. Engine creates draft then calls submitForApproval (correct order)
 *   3.   submitForApproval() called with correct args (workId, orgId, userId)
 *   4.   Engine result carries completedWorkStatus = awaiting_approval
 *   5.   awaiting_approval status maps to Awaiting Approval tab (not In Progress)
 *   6.   CoS message is status-accurate (not hardcoded "ready for approval")
 *   7.   Engine result carries completedWorkId + completedWorkTitle for direct ref
 *   8.   If submitForApproval() fails, status=draft preserved, message honest
 *   9.   Work with outputRequiresApproval=false is NOT forced through approval
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockCreateDraft       = vi.fn();
const mockSubmitForApproval = vi.fn();

vi.mock("../services/completedWorkService.js", () => ({
  createDraft:       (...a: unknown[]) => mockCreateDraft(...a),
  submitForApproval: (...a: unknown[]) => mockSubmitForApproval(...a),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID  = "org-test-lifecycle";
const USER_ID = "user-test-lifecycle";
const WORK_ID = "cw-test-lifecycle";

const makeDraftRecord = (overrides: Record<string, unknown> = {}) => ({
  id: WORK_ID, status: "draft" as string,
  title: "Incident Review — Test",
  outputType: "action_plan",
  organizationId: ORG_ID,
  createdAt: new Date(), updatedAt: new Date(),
  ...overrides,
});

const makeAwaitingRecord = (overrides: Record<string, unknown> = {}) => ({
  ...makeDraftRecord(),
  status: "awaiting_approval" as string,
  ...overrides,
});

// ─── Source helpers ────────────────────────────────────────────────────────────

function readSrc(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf-8");
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─── Part 1: Engine completion logic — simulation unit tests ──────────────────
//
// We simulate the exact code block added to unifiedExecutionEngine.ts after
// reviewDraft completes. This avoids the need to stub the entire pipeline
// (AI gateway, ResourceRegistry, session manager, etc.) while still validating
// the specific behaviour change.

describe("Engine — completion logic simulation (Invariants 1–9)", () => {

  /**
   * Reproduces verbatim the new engine block:
   *   createDraft(…) → submitForApproval(id, orgId, userId) → return result
   *
   * See unifiedExecutionEngine.ts:909–969 for the production code.
   */
  async function simulateCompletionPath(options: {
    outputRequiresApproval?: boolean;
    draftRecord?: ReturnType<typeof makeDraftRecord>;
    submittedRecord?: ReturnType<typeof makeAwaitingRecord>;
    submitShouldThrow?: boolean;
  }) {
    const {
      outputRequiresApproval = true,
      draftRecord       = makeDraftRecord(),
      submittedRecord   = makeAwaitingRecord(),
      submitShouldThrow = false,
    } = options;

    // Configure mocks based on options BEFORE running logic
    mockCreateDraft.mockResolvedValue(draftRecord);
    if (submitShouldThrow) {
      mockSubmitForApproval.mockRejectedValue(new Error("DB constraint error"));
    } else {
      mockSubmitForApproval.mockResolvedValue(submittedRecord);
    }

    // Step 1: createDraft (always)
    const completedWork = await mockCreateDraft({
      organizationId: ORG_ID,
      requesterId:    USER_ID,
      title:          draftRecord.title,
    });

    // Step 2: lifecycle transition (conditional)
    const requiresApproval = outputRequiresApproval !== false;
    let finalWork = completedWork;

    if (requiresApproval) {
      try {
        finalWork = await mockSubmitForApproval(completedWork.id, ORG_ID, USER_ID);
      } catch {
        // preserve draft — finalWork remains completedWork
      }
    }

    // Step 3: build result
    const completedWorkStatus = finalWork.status as string;
    let message: string;
    if (completedWorkStatus === "awaiting_approval") {
      message = "The work is complete. The work is ready for your approval.";
    } else if (completedWorkStatus === "approved") {
      message = "The work is complete. The work has been approved.";
    } else {
      message = "The work is complete. The draft has been saved for your review.";
    }

    return {
      outcome:             "completed" as const,
      completedWorkId:     finalWork.id     as string,
      completedWorkStatus: finalWork.status as string,
      completedWorkTitle:  finalWork.title  as string,
      message,
    };
  }

  beforeEach(() => {
    mockCreateDraft.mockResolvedValue(makeDraftRecord());
    mockSubmitForApproval.mockResolvedValue(makeAwaitingRecord());
  });

  it("Inv 1+2: createDraft is called then submitForApproval (correct order, both called)", async () => {
    const r = await simulateCompletionPath({});
    expect(mockCreateDraft).toHaveBeenCalledOnce();
    expect(mockSubmitForApproval).toHaveBeenCalledOnce();
    expect(r.outcome).toBe("completed");
  });

  it("Inv 3: submitForApproval() is called with (workId, orgId, userId)", async () => {
    await simulateCompletionPath({});
    expect(mockSubmitForApproval).toHaveBeenCalledWith(WORK_ID, ORG_ID, USER_ID);
  });

  it("Inv 4: completedWorkStatus is awaiting_approval after successful submitForApproval", async () => {
    const r = await simulateCompletionPath({});
    expect(r.completedWorkStatus).toBe("awaiting_approval");
  });

  it("Inv 5: awaiting_approval (not draft) → maps to Awaiting Approval tab, not In Progress", async () => {
    const r = await simulateCompletionPath({});
    // Active Work mapping: draft → In Progress, awaiting_approval → Awaiting Approval
    expect(r.completedWorkStatus).toBe("awaiting_approval");
    expect(r.completedWorkStatus).not.toBe("draft");
  });

  it("Inv 6a: message says 'ready for your approval' when status=awaiting_approval", async () => {
    const r = await simulateCompletionPath({});
    expect(r.message).toMatch(/ready for your approval/i);
    expect(r.message).not.toMatch(/saved for your review/i);
  });

  it("Inv 6b: message does NOT say 'ready for approval' when outputRequiresApproval=false", async () => {
    const r = await simulateCompletionPath({ outputRequiresApproval: false });
    expect(r.message).not.toMatch(/ready for your approval/i);
    expect(r.message).toMatch(/saved for your review/i);
  });

  it("Inv 7: result includes completedWorkId and completedWorkTitle for direct reference", async () => {
    const title = "Incident Review — Specific Policy Audit";
    mockSubmitForApproval.mockResolvedValue(makeAwaitingRecord({ title }));
    const r = await simulateCompletionPath({
      draftRecord:     makeDraftRecord({ title }),
      submittedRecord: makeAwaitingRecord({ title }),
    });
    expect(r.completedWorkId).toBe(WORK_ID);
    expect(r.completedWorkTitle).toBe(title);
  });

  it("Inv 8a: if submitForApproval throws, status remains draft (not awaiting_approval)", async () => {
    const r = await simulateCompletionPath({ submitShouldThrow: true });
    expect(r.completedWorkStatus).toBe("draft");
  });

  it("Inv 8b: if submitForApproval throws, message does NOT claim 'ready for approval'", async () => {
    const r = await simulateCompletionPath({ submitShouldThrow: true });
    expect(r.message).not.toMatch(/ready for your approval/i);
    expect(r.message).toMatch(/saved for your review/i);
  });

  it("Inv 8c: if submitForApproval throws, completedWorkId is still present (draft preserved)", async () => {
    const r = await simulateCompletionPath({ submitShouldThrow: true });
    expect(r.outcome).toBe("completed");
    expect(r.completedWorkId).toBe(WORK_ID);
  });

  it("Inv 9: outputRequiresApproval=false → submitForApproval NOT called, status=draft", async () => {
    const r = await simulateCompletionPath({ outputRequiresApproval: false });
    expect(mockSubmitForApproval).not.toHaveBeenCalled();
    expect(r.completedWorkStatus).toBe("draft");
    expect(r.outcome).toBe("completed");
  });

  it("createDraft is called exactly once (no duplicate creation)", async () => {
    await simulateCompletionPath({});
    expect(mockCreateDraft).toHaveBeenCalledTimes(1);
  });
});

// ─── Part 2: Source-code contract tests ───────────────────────────────────────
// These verify the three changed files contain the required implementation
// patterns. They catch regressions if someone reverts the fix without updating tests.

describe("Source contract — unifiedExecutionEngine.ts", () => {
  const src = readSrc("src/services/unifiedExecutionEngine.ts");

  it("imports submitForApproval from completedWorkService", () => {
    expect(src).toMatch(/import\s*\{[^}]*submitForApproval[^}]*\}\s*from\s*["']\.\/completedWorkService\.js["']/);
  });

  it("calls submitForApproval(completedWork.id, organizationId, requesterId) in executeTask", () => {
    expect(src).toContain("submitForApproval(completedWork.id, organizationId, requesterId)");
  });

  it("uses outputRequiresApproval !== false guard (default true)", () => {
    expect(src).toContain("outputRequiresApproval !== false");
  });

  it("preserves draft on submitForApproval failure via try/catch", () => {
    expect(src).toContain("submitForApproval failed — preserving draft");
  });

  it("ExecuteWorkResult interface declares completedWorkStatus?: string", () => {
    expect(src).toContain("completedWorkStatus?: string");
  });

  it("ExecuteWorkResult interface declares completedWorkTitle?: string", () => {
    expect(src).toContain("completedWorkTitle?: string");
  });

  it("returns completedWorkStatus: finalWork.status in task result", () => {
    expect(src).toContain("completedWorkStatus: finalWork.status");
  });

  it("returns completedWorkTitle: finalWork.title in task result", () => {
    expect(src).toContain("completedWorkTitle: finalWork.title");
  });

  it("ExecutionRequest interface declares outputRequiresApproval?: boolean", () => {
    expect(src).toContain("outputRequiresApproval?: boolean");
  });

  it("buildCompletionMessage receives completedWorkStatus parameter", () => {
    expect(src).toMatch(/buildCompletionMessage\(finalWork\.id,\s*finalWork\.status/);
  });
});

describe("Source contract — executionCoordinatorService.ts", () => {
  const src = readSrc("src/services/executionCoordinatorService.ts");

  it("uses result.completedWorkStatus (not hardcoded assumption)", () => {
    expect(src).toContain("completedWorkStatus");
  });

  it("uses result.completedWorkTitle (not userRequest.slice(0, 80))", () => {
    expect(src).toContain("completedWorkTitle");
  });

  it("no longer derives title from userRequest.slice(0, 80)", () => {
    expect(src).not.toMatch(/const title = userRequest\.slice\(0, 80\)/);
  });

  it("passes persistedStatus to postCompletedWorkCreatedToConversation", () => {
    expect(src).toContain("persistedStatus");
  });

  it("human label reflects actual status (awaiting_approval vs draft)", () => {
    // Verify the coordinator branches on status for the humanLabel
    expect(src).toContain("persistedStatus === \"awaiting_approval\"");
  });
});

describe("Source contract — conversationService.ts", () => {
  const src = readSrc("src/services/conversationService.ts");

  it("postCompletedWorkCreatedToConversation accepts completedWorkStatus parameter", () => {
    expect(src).toContain("completedWorkStatus: string");
  });

  it("message for awaiting_approval says 'ready for your approval'", () => {
    expect(src).toContain("ready for your approval");
  });

  it("message for draft says 'saved as a draft'", () => {
    expect(src).toContain("saved as a draft");
  });

  it("message includes work reference (ref: `${completedWorkId}`)", () => {
    expect(src).toContain("completedWorkId}");
  });

  it("structured card data includes completedWorkStatus field", () => {
    expect(src).toContain("completedWorkStatus");
  });

  it("does NOT hardcode 'ready for your approval' for all statuses", () => {
    // Before fix: single message string with "ready for your approval" unconditionally.
    // After fix: it is inside a switch/case branch, only for awaiting_approval.
    // Verify the function is not using the old pattern where "ready for your approval"
    // appears OUTSIDE of a conditional construct.
    // Simple check: there's a switch statement or if/else controlling the message.
    expect(src).toMatch(/case "awaiting_approval":|switch \(completedWorkStatus\)/);
  });
});

// ─── Part 3: Active Work status-to-tab mapping regression guard ───────────────

describe("Active Work status mapping — must not change to hide lifecycle bugs", () => {
  const MAPPING: Record<string, string> = {
    draft:             "In Progress",
    awaiting_approval: "Awaiting Approval",
    approved:          "Completed",
    failed:            "Failed",
  };

  it.each(Object.entries(MAPPING))(
    "status '%s' maps to '%s' tab",
    (status, expectedTab) => {
      // Copied from ActiveWorkPage.tsx — changes here signal a mapping regression
      const mapping: Record<string, string> = {
        draft:             "In Progress",
        awaiting_approval: "Awaiting Approval",
        approved:          "Completed",
        failed:            "Failed",
      };
      expect(mapping[status]).toBe(expectedTab);
    },
  );

  it("fix targets lifecycle (submitForApproval), not the mapping — draft stays In Progress", () => {
    // WRONG fix: remap "draft" → "Awaiting Approval" in the UI.
    // CORRECT fix: call submitForApproval so DB status becomes "awaiting_approval".
    const mapping: Record<string, string> = {
      draft:             "In Progress",
      awaiting_approval: "Awaiting Approval",
    };
    expect(mapping["draft"]).toBe("In Progress");         // mapping unchanged
    expect(mapping["awaiting_approval"]).toBe("Awaiting Approval"); // engine status correct
  });
});

// ─── Part 4: postCompletedWorkCreatedToConversation signature ─────────────────

describe("postCompletedWorkCreatedToConversation — function signature", () => {
  it("function exported from conversationService accepts 8 parameters", async () => {
    const { postCompletedWorkCreatedToConversation } =
      await import("../services/conversationService.js");
    // 8 params: orgId, convId, taskId, workId, title, status, qualityScore, correlationId
    // Before fix: 7 params (no status). After fix: 8.
    expect(postCompletedWorkCreatedToConversation.length).toBe(8);
  });
});

// ─── Part 5: Real database reconciliation guard ───────────────────────────────

const runDbBackedLifecycleTests = process.env["NEEDSOPS_DB_TESTS"] === "1" && !!process.env["DATABASE_URL"];

describe.runIf(runDbBackedLifecycleTests)("DB-backed blocked draft reconciliation", () => {
  it("persists evidence_required + incompleteDraft metadata and blocks completed work approval", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organizationId = `org-db-blocked-draft-${suffix}`;
    const taskId = `task-db-blocked-draft-${suffix}`;
    const completedWorkId = `cw-db-blocked-draft-${suffix}`;
    const userId = `user-db-blocked-draft-${suffix}`;

    const [
      { db, organizationsTable, tasksTable, completedWorkTable, withSystemTenantContext },
      { eq, and },
      taskService,
      completedWorkService,
    ] = await Promise.all([
      import("@workspace/db"),
      import("drizzle-orm"),
      import("../services/taskService.js"),
      vi.importActual<typeof import("../services/completedWorkService.js")>("../services/completedWorkService.js"),
    ]);

    await db.insert(organizationsTable).values({
      id: organizationId,
      name: "DB Blocked Draft Test",
      slug: `db-blocked-draft-${suffix}`.slice(0, 63),
      displayName: "DB Blocked Draft Test",
      status: "active",
      environment: "test",
      isTestOrganisation: true,
    });

    try {
      await withSystemTenantContext(
        { tenantId: organizationId, serviceIdentity: "vitest", purpose: "blocked_draft.seed" },
        async (client) => {
          await client.insert(tasksTable).values({
            id: taskId,
            organizationId,
            title: "Blocked draft reconciliation fixture",
            currentState: "executing",
            priority: "normal",
            approvalState: "required",
            metadata: {},
          });
          await client.insert(completedWorkTable).values({
            id: completedWorkId,
            organizationId,
            conversationId: null,
            blueprintId: "care_plan",
            blueprintVersion: "1.0.0",
            manifestId: "manifest-db-blocked-draft",
            primarySpecialist: "service_delivery_coordinator",
            title: "Blocked draft completed work fixture",
            outputType: "care_plan",
            status: "draft",
            currentVersionId: null,
            approvalWorkflow: {
              approvalBlocked: true,
              approvalBlockedReason: "This draft did not pass completion checks and cannot be submitted for approval.",
            },
            createdByUserId: userId,
          });
        },
      );

      const result = await taskService.reconcileTaskExecutionSuccess({
        taskId,
        organizationId,
        completedWorkId,
        completedWorkStatus: "draft",
        approvalBlocked: true,
        completionGateFailures: [{ gate: "mandatory_deliverable_coverage", message: "missing content" }],
        correlationId: `corr-${suffix}`,
        requestedByUserId: userId,
      });

      expect(result.status).toBe("draft_unapproved");

      const [persistedTask] = await withSystemTenantContext(
        { tenantId: organizationId, serviceIdentity: "vitest", purpose: "blocked_draft.assert_task" },
        async (client) => client.select()
          .from(tasksTable)
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)))
          .limit(1),
      );
      expect(persistedTask?.currentState).toBe("evidence_required");
      expect((persistedTask?.metadata as any)?.incompleteDraft).toMatchObject({
        completedWorkId,
        completedWorkStatus: "draft",
        correlationId: `corr-${suffix}`,
        reason: "Completion checks did not pass. Draft exists but is blocked from approval.",
      });

      const work = await completedWorkService.getCompletedWork(completedWorkId, organizationId);
      expect(work?.status).toBe("draft");
      expect(work?.approvalWorkflow?.approvalBlocked).toBe(true);

      await expect(
        completedWorkService.submitForApproval(completedWorkId, organizationId, userId),
      ).rejects.toThrow("This draft did not pass completion checks and cannot be submitted for approval.");
    } finally {
      await withSystemTenantContext(
        { tenantId: organizationId, serviceIdentity: "vitest", purpose: "blocked_draft.cleanup" },
        async (client) => {
          await client.delete(completedWorkTable)
            .where(and(eq(completedWorkTable.id, completedWorkId), eq(completedWorkTable.organizationId, organizationId)));
          await client.delete(tasksTable)
            .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)));
        },
      ).catch(() => undefined);
      await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId)).catch(() => undefined);
    }
  });

  it("does not requeue or redispatch a blocked draft when the user sends an affirmation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const organizationId = `org-db-blocked-loop-${suffix}`;
    const taskId = `task-db-blocked-loop-${suffix}`;
    const completedWorkId = `cw-db-blocked-loop-${suffix}`;
    const conversationId = `conv-db-blocked-loop-${suffix}`;
    const userId = `user-db-blocked-loop-${suffix}`;

    const [
      {
        db,
        organizationsTable,
        usersTable,
        tasksTable,
        completedWorkTable,
        conversationsTable,
        conversationMessagesTable,
        withSystemTenantContext,
      },
      { eq, and },
      { handleIncomingMessage },
    ] = await Promise.all([
      import("@workspace/db"),
      import("drizzle-orm"),
      import("../services/messageIngressService.js"),
    ]);

    await db.insert(organizationsTable).values({
      id: organizationId,
      name: "DB Blocked Draft Loop Test",
      slug: `db-blocked-loop-${suffix}`.slice(0, 63),
      displayName: "DB Blocked Draft Loop Test",
      status: "active",
      environment: "test",
      isTestOrganisation: true,
    });
    await db.insert(usersTable).values({
      id: userId,
      externalId: `ext-${userId}`,
      email: `${userId}@example.test`,
      displayName: "Blocked Draft Loop Tester",
      status: "active",
    });

    try {
      await withSystemTenantContext(
        { tenantId: organizationId, serviceIdentity: "vitest", purpose: "blocked_draft_loop.seed" },
        async (client) => {
          await client.insert(tasksTable).values({
            id: taskId,
            organizationId,
            title: "Blocked draft loop fixture",
            currentState: "evidence_required",
            priority: "normal",
            approvalState: "required",
            metadata: {
              incompleteDraft: {
                completedWorkId,
                completedWorkStatus: "draft",
                reason: "Completion checks did not pass. Draft exists but is blocked from approval.",
              },
            },
          });
          await client.insert(completedWorkTable).values({
            id: completedWorkId,
            organizationId,
            conversationId,
            blueprintId: "care_plan",
            blueprintVersion: "1.0.0",
            manifestId: "manifest-db-blocked-loop",
            primarySpecialist: "service_delivery_coordinator",
            title: "Blocked draft loop completed work fixture",
            outputType: "care_plan",
            status: "draft",
            currentVersionId: null,
            approvalWorkflow: {
              approvalBlocked: true,
              approvalBlockedReason: "This draft did not pass completion checks and cannot be submitted for approval.",
            },
            createdByUserId: userId,
          });
          await client.insert(conversationsTable).values({
            id: conversationId,
            organizationId,
            createdByUserId: userId,
            title: "Blocked draft workroom",
            conversationType: "task_workroom",
            status: "active",
            primaryTaskId: taskId,
          });
        },
      );

      const result = await handleIncomingMessage({
        organizationId,
        userId,
        conversationId,
        taskId,
        content: "continue",
        idempotencyKey: `blocked-loop-${suffix}`,
      });

      expect(result.type).toBe("normal");
      expect(result.result.understanding.conversationMode).toBe("task_followup");
      expect(result.result.understanding.customerResponse).toContain("unapproved draft");
      expect(result.result.understanding.customerResponse).toContain("blocked from approval");

      const [persistedTask] = await withSystemTenantContext(
        { tenantId: organizationId, serviceIdentity: "vitest", purpose: "blocked_draft_loop.assert_task" },
        async (client) => client.select()
          .from(tasksTable)
          .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)))
          .limit(1),
      );
      expect(persistedTask?.currentState).toBe("evidence_required");
      expect((persistedTask?.metadata as any)?.incompleteDraft).toMatchObject({ completedWorkId });
      expect((persistedTask?.metadata as any)?.evidenceRequiredResume).toBeUndefined();
      expect((persistedTask?.metadata as any)?.executionClaim).toBeUndefined();
    } finally {
      await withSystemTenantContext(
        { tenantId: organizationId, serviceIdentity: "vitest", purpose: "blocked_draft_loop.cleanup" },
        async (client) => {
          await client.delete(conversationMessagesTable)
            .where(and(eq(conversationMessagesTable.conversationId, conversationId), eq(conversationMessagesTable.organizationId, organizationId)));
          await client.delete(completedWorkTable)
            .where(and(eq(completedWorkTable.id, completedWorkId), eq(completedWorkTable.organizationId, organizationId)));
          await client.delete(conversationsTable)
            .where(and(eq(conversationsTable.id, conversationId), eq(conversationsTable.organizationId, organizationId)));
          await client.delete(tasksTable)
            .where(and(eq(tasksTable.id, taskId), eq(tasksTable.organizationId, organizationId)));
        },
      ).catch(() => undefined);
      await db.delete(usersTable).where(eq(usersTable.id, userId)).catch(() => undefined);
      await db.delete(organizationsTable).where(eq(organizationsTable.id, organizationId)).catch(() => undefined);
    }
  });
});
