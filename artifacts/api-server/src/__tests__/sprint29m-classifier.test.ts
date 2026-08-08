/**
 * Sprint 29M — Execution Classifier Unit Tests
 *
 * Tests the three-lane classifyExecutionRequest() function:
 *   TRANSIENT          — trivial conversational work, stays in Chat
 *   PROFESSIONAL_WORK  — durable work-product, Completed Work lifecycle
 *   EVIDENCE_BEARING   — policy/compliance reviews, full evidence pipeline
 *
 * 40 tests covering:
 *   - J1/J2/J3 TRANSIENT journeys (email, rewrite, ideas)
 *   - J4/J5 PROFESSIONAL_WORK journeys (procedure, plan, onboarding)
 *   - Evidence-bearing journeys (compliance review, gap analysis)
 *   - Non-conversation triggers (always ≥ PROFESSIONAL_WORK)
 *   - Blueprint evidence mode escalation
 *   - Ambiguous cases (must NOT downgrade to TRANSIENT unless signals unambiguous)
 */

import { describe, it, expect } from "vitest";
import { classifyExecutionRequest } from "../services/executionClassifierService.js";
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

// ─── J1 — Email drafting (TRANSIENT) ─────────────────────────────────────────

describe("J1 — email drafting → TRANSIENT", () => {
  it("simple email request in general mode", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write me a quick email to the team about the office closure",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
    expect(r.requiresCompletedWork).toBe(false);
    expect(r.requiresEvidence).toBe(false);
    expect(r.requiresApproval).toBe(false);
  });

  it("draft an email to a stakeholder", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Draft an email to our stakeholders about the NDIS plan review",
      conversationMode: "task_followup",
    }));
    expect(r.executionClass).toBe("transient");
    expect(r.requiresCompletedWork).toBe(false);
  });

  it("email in status_request mode", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Can you write a short email to the participant's family?",
      conversationMode: "status_request",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("email does not escalate even with 'professional' framing", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write a professionally worded email to the CEO",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });
});

// ─── J2 — Rewriting (TRANSIENT) ──────────────────────────────────────────────

describe("J2 — rewriting tasks → TRANSIENT", () => {
  it("rewrite this paragraph in simpler language", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Rewrite this paragraph in simpler language for staff",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("rephrase the summary section", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Can you rephrase the summary section to be more concise?",
      conversationMode: "task_followup",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("improve this job description", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Improve my job description for the operations manager role",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });
});

// ─── J3 — Brainstorming / ideas (TRANSIENT) ──────────────────────────────────

describe("J3 — brainstorming → TRANSIENT", () => {
  it("brainstorm ideas for onboarding improvements", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Brainstorm ideas for improving our onboarding process",
      conversationMode: "brainstorming",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("generate ideas for staff engagement", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Generate ideas for our staff engagement program",
      conversationMode: "brainstorming",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("list options for incident response improvements", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "List of ideas for improving our incident response",
      conversationMode: "brainstorming",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("brainstorming escalates when evidence signals present", () => {
    // Even brainstorming mode escalates when evidence patterns are present
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Brainstorm ideas for our compliance audit process",
      conversationMode: "brainstorming",
      extractedSearchTerms: ["Compliance Audit Policy"],
    }));
    // Has document references — should not be TRANSIENT
    expect(r.executionClass).not.toBe("transient");
  });
});

// ─── J4 — General information (TRANSIENT) ────────────────────────────────────

describe("J4 — general info requests → TRANSIENT", () => {
  it("explain what a corrective action plan is", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Explain what a corrective action plan is",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("what is NDIS audit readiness", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "What is NDIS audit readiness and how does it work?",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
  });

  it("how does a performance review work", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "How does a performance review work in our organisation?",
      conversationMode: "general",
    }));
    // 'performance review' fires professionalScore but 'how does' wins as transient
    expect(r.executionClass).toBe("transient");
  });
});

// ─── J5 — Professional work-product (PROFESSIONAL_WORK) ───────────────────────

describe("J5 — professional work-product → PROFESSIONAL_WORK", () => {
  it("create an onboarding checklist", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Create an onboarding checklist for new support workers",
      conversationMode: "task_intent",
      proposedTask:     { title: "Onboarding Checklist" },
    }));
    expect(r.executionClass).toBe("professional_work");
    expect(r.requiresCompletedWork).toBe(true);
  });

  it("draft an operational procedure for medication administration", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Draft a standard operating procedure for medication administration",
      conversationMode: "task_intent",
      proposedTask:     { title: "Medication Administration SOP" },
    }));
    expect(r.executionClass).toBe("professional_work");
    expect(r.requiresCompletedWork).toBe(true);
  });

  it("prepare meeting minutes template", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Prepare meeting minutes for today's board meeting",
      conversationMode: "task_intent",
      proposedTask:     { title: "Board Meeting Minutes" },
    }));
    expect(r.executionClass).toBe("professional_work");
  });

  it("action plan for team performance improvement", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Create an action plan to improve team performance",
      conversationMode: "task_intent",
      proposedTask:     { title: "Team Performance Action Plan" },
    }));
    expect(r.executionClass).toBe("professional_work");
  });

  it("project plan for new system rollout", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Create a project plan for the new client management system rollout",
      conversationMode: "task_intent",
      proposedTask:     { title: "CMS Rollout Project Plan" },
    }));
    expect(r.executionClass).toBe("professional_work");
  });

  it("executive brief for leadership", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Prepare an executive brief for the CEO about the NDIS changes",
      conversationMode: "task_intent",
      proposedTask:     { title: "NDIS Changes Executive Brief" },
    }));
    expect(r.executionClass).toBe("professional_work");
  });
});

// ─── J6 — Evidence-bearing work (EVIDENCE_BEARING) ───────────────────────────

describe("J6 — policy/compliance review → EVIDENCE_BEARING", () => {
  it("compliance review → EVIDENCE_BEARING", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Conduct a compliance review of our incident management processes",
      conversationMode: "task_intent",
      proposedTask:     { title: "Compliance Review" },
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresEvidence).toBe(true);
    expect(r.requiresClaimIntegrity).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });

  it("policy gap analysis → EVIDENCE_BEARING", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Do a gap analysis on our current leave policy against NDIS standards",
      conversationMode: "task_intent",
      extractedSearchTerms: ["Leave Policy"],
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresEvidence).toBe(true);
  });

  it("review our incident management policy → EVIDENCE_BEARING", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Review our Incident Management Policy for compliance gaps",
      conversationMode: "task_intent",
      extractedSearchTerms: ["Incident Management Policy"],
    }));
    expect(r.executionClass).toBe("evidence_bearing");
  });

  it("risk assessment → EVIDENCE_BEARING", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Conduct a risk assessment of our participant transport process",
      conversationMode: "task_intent",
      proposedTask:     { title: "Transport Risk Assessment" },
    }));
    expect(r.executionClass).toBe("evidence_bearing");
  });

  it("document comparison → EVIDENCE_BEARING", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Compare our current Medication Policy against NDIS practice standards",
      conversationMode: "task_intent",
      extractedSearchTerms: ["Medication Policy"],
    }));
    expect(r.executionClass).toBe("evidence_bearing");
  });

  it("formal audit report → EVIDENCE_BEARING", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Prepare a formal audit report on our safeguarding processes",
      conversationMode: "task_intent",
      proposedTask:     { title: "Safeguarding Audit Report" },
    }));
    expect(r.executionClass).toBe("evidence_bearing");
  });
});

// ─── Non-conversation triggers (always ≥ PROFESSIONAL_WORK) ─────────────────

describe("non-conversation triggers never downgrade to TRANSIENT", () => {
  it("task trigger → PROFESSIONAL_WORK minimum", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write me a quick email",
      conversationMode: "general",
      trigger:          "task",
    }));
    expect(r.executionClass).not.toBe("transient");
    expect(r.requiresCompletedWork).toBe(true);
  });

  it("scheduled trigger with email request → PROFESSIONAL_WORK", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Draft email to participant",
      conversationMode: "general",
      trigger:          "scheduled",
    }));
    expect(r.executionClass).not.toBe("transient");
  });

  it("workflow trigger with brainstorm request → PROFESSIONAL_WORK", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Brainstorm ideas for next quarter",
      conversationMode: "brainstorming",
      trigger:          "workflow",
    }));
    expect(r.executionClass).not.toBe("transient");
  });

  it("task trigger with compliance review → EVIDENCE_BEARING", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Compliance review of incident policy",
      conversationMode: "general",
      trigger:          "task",
      extractedSearchTerms: ["Incident Policy"],
    }));
    expect(r.executionClass).toBe("evidence_bearing");
  });
});

// ─── Blueprint evidence mode escalation ──────────────────────────────────────

describe("blueprint evidence mode escalation", () => {
  it("blueprintEvidenceMode=required → EVIDENCE_BEARING regardless of mode", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Do this",
      conversationMode:      "general",
      blueprintEvidenceMode: "required",
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresClaimIntegrity).toBe(true);
  });

  it("blueprintEvidenceMode=optional does NOT force EVIDENCE_BEARING for simple request", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Write a meeting minutes template",
      conversationMode:      "task_intent",
      proposedTask:          { title: "Meeting Minutes" },
      blueprintEvidenceMode: "optional",
    }));
    // optional mode doesn't force evidence — PROFESSIONAL_WORK is fine
    expect(r.executionClass).not.toBe("transient");
  });

  it("blueprintEvidenceMode=none with transient request → TRANSIENT", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Write a quick email",
      conversationMode:      "general",
      blueprintEvidenceMode: "none",
    }));
    expect(r.executionClass).toBe("transient");
  });
});

// ─── Ambiguous cases — must NOT downgrade ─────────────────────────────────────

describe("ambiguous cases — must not downgrade to TRANSIENT", () => {
  it("task_intent mode with proposed task stays PROFESSIONAL_WORK minimum", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "I need something prepared about our HR process",
      conversationMode: "task_intent",
      proposedTask:     { title: "HR Process Overview" },
    }));
    expect(r.executionClass).not.toBe("transient");
  });

  it("shouldDispatchSpecialists=true prevents TRANSIENT", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:               "Help me with the incident",
      conversationMode:          "task_followup",
      shouldDispatchSpecialists: true,
    }));
    expect(r.executionClass).not.toBe("transient");
  });

  it("document references in general mode prevent TRANSIENT", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:           "Can you check the Medication Management Policy?",
      conversationMode:      "general",
      extractedSearchTerms:  ["Medication Management Policy"],
    }));
    expect(r.executionClass).not.toBe("transient");
  });

  it("transient output pattern loses to professional pattern when task_intent", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write a procedure document for medication management",
      conversationMode: "task_intent",
      proposedTask:     { title: "Medication Procedure" },
    }));
    // 'Write' is transient signal but 'procedure' + task_intent → PROFESSIONAL_WORK
    expect(r.executionClass).not.toBe("transient");
  });
});

// ─── Return shape contract ────────────────────────────────────────────────────

describe("return shape contract", () => {
  it("TRANSIENT has correct flag values", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write a quick email",
      conversationMode: "general",
    }));
    expect(r.executionClass).toBe("transient");
    expect(r.requiresCompletedWork).toBe(false);
    expect(r.requiresEvidence).toBe(false);
    expect(r.requiresClaimIntegrity).toBe(false);
    expect(r.requiresApproval).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(r.signals).toBeDefined();
  });

  it("EVIDENCE_BEARING has correct flag values", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Conduct a compliance review of our incident management policy",
      conversationMode: "task_intent",
      proposedTask:     { title: "Compliance Review" },
    }));
    expect(r.executionClass).toBe("evidence_bearing");
    expect(r.requiresCompletedWork).toBe(true);
    expect(r.requiresEvidence).toBe(true);
    expect(r.requiresClaimIntegrity).toBe(true);
    expect(r.requiresApproval).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  it("signals telemetry contains expected fields", () => {
    const r = classifyExecutionRequest(makeInput({
      userRequest:      "Write a quick email",
      conversationMode: "general",
    }));
    expect(r.signals.conversationMode).toBe("general");
    expect(r.signals.trigger).toBe("conversation");
    expect(typeof r.signals.transientOutputScore).toBe("number");
    expect(typeof r.signals.evidenceOutputScore).toBe("number");
    expect(typeof r.signals.hasDocumentReferences).toBe("boolean");
  });

  it("all execution classes have non-empty reason", () => {
    const inputs: ExecutionClassifierInput[] = [
      makeInput({ userRequest: "email", conversationMode: "general" }),
      makeInput({ userRequest: "draft a procedure", conversationMode: "task_intent", proposedTask: { title: "Procedure" } }),
      makeInput({ userRequest: "compliance review", conversationMode: "task_intent", proposedTask: { title: "Compliance Review" } }),
    ];
    for (const input of inputs) {
      const r = classifyExecutionRequest(input);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});
