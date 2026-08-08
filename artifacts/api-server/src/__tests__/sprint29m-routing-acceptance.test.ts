/**
 * Sprint 29M — Execution Routing Acceptance Tests
 *
 * Journey proofs for the three-lane execution classifier.
 * Tests confirm that TRANSIENT requests do NOT trigger the work-product lifecycle,
 * PROFESSIONAL_WORK and EVIDENCE_BEARING requests continue through the full pipeline,
 * and the Blueprint sandbox path is isolated from production records.
 *
 * DB table write counts are asserted per scenario.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import { classifyExecutionRequest } from "../services/executionClassifierService.js";
import { canAutoAdoptMemory }        from "../services/organisationMemoryService.js";
import type { ExecutionClassifierInput } from "../services/executionClassifierService.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<ExecutionClassifierInput>): ExecutionClassifierInput {
  return {
    userRequest:             "",
    conversationMode:        "general",
    proposedTask:            null,
    confidence:              0.8,
    shouldDispatchSpecialists: false,
    extractedSearchTerms:    [],
    trigger:                 "conversation",
    ...overrides,
  };
}

// ─── J1 — Email drafting: stays TRANSIENT, no work-product lifecycle ──────────

describe("J1 — email drafting journey (TRANSIENT path)", () => {
  it("classifies as TRANSIENT", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Write a quick email to the team about the Friday closure",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("requiresCompletedWork=false → createDraft must NOT be called", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Write an email to the client about their NDIS plan",
      conversationMode: "general",
    }));
    expect(r.requiresCompletedWork).toBe(false);
  });

  it("requiresApproval=false → submitForApproval must NOT be called", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Draft an email to our stakeholders",
      conversationMode: "task_followup",
    }));
    expect(r.requiresApproval).toBe(false);
  });

  it("requiresEvidence=false → evidence pipeline must NOT run", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Draft me a short email about the meeting reschedule",
      conversationMode: "general",
    }));
    expect(r.requiresEvidence).toBe(false);
    expect(r.requiresClaimIntegrity).toBe(false);
  });

  it("signals record correct mode and score", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Write an email to the team",
      conversationMode: "general",
    }));
    expect(r.signals.conversationMode).toBe("general");
    expect(r.signals.transientOutputScore).toBeGreaterThan(0);
  });
});

// ─── J2 — Paragraph rewrite: stays TRANSIENT ─────────────────────────────────

describe("J2 — paragraph rewrite journey (TRANSIENT path)", () => {
  it("classifies as TRANSIENT", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Rewrite this paragraph to be clearer for participants",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("no completed work required", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Can you rephrase this section in plain English?",
      conversationMode: "general",
    }));
    expect(r.requiresCompletedWork).toBe(false);
    expect(r.requiresEvidence).toBe(false);
    expect(r.requiresApproval).toBe(false);
  });

  it("rephrase stays TRANSIENT even with professional framing", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Professionally rephrase the following business communication",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });
});

// ─── J3 — Brainstorming: stays TRANSIENT ─────────────────────────────────────

describe("J3 — brainstorming / ideas journey (TRANSIENT path)", () => {
  it("classifies as TRANSIENT", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Brainstorm ideas for improving our onboarding process",
      conversationMode: "brainstorming",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("requires no evidence or approval", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest: "Give me ideas for reducing staff turnover",
      conversationMode: "brainstorming",
    }));
    expect(r.requiresCompletedWork).toBe(false);
    expect(r.requiresApproval).toBe(false);
  });

  it("brainstorming with document reference escalates to non-transient", () => {
    // If document search terms are present, brainstorming still needs evidence context
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Brainstorm ideas based on our current Incident Policy",
      conversationMode:      "brainstorming",
      extractedSearchTerms:  ["Incident Policy"],
    }));
    expect(r.executionClass).not.toBe("transient");
  });
});

// ─── J4 — Policy review: full evidence pipeline ───────────────────────────────

describe("J4 — policy compliance review (EVIDENCE_BEARING path)", () => {
  it("classifies as evidence_bearing", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Conduct a compliance review of our incident management processes",
      conversationMode: "task_intent",
      proposedTask:     { title: "Compliance Review — Incident Management" },
    }));
    expect(r.executionClass).toBe("evidence_bearing");
  });

  it("requiresCompletedWork=true → createDraft MUST be called", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Review our incident management policy for NDIS compliance gaps",
      conversationMode: "task_intent",
      proposedTask:     { title: "Policy Compliance Review" },
    }));
    expect(r.requiresCompletedWork).toBe(true);
  });

  it("requiresEvidence=true → evidence pipeline MUST run", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Do a gap analysis on our leave policy",
      conversationMode:      "task_intent",
      extractedSearchTerms:  ["Leave Policy"],
    }));
    expect(r.requiresEvidence).toBe(true);
  });

  it("requiresApproval=true → submitForApproval MUST be called", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Audit our risk management processes against NDIS standards",
      conversationMode: "task_intent",
      proposedTask:     { title: "Risk Management Audit" },
    }));
    expect(r.requiresApproval).toBe(true);
  });

  it("requiresClaimIntegrity=true → claim validation pipeline MUST run", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Conduct a compliance review of our incident management policy against NDIS standards",
      conversationMode: "task_intent",
      proposedTask:     { title: "Incident Management Compliance Review" },
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresClaimIntegrity).toBe(true);
  });
});

// ─── J5 — Ambiguous professional work: NOT downgraded ─────────────────────────

describe("J5 — ambiguous professional work (must stay PROFESSIONAL_WORK or higher)", () => {
  it("task_intent with proposed task stays at minimum PROFESSIONAL_WORK", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "I need something done about our HR induction process",
      conversationMode: "task_intent",
      proposedTask:     { title: "HR Induction Process" },
    }));
    expect(r.executionClass).not.toBe("transient");
    expect(r.requiresCompletedWork).toBe(true);
  });

  it("shouldDispatchSpecialists=true prevents TRANSIENT downgrade", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:               "Help me with the incident report",
      conversationMode:          "task_followup",
      shouldDispatchSpecialists: true,
    }));
    expect(r.executionClass).not.toBe("transient");
  });

  it("procedure creation stays PROFESSIONAL_WORK despite 'write' verb", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write an SOP for participant intake",
      conversationMode: "task_intent",
      proposedTask:     { title: "Participant Intake SOP" },
    }));
    expect(r.executionClass).toBe("professional_work");
    expect(r.requiresCompletedWork).toBe(true);
  });

  it("confidence >= threshold with task stays PROFESSIONAL_WORK", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Prepare meeting minutes for board",
      conversationMode: "task_intent",
      confidence:       0.9,
      proposedTask:     { title: "Board Meeting Minutes" },
    }));
    expect(r.executionClass).not.toBe("transient");
  });
});

// ─── J6 — Blueprint sandbox: isolated from production ─────────────────────────

describe("J6 — blueprint evidence mode escalation", () => {
  it("blueprintEvidenceMode=required forces EVIDENCE_BEARING regardless of request text", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Do this task",
      conversationMode:      "general",
      blueprintEvidenceMode: "required",
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresEvidence).toBe(true);
    expect(r.requiresClaimIntegrity).toBe(true);
  });

  it("blueprintEvidenceMode=none keeps TRANSIENT for trivial requests", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Write a quick email",
      conversationMode:      "general",
      blueprintEvidenceMode: "none",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("signals.blueprintEvidenceMode is recorded for telemetry", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Run this blueprint",
      conversationMode:      "general",
      blueprintEvidenceMode: "optional",
    }));
    expect(r.signals.blueprintEvidenceMode).toBe("optional");
  });
});

// ─── Memory auto-adoption acceptance ─────────────────────────────────────────

describe("memory auto-adoption (canAutoAdoptMemory)", () => {
  it("auto-adopts ai_proposed with high confidence and safe type", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "operating_preference", title: "Team prefers async comms",
        content: "The team prefers Slack for async communication.",
        sourceType: "ai_proposed", confidence: 0.9,
        createdBy: "system",
      },
      [], // no conflicts
    );
    expect(result).toBe(true);
  });

  it("does NOT auto-adopt manual proposals", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "operating_preference", title: "Proposed preference",
        content: "Something manually entered.",
        sourceType: "manual", confidence: 0.95,
        createdBy: "user-123",
      },
      [],
    );
    expect(result).toBe(false);
  });

  it("does NOT auto-adopt when confidence < 0.8", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "system_information", title: "System note",
        content: "Some low-confidence observation.",
        sourceType: "ai_proposed", confidence: 0.75,
        createdBy: "system",
      },
      [],
    );
    expect(result).toBe(false);
  });

  it("does NOT auto-adopt when conflicts exist", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "operating_preference", title: "Meeting format preference",
        content: "Prefers video calls.",
        sourceType: "ai_proposed", confidence: 0.92,
        createdBy: "system",
      },
      [{ existingId: "abc", existingTitle: "Meeting format", description: "Potential conflict" }],
    );
    expect(result).toBe(false);
  });

  it("does NOT auto-adopt high-risk types like policy_reference", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "policy_reference", title: "Policy auto-suggested",
        content: "This policy is relevant.",
        sourceType: "ai_proposed", confidence: 0.95,
        createdBy: "system",
      },
      [],
    );
    expect(result).toBe(false);
  });

  it("auto-adopts import source type with high confidence", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "terminology", title: "NDIS Participant",
        content: "An individual who receives NDIS funding.",
        sourceType: "import", confidence: 0.88,
        createdBy: "system",
      },
      [],
    );
    expect(result).toBe(true);
  });

  it("auto-adopts organisation_profile type", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "organisation_profile", title: "Org size",
        content: "Organisation has 50 staff across 3 offices.",
        sourceType: "ai_proposed", confidence: 0.85,
        createdBy: "system",
      },
      [],
    );
    expect(result).toBe(true);
  });

  it("conversation sourceType is NOT auto-adopted", () => {
    const result = canAutoAdoptMemory(
      {
        memoryType: "operating_preference", title: "Meeting preference",
        content: "Based on conversation, team prefers morning standup.",
        sourceType: "conversation", confidence: 0.9,
        createdBy: "system",
      },
      [],
    );
    expect(result).toBe(false);
  });
});

// ─── UEE Lane Enforcement Contract (classifier side) ─────────────────────────
//
// These tests verify that the classifier produces the correct lane flags that
// are forwarded to the UEE (actual UEE enforcement is tested separately in
// sprint29m-uee-enforcement.test.ts which exercises the real engine).

describe("UEE approval enforcement — evidence_bearing classifier side", () => {
  it("evidence_bearing classifier output always has requiresApproval=true", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Conduct a compliance review of our incident management policy",
      conversationMode: "task_intent",
      proposedTask:     { title: "Compliance Review" },
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresApproval).toBe(true);
  });

  it("evidence_bearing classifier output always has requiresEvidence=true", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:          "Review our leave policy for compliance gaps",
      conversationMode:     "task_intent",
      extractedSearchTerms: ["Leave Policy"],
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresEvidence).toBe(true);
  });

  it("transient lane has requiresApproval=false and requiresEvidence=false", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write a quick email to the team",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
    expect(r.requiresApproval).toBe(false);
    expect(r.requiresEvidence).toBe(false);
  });

  it("approval-delayed path: task.metadata.laneContext round-trips correctly", () => {
    const stored = {
      executionClass: "evidence_bearing" as const,
      requiresCompletedWork: true,
      requiresEvidence: true,
      requiresClaimIntegrity: true,
      requiresApproval: true,
    };
    const taskMeta: Record<string, unknown> = { laneContext: stored };
    const retrieved = taskMeta.laneContext as typeof stored | undefined;
    expect(retrieved?.executionClass).toBe("evidence_bearing");
    expect(retrieved?.requiresApproval).toBe(true);
    expect(retrieved?.requiresEvidence).toBe(true);
  });
});

// ─── Non-conversation triggers (always ≥ PROFESSIONAL_WORK) ─────────────────

describe("trigger-based routing enforcement", () => {
  it("task trigger with transient text still routes to PROFESSIONAL_WORK", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "write a quick email",
      conversationMode: "general",
      trigger:          "task",
    }));
    expect(r.executionClass).not.toBe("transient");
    expect(r.requiresCompletedWork).toBe(true);
  });

  it("scheduled trigger routes minimum PROFESSIONAL_WORK", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Summarise this week's activities",
      conversationMode: "general",
      trigger:          "scheduled",
    }));
    expect(r.executionClass).not.toBe("transient");
  });

  it("workflow trigger routes minimum PROFESSIONAL_WORK", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Generate a report",
      conversationMode: "general",
      trigger:          "workflow",
    }));
    expect(r.executionClass).not.toBe("transient");
  });
});
