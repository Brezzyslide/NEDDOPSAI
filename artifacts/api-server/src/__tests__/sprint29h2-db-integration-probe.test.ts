/**
 * Sprint 29H.2 — DB Integration Probe (runs against live org DB)
 *
 * Verifies the full end-to-end chain against mhr-holdings-2:
 *   1. resolveConversationActionState reads grounded completedWork metadata
 *   2. Level is NOT "completed" (Part A — no short-circuit)
 *   3. completedWork.primarySpecialist = knowledge_documentation_specialist
 *   4. buildActionStateSection contains grounded attribution block
 *   5. resolveActionDecision produces rerun_existing for all 6 dispatch scenarios
 *   6. Acceptance message → rerun_existing (the live gate scenario)
 *
 * This test is safe — read-only. The live completedWork record e7f810e9 is
 * not modified.
 */

import { describe, it, expect } from "vitest";
import {
  resolveConversationActionState,
  buildActionStateSection,
} from "../services/conversationActionStateService.js";
import { resolveActionDecision } from "../services/conversationActionDecisionService.js";

// Live mhr-holdings-2 identifiers (read-only)
const ORG_ID   = "98b132ec-958c-4ff4-8e80-c5fc7fccd1e2";
const CONV_ID  = "96b7bcfe-946b-4aa5-bf6b-635afaa950f5";
const TASK_ID  = "657d1b16-c9c3-40fe-bcb8-8229da6ef4ab";
const EXISTING_CW_ID = "e7f810e9-3554-422f-a892-258973ee5ac6";

// The acceptance message from the Sprint 29H.2 gate requirement
const ACCEPTANCE_MSG = "Review our current Incident Management Policy using the latest approved evidence and produce a new Incident Management Improvement Plan. This is a new review, not a request to show the previous completed work.";

describe("Sprint 29H.2 — DB integration probe (mhr-holdings-2)", () => {
  let liveState: Awaited<ReturnType<typeof resolveConversationActionState>>;

  it("resolves action state from live DB without crashing", async () => {
    liveState = await resolveConversationActionState({
      organisationId: ORG_ID,
      conversationId: CONV_ID,
      recentMessages: [],
      taskId: TASK_ID,
    });
    expect(liveState).toBeDefined();
  });

  it("Part A: level is NOT 'completed' (completedWorkId no longer overrides level)", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    // Level should be specialist_assigned (task exists + OM assigned) or task_created
    // — NOT "completed" which was the pre-29H.2 bug
    expect(liveState.level).not.toBe("completed");
    console.log("[Probe] Resolved level:", liveState.level);
  });

  it("Part D: completedWork is populated with full persisted metadata", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    expect(liveState.completedWorkId).toBe(EXISTING_CW_ID);
    expect(liveState.completedWork).toBeDefined();
    expect(liveState.completedWork?.id).toBe(EXISTING_CW_ID);
    console.log("[Probe] completedWork.primarySpecialist:", liveState.completedWork?.primarySpecialist);
    console.log("[Probe] completedWork.status:", liveState.completedWork?.status);
    console.log("[Probe] completedWork.qualityScore:", liveState.completedWork?.qualityScore);
  });

  it("Part D: primarySpecialist is knowledge_documentation_specialist (the actual producer)", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    // The record was produced by KDS, not OM (the pre-29H.2 bug was OM being falsely attributed)
    expect(liveState.completedWork?.primarySpecialist).toBe("knowledge_documentation_specialist");
  });

  it("Part D: buildActionStateSection includes grounded attribution block", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    const section = buildActionStateSection(liveState);
    expect(section).toContain("=== HISTORICAL COMPLETED WORK ===");
    expect(section).toContain("knowledge_documentation_specialist");
    expect(section).toContain("ATTRIBUTION RULE");
    // KDS is shown as the actual producer — not OM which was falsely attributed before
    expect(section).toContain("Primary specialist who produced this work: knowledge_documentation_specialist");
    console.log("[Probe] Action state section (first 15 lines):");
    console.log(section.split("\n").slice(0, 15).join("\n"));
  });

  it("S6 — acceptance message → rerun_existing (the live gate scenario)", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    const understanding: any = {
      conversationMode: "task_followup",
      confidence: 0.9,
      customerResponse: "...",
      shouldCreateTask: false,
      clarificationRequired: false,
      clarificationQuestions: [],
      relatedWorkforceRoles: [],
      requestedTaskAction: undefined,
    };
    const decision = resolveActionDecision(ACCEPTANCE_MSG, understanding, liveState);
    expect(decision.action).toBe("rerun_existing");
    expect(decision.shouldDispatchSpecialist).toBe(true);
    expect(decision.taskId).toBe(TASK_ID);
    expect(decision.completedWorkId).toBe(EXISTING_CW_ID);
    console.log("[Probe] S6 decision:", JSON.stringify(decision, null, 2));
  });

  it("S1 — 'show me the review' → view_existing (no dispatch)", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    const d = resolveActionDecision("Show me the completed review", { conversationMode: "result_followup" } as any, liveState);
    expect(d.action).toBe("view_existing");
    expect(d.shouldDispatchSpecialist).toBe(false);
  });

  it("S7 — 'what were the recommendations' → summarise_existing (no dispatch)", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    const d = resolveActionDecision("What were the main recommendations?", { conversationMode: "task_followup" } as any, liveState);
    expect(d.action).toBe("summarise_existing");
    expect(d.shouldDispatchSpecialist).toBe(false);
  });

  it("S4 — 'review again' → rerun_existing", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    const d = resolveActionDecision("Please review again with the latest evidence", { conversationMode: "task_followup" } as any, liveState);
    expect(d.action).toBe("rerun_existing");
    expect(d.shouldDispatchSpecialist).toBe(true);
  });

  it("existing completedWork record is preserved (not touched by probe)", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    // The probe is read-only — existing record must be unchanged
    expect(liveState.completedWork?.id).toBe(EXISTING_CW_ID);
    console.log("[Probe] ✓ Existing completedWork e7f810e9 preserved — probe is read-only");
  });

  it("8-scenario decision table", async () => {
    liveState = liveState ?? await resolveConversationActionState({ organisationId: ORG_ID, conversationId: CONV_ID, recentMessages: [], taskId: TASK_ID });
    const scenarios = [
      { label: "S1 view",       text: "Show me the completed review",                  mode: "result_followup",  rta: undefined, expected: "view_existing"      },
      { label: "S2 approve",    text: "I approve this",                                 mode: "approval_response",rta: undefined, expected: "approve_existing"   },
      { label: "S3 revise",     text: "Please revise with updated evidence",            mode: "task_followup",    rta: "revise",  expected: "revise_existing"    },
      { label: "S4 again",      text: "Please review again with the latest evidence",   mode: "task_followup",    rta: undefined, expected: "rerun_existing"     },
      { label: "S5 replace",    text: "Replace the old review with a new OM review",   mode: "task_followup",    rta: undefined, expected: "rerun_existing"     },
      { label: "S6 acceptance", text: ACCEPTANCE_MSG,                                   mode: "task_followup",    rta: undefined, expected: "rerun_existing"     },
      { label: "S7 followup",   text: "What were the main recommendations?",            mode: "task_followup",    rta: undefined, expected: "summarise_existing" },
    ];

    const noWorkState = { ...liveState, completedWork: undefined, completedWorkId: undefined };
    const s8: typeof scenarios[0] = { label: "S8 new task", text: "Create an Incident Management Improvement Plan", mode: "task_intent", rta: undefined, expected: "create_new_work" };

    console.log("\n=== 8-Scenario Decision Table ===");
    console.log(`${"Scenario".padEnd(14)} ${"Expected".padEnd(22)} ${"Actual".padEnd(22)} ${"Pass?"}`);
    console.log("-".repeat(75));

    for (const s of [...scenarios, s8]) {
      const state = s.label.includes("S8") ? noWorkState as any : liveState;
      const u: any = { conversationMode: s.mode, requestedTaskAction: s.rta, confidence: 0.9, customerResponse: "x", shouldCreateTask: false, clarificationRequired: false, clarificationQuestions: [], relatedWorkforceRoles: [] };
      const d = resolveActionDecision(s.text, u, state);
      const pass = d.action === s.expected ? "✓ PASS" : "✗ FAIL";
      console.log(`${s.label.padEnd(14)} ${s.expected.padEnd(22)} ${d.action.padEnd(22)} ${pass}`);
      expect(d.action).toBe(s.expected);
    }
  });
});
